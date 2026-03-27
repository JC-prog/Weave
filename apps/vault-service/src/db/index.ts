import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

// ─── Connection ───────────────────────────────────────────────────────────────
const connectionString =
  process.env['DATABASE_URL'] ??
  'postgres://postgres:postgres@localhost:5432/notebooklm';

const queryClient = postgres(connectionString, {
  max: 10,
  idle_timeout: 30,
  connect_timeout: 10,
  onnotice: () => {
    // suppress notices
  },
});

// ─── Drizzle Instance ─────────────────────────────────────────────────────────
export const db = drizzle(queryClient, { schema });

export type DB = typeof db;

export * from './schema';
