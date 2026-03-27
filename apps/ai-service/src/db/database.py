import logging
from contextlib import asynccontextmanager
from typing import AsyncIterator

from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy import text

from src.config import settings
from .models import Base

logger = logging.getLogger(__name__)

# ─── Engine ───────────────────────────────────────────────────────────────────

engine: AsyncEngine = create_async_engine(
    settings.DATABASE_URL,
    echo=False,
    pool_size=10,
    max_overflow=20,
    pool_pre_ping=True,
    pool_recycle=300,
)

# ─── Session Factory ──────────────────────────────────────────────────────────

AsyncSessionLocal = async_sessionmaker(
    bind=engine,
    class_=AsyncSession,
    expire_on_commit=False,
    autoflush=False,
    autocommit=False,
)

# ─── Dependency ───────────────────────────────────────────────────────────────


@asynccontextmanager
async def get_session() -> AsyncIterator[AsyncSession]:
    """Async context manager that yields a database session and handles cleanup."""
    async with AsyncSessionLocal() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise
        finally:
            await session.close()


async def get_db() -> AsyncIterator[AsyncSession]:
    """FastAPI dependency that yields a DB session per request."""
    async with get_session() as session:
        yield session


# ─── Startup / Shutdown ───────────────────────────────────────────────────────


async def init_db() -> None:
    """
    Initialise the database:
    - Create the ai_svc schema if it doesn't exist.
    - Create all ORM-managed tables.
    """
    async with engine.begin() as conn:
        await conn.execute(text("CREATE SCHEMA IF NOT EXISTS ai_svc"))
        await conn.run_sync(Base.metadata.create_all)
    logger.info("ai_svc database schema initialised")


async def close_db() -> None:
    """Dispose the engine connection pool on shutdown."""
    await engine.dispose()
    logger.info("Database engine disposed")
