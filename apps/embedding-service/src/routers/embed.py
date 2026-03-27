"""
HTTP endpoints for on-demand embedding operations.
"""

import asyncio
import logging

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from src.config import settings
from src.chunkers.strategies import chunk_note
from src.embedders.manager import embed_texts, embed_query as _embed_query, get_vector_size
from src.qdrant_client import ensure_collection, upsert_points, delete_by_note_id

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/embed", tags=["embed"])


# ─── Request / Response Models ────────────────────────────────────────────────


class EmbedTextRequest(BaseModel):
    text: str = Field(..., min_length=1, max_length=50_000)


class EmbedTextResponse(BaseModel):
    vector: list[float]
    dimensions: int


class EmbedQueryRequest(BaseModel):
    query: str = Field(..., min_length=1, max_length=2_000)


class EmbedQueryResponse(BaseModel):
    vector: list[float]
    dimensions: int


class EmbedNoteRequest(BaseModel):
    noteId: str = Field(..., description="UUID of the note")
    vaultId: str = Field(..., description="UUID of the vault")
    content: str = Field(..., min_length=1, description="Raw note content")
    strategy: str = Field("paragraph", description="Chunking strategy: paragraph|heading|fixed")


class EmbedNoteResponse(BaseModel):
    chunks: int
    noteId: str
    vaultId: str


# ─── Endpoints ────────────────────────────────────────────────────────────────


@router.post("/text", response_model=EmbedTextResponse)
async def embed_text(body: EmbedTextRequest):
    """
    Embed a single text string and return its vector.

    Useful for ad-hoc embedding of short passages.
    """
    loop = asyncio.get_event_loop()
    try:
        vectors = await loop.run_in_executor(None, embed_texts, [body.text])
    except Exception as exc:
        logger.error("embed_texts error: %s", exc)
        raise HTTPException(status_code=500, detail=f"Embedding failed: {exc}")

    vector = vectors[0]
    return EmbedTextResponse(vector=vector, dimensions=len(vector))


@router.post("/query", response_model=EmbedQueryResponse)
async def embed_query_endpoint(body: EmbedQueryRequest):
    """
    Embed a search query string.

    Uses the query-optimised embedding path (if the model supports it) so the
    resulting vector is best suited for similarity search against document vectors.
    """
    loop = asyncio.get_event_loop()
    try:
        vector = await loop.run_in_executor(None, _embed_query, body.query)
    except Exception as exc:
        logger.error("embed_query error: %s", exc)
        raise HTTPException(status_code=500, detail=f"Query embedding failed: {exc}")

    return EmbedQueryResponse(vector=vector, dimensions=len(vector))


@router.post("/note", response_model=EmbedNoteResponse)
async def embed_note(body: EmbedNoteRequest):
    """
    Chunk, embed, and upsert a note's content into Qdrant.

    Steps:
    1. Chunk the content using the requested strategy.
    2. Batch-embed all chunks.
    3. Delete any existing embeddings for this note (re-index).
    4. Upsert the new points to the 'notes' Qdrant collection.

    Returns the number of chunks indexed.
    """
    loop = asyncio.get_event_loop()

    # 1. Chunk
    chunk_config = {
        "max_size": settings.CHUNK_SIZE,
        "size": settings.CHUNK_SIZE,
        "overlap": settings.CHUNK_OVERLAP,
    }
    chunks = chunk_note(body.content, strategy=body.strategy, config=chunk_config)  # type: ignore[arg-type]
    if not chunks:
        return EmbedNoteResponse(chunks=0, noteId=body.noteId, vaultId=body.vaultId)

    # 2. Ensure collection exists
    try:
        vector_size = await loop.run_in_executor(None, get_vector_size)
        await loop.run_in_executor(
            None, ensure_collection, settings.NOTES_COLLECTION, vector_size
        )
    except Exception as exc:
        logger.error("Qdrant collection setup error: %s", exc)
        raise HTTPException(status_code=503, detail="Qdrant unavailable")

    # 3. Embed chunks
    try:
        vectors = await loop.run_in_executor(None, embed_texts, chunks)
    except Exception as exc:
        logger.error("Embedding error for note %s: %s", body.noteId, exc)
        raise HTTPException(status_code=500, detail=f"Embedding failed: {exc}")

    # 4. Delete stale embeddings for this note
    try:
        await loop.run_in_executor(
            None, delete_by_note_id, settings.NOTES_COLLECTION, body.noteId
        )
    except Exception as exc:
        # Non-fatal: log and continue
        logger.warning("Could not delete stale embeddings for note %s: %s", body.noteId, exc)

    # 5. Upsert new points
    points = [
        {
            "id": f"{body.noteId}_{i}",
            "vector": vectors[i],
            "payload": {
                "noteId": body.noteId,
                "vaultId": body.vaultId,
                "chunkIndex": i,
                "text": chunks[i],
            },
        }
        for i in range(len(chunks))
    ]

    try:
        await loop.run_in_executor(None, upsert_points, settings.NOTES_COLLECTION, points)
    except Exception as exc:
        logger.error("Qdrant upsert error for note %s: %s", body.noteId, exc)
        raise HTTPException(status_code=500, detail=f"Vector store upsert failed: {exc}")

    logger.info(
        "Embedded note %s: %d chunks in vault %s", body.noteId, len(chunks), body.vaultId
    )
    return EmbedNoteResponse(chunks=len(chunks), noteId=body.noteId, vaultId=body.vaultId)
