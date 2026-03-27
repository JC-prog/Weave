import postgres from 'postgres';

// ─── Environment ──────────────────────────────────────────────────────────────
const DATABASE_URL = process.env['DATABASE_URL'];

if (!DATABASE_URL) {
  throw new Error('DATABASE_URL environment variable is required');
}

// ─── Postgres Pool ────────────────────────────────────────────────────────────
// We use raw postgres queries for full-text search (tsvector / ts_rank)
// rather than Drizzle ORM since the FTS expressions are complex SQL constructs
// that are cleaner to express as tagged template literals.
export const pool = postgres(DATABASE_URL, {
  max: 10,
  idle_timeout: 20,
  connect_timeout: 10,
  onnotice: () => {
    // suppress notices
  },
});

// ─── Graceful shutdown ────────────────────────────────────────────────────────
export async function closePool(): Promise<void> {
  await pool.end();
}
