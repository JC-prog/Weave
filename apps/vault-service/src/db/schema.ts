import { sql, relations } from 'drizzle-orm';
import {
  pgSchema,
  uuid,
  varchar,
  text,
  boolean,
  integer,
  jsonb,
  timestamp,
  primaryKey,
} from 'drizzle-orm/pg-core';

// ─── Vault Schema ─────────────────────────────────────────────────────────────
export const vaultSchema = pgSchema('vault');

// ─── Vaults ───────────────────────────────────────────────────────────────────
export const vaults = vaultSchema.table('vaults', {
  id: uuid('id')
    .primaryKey()
    .default(sql`uuid_generate_v4()`),
  userId: uuid('user_id').notNull(),
  name: varchar('name', { length: 255 }).notNull(),
  description: text('description'),
  isDefault: boolean('is_default').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// ─── Folders ──────────────────────────────────────────────────────────────────
export const folders = vaultSchema.table('folders', {
  id: uuid('id')
    .primaryKey()
    .default(sql`uuid_generate_v4()`),
  vaultId: uuid('vault_id')
    .notNull()
    .references(() => vaults.id, { onDelete: 'cascade' }),
  parentId: uuid('parent_id'),
  name: varchar('name', { length: 255 }).notNull(),
  path: text('path').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// ─── Notes ────────────────────────────────────────────────────────────────────
export const notes = vaultSchema.table('notes', {
  id: uuid('id')
    .primaryKey()
    .default(sql`uuid_generate_v4()`),
  vaultId: uuid('vault_id')
    .notNull()
    .references(() => vaults.id, { onDelete: 'cascade' }),
  folderId: uuid('folder_id').references(() => folders.id, {
    onDelete: 'set null',
  }),
  title: varchar('title', { length: 500 }).notNull(),
  content: text('content').notNull().default(''),
  frontmatter: jsonb('frontmatter').notNull().default({}),
  slug: varchar('slug', { length: 600 }).notNull(),
  wordCount: integer('word_count').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// ─── Tags ─────────────────────────────────────────────────────────────────────
export const tags = vaultSchema.table('tags', {
  id: uuid('id')
    .primaryKey()
    .default(sql`uuid_generate_v4()`),
  vaultId: uuid('vault_id')
    .notNull()
    .references(() => vaults.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 100 }).notNull(),
  color: varchar('color', { length: 7 }).notNull().default('#6366f1'),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// ─── Note Tags (join table) ───────────────────────────────────────────────────
export const noteTags = vaultSchema.table(
  'note_tags',
  {
    noteId: uuid('note_id')
      .notNull()
      .references(() => notes.id, { onDelete: 'cascade' }),
    tagId: uuid('tag_id')
      .notNull()
      .references(() => tags.id, { onDelete: 'cascade' }),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.noteId, table.tagId] }),
  }),
);

// ─── Wikilinks ────────────────────────────────────────────────────────────────
export const wikilinks = vaultSchema.table('wikilinks', {
  id: uuid('id')
    .primaryKey()
    .default(sql`uuid_generate_v4()`),
  sourceNoteId: uuid('source_note_id')
    .notNull()
    .references(() => notes.id, { onDelete: 'cascade' }),
  targetTitle: varchar('target_title', { length: 500 }).notNull(),
  targetNoteId: uuid('target_note_id').references(() => notes.id, {
    onDelete: 'set null',
  }),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// ─── Relations ────────────────────────────────────────────────────────────────
export const vaultsRelations = relations(vaults, ({ many }) => ({
  folders: many(folders),
  notes: many(notes),
  tags: many(tags),
}));

export const foldersRelations = relations(folders, ({ one, many }) => ({
  vault: one(vaults, {
    fields: [folders.vaultId],
    references: [vaults.id],
  }),
  notes: many(notes),
}));

export const notesRelations = relations(notes, ({ one, many }) => ({
  vault: one(vaults, {
    fields: [notes.vaultId],
    references: [vaults.id],
  }),
  folder: one(folders, {
    fields: [notes.folderId],
    references: [folders.id],
  }),
  noteTags: many(noteTags),
  outboundWikilinks: many(wikilinks, { relationName: 'sourceNote' }),
  inboundWikilinks: many(wikilinks, { relationName: 'targetNote' }),
}));

export const tagsRelations = relations(tags, ({ one, many }) => ({
  vault: one(vaults, {
    fields: [tags.vaultId],
    references: [vaults.id],
  }),
  noteTags: many(noteTags),
}));

export const noteTagsRelations = relations(noteTags, ({ one }) => ({
  note: one(notes, {
    fields: [noteTags.noteId],
    references: [notes.id],
  }),
  tag: one(tags, {
    fields: [noteTags.tagId],
    references: [tags.id],
  }),
}));

export const wikilinksRelations = relations(wikilinks, ({ one }) => ({
  sourceNote: one(notes, {
    fields: [wikilinks.sourceNoteId],
    references: [notes.id],
    relationName: 'sourceNote',
  }),
  targetNote: one(notes, {
    fields: [wikilinks.targetNoteId],
    references: [notes.id],
    relationName: 'targetNote',
  }),
}));

// ─── Inferred Types ───────────────────────────────────────────────────────────
export type Vault = typeof vaults.$inferSelect;
export type NewVault = typeof vaults.$inferInsert;
export type Folder = typeof folders.$inferSelect;
export type NewFolder = typeof folders.$inferInsert;
export type Note = typeof notes.$inferSelect;
export type NewNote = typeof notes.$inferInsert;
export type Tag = typeof tags.$inferSelect;
export type NewTag = typeof tags.$inferInsert;
export type NoteTag = typeof noteTags.$inferSelect;
export type NewNoteTag = typeof noteTags.$inferInsert;
export type Wikilink = typeof wikilinks.$inferSelect;
export type NewWikilink = typeof wikilinks.$inferInsert;
