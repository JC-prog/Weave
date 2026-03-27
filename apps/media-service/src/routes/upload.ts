import path from 'path';
import { Readable } from 'stream';
import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { v4 as uuidv4 } from 'uuid';
import { eq } from 'drizzle-orm';
import { db, schema } from '../db';
import {
  uploadFile,
  getPresignedUrl,
  ensureBucket,
  DEFAULT_BUCKET,
} from '../storage/minio';
import { extractTextFromPDF, extractMetadata as extractPDFMetadata } from '../extractors/pdf';
import { getImageMetadata, generateThumbnail } from '../extractors/image';

// ─── Constants ────────────────────────────────────────────────────────────────
const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50 MB

const ALLOWED_MIME_TYPES = new Set([
  // Images
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/avif',
  'image/tiff',
  'image/svg+xml',
  // PDFs
  'application/pdf',
  // Text
  'text/plain',
  'text/markdown',
  'text/html',
  'text/csv',
  // Audio
  'audio/mpeg',
  'audio/mp4',
  'audio/wav',
  'audio/ogg',
  'audio/webm',
  'audio/aac',
]);

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getExtensionFromMime(mimeType: string): string {
  const map: Record<string, string> = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/gif': 'gif',
    'image/webp': 'webp',
    'image/avif': 'avif',
    'image/tiff': 'tif',
    'image/svg+xml': 'svg',
    'application/pdf': 'pdf',
    'text/plain': 'txt',
    'text/markdown': 'md',
    'text/html': 'html',
    'text/csv': 'csv',
    'audio/mpeg': 'mp3',
    'audio/mp4': 'm4a',
    'audio/wav': 'wav',
    'audio/ogg': 'ogg',
    'audio/webm': 'webm',
    'audio/aac': 'aac',
  };
  return map[mimeType] ?? 'bin';
}

async function streamToBuffer(stream: Readable): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    stream.on('data', (chunk: Buffer) => chunks.push(chunk));
    stream.on('end', () => resolve(Buffer.concat(chunks)));
    stream.on('error', reject);
  });
}

