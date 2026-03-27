import { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { graphManager } from '../graph/manager';

// ─── Schemas ──────────────────────────────────────────────────────────────────
const VaultParams = z.object({
  vaultId: z.string().uuid(),
});

const NodeParams = z.object({
  vaultId: z.string().uuid(),
  noteId: z.string().uuid(),
});

const HubsQuery = z.object({
  top: z.coerce.number().int().min(1).max(50).optional().default(10),
});

// ─── Plugin ───────────────────────────────────────────────────────────────────
export const graphRoutes: FastifyPluginAsync = async (fastify) => {
  // ── GET /graph/vaults/:vaultId ────────────────────────────────────────────────
  fastify.get<{ Params: { vaultId: string } }>(
    '/graph/vaults/:vaultId',
    async (request, reply) => {
      const paramsResult = VaultParams.safeParse(request.params);
      if (!paramsResult.success) {
        return reply.status(400).send({ error: 'Invalid vault ID' });
      }

      const { vaultId } = paramsResult.data;
      const graphData = graphManager.getGraphData(vaultId);

      return reply.send(graphData);
    },
  );

  // ── GET /graph/vaults/:vaultId/nodes/:noteId ──────────────────────────────────
  fastify.get<{ Params: { vaultId: string; noteId: string } }>(
    '/graph/vaults/:vaultId/nodes/:noteId',
    async (request, reply) => {
      const paramsResult = NodeParams.safeParse(request.params);
      if (!paramsResult.success) {
        return reply.status(400).send({ error: 'Invalid params' });
      }

      const { vaultId, noteId } = paramsResult.data;
      const { node, neighbors } = graphManager.getNodeNeighbors(noteId, vaultId);

      if (!node) {
        return reply.status(404).send({ error: 'Node not found in graph' });
      }

      return reply.send({ node, neighbors });
    },
  );

  // ── GET /graph/vaults/:vaultId/orphans ────────────────────────────────────────
  fastify.get<{ Params: { vaultId: string } }>(
    '/graph/vaults/:vaultId/orphans',
    async (request, reply) => {
      const paramsResult = VaultParams.safeParse(request.params);
      if (!paramsResult.success) {
        return reply.status(400).send({ error: 'Invalid vault ID' });
      }

      const { vaultId } = paramsResult.data;
      const orphans = graphManager.getOrphanNodes(vaultId);

      return reply.send({ vaultId, orphans, count: orphans.length });
    },
  );

  // ── GET /graph/vaults/:vaultId/hubs ──────────────────────────────────────────
  fastify.get<{ Params: { vaultId: string } }>(
    '/graph/vaults/:vaultId/hubs',
    async (request, reply) => {
      const paramsResult = VaultParams.safeParse(request.params);
      if (!paramsResult.success) {
        return reply.status(400).send({ error: 'Invalid vault ID' });
      }

      const queryResult = HubsQuery.safeParse(request.query);
      if (!queryResult.success) {
        return reply.status(400).send({ error: 'Invalid query params' });
      }

      const { vaultId } = paramsResult.data;
      const { top } = queryResult.data;

      const hubs = graphManager.getHubNodes(vaultId, top);

      return reply.send({ vaultId, hubs, count: hubs.length });
    },
  );
};

export default graphRoutes;
