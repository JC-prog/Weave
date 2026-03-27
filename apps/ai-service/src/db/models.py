import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import (
    Column,
    DateTime,
    ForeignKey,
    String,
    Text,
    func,
)
from sqlalchemy.dialects.postgresql import JSON, UUID
from sqlalchemy.orm import DeclarativeBase, relationship


# ─── Base ─────────────────────────────────────────────────────────────────────

class Base(DeclarativeBase):
    pass


# ─── Conversations ────────────────────────────────────────────────────────────

class Conversation(Base):
    """A conversation thread between a user and the AI within a vault."""

    __tablename__ = "conversations"
    __table_args__ = {"schema": "ai_svc"}

    id: Any = Column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
        nullable=False,
    )
    user_id: Any = Column(UUID(as_uuid=True), nullable=False, index=True)
    vault_id: Any = Column(UUID(as_uuid=True), nullable=False, index=True)
    title: Any = Column(String(500), nullable=False, default="New Conversation")
    created_at: Any = Column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )
    updated_at: Any = Column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )

    # Relationship
    messages: Any = relationship(
        "Message",
        back_populates="conversation",
        cascade="all, delete-orphan",
        order_by="Message.created_at",
    )


# ─── Messages ─────────────────────────────────────────────────────────────────

class Message(Base):
    """A single message (user or assistant) within a conversation."""

    __tablename__ = "messages"
    __table_args__ = {"schema": "ai_svc"}

    id: Any = Column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
        nullable=False,
    )
    conversation_id: Any = Column(
        UUID(as_uuid=True),
        ForeignKey("ai_svc.conversations.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    role: Any = Column(String(20), nullable=False)       # 'user' | 'assistant'
    content: Any = Column(Text, nullable=False)
    # JSON array of source note references returned by the RAG pipeline
    sources: Any = Column(JSON, nullable=True)
    created_at: Any = Column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )

    # Relationship
    conversation: Any = relationship("Conversation", back_populates="messages")
