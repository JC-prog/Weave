import fp from 'fastify-plugin';
import fastifyJwt from '@fastify/jwt';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

// ─── JWT Payload ──────────────────────────────────────────────────────────────
export interface JwtPayload {
  sub: string;
  email: string;
  type: 'access' | 'refresh';
  iat?: number;
  exp?: number;
}

// ─── Module Augmentation ──────────────────────────────────────────────────────
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

// ─── Public Route Prefixes ────────────────────────────────────────────────────
// These paths bypass JWT authentication
const PUBLIC_PREFIXES: string[] = [
  '/api/auth/register',
  '/api/auth/login',
  '/api/auth/refresh',
  '/health',
];

function isPublicRoute(url: string): boolean {
  return PUBLIC_PREFIXES.some((prefix) => url.startsWith(prefix));
}

// ─── Auth Plugin ──────────────────────────────────────────────────────────────
async function authPlugin(fastify: FastifyInstance): Promise<void> {
  const JWT_ACCESS_SECRET = process.env['JWT_ACCESS_SECRET'];

  if (!JWT_ACCESS_SECRET) {
    throw new Error('JWT_ACCESS_SECRET environment variable is required');
  }

  await fastify.register(fastifyJwt, {
    secret: JWT_ACCESS_SECRET,
    verify: {
      extractToken: (request: FastifyRequest) => {
        const authHeader = request.headers['authorization'];
        if (authHeader && authHeader.startsWith('Bearer ')) {
          return authHeader.slice(7);
        }
        return undefined;
      },
    },
  });

  // ── authenticate decorator ─────────────────────────────────────────────────
  fastify.decorate(
    'authenticate',
    async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
      // Skip JWT validation for public routes
      if (isPublicRoute(request.url)) {
        return;
      }

      try {
        await request.jwtVerify();

        const payload = request.user as JwtPayload;

        if (payload.type !== 'access') {
          return reply.status(401).send({
            statusCode: 401,
            error: 'Unauthorized',
            message: 'Access token required',
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
    }
  );

  // ── Global auth hook ───────────────────────────────────────────────────────
  // Attach to all non-public routes automatically
  fastify.addHook('preHandler', async (request: FastifyRequest, reply: FastifyReply) => {
    if (isPublicRoute(request.url)) {
      return;
    }

    // Skip for preflight requests
    if (request.method === 'OPTIONS') {
      return;
    }

    try {
      await request.jwtVerify();

      const payload = request.user as JwtPayload;
      if (payload.type !== 'access') {
        return reply.status(401).send({
          statusCode: 401,
          error: 'Unauthorized',
          message: 'Access token required',
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

export default fp(authPlugin, {
  name: 'auth-plugin',
  fastify: '4.x',
});
