import fp from 'fastify-plugin';
import fastifyJwt from '@fastify/jwt';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

// ─── JWT Payload ──────────────────────────────────────────────────────────────
export interface JwtPayload {
  sub: string;    // user id
  email: string;
  type: 'access' | 'refresh';
  iat?: number;
  exp?: number;
}

// ─── Extend FastifyRequest ────────────────────────────────────────────────────
declare module 'fastify' {
  interface FastifyRequest {
    user: JwtPayload;
  }
  interface FastifyInstance {
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: JwtPayload;
    user: JwtPayload;
  }
}

// ─── Plugin ───────────────────────────────────────────────────────────────────
async function jwtPlugin(fastify: FastifyInstance): Promise<void> {
  const JWT_ACCESS_SECRET = process.env['JWT_ACCESS_SECRET'];
  const JWT_REFRESH_SECRET = process.env['JWT_REFRESH_SECRET'];

  if (!JWT_ACCESS_SECRET) {
    throw new Error('JWT_ACCESS_SECRET environment variable is required');
  }
  if (!JWT_REFRESH_SECRET) {
    throw new Error('JWT_REFRESH_SECRET environment variable is required');
  }

  // Register @fastify/jwt with the access token secret
  await fastify.register(fastifyJwt, {
    secret: JWT_ACCESS_SECRET,
    sign: {
      expiresIn: process.env['JWT_ACCESS_EXPIRES_IN'] ?? '15m',
    },
    verify: {
      // Allow both access and refresh secrets so we can verify refresh tokens manually
      extractToken: (request: FastifyRequest) => {
        const authHeader = request.headers['authorization'];
        if (authHeader && authHeader.startsWith('Bearer ')) {
          return authHeader.slice(7);
        }
        return undefined;
      },
    },
  });

  // ─── Token generation helpers ──────────────────────────────────────────────
  fastify.decorate('generateAccessToken', (payload: Omit<JwtPayload, 'type' | 'iat' | 'exp'>) => {
    return fastify.jwt.sign(
      { ...payload, type: 'access' },
      { expiresIn: process.env['JWT_ACCESS_EXPIRES_IN'] ?? '15m' }
    );
  });

  fastify.decorate('generateRefreshToken', (payload: Omit<JwtPayload, 'type' | 'iat' | 'exp'>) => {
    return fastify.jwt.sign(
      { ...payload, type: 'refresh' },
      {
        secret: JWT_REFRESH_SECRET,
        expiresIn: process.env['JWT_REFRESH_EXPIRES_IN'] ?? '7d',
      }
    );
  });

  fastify.decorate('verifyRefreshToken', (token: string): JwtPayload => {
    return fastify.jwt.verify<JwtPayload>(token, { secret: JWT_REFRESH_SECRET });
  });

  // ─── Authenticate decorator ────────────────────────────────────────────────
  fastify.decorate('authenticate', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      await request.jwtVerify();

      // Ensure the token is an access token, not a refresh token
      if ((request.user as JwtPayload).type !== 'access') {
        return reply.status(401).send({
          statusCode: 401,
          error: 'Unauthorized',
          message: 'Invalid token type. Access token required.',
        });
      }
    } catch (err) {
      const error = err as Error;
      return reply.status(401).send({
        statusCode: 401,
        error: 'Unauthorized',
        message: error.message ?? 'Invalid or expired token',
      });
    }
  });
}

// ─── Extend FastifyInstance with token helpers ────────────────────────────────
declare module 'fastify' {
  interface FastifyInstance {
    generateAccessToken: (payload: Omit<JwtPayload, 'type' | 'iat' | 'exp'>) => string;
    generateRefreshToken: (payload: Omit<JwtPayload, 'type' | 'iat' | 'exp'>) => string;
    verifyRefreshToken: (token: string) => JwtPayload;
  }
}

export default fp(jwtPlugin, {
  name: 'jwt-plugin',
  fastify: '4.x',
});
