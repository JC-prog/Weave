# API Reference

All requests go through the API Gateway at `http://localhost:3000`. Authenticated endpoints require `Authorization: Bearer <accessToken>` header.

**Base URL:** `http://localhost:3000/api`

**Content-Type:** `application/json` for all request/response bodies unless noted.

**Standard error response:**
```json
{
  "error": "Human-readable message",
  "code": "MACHINE_READABLE_CODE",
  "statusCode": 400
}
```

---

## Auth Service — `/api/auth`

### POST /api/auth/register

Register a new user account.

**Auth required:** No

**Request body:**
```json
{
  "email": "user@example.com",
  "password": "supersecret123"
}
```

| Field      | Type   | Required | Constraints              |
|------------|--------|----------|--------------------------|
| `email`    | string | Yes      | Valid email format        |
| `password` | string | Yes      | Min 8 characters          |

**Response `201`:**
```json
{
  "user": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "email": "user@example.com",
    "createdAt": "2026-03-27T10:00:00Z"
  },
  "accessToken": "eyJhbGciOiJIUzI1NiJ9...",
  "refreshToken": "eyJhbGciOiJIUzI1NiJ9..."
}
```

**Error codes:**
- `409 CONFLICT` — email already registered
- `422 VALIDATION_ERROR` — invalid email or weak password

---

### POST /api/auth/login

Authenticate with email and password.

**Auth required:** No

**Request body:**
```json
{
  "email": "user@example.com",
  "password": "supersecret123"
}
```

**Response `200`:**
```json
{
  "user": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "email": "user@example.com",
    "createdAt": "2026-03-27T10:00:00Z"
  },
  "accessToken": "eyJhbGciOiJIUzI1NiJ9...",
  "refreshToken": "eyJhbGciOiJIUzI1NiJ9..."
}
```

**Error codes:**
- `401 INVALID_CREDENTIALS` — wrong email or password

---

### POST /api/auth/refresh

Exchange a refresh token for a new access token + rotated refresh token.

**Auth required:** No

**Request body:**
```json
{
  "refreshToken": "eyJhbGciOiJIUzI1NiJ9..."
}
```

**Response `200`:**
```json
{
  "accessToken": "eyJhbGciOiJIUzI1NiJ9...",
  "refreshToken": "eyJhbGciOiJIUzI1NiJ9..."
}
```

**Error codes:**
- `401 TOKEN_EXPIRED` — refresh token has expired
- `401 TOKEN_REVOKED` — refresh token has been revoked (user logged out)
- `401 TOKEN_INVALID` — malformed token

---

### POST /api/auth/logout

Revoke the current refresh token.

**Auth required:** Yes

**Request body:**
```json
{
  "refreshToken": "eyJhbGciOiJIUzI1NiJ9..."
}
```

**Response `204`:** No content.

---

### GET /api/auth/me

Get the currently authenticated user's profile.

**Auth required:** Yes

**Response `200`:**
```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "email": "user@example.com",
  "createdAt": "2026-03-27T10:00:00Z",
  "updatedAt": "2026-03-27T10:00:00Z"
}
```

---

### POST /api/auth/api-keys

Create a new API key for programmatic access.

**Auth required:** Yes

**Request body:**
```json
{
  "name": "My CLI Script",
  "expiresAt": "2027-01-01T00:00:00Z"
}
```

| Field       | Type             | Required | Notes                                     |
|-------------|------------------|----------|-------------------------------------------|
| `name`      | string           | Yes      | Human label for the key                   |
| `expiresAt` | ISO8601 datetime | No       | Omit for a non-expiring key               |

**Response `201`:**
```json
{
  "id": "key-uuid",
  "name": "My CLI Script",
  "keyPrefix": "nlm_live_abc123",
  "secretKey": "nlm_live_abc123xxxxxxxxxxxxxxxxxxxx",
  "expiresAt": "2027-01-01T00:00:00Z",
  "createdAt": "2026-03-27T10:00:00Z"
}
```

**Important:** `secretKey` is shown only once. Store it securely.

---

### GET /api/auth/api-keys

List all API keys for the authenticated user.

**Auth required:** Yes

