"""
Embedding manager using fastembed.

The TextEmbedding model is loaded lazily on first use and then reused for all
subsequent calls. This avoids the ~1-2 second startup cost when the model is
not needed (e.g., during health checks).
"""

import logging
from typing import Optional

from src.config import settings

logger = logging.getLogger(__name__)

# ─── Lazy Singleton ───────────────────────────────────────────────────────────

_model: Optional[object] = None  # fastembed.TextEmbedding


def _get_model():
    """Return the lazily-initialised fastembed TextEmbedding model."""
    global _model
    if _model is None:
        from fastembed import TextEmbedding  # type: ignore

        logger.info("Loading fastembed model: %s", settings.EMBEDDING_MODEL)
        _model = TextEmbedding(model_name=settings.EMBEDDING_MODEL)
        logger.info("fastembed model loaded")
    return _model


# ─── Public API ───────────────────────────────────────────────────────────────


def embed_texts(texts: list[str]) -> list[list[float]]:
    """
    Batch-embed a list of text strings.

    fastembed processes texts in an optimised batch internally.

    Args:
        texts: List of text strings to embed.

    Returns:
        List of embedding vectors (list of floats), one per input text.
    """
    if not texts:
        return []

    model = _get_model()
    # fastembed returns a generator of numpy arrays
    embeddings = list(model.embed(texts))  # type: ignore[attr-defined]
    return [emb.tolist() for emb in embeddings]


def embed_query(query: str) -> list[float]:
    """
    Embed a single query string for similarity search.

    Uses the same model as embed_texts.  Some models support separate
    query-optimised prefixes (e.g., BGE prepends "Represent this sentence:
    for searching relevant passages:") — fastembed handles this automatically
    when the model supports it.

    Args:
        query: The query string to embed.

    Returns:
        A single embedding vector as a list of floats.
    """
    if not query.strip():
        raise ValueError("Query must not be empty")

    model = _get_model()
    # query_embed is a generator; take the first (and only) result
    embeddings = list(model.query_embed(query))  # type: ignore[attr-defined]
    if not embeddings:
        # Fallback: use standard embed if query_embed is not supported
        embeddings = list(model.embed([query]))  # type: ignore[attr-defined]
    return embeddings[0].tolist()


def get_vector_size() -> int:
    """
    Return the dimensionality of the embedding vectors for the configured model.
    Used when creating Qdrant collections.
    """
    # Produce one dummy embedding to detect the size
    model = _get_model()
    sample = list(model.embed(["hello"]))  # type: ignore[attr-defined]
    return len(sample[0].tolist())
