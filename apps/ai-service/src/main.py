import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from src.config import settings
from src.db.database import close_db, init_db
from src.routers.chat import router as chat_router
from src.routers.summarize import router as summarize_router

logger = logging.getLogger(__name__)

# ─── Lifespan ─────────────────────────────────────────────────────────────────


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan: startup → yield → shutdown."""
    # Startup
    logger.info("Starting ai-service...")
    await init_db()
    logger.info("ai-service ready on port 3005")

    yield

    # Shutdown
    logger.info("Shutting down ai-service...")
    await close_db()
    logger.info("ai-service shutdown complete")


# ─── App Factory ──────────────────────────────────────────────────────────────

app = FastAPI(
    title="NotebookLM AI Service",
    description="RAG-powered chat, summarisation, and audio overview generation",
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

app.include_router(chat_router)
app.include_router(summarize_router)

# ─── Health Check ─────────────────────────────────────────────────────────────


@app.get("/health", tags=["health"])
async def health_check():
    return {
        "status": "ok",
        "service": "ai-service",
        "provider": settings.AI_PROVIDER,
    }