**Response `200`:**
```json
{
  "apiKeys": [
    {
      "id": "key-uuid",
      "name": "My CLI Script",
      "keyPrefix": "nlm_live_abc123",
      "lastUsedAt": "2026-03-26T14:00:00Z",
      "expiresAt": "2027-01-01T00:00:00Z",
      "createdAt": "2026-03-27T10:00:00Z"
    }
  ]
}
```

---

### DELETE /api/auth/api-keys/:keyId

Revoke an API key immediately.

**Auth required:** Yes

**Response `204`:** No content.

---

## Vault Service — `/api/vaults`

### GET /api/vaults

List all vaults owned by the authenticated user.

**Auth required:** Yes

**Response `200`:**
```json
{
  "vaults": [
    {
      "id": "vault-uuid",
      "name": "Research",
      "description": "My academic research notes",
      "noteCount": 47,
      "createdAt": "2026-01-15T09:00:00Z",
      "updatedAt": "2026-03-27T10:00:00Z"
    }
  ]
}
```

---

### POST /api/vaults

Create a new vault.

**Auth required:** Yes

**Request body:**
```json
{
  "name": "Research",
  "description": "My academic research notes"
}
```

**Response `201`:**
```json
{
  "id": "vault-uuid",
  "name": "Research",
  "description": "My academic research notes",
  "noteCount": 0,
  "createdAt": "2026-03-27T10:00:00Z",
  "updatedAt": "2026-03-27T10:00:00Z"
}
```

---

### GET /api/vaults/:vaultId

Get a single vault.

**Auth required:** Yes

**Response `200`:** Same shape as a single vault object above.

---

### PUT /api/vaults/:vaultId

Update vault name or description.

**Auth required:** Yes

**Request body:** Partial — include only fields to update.
```json
{
  "name": "Academic Research",
  "description": "Updated description"
}
```

**Response `200`:** Updated vault object.

---

### DELETE /api/vaults/:vaultId

Delete a vault and all its contents (notes, folders, links). Irreversible.

**Auth required:** Yes

**Response `204`:** No content.

---

### GET /api/vaults/:vaultId/folders

Get the folder tree for a vault.

**Auth required:** Yes

**Response `200`:**
```json
{
  "folders": [
    {
      "id": "folder-uuid",
      "name": "AI",
      "path": "/AI",
      "parentId": null,
      "children": [
        {
          "id": "subfolder-uuid",
          "name": "Papers",
          "path": "/AI/Papers",
          "parentId": "folder-uuid",
          "children": []
        }
      ]
    }
  ]
}
```

---

### POST /api/vaults/:vaultId/folders

Create a folder.

**Auth required:** Yes

**Request body:**
```json
{
  "name": "AI",
  "parentId": null
}
```

`parentId` is `null` for top-level folders, or a folder UUID for nested folders.

**Response `201`:** Folder object.

---

### DELETE /api/vaults/:vaultId/folders/:folderId

Delete a folder. Notes inside are moved to the vault root (not deleted).

**Auth required:** Yes

**Response `204`:** No content.

---

### GET /api/vaults/:vaultId/notes

List notes in a vault. Supports filtering and pagination.

**Auth required:** Yes

**Query parameters:**

| Param      | Type    | Default | Description                             |
|------------|---------|---------|------------------------------------------|
| `folderId` | UUID    | —       | Filter by folder                         |
| `tag`      | string  | —       | Filter by tag name                       |
| `page`     | integer | 1       | Page number                              |
| `limit`    | integer | 50      | Items per page (max 200)                 |
| `sort`     | string  | `updatedAt:desc` | Sort field and direction        |

**Response `200`:**
```json
{
  "notes": [
    {
      "id": "note-uuid",
      "vaultId": "vault-uuid",
      "folderId": "folder-uuid",
      "title": "Attention is All You Need — Notes",
      "wordCount": 512,
      "tags": ["ml", "transformers"],
      "createdAt": "2026-02-10T14:00:00Z",
      "updatedAt": "2026-03-25T09:30:00Z"
    }
  ],
  "pagination": {
    "total": 47,
    "page": 1,
    "limit": 50,
    "totalPages": 1
  }
}
```

