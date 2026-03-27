// =============================================================================
// Redis Stream event types
// All events share a common base and are discriminated via `eventType`.
// =============================================================================

export enum EventType {
  // Vault / Note lifecycle
  NOTE_CREATED = 'note.created',
  NOTE_UPDATED = 'note.updated',
  NOTE_DELETED = 'note.deleted',

  // Folder lifecycle
  FOLDER_CREATED = 'folder.created',
  FOLDER_UPDATED = 'folder.updated',
  FOLDER_DELETED = 'folder.deleted',

  // Tag lifecycle
  TAG_CREATED = 'tag.created',
  TAG_UPDATED = 'tag.updated',
  TAG_DELETED = 'tag.deleted',

  // Embedding / Search
  EMBEDDING_REQUESTED = 'embedding.requested',
  EMBEDDING_COMPLETED = 'embedding.completed',
  EMBEDDING_FAILED    = 'embedding.failed',

  // Media
  ASSET_UPLOADED     = 'asset.uploaded',
  ASSET_DELETED      = 'asset.deleted',
  EXTRACTION_COMPLETED = 'extraction.completed',
}

// ---------------------------------------------------------------------------
// Base event
// ---------------------------------------------------------------------------

interface BaseEvent {
  /** The stream event id (set by Redis, forwarded for tracing) */
  streamId?: string;
  /** ISO 8601 timestamp */
  timestamp: string;
  userId: string;
  vaultId: string;
}

// ---------------------------------------------------------------------------
// Note events
// ---------------------------------------------------------------------------

export interface NoteCreatedEvent extends BaseEvent {
  eventType: EventType.NOTE_CREATED;
  noteId: string;
  noteTitle: string;
  folderId: string | null;
  tagIds: string[];
  wordCount: number;
  slug: string | null;
}

export interface NoteUpdatedEvent extends BaseEvent {
  eventType: EventType.NOTE_UPDATED;
  noteId: string;
  noteTitle: string;
  /** Fields that were actually changed in this update */
  changedFields: Array<'title' | 'content' | 'frontmatter' | 'folderId' | 'tags' | 'slug'>;
  folderId: string | null;
  tagIds: string[];
  wordCount: number;
  slug: string | null;
  /** sha-256 of the new content, used by search-service to decide re-indexing */
  contentHash: string;
}

export interface NoteDeletedEvent extends BaseEvent {
  eventType: EventType.NOTE_DELETED;
  noteId: string;
  noteTitle: string;
}

// ---------------------------------------------------------------------------
// Folder events
// ---------------------------------------------------------------------------

export interface FolderCreatedEvent extends BaseEvent {
  eventType: EventType.FOLDER_CREATED;
  folderId: string;
  folderName: string;
  parentId: string | null;
  path: string;
}

export interface FolderUpdatedEvent extends BaseEvent {
  eventType: EventType.FOLDER_UPDATED;
  folderId: string;
  folderName: string;
  parentId: string | null;
  path: string;
}

export interface FolderDeletedEvent extends BaseEvent {
  eventType: EventType.FOLDER_DELETED;
  folderId: string;
  path: string;
}

// ---------------------------------------------------------------------------
// Tag events
// ---------------------------------------------------------------------------

export interface TagCreatedEvent extends BaseEvent {
  eventType: EventType.TAG_CREATED;
  tagId: string;
  tagName: string;
  color: string | null;
}

export interface TagUpdatedEvent extends BaseEvent {
  eventType: EventType.TAG_UPDATED;
  tagId: string;
  tagName: string;
  color: string | null;
}

export interface TagDeletedEvent extends BaseEvent {
  eventType: EventType.TAG_DELETED;
  tagId: string;
  tagName: string;
}

// ---------------------------------------------------------------------------
// Embedding events
// ---------------------------------------------------------------------------

export interface EmbeddingRequestedEvent extends BaseEvent {
  eventType: EventType.EMBEDDING_REQUESTED;
  noteId: string;
  contentHash: string;
  embeddingModel: string;
}

export interface EmbeddingCompletedEvent extends BaseEvent {
  eventType: EventType.EMBEDDING_COMPLETED;
  noteId: string;
  contentHash: string;
  embeddingModel: string;
  vectorId: string;
}

export interface EmbeddingFailedEvent extends BaseEvent {
  eventType: EventType.EMBEDDING_FAILED;
  noteId: string;
  error: string;
}

// ---------------------------------------------------------------------------
// Media events
// ---------------------------------------------------------------------------

export interface AssetUploadedEvent extends BaseEvent {
  eventType: EventType.ASSET_UPLOADED;
  assetId: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  storageKey: string;
}

export interface AssetDeletedEvent extends BaseEvent {
  eventType: EventType.ASSET_DELETED;
  assetId: string;
  storageKey: string;
}

export interface ExtractionCompletedEvent extends BaseEvent {
  eventType: EventType.EXTRACTION_COMPLETED;
  assetId: string;
  extractedTextLength: number;
}

// ---------------------------------------------------------------------------
// Union types — convenient for switch-based consumers
// ---------------------------------------------------------------------------

export type NoteEvent = NoteCreatedEvent | NoteUpdatedEvent | NoteDeletedEvent;

export type FolderEvent = FolderCreatedEvent | FolderUpdatedEvent | FolderDeletedEvent;

export type TagEvent = TagCreatedEvent | TagUpdatedEvent | TagDeletedEvent;

export type EmbeddingEvent =
  | EmbeddingRequestedEvent
  | EmbeddingCompletedEvent
  | EmbeddingFailedEvent;

export type MediaEvent = AssetUploadedEvent | AssetDeletedEvent | ExtractionCompletedEvent;

export type VaultEvent = NoteEvent | FolderEvent | TagEvent;

export type AppEvent = VaultEvent | EmbeddingEvent | MediaEvent;
