import Redis from 'ioredis';
import type { Note } from '../db/schema';

// ─── Stream Name ──────────────────────────────────────────────────────────────
const VAULT_EVENTS_STREAM = 'vault:events';

// ─── Redis Client (module-level singleton) ────────────────────────────────────
let redis: Redis | null = null;

// ─── initPublisher ────────────────────────────────────────────────────────────
/**
 * Initialises and connects the Redis publisher client.
 * Must be called before any publish* function.
 */
export async function initPublisher(): Promise<Redis> {
  if (redis) return redis;

  const host = process.env['REDIS_HOST'] ?? 'localhost';
  const port = parseInt(process.env['REDIS_PORT'] ?? '6379', 10);
  const password = process.env['REDIS_PASSWORD'];

  redis = new Redis({
    host,
    port,
    password: password ?? undefined,
    maxRetriesPerRequest: 3,
    retryStrategy: (times) => {
      if (times > 10) return null;
      return Math.min(times * 100, 3000);
    },
    lazyConnect: false,
  });

  redis.on('error', (err) => {
    console.error('[vault-publisher] Redis error:', err);
  });

  redis.on('connect', () => {
    console.info('[vault-publisher] Connected to Redis');
  });

  await redis.ping();
  return redis;
}

// ─── getRedis ─────────────────────────────────────────────────────────────────
function getRedis(): Redis {
  if (!redis) {
    throw new Error(
      'Redis publisher not initialised. Call initPublisher() first.',
    );
  }
  return redis;
}

// ─── Payload Helpers ─────────────────────────────────────────────────────────
/**
 * Converts a plain object to a flat string array suitable for XADD fields.
 * Values are JSON-serialised so complex objects survive the round-trip.
 */
function toStreamFields(payload: Record<string, unknown>): string[] {
  const fields: string[] = [];
  for (const [key, value] of Object.entries(payload)) {
    fields.push(key, typeof value === 'string' ? value : JSON.stringify(value));
  }
  return fields;
}

// ─── publishNoteCreated ───────────────────────────────────────────────────────
/**
 * Publishes a note.created event to the vault:events Redis Stream.
 */
export async function publishNoteCreated(note: Note): Promise<void> {
  const client = getRedis();

  await client.xadd(
    VAULT_EVENTS_STREAM,
    '*',
    ...toStreamFields({
      eventType: 'note.created',
      noteId: note.id,
      vaultId: note.vaultId,
      title: note.title,
      slug: note.slug,
      folderId: note.folderId ?? '',
      wordCount: String(note.wordCount),
      createdAt: note.createdAt.toISOString(),
      updatedAt: note.updatedAt.toISOString(),
    }),
  );
}

// ─── publishNoteUpdated ───────────────────────────────────────────────────────
/**
 * Publishes a note.updated event to the vault:events Redis Stream.
 * Optionally includes a snippet of the previous content for diffing.
 */
export async function publishNoteUpdated(
  note: Note,
  previousContent?: string,
): Promise<void> {
  const client = getRedis();

  await client.xadd(
    VAULT_EVENTS_STREAM,
    '*',
    ...toStreamFields({
      eventType: 'note.updated',
      noteId: note.id,
      vaultId: note.vaultId,
      title: note.title,
      slug: note.slug,
      folderId: note.folderId ?? '',
      wordCount: String(note.wordCount),
      previousContentSnippet: previousContent
        ? previousContent.slice(0, 500)
        : '',
      updatedAt: note.updatedAt.toISOString(),
    }),
  );
}

// ─── publishNoteDeleted ───────────────────────────────────────────────────────
/**
 * Publishes a note.deleted event to the vault:events Redis Stream.
 */
export async function publishNoteDeleted(
  noteId: string,
  vaultId: string,
): Promise<void> {
  const client = getRedis();

  await client.xadd(
    VAULT_EVENTS_STREAM,
    '*',
    ...toStreamFields({
      eventType: 'note.deleted',
      noteId,
      vaultId,
      deletedAt: new Date().toISOString(),
    }),
  );
}

// ─── closePublisher ───────────────────────────────────────────────────────────
export async function closePublisher(): Promise<void> {
  if (redis) {
    await redis.quit();
    redis = null;
  }
}
