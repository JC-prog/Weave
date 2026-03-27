// =============================================================================
// AI / Chat types — used by ai-service, gateway, and the web chat panel
// =============================================================================

export type MessageRole = 'user' | 'assistant' | 'system';

/**
 * A single chat message, optionally enriched with grounding sources.
 */
export interface Message {
  id: string;
  conversationId: string;
  role: MessageRole;
  content: string;
  /** Source notes that were retrieved to ground the assistant's answer */
  sources: ChatSource[];
  /** Approximate token count for this message */
  tokenCount?: number;
  createdAt: string; // ISO 8601
}

/**
 * A reference to a note excerpt that was used to answer a question.
 */
export interface ChatSource {
  noteId: string;
  noteTitle: string;
  /** Short passage extracted from the note content */
  excerpt: string;
  /** Cosine similarity score (0–1) */
  relevanceScore: number;
  /** URL-safe path to the note, useful for deep-linking */
  notePath?: string;
}

export interface Conversation {
  id: string;
  userId: string;
  vaultId: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  /** Number of messages — lightweight count, not full messages array */
  messageCount?: number;
}

export interface ConversationWithMessages extends Conversation {
  messages: Message[];
}

// ---------------------------------------------------------------------------
// DTOs
// ---------------------------------------------------------------------------

export interface ChatRequestDto {
  message: string;
  /** Omit to start a new conversation */
  conversationId?: string;
  vaultId: string;
  /** Maximum number of source notes to retrieve */
  topK?: number;
  /** Override the relevance threshold (0–1) */
  similarityThreshold?: number;
}

export interface CreateConversationDto {
  vaultId: string;
  title?: string;
  /** Optional initial system prompt */
  systemPrompt?: string;
}

export interface UpdateConversationDto {
  title?: string;
}

export interface SummarizeRequestDto {
  noteId: string;
  vaultId: string;
  /** 'brief' = 2–3 sentences, 'detailed' = multi-paragraph */
  style?: 'brief' | 'detailed';
  /** If provided, answer this specific question about the note */
  question?: string;
}

export interface GenerateWikilinkSuggestionsDto {
  noteId: string;
  vaultId: string;
  /** Maximum number of suggestions to return */
  limit?: number;
}

// ---------------------------------------------------------------------------
// Streaming
// ---------------------------------------------------------------------------

/**
 * A single chunk emitted during a streaming chat response (Server-Sent Events).
 *
 * - 'token'   → a piece of the assistant's answer text
 * - 'sources' → the retrieved source notes (sent before or after token stream)
 * - 'done'    → signals end of stream; `content` carries the full assembled text
 * - 'error'   → an error occurred; stream will close after this
 */
export interface StreamChunk {
  type: 'token' | 'sources' | 'done' | 'error';
  /** Present for 'token' and 'done' chunks */
  content?: string;
  /** Present for 'sources' chunks */
  sources?: ChatSource[];
  /** Present for 'error' chunks */
  error?: string;
  /** Present for 'done' chunks — echoes the message id for client reconciliation */
  messageId?: string;
}

// ---------------------------------------------------------------------------
// Embedding-related (shared between ai-service and embedding-service)
// ---------------------------------------------------------------------------

export interface EmbeddingRequest {
  noteId: string;
  vaultId: string;
  content: string;
  title: string;
  model?: string;
}

export interface EmbeddingResult {
  noteId: string;
  vectorId: string;
  model: string;
  dimensions: number;
}

export interface SemanticSearchQuery {
  query: string;
  vaultId: string;
  topK?: number;
  similarityThreshold?: number;
  excludeNoteIds?: string[];
}

export interface SemanticSearchResult {
  noteId: string;
  noteTitle: string;
  excerpt: string;
  score: number;
}
