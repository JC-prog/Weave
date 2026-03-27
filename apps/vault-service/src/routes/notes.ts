import { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { eq, and, sql, inArray } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import { db, notes, vaults, folders, tags, noteTags, wikilinks } from '../db';
import { parseMarkdown, extractTitle, slugify } from '../parsers/markdown';
import { extractWikilinks } from '../parsers/wikilinks';
import {
  publishNoteCreated,
  publishNoteUpdated,
  publishNoteDeleted,
} from '../events/publisher';

// ─── Schemas ──────────────────────────────────────────────────────────────────
const VaultNoteParams = z.object({
  vaultId: z.string().uuid(),
});

const NoteParams = z.object({
  vaultId: z.string().uuid(),
  id: z.string().uuid(),
});

const CreateNoteBody = z.object({
  title: z.string().min(1).max(500).optional(),
  content: z.string().default(''),
  folderId: z.string().uuid().nullable().optional(),
});

const UpdateNoteBody = z.object({
  title: z.string().min(1).max(500).optional(),
  content: z.string().optional(),
  folderId: z.string().uuid().nullable().optional(),
});

const ListNotesQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  tagId: z.string().uuid().optional(),
  folderId: z.string().uuid().optional(),
});

// ─── Helpers ──────────────────────────────────────────────────────────────────
async function assertVaultOwnership(
  vaultId: string,
  userId: string,
): Promise<boolean> {
  const [vault] = await db
    .select({ id: vaults.id })
    .from(vaults)
    .where(and(eq(vaults.id, vaultId), eq(vaults.userId, userId)));
  return !!vault;
}

async function syncWikilinks(
  noteId: string,
  vaultId: string,
  content: string,
): Promise<void> {
  // Remove old wikilinks from this source note
  await db.delete(wikilinks).where(eq(wikilinks.sourceNoteId, noteId));

  const titles = extractWikilinks(content);
  if (titles.length === 0) return;

  // Resolve each title to an existing note in the vault
  const allVaultNotes = await db
    .select({ id: notes.id, title: notes.title, slug: notes.slug })
    .from(notes)
    .where(eq(notes.vaultId, vaultId));

  const titleToNoteId = new Map(
    allVaultNotes.map((n) => [n.title.toLowerCase(), n.id]),
  );

  const rows = titles.map((title) => ({
    id: uuidv4(),
    sourceNoteId: noteId,
    targetTitle: title,
    targetNoteId: titleToNoteId.get(title.toLowerCase()) ?? null,
    createdAt: new Date(),
  }));

  if (rows.length > 0) {
    await db.insert(wikilinks).values(rows);
  }
}

async function ensureUniqueSlug(
  baseSlug: string,
  vaultId: string,
  excludeNoteId?: string,
): Promise<string> {
  let slug = baseSlug;
  let counter = 0;

  while (true) {
    const existing = await db
      .select({ id: notes.id })
      .from(notes)
      .where(and(eq(notes.vaultId, vaultId), eq(notes.slug, slug)));

    const conflict = existing.find((n) => n.id !== excludeNoteId);
    if (!conflict) return slug;

    counter++;
    slug = `${baseSlug}-${counter}`;
  }
}

