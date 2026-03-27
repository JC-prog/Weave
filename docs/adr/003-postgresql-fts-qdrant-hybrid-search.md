# ADR 003 — Hybrid Search with PostgreSQL FTS + Qdrant

**Status:** Accepted
**Date:** 2026-03-27
**Author:** Engineering Team

---

## Context

Users need to find notes efficiently. Two fundamentally different search paradigms exist, each with distinct strengths and weaknesses:

**Full-text search (keyword):** Matches documents containing the literal query terms. Excellent for recall when the user knows the exact word or phrase they wrote. Poor for conceptual queries where the user doesn't remember the exact wording.

- Example where it excels: searching `"XAUTOCLAIM Redis"` finds exactly the notes where those words appear
- Example where it fails: searching `"how does the message queue handle failures"` may miss a note titled "Redis PEL and redelivery" that answers the question perfectly but uses different vocabulary

**Semantic search (vector similarity):** Matches documents by conceptual similarity, regardless of exact vocabulary. Excellent for exploratory queries and when the user describes a concept rather than recalling exact keywords.

- Example where it excels: `"how does the message queue handle failures"` → high similarity to "Redis PEL and redelivery" even with zero word overlap
- Example where it fails: exact code identifiers, proper nouns, and very specific technical terms that need exact matches

Neither approach alone is sufficient for a knowledge management tool. Users switch between both modes naturally: sometimes they remember the exact phrase they wrote, sometimes they only remember the concept.

### Requirements

1. **Keyword precision:** Exact term matches should rank highly, with stemming support (English)
2. **Semantic recall:** Conceptually relevant notes should surface even without exact word matches
3. **Unified result set:** Users should see a single ranked list, not two separate result lists
4. **Filtering:** Results must be filterable by vault, folder, and tags
5. **Performance:** Search results should return in under 200ms for typical note collections (<10,000 notes)
6. **Low operational overhead:** Prefer solutions using infrastructure already in the stack

### Alternatives Considered

**Option A: PostgreSQL FTS only**
PostgreSQL has excellent built-in full-text search via `tsvector` and `tsquery`. Supports stemming, ranking (`ts_rank`), and phrase search. No additional infrastructure needed.
- Drawback: no semantic/conceptual search. Users must remember exact keywords.

**Option B: Qdrant only (semantic search)**
Use only vector similarity search. Store all note chunks in Qdrant.
- Drawback: poor precision for exact keyword queries. Searching for a specific code snippet, person's name, or technical identifier works poorly with semantic search alone.

**Option C: Elasticsearch / OpenSearch**
Provides both BM25 keyword search and (with a plugin) vector search. Industry standard for large-scale search.
- Drawback: significant additional infrastructure (JVM-based, high memory requirements ~2GB minimum). Operational complexity. For a personal knowledge base, this is substantial over-engineering.

**Option D: SQLite FTS5 + pgvector**
SQLite FTS5 for full-text, pgvector extension for embedding storage in PostgreSQL.
- pgvector does support approximate nearest neighbor search (HNSW/IVFFlat), but is less purpose-built for vector search than Qdrant. Qdrant's filtered search (combining vector search + payload filters) is more performant and feature-rich.

**Option E: Hybrid PostgreSQL FTS + Qdrant (selected)**
Use each system for what it is best at, then merge results using Reciprocal Rank Fusion (RRF).

---

## Decision

We implement **hybrid search** combining:

1. **PostgreSQL `tsvector`** for full-text keyword search
2. **Qdrant** for semantic vector search
3. **Reciprocal Rank Fusion (RRF)** to merge ranked result lists into a single unified ranking

### Full-Text Search Implementation

Each note in the `vault.notes` table has a `fts_vector tsvector` column maintained by a PostgreSQL trigger:

```sql
CREATE TRIGGER notes_fts_update
BEFORE INSERT OR UPDATE ON vault.notes
FOR EACH ROW EXECUTE FUNCTION
  tsvector_update_trigger(fts_vector, 'pg_catalog.english', title, content);

CREATE INDEX notes_fts_idx ON vault.notes USING GIN (fts_vector);
```

Query:
```sql
SELECT id, title,
       ts_rank(fts_vector, query) AS rank,
       ts_headline('english', content, query) AS excerpt
FROM vault.notes, to_tsquery('english', $1) query
WHERE fts_vector @@ query
  AND vault_id = $2
ORDER BY rank DESC
LIMIT 20;
```

The `ts_headline` function generates an excerpt with matched terms highlighted.

### Semantic Search Implementation

Note content is chunked into 512-token overlapping windows and stored as vectors in Qdrant. Each chunk is a point in a per-vault collection:

```
Collection name: vault_{vaultId}
Vector size: 384 (BAAI/bge-small-en-v1.5)
Distance: Cosine
Index: HNSW (ef_construction=128, m=16)
```

