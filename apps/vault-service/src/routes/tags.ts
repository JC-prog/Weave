import { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { eq, and, sql } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import { db, tags, noteTags, notes, vaults } from '../db';

// ─── Schemas ──────────────────────────────────────────────────────────────────
const VaultParams = z.object({
  vaultId: z.string().uuid(),
});

const TagParams = z.object({
  vaultId: z.string().uuid(),
  id: z.string().uuid(),
});

const NoteTagParams = z.object({
  vaultId: z.string().uuid(),
  noteId: z.string().uuid(),
});

const RemoveNoteTagParams = z.object({
  vaultId: z.string().uuid(),
  noteId: z.string().uuid(),
  tagId: z.string().uuid(),
});

const CreateTagBody = z.object({
  name: z.string().min(1).max(100),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, 'Color must be a valid hex color (#rrggbb)')
    .optional()
    .default('#6366f1'),
});

const AddNoteTagBody = z.object({
  tagId: z.string().uuid(),
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

// ─── Plugin ───────────────────────────────────────────────────────────────────
export const tagsRoutes: FastifyPluginAsync = async (fastify) => {
  // ── GET /vaults/:vaultId/tags ────────────────────────────────────────────────
  fastify.get<{ Params: { vaultId: string } }>(
    '/vaults/:vaultId/tags',
    async (request, reply) => {
      const userId = (request.user as { id: string }).id;

      const paramsResult = VaultParams.safeParse(request.params);
      if (!paramsResult.success) {
        return reply.status(400).send({ error: 'Invalid vault ID' });
      }

      const { vaultId } = paramsResult.data;

      if (!(await assertVaultOwnership(vaultId, userId))) {
        return reply.status(404).send({ error: 'Vault not found' });
      }

      // Get all tags with note count
      const rows = await db
        .select({
          id: tags.id,
          vaultId: tags.vaultId,
          name: tags.name,
          color: tags.color,
          createdAt: tags.createdAt,
          noteCount: sql<number>`count(${noteTags.noteId})::int`,
        })
        .from(tags)
        .leftJoin(noteTags, eq(noteTags.tagId, tags.id))
        .where(eq(tags.vaultId, vaultId))
        .groupBy(
          tags.id,
          tags.vaultId,
          tags.name,
          tags.color,
          tags.createdAt,
        )
        .orderBy(tags.name);

      return reply.send(rows);
    },
  );

  // ── POST /vaults/:vaultId/tags ───────────────────────────────────────────────
  fastify.post<{ Params: { vaultId: string } }>(
    '/vaults/:vaultId/tags',
    async (request, reply) => {
      const userId = (request.user as { id: string }).id;

      const paramsResult = VaultParams.safeParse(request.params);
      if (!paramsResult.success) {
        return reply.status(400).send({ error: 'Invalid vault ID' });
      }

      const bodyResult = CreateTagBody.safeParse(request.body);
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

      const { name, color } = bodyResult.data;

      // Check for duplicate tag name within vault
      const [existing] = await db
        .select({ id: tags.id })
        .from(tags)
        .where(and(eq(tags.vaultId, vaultId), eq(tags.name, name)));

      if (existing) {
        return reply
          .status(409)
          .send({ error: 'A tag with this name already exists in the vault' });
      }

      const [tag] = await db
        .insert(tags)
        .values({
          id: uuidv4(),
          vaultId,
          name,
          color,
          createdAt: new Date(),
        })
        .returning();

      return reply.status(201).send(tag);
    },
  );

  // ── POST /vaults/:vaultId/notes/:noteId/tags ─────────────────────────────────
  fastify.post<{ Params: { vaultId: string; noteId: string } }>(
    '/vaults/:vaultId/notes/:noteId/tags',
    async (request, reply) => {
      const userId = (request.user as { id: string }).id;

      const paramsResult = NoteTagParams.safeParse(request.params);
      if (!paramsResult.success) {
        return reply.status(400).send({ error: 'Invalid params' });
      }

      const bodyResult = AddNoteTagBody.safeParse(request.body);
      if (!bodyResult.success) {
        return reply.status(400).send({
          error: 'Validation error',
          details: bodyResult.error.flatten(),
        });
      }

      const { vaultId, noteId } = paramsResult.data;
      const { tagId } = bodyResult.data;

      if (!(await assertVaultOwnership(vaultId, userId))) {
        return reply.status(404).send({ error: 'Vault not found' });
      }

      // Verify note exists in vault
      const [note] = await db
        .select({ id: notes.id })
        .from(notes)
        .where(and(eq(notes.id, noteId), eq(notes.vaultId, vaultId)));

      if (!note) {
        return reply.status(404).send({ error: 'Note not found' });
      }

      // Verify tag exists in vault
      const [tag] = await db
        .select({ id: tags.id })
        .from(tags)
        .where(and(eq(tags.id, tagId), eq(tags.vaultId, vaultId)));

      if (!tag) {
        return reply.status(404).send({ error: 'Tag not found in vault' });
      }

      // Check if relation already exists
      const [existing] = await db
        .select()
        .from(noteTags)
        .where(and(eq(noteTags.noteId, noteId), eq(noteTags.tagId, tagId)));

      if (existing) {
        return reply
          .status(409)
          .send({ error: 'Tag is already attached to this note' });
      }

      await db.insert(noteTags).values({ noteId, tagId });

      return reply.status(201).send({ noteId, tagId });
    },
  );

  // ── DELETE /vaults/:vaultId/notes/:noteId/tags/:tagId ────────────────────────
  fastify.delete<{ Params: { vaultId: string; noteId: string; tagId: string } }>(
    '/vaults/:vaultId/notes/:noteId/tags/:tagId',
    async (request, reply) => {
      const userId = (request.user as { id: string }).id;

      const paramsResult = RemoveNoteTagParams.safeParse(request.params);
      if (!paramsResult.success) {
        return reply.status(400).send({ error: 'Invalid params' });
      }

      const { vaultId, noteId, tagId } = paramsResult.data;

      if (!(await assertVaultOwnership(vaultId, userId))) {
        return reply.status(404).send({ error: 'Vault not found' });
      }

      const [existing] = await db
        .select()
        .from(noteTags)
        .where(and(eq(noteTags.noteId, noteId), eq(noteTags.tagId, tagId)));

      if (!existing) {
        return reply
          .status(404)
          .send({ error: 'Tag is not attached to this note' });
      }

      await db
        .delete(noteTags)
        .where(and(eq(noteTags.noteId, noteId), eq(noteTags.tagId, tagId)));

      return reply.status(204).send();
    },
  );

  // ── DELETE /vaults/:vaultId/tags/:id ─────────────────────────────────────────
  fastify.delete<{ Params: { vaultId: string; id: string } }>(
    '/vaults/:vaultId/tags/:id',
    async (request, reply) => {
      const userId = (request.user as { id: string }).id;

      const paramsResult = TagParams.safeParse(request.params);
      if (!paramsResult.success) {
        return reply.status(400).send({ error: 'Invalid params' });
      }

      const { vaultId, id } = paramsResult.data;

      if (!(await assertVaultOwnership(vaultId, userId))) {
        return reply.status(404).send({ error: 'Vault not found' });
      }

      const [existing] = await db
        .select({ id: tags.id })
        .from(tags)
        .where(and(eq(tags.id, id), eq(tags.vaultId, vaultId)));

      if (!existing) {
        return reply.status(404).send({ error: 'Tag not found' });
      }

      // note_tags rows are deleted via FK cascade
      await db.delete(tags).where(eq(tags.id, id));

      return reply.status(204).send();
    },
  );
};

export default tagsRoutes;
