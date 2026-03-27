import Fastify from 'fastify';
import fastifyCors from '@fastify/cors';
import fastifyHelmet from '@fastify/helmet';
import jwtPlugin from './plugins/jwt';
import authRoutes from './routes/auth';
import keysRoutes from './routes/keys';
import { closeDb } from './db';

// ─── Bootstrap ────────────────────────────────────────────────────────────────
async function bootstrap(): Promise<void> {
  const PORT = parseInt(process.env['PORT'] ?? '3001', 10);
  const HOST = process.env['HOST'] ?? '0.0.0.0';
  const LOG_LEVEL = process.env['LOG_LEVEL'] ?? 'info';

  const fastify = Fastify({
    logger: {
      level: LOG_LEVEL,
      transport:
        process.env['NODE_ENV'] === 'development'
          ? { target: 'pino-pretty', options: { colorize: true } }
          : undefined,
    },
    trustProxy: true,
    ajv: {
      customOptions: {
        removeAdditional: 'all',
        coerceTypes: true,
        allErrors: true,
      },
    },
  });

  // ── Plugins ──────────────────────────────────────────────────────────────
  await fastify.register(fastifyHelmet, {
    contentSecurityPolicy: false, // API service, not serving HTML
  });

  await fastify.register(fastifyCors, {
    origin: (process.env['ALLOWED_ORIGINS'] ?? '*').split(',').map((o) => o.trim()),
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true,
  });

  await fastify.register(jwtPlugin);

  // ── Routes ────────────────────────────────────────────────────────────────
  await fastify.register(authRoutes);
  await fastify.register(keysRoutes);

  // ── Health Check ──────────────────────────────────────────────────────────
  fastify.get('/health', async (_request, reply) => {
    return reply.status(200).send({
      status: 'ok',
      service: 'auth-service',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
    });
  });

  // ── Global Error Handler ──────────────────────────────────────────────────
  fastify.setErrorHandler((error, request, reply) => {
    fastify.log.error(
      { err: error, url: request.url, method: request.method },
      'Unhandled error'
    );

    const statusCode = error.statusCode ?? 500;

    return reply.status(statusCode).send({
      statusCode,
      error: statusCode >= 500 ? 'Internal Server Error' : error.name,
      message:
        statusCode >= 500 && process.env['NODE_ENV'] === 'production'
          ? 'An unexpected error occurred'
          : error.message,
    });
  });

  // ── Not Found Handler ─────────────────────────────────────────────────────
  fastify.setNotFoundHandler((request, reply) => {
    return reply.status(404).send({
      statusCode: 404,
      error: 'Not Found',
      message: `Route ${request.method} ${request.url} not found`,
    });
  });

  // ── Graceful Shutdown ─────────────────────────────────────────────────────
  const shutdown = async (signal: string): Promise<void> => {
    fastify.log.info({ signal }, 'Shutdown signal received');
    try {
      await fastify.close();
      await closeDb();
      fastify.log.info('Server closed gracefully');
      process.exit(0);
    } catch (err) {
      fastify.log.error({ err }, 'Error during shutdown');
      process.exit(1);
    }
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  // ── Start ─────────────────────────────────────────────────────────────────
  try {
    await fastify.listen({ port: PORT, host: HOST });
    fastify.log.info({ port: PORT, host: HOST }, 'Auth service started');
  } catch (err) {
    fastify.log.error({ err }, 'Failed to start auth service');
    process.exit(1);
  }
}

void bootstrap();
