import json
import logging
import uuid
from typing import AsyncIterator, Optional

from fastapi import APIRouter, Depends, Header, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sse_starlette.sse import EventSourceResponse

from src.db.database import get_db
from src.db.models import Conversation, Message
from src.rag.pipeline import stream_rag_response

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/ai", tags=["chat"])


# ─── Pydantic Schemas ─────────────────────────────────────────────────────────


class ChatRequest(BaseModel):
    message: str = Field(..., min_length=1, max_length=10_000)
    vault_id: str = Field(..., description="UUID of the vault to search")
    conversation_id: Optional[str] = Field(None, description="Continue an existing conversation")


class ConversationResponse(BaseModel):
    id: str
    title: str
    vault_id: str
    created_at: str
    updated_at: str
    message_count: int = 0


class MessageResponse(BaseModel):
    id: str
    role: str
    content: str
    sources: Optional[list] = None
    created_at: str


class ConversationDetailResponse(BaseModel):
    id: str
    title: str
    vault_id: str
    created_at: str
    updated_at: str
    messages: list[MessageResponse]


# ─── Auth Helper ──────────────────────────────────────────────────────────────


def _extract_token(authorization: Optional[str]) -> str:
    """Extract the Bearer token from the Authorization header."""
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authorization header with Bearer token required",
        )
    return authorization[7:]


def _get_user_id(authorization: Optional[str]) -> str:
    """
    Decode the user ID from the JWT without full verification.
    Full verification is performed at the API gateway / auth-service level;
    here we only need the subject claim to scope DB queries.
    """
    import base64

    token = _extract_token(authorization)
    try:
        # JWT structure: header.payload.signature
        payload_part = token.split(".")[1]
        # Add padding if needed
        padding = 4 - len(payload_part) % 4
        if padding != 4:
            payload_part += "=" * padding
        payload = json.loads(base64.urlsafe_b64decode(payload_part))
        user_id = payload.get("sub")
        if not user_id:
            raise ValueError("Missing 'sub' claim")
        return str(user_id)
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=f"Invalid token: {exc}",
        )


# ─── Routes ───────────────────────────────────────────────────────────────────


@router.post("/chat")
async def chat(
    body: ChatRequest,
    authorization: Optional[str] = Header(None),
    db: AsyncSession = Depends(get_db),
):
    """
    Stream a RAG-backed chat response using SSE.

    Flow:
    1. Load or create the conversation record.
    2. Persist the user message.
    3. Stream: sources chunk → token chunks → done.
    4. Persist the assembled assistant message when streaming completes.
    """
    user_token = _extract_token(authorization)
    user_id = _get_user_id(authorization)

    # ── Load or create conversation ──────────────────────────────────────────
    conversation: Optional[Conversation] = None

    if body.conversation_id:
        result = await db.execute(
            select(Conversation).where(
                Conversation.id == uuid.UUID(body.conversation_id),
                Conversation.user_id == uuid.UUID(user_id),
            )
        )
        conversation = result.scalar_one_or_none()
        if not conversation:
            raise HTTPException(status_code=404, detail="Conversation not found")
    else:
        conversation = Conversation(
            user_id=uuid.UUID(user_id),
            vault_id=uuid.UUID(body.vault_id),
            title=body.message[:80] + ("..." if len(body.message) > 80 else ""),
        )
        db.add(conversation)
        await db.flush()  # get the generated ID

    conversation_id_str = str(conversation.id)

    # ── Persist user message ─────────────────────────────────────────────────
    user_msg = Message(
        conversation_id=conversation.id,
        role="user",
        content=body.message,
    )
    db.add(user_msg)
    await db.commit()

    # ── Build history for the LLM ────────────────────────────────────────────
    history_result = await db.execute(
        select(Message)
        .where(Message.conversation_id == conversation.id)
        .order_by(Message.created_at)
        .limit(20)  # last 20 messages as context window
    )
    history_messages = history_result.scalars().all()
    # Exclude the message we just added (it is included as the query)
    lm_history = [
        {"role": m.role, "content": m.content}
        for m in history_messages
        if str(m.id) != str(user_msg.id)
    ]

    # ── SSE Event Generator ──────────────────────────────────────────────────
    async def event_generator() -> AsyncIterator[dict]:
        accumulated_content = ""
        sources_saved: list = []

        try:
            async for chunk in stream_rag_response(
                query=body.message,
                history=lm_history,
                vault_id=body.vault_id,
                user_token=user_token,
            ):
                chunk_type = chunk.get("type")

                if chunk_type == "sources":
                    sources_saved = chunk.get("sources", [])
                    yield {"event": "sources", "data": json.dumps({"sources": sources_saved})}

                elif chunk_type == "token":
                    token_text = chunk.get("content", "")
                    accumulated_content += token_text
                    yield {"event": "token", "data": json.dumps({"content": token_text})}

                elif chunk_type == "error":
                    yield {
                        "event": "error",
                        "data": json.dumps({"message": chunk.get("message", "Unknown error")}),
                    }
                    return

                elif chunk_type == "done":
                    # Persist the complete assistant message
                    async with get_db().__aenter__() as save_db:
                        assistant_msg = Message(
                            conversation_id=uuid.UUID(conversation_id_str),
                            role="assistant",
                            content=accumulated_content,
                            sources=sources_saved,
                        )
                        save_db.add(assistant_msg)
                        await save_db.commit()

                    yield {"event": "done", "data": json.dumps({"conversation_id": conversation_id_str})}

        except Exception as exc:
            logger.error("Streaming error in chat endpoint: %s", exc)
            yield {"event": "error", "data": json.dumps({"message": str(exc)})}

    return EventSourceResponse(event_generator())


