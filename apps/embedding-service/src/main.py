import asyncio
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from src.config import settings
from src.routers.embed import router as embed_router

logger = logging.getLogger(__name__)

# ─── Background Worker Task ───────────────────────────────────────────────────

_worker_task: asyncio.Task | None = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Start Redis Streams worker on startup; cancel it on shutdown."""
    global _worker_task

    logger.info("Starting embedding-service...")

    # Import here to avoid circular imports
    from src.worker import run_worker

    _worker_task = asyncio.create_task(run_worker())
    logger.info("Redis Streams worker started")

    yield

    # Shutdown
    if _worker_task and not _worker_task.done():
        _worker_task.cancel()
        try:
            await _worker_task
        except asyncio.CancelledError:
            pass
    logger.info("embedding-service shutdown complete")


# ─── App ──────────────────────────────────────────────────────────────────────

app = FastAPI(
    title="NotebookLM Embedding Service",
    description="Text chunking, embedding generation, and Qdrant vector store management",
    version="0.0.1",
    lifespan=lifespan,
    docs_url="/docs",
    redoc_url="/redoc",
)

# ─── Middleware ───────────────────────────────────────────────────────────────

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ─── Routers ──────────────────────────────────────────────────────────────────

app.include_router(embed_router)

# ─── Health ───────────────────────────────────────────────────────────────────


@app.get("/health", tags=["health"])
async def health_check():
    return {
        "status": "ok",
        "service": "embedding-service",
        "model": settings.EMBEDDING_MODEL,
        "qdrant_url": settings.QDRANT_URL,
    }
