import sharp from 'sharp';

// ─── Types ────────────────────────────────────────────────────────────────────
export interface ImageMetadata {
  width: number;
  height: number;
  format: string;
  channels?: number;
  hasAlpha?: boolean;
  size?: number;
}

// ─── Image Operations ─────────────────────────────────────────────────────────

/**
 * Extract metadata (dimensions, format) from an image buffer.
 *
 * @param buffer  Raw image data (JPEG, PNG, WebP, GIF, TIFF, AVIF, etc.)
 * @returns       Width, height, and format string
 */
export async function getImageMetadata(buffer: Buffer): Promise<ImageMetadata> {
  const metadata = await sharp(buffer).metadata();

  return {
    width: metadata.width ?? 0,
    height: metadata.height ?? 0,
    format: metadata.format ?? 'unknown',
    channels: metadata.channels,
    hasAlpha: metadata.hasAlpha,
    size: metadata.size,
  };
}

/**
 * Generate a square thumbnail from an image buffer.
 *
 * Uses `sharp`'s `cover` fit strategy so the thumbnail fills the requested
 * dimensions without distortion (crops excess content from the edges).
 *
 * @param buffer  Raw source image data
 * @param size    Thumbnail side length in pixels (default: 256)
 * @returns       JPEG-encoded thumbnail as a Buffer
 */
export async function generateThumbnail(buffer: Buffer, size = 256): Promise<Buffer> {
  return sharp(buffer)
    .resize(size, size, {
      fit: 'cover',
      position: 'centre',
      withoutEnlargement: false,
    })
    .jpeg({
      quality: 80,
      progressive: true,
      mozjpeg: true,
    })
    .toBuffer();
}
