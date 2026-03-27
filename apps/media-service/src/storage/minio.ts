import * as Minio from 'minio';

// ─── Environment ──────────────────────────────────────────────────────────────
const MINIO_ENDPOINT = process.env['MINIO_ENDPOINT'] ?? 'minio';
const MINIO_PORT = Number(process.env['MINIO_PORT'] ?? 9000);
const MINIO_USE_SSL = process.env['MINIO_USE_SSL'] === 'true';
const MINIO_ACCESS_KEY = process.env['MINIO_ACCESS_KEY'] ?? 'minioadmin';
const MINIO_SECRET_KEY = process.env['MINIO_SECRET_KEY'] ?? 'minioadmin';

export const DEFAULT_BUCKET = process.env['MINIO_BUCKET'] ?? 'notebooklm-media';

// ─── Client ───────────────────────────────────────────────────────────────────
export const minioClient = new Minio.Client({
  endPoint: MINIO_ENDPOINT,
  port: MINIO_PORT,
  useSSL: MINIO_USE_SSL,
  accessKey: MINIO_ACCESS_KEY,
  secretKey: MINIO_SECRET_KEY,
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Ensure a bucket exists, creating it if it doesn't.
 */
export async function ensureBucket(bucket: string): Promise<void> {
  const exists = await minioClient.bucketExists(bucket);
  if (!exists) {
    await minioClient.makeBucket(bucket, 'us-east-1');
  }
}

/**
 * Upload a file buffer to MinIO.
 *
 * @param key       Object key (path within bucket)
 * @param buffer    File content as a Buffer
 * @param mimeType  MIME type string
 * @param size      File size in bytes
 * @param bucket    Target bucket (default: DEFAULT_BUCKET)
 */
export async function uploadFile(
  key: string,
  buffer: Buffer,
  mimeType: string,
  size: number,
  bucket = DEFAULT_BUCKET,
): Promise<void> {
  await minioClient.putObject(bucket, key, buffer, size, {
    'Content-Type': mimeType,
  });
}

/**
 * Generate a pre-signed URL for downloading an object.
 *
 * @param key           Object key
 * @param expirySeconds Seconds until the URL expires (default: 3600)
 * @param bucket        Bucket name (default: DEFAULT_BUCKET)
 */
export async function getPresignedUrl(
  key: string,
  expirySeconds = 3600,
  bucket = DEFAULT_BUCKET,
): Promise<string> {
  return minioClient.presignedGetObject(bucket, key, expirySeconds);
}

/**
 * Delete an object from MinIO.
 *
 * @param key    Object key
 * @param bucket Bucket name (default: DEFAULT_BUCKET)
 */
export async function deleteFile(key: string, bucket = DEFAULT_BUCKET): Promise<void> {
  await minioClient.removeObject(bucket, key);
}
