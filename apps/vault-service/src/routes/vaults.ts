import { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { eq, and } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import { db, vaults } from '../db';

// ─── Schemas ──────────────────────────────────────────────────────────────────
const CreateVaultBody = z.object({
  name: z.string().min(1).max(255),
  description: z.string().max(2000).optional(),
  isDefault: z.boolean().optional().default(false),
});

const UpdateVaultBody = z.object({
  name: z.string().min(1).max(255).optional(),
  description: z.string().max(2000).nullable().optional(),
  isDefault: z.boolean().optional(),
});

const VaultParams = z.object({
  id: z.string().uuid(),
});

// ─── Plugin ───────────────────────────────────────────────────────────────────
export const vaultsRoutes: FastifyPluginAsync = async (fastify) => {
  // ── POST /vaults ────────────────────────────────────────────────────────────
  fastify.post('/vaults', async (request, reply) => {
    const userId = (request.user as { id: string }).id;

    const bodyResult = CreateVaultBody.safeParse(request.body);
    if (!bodyResult.success) {
      return reply.status(400).send({
        error: 'Validation error',
        details: bodyResult.error.flatten(),
      });
    }

    const { name, description, isDefault } = bodyResult.data;

    // If this vault is default, unset all other defaults for user
    if (isDefault) {
      await db
        .update(vaults)
        .set({ isDefault: false, updatedAt: new Date() })
        .where(and(eq(vaults.userId, userId), eq(vaults.isDefault, true)));
    }

    const now = new Date();
    const [vault] = await db
      .insert(vaults)
      .values({
        id: uuidv4(),
        userId,
        name,
        description: description ?? null,
        isDefault: isDefault ?? false,
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    return reply.status(201).send(vault);
  });

  // ── GET /vaults ──────────────────────────────────────────────────────────────
  fastify.get('/vaults', async (request, reply) => {
    const userId = (request.user as { id: string }).id;

    const userVaults = await db
      .select()
      .from(vaults)
      .where(eq(vaults.userId, userId))
      .orderBy(vaults.createdAt);

    return reply.send(userVaults);
  });

  // ── GET /vaults/:id ──────────────────────────────────────────────────────────
  fastify.get<{ Params: { id: string } }>('/vaults/:id', async (request, reply) => {
    const userId = (request.user as { id: string }).id;

    const paramsResult = VaultParams.safeParse(request.params);
    if (!paramsResult.success) {
      return reply.status(400).send({ error: 'Invalid vault ID' });
    }

    const [vault] = await db
      .select()
      .from(vaults)
      .where(and(eq(vaults.id, paramsResult.data.id), eq(vaults.userId, userId)));

    if (!vault) {
      return reply.status(404).send({ error: 'Vault not found' });
    }

    return reply.send(vault);
  });

  // ── PATCH /vaults/:id ────────────────────────────────────────────────────────
  fastify.patch<{ Params: { id: string } }>('/vaults/:id', async (request, reply) => {
    const userId = (request.user as { id: string }).id;

    const paramsResult = VaultParams.safeParse(request.params);
    if (!paramsResult.success) {
      return reply.status(400).send({ error: 'Invalid vault ID' });
    }

    const bodyResult = UpdateVaultBody.safeParse(request.body);
    if (!bodyResult.success) {
      return reply.status(400).send({
        error: 'Validation error',
        details: bodyResult.error.flatten(),
      });
    }

    // Ensure vault belongs to user
    const [existing] = await db
      .select()
      .from(vaults)
      .where(and(eq(vaults.id, paramsResult.data.id), eq(vaults.userId, userId)));

    if (!existing) {
      return reply.status(404).send({ error: 'Vault not found' });
    }

    const { name, description, isDefault } = bodyResult.data;

    // If setting as default, unset others
    if (isDefault) {
      await db
        .update(vaults)
        .set({ isDefault: false, updatedAt: new Date() })
        .where(and(eq(vaults.userId, userId), eq(vaults.isDefault, true)));
    }

    const updateData: Partial<typeof vaults.$inferInsert> = {
      updatedAt: new Date(),
    };
    if (name !== undefined) updateData.name = name;
    if (description !== undefined) updateData.description = description;
    if (isDefault !== undefined) updateData.isDefault = isDefault;

    const [updated] = await db
      .update(vaults)
      .set(updateData)
      .where(eq(vaults.id, paramsResult.data.id))
      .returning();

    return reply.send(updated);
  });

  // ── DELETE /vaults/:id ───────────────────────────────────────────────────────
  fastify.delete<{ Params: { id: string } }>('/vaults/:id', async (request, reply) => {
    const userId = (request.user as { id: string }).id;

    const paramsResult = VaultParams.safeParse(request.params);
    if (!paramsResult.success) {
      return reply.status(400).send({ error: 'Invalid vault ID' });
    }

    // Ensure vault belongs to user
    const [existing] = await db
      .select()
      .from(vaults)
      .where(and(eq(vaults.id, paramsResult.data.id), eq(vaults.userId, userId)));

    if (!existing) {
      return reply.status(404).send({ error: 'Vault not found' });
    }

    // Cascade delete is handled by DB foreign keys
    await db.delete(vaults).where(eq(vaults.id, paramsResult.data.id));

    return reply.status(204).send();
  });
};

export default vaultsRoutes;
