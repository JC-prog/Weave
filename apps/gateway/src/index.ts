import Fastify from 'fastify';
import fastifyCors from '@fastify/cors';
import fastifyHelmet from '@fastify/helmet';
import authPlugin from './plugins/auth';
import rateLimitPlugin from './plugins/ratelimit';
import proxyRoutes from './routes/index';

// ─── Bootstrap ────────────────────────────────────────────────────────────────
async function bootstrap(): Promise<void> {
  const PORT = parseInt(process.env['PORT'] ?? '3000', 10);
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
    // Trust proxy headers (X-Forwarded-For etc.) when behind load balancer
    trustProxy: true,
    // Generate request IDs for tracing
    genReqId: () => `gw-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    ajv: {
      customOptions: {
        removeAdditional: 'all',
        coerceTypes: true,
        allErrors: true,
      },
    },
  });

  // ── Security: Helmet ──────────────────────────────────────────────────────
  await fastify.register(fastifyHelmet, {
    contentSecurityPolicy: false, // Gateway proxies to API services
    crossOriginEmbedderPolicy: false,
  });

  // ── CORS ──────────────────────────────────────────────────────────────────
  await fastify.register(fastifyCors, {
    origin: (process.env['ALLOWED_ORIGINS'] ?? '*').split(',').map((o) => o.trim()),
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-ID'],
    exposedHeaders: [
      'X-RateLimit-Limit',
      'X-RateLimit-Remaining',
      'X-RateLimit-Reset',
      'Retry-After',
    ],
    credentials: true,
    preflight: true,
    strictPreflight: false,
  });

  // ── Rate Limiting ─────────────────────────────────────────────────────────
  await fastify.register(rateLimitPlugin);

  // ── JWT Auth ──────────────────────────────────────────────────────────────
  await fastify.register(authPlugin);

  // ── Proxy Routes ──────────────────────────────────────────────────────────
  await fastify.register(proxyRoutes);

  // ── Health Check ──────────────────────────────────────────────────────────
  fastify.get(
    '/health',
    {
      config: { rateLimit: { max: 300, timeWindow: '1 minute' } },
    },
    async (_request, reply) => {
      return reply.status(200).send({
        status: 'ok',
        service: 'gateway',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        version: process.env['npm_package_version'] ?? '0.0.1',
      });
    }
  );

  // ── Global Error Handler ──────────────────────────────────────────────────
  fastify.setErrorHandler((error, request, reply) => {
    fastify.log.error(
      {
        err: error,
        url: request.url,
        method: request.method,
        reqId: request.id,
      },
      'Unhandled gateway error'
    );

    const statusCode = error.statusCode ?? 500;

    // Surface rate-limit errors with proper status
    if (statusCode === 429) {
      return reply.status(429).send({
        statusCode: 429,
        error: 'Too Many Requests',
        message: error.message,
      });
    }

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
    fastify.log.info({ signal }, 'Shutdown signal received — closing gateway');
    try {
      await fastify.close();
      fastify.log.info('Gateway closed gracefully');
      process.exit(0);
    } catch (err) {
      fastify.log.error({ err }, 'Error during gateway shutdown');
      process.exit(1);
    }
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  // ── Start ─────────────────────────────────────────────────────────────────
  try {
    await fastify.listen({ port: PORT, host: HOST });
    fastify.log.info({ port: PORT, host: HOST }, 'Gateway started');
  } catch (err) {
    fastify.log.error({ err }, 'Failed to start gateway');
    process.exit(1);
  }
}

void bootstrap();
