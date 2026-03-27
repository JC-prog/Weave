import { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { eq, and, like } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import { db, folders, notes, vaults } from '../db';

// ─── Schemas ──────────────────────────────────────────────────────────────────
const VaultParams = z.object({
  vaultId: z.string().uuid(),
});

const FolderParams = z.object({
  vaultId: z.string().uuid(),
  id: z.string().uuid(),
});

const CreateFolderBody = z.object({
  name: z.string().min(1).max(255),
  parentId: z.string().uuid().nullable().optional(),
});

const UpdateFolderBody = z.object({
  name: z.string().min(1).max(255).optional(),
  parentId: z.string().uuid().nullable().optional(),
});

const DeleteFolderQuery = z.object({
  cascade: z.enum(['true', 'false']).optional().default('false'),
});

// ─── Types ────────────────────────────────────────────────────────────────────
interface FolderNode {
  id: string;
  vaultId: string;
  parentId: string | null;
  name: string;
  path: string;
  createdAt: Date;
  updatedAt: Date;
  children: FolderNode[];
}

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

function buildTree(
  allFolders: (typeof folders.$inferSelect)[],
  parentId: string | null = null,
): FolderNode[] {
  return allFolders
    .filter((f) => f.parentId === parentId)
    .map((f) => ({
      ...f,
      children: buildTree(allFolders, f.id),
    }));
}

async function computePath(
  name: string,
  parentId: string | null,
  vaultId: string,
): Promise<string> {
  if (!parentId) return `/${name}`;

  const [parent] = await db
    .select({ path: folders.path })
    .from(folders)
    .where(and(eq(folders.id, parentId), eq(folders.vaultId, vaultId)));

  if (!parent) return `/${name}`;
  return `${parent.path}/${name}`;
}

// ─── Plugin ───────────────────────────────────────────────────────────────────
export const foldersRoutes: FastifyPluginAsync = async (fastify) => {
  // ── POST /vaults/:vaultId/folders ────────────────────────────────────────────
  fastify.post<{ Params: { vaultId: string } }>(
    '/vaults/:vaultId/folders',
    async (request, reply) => {
      const userId = (request.user as { id: string }).id;

      const paramsResult = VaultParams.safeParse(request.params);
      if (!paramsResult.success) {
        return reply.status(400).send({ error: 'Invalid vault ID' });
      }

      const bodyResult = CreateFolderBody.safeParse(request.body);
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

      const { name, parentId } = bodyResult.data;

      // Validate parent folder if given
      if (parentId) {
        const [parentFolder] = await db
          .select({ id: folders.id })
          .from(folders)
          .where(and(eq(folders.id, parentId), eq(folders.vaultId, vaultId)));

        if (!parentFolder) {
          return reply
            .status(400)
            .send({ error: 'Parent folder not found in vault' });
        }
      }

      const path = await computePath(name, parentId ?? null, vaultId);
      const now = new Date();

      const [folder] = await db
        .insert(folders)
        .values({
          id: uuidv4(),
          vaultId,
          parentId: parentId ?? null,
          name,
          path,
          createdAt: now,
          updatedAt: now,
        })
        .returning();

      return reply.status(201).send(folder);
    },
  );

  // ── GET /vaults/:vaultId/folders ─────────────────────────────────────────────
  fastify.get<{ Params: { vaultId: string } }>(
    '/vaults/:vaultId/folders',
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

      const allFolders = await db
        .select()
        .from(folders)
        .where(eq(folders.vaultId, vaultId))
        .orderBy(folders.path);

      const tree = buildTree(allFolders);

      return reply.send(tree);
    },
  );

  // ── PATCH /vaults/:vaultId/folders/:id ──────────────────────────────────────
  fastify.patch<{ Params: { vaultId: string; id: string } }>(
    '/vaults/:vaultId/folders/:id',
    async (request, reply) => {
      const userId = (request.user as { id: string }).id;

      const paramsResult = FolderParams.safeParse(request.params);
      if (!paramsResult.success) {
        return reply.status(400).send({ error: 'Invalid params' });
      }

      const bodyResult = UpdateFolderBody.safeParse(request.body);
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
        .from(folders)
        .where(and(eq(folders.id, id), eq(folders.vaultId, vaultId)));

      if (!existing) {
        return reply.status(404).send({ error: 'Folder not found' });
      }

      const { name, parentId } = bodyResult.data;

      // Prevent circular reference: new parent must not be a descendant
      if (parentId) {
        if (parentId === id) {
          return reply
            .status(400)
            .send({ error: 'Folder cannot be its own parent' });
        }

        // Check that the new parent is not a descendant of the folder being moved
        const allFolders = await db
          .select()
          .from(folders)
          .where(eq(folders.vaultId, vaultId));

        const isDescendant = (
          checkId: string,
          targetId: string,
        ): boolean => {
          const folder = allFolders.find((f) => f.id === checkId);
          if (!folder || !folder.parentId) return false;
          if (folder.parentId === targetId) return true;
          return isDescendant(folder.parentId, targetId);
        };

        if (isDescendant(parentId, id)) {
          return reply
            .status(400)
            .send({ error: 'Cannot move folder into its own descendant' });
        }
      }

      const newName = name ?? existing.name;
      const newParentId =
        parentId !== undefined ? parentId : existing.parentId;
      const newPath = await computePath(newName, newParentId, vaultId);
      const oldPath = existing.path;

      const [updated] = await db
        .update(folders)
        .set({
          name: newName,
          parentId: newParentId,
          path: newPath,
          updatedAt: new Date(),
        })
        .where(eq(folders.id, id))
        .returning();

      // Update paths of all descendant folders
      const descendants = await db
        .select()
        .from(folders)
        .where(
          and(
            eq(folders.vaultId, vaultId),
            like(folders.path, `${oldPath}/%`),
          ),
        );

      for (const desc of descendants) {
        const updatedDescPath = desc.path.replace(oldPath, newPath);
        await db
          .update(folders)
          .set({ path: updatedDescPath, updatedAt: new Date() })
          .where(eq(folders.id, desc.id));
      }

      return reply.send(updated);
    },
  );

  // ── DELETE /vaults/:vaultId/folders/:id ─────────────────────────────────────
  fastify.delete<{ Params: { vaultId: string; id: string } }>(
    '/vaults/:vaultId/folders/:id',
    async (request, reply) => {
      const userId = (request.user as { id: string }).id;

      const paramsResult = FolderParams.safeParse(request.params);
      if (!paramsResult.success) {
        return reply.status(400).send({ error: 'Invalid params' });
      }

      const queryResult = DeleteFolderQuery.safeParse(request.query);
      if (!queryResult.success) {
        return reply.status(400).send({ error: 'Invalid query params' });
      }

      const { vaultId, id } = paramsResult.data;
      const cascade = queryResult.data.cascade === 'true';

      if (!(await assertVaultOwnership(vaultId, userId))) {
        return reply.status(404).send({ error: 'Vault not found' });
      }

      const [existing] = await db
        .select()
        .from(folders)
        .where(and(eq(folders.id, id), eq(folders.vaultId, vaultId)));

      if (!existing) {
        return reply.status(404).send({ error: 'Folder not found' });
      }

      if (cascade) {
        // Notes inside this folder and its descendants are deleted via FK cascade
        await db.delete(folders).where(eq(folders.id, id));
      } else {
        // Move notes in this folder to root (null folderId)
        await db
          .update(notes)
          .set({ folderId: null, updatedAt: new Date() })
          .where(
            and(eq(notes.folderId, id), eq(notes.vaultId, vaultId)),
          );

        // Re-parent direct child folders to this folder's parent
        await db
          .update(folders)
          .set({ parentId: existing.parentId, updatedAt: new Date() })
          .where(
            and(
              eq(folders.parentId, id),
              eq(folders.vaultId, vaultId),
            ),
          );

        await db.delete(folders).where(eq(folders.id, id));
      }

      return reply.status(204).send();
    },
  );
};

export default foldersRoutes;