// ─── Upload Plugin ────────────────────────────────────────────────────────────
const uploadRoutes: FastifyPluginAsync = async (fastify: FastifyInstance) => {
  /**
   * POST /media/upload
   * Accepts multipart/form-data with a single "file" field.
   * Optional fields: vaultId, noteId.
   */
  fastify.post(
    '/media/upload',
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const userId = (request.user as { sub: string }).sub;

      if (!request.isMultipart()) {
        return reply.status(400).send({ error: 'Request must be multipart/form-data' });
      }

      let fileBuffer: Buffer | null = null;
      let mimeType = 'application/octet-stream';
      let originalName = 'upload';
      let vaultId: string | undefined;
      let noteId: string | undefined;

      // ── Parse multipart form ────────────────────────────────────────────
      const parts = request.parts();
      for await (const part of parts) {
        if (part.type === 'file' && part.fieldname === 'file') {
          mimeType = part.mimetype;
          originalName = part.filename ?? 'upload';
          fileBuffer = await streamToBuffer(part.file);
        } else if (part.type === 'field') {
          if (part.fieldname === 'vaultId') vaultId = part.value as string;
          if (part.fieldname === 'noteId') noteId = part.value as string;
        }
      }

      if (!fileBuffer) {
        return reply.status(400).send({ error: 'No file field found in the request' });
      }

      // ── Validate ─────────────────────────────────────────────────────────
      if (!ALLOWED_MIME_TYPES.has(mimeType)) {
        return reply.status(415).send({
          error: `Unsupported media type: ${mimeType}`,
          allowed: Array.from(ALLOWED_MIME_TYPES),
        });
      }

      if (fileBuffer.length > MAX_FILE_SIZE) {
        return reply.status(413).send({
          error: `File too large. Maximum size is ${MAX_FILE_SIZE / 1024 / 1024} MB`,
        });
      }

      // ── Build storage key ────────────────────────────────────────────────
      const ext = path.extname(originalName) || `.${getExtensionFromMime(mimeType)}`;
      const assetId = uuidv4();
      const storageKey = `${userId}/${assetId}${ext}`;

      await ensureBucket(DEFAULT_BUCKET);

      // ── Process by type ──────────────────────────────────────────────────
      let extractedText: string | undefined;
      let thumbnailKey: string | undefined;
      let fileMetadata: Record<string, unknown> = {};

      if (mimeType === 'application/pdf') {
        const [text, pdfMeta] = await Promise.all([
          extractTextFromPDF(fileBuffer),
          extractPDFMetadata(fileBuffer),
        ]);
        extractedText = text;
        fileMetadata = pdfMeta as Record<string, unknown>;
      } else if (mimeType.startsWith('image/') && mimeType !== 'image/svg+xml') {
        const [imgMeta, thumbBuffer] = await Promise.all([
          getImageMetadata(fileBuffer),
          generateThumbnail(fileBuffer, 256),
        ]);
        fileMetadata = imgMeta as Record<string, unknown>;

        // Upload thumbnail
        thumbnailKey = `${userId}/${assetId}_thumb.jpg`;
        await uploadFile(thumbnailKey, thumbBuffer, 'image/jpeg', thumbBuffer.length);
      } else if (mimeType.startsWith('text/')) {
        extractedText = fileBuffer.toString('utf-8');
      }

      // ── Upload original file to MinIO ─────────────────────────────────────
      await uploadFile(storageKey, fileBuffer, mimeType, fileBuffer.length);

      // ── Persist to DB ────────────────────────────────────────────────────
      const [asset] = await db
        .insert(schema.assets)
        .values({
          id: assetId,
          userId,
          vaultId: vaultId ?? null,
          noteId: noteId ?? null,
          originalName,
          storageKey,
          mimeType,
          size: fileBuffer.length,
          extractedText: extractedText ?? null,
          thumbnailKey: thumbnailKey ?? null,
          metadata: fileMetadata,
        })
        .returning();

      // ── Generate presigned URL for the response ──────────────────────────
      const url = await getPresignedUrl(storageKey, 3600);

      return reply.status(201).send({
        id: asset.id,
        originalName: asset.originalName,
        mimeType: asset.mimeType,
        size: asset.size,
        url,
        thumbnailUrl: thumbnailKey ? await getPresignedUrl(thumbnailKey, 3600) : undefined,
        hasExtractedText: Boolean(extractedText),
        metadata: fileMetadata,
        createdAt: asset.createdAt,
      });
    },
  );

  /**
   * POST /media/upload/url
   * Fetch a remote URL and store it as an asset.
   * Body: { url: string, vaultId?: string, noteId?: string }
   */
  fastify.post(
    '/media/upload/url',
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const userId = (request.user as { sub: string }).sub;
      const body = request.body as { url?: string; vaultId?: string; noteId?: string };

      if (!body.url) {
        return reply.status(400).send({ error: 'url field is required' });
      }

      let remoteUrl: URL;
      try {
        remoteUrl = new URL(body.url);
      } catch {
        return reply.status(400).send({ error: 'Invalid URL' });
      }

      // Fetch the remote resource
      const response = await fetch(remoteUrl.toString(), {
        signal: AbortSignal.timeout(30_000),
        headers: { 'User-Agent': 'NotebookLM-MediaService/1.0' },
      });

      if (!response.ok) {
        return reply.status(422).send({
          error: `Remote URL returned ${response.status}: ${response.statusText}`,
        });
      }

      const contentType = response.headers.get('content-type') ?? 'application/octet-stream';
      const mimeType = contentType.split(';')[0]?.trim() ?? 'application/octet-stream';

      if (!ALLOWED_MIME_TYPES.has(mimeType)) {
        return reply.status(415).send({ error: `Unsupported media type: ${mimeType}` });
      }

      const arrayBuffer = await response.arrayBuffer();
      const fileBuffer = Buffer.from(arrayBuffer);

      if (fileBuffer.length > MAX_FILE_SIZE) {
        return reply.status(413).send({ error: 'Remote file exceeds 50 MB limit' });
      }

      // Derive filename from URL path
      const urlPath = remoteUrl.pathname;
      const originalName = path.basename(urlPath) || 'downloaded-file';
      const ext = path.extname(originalName) || `.${getExtensionFromMime(mimeType)}`;
      const assetId = uuidv4();
      const storageKey = `${userId}/${assetId}${ext}`;

      await ensureBucket(DEFAULT_BUCKET);
      await uploadFile(storageKey, fileBuffer, mimeType, fileBuffer.length);

      let extractedText: string | undefined;
      let fileMetadata: Record<string, unknown> = {};

      if (mimeType === 'application/pdf') {
        const [text, meta] = await Promise.all([
          extractTextFromPDF(fileBuffer),
          extractPDFMetadata(fileBuffer),
        ]);
        extractedText = text;
        fileMetadata = meta as Record<string, unknown>;
      } else if (mimeType.startsWith('text/')) {
        extractedText = fileBuffer.toString('utf-8');
      }

      const [asset] = await db
        .insert(schema.assets)
        .values({
          id: assetId,
          userId,
          vaultId: body.vaultId ?? null,
          noteId: body.noteId ?? null,
          originalName,
          storageKey,
          mimeType,
          size: fileBuffer.length,
          extractedText: extractedText ?? null,
          metadata: fileMetadata,
        })
        .returning();

      const url = await getPresignedUrl(storageKey, 3600);

      return reply.status(201).send({
        id: asset.id,
        originalName: asset.originalName,
        mimeType: asset.mimeType,
        size: asset.size,
        url,
        hasExtractedText: Boolean(extractedText),
        metadata: fileMetadata,
        sourceUrl: body.url,
        createdAt: asset.createdAt,
      });
    },
  );
};

export default uploadRoutes;
