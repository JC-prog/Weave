import IORedis from 'ioredis';
import { deleteNoteEmbeddings } from '../indexers/semantic';

// ─── Config ───────────────────────────────────────────────────────────────────
const REDIS_URL = process.env['REDIS_URL'] ?? 'redis://redis:6379';
const STREAM_KEY = 'vault:events';
const CONSUMER_GROUP = 'search-service';
const CONSUMER_NAME = `search-service-${process.pid}`;
const BLOCK_MS = 5_000;
const BATCH_SIZE = 10;

// ─── Types ────────────────────────────────────────────────────────────────────
interface VaultEvent {
  type: string;
  noteId?: string;
  vaultId?: string;
  title?: string;
  content?: string;
}

// ─── Vault Events Subscriber ──────────────────────────────────────────────────
export class VaultEventSubscriber {
  private readonly redis: IORedis;
  private running = false;

  constructor() {
    this.redis = new IORedis(REDIS_URL, {
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
    });
  }

  /**
   * Ensure consumer group exists, creating it if it doesn't.
   * Start reading from the last delivered ID ('$') on first run so we don't
   * replay historical events, or from '0' to process pending messages.
   */
  private async ensureConsumerGroup(): Promise<void> {
    try {
      await this.redis.xgroup('CREATE', STREAM_KEY, CONSUMER_GROUP, '$', 'MKSTREAM');
    } catch (err) {
      const error = err as Error;
      // BUSYGROUP means the group already exists — that's fine
      if (!error.message.includes('BUSYGROUP')) {
        throw error;
      }
    }
  }

  /**
   * Parse raw Redis stream entry fields into a structured VaultEvent.
   */
  private parseFields(fields: string[]): VaultEvent {
    const obj: Record<string, string> = {};
    for (let i = 0; i < fields.length; i += 2) {
      obj[fields[i] as string] = fields[i + 1] as string;
    }

    return {
      type: obj['type'] ?? '',
      noteId: obj['noteId'],
      vaultId: obj['vaultId'],
      title: obj['title'],
      content: obj['content'],
    };
  }

  /**
   * Handle a single vault event.
   *
   * - note.created  → FTS is driven by PostgreSQL tsvector directly on the
   *   vault.notes table; the data is already there so no explicit re-index is
   *   needed. We just log the event and could bust any search result cache here.
   * - note.updated  → Same as above; tsvector will be current on next search.
   * - note.deleted  → Remove all Qdrant embeddings for the deleted note so
   *   semantic search results stay consistent.
   */
  private async handleEvent(event: VaultEvent): Promise<void> {
    switch (event.type) {
      case 'note.created':
      case 'note.updated':
        // Full-text search reads directly from PostgreSQL vault.notes, so the
        // index is always up to date with no extra action required here.
        // If a Redis search-result cache existed we would invalidate it now.
        console.info(
          `[vault-subscriber] ${event.type} noteId=${event.noteId} vaultId=${event.vaultId} — FTS index is live via tsvector`,
        );
        break;

      case 'note.deleted':
        if (event.noteId) {
          console.info(
            `[vault-subscriber] note.deleted noteId=${event.noteId} — removing Qdrant embeddings`,
          );
          await deleteNoteEmbeddings(event.noteId);
        }
        break;

      default:
        // Unrecognised event types are silently ignored
        break;
    }
  }

  /**
   * Main consumer loop. Reads from the Redis Stream using XREADGROUP and
   * acknowledges each message after processing.
   */
  async start(): Promise<void> {
    await this.ensureConsumerGroup();
    this.running = true;

    console.info(
      `[vault-subscriber] Starting consumer group="${CONSUMER_GROUP}" consumer="${CONSUMER_NAME}"`,
    );

    // First pass: re-process any pending (unacknowledged) messages from a
    // previous crash by reading from ID '0'.
    await this.processPending();

    while (this.running) {
      try {
        // XREADGROUP GROUP <group> <consumer> COUNT <n> BLOCK <ms> STREAMS <key> >
        const results = await this.redis.xreadgroup(
          'GROUP',
          CONSUMER_GROUP,
          CONSUMER_NAME,
          'COUNT',
          BATCH_SIZE,
          'BLOCK',
          BLOCK_MS,
          'STREAMS',
          STREAM_KEY,
          '>',
        );

        if (!results) continue; // timeout, loop again

        for (const [, entries] of results as [string, [string, string[]][]][]) {
          for (const [id, fields] of entries) {
            try {
              const event = this.parseFields(fields);
              await this.handleEvent(event);
              await this.redis.xack(STREAM_KEY, CONSUMER_GROUP, id);
            } catch (err) {
              console.error(`[vault-subscriber] Failed to process message id=${id}`, err);
              // Leave unacknowledged so it can be reprocessed or claimed by another consumer
            }
          }
        }
      } catch (err) {
        if (!this.running) break;
        console.error('[vault-subscriber] Consumer loop error', err);
        // Brief pause before retrying to avoid tight error loops
        await new Promise((r) => setTimeout(r, 2_000));
      }
    }
  }

  /**
   * Re-process pending messages (unacked from previous consumer runs).
   */
  private async processPending(): Promise<void> {
    let lastId = '0';

    while (true) {
      const results = await this.redis.xreadgroup(
        'GROUP',
        CONSUMER_GROUP,
        CONSUMER_NAME,
        'COUNT',
        BATCH_SIZE,
        'STREAMS',
        STREAM_KEY,
        lastId,
      );

      if (!results) break;

      let hasEntries = false;
      for (const [, entries] of results as [string, [string, string[]][]][]) {
        for (const [id, fields] of entries) {
          hasEntries = true;
          try {
            const event = this.parseFields(fields);
            await this.handleEvent(event);
            await this.redis.xack(STREAM_KEY, CONSUMER_GROUP, id);
            lastId = id;
          } catch (err) {
            console.error(`[vault-subscriber] Failed to process pending message id=${id}`, err);
          }
        }
      }

      if (!hasEntries) break;
    }
  }

  async stop(): Promise<void> {
    this.running = false;
    await this.redis.quit();
  }
}