---

### POST /api/vaults/:vaultId/notes

Create a new note.

**Auth required:** Yes

**Request body:**
```json
{
  "title": "New Note",
  "content": "# New Note\n\nStart writing here...",
  "folderId": "folder-uuid",
  "tags": ["idea", "draft"]
}
```

| Field      | Type       | Required | Notes                             |
|------------|------------|----------|-----------------------------------|
| `title`    | string     | Yes      | Note title                        |
| `content`  | string     | No       | Markdown content (default empty)  |
| `folderId` | UUID       | No       | Omit to place at vault root       |
| `tags`     | string[]   | No       | Tag names (created if new)        |

**Response `201`:** Full note object (same shape as GET below).

---

### GET /api/vaults/:vaultId/notes/:noteId

Get full note content.

**Auth required:** Yes

**Response `200`:**
```json
{
  "id": "note-uuid",
  "vaultId": "vault-uuid",
  "folderId": "folder-uuid",
  "title": "Attention is All You Need — Notes",
  "content": "# Attention is All You Need\n\nThe transformer architecture...",
  "wordCount": 512,
  "tags": ["ml", "transformers"],
  "links": [
    { "targetNoteId": "other-note-uuid", "targetTitle": "Deep Learning Basics" }
  ],
  "backlinks": [
    { "sourceNoteId": "citing-note-uuid", "sourceTitle": "Reading List 2026" }
  ],
  "createdAt": "2026-02-10T14:00:00Z",
  "updatedAt": "2026-03-25T09:30:00Z"
}
```

---

### PUT /api/vaults/:vaultId/notes/:noteId

Update a note's content, title, folder, or tags.

**Auth required:** Yes

**Request body:** Partial — include only fields to update.
```json
{
  "title": "Updated Title",
  "content": "Updated content...",
  "folderId": "new-folder-uuid",
  "tags": ["ml", "transformers", "attention"]
}
```

**Response `200`:** Updated note object.

---

### DELETE /api/vaults/:vaultId/notes/:noteId

Delete a note. Also removes all links from/to this note.

**Auth required:** Yes

**Response `204`:** No content.

---

### GET /api/vaults/:vaultId/notes/:noteId/backlinks

Get all notes that link to this note via wikilinks.

**Auth required:** Yes

**Response `200`:**
```json
{
  "backlinks": [
    {
      "noteId": "citing-note-uuid",
      "title": "Reading List 2026",
      "excerpt": "...see [[Attention is All You Need — Notes]] for details...",
      "updatedAt": "2026-03-20T10:00:00Z"
    }
  ]
}
```

---

### GET /api/vaults/:vaultId/tags

List all tags used in a vault.

**Auth required:** Yes

**Response `200`:**
```json
{
  "tags": [
    { "name": "ml", "noteCount": 23 },
    { "name": "transformers", "noteCount": 7 }
  ]
}
```

---

## Graph Service — `/api/graph`

### GET /api/graph/:vaultId

Get full graph data for a vault (nodes + edges).

**Auth required:** Yes

**Query parameters:**

| Param    | Type   | Default | Description                            |
|----------|--------|---------|----------------------------------------|
| `tags`   | string | —       | Comma-separated tag filter             |
| `folder` | UUID   | —       | Restrict to notes in a folder          |

**Response `200`:**
```json
{
  "nodes": [
    {
      "id": "note-uuid",
      "title": "Attention is All You Need",
      "tags": ["ml", "transformers"],
      "wordCount": 512,
      "degree": 5,
      "updatedAt": "2026-03-25T09:30:00Z"
    }
  ],
  "edges": [
    {
      "id": "edge-uuid",
      "source": "note-uuid",
      "target": "other-note-uuid",
      "weight": 1
    }
  ],
  "stats": {
    "nodeCount": 47,
    "edgeCount": 89,
    "orphanCount": 3,
    "avgDegree": 3.8
  }
}
```

---

### GET /api/graph/:vaultId/nodes/:noteId/neighbors

Get the immediate neighbors (1-hop) of a note in the graph.

**Auth required:** Yes

**Query parameters:**

