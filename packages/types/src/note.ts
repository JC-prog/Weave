// =============================================================================
// Note, Folder, Vault, Tag and related types
// =============================================================================

export interface Vault {
  id: string;
  userId: string;
  name: string;
  description: string | null;
  isPublic: boolean;
  createdAt: string; // ISO 8601
  updatedAt: string;
}

export interface Folder {
  id: string;
  vaultId: string;
  parentId: string | null;
  name: string;
  /** Full materialized path, e.g. /docs/api */
  path: string;
  createdAt: string;
  updatedAt: string;
}

export interface Note {
  id: string;
  vaultId: string;
  folderId: string | null;
  title: string;
  content: string;
  /** YAML front-matter parsed into a key-value map */
  frontmatter: Record<string, unknown>;
  slug: string | null;
  wordCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface Tag {
  id: string;
  vaultId: string;
  name: string;
  /** Hex colour string, e.g. #ff5733 */
  color: string | null;
  createdAt: string;
}

export interface NoteTag {
  noteId: string;
  tagId: string;
}

export interface Wikilink {
  id: string;
  sourceNoteId: string;
  /** Raw [[target]] text as written by the author */
  targetTitle: string;
  /** Resolved note id — null when the target note does not yet exist */
  targetNoteId: string | null;
  createdAt: string;
}

// =============================================================================
// Composite / enriched types
// =============================================================================

export interface NoteWithRelations extends Note {
  tags: Tag[];
  wikilinks: Wikilink[];
  folder: Folder | null;
}

export interface FolderWithChildren extends Folder {
  children: FolderWithChildren[];
  noteCount: number;
}

// =============================================================================
// DTOs
// =============================================================================

export interface CreateVaultDto {
  name: string;
  description?: string;
  isPublic?: boolean;
}

export interface UpdateVaultDto {
  name?: string;
  description?: string;
  isPublic?: boolean;
}

export interface CreateFolderDto {
  vaultId: string;
  parentId?: string;
  name: string;
}

export interface UpdateFolderDto {
  name?: string;
  parentId?: string | null;
}

export interface CreateNoteDto {
  vaultId: string;
  folderId?: string;
  title: string;
  content?: string;
  frontmatter?: Record<string, unknown>;
  tagIds?: string[];
}

export interface UpdateNoteDto {
  title?: string;
  content?: string;
  folderId?: string | null;
  frontmatter?: Record<string, unknown>;
  tagIds?: string[];
}

export interface CreateTagDto {
  vaultId: string;
  name: string;
  color?: string;
}

export interface UpdateTagDto {
  name?: string;
  color?: string | null;
}

// =============================================================================
// Pagination helpers
// =============================================================================

export interface PaginationQuery {
  page?: number;
  limit?: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}
