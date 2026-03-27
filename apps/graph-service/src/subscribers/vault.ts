import Redis from 'ioredis';
import { graphManager } from '../graph/manager';

// ─── Constants ────────────────────────────────────────────────────────────────
const STREAM_KEY = 'vault:events';
const CONSUMER_GROUP = 'graph-service';
const CONSUMER_NAME = `graph-service-${process.pid}`;
const BLOCK_MS = 5000; // block for 5 s waiting for new messages
const BATCH_SIZE = 10;

// ─── Types ────────────────────────────────────────────────────────────────────
interface StreamMessage {
  id: string;
  fields: Record<string, string>;
}

// ─── Parse Redis Stream Entry ─────────────────────────────────────────────────
function parseStreamEntry(
  entry: [string, string[]],
): StreamMessage {
  const [id, fieldsArr] = entry;
  const fields: Record<string, string> = {};

  for (let i = 0; i < fieldsArr.length; i += 2) {
    const key = fieldsArr[i];
    const value = fieldsArr[i + 1];
    if (key !== undefined && value !== undefined) {
      fields[key] = value;
    }
  }

  return { id, fields };
}

// ─── Ensure Consumer Group ────────────────────────────────────────────────────
async function ensureConsumerGroup(redis: Redis): Promise<void> {
  try {
    // MKSTREAM creates the stream if it doesn't exist yet
    await redis.xgroup('CREATE', STREAM_KEY, CONSUMER_GROUP, '$', 'MKSTREAM');
    console.info(`[vault-subscriber] Created consumer group '${CONSUMER_GROUP}'`);
  } catch (err: unknown) {
    // Group already exists — this is expected on restart
    if (err instanceof Error && err.message.includes('BUSYGROUP')) {
      console.info(`[vault-subscriber] Consumer group '${CONSUMER_GROUP}' already exists`);
    } else {
      throw err;
    }
  }
}

// ─── Handle note.created ──────────────────────────────────────────────────────
function handleNoteCreated(fields: Record<string, string>): void {
  const { noteId, vaultId, title } = fields;

  if (!noteId || !vaultId || !title) {
    console.warn('[vault-subscriber] note.created missing required fields', fields);
    return;
  }

  graphManager.addNote({
    id: noteId,
    title,
    type: 'note',
    vaultId,
    updatedAt: fields['updatedAt'],
  });

  console.info(`[vault-subscriber] note.created: added node ${noteId} to vault ${vaultId}`);
}

// ─── Handle note.updated ──────────────────────────────────────────────────────
function handleNoteUpdated(fields: Record<string, string>): void {
  const { noteId, vaultId, title } = fields;

  if (!noteId || !vaultId || !title) {
    console.warn('[vault-subscriber] note.updated missing required fields', fields);
    return;
  }

  // Ensure node exists (add if it was somehow missing)
  graphManager.addNote({
    id: noteId,
    title,
    type: 'note',
    vaultId,
    updatedAt: fields['updatedAt'],
  });

  // Re-sync wikilink edges: remove all outbound edges first, then let
  // any future note.updated with wikilink data re-add them.
  // NOTE: Wikilink edge sync requires the resolved note IDs from vault-service.
  // The vault:events stream carries the raw wikilinks field as JSON.
  const rawWikilinks = fields['wikilinks'];
  if (rawWikilinks) {
    let wikilinkTargetIds: string[] = [];

    try {
      wikilinkTargetIds = JSON.parse(rawWikilinks) as string[];
    } catch {
      console.warn('[vault-subscriber] Failed to parse wikilinks field', rawWikilinks);
    }

    // Remove all old outbound edges
    graphManager.removeWikilinks(noteId, vaultId);

    // Re-add resolved edges
    for (const targetId of wikilinkTargetIds) {
      graphManager.addWikilink(noteId, targetId, vaultId);
    }
  }

  console.info(`[vault-subscriber] note.updated: updated node ${noteId} in vault ${vaultId}`);
}

// ─── Handle note.deleted ──────────────────────────────────────────────────────
function handleNoteDeleted(fields: Record<string, string>): void {
  const { noteId, vaultId } = fields;

  if (!noteId || !vaultId) {
    console.warn('[vault-subscriber] note.deleted missing required fields', fields);
    return;
  }

  graphManager.removeNote(noteId, vaultId);
  console.info(`[vault-subscriber] note.deleted: removed node ${noteId} from vault ${vaultId}`);
}

// ─── Dispatch Event ───────────────────────────────────────────────────────────
function dispatchEvent(message: StreamMessage): void {
  const eventType = message.fields['eventType'];

  switch (eventType) {
    case 'note.created':
      handleNoteCreated(message.fields);
      break;
    case 'note.updated':
      handleNoteUpdated(message.fields);
      break;
    case 'note.deleted':
      handleNoteDeleted(message.fields);
      break;
    default:
      console.warn(`[vault-subscriber] Unknown event type: ${eventType}`);
  }
}

// ─── Process Pending Messages ─────────────────────────────────────────────────
/**
 * On startup, reprocess any messages that were delivered but not acknowledged
 * in previous runs (PEL — Pending Entries List).
 */
async function processPendingMessages(redis: Redis): Promise<void> {
  let startId = '0-0';

  while (true) {
    const result = await redis.xreadgroup(
      'GROUP',
      CONSUMER_GROUP,
      CONSUMER_NAME,
      'COUNT',
      BATCH_SIZE,
      'STREAMS',
      STREAM_KEY,
      startId,
    ) as [string, [string, string[]][]][] | null;

    if (!result || result.length === 0) break;

    const [, entries] = result[0];
    if (!entries || entries.length === 0) break;

    for (const entry of entries) {
      const message = parseStreamEntry(entry);
      dispatchEvent(message);

      await redis.xack(STREAM_KEY, CONSUMER_GROUP, message.id);
    }

    // If we got fewer than BATCH_SIZE, we've caught up
    if (entries.length < BATCH_SIZE) break;

    // Advance the cursor past the last processed ID
    const lastId = entries[entries.length - 1]?.[0];
    if (lastId) startId = lastId;
  }
}

// ─── Main Subscriber Loop ─────────────────────────────────────────────────────
let running = false;

export async function startVaultSubscriber(redis: Redis): Promise<void> {
  if (running) return;
  running = true;

  await ensureConsumerGroup(redis);

  // Reprocess any unacknowledged messages from previous runs
  await processPendingMessages(redis);

  console.info('[vault-subscriber] Starting event loop...');

  // Run the XREADGROUP loop in the background
  void (async () => {
    while (running) {
      try {
        // BLOCK waits up to BLOCK_MS for new messages
        const result = await redis.xreadgroup(
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
        ) as [string, [string, string[]][]][] | null;

        if (!result || result.length === 0) continue;

        const [, entries] = result[0];
        if (!entries || entries.length === 0) continue;

        for (const entry of entries) {
          const message = parseStreamEntry(entry);

          try {
            dispatchEvent(message);
            // Acknowledge successful processing
            await redis.xack(STREAM_KEY, CONSUMER_GROUP, message.id);
          } catch (err) {
            console.error(
              `[vault-subscriber] Failed to process message ${message.id}:`,
              err,
            );
            // Do NOT ack — message stays in PEL for retry
          }
        }
      } catch (err) {
        if (!running) break;
        console.error('[vault-subscriber] XREADGROUP error:', err);
        // Brief pause before retry to avoid tight error loops
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }

    console.info('[vault-subscriber] Event loop stopped');
  })();
}

export function stopVaultSubscriber(): void {
  running = false;
}