| Param   | Type    | Default | Description          |
|---------|---------|---------|----------------------|
| `depth` | integer | 1       | Hop depth (max 3)    |

**Response `200`:**
```json
{
  "center": { "id": "note-uuid", "title": "..." },
  "neighbors": [
    {
      "id": "neighbor-uuid",
      "title": "Related Note",
      "direction": "outbound",
      "distance": 1
    }
  ]
}
```

---

### GET /api/graph/:vaultId/orphans

Get notes with no incoming or outgoing links.

**Auth required:** Yes

**Response `200`:**
```json
{
  "orphans": [
    { "id": "note-uuid", "title": "Unconnected Thought", "createdAt": "..." }
  ],
  "count": 3
}
```

---

### GET /api/graph/:vaultId/hubs

Get the most highly connected notes (sorted by degree centrality).

**Auth required:** Yes

**Query parameters:**

| Param   | Type    | Default | Description             |
|---------|---------|---------|-------------------------|
| `limit` | integer | 10      | Number of hubs to return |

**Response `200`:**
```json
{
  "hubs": [
    { "id": "note-uuid", "title": "MOC — Machine Learning", "degree": 31 },
    { "id": "note-uuid-2", "title": "Index", "degree": 24 }
  ]
}
```

---

## Search Service — `/api/search`

### GET /api/search

Hybrid search across a vault (full-text + semantic, merged via RRF).

**Auth required:** Yes

**Query parameters:**

| Param      | Type    | Required | Description                              |
|------------|---------|----------|------------------------------------------|
| `q`        | string  | Yes      | Search query                             |
| `vaultId`  | UUID    | Yes      | Vault to search                          |
| `mode`     | string  | No       | `hybrid` (default) \| `fulltext` \| `semantic` |
| `tags`     | string  | No       | Comma-separated tag filter               |
| `folderId` | UUID    | No       | Restrict to folder                       |
| `limit`    | integer | No       | Results to return (default 20, max 100)  |

**Response `200`:**
```json
{
  "results": [
    {
      "noteId": "note-uuid",
      "title": "Attention is All You Need — Notes",
      "excerpt": "...the <mark>attention</mark> mechanism allows the model to...",
      "score": 0.923,
      "scoreBreakdown": {
        "fulltextRank": 1,
        "semanticRank": 2,
        "rrfScore": 0.923
      },
      "tags": ["ml", "transformers"],
      "updatedAt": "2026-03-25T09:30:00Z"
    }
  ],
  "total": 12,
  "query": "attention mechanisms",
  "mode": "hybrid",
  "took": 47
}
```

`excerpt` has matching terms highlighted with `<mark>` tags.

---

### GET /api/search/fulltext

Full-text only search using PostgreSQL tsvector.

**Auth required:** Yes

Same query parameters as `/api/search` minus `mode`. Response format is identical.

---

### GET /api/search/semantic

Semantic similarity search using Qdrant.

**Auth required:** Yes

Same query parameters as `/api/search` minus `mode`. Response format is identical.

---

## AI Service — `/api/ai`

### GET /api/ai/conversations

List all AI conversations for the authenticated user.

**Auth required:** Yes

**Query parameters:**

| Param     | Type | Default | Description                  |
|-----------|------|---------|------------------------------|
| `vaultId` | UUID | —       | Filter by vault               |
| `page`    | int  | 1       |                               |
| `limit`   | int  | 20      |                               |

**Response `200`:**
```json
{
  "conversations": [
    {
      "id": "conv-uuid",
      "vaultId": "vault-uuid",
      "title": "What are my main research themes?",
      "messageCount": 8,
      "createdAt": "2026-03-25T14:00:00Z",
      "updatedAt": "2026-03-25T15:30:00Z"
    }
  ]
}
```

---

### POST /api/ai/conversations

Create a new conversation.

**Auth required:** Yes

**Request body:**
```json
{
  "vaultId": "vault-uuid",
  "title": "Optional custom title"
}
```

**Response `201`:**
```json
{
  "id": "conv-uuid",
  "vaultId": "vault-uuid",
  "title": "New Conversation",
  "messages": [],
  "createdAt": "2026-03-27T10:00:00Z"
}
```

