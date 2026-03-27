import axios from 'axios';

// ─── Config ───────────────────────────────────────────────────────────────────
const QDRANT_URL = process.env['QDRANT_URL'] ?? 'http://qdrant:6333';
const NOTES_COLLECTION = 'notes';

// ─── Types ────────────────────────────────────────────────────────────────────
export interface SemanticResult {
  noteId: string;
  noteTitle: string;
  excerpt: string;
  score: number;
  matchType: 'semantic';
  chunkIndex: number;
}

interface QdrantScoredPoint {
  id: string | number;
  score: number;
  payload?: {
    noteId?: string;
    vaultId?: string;
    chunkIndex?: number;
    text?: string;
    title?: string;
  };
}

interface QdrantSearchResponse {
  result: QdrantScoredPoint[];
  status: string;
  time: number;
}

interface EmbeddingChunk {
  text: string;
  vector: number[];
  chunkIndex: number;
}

// ─── Semantic Search ──────────────────────────────────────────────────────────

/**
 * Search for semantically similar notes using Qdrant vector search.
 * Filters by vaultId payload field so results are scoped to the vault.
 */
export async function semanticSearch(
  queryVector: number[],
  vaultId: string,
  limit = 10,
): Promise<SemanticResult[]> {
  const response = await axios.post<QdrantSearchResponse>(
    `${QDRANT_URL}/collections/${NOTES_COLLECTION}/points/search`,
    {
      vector: queryVector,
      limit,
      with_payload: true,
      filter: {
        must: [
          {
            key: 'vaultId',
            match: { value: vaultId },
          },
        ],
      },
      score_threshold: 0.3,
    },
    {
      headers: { 'Content-Type': 'application/json' },
      timeout: 10_000,
    },
  );

  const points = response.data.result ?? [];

  // De-duplicate by noteId, keeping highest score per note
  const bestByNote = new Map<string, QdrantScoredPoint>();
  for (const point of points) {
    const noteId = point.payload?.noteId;
    if (!noteId) continue;
    const existing = bestByNote.get(noteId);
    if (!existing || point.score > existing.score) {
      bestByNote.set(noteId, point);
    }
  }

  return Array.from(bestByNote.values()).map((point) => ({
    noteId: point.payload?.noteId ?? String(point.id),
    noteTitle: point.payload?.title ?? '',
    excerpt: point.payload?.text ?? '',
    score: point.score,
    matchType: 'semantic' as const,
    chunkIndex: point.payload?.chunkIndex ?? 0,
  }));
}

/**
 * Upsert embeddings for a note's chunks into Qdrant.
 * Each chunk is stored as a separate point with metadata payload.
 */
export async function upsertEmbedding(
  noteId: string,
  vaultId: string,
  chunks: EmbeddingChunk[],
): Promise<void> {
  if (chunks.length === 0) return;

  const points = chunks.map((chunk) => ({
    // Use a deterministic string ID: noteId + chunkIndex
    id: `${noteId}_${chunk.chunkIndex}`,
    vector: chunk.vector,
    payload: {
      noteId,
      vaultId,
      chunkIndex: chunk.chunkIndex,
      text: chunk.text,
    },
  }));

  await axios.put(
    `${QDRANT_URL}/collections/${NOTES_COLLECTION}/points`,
    { points },
    {
      headers: { 'Content-Type': 'application/json' },
      timeout: 30_000,
    },
  );
}

/**
 * Delete all Qdrant points associated with a specific note.
 * Uses a payload filter on noteId.
 */
export async function deleteNoteEmbeddings(noteId: string): Promise<void> {
  await axios.post(
    `${QDRANT_URL}/collections/${NOTES_COLLECTION}/points/delete`,
    {
      filter: {
        must: [
          {
            key: 'noteId',
            match: { value: noteId },
          },
        ],
      },
    },
    {
      headers: { 'Content-Type': 'application/json' },
      timeout: 10_000,
    },
  );
}