@router.get("/conversations", response_model=list[ConversationResponse])
async def list_conversations(
    authorization: Optional[str] = Header(None),
    db: AsyncSession = Depends(get_db),
):
    """List all conversations for the authenticated user."""
    user_id = _get_user_id(authorization)

    result = await db.execute(
        select(Conversation)
        .where(Conversation.user_id == uuid.UUID(user_id))
        .order_by(Conversation.updated_at.desc())
        .limit(100)
    )
    conversations = result.scalars().all()

    return [
        ConversationResponse(
            id=str(c.id),
            title=c.title,
            vault_id=str(c.vault_id),
            created_at=c.created_at.isoformat(),
            updated_at=c.updated_at.isoformat(),
        )
        for c in conversations
    ]


@router.get("/conversations/{conversation_id}", response_model=ConversationDetailResponse)
async def get_conversation(
    conversation_id: str,
    authorization: Optional[str] = Header(None),
    db: AsyncSession = Depends(get_db),
):
    """Get a single conversation with all its messages."""
    user_id = _get_user_id(authorization)

    result = await db.execute(
        select(Conversation).where(
            Conversation.id == uuid.UUID(conversation_id),
            Conversation.user_id == uuid.UUID(user_id),
        )
    )
    conversation = result.scalar_one_or_none()
    if not conversation:
        raise HTTPException(status_code=404, detail="Conversation not found")

    msg_result = await db.execute(
        select(Message)
        .where(Message.conversation_id == conversation.id)
        .order_by(Message.created_at)
    )
    messages = msg_result.scalars().all()

    return ConversationDetailResponse(
        id=str(conversation.id),
        title=conversation.title,
        vault_id=str(conversation.vault_id),
        created_at=conversation.created_at.isoformat(),
        updated_at=conversation.updated_at.isoformat(),
        messages=[
            MessageResponse(
                id=str(m.id),
                role=m.role,
                content=m.content,
                sources=m.sources,
                created_at=m.created_at.isoformat(),
            )
            for m in messages
        ],
    )


@router.delete("/conversations/{conversation_id}", status_code=204)
async def delete_conversation(
    conversation_id: str,
    authorization: Optional[str] = Header(None),
    db: AsyncSession = Depends(get_db),
):
    """Delete a conversation and all its messages."""
    user_id = _get_user_id(authorization)

    result = await db.execute(
        select(Conversation).where(
            Conversation.id == uuid.UUID(conversation_id),
            Conversation.user_id == uuid.UUID(user_id),
        )
    )
    conversation = result.scalar_one_or_none()
    if not conversation:
        raise HTTPException(status_code=404, detail="Conversation not found")

    await db.delete(conversation)
    await db.commit()
