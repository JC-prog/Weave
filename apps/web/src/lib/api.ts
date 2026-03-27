import { getToken } from './auth'
import type {
  Note,
  NoteWithRelations,
  CreateNoteDto,
  UpdateNoteDto,
  Folder,
  FolderWithChildren,
  CreateFolderDto,
  Tag,
  CreateTagDto,
  Vault,
  CreateVaultDto,
  UpdateVaultDto,
  PaginatedResponse,
  GraphData,
  Conversation,
  ConversationWithMessages,
  ChatSource,
  SemanticSearchResult,
} from '@notebooklm/types'

// ---------------------------------------------------------------------------
// Base client
// ---------------------------------------------------------------------------

const BASE_URL = typeof window !== 'undefined' ? '' : (process.env.NEXT_PUBLIC_GATEWAY_URL || 'http://localhost:3000')

export async function apiClient(
  path: string,
  options: RequestInit = {}
): Promise<Response> {
  const token = getToken()
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> | undefined),
  }

  if (token) {
    headers['Authorization'] = `Bearer ${token}`
  }

  const url = path.startsWith('http') ? path : `${BASE_URL}${path}`

  const res = await fetch(url, {
    ...options,
    headers,
  })

  if (!res.ok) {
    // Bubble up HTTP errors so SWR / callers can handle them
    const err = new Error(`HTTP ${res.status}: ${res.statusText}`) as Error & { status: number }
    err.status = res.status
    throw err
  }

  return res
}

async function get<T>(path: string): Promise<T> {
  const res = await apiClient(path)
  return res.json() as Promise<T>
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await apiClient(path, {
    method: 'POST',
    body: JSON.stringify(body),
  })
  return res.json() as Promise<T>
}

async function patch<T>(path: string, body: unknown): Promise<T> {
  const res = await apiClient(path, {
    method: 'PATCH',
    body: JSON.stringify(body),
  })
  return res.json() as Promise<T>
}

async function del<T>(path: string): Promise<T> {
  const res = await apiClient(path, { method: 'DELETE' })
  return res.json() as Promise<T>
}

// ---------------------------------------------------------------------------
// Vaults
// ---------------------------------------------------------------------------

export const getVaults = (): Promise<Vault[]> =>
  get<Vault[]>('/api/vaults')

export const getVault = (vaultId: string): Promise<Vault> =>
  get<Vault>(`/api/vaults/${vaultId}`)

export const createVault = (data: CreateVaultDto): Promise<Vault> =>
  post<Vault>('/api/vaults', data)

export const updateVault = (vaultId: string, data: UpdateVaultDto): Promise<Vault> =>
  patch<Vault>(`/api/vaults/${vaultId}`, data)

export const deleteVault = (vaultId: string): Promise<void> =>
  del<void>(`/api/vaults/${vaultId}`)

// ---------------------------------------------------------------------------
// Notes
// ---------------------------------------------------------------------------

export const getNotes = (vaultId: string): Promise<PaginatedResponse<Note>> =>
  get<PaginatedResponse<Note>>(`/api/vaults/${vaultId}/notes?limit=100`)

export const getNote = (vaultId: string, noteId: string): Promise<NoteWithRelations> =>
  get<NoteWithRelations>(`/api/vaults/${vaultId}/notes/${noteId}`)

export const createNote = (vaultId: string, data: CreateNoteDto): Promise<Note> =>
  post<Note>(`/api/vaults/${vaultId}/notes`, data)

export const updateNote = (vaultId: string, noteId: string, data: UpdateNoteDto): Promise<Note> =>
  patch<Note>(`/api/vaults/${vaultId}/notes/${noteId}`, data)

export const deleteNote = (vaultId: string, noteId: string): Promise<void> =>
  del<void>(`/api/vaults/${vaultId}/notes/${noteId}`)

// ---------------------------------------------------------------------------
// Folders
// ---------------------------------------------------------------------------

export const getFolders = (vaultId: string): Promise<FolderWithChildren[]> =>
  get<FolderWithChildren[]>(`/api/vaults/${vaultId}/folders`)

export const createFolder = (vaultId: string, data: CreateFolderDto): Promise<Folder> =>
  post<Folder>(`/api/vaults/${vaultId}/folders`, data)

export const updateFolder = (vaultId: string, folderId: string, data: Partial<CreateFolderDto>): Promise<Folder> =>
  patch<Folder>(`/api/vaults/${vaultId}/folders/${folderId}`, data)

export const deleteFolder = (vaultId: string, folderId: string): Promise<void> =>
  del<void>(`/api/vaults/${vaultId}/folders/${folderId}`)

