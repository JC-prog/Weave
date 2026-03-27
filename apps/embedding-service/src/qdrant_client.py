"""
Qdrant client wrapper for the embedding service.

Provides a thin abstraction over the qdrant-client library for collection
management and point upsert/delete operations.
"""

import logging
from typing import Optional

from qdrant_client import QdrantClient  # type: ignore
from qdrant_client.http import models as qmodels  # type: ignore
from qdrant_client.http.exceptions import UnexpectedResponse  # type: ignore

from src.config import settings

logger = logging.getLogger(__name__)

# ─── Singleton Client ─────────────────────────────────────────────────────────

_client: Optional[QdrantClient] = None


def get_client() -> QdrantClient:
    """Return the lazily-created Qdrant client singleton."""
    global _client
    if _client is None:
        logger.info("Connecting to Qdrant at %s", settings.QDRANT_URL)
        _client = QdrantClient(url=settings.QDRANT_URL, timeout=30)
    return _client


# ─── Collection Management ────────────────────────────────────────────────────


def ensure_collection(collection_name: str, vector_size: int) -> None:
    """
    Create a Qdrant collection with cosine distance if it does not already exist.

    Args:
        collection_name: Name of the Qdrant collection.
        vector_size:     Dimensionality of the embedding vectors.
    """
    client = get_client()

    try:
        client.get_collection(collection_name)
        # Collection already exists — nothing to do
        logger.debug("Collection '%s' already exists", collection_name)
    except (UnexpectedResponse, Exception) as exc:
        # A 404 / Not Found indicates the collection does not exist
        err_str = str(exc).lower()
        if "not found" in err_str or "404" in err_str or "doesn't exist" in err_str:
            logger.info(
                "Creating Qdrant collection '%s' with vector_size=%d",
                collection_name,
                vector_size,
            )
            client.create_collection(
                collection_name=collection_name,
                vectors_config=qmodels.VectorParams(
                    size=vector_size,
                    distance=qmodels.Distance.COSINE,
                ),
            )
        else:
            raise


# ─── Point Operations ─────────────────────────────────────────────────────────


def upsert_points(collection: str, points: list[dict]) -> None:
    """
    Upsert a batch of embedding points into a Qdrant collection.

    Each point dict must contain:
      - id:      str or int — the point identifier
      - vector:  list[float] — the embedding vector
      - payload: dict — metadata stored with the point

    Args:
        collection: Qdrant collection name.
        points:     List of point dicts as described above.
    """
    if not points:
        return

    client = get_client()

    qdrant_points = [
        qmodels.PointStruct(
            id=_normalise_id(p["id"]),
            vector=p["vector"],
            payload=p.get("payload", {}),
        )
        for p in points
    ]

    client.upsert(collection_name=collection, points=qdrant_points, wait=True)
    logger.debug("Upserted %d points into collection '%s'", len(qdrant_points), collection)


def delete_by_note_id(collection: str, note_id: str) -> None:
    """
    Delete all points in a collection whose payload contains noteId == note_id.

    Args:
        collection: Qdrant collection name.
        note_id:    The note UUID string to match in the payload.
    """
    client = get_client()

    client.delete(
        collection_name=collection,
        points_selector=qmodels.FilterSelector(
            filter=qmodels.Filter(
                must=[
                    qmodels.FieldCondition(
                        key="noteId",
                        match=qmodels.MatchValue(value=note_id),
                    )
                ]
            )
        ),
        wait=True,
    )
    logger.info("Deleted embeddings for noteId='%s' from collection '%s'", note_id, collection)


# ─── Helpers ──────────────────────────────────────────────────────────────────


def _normalise_id(raw_id: str | int) -> str | int:
    """
    Qdrant point IDs must be either unsigned integers or UUID strings.
    If the raw_id looks like a UUID we pass it as-is; otherwise try int conversion.
    """
    if isinstance(raw_id, int):
        return raw_id
    # If the id is in the format "uuid_chunkIndex" we hash it to a uint64
    str_id = str(raw_id)
    import hashlib

    return int(hashlib.sha256(str_id.encode()).hexdigest(), 16) % (2**63)
