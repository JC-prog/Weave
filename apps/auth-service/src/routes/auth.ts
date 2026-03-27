import type { FastifyInstance, FastifyPluginOptions } from 'fastify';
import fp from 'fastify-plugin';
import bcrypt from 'bcrypt';
import { z } from 'zod';
import { eq, and, gt } from 'drizzle-orm';
import { db, schema } from '../db';
import type { JwtPayload } from '../plugins/jwt';

// ─── Validation Schemas ───────────────────────────────────────────────────────
const RegisterBody = z.object({
  email: z.string().email('Invalid email address'),
  password: z
    .string()
    .min(8, 'Password must be at least 8 characters')
    .max(128, 'Password must be at most 128 characters'),
});

const LoginBody = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(1, 'Password is required'),
});

const RefreshBody = z.object({
  refreshToken: z.string().min(1, 'Refresh token is required'),
});

const LogoutBody = z.object({
  refreshToken: z.string().min(1, 'Refresh token is required'),
});

// ─── Constants ────────────────────────────────────────────────────────────────
const BCRYPT_ROUNDS = 10;
const REFRESH_TOKEN_TTL_DAYS = 7;

// ─── Helpers ──────────────────────────────────────────────────────────────────
function getRefreshTokenExpiry(): Date {
  const d = new Date();
  d.setDate(d.getDate() + REFRESH_TOKEN_TTL_DAYS);
  return d;
}

async function buildAuthResponse(
  fastify: FastifyInstance,
  userId: string,
  email: string
): Promise<{
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  user: { id: string; email: string };
}> {
  const payload: Omit<JwtPayload, 'type' | 'iat' | 'exp'> = { sub: userId, email };

  const accessToken = fastify.generateAccessToken(payload);
  const refreshToken = fastify.generateRefreshToken(payload);

  // Hash and persist refresh token
  const tokenHash = await bcrypt.hash(refreshToken, BCRYPT_ROUNDS);
  await db.insert(schema.refreshTokens).values({
    userId,
    tokenHash,
    expiresAt: getRefreshTokenExpiry(),
  });

  return {
    accessToken,
    refreshToken,
    expiresIn: 900, // 15 minutes in seconds
    user: { id: userId, email },
  };
}

