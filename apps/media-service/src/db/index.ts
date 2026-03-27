import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

// ─── Connection ───────────────────────────────────────────────────────────────
const DATABASE_URL = process.env['DATABASE_URL'];

if (!DATABASE_URL) {
  throw new Error('DATABASE_URL environment variable is required');
}

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

export { schema };

// ─── Graceful Shutdown ────────────────────────────────────────────────────────
export async function closeDb(): Promise<void> {
  await queryClient.end();
}

// ─── Schema Initialisation ────────────────────────────────────────────────────
/**
 * Create the media_svc schema and tables if they don't already exist.
 * Called once at startup before the server begins accepting requests.
 */
export async function initDb(): Promise<void> {
  await queryClient`CREATE SCHEMA IF NOT EXISTS media_svc`;
  await queryClient`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`;
  await queryClient`
    CREATE TABLE IF NOT EXISTS media_svc.assets (
      id              UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
      user_id         UUID        NOT NULL,
      vault_id        UUID,
      note_id         UUID,
      original_name   VARCHAR(500) NOT NULL,
      storage_key     VARCHAR(1000) NOT NULL,
      mime_type       VARCHAR(255) NOT NULL,
      size            BIGINT      NOT NULL,
      extracted_text  TEXT,
      thumbnail_key   VARCHAR(1000),
      metadata        JSONB       DEFAULT '{}',
      is_indexed      BOOLEAN     NOT NULL DEFAULT false,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
}