---

### GET /api/ai/conversations/:conversationId

Get a conversation with all its messages.

**Auth required:** Yes

**Response `200`:**
```json
{
  "id": "conv-uuid",
  "vaultId": "vault-uuid",
  "title": "Research themes discussion",
  "messages": [
    {
      "id": "msg-uuid",
      "role": "user",
      "content": "What are my main research themes?",
      "sources": null,
      "createdAt": "2026-03-25T14:00:00Z"
    },
    {
      "id": "msg-uuid-2",
      "role": "assistant",
      "content": "Based on your notes, your research focuses on three main themes...",
      "sources": [
        {
          "noteId": "note-uuid",
          "title": "Research Overview",
          "excerpt": "The central focus of my work is..."
        }
      ],
      "createdAt": "2026-03-25T14:00:05Z"
    }
  ]
}
```

---

### POST /api/ai/conversations/:conversationId/messages

Send a chat message and receive a streaming AI response.

**Auth required:** Yes

**Request body:**
```json
{
  "content": "What do my notes say about the transformer architecture?",
  "vaultId": "vault-uuid"
}
```

**Response:** `Content-Type: text/event-stream` (SSE)

Each SSE event is one of:

```
data: {"type": "token", "delta": "The "}
data: {"type": "token", "delta": "transformer "}
data: {"type": "sources", "sources": [{"noteId": "...", "title": "...", "excerpt": "..."}]}
data: {"type": "done", "messageId": "msg-uuid"}
data: [DONE]
```

On error mid-stream:
```
data: {"type": "error", "message": "LLM provider unavailable"}
```

---

### DELETE /api/ai/conversations/:conversationId

Delete a conversation and all its messages.

**Auth required:** Yes

**Response `204`:** No content.

---

### POST /api/ai/summarize

Summarize one or more notes.

**Auth required:** Yes

**Request body:**
```json
{
  "noteIds": ["note-uuid-1", "note-uuid-2"],
  "style": "bullets",
  "maxLength": 500
}
```

| Field       | Type     | Required | Options                                |
|-------------|----------|----------|----------------------------------------|
| `noteIds`   | string[] | Yes      | 1–10 note IDs                          |
| `style`     | string   | No       | `bullets` (default) \| `paragraph` \| `outline` |
| `maxLength` | integer  | No       | Target output length in words          |

**Response `200`:**
```json
{
  "summary": "- The transformer architecture replaces recurrence with self-attention...\n- Multi-head attention allows the model to attend to different positions...",
  "sourceNotes": [
    { "noteId": "note-uuid-1", "title": "Attention is All You Need" }
  ],
  "wordCount": 87
}
```

---

### POST /api/ai/audio-overview

Generate a podcast-style dialogue script from a set of notes.

**Auth required:** Yes

**Request body:**
```json
{
  "noteIds": ["note-uuid-1", "note-uuid-2", "note-uuid-3"],
  "hosts": ["Alex", "Sam"],
  "durationMinutes": 5
}
```

**Response `200`:**
```json
{
  "script": "Alex: Today we're diving into transformer architectures...\nSam: That's right, and what's fascinating is the attention mechanism...",
  "sourceNotes": [...],
  "estimatedDuration": "4m 50s"
}
```

---

## Embedding Service — `/api/embed`

### POST /api/embed

Embed arbitrary text and return the vector. Used internally by search-service for query embedding.

**Auth required:** Yes

**Request body:**
```json
{
  "text": "What is multi-head attention?",
  "normalize": true
}
```

**Response `200`:**
```json
{
  "embedding": [0.023, -0.142, 0.089, ...],
  "dimensions": 384,
  "model": "BAAI/bge-small-en-v1.5",
  "took": 12
}
```

---

### POST /api/embed/note/:noteId

Trigger re-embedding of a specific note. Useful after bulk imports or model changes.

**Auth required:** Yes

**Response `200`:**
```json
{
  "noteId": "note-uuid",
  "chunksIndexed": 4,
  "took": 234
}
```

---

### GET /api/embed/status

Get embedding service health and model info.

**Auth required:** Yes