// ─── Plugin ───────────────────────────────────────────────────────────────────
export const notesRoutes: FastifyPluginAsync = async (fastify) => {
  // ── POST /vaults/:vaultId/notes ──────────────────────────────────────────────
  fastify.post<{ Params: { vaultId: string } }>(
    '/vaults/:vaultId/notes',
    async (request, reply) => {
      const userId = (request.user as { id: string }).id;

      const paramsResult = VaultNoteParams.safeParse(request.params);
      if (!paramsResult.success) {
        return reply.status(400).send({ error: 'Invalid vault ID' });
      }

      const bodyResult = CreateNoteBody.safeParse(request.body);
      if (!bodyResult.success) {
        return reply.status(400).send({
          error: 'Validation error',
          details: bodyResult.error.flatten(),
        });
      }

      const { vaultId } = paramsResult.data;

      if (!(await assertVaultOwnership(vaultId, userId))) {
        return reply.status(404).send({ error: 'Vault not found' });
      }

      const { content, folderId } = bodyResult.data;
      const { frontmatter, body, wordCount } = parseMarkdown(content);
      const rawTitle =
        bodyResult.data.title ?? extractTitle(content, 'Untitled');
      const baseSlug = slugify(rawTitle);
      const slug = await ensureUniqueSlug(baseSlug, vaultId);

      // Validate folderId belongs to this vault
      if (folderId) {
        const [folder] = await db
          .select({ id: folders.id })
          .from(folders)
          .where(and(eq(folders.id, folderId), eq(folders.vaultId, vaultId)));
        if (!folder) {
          return reply.status(400).send({ error: 'Folder not found in vault' });
        }
      }

      const now = new Date();
      const [note] = await db
        .insert(notes)
        .values({
          id: uuidv4(),
          vaultId,
          folderId: folderId ?? null,
          title: rawTitle,
          content: body,
          frontmatter,
          slug,
          wordCount,
          createdAt: now,
          updatedAt: now,
        })
        .returning();

      // Sync wikilinks
      await syncWikilinks(note.id, vaultId, body);

      // Publish event (fire-and-forget, log errors)
      publishNoteCreated(note).catch((err) =>
        fastify.log.error({ err }, 'Failed to publish note.created event'),
      );

      return reply.status(201).send(note);
    },
  );

  // ── GET /vaults/:vaultId/notes ───────────────────────────────────────────────
  fastify.get<{ Params: { vaultId: string } }>(
    '/vaults/:vaultId/notes',
    async (request, reply) => {
      const userId = (request.user as { id: string }).id;

      const paramsResult = VaultNoteParams.safeParse(request.params);
      if (!paramsResult.success) {
        return reply.status(400).send({ error: 'Invalid vault ID' });
      }

      const queryResult = ListNotesQuery.safeParse(request.query);
      if (!queryResult.success) {
        return reply.status(400).send({
          error: 'Validation error',
          details: queryResult.error.flatten(),
        });
      }

      const { vaultId } = paramsResult.data;

      if (!(await assertVaultOwnership(vaultId, userId))) {
        return reply.status(404).send({ error: 'Vault not found' });
      }

      const { page, limit, tagId, folderId } = queryResult.data;
      const offset = (page - 1) * limit;

      // Build base conditions
      const conditions = [eq(notes.vaultId, vaultId)];

      if (folderId) {
        conditions.push(eq(notes.folderId, folderId));
      }

      // If filtering by tag, get note IDs that have the tag
      let tagFilteredIds: string[] | null = null;
      if (tagId) {
        const taggedNotes = await db
          .select({ noteId: noteTags.noteId })
          .from(noteTags)
          .where(eq(noteTags.tagId, tagId));
        tagFilteredIds = taggedNotes.map((t) => t.noteId);

        if (tagFilteredIds.length === 0) {
          return reply.send({ data: [], page, limit, total: 0 });
        }
      }

      const whereCondition =
        tagFilteredIds !== null
          ? and(...conditions, inArray(notes.id, tagFilteredIds))
          : and(...conditions);

      const [countRow] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(notes)
        .where(whereCondition);

      const total = countRow?.count ?? 0;

      const rows = await db
        .select()
        .from(notes)
        .where(whereCondition)
        .orderBy(notes.updatedAt)
        .limit(limit)
        .offset(offset);

      return reply.send({ data: rows, page, limit, total });
    },
  );

  // ── GET /vaults/:vaultId/notes/:id ───────────────────────────────────────────
  fastify.get<{ Params: { vaultId: string; id: string } }>(
    '/vaults/:vaultId/notes/:id',
    async (request, reply) => {
      const userId = (request.user as { id: string }).id;

      const paramsResult = NoteParams.safeParse(request.params);
      if (!paramsResult.success) {
        return reply.status(400).send({ error: 'Invalid params' });
      }

      const { vaultId, id } = paramsResult.data;

      if (!(await assertVaultOwnership(vaultId, userId))) {
        return reply.status(404).send({ error: 'Vault not found' });
      }

      const [note] = await db
        .select()
        .from(notes)
        .where(and(eq(notes.id, id), eq(notes.vaultId, vaultId)));

      if (!note) {
        return reply.status(404).send({ error: 'Note not found' });
      }

      // Fetch tags for the note
      const notesTagsRows = await db
        .select({ tag: tags })
        .from(noteTags)
        .innerJoin(tags, eq(noteTags.tagId, tags.id))
        .where(eq(noteTags.noteId, id));

      const noteTags_ = notesTagsRows.map((r) => r.tag);

      // Fetch backlinks (notes that link to this note)
      const backlinksRows = await db
        .select({ sourceNote: notes })
        .from(wikilinks)
        .innerJoin(notes, eq(wikilinks.sourceNoteId, notes.id))
        .where(eq(wikilinks.targetNoteId, id));

      const backlinks = backlinksRows.map((r) => r.sourceNote);

      // Fetch outbound wikilinks
      const outboundRows = await db
        .select()
        .from(wikilinks)
        .where(eq(wikilinks.sourceNoteId, id));

      return reply.send({
        ...note,
        tags: noteTags_,
        backlinks,
        wikilinks: outboundRows,
      });
    },
  );

  // ── PATCH /vaults/:vaultId/notes/:id ────────────────────────────────────────
  fastify.patch<{ Params: { vaultId: string; id: string } }>(
    '/vaults/:vaultId/notes/:id',
    async (request, reply) => {
      const userId = (request.user as { id: string }).id;

      const paramsResult = NoteParams.safeParse(request.params);
      if (!paramsResult.success) {
        return reply.status(400).send({ error: 'Invalid params' });
      }

      const bodyResult = UpdateNoteBody.safeParse(request.body);
      if (!bodyResult.success) {
        return reply.status(400).send({
          error: 'Validation error',
          details: bodyResult.error.flatten(),
        });
      }

      const { vaultId, id } = paramsResult.data;

      if (!(await assertVaultOwnership(vaultId, userId))) {
        return reply.status(404).send({ error: 'Vault not found' });
      }

      const [existing] = await db
        .select()
        .from(notes)
        .where(and(eq(notes.id, id), eq(notes.vaultId, vaultId)));

      if (!existing) {
        return reply.status(404).send({ error: 'Note not found' });
      }

      const { title, content, folderId } = bodyResult.data;

      const updateData: Partial<typeof notes.$inferInsert> = {
        updatedAt: new Date(),
      };

      const previousContent = existing.content;

      if (content !== undefined) {
        const { frontmatter, body, wordCount } = parseMarkdown(content);
        updateData.content = body;
        updateData.frontmatter = frontmatter;
        updateData.wordCount = wordCount;
      }

      if (title !== undefined) {
        updateData.title = title;
        const baseSlug = slugify(title);
        updateData.slug = await ensureUniqueSlug(baseSlug, vaultId, id);
      }

      if (folderId !== undefined) {
        if (folderId !== null) {
          const [folder] = await db
            .select({ id: folders.id })
            .from(folders)
            .where(
              and(eq(folders.id, folderId), eq(folders.vaultId, vaultId)),
            );
          if (!folder) {
            return reply
              .status(400)
              .send({ error: 'Folder not found in vault' });
          }
        }
        updateData.folderId = folderId;
      }

      const [updated] = await db
        .update(notes)
        .set(updateData)
        .where(eq(notes.id, id))
        .returning();

      // Re-sync wikilinks if content changed
      if (content !== undefined) {
        await syncWikilinks(
          id,
          vaultId,
          updateData.content ?? existing.content,
        );
      }

      publishNoteUpdated(updated, previousContent).catch((err) =>
        fastify.log.error({ err }, 'Failed to publish note.updated event'),
      );

      return reply.send(updated);
    },
  );

  // ── DELETE /vaults/:vaultId/notes/:id ───────────────────────────────────────
  fastify.delete<{ Params: { vaultId: string; id: string } }>(
    '/vaults/:vaultId/notes/:id',
    async (request, reply) => {
      const userId = (request.user as { id: string }).id;

      const paramsResult = NoteParams.safeParse(request.params);
      if (!paramsResult.success) {
        return reply.status(400).send({ error: 'Invalid params' });
      }

      const { vaultId, id } = paramsResult.data;

      if (!(await assertVaultOwnership(vaultId, userId))) {
        return reply.status(404).send({ error: 'Vault not found' });
      }

      const [existing] = await db
        .select({ id: notes.id })
        .from(notes)
        .where(and(eq(notes.id, id), eq(notes.vaultId, vaultId)));

      if (!existing) {
        return reply.status(404).send({ error: 'Note not found' });
      }

      await db.delete(notes).where(eq(notes.id, id));

      publishNoteDeleted(id, vaultId).catch((err) =>
        fastify.log.error({ err }, 'Failed to publish note.deleted event'),
      );

      return reply.status(204).send();
    },
  );

  // ── GET /vaults/:vaultId/notes/:id/backlinks ─────────────────────────────────
  fastify.get<{ Params: { vaultId: string; id: string } }>(
    '/vaults/:vaultId/notes/:id/backlinks',
    async (request, reply) => {
      const userId = (request.user as { id: string }).id;

      const paramsResult = NoteParams.safeParse(request.params);
      if (!paramsResult.success) {
        return reply.status(400).send({ error: 'Invalid params' });
      }

      const { vaultId, id } = paramsResult.data;

      if (!(await assertVaultOwnership(vaultId, userId))) {
        return reply.status(404).send({ error: 'Vault not found' });
      }

      const [target] = await db
        .select({ id: notes.id })
        .from(notes)
        .where(and(eq(notes.id, id), eq(notes.vaultId, vaultId)));

      if (!target) {
        return reply.status(404).send({ error: 'Note not found' });
      }

      const backlinksRows = await db
        .select({
          sourceNote: {
            id: notes.id,
            title: notes.title,
            slug: notes.slug,
            updatedAt: notes.updatedAt,
          },
          wikilinkId: wikilinks.id,
          targetTitle: wikilinks.targetTitle,
        })
        .from(wikilinks)
        .innerJoin(notes, eq(wikilinks.sourceNoteId, notes.id))
        .where(eq(wikilinks.targetNoteId, id));

      return reply.send(backlinksRows);
    },
  );
};

export default notesRoutes;
