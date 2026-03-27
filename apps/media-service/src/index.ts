import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import fastifyJwt from '@fastify/jwt';
import multipart from '@fastify/multipart';
import type { FastifyRequest, FastifyReply } from 'fastify';
import uploadRoutes from './routes/upload';
import assetRoutes from './routes/assets';
import { initDb, closeDb } from './db';

// ─── Environment ──────────────────────────────────────────────────────────────
const PORT = Number(process.env['PORT'] ?? 3007);
const HOST = process.env['HOST'] ?? '0.0.0.0';
const JWT_ACCESS_SECRET = process.env['JWT_ACCESS_SECRET'];
const NODE_ENV = process.env['NODE_ENV'] ?? 'development';
const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50 MB

if (!JWT_ACCESS_SECRET) {
  throw new Error('JWT_ACCESS_SECRET environment variable is required');
}

// ─── JWT Types ────────────────────────────────────────────────────────────────
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

// ─── App ──────────────────────────────────────────────────────────────────────
const app = Fastify({
  logger: {
    level: NODE_ENV === 'production' ? 'info' : 'debug',
    transport:
      NODE_ENV !== 'production'
        ? { target: 'pino-pretty', options: { colorize: true } }
        : undefined,
  },
  // Increase body limit for presigned URL uploads
  bodyLimit: MAX_FILE_SIZE,
});

async function buildApp(): Promise<void> {
  // Security
  await app.register(helmet, { global: true });
  await app.register(cors, {
    origin: process.env['CORS_ORIGIN'] ?? '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  });

  // Multipart support for file uploads
  await app.register(multipart, {
    limits: {
      fileSize: MAX_FILE_SIZE,
      files: 1,
    },
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
    return {
      status: 'ok',
      service: 'media-service',
      timestamp: new Date().toISOString(),
    };
  });

  // Routes
  await app.register(uploadRoutes);
  await app.register(assetRoutes);
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main(): Promise<void> {
  await buildApp();

  // Initialise DB schema
  await initDb();

  // Graceful shutdown
  const shutdown = async (signal: string): Promise<void> => {
    app.log.info(`Received ${signal}, shutting down...`);
    await app.close();
    await closeDb();
    process.exit(0);
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  try {
    await app.listen({ port: PORT, host: HOST });
    app.log.info(`media-service listening on ${HOST}:${PORT}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
