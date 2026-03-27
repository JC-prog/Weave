// =============================================================================
// Media / Asset types — used by media-service and the web upload UI
// =============================================================================

export type AssetMimeCategory = 'image' | 'video' | 'audio' | 'document' | 'other';

export interface Asset {
  id: string;
  userId: string;
  vaultId: string | null;
  /** Sanitised filename stored in MinIO */
  filename: string;
  /** Original filename as provided by the user's browser */
  originalName: string;
  mimeType: string;
  /** Derived MIME category for quick UI filtering */
  mimeCategory: AssetMimeCategory;
  sizeBytes: number;
  /** MinIO object key, e.g. vaults/{vaultId}/assets/{filename} */
  storageKey: string;
  /** Text extracted via OCR or PDF parsing — null until extraction is done */
  extractedText: string | null;
  /** Arbitrary key/value metadata (image dimensions, page count, etc.) */
  metadata: Record<string, unknown>;
  createdAt: string; // ISO 8601
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// DTOs
// ---------------------------------------------------------------------------

export interface UploadAssetDto {
  vaultId?: string;
  /**
   * Multipart form-data file field is handled by the HTTP layer;
   * this DTO covers the additional JSON body fields.
   */
  description?: string;
  /** Optional tags to attach to the asset for later filtering */
  tags?: string[];
}

export interface UpdateAssetDto {
  originalName?: string;
  vaultId?: string | null;
  metadata?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Responses
// ---------------------------------------------------------------------------

export interface AssetResponse extends Asset {
  /** Presigned URL valid for a short period — generated on each GET */
  downloadUrl: string;
  /** Presigned URL for inline (browser preview) access */
  previewUrl?: string;
}

export interface UploadedAssetResponse {
  asset: AssetResponse;
  /** True when text extraction has been queued but not yet completed */
  extractionPending: boolean;
}

export interface BulkDeleteAssetsDto {
  assetIds: string[];
}

export interface BulkDeleteAssetsResponse {
  deleted: string[];
  failed: Array<{ id: string; reason: string }>;
}

// ---------------------------------------------------------------------------
// Presigned URL helpers
// ---------------------------------------------------------------------------

export interface PresignedUrlRequest {
  assetId: string;
  /** Seconds until the URL expires; default 3600 */
  expiresIn?: number;
  /** 'attachment' = download prompt, 'inline' = browser render */
  disposition?: 'attachment' | 'inline';
}

export interface PresignedUrlResponse {
  url: string;
  expiresAt: string;
}