**Response `200`:**
```json
{
  "status": "healthy",
  "model": "BAAI/bge-small-en-v1.5",
  "dimensions": 384,
  "queueDepth": 0,
  "totalIndexed": 1823
}
```

---

## Media Service — `/api/media`

### POST /api/media/upload

Upload a file asset. Uses multipart form data.

**Auth required:** Yes

**Content-Type:** `multipart/form-data`

**Form fields:**

| Field      | Type   | Required | Description                              |
|------------|--------|----------|------------------------------------------|
| `file`     | File   | Yes      | The file to upload                       |
| `vaultId`  | string | Yes      | Vault to associate the asset with        |
| `folderId` | string | No       | Folder to associate with (metadata only) |

**Limits:** Max file size 100MB. Allowed MIME types: `application/pdf`, `text/plain`, `text/markdown`, `image/png`, `image/jpeg`, `image/webp`, `audio/mpeg`, `audio/wav`.

**Response `201`:**
```json
{
  "id": "asset-uuid",
  "vaultId": "vault-uuid",
  "filename": "paper.pdf",
  "mimeType": "application/pdf",
  "sizeBytes": 1048576,
  "downloadUrl": "http://localhost:9000/notebooklm-assets/...",
  "textExtracted": true,
  "createdAt": "2026-03-27T10:00:00Z"
}
```

`downloadUrl` is a pre-signed MinIO URL valid for 1 hour.

---

### GET /api/media/:vaultId/assets

List all assets in a vault.

**Auth required:** Yes

**Query parameters:**

| Param      | Type    | Default | Description                                      |
|------------|---------|---------|--------------------------------------------------|
| `mimeType` | string  | —       | Filter by MIME type prefix (e.g., `image/`)      |
| `page`     | integer | 1       |                                                  |
| `limit`    | integer | 50      | Max 200                                          |

**Response `200`:**
```json
{
  "assets": [
    {
      "id": "asset-uuid",
      "filename": "paper.pdf",
      "mimeType": "application/pdf",
      "sizeBytes": 1048576,
      "textExtracted": true,
      "createdAt": "2026-03-27T10:00:00Z"
    }
  ],
  "pagination": { "total": 12, "page": 1, "limit": 50, "totalPages": 1 }
}
```

---

### GET /api/media/assets/:assetId

Get metadata and a fresh pre-signed download URL for an asset.

**Auth required:** Yes

**Response `200`:**
```json
{
  "id": "asset-uuid",
  "vaultId": "vault-uuid",
  "filename": "paper.pdf",
  "mimeType": "application/pdf",
  "sizeBytes": 1048576,
  "downloadUrl": "http://localhost:9000/notebooklm-assets/...",
  "textExtracted": true,
  "textContent": "Abstract: In this paper we present...",
  "createdAt": "2026-03-27T10:00:00Z"
}
```

---

### DELETE /api/media/assets/:assetId

Delete an asset from both MinIO and the database.

**Auth required:** Yes

**Response `204`:** No content.

---

## Common HTTP Status Codes

| Code | Meaning                                                              |
|------|----------------------------------------------------------------------|
| 200  | OK — request succeeded                                               |
| 201  | Created — resource was created                                       |
| 204  | No Content — request succeeded, no body                             |
| 400  | Bad Request — malformed request body or missing required fields      |
| 401  | Unauthorized — missing, expired, or invalid authentication token     |
| 403  | Forbidden — authenticated but not authorized for this resource       |
| 404  | Not Found — resource does not exist                                  |
| 409  | Conflict — resource already exists (e.g., duplicate email)          |
| 422  | Unprocessable Entity — validation error on request data              |
| 429  | Too Many Requests — rate limit exceeded                              |
| 500  | Internal Server Error — unexpected server-side failure               |
| 503  | Service Unavailable — downstream service (AI provider, etc.) is down |

## Rate Limits

| Tier             | Limit                          |
|------------------|--------------------------------|
| Default (all)    | 100 requests / minute per user |
| AI chat          | 20 requests / minute per user  |
| File upload      | 10 requests / minute per user  |
| Auth endpoints   | 10 requests / minute per IP    |
