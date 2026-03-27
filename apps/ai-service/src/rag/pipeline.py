import logging
from typing import AsyncIterator

import httpx

from src.config import settings
from src.providers.factory import get_provider
from .prompts import CHAT_SYSTEM_TEMPLATE

logger = logging.getLogger(__name__)

# ─── Types ────────────────────────────────────────────────────────────────────

SourceNote = dict  # {noteId, noteTitle, excerpt, relevanceScore, content?}
StreamChunk = dict  # {type: 'sources'|'token'|'done', ...}

# ─── Context Retrieval ────────────────────────────────────────────────────────


async def retrieve_context(
    query: str,
    vault_id: str,
    user_token: str,
) -> list[SourceNote]:
    """
    Retrieve the most relevant note excerpts for a query from the search service.

    Calls search-service /search with mode=hybrid to get the top 5 results.
    For each result the excerpt is used as the context snippet; a full-content
    fetch from vault-service is performed only if the excerpt is too short.

    Returns a list of source dicts ready to be injected into the system prompt.
    """
    headers = {
        "Authorization": f"Bearer {user_token}",
        "Content-Type": "application/json",
    }

    async with httpx.AsyncClient(timeout=15.0) as client:
        try:
            resp = await client.get(
                f"{settings.SEARCH_SERVICE_URL}/search",
                params={
                    "q": query,
                    "vaultId": vault_id,
                    "mode": "hybrid",
                    "limit": 5,
                },
                headers=headers,
            )
            resp.raise_for_status()
            data = resp.json()
        except httpx.HTTPStatusError as exc:
            logger.error("Search service error: %s", exc)
            return []
        except httpx.RequestError as exc:
            logger.error("Search service unreachable: %s", exc)
            return []

    results = data.get("results", [])
    sources: list[SourceNote] = []

    for item in results:
        note_id = item.get("noteId", "")
        note_title = item.get("noteTitle", "")
        excerpt = item.get("excerpt", "")
        score = item.get("score", 0.0)

        # If excerpt is very short, try to fetch the full note content
        if len(excerpt) < 100 and note_id:
            try:
                note_resp = await client.get(
                    f"{settings.VAULT_SERVICE_URL}/vaults/{vault_id}/notes/{note_id}",
                    headers=headers,
                )
                if note_resp.status_code == 200:
                    note_data = note_resp.json()
                    content: str = note_data.get("content", excerpt)
                    # Truncate to keep context window manageable
                    excerpt = content[:2000]
            except (httpx.HTTPStatusError, httpx.RequestError):
                pass  # Use whatever excerpt we already have

        sources.append(
            {
                "noteId": note_id,
                "noteTitle": note_title,
                "excerpt": excerpt,
                "relevanceScore": score,
            }
        )

    return sources


# ─── System Prompt Builder ────────────────────────────────────────────────────


def build_system_prompt(sources: list[SourceNote]) -> str:
    """
    Build the RAG system prompt from a list of retrieved source notes.

    Injects each note's title and excerpt into the CHAT_SYSTEM_TEMPLATE so the
    model is grounded in the user's knowledge base.
    """
    if not sources:
        return (
            "You are a helpful assistant for a personal knowledge base. "
            "No relevant notes were found for this query; answer from general knowledge "
            "and let the user know you could not find specific notes."
        )

    formatted_notes: list[str] = []
    for i, src in enumerate(sources, start=1):
        title = src.get("noteTitle") or f"Note {i}"
        excerpt = src.get("excerpt", "").strip()
        note_id = src.get("noteId", "")
        formatted_notes.append(
            f"### [{i}] {title}\n"
            f"*Note ID: {note_id}*\n\n"
            f"{excerpt}"
        )

    sources_block = "\n\n---\n\n".join(formatted_notes)
    return CHAT_SYSTEM_TEMPLATE.format(sources=sources_block)


# ─── Streaming RAG Response ───────────────────────────────────────────────────


async def stream_rag_response(
    query: str,
    history: list[dict],
    vault_id: str,
    user_token: str,
) -> AsyncIterator[StreamChunk]:
    """
    Full RAG pipeline: retrieve → prompt → stream LLM → yield SSE chunks.

    Yields dicts in this order:
      1. {type: 'sources', sources: [...]}   — retrieved context notes
      2. {type: 'token', content: '...'}     — one per LLM token
      3. {type: 'done'}                      — signals stream completion
    """
    # 1. Retrieve relevant context
    sources = await retrieve_context(query, vault_id, user_token)
    yield {"type": "sources", "sources": sources}

    # 2. Build system prompt grounded in retrieved notes
    system_prompt = build_system_prompt(sources)

    # 3. Build message list: history + current user query
    messages: list[dict] = list(history)
    messages.append({"role": "user", "content": query})

    # 4. Stream tokens from the LLM provider
    provider = get_provider()
    try:
        async for token in provider.stream_chat(messages=messages, system=system_prompt):
            yield {"type": "token", "content": token}
    except Exception as exc:
        logger.error("LLM streaming error: %s", exc)
        yield {"type": "error", "message": str(exc)}
        return

    yield {"type": "done"}
