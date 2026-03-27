import { pool } from '../db';

// ─── Types ────────────────────────────────────────────────────────────────────
export interface FullTextResult {
  noteId: string;
  noteTitle: string;
  excerpt: string;
  score: number;
  matchType: 'fulltext';
}

// ─── Full-Text Search ─────────────────────────────────────────────────────────

/**
 * Search notes in the vault schema using PostgreSQL full-text search.
 * Uses tsvector built on-the-fly from title + content, ranked with ts_rank_cd.
 * Returns up to `limit` results sorted by rank descending.
 */
export async function searchFullText(
  query: string,
  vaultId: string,
  limit = 10,
): Promise<FullTextResult[]> {
  if (!query.trim()) return [];

  // Sanitize query: replace special tsquery chars and build a websearch-style query
  // using plainto_tsquery which handles arbitrary user input safely
  const rows = await pool<
    {
      note_id: string;
      note_title: string;
      excerpt: string;
      score: number;
    }[]
  >`
    SELECT
      n.id                                                          AS note_id,
      n.title                                                       AS note_title,
      ts_headline(
        'english',
        n.content,
        plainto_tsquery('english', ${query}),
        'StartSel=<mark>, StopSel=</mark>, MaxWords=35, MinWords=15, ShortWord=3, HighlightAll=false, MaxFragments=2, FragmentDelimiter=" ... "'
      )                                                             AS excerpt,
      ts_rank_cd(
        to_tsvector('english', coalesce(n.title, '') || ' ' || coalesce(n.content, '')),
        plainto_tsquery('english', ${query}),
        32 /* normalize by document length */
      )                                                             AS score
    FROM vault.notes n
    WHERE
      n.vault_id = ${vaultId}::uuid
      AND to_tsvector('english', coalesce(n.title, '') || ' ' || coalesce(n.content, ''))
          @@ plainto_tsquery('english', ${query})
    ORDER BY score DESC
    LIMIT ${limit}
  `;

  return rows.map((r) => ({
    noteId: r.note_id,
    noteTitle: r.note_title,
    excerpt: r.excerpt ?? '',
    score: Number(r.score),
    matchType: 'fulltext' as const,
  }));
}

/**
 * Extract a relevant plain-text snippet from `content` matching `query`.
 * Falls back to the first 200 characters if no match is found.
 */
export async function getSnippet(content: string, query: string): Promise<string> {
  if (!content || !query.trim()) {
    return content.slice(0, 200);
  }

  const rows = await pool<{ snippet: string }[]>`
    SELECT ts_headline(
      'english',
      ${content},
      plainto_tsquery('english', ${query}),
      'StartSel=<mark>, StopSel=</mark>, MaxWords=30, MinWords=10, ShortWord=3, HighlightAll=false, MaxFragments=1'
    ) AS snippet
  `;

  return rows[0]?.snippet ?? content.slice(0, 200);
}
