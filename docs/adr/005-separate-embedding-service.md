# ADR 005 — Separate Embedding Worker from AI Orchestration Service

**Status:** Accepted
**Date:** 2026-03-27
**Author:** Engineering Team

---

## Context

The system requires text embeddings in two distinct scenarios:

1. **Indexing (background, high volume):** Whenever a note is created or updated, its content must be chunked, embedded, and stored in Qdrant. This is triggered by Redis Stream events. For a user who writes or imports many notes, this can involve hundreds of embedding computations in a short period. This workload is batch-friendly, latency-tolerant (a small lag is acceptable), and CPU/GPU intensive.

2. **Query (foreground, low volume):** When a user performs a search or sends an AI chat message, the query text must be embedded to perform vector similarity search. This requires a single embedding computation. It is latency-sensitive (adds to the user-visible response time) but very low frequency.

The question is: which service should own embedding functionality?

### The Obvious Answer: Put It in the AI Service

At first glance, embedding is closely related to AI functionality — both deal with language models, both are used in the RAG pipeline. Putting embedding in `ai-service` is the "simple" approach.

**Problems with this approach:**

1. **Workload mismatch:** The AI service primarily handles synchronous, streaming chat requests (I/O-bound, waiting on LLM API responses). Embedding is synchronous but CPU-bound. A large note import generating hundreds of embedding requests would compete with ongoing chat streams in the same process.

2. **Model lifecycle:** The embedding model (`BAAI/bge-small-en-v1.5`) is loaded into memory once and kept resident. In Node.js, running Python ML models requires either a subprocess or a foreign function interface — neither is pleasant. The natural language for ML model inference is Python (torch, sentence-transformers, HuggingFace). The natural language for the API gateway and stream processing is TypeScript.

3. **Independent scaling:** During a bulk import (user uploads 200 PDFs), the embedding workload spikes dramatically while chat load may be zero. If embedding lives in `ai-service`, scaling up for the import also scales up the (idle) chat infrastructure.

4. **Model upgrades:** Swapping the embedding model (e.g., from BGE-small 384-dim to BGE-large 1024-dim, or to a different architecture entirely) requires changing the Qdrant collection dimensions, re-indexing all notes, and restarting the service. If embedding is embedded (pun intended) in the AI service, this affects chat as well. Isolation makes upgrades cleaner.

5. **Reuse:** The embedding capability is consumed by two callers: `search-service` (query embedding for semantic search) and the indexing pipeline (note embedding on save). If embedding lives in `ai-service`, `search-service` would need to call `ai-service` — a semantically odd dependency (why does search depend on AI?). A standalone embedding service is a more natural dependency for both.

### Alternatives Considered

**Option A: Embedding logic in ai-service**
See "Problems with this approach" above. Rejected due to language mismatch, workload interference, and poor conceptual fit.

**Option B: Embedding logic in search-service**
Search service owns the query embedding needed for vector similarity, and could also own the indexing pipeline. This creates a cleaner dependency graph for the query path (search-service calls itself). However:
- search-service is TypeScript; embedding model requires Python
- Bulk indexing workload would compete with query serving in the same process
- `vault-service` would need to know about `search-service` internals to trigger re-indexing

**Option C: Inline embedding in vault-service**
vault-service calls the embedding API synchronously on every note save, before returning to the client.
- This makes note saves slow (embedding adds 50–200ms latency per save)
- vault-service (TypeScript) calling Python ML inference is architecturally awkward
- Makes vault-service dependent on embedding infrastructure availability

**Option D: Dedicated embedding-service (Python/FastAPI) — selected**
A standalone Python service that:
- Owns the embedding model lifecycle
- Consumes Redis Stream events for background indexing
- Exposes an HTTP API for synchronous query embedding

---

## Decision

We implement a **dedicated `embedding-service`** as a Python 3.12 / FastAPI application.

### Technology Rationale: Python

Python is the unambiguous choice for ML inference:
- `sentence-transformers` library provides a single-line API for loading any HuggingFace embedding model: `SentenceTransformer("BAAI/bge-small-en-v1.5")`
- `torch` provides GPU acceleration automatically when CUDA is available
- The HuggingFace Hub ecosystem allows swapping models with a single config change
- `qdrant-client` (Python) is the reference implementation with the most complete API coverage
- `redis-py` supports Redis Streams with consumer groups natively

### Service Design

#### Model Loading

The model is loaded once at startup and kept in memory:

```python
from sentence_transformers import SentenceTransformer

class EmbeddingService:
    def __init__(self, model_name: str):
        self.model = SentenceTransformer(model_name)
        self.dimensions = self.model.get_sentence_embedding_dimension()
```

On first startup, the model is downloaded from HuggingFace Hub (~130MB for BGE-small) and cached in `~/.cache/huggingface/`. Subsequent startups load from cache (~2 seconds). In Docker, the cache is mounted as a volume to persist across container restarts.

#### Background Indexing (Redis Stream Consumer)

```python
async def consume_note_events():
    while True:
        events = await redis.xreadgroup(
            groupname="embedding-workers",
            consumername=consumer_id,
            streams={"notes.events": ">"},
            count=10,
            block=5000
        )
        for event in events:
            await process_note_event(event)
            await redis.xack("notes.events", "embedding-workers", event.id)
```

