import json
import logging
from typing import Optional

import httpx
from fastapi import APIRouter, Header, HTTPException, status
from pydantic import BaseModel, Field

from src.config import settings
from src.providers.factory import get_provider
from src.rag.prompts import SUMMARIZE_SYSTEM_PROMPT, AUDIO_OVERVIEW_SYSTEM_PROMPT

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/ai", tags=["summarize"])


# ─── Pydantic Schemas ─────────────────────────────────────────────────────────


class SummarizeRequest(BaseModel):
    note_id: str = Field(..., description="UUID of the note to summarise")
    vault_id: str = Field(..., description="UUID of the vault containing the note")


class SummarizeResponse(BaseModel):
    summary: str
    key_points: list[str]
    note_id: str
    note_title: str


class AudioOverviewRequest(BaseModel):
    vault_id: str = Field(..., description="UUID of the vault")
    note_ids: Optional[list[str]] = Field(
        None, description="Specific note IDs to include; omit for all recent notes"
    )


class AudioOverviewResponse(BaseModel):
    title: str
    script: str


# ─── Helpers ──────────────────────────────────────────────────────────────────


def _extract_token(authorization: Optional[str]) -> str:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authorization header with Bearer token required",
        )
    return authorization[7:]


async def _fetch_note(
    vault_id: str, note_id: str, auth_header: str
) -> dict:
    """Fetch a single note from the vault-service."""
    async with httpx.AsyncClient(timeout=10.0) as client:
        try:
            resp = await client.get(
                f"{settings.VAULT_SERVICE_URL}/vaults/{vault_id}/notes/{note_id}",
                headers={"Authorization": auth_header},
            )
            resp.raise_for_status()
            return resp.json()
        except httpx.HTTPStatusError as exc:
            if exc.response.status_code == 404:
                raise HTTPException(status_code=404, detail=f"Note {note_id} not found")
            raise HTTPException(status_code=502, detail="Vault service error")
        except httpx.RequestError as exc:
            logger.error("Vault service unreachable: %s", exc)
            raise HTTPException(status_code=503, detail="Vault service unavailable")


async def _fetch_notes_for_vault(
    vault_id: str, note_ids: Optional[list[str]], auth_header: str
) -> list[dict]:
    """Fetch multiple notes from the vault-service."""
    async with httpx.AsyncClient(timeout=15.0) as client:
        if note_ids:
            notes = []
            for nid in note_ids:
                try:
                    resp = await client.get(
                        f"{settings.VAULT_SERVICE_URL}/vaults/{vault_id}/notes/{nid}",
                        headers={"Authorization": auth_header},
                    )
                    if resp.status_code == 200:
                        notes.append(resp.json())
                except httpx.RequestError:
                    pass
            return notes
        else:
            # Fetch recent notes (first page)
            try:
                resp = await client.get(
                    f"{settings.VAULT_SERVICE_URL}/vaults/{vault_id}/notes",
                    params={"limit": 5, "sort": "updatedAt:desc"},
                    headers={"Authorization": auth_header},
                )
                resp.raise_for_status()
                data = resp.json()
                return data.get("notes", data) if isinstance(data, dict) else data
            except (httpx.HTTPStatusError, httpx.RequestError) as exc:
                logger.error("Failed to fetch vault notes: %s", exc)
                raise HTTPException(status_code=502, detail="Could not fetch vault notes")


def _parse_json_response(raw: str) -> dict:
    """
    Parse a JSON object from a raw LLM response string.
    Handles models that sometimes wrap JSON in markdown code fences.
    """
    text = raw.strip()

    # Strip markdown code fence if present
    if text.startswith("```"):
        lines = text.splitlines()
        # Remove opening and closing fence lines
        inner = [l for l in lines if not l.startswith("```")]
        text = "\n".join(inner).strip()

    try:
        return json.loads(text)
    except json.JSONDecodeError as exc:
        raise ValueError(f"LLM response was not valid JSON: {exc}\nRaw: {raw[:200]}")


# ─── Routes ───────────────────────────────────────────────────────────────────


@router.post("/summarize", response_model=SummarizeResponse)
async def summarize_note(
    body: SummarizeRequest,
    authorization: Optional[str] = Header(None),
):
    """
    Summarise a single note using the configured LLM provider.

    Fetches the note from vault-service, sends its content to the LLM with the
    SUMMARIZE_SYSTEM_PROMPT, and returns a structured summary + key points.
    """
    auth_header = f"Bearer {_extract_token(authorization)}"
    note = await _fetch_note(body.vault_id, body.note_id, auth_header)

    title: str = note.get("title", "Untitled")
    content: str = note.get("content", "")

    if not content.strip():
        raise HTTPException(status_code=422, detail="Note has no content to summarise")

    # Truncate very long notes to avoid exceeding context window
    max_chars = settings.MAX_CONTEXT_TOKENS * 3  # rough char estimate
    if len(content) > max_chars:
        content = content[:max_chars] + "\n\n[... content truncated ...]"

    provider = get_provider()
    raw_response = await provider.complete(
        messages=[
            {
                "role": "user",
                "content": f"# {title}\n\n{content}",
            }
        ],
        system=SUMMARIZE_SYSTEM_PROMPT,
    )

    try:
        parsed = _parse_json_response(raw_response)
        return SummarizeResponse(
            summary=parsed.get("summary", ""),
            key_points=parsed.get("keyPoints", []),
            note_id=body.note_id,
            note_title=title,
        )
    except (ValueError, KeyError) as exc:
        logger.error("Failed to parse summarize response: %s", exc)
        # Graceful fallback: return the raw text as the summary
        return SummarizeResponse(
            summary=raw_response[:1000],
            key_points=[],
            note_id=body.note_id,
            note_title=title,
        )


@router.post("/audio-overview", response_model=AudioOverviewResponse)
async def audio_overview(
    body: AudioOverviewRequest,
    authorization: Optional[str] = Header(None),
):
    """
    Generate a podcast-style discussion script for one or more notes.

    Fetches the relevant notes from vault-service, combines their content, and
    prompts the LLM to produce a two-host conversational script.
    """
    auth_header = f"Bearer {_extract_token(authorization)}"
    notes = await _fetch_notes_for_vault(body.vault_id, body.note_ids, auth_header)

    if not notes:
        raise HTTPException(status_code=404, detail="No notes found for the given parameters")

    # Build a combined content block from all notes
    combined_parts: list[str] = []
    for note in notes[:5]:  # cap at 5 notes to stay within context limits
        note_title = note.get("title", "Untitled")
        note_content = note.get("content", "")
        max_note_chars = (settings.MAX_CONTEXT_TOKENS * 3) // len(notes[:5])
        if len(note_content) > max_note_chars:
            note_content = note_content[:max_note_chars] + "\n[...]"
        combined_parts.append(f"## {note_title}\n\n{note_content}")

    combined_content = "\n\n---\n\n".join(combined_parts)

    provider = get_provider()
    raw_response = await provider.complete(
        messages=[
            {
                "role": "user",
                "content": combined_content,
            }
        ],
        system=AUDIO_OVERVIEW_SYSTEM_PROMPT,
    )

    try:
        parsed = _parse_json_response(raw_response)
        return AudioOverviewResponse(
            title=parsed.get("title", "Knowledge Base Overview"),
            script=parsed.get("script", raw_response),
        )
    except (ValueError, KeyError) as exc:
        logger.error("Failed to parse audio overview response: %s", exc)
        return AudioOverviewResponse(
            title="Knowledge Base Overview",
            script=raw_response,
        )
