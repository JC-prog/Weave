"""
Redis Streams consumer for the embedding service.

Subscribes to the 'vault:events' stream and reacts to note lifecycle events:
  - note.created / note.updated → chunk + embed + upsert to Qdrant
  - note.deleted                → delete all embeddings for the note
"""

import asyncio
import logging

import redis.asyncio as aioredis

from src.config import settings
from src.chunkers.strategies import chunk_note
from src.embedders.manager import embed_texts, get_vector_size
from src.qdrant_client import ensure_collection, upsert_points, delete_by_note_id

logger = logging.getLogger(__name__)

STREAM_KEY = "vault:events"
CONSUMER_GROUP = "embedding-service"
CONSUMER_NAME = "embedding-worker-1"
BLOCK_MS = 5_000
BATCH_SIZE = 10


# ─── Event Processor ─────────────────────────────────────────────────────────


def _parse_fields(fields: dict) -> dict:
    """Decode Redis stream field values (all bytes → str)."""
    return {
        k.decode() if isinstance(k, bytes) else k: v.decode() if isinstance(v, bytes) else v
        for k, v in fields.items()
    }


async def _index_note(note_id: str, vault_id: str, content: str) -> None:
    """
    Chunk the note content, produce embeddings, and upsert to Qdrant.
    Runs in a thread pool executor to avoid blocking the event loop with
    synchronous fastembed calls.
    """
    loop = asyncio.get_event_loop()

    # Ensure the Qdrant collection exists (idempotent)
    vector_size = await loop.run_in_executor(None, get_vector_size)
    await loop.run_in_executor(
        None, ensure_collection, settings.NOTES_COLLECTION, vector_size
    )

    # Delete stale embeddings for this note before re-indexing
    await loop.run_in_executor(None, delete_by_note_id, settings.NOTES_COLLECTION, note_id)

    # Chunk
    chunks = chunk_note(content, strategy="paragraph", config={"max_size": settings.CHUNK_SIZE})
    if not chunks:
        logger.info("Note %s has no chunks to embed", note_id)
        return

    # Embed (synchronous fastembed call in executor)
    vectors: list[list[float]] = await loop.run_in_executor(None, embed_texts, chunks)

    # Build Qdrant points
    points = [
        {
            "id": f"{note_id}_{i}",
            "vector": vectors[i],
            "payload": {
                "noteId": note_id,
                "vaultId": vault_id,
                "chunkIndex": i,
                "text": chunks[i],
            },
        }
        for i in range(len(chunks))
    ]

    await loop.run_in_executor(None, upsert_points, settings.NOTES_COLLECTION, points)
    logger.info(
        "Indexed note %s into Qdrant: %d chunks in vault %s", note_id, len(chunks), vault_id
    )


async def _handle_event(event: dict) -> None:
    """Dispatch a vault event to the appropriate handler."""
    event_type = event.get("type", "")
    note_id = event.get("noteId", "")
    vault_id = event.get("vaultId", "")
    content = event.get("content", "")

    if event_type in ("note.created", "note.updated"):
        if not note_id or not vault_id or not content:
            logger.warning(
                "Skipping %s event: missing noteId, vaultId, or content", event_type
            )
            return
        await _index_note(note_id, vault_id, content)

    elif event_type == "note.deleted":
        if not note_id:
            logger.warning("Skipping note.deleted event: missing noteId")
            return
        loop = asyncio.get_event_loop()
        await loop.run_in_executor(
            None, delete_by_note_id, settings.NOTES_COLLECTION, note_id
        )
        logger.info("Deleted embeddings for note %s", note_id)

    else:
        logger.debug("Ignoring unrecognised vault event type: %s", event_type)


# ─── Consumer Loop ────────────────────────────────────────────────────────────


async def run_worker() -> None:
    """
    Main Redis Streams consumer loop.

    Creates the consumer group if it doesn't exist, processes any pending
    (unacknowledged) messages first, then enters the live read loop.
    """
    redis_client = aioredis.from_url(
        settings.REDIS_URL,
        encoding="utf-8",
        decode_responses=False,
    )

    # Ensure consumer group exists
    try:
        await redis_client.xgroup_create(
            STREAM_KEY, CONSUMER_GROUP, id="$", mkstream=True
        )
        logger.info("Created consumer group '%s'", CONSUMER_GROUP)
    except Exception as exc:
        if "BUSYGROUP" not in str(exc):
            raise
        logger.debug("Consumer group '%s' already exists", CONSUMER_GROUP)

    # Re-process pending messages
    await _drain_pending(redis_client)

    logger.info(
        "Embedding worker started. Listening to stream '%s' group '%s'",
        STREAM_KEY,
        CONSUMER_GROUP,
    )

    while True:
        try:
            results = await redis_client.xreadgroup(
                groupname=CONSUMER_GROUP,
                consumername=CONSUMER_NAME,
                streams={STREAM_KEY: ">"},
                count=BATCH_SIZE,
                block=BLOCK_MS,
            )

            if not results:
                continue

            for _stream, entries in results:
                for entry_id, fields in entries:
                    try:
                        event = _parse_fields(fields)
                        await _handle_event(event)
                        await redis_client.xack(STREAM_KEY, CONSUMER_GROUP, entry_id)
                    except Exception as exc:
                        logger.error(
                            "Failed to process stream entry %s: %s", entry_id, exc
                        )

        except asyncio.CancelledError:
            break
        except Exception as exc:
            logger.error("Consumer loop error: %s", exc)
            await asyncio.sleep(2)

    await redis_client.aclose()


async def _drain_pending(redis_client) -> None:
    """Re-process any pending (unacknowledged) messages from previous runs."""
    last_id = "0"

    while True:
        results = await redis_client.xreadgroup(
            groupname=CONSUMER_GROUP,
            consumername=CONSUMER_NAME,
            streams={STREAM_KEY: last_id},
            count=BATCH_SIZE,
        )

        if not results:
            break

        has_entries = False
        for _stream, entries in results:
            for entry_id, fields in entries:
                has_entries = True
                try:
                    event = _parse_fields(fields)
                    await _handle_event(event)
                    await redis_client.xack(STREAM_KEY, CONSUMER_GROUP, entry_id)
                    last_id = entry_id
                except Exception as exc:
                    logger.error(
                        "Failed to process pending entry %s: %s", entry_id, exc
                    )

        if not has_entries:
            break
