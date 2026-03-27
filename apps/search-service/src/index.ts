import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import fastifyJwt from '@fastify/jwt';
import type { FastifyRequest, FastifyReply } from 'fastify';
import searchRoutes from './routes/search';
import { VaultEventSubscriber } from './subscribers/vault';
import { closePool } from './db';

// ─── Environment ──────────────────────────────────────────────────────────────
const PORT = Number(process.env['PORT'] ?? 3004);
const HOST = process.env['HOST'] ?? '0.0.0.0';
const JWT_ACCESS_SECRET = process.env['JWT_ACCESS_SECRET'];
const NODE_ENV = process.env['NODE_ENV'] ?? 'development';

if (!JWT_ACCESS_SECRET) {
  throw new Error('JWT_ACCESS_SECRET environment variable is required');
}

// ─── JWT Payload ──────────────────────────────────────────────────────────────
interface JwtPayload {
  sub: string;
  email: string;
  type: 'access' | 'refresh';
  iat?: number;
  exp?: number;
}

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

// ─── Build App ────────────────────────────────────────────────────────────────
const app = Fastify({
  logger: {
    level: NODE_ENV === 'production' ? 'info' : 'debug',
    transport:
      NODE_ENV !== 'production'
        ? { target: 'pino-pretty', options: { colorize: true } }
        : undefined,
  },
});

async function buildApp(): Promise<void> {
  // Security
  await app.register(helmet, { global: true });
  await app.register(cors, {
    origin: process.env['CORS_ORIGIN'] ?? '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  });

  // JWT
  await app.register(fastifyJwt, {
    secret: JWT_ACCESS_SECRET as string,
    verify: {
      extractToken: (request: FastifyRequest) => {
        const authHeader = request.headers['authorization'];
        if (authHeader?.startsWith('Bearer ')) {
          return authHeader.slice(7);
        }
        return undefined;
      },
    },
  });

  // Authenticate decorator
  app.decorate('authenticate', async (request: FastifyRequest, reply: FastifyReply) => {
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

  // Health check (no auth required)
  app.get('/health', async (_request, _reply) => {
    return { status: 'ok', service: 'search-service', timestamp: new Date().toISOString() };
  });

  // Routes
  await app.register(searchRoutes);
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main(): Promise<void> {
  await buildApp();

  // Start Redis Streams consumer in background
  const subscriber = new VaultEventSubscriber();
  subscriber.start().catch((err) => {
    app.log.error({ err }, 'VaultEventSubscriber crashed');
  });

  // Graceful shutdown
  const shutdown = async (signal: string): Promise<void> => {
    app.log.info(`Received ${signal}, shutting down...`);
    await app.close();
    await closePool();
    await subscriber.stop();
    process.exit(0);
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  try {
    await app.listen({ port: PORT, host: HOST });
    app.log.info(`search-service listening on ${HOST}:${PORT}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
