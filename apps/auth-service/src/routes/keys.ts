import type { FastifyInstance, FastifyPluginOptions } from 'fastify';
import fp from 'fastify-plugin';
import bcrypt from 'bcrypt';
import { randomBytes } from 'crypto';
import { z } from 'zod';
import { eq, and } from 'drizzle-orm';
import { db, schema } from '../db';

// ─── Validation Schemas ───────────────────────────────────────────────────────
const CreateKeyBody = z.object({
  name: z
    .string()
    .min(1, 'Key name is required')
    .max(100, 'Key name must be at most 100 characters')
    .trim(),
});

const DeleteKeyParams = z.object({
  id: z.string().uuid('Invalid key ID'),
});

// ─── Constants ────────────────────────────────────────────────────────────────
const BCRYPT_ROUNDS = 10;
const API_KEY_PREFIX = 'nlm_';
const API_KEY_BYTES = 32; // 256-bit entropy → 64 hex chars

// ─── Route Plugin ─────────────────────────────────────────────────────────────
async function keysRoutes(
  fastify: FastifyInstance,
  _opts: FastifyPluginOptions
): Promise<void> {
  // All key routes require authentication
  fastify.addHook('preHandler', fastify.authenticate);

  // ── POST /keys ─────────────────────────────────────────────────────────────
  fastify.post('/keys', async (request, reply) => {
    const result = CreateKeyBody.safeParse(request.body);
    if (!result.success) {
      return reply.status(400).send({
        statusCode: 400,
        error: 'Bad Request',
        message: result.error.errors.map((e) => e.message).join(', '),
      });
    }

    const { name } = result.data;
    const { sub: userId } = request.user;

    // Generate a cryptographically secure API key
    const rawKey = `${API_KEY_PREFIX}${randomBytes(API_KEY_BYTES).toString('hex')}`;

    // Store only the hash
    const keyHash = await bcrypt.hash(rawKey, BCRYPT_ROUNDS);

    const [newKey] = await db
      .insert(schema.apiKeys)
      .values({ userId, keyHash, name })
      .returning({
        id: schema.apiKeys.id,
        name: schema.apiKeys.name,
        createdAt: schema.apiKeys.createdAt,
      });

    if (!newKey) {
      return reply.status(500).send({
        statusCode: 500,
        error: 'Internal Server Error',
        message: 'Failed to create API key',
      });
    }

    // Return the raw key ONCE — it cannot be retrieved again
    return reply.status(201).send({
      id: newKey.id,
      name: newKey.name,
      key: rawKey, // shown only on creation
      createdAt: newKey.createdAt,
      message:
        'Store this API key securely. It will not be shown again.',
    });
  });

  // ── GET /keys ──────────────────────────────────────────────────────────────
  fastify.get('/keys', async (request, reply) => {
    const { sub: userId } = request.user;

    const keys = await db
      .select({
        id: schema.apiKeys.id,
        name: schema.apiKeys.name,
        lastUsedAt: schema.apiKeys.lastUsedAt,
        createdAt: schema.apiKeys.createdAt,
      })
      .from(schema.apiKeys)
      .where(eq(schema.apiKeys.userId, userId))
      .orderBy(schema.apiKeys.createdAt);

    return reply.status(200).send({ keys });
  });

  // ── DELETE /keys/:id ───────────────────────────────────────────────────────
  fastify.delete('/keys/:id', async (request, reply) => {
    const result = DeleteKeyParams.safeParse(request.params);
    if (!result.success) {
      return reply.status(400).send({
        statusCode: 400,
        error: 'Bad Request',
        message: result.error.errors.map((e) => e.message).join(', '),
      });
    }

    const { id } = result.data;
    const { sub: userId } = request.user;

    // Ensure the key belongs to the authenticated user
    const deleted = await db
      .delete(schema.apiKeys)
      .where(
        and(
          eq(schema.apiKeys.id, id),
          eq(schema.apiKeys.userId, userId)
        )
      )
      .returning({ id: schema.apiKeys.id });

    if (deleted.length === 0) {
      return reply.status(404).send({
        statusCode: 404,
        error: 'Not Found',
        message: 'API key not found',
      });
    }

    return reply.status(204).send();
  });
}

export default fp(keysRoutes, {
  name: 'keys-routes',
  fastify: '4.x',
});
