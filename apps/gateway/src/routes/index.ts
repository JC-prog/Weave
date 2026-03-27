import fp from 'fastify-plugin';
import fastifyReplyFrom from '@fastify/reply-from';
import type { FastifyInstance, FastifyPluginOptions, FastifyRequest, FastifyReply } from 'fastify';
import type { IncomingMessage } from 'http';

// ─── Service URLs ─────────────────────────────────────────────────────────────
function getServiceUrl(envVar: string, fallback: string): string {
  return process.env[envVar] ?? fallback;
}

// ─── SSE Headers ─────────────────────────────────────────────────────────────
function isSseRequest(request: FastifyRequest): boolean {
  return request.headers['accept'] === 'text/event-stream';
}

function applySseHeaders(reply: FastifyReply): void {
  void reply.header('Content-Type', 'text/event-stream');
  void reply.header('Cache-Control', 'no-cache');
  void reply.header('Connection', 'keep-alive');
  void reply.header('X-Accel-Buffering', 'no');
}

// ─── Proxy Routes Plugin ──────────────────────────────────────────────────────
async function proxyRoutes(
  fastify: FastifyInstance,
  _opts: FastifyPluginOptions
): Promise<void> {
  const AUTH_SERVICE_URL   = getServiceUrl('AUTH_SERVICE_URL',   'http://auth-service:3001');
  const VAULT_SERVICE_URL  = getServiceUrl('VAULT_SERVICE_URL',  'http://vault-service:3002');
  const GRAPH_SERVICE_URL  = getServiceUrl('GRAPH_SERVICE_URL',  'http://graph-service:3003');
  const SEARCH_SERVICE_URL = getServiceUrl('SEARCH_SERVICE_URL', 'http://search-service:3004');
  const AI_SERVICE_URL     = getServiceUrl('AI_SERVICE_URL',     'http://ai-service:3005');
  const MEDIA_SERVICE_URL  = getServiceUrl('MEDIA_SERVICE_URL',  'http://media-service:3006');

  // Register reply-from for upstream proxying
  await fastify.register(fastifyReplyFrom, {
    base: undefined, // We specify per-request
    undici: {
      connections: 100,
      pipelining: 1,
      keepAliveTimeout: 60_000,
      keepAliveMaxTimeout: 600_000,
    },
    rewriteRequestHeaders: (request, headers) => {
      // Forward authenticated user info downstream via headers
      const forwardedHeaders: Record<string, string> = {
        ...headers,
        'x-forwarded-for':
          (headers['x-forwarded-for'] as string | undefined) ?? request.ip,
        'x-forwarded-proto': request.protocol,
        'x-forwarded-host': request.hostname,
        'x-request-id':
          (request.id as string | undefined) ??
          Math.random().toString(36).slice(2),
      };

      // Attach authenticated user context if available
      if (request.user) {
        forwardedHeaders['x-user-id'] = request.user.sub;
        forwardedHeaders['x-user-email'] = request.user.email;
      }

      return forwardedHeaders;
    },
  });

  // ── Helper: build upstream URL ─────────────────────────────────────────────
  function upstreamUrl(base: string, request: FastifyRequest): string {
    const url = request.url;
    return `${base}${url}`;
  }

  // ── Helper: proxy handler factory ─────────────────────────────────────────
  function makeProxyHandler(serviceUrl: string) {
    return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
      const target = upstreamUrl(serviceUrl, request);

      if (isSseRequest(request)) {
        applySseHeaders(reply);
      }

      return reply.from(target, {
        rewriteRequestHeaders: (_originalReq, headers) => headers,
        onError: (_reply, error) => {
          fastify.log.error(
            { err: error, target },
            'Upstream proxy error'
          );
          // reply-from handles sending the error
        },
      });
    };
  }

  // ── Helper: proxy with body passthrough for streaming ─────────────────────
  function makeStreamingProxyHandler(serviceUrl: string) {
    return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
      const target = upstreamUrl(serviceUrl, request);

      // SSE / streaming support
      if (isSseRequest(request)) {
        applySseHeaders(reply);

        // Disable compression for SSE
        reply.header('Transfer-Encoding', 'chunked');
      }

      return reply.from(target, {
        rewriteRequestHeaders: (_req, headers) => headers,
        onResponse: (_request, _reply, res: IncomingMessage) => {
          // Ensure chunked transfer for SSE
          const contentType = res.headers['content-type'] ?? '';
          if (contentType.includes('text/event-stream')) {
            applySseHeaders(reply);
          }
        },
      });
    };
  }

  // ── Auth Routes (/api/auth/*) — no JWT required ────────────────────────────
  fastify.all(
    '/api/auth/*',
    { config: { skipAuth: true } },
    async (request: FastifyRequest, reply: FastifyReply) => {
      return reply.from(upstreamUrl(AUTH_SERVICE_URL, request));
    }
  );

  // ── Vault Routes (/api/vault/*) ────────────────────────────────────────────
  fastify.all('/api/vault/*', makeProxyHandler(VAULT_SERVICE_URL));

  // ── Graph Routes (/api/graph/*) ────────────────────────────────────────────
  fastify.all('/api/graph/*', makeProxyHandler(GRAPH_SERVICE_URL));

  // ── Search Routes (/api/search/*) ─────────────────────────────────────────
  fastify.all('/api/search/*', makeProxyHandler(SEARCH_SERVICE_URL));

  // ── AI Routes (/api/ai/*) — supports SSE streaming ────────────────────────
  fastify.all('/api/ai/*', makeStreamingProxyHandler(AI_SERVICE_URL));

  // ── Media Routes (/api/media/*) ────────────────────────────────────────────
  fastify.all('/api/media/*', makeProxyHandler(MEDIA_SERVICE_URL));

  fastify.log.info(
    {
      routes: {
        auth:   AUTH_SERVICE_URL,
        vault:  VAULT_SERVICE_URL,
        graph:  GRAPH_SERVICE_URL,
        search: SEARCH_SERVICE_URL,
        ai:     AI_SERVICE_URL,
        media:  MEDIA_SERVICE_URL,
      },
    },
    'Proxy routes registered'
  );
}

export default fp(proxyRoutes, {
  name: 'proxy-routes',
  fastify: '4.x',
});