Query embedding: The search query is embedded using the same model via the embedding service's `/embed` endpoint.

Qdrant query uses filtered search to restrict results to the correct vault and optional tag/folder filters:

```python
results = qdrant_client.search(
    collection_name=f"vault_{vault_id}",
    query_vector=query_embedding,
    limit=20,
    query_filter=Filter(
        must=[
            FieldCondition(key="tags", match=MatchAny(any=tag_filter))
        ]
    )
)
```

### Reciprocal Rank Fusion (RRF)

RRF is a simple, parameter-free method for combining ranked lists. For each result, the RRF score is:

```
RRF(d) = Σ 1 / (k + rank(d, list_i))
```

Where `k=60` is a smoothing constant (standard default) and `rank(d, list_i)` is the position of document `d` in ranked list `i`. Documents not in a list are assigned `rank = ∞` (contributing 0).

This has desirable properties: it rewards documents that appear near the top of either list, and combining two lists gives better results than either alone — without needing to tune weights between systems.

```typescript
function reciprocalRankFusion(
  fulltextResults: SearchResult[],
  semanticResults: SearchResult[],
  k = 60
): SearchResult[] {
  const scores = new Map<string, number>()

  fulltextResults.forEach((r, i) => {
    scores.set(r.noteId, (scores.get(r.noteId) ?? 0) + 1 / (k + i + 1))
  })
  semanticResults.forEach((r, i) => {
    scores.set(r.noteId, (scores.get(r.noteId) ?? 0) + 1 / (k + i + 1))
  })

  return Array.from(scores.entries())
    .sort(([, a], [, b]) => b - a)
    .map(([noteId, score]) => ({ noteId, score }))
}
```

### Search Modes

The search API supports three modes:

| Mode        | Description                              | When to use                              |
|-------------|------------------------------------------|------------------------------------------|
| `hybrid`    | RRF merge of fulltext + semantic (default)| Most searches                           |
| `fulltext`  | PostgreSQL FTS only                      | Exact term lookup, code search           |
| `semantic`  | Qdrant only                              | Conceptual / exploratory queries         |

---

## Consequences

### Positive

**Best of both worlds:** Users get keyword precision (finding the exact phrase they wrote) and semantic recall (finding conceptually related notes without remembering exact words). In user testing, hybrid search consistently outperforms either approach alone.

**No new technology for full-text:** PostgreSQL FTS is already in the stack and handles English stemming, stop words, and phrase search natively. The `GIN` index makes it fast even for large note collections.

**Qdrant is purpose-built:** Qdrant provides filtered approximate nearest neighbor search with better performance than pgvector for collections >100K vectors. Its payload filtering allows combining vector similarity with metadata filters (tags, folder, date range) efficiently.

**RRF is robust:** RRF requires no tuning parameters (unlike weighted fusion which requires calibration) and is known to outperform individual ranking functions across domains. It handles the case where a document appears in only one result list gracefully.

**Query-time embedding is fast:** The BGE-small model embeds a short query in ~10ms on CPU. Combined with PostgreSQL FTS (~15ms) and Qdrant search (~20ms, run in parallel), total latency is ~50ms + network overhead, well within our 200ms target.

### Negative

**Two systems to maintain:** Qdrant is an additional infrastructure service. Its collection state must be kept in sync with the vault (handled by the embedding-service Redis Stream consumer). If Qdrant data is lost, a re-index operation is required.

**Eventual consistency of semantic index:** After a note is saved, the embedding-service processes the Redis Stream event asynchronously. There is typically a 100–500ms delay before the new note appears in semantic search results. Full-text search (via the PostgreSQL trigger) is synchronous and available immediately after save.

**Cold start for new vault collections:** On vault creation, the Qdrant collection must be created explicitly. This is handled by the embedding-service on the first `note.created` event for a vault.

**Chunking strategy affects quality:** The choice of chunk size (512 tokens, 64-token overlap) is a trade-off. Larger chunks provide more context per chunk but reduce retrieval precision. Smaller chunks are more precise but may lack context for the LLM. This value was chosen based on published best practices for RAG pipelines and is configurable.

### Upgrade Path

- **Re-ranking:** For higher quality, a cross-encoder re-ranker (e.g., `ms-marco-MiniLM`) can be added as a post-processing step after RRF to re-score the top-k candidates. This adds ~50ms latency but significantly improves relevance.
- **Scale:** For very large vaults (>1M notes), Qdrant supports distributed mode. PostgreSQL FTS can be supplemented with Postgres partitioning.
- **Model upgrade:** The embedding model can be swapped by changing `EMBEDDING_MODEL` and running a full re-index (`POST /api/embed/note/:noteId` in bulk). The model is only used at embedding time; the vectors are stored in Qdrant agnostically.