For each `note.created` or `note.updated` event:
1. Fetch note content from `vault-service` GET `/internal/notes/:noteId`
2. Chunk text into 512-token windows with 64-token overlap
3. Batch-embed all chunks: `self.model.encode(chunks, batch_size=32, normalize_embeddings=True)`
4. Delete existing Qdrant points for this noteId (idempotency)
5. Upsert new points to Qdrant

For `note.deleted`: delete all Qdrant points for the noteId.

#### Synchronous Query Embedding (HTTP API)

```python
@app.post("/embed")
async def embed_text(request: EmbedRequest) -> EmbedResponse:
    embedding = model.encode(request.text, normalize_embeddings=True)
    return EmbedResponse(
        embedding=embedding.tolist(),
        dimensions=len(embedding),
        model=settings.embedding_model
    )
```

This endpoint is called by `search-service` for query embedding. Target latency: <20ms for a single short query (CPU inference on BGE-small).

#### Chunking Strategy

```python
def chunk_text(text: str, chunk_size: int = 512, overlap: int = 64) -> list[str]:
    """
    Split text into overlapping token windows.
    Uses tiktoken for accurate token counting.
    """
    tokens = tokenizer.encode(text)
    chunks = []
    start = 0
    while start < len(tokens):
        end = min(start + chunk_size, len(tokens))
        chunk_tokens = tokens[start:end]
        chunks.append(tokenizer.decode(chunk_tokens))
        if end == len(tokens):
            break
        start += chunk_size - overlap
    return chunks
```

Short texts (<512 tokens) produce a single chunk. Long texts produce multiple overlapping chunks, ensuring no context is lost at chunk boundaries.

### HTTP API Endpoints

| Method | Path                  | Description                              |
|--------|-----------------------|------------------------------------------|
| POST   | `/embed`              | Embed arbitrary text (sync, for queries) |
| POST   | `/embed/note/:noteId` | Trigger re-index of a specific note      |
| GET    | `/status`             | Health check + queue depth               |
| GET    | `/health`             | Liveness probe for Docker/k8s            |

---

## Consequences

### Positive

**Language best match:** Python is the natural language for ML model inference. The embedding service uses `sentence-transformers`, `torch`, `qdrant-client`, and `redis-py` — all first-class Python libraries with active maintenance and documentation. No awkward subprocess calls or language bridges.

**Independent scaling:** During a bulk import, the embedding service can be scaled horizontally (multiple instances, each in a different consumer group member) without affecting the TypeScript services. GPU-accelerated embedding (via CUDA or Apple Metal) can be added to the embedding service container without touching any other service.

**Isolated model lifecycle:** Upgrading the embedding model (e.g., from 384-dim to 1024-dim) requires: (1) update `EMBEDDING_MODEL` env var, (2) restart embedding-service, (3) run bulk re-index. The Qdrant collection dimension change requires recreating the collection — this is handled by a migration script in `apps/embedding-service/scripts/reindex.py`. No other service is affected.

**Workload isolation:** CPU-intensive batch embedding (during imports) is completely isolated from the latency-sensitive chat and note-saving paths. A large import does not degrade the user's experience in other parts of the application.

**Clear dependency graph:** `search-service` calls `embedding-service` for query embedding. `embedding-service` calls `vault-service` for note content. These are clean, unidirectional dependencies. There is no circular dependency.

**Reusable across services:** Any future service that needs embeddings (e.g., a recommendation engine, a duplicate note detector) can call the `/embed` HTTP endpoint without needing to know about the underlying model.

### Negative

**Network hop for query embedding:** When a user performs a search, `search-service` must call `embedding-service` over HTTP to embed the query before querying Qdrant. This adds ~5–15ms of network latency (within Docker network). In a monolith, this would be a local function call. For our latency budget (target <200ms total), this is acceptable.

**Additional container:** `embedding-service` is an additional Docker container to manage. It requires Python 3.12, a ~400MB base image (torch + sentence-transformers), and HuggingFace model cache volume management. This is the largest container in the stack by image size.

**Startup time:** The embedding service takes ~3–5 seconds to start (loading the model into memory) vs ~300ms for the TypeScript services. This affects cold start time in development and deployment. Mitigated by health check probes (other services wait for embedding-service to become healthy before sending requests).

**Python ecosystem in an otherwise TypeScript monorepo:** Most contributors to a TypeScript monorepo will be less familiar with Python tooling (`uv`, `pyproject.toml`, `uvicorn`, FastAPI). The embedding service is intentionally kept simple to minimize this cognitive load.

### Model Selection Rationale

`BAAI/bge-small-en-v1.5` was chosen for the default because:
- **384 dimensions** — small enough for fast Qdrant search, large enough for good representation quality
- **~130MB model size** — fast to download, fits comfortably in memory on any modern machine
- **Top MTEB benchmark scores** for its size class — excellent balance of quality vs cost
- **CPU-friendly** — can embed ~100 sentences/second on a modern CPU, no GPU required
- **HuggingFace Hub** — easily swappable for larger models (BGE-large, 1024-dim) or multilingual models (BGE-m3) via config change

To use a different model, set `EMBEDDING_MODEL` in `.env` and run `pnpm --filter embedding-service reindex` to rebuild all Qdrant collections with the new model's vectors.
