import { sql } from 'drizzle-orm';
import {
  pgSchema,
  uuid,
  varchar,
  text,
  integer,
  bigint,
  boolean,
  jsonb,
  timestamp,
} from 'drizzle-orm/pg-core';

// ─── Media Schema ─────────────────────────────────────────────────────────────
export const mediaSchema = pgSchema('media_svc');

// ─── Assets ───────────────────────────────────────────────────────────────────
export const assets = mediaSchema.table('assets', {
  id: uuid('id')
    .primaryKey()
    .default(sql`uuid_generate_v4()`),

  /** The user who uploaded this asset */
  userId: uuid('user_id').notNull(),

  /** Vault this asset belongs to (optional; assets can be vault-agnostic) */
  vaultId: uuid('vault_id'),

  /** Note this asset is attached to (optional) */
  noteId: uuid('note_id'),

  /** Original file name provided by the uploader */
  originalName: varchar('original_name', { length: 500 }).notNull(),

  /** MinIO object key (path within the bucket) */
  storageKey: varchar('storage_key', { length: 1000 }).notNull(),

  /** MIME type of the uploaded file */
  mimeType: varchar('mime_type', { length: 255 }).notNull(),

  /** File size in bytes */
  size: bigint('size', { mode: 'number' }).notNull(),

  /** Extracted plain text (for PDFs and text files; null otherwise) */
  extractedText: text('extracted_text'),

  /** MinIO key for the generated thumbnail image (images only) */
  thumbnailKey: varchar('thumbnail_key', { length: 1000 }),

  /** Structured metadata extracted from the file (JSON) */
  metadata: jsonb('metadata').default({}),

  /** Whether the extracted text has been sent to the embedding pipeline */
  isIndexed: boolean('is_indexed').notNull().default(false),

  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// ─── Inferred Types ───────────────────────────────────────────────────────────
export type Asset = typeof assets.$inferSelect;
export type NewAsset = typeof assets.$inferInsert;
