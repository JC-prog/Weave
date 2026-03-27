import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import axios from 'axios';
import { z } from 'zod';
import { searchFullText, type FullTextResult } from '../indexers/fulltext';
import { semanticSearch, type SemanticResult } from '../indexers/semantic';

// ─── Config ───────────────────────────────────────────────────────────────────
const EMBEDDING_SERVICE_URL =
  process.env['EMBEDDING_SERVICE_URL'] ?? 'http://embedding-service:3006';

// ─── Query Schema ─────────────────────────────────────────────────────────────
const SearchQuerySchema = z.object({
  q: z.string().min(1).max(500),
  vaultId: z.string().uuid(),
  mode: z.enum(['fulltext', 'semantic', 'hybrid']).default('hybrid'),
  limit: z.coerce.number().int().min(1).max(50).default(10),
});

// ─── Result Types ─────────────────────────────────────────────────────────────
export interface SearchResult {
  noteId: string;
  noteTitle: string;
  excerpt: string;
  score: number;
  matchType: 'fulltext' | 'semantic' | 'hybrid';
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Call the embedding-service to obtain a query vector for semantic search.
 */
async function embedQuery(query: string, authHeader: string | undefined): Promise<number[]> {
  const response = await axios.post<{ vector: number[] }>(
    `${EMBEDDING_SERVICE_URL}/embed/query`,
    { query },
    {
      headers: {
        'Content-Type': 'application/json',
        ...(authHeader ? { Authorization: authHeader } : {}),
      },
      timeout: 10_000,
    },
  );
  return response.data.vector;
}

/**
 * Merge full-text and semantic results, de-duplicate by noteId, and re-rank
 * using a reciprocal rank fusion (RRF) approach so both signals contribute.
 */
function mergeAndRerank(
  ftResults: FullTextResult[],
  semResults: SemanticResult[],
): SearchResult[] {
  const K = 60; // RRF constant

  const scores = new Map<
    string,
    {
      noteId: string;
      noteTitle: string;
      excerpt: string;
      rrfScore: number;
      matchTypes: Set<string>;
    }
  >();

  // Add reciprocal rank scores from full-text results
  ftResults.forEach((r, idx) => {
    const rrfScore = 1 / (K + idx + 1);
    const existing = scores.get(r.noteId);
    if (existing) {
      existing.rrfScore += rrfScore;
      existing.matchTypes.add('fulltext');
    } else {
      scores.set(r.noteId, {
        noteId: r.noteId,
        noteTitle: r.noteTitle,
        excerpt: r.excerpt,
        rrfScore,
        matchTypes: new Set(['fulltext']),
      });
    }
  });

  // Add reciprocal rank scores from semantic results
  semResults.forEach((r, idx) => {
    const rrfScore = 1 / (K + idx + 1);
    const existing = scores.get(r.noteId);
    if (existing) {
      existing.rrfScore += rrfScore;
      existing.matchTypes.add('semantic');
      // Prefer semantic excerpt when the note is in both result sets since
      // the semantic excerpt is the matching chunk text
      if (!existing.excerpt) existing.excerpt = r.excerpt;
    } else {
      scores.set(r.noteId, {
        noteId: r.noteId,
        noteTitle: r.noteTitle,
        excerpt: r.excerpt,
        rrfScore,
        matchTypes: new Set(['semantic']),
      });
    }
  });

  return Array.from(scores.values())
    .sort((a, b) => b.rrfScore - a.rrfScore)
    .map((entry) => {
      const types = Array.from(entry.matchTypes);
      const matchType: SearchResult['matchType'] =
        types.length > 1 ? 'hybrid' : (types[0] as 'fulltext' | 'semantic');
      return {
        noteId: entry.noteId,
        noteTitle: entry.noteTitle,
        excerpt: entry.excerpt,
        score: entry.rrfScore,
        matchType,
      };
    });
}

// ─── Plugin ───────────────────────────────────────────────────────────────────
const searchRoutes: FastifyPluginAsync = async (fastify: FastifyInstance) => {
  /**
   * GET /search
   * Query params: q, vaultId, mode, limit
   */
  fastify.get(
    '/search',
    {
      preHandler: [fastify.authenticate],
    },
    async (request, reply) => {
      const parseResult = SearchQuerySchema.safeParse(request.query);
      if (!parseResult.success) {
        return reply.status(400).send({
          statusCode: 400,
          error: 'Bad Request',
          message: parseResult.error.errors.map((e) => e.message).join('; '),
        });
      }

      const { q, vaultId, mode, limit } = parseResult.data;
      const authHeader = request.headers['authorization'];

      try {
        let results: SearchResult[] = [];

        if (mode === 'fulltext') {
          const ftResults = await searchFullText(q, vaultId, limit);
          results = ftResults.map((r) => ({ ...r, matchType: 'fulltext' as const }));
        } else if (mode === 'semantic') {
          const queryVector = await embedQuery(q, authHeader);
          const semResults = await semanticSearch(queryVector, vaultId, limit);
          results = semResults.map((r) => ({ ...r, matchType: 'semantic' as const }));
        } else {
          // hybrid: run both in parallel and merge
          const [ftResults, queryVector] = await Promise.all([
            searchFullText(q, vaultId, limit),
            embedQuery(q, authHeader),
          ]);
          const semResults = await semanticSearch(queryVector, vaultId, limit);
          const merged = mergeAndRerank(ftResults, semResults);
          results = merged.slice(0, limit);
        }

        return reply.status(200).send({
          results,
          total: results.length,
          query: q,
          vaultId,
          mode,
        });
      } catch (err) {
        const error = err as Error;
        fastify.log.error({ err }, 'Search failed');
        return reply.status(500).send({
          statusCode: 500,
          error: 'Internal Server Error',
          message: error.message ?? 'Search failed',
        });
      }
    },
  );
};

export default searchRoutes;
