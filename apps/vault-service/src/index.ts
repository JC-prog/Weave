import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import jwt from '@fastify/jwt';
import { vaultsRoutes } from './routes/vaults';
import { notesRoutes } from './routes/notes';
import { foldersRoutes } from './routes/folders';
import { tagsRoutes } from './routes/tags';
import { initPublisher, closePublisher } from './events/publisher';

// ─── Build App ────────────────────────────────────────────────────────────────
async function buildApp() {
  const app = Fastify({
    logger: {
      level: process.env['LOG_LEVEL'] ?? 'info',
      ...(process.env['NODE_ENV'] !== 'production' && {
        transport: {
          target: 'pino-pretty',
          options: { colorize: true },
        },
      }),
    },
    requestIdHeader: 'x-request-id',
    requestIdLogLabel: 'requestId',
    disableRequestLogging: false,
  });

  // ── Security ────────────────────────────────────────────────────────────────
  await app.register(helmet, {
    contentSecurityPolicy: false,
  });

  await app.register(cors, {
    origin: process.env['CORS_ORIGIN'] ?? '*',
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true,
  });

  // ── JWT ─────────────────────────────────────────────────────────────────────
  const jwtSecret = process.env['JWT_SECRET'];
  if (!jwtSecret) {
    throw new Error('JWT_SECRET environment variable is required');
  }

  await app.register(jwt, {
    secret: jwtSecret,
    sign: { expiresIn: '15m' },
  });

  // ── Auth Hook ───────────────────────────────────────────────────────────────
  app.addHook('onRequest', async (request, reply) => {
    // Skip JWT check for health endpoint
    if (request.url === '/health' || request.url === '/') return;

    try {
      await request.jwtVerify();
    } catch (err) {
      reply.status(401).send({ error: 'Unauthorized', message: 'Invalid or missing JWT' });
    }
  });

  // ── Health Check ────────────────────────────────────────────────────────────
  app.get('/health', async () => ({
    status: 'ok',
    service: 'vault-service',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  }));

  app.get('/', async () => ({
    service: 'vault-service',
    version: '0.0.1',
  }));

  // ── Routes ──────────────────────────────────────────────────────────────────
  await app.register(vaultsRoutes);
  await app.register(notesRoutes);
  await app.register(foldersRoutes);
  await app.register(tagsRoutes);

  // ── Global Error Handler ────────────────────────────────────────────────────
  app.setErrorHandler((error, request, reply) => {
    app.log.error({ err: error, requestId: request.id }, 'Unhandled error');

    if (error.statusCode) {
      return reply.status(error.statusCode).send({
        error: error.name,
        message: error.message,
      });
    }

    return reply.status(500).send({
      error: 'Internal Server Error',
      message:
        process.env['NODE_ENV'] === 'production'
          ? 'An unexpected error occurred'
          : error.message,
    });
  });

  app.setNotFoundHandler((request, reply) => {
    reply.status(404).send({
      error: 'Not Found',
      message: `Route ${request.method} ${request.url} not found`,
    });
  });

  return app;
}

// ─── Start ────────────────────────────────────────────────────────────────────
async function start() {
  const app = await buildApp();
  const port = parseInt(process.env['PORT'] ?? '3002', 10);
  const host = process.env['HOST'] ?? '0.0.0.0';

  // Initialise Redis publisher
  try {
    await initPublisher();
    app.log.info('Redis publisher initialised');
  } catch (err) {
    app.log.error({ err }, 'Failed to connect Redis publisher — events will be dropped');
  }

  // ── Graceful Shutdown ───────────────────────────────────────────────────────
  const shutdown = async (signal: string) => {
    app.log.info({ signal }, 'Shutting down gracefully...');
    try {
      await app.close();
      await closePublisher();
      app.log.info('Server closed');
      process.exit(0);
    } catch (err) {
      app.log.error({ err }, 'Error during shutdown');
      process.exit(1);
    }
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  try {
    const address = await app.listen({ port, host });
    app.log.info({ address, port }, 'vault-service listening');
  } catch (err) {
    app.log.error({ err }, 'Failed to start vault-service');
    process.exit(1);
  }
}

start();
