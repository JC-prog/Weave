import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import jwt from '@fastify/jwt';
import Redis from 'ioredis';
import { graphRoutes } from './routes/graph';
import { graphManager } from './graph/manager';
import { startVaultSubscriber, stopVaultSubscriber } from './subscribers/vault';

// ─── Redis Factory ────────────────────────────────────────────────────────────
function createRedis(): Redis {
  const host = process.env['REDIS_HOST'] ?? 'localhost';
  const port = parseInt(process.env['REDIS_PORT'] ?? '6379', 10);
  const password = process.env['REDIS_PASSWORD'];

  const redis = new Redis({
    host,
    port,
    password: password ?? undefined,
    maxRetriesPerRequest: 3,
    retryStrategy: (times) => {
      if (times > 10) return null;
      return Math.min(times * 100, 3000);
    },
    lazyConnect: false,
  });

  redis.on('error', (err) => {
    console.error('[redis] Error:', err);
  });

  redis.on('connect', () => {
    console.info('[redis] Connected');
  });

  return redis;
}

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
  });

  // ── Security ────────────────────────────────────────────────────────────────
  await app.register(helmet, {
    contentSecurityPolicy: false,
  });

  await app.register(cors, {
    origin: process.env['CORS_ORIGIN'] ?? '*',
    methods: ['GET', 'OPTIONS'],
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
    service: 'graph-service',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  }));

  app.get('/', async () => ({
    service: 'graph-service',
    version: '0.0.1',
  }));

  // ── Routes ──────────────────────────────────────────────────────────────────
  await app.register(graphRoutes);

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
  const port = parseInt(process.env['PORT'] ?? '3003', 10);
  const host = process.env['HOST'] ?? '0.0.0.0';

  // ── Redis Setup ─────────────────────────────────────────────────────────────
  let subscriberRedis: Redis | null = null;

  try {
    // Subscriber needs its own dedicated connection (XREADGROUP BLOCK
    // ties up the connection while waiting)
    subscriberRedis = createRedis();
    const persistenceRedis = createRedis();

    // Load persisted graphs from Redis before accepting requests
    await graphManager.loadFromRedis(persistenceRedis);
    app.log.info('Graph state loaded from Redis');

    // Start the vault events subscriber loop
    await startVaultSubscriber(subscriberRedis);
    app.log.info('Vault event subscriber started');
  } catch (err) {
    app.log.error({ err }, 'Failed to initialise Redis — graph will start empty');
  }

  // ── Graceful Shutdown ───────────────────────────────────────────────────────
  const shutdown = async (signal: string) => {
    app.log.info({ signal }, 'Shutting down gracefully...');
    try {
      stopVaultSubscriber();

      await app.close();

      if (subscriberRedis) {
        await subscriberRedis.quit();
      }

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
    app.log.info({ address, port }, 'graph-service listening');
  } catch (err) {
    app.log.error({ err }, 'Failed to start graph-service');
    process.exit(1);
  }
}

start();