// ---------------------------------------------------------------------------
// Tags
// ---------------------------------------------------------------------------

export const getTags = (vaultId: string): Promise<Tag[]> =>
  get<Tag[]>(`/api/vaults/${vaultId}/tags`)

export const createTag = (vaultId: string, data: CreateTagDto): Promise<Tag> =>
  post<Tag>(`/api/vaults/${vaultId}/tags`, data)

export const deleteTag = (vaultId: string, tagId: string): Promise<void> =>
  del<void>(`/api/vaults/${vaultId}/tags/${tagId}`)

// ---------------------------------------------------------------------------
// Graph
// ---------------------------------------------------------------------------

export const getGraphData = (vaultId: string): Promise<GraphData> =>
  get<GraphData>(`/api/graph/vaults/${vaultId}`)

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

export interface SearchResult {
  noteId: string
  noteTitle: string
  excerpt: string
  score?: number
  type: 'fulltext' | 'semantic'
}

export const search = (
  query: string,
  vaultId: string,
  mode: 'fulltext' | 'semantic' | 'all' = 'all'
): Promise<SearchResult[]> =>
  get<SearchResult[]>(
    `/api/search?q=${encodeURIComponent(query)}&vaultId=${vaultId}&mode=${mode}`
  )

// ---------------------------------------------------------------------------
// Conversations
// ---------------------------------------------------------------------------

export const getConversations = (vaultId: string): Promise<Conversation[]> =>
  get<Conversation[]>(`/api/ai/conversations?vaultId=${vaultId}`)

export const getConversation = (conversationId: string): Promise<ConversationWithMessages> =>
  get<ConversationWithMessages>(`/api/ai/conversations/${conversationId}`)

export const deleteConversation = (conversationId: string): Promise<void> =>
  del<void>(`/api/ai/conversations/${conversationId}`)

export const createConversation = (data: { vaultId: string; title?: string }): Promise<Conversation> =>
  post<Conversation>('/api/ai/conversations', data)

// ---------------------------------------------------------------------------
// AI
// ---------------------------------------------------------------------------

export const summarizeNote = (noteId: string, vaultId: string, style: 'brief' | 'detailed' = 'brief'): Promise<{ summary: string }> =>
  post<{ summary: string }>('/api/ai/summarize', { noteId, vaultId, style })

/**
 * Stream a chat message via Server-Sent Events.
 * Calls onToken for each streamed token, onSources when sources arrive,
 * and onDone when the stream is complete.
 */
export async function streamChat(
  message: string,
  vaultId: string,
  conversationId: string | null,
  onToken: (token: string) => void,
  onSources: (sources: ChatSource[]) => void,
  onDone: (fullText: string, messageId?: string) => void,
  onError?: (error: string) => void
): Promise<void> {
  const token = getToken()
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'text/event-stream',
  }
  if (token) headers['Authorization'] = `Bearer ${token}`

  const body = JSON.stringify({
    message,
    vaultId,
    conversationId: conversationId ?? undefined,
  })

  let response: Response
  try {
    response = await fetch('/api/ai/chat', {
      method: 'POST',
      headers,
      body,
    })
  } catch (err) {
    onError?.(err instanceof Error ? err.message : 'Network error')
    return
  }

  if (!response.ok) {
    onError?.(`HTTP ${response.status}: ${response.statusText}`)
    return
  }

  const reader = response.body?.getReader()
  if (!reader) {
    onError?.('No response body')
    return
  }

  const decoder = new TextDecoder()
  let fullText = ''
  let buffer = ''

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      // Keep the last (potentially incomplete) line in the buffer
      buffer = lines.pop() ?? ''

      for (const line of lines) {
        if (!line.trim()) continue

        if (line.startsWith('data: ')) {
          const data = line.slice(6).trim()
          if (data === '[DONE]') continue

          try {
            const chunk = JSON.parse(data)

            switch (chunk.type) {
              case 'token':
                if (chunk.content) {
                  fullText += chunk.content
                  onToken(chunk.content)
                }
                break
              case 'sources':
                if (chunk.sources) {
                  onSources(chunk.sources)
                }
                break
              case 'done':
                onDone(chunk.content ?? fullText, chunk.messageId)
                break
              case 'error':
                onError?.(chunk.error ?? 'Unknown stream error')
                break
            }
          } catch {
            // Malformed JSON chunk — skip
          }
        }
      }
    }
  } finally {
    reader.releaseLock()
  }

  // If we never got an explicit 'done' event, fire it now
  if (fullText) {
    onDone(fullText)
  }
}
