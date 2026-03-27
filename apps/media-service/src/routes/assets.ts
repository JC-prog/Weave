import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { eq, and, desc } from 'drizzle-orm';
import { db, schema } from '../db';
import { getPresignedUrl, deleteFile } from '../storage/minio';

// ─── Assets Plugin ────────────────────────────────────────────────────────────
const assetRoutes: FastifyPluginAsync = async (fastify: FastifyInstance) => {
  /**
   * GET /media/assets
   * List all assets owned by the authenticated user.
   * Optional query params: vaultId, limit, offset
   */
  fastify.get(
    '/media/assets',
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const userId = (request.user as { sub: string }).sub;
      const query = request.query as {
        vaultId?: string;
        limit?: string;
        offset?: string;
      };

      const limit = Math.min(Number(query.limit ?? 50), 100);
      const offset = Number(query.offset ?? 0);

      const conditions = [eq(schema.assets.userId, userId)];
      if (query.vaultId) {
        conditions.push(eq(schema.assets.vaultId, query.vaultId));
      }

      const rows = await db
        .select()
        .from(schema.assets)
        .where(and(...conditions))
        .orderBy(desc(schema.assets.createdAt))
        .limit(limit)
        .offset(offset);

      // Generate presigned URLs for each asset (batch)
      const assetsWithUrls = await Promise.all(
        rows.map(async (asset) => {
          const url = await getPresignedUrl(asset.storageKey, 3600).catch(() => null);
          const thumbnailUrl = asset.thumbnailKey
            ? await getPresignedUrl(asset.thumbnailKey, 3600).catch(() => null)
            : null;
          return {
            id: asset.id,
            originalName: asset.originalName,
            mimeType: asset.mimeType,
            size: asset.size,
            url,
            thumbnailUrl,
            metadata: asset.metadata,
            isIndexed: asset.isIndexed,
            hasExtractedText: Boolean(asset.extractedText),
            vaultId: asset.vaultId,
            noteId: asset.noteId,
            createdAt: asset.createdAt,
            updatedAt: asset.updatedAt,
          };
        }),
      );

      return reply.status(200).send({ assets: assetsWithUrls, total: assetsWithUrls.length });
    },
  );

  /**
   * GET /media/assets/:id
   * Get a single asset by ID, including a fresh presigned download URL.
   */
  fastify.get<{ Params: { id: string } }>(
    '/media/assets/:id',
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const userId = (request.user as { sub: string }).sub;
      const { id } = request.params;

      const [asset] = await db
        .select()
        .from(schema.assets)
        .where(and(eq(schema.assets.id, id), eq(schema.assets.userId, userId)));

      if (!asset) {
        return reply.status(404).send({ error: 'Asset not found' });
      }

      const url = await getPresignedUrl(asset.storageKey, 3600);
      const thumbnailUrl = asset.thumbnailKey
        ? await getPresignedUrl(asset.thumbnailKey, 3600)
        : null;

      return reply.status(200).send({
        id: asset.id,
        originalName: asset.originalName,
        mimeType: asset.mimeType,
        size: asset.size,
        url,
        thumbnailUrl,
        metadata: asset.metadata,
        isIndexed: asset.isIndexed,
        hasExtractedText: Boolean(asset.extractedText),
        vaultId: asset.vaultId,
        noteId: asset.noteId,
        createdAt: asset.createdAt,
        updatedAt: asset.updatedAt,
      });
    },
  );

  /**
   * DELETE /media/assets/:id
   * Delete an asset from both MinIO and the database.
   */
  fastify.delete<{ Params: { id: string } }>(
    '/media/assets/:id',
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const userId = (request.user as { sub: string }).sub;
      const { id } = request.params;

      const [asset] = await db
        .select()
        .from(schema.assets)
        .where(and(eq(schema.assets.id, id), eq(schema.assets.userId, userId)));

      if (!asset) {
        return reply.status(404).send({ error: 'Asset not found' });
      }

      // Delete from MinIO (best effort — continue even if object is missing)
      await Promise.allSettled([
        deleteFile(asset.storageKey),
        asset.thumbnailKey ? deleteFile(asset.thumbnailKey) : Promise.resolve(),
      ]);

      // Delete from DB
      await db
        .delete(schema.assets)
        .where(and(eq(schema.assets.id, id), eq(schema.assets.userId, userId)));

      return reply.status(204).send();
    },
  );

  /**
   * GET /media/assets/:id/text
   * Return the extracted text content of an asset (for AI ingestion).
   * Only available for assets where text extraction was performed (PDFs, text files).
   */
  fastify.get<{ Params: { id: string } }>(
    '/media/assets/:id/text',
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const userId = (request.user as { sub: string }).sub;
      const { id } = request.params;

      const [asset] = await db
        .select({
          id: schema.assets.id,
          originalName: schema.assets.originalName,
          mimeType: schema.assets.mimeType,
          extractedText: schema.assets.extractedText,
          userId: schema.assets.userId,
        })
        .from(schema.assets)
        .where(and(eq(schema.assets.id, id), eq(schema.assets.userId, userId)));

      if (!asset) {
        return reply.status(404).send({ error: 'Asset not found' });
      }

      if (!asset.extractedText) {
        return reply.status(404).send({
          error: 'No extracted text available for this asset',
          mimeType: asset.mimeType,
        });
      }

      return reply.status(200).send({
        id: asset.id,
        originalName: asset.originalName,
        mimeType: asset.mimeType,
        text: asset.extractedText,
        characterCount: asset.extractedText.length,
        wordCount: asset.extractedText.split(/\s+/).filter(Boolean).length,
      });
    },
  );
};

export default assetRoutes;
