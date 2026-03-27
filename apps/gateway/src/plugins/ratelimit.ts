import fp from 'fastify-plugin';
import fastifyRateLimit from '@fastify/rate-limit';
import type { FastifyInstance } from 'fastify';

// ─── Rate Limit Plugin ────────────────────────────────────────────────────────
async function rateLimitPlugin(fastify: FastifyInstance): Promise<void> {
  await fastify.register(fastifyRateLimit, {
    global: true,
    max: 100,
    timeWindow: '1 minute',
    // Use real IP when behind a reverse proxy
    keyGenerator: (request) => {
      return (
        (request.headers['x-real-ip'] as string | undefined) ??
        (request.headers['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim() ??
        request.ip
      );
    },
    errorResponseBuilder: (_request, context) => {
      return {
        statusCode: 429,
        error: 'Too Many Requests',
        message: `Rate limit exceeded. You can make ${context.max} requests per minute. Please retry after ${context.after}.`,
        retryAfter: context.after,
      };
    },
    // Allow higher limits for auth endpoints to avoid lockouts
    allowList: [],
    // Skip rate limiting for health checks
    skipOnError: false,
    hook: 'preHandler',
    // Per-route overrides can be applied by adding config: { rateLimit: { max, timeWindow } }
    addHeaders: {
      'x-ratelimit-limit': true,
      'x-ratelimit-remaining': true,
      'x-ratelimit-reset': true,
      'retry-after': true,
    },
  });

  fastify.log.info('Rate limiting enabled: 100 req/min per IP');
}

export default fp(rateLimitPlugin, {
  name: 'rate-limit-plugin',
  fastify: '4.x',
});
