import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

// ─── Connection ───────────────────────────────────────────────────────────────
const DATABASE_URL = process.env['DATABASE_URL'];

if (!DATABASE_URL) {
  throw new Error('DATABASE_URL environment variable is required');
}

// Create a postgres connection pool
// max: 10 connections, idle_timeout: 20s, connect_timeout: 10s
const queryClient = postgres(DATABASE_URL, {
  max: 10,
  idle_timeout: 20,
  connect_timeout: 10,
  onnotice: () => {
    // suppress notices
  },
});

// ─── Drizzle Instance ─────────────────────────────────────────────────────────
export const db = drizzle(queryClient, {
  schema,
  logger: process.env['NODE_ENV'] === 'development',
});

// ─── Re-export schema for convenience ─────────────────────────────────────────
export { schema };

// ─── Graceful shutdown helper ─────────────────────────────────────────────────
export async function closeDb(): Promise<void> {
  await queryClient.end();
}