// ─── Route Plugin ─────────────────────────────────────────────────────────────
async function authRoutes(
  fastify: FastifyInstance,
  _opts: FastifyPluginOptions
): Promise<void> {
  // ── POST /auth/register ────────────────────────────────────────────────────
  fastify.post('/auth/register', async (request, reply) => {
    const result = RegisterBody.safeParse(request.body);
    if (!result.success) {
      return reply.status(400).send({
        statusCode: 400,
        error: 'Bad Request',
        message: result.error.errors.map((e) => e.message).join(', '),
      });
    }

    const { email, password } = result.data;

    // Check uniqueness
    const existing = await db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(eq(schema.users.email, email.toLowerCase()))
      .limit(1);

    if (existing.length > 0) {
      return reply.status(409).send({
        statusCode: 409,
        error: 'Conflict',
        message: 'An account with this email already exists',
      });
    }

    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);

    const [newUser] = await db
      .insert(schema.users)
      .values({ email: email.toLowerCase(), passwordHash })
      .returning({ id: schema.users.id, email: schema.users.email });

    if (!newUser) {
      return reply.status(500).send({
        statusCode: 500,
        error: 'Internal Server Error',
        message: 'Failed to create user',
      });
    }

    const authResponse = await buildAuthResponse(fastify, newUser.id, newUser.email);

    return reply.status(201).send(authResponse);
  });

  // ── POST /auth/login ───────────────────────────────────────────────────────
  fastify.post('/auth/login', async (request, reply) => {
    const result = LoginBody.safeParse(request.body);
    if (!result.success) {
      return reply.status(400).send({
        statusCode: 400,
        error: 'Bad Request',
        message: result.error.errors.map((e) => e.message).join(', '),
      });
    }

    const { email, password } = result.data;

    const [user] = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.email, email.toLowerCase()))
      .limit(1);

    if (!user) {
      // Perform dummy compare to avoid timing attacks
      await bcrypt.compare(password, '$2b$10$invalidhashfortimingprotection00000');
      return reply.status(401).send({
        statusCode: 401,
        error: 'Unauthorized',
        message: 'Invalid email or password',
      });
    }

    const passwordMatch = await bcrypt.compare(password, user.passwordHash);
    if (!passwordMatch) {
      return reply.status(401).send({
        statusCode: 401,
        error: 'Unauthorized',
        message: 'Invalid email or password',
      });
    }

    const authResponse = await buildAuthResponse(fastify, user.id, user.email);
    return reply.status(200).send(authResponse);
  });

  // ── POST /auth/refresh ─────────────────────────────────────────────────────
  fastify.post('/auth/refresh', async (request, reply) => {
    const result = RefreshBody.safeParse(request.body);
    if (!result.success) {
      return reply.status(400).send({
        statusCode: 400,
        error: 'Bad Request',
        message: result.error.errors.map((e) => e.message).join(', '),
      });
    }

    const { refreshToken } = result.data;

    // Verify the JWT signature and expiry
    let payload: JwtPayload;
    try {
      payload = fastify.verifyRefreshToken(refreshToken);
    } catch (_err) {
      return reply.status(401).send({
        statusCode: 401,
        error: 'Unauthorized',
        message: 'Invalid or expired refresh token',
      });
    }

    if (payload.type !== 'refresh') {
      return reply.status(401).send({
        statusCode: 401,
        error: 'Unauthorized',
        message: 'Invalid token type',
      });
    }

    // Fetch all non-expired refresh tokens for this user and compare hashes
    const storedTokens = await db
      .select()
      .from(schema.refreshTokens)
      .where(
        and(
          eq(schema.refreshTokens.userId, payload.sub),
          gt(schema.refreshTokens.expiresAt, new Date())
        )
      );

    let matchedToken: (typeof storedTokens)[0] | undefined;
    for (const stored of storedTokens) {
      const match = await bcrypt.compare(refreshToken, stored.tokenHash);
      if (match) {
        matchedToken = stored;
        break;
      }
    }

    if (!matchedToken) {
      return reply.status(401).send({
        statusCode: 401,
        error: 'Unauthorized',
        message: 'Refresh token not found or already used',
      });
    }

    // Rotate: delete old token
    await db
      .delete(schema.refreshTokens)
      .where(eq(schema.refreshTokens.id, matchedToken.id));

    // Fetch user to ensure they still exist
    const [user] = await db
      .select({ id: schema.users.id, email: schema.users.email })
      .from(schema.users)
      .where(eq(schema.users.id, payload.sub))
      .limit(1);

    if (!user) {
      return reply.status(401).send({
        statusCode: 401,
        error: 'Unauthorized',
        message: 'User no longer exists',
      });
    }

    const authResponse = await buildAuthResponse(fastify, user.id, user.email);
    return reply.status(200).send(authResponse);
  });

  // ── POST /auth/logout ──────────────────────────────────────────────────────
  fastify.post('/auth/logout', async (request, reply) => {
    const result = LogoutBody.safeParse(request.body);
    if (!result.success) {
      return reply.status(400).send({
        statusCode: 400,
        error: 'Bad Request',
        message: result.error.errors.map((e) => e.message).join(', '),
      });
    }

    const { refreshToken } = result.data;

    let payload: JwtPayload;
    try {
      payload = fastify.verifyRefreshToken(refreshToken);
    } catch (_err) {
      // Token already invalid — treat as successful logout
      return reply.status(204).send();
    }

    // Find and delete matching refresh token
    const storedTokens = await db
      .select()
      .from(schema.refreshTokens)
      .where(eq(schema.refreshTokens.userId, payload.sub));

    for (const stored of storedTokens) {
      const match = await bcrypt.compare(refreshToken, stored.tokenHash);
      if (match) {
        await db
          .delete(schema.refreshTokens)
          .where(eq(schema.refreshTokens.id, stored.id));
        break;
      }
    }

    return reply.status(204).send();
  });

  // ── GET /auth/me ───────────────────────────────────────────────────────────
  fastify.get(
    '/auth/me',
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const { sub } = request.user;

      const [user] = await db
        .select({
          id: schema.users.id,
          email: schema.users.email,
          createdAt: schema.users.createdAt,
          updatedAt: schema.users.updatedAt,
        })
        .from(schema.users)
        .where(eq(schema.users.id, sub))
        .limit(1);

      if (!user) {
        return reply.status(404).send({
          statusCode: 404,
          error: 'Not Found',
          message: 'User not found',
        });
      }

      return reply.status(200).send({ user });
    }
  );
}

export default fp(authRoutes, {
  name: 'auth-routes',
  fastify: '4.x',
});
