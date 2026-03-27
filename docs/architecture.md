# Architecture Overview

## 1. Goals and Vision

This project is a self-hosted hybrid of **Obsidian** (a local-first, graph-based personal knowledge management tool) and **Google NotebookLM** (an AI-powered research assistant that grounds answers in your own documents). The result is a web application where users can:

- Write and link notes using Markdown with wikilinks (`[[Note Title]]`)
- Visualize their knowledge as an interactive graph of nodes and edges
- Search notes with both full-text keyword precision and semantic (embedding) recall
- Chat with an AI assistant that cites specific notes as sources — no hallucination
- Upload media (PDFs, images, audio) and have them automatically indexed
- Organize notes into vaults, folders, and tags
- Access their knowledge base from any browser, with a future-proof API for mobile/desktop clients

---

## 2. System Architecture Diagram

```
                        ┌─────────────────────────────────────────────────────────┐
                        │                     CLIENT LAYER                        │
                        │                                                         │
                        │   Browser (Next.js 15 App Router — port 3008)          │
                        │   React Server Components + Client Components           │
                        │   TanStack Query · Zustand · Tiptap Editor             │
                        └───────────────────────┬─────────────────────────────────┘
                                                │  HTTP / SSE
                                                ▼
                        ┌─────────────────────────────────────────────────────────┐
                        │                   API GATEWAY (port 3000)               │
                        │           Fastify + @fastify/http-proxy                 │
                        │   Auth middleware · Rate limiting · Request routing     │
                        └──┬──────────┬──────────┬──────────┬──────────┬──────────┘
                           │          │          │          │          │
              ┌────────────┘  ┌───────┘  ┌──────┘  ┌──────┘  ┌───────┘
              ▼               ▼          ▼          ▼          ▼
         ┌─────────┐   ┌─────────┐  ┌────────┐ ┌────────┐ ┌────────┐
         │  auth   │   │  vault  │  │ graph  │ │search  │ │  ai    │
         │:3001    │   │:3002    │  │:3003   │ │:3004   │ │:3005   │
         └────┬────┘   └────┬────┘  └───┬────┘ └───┬────┘ └───┬────┘
              │             │           │           │           │
              │     ┌───────┘           │           │           │
              │     │  note.created     │           │           │
              │     │  note.updated  ───┤           │           │
              │     │  note.deleted     │           │           │
              │     ▼                   ▼           ▼           ▼
              │  ┌───────────────────────────────────────────────────┐
              │  │              REDIS STREAMS (event bus)            │
              │  │   stream: notes.events  ·  stream: media.events   │
              │  └───────────────────────────────────────────────────┘
              │                  │                        │
              │        ┌─────────┘                ┌───────┘
              │        ▼                          ▼
              │   ┌──────────┐            ┌──────────────┐
              │   │embedding │            │    media     │
              │   │:3006     │            │   :3007      │
              │   └──────────┘            └──────────────┘
              │
              ▼
     ┌─────────────────────────────────────────────────────────┐
     │                    PERSISTENCE LAYER                    │
     │                                                         │
     │  PostgreSQL (pgvector ready)    Redis (cache + streams) │
     │  Qdrant (vector store)          MinIO (object storage)  │
     └─────────────────────────────────────────────────────────┘
```

---

## 3. Microservices

### 3.1 API Gateway — port 3000

| Item        | Detail                              |
|-------------|-------------------------------------|
| Language    | TypeScript / Node.js                |
| Framework   | Fastify + `@fastify/http-proxy`     |
| Location    | `apps/gateway/`                     |

**Responsibilities:**
- Single entry point for all client traffic
- JWT validation on every request before proxying (reads `Authorization: Bearer <token>`, calls auth-service `/verify` or validates locally with shared secret)
- Route-based proxying to downstream services
- Global rate limiting (per-IP and per-user)
- CORS policy enforcement
- Request/response logging with correlation IDs
- SSE pass-through for AI streaming responses

**Routes:**
```
/api/auth/*      → auth-service:3001
/api/vaults/*    → vault-service:3002
/api/graph/*     → graph-service:3003
/api/search/*    → search-service:3004
/api/ai/*        → ai-service:3005
/api/embed/*     → embedding-service:3006
/api/media/*     → media-service:3007
```

---

### 3.2 Auth Service — port 3001

| Item        | Detail                              |
|-------------|-------------------------------------|
| Language    | TypeScript / Node.js                |
| Framework   | Fastify                             |
| Database    | PostgreSQL (`auth` schema)          |
| Location    | `apps/auth-service/`                |

**Responsibilities:**
- User registration and login with bcrypt password hashing
- JWT access token issuance (15 min TTL) and refresh token rotation (7 day TTL)
- Refresh token storage in PostgreSQL (allows forced logout / revocation)
- API key management for programmatic access (hashed in DB, prefix shown to user once)
- Session listing and revocation
- `/verify` endpoint for gateway JWT introspection (fast path: shared secret symmetric verify)

---

### 3.3 Vault Service — port 3002

| Item        | Detail                              |
|-------------|-------------------------------------|
| Language    | TypeScript / Node.js                |
| Framework   | Fastify                             |
| Database    | PostgreSQL (`vault` schema)         |
| Cache       | Redis (note metadata, folder tree)  |
| Location    | `apps/vault-service/`               |

**Responsibilities:**
- CRUD for vaults (a vault is a top-level namespace — like an Obsidian vault)
- CRUD for folders and notes within a vault
- Markdown content storage (stored in PostgreSQL, large content offloaded to MinIO)
- Wikilink parsing: on every note save, extract `[[...]]` links and persist to `links` table
- Backlink index: given a note, return all notes that link to it
- Tag management: inline `#tag` extraction and tag-based filtering
- Publishes events to Redis Streams on note create/update/delete

**Event emission (to `notes.events` stream):**
```json
{
  "eventType": "note.created" | "note.updated" | "note.deleted",
  "vaultId": "uuid",
  "noteId": "uuid",
  "userId": "uuid",
  "timestamp": "ISO8601"
}
```

---

### 3.4 Graph Service — port 3003

| Item        | Detail                              |
|-------------|-------------------------------------|
| Language    | TypeScript / Node.js                |
| Framework   | Fastify                             |
| Database    | PostgreSQL (`graph` schema)         |
| Location    | `apps/graph-service/`               |

**Responsibilities:**
- Maintains a directed graph of note–to–note links (nodes = notes, edges = wikilinks)
- Consumes `notes.events` Redis Stream to keep graph in sync with vault changes
- Exposes graph data endpoints for the frontend force-directed graph visualization
- Computes graph analytics: degree centrality (hub detection), orphan notes (no links), connected components
- Node metadata includes: title, tag list, last modified, word count

---

### 3.5 Search Service — port 3004

| Item        | Detail                              |
|-------------|-------------------------------------|
| Language    | TypeScript / Node.js                |
| Framework   | Fastify                             |
| Database    | PostgreSQL (tsvector full-text)     |
| Vector DB   | Qdrant                              |
| Location    | `apps/search-service/`              |

**Responsibilities:**
- Hybrid search: merge results from PostgreSQL full-text search and Qdrant semantic search
- Full-text index maintained via PostgreSQL `tsvector` columns updated on note save
- Semantic search via Qdrant: queries embedding-service to embed the query, then calls Qdrant `/collections/{vault}/points/search`
- Result merging uses Reciprocal Rank Fusion (RRF) to combine ranked lists
- Consumes `notes.events` to update the full-text index on note changes
- Supports filters: vault, folder, tag, date range, author

---

### 3.6 AI Service — port 3005

| Item        | Detail                              |
|-------------|-------------------------------------|
| Language    | TypeScript / Node.js                |
| Framework   | Fastify                             |
| Database    | PostgreSQL (`ai` schema — conversations, messages) |
| Location    | `apps/ai-service/`                  |

**Responsibilities:**
- RAG (Retrieval-Augmented Generation) pipeline orchestration
- Manages conversation history and persists chat sessions
- On each chat message: calls search-service for top-k relevant chunks, builds context prompt, streams LLM response via SSE
- Supports AI provider switching: Anthropic Claude (default), OpenAI GPT-4o, local Ollama
- Summarization endpoint: condense a single note or set of notes into bullet points
- Audio overview: generate a podcast-style dialogue script from note content (text output; TTS handled client-side or via a future media pipeline)
- Injects source citations into every response so users can verify which notes were used

---

### 3.7 Embedding Service — port 3006

| Item        | Detail                              |
|-------------|-------------------------------------|
| Language    | Python 3.12                         |
| Framework   | FastAPI                             |
| Model       | `BAAI/bge-small-en-v1.5` (via `sentence-transformers`) |
| Vector DB   | Qdrant                              |
| Location    | `apps/embedding-service/`           |

**Responsibilities:**
- Consumes `notes.events` Redis Stream (consumer group `embedding-workers`)
- On `note.created` / `note.updated`: fetch note content from vault-service, chunk the text (512-token overlapping windows), compute embeddings, upsert into Qdrant collection for the vault
- On `note.deleted`: delete all Qdrant points for that note
- Exposes `/embed` HTTP endpoint for synchronous embedding of arbitrary text (used by search-service for query embedding)
- Exposes `/embed/note/{noteId}` to manually trigger re-indexing
- Batches embedding computation for efficiency (configurable batch size)
- Model is loaded once at startup and kept in memory

---

### 3.8 Media Service — port 3007

| Item        | Detail                              |
|-------------|-------------------------------------|
| Language    | TypeScript / Node.js                |
| Framework   | Fastify + `@fastify/multipart`      |
| Storage     | MinIO (S3-compatible)               |
| Database    | PostgreSQL (`media` schema)         |
| Location    | `apps/media-service/`               |

**Responsibilities:**
- Multipart file upload handling (PDFs, images, audio files, plain text)
- Generates pre-signed MinIO URLs for direct browser download (avoids proxying large files)
- Stores asset metadata in PostgreSQL (filename, MIME type, size, vault association, uploader)
- Publishes `media.uploaded` events to `media.events` Redis Stream (triggers embedding of PDF text)
- PDF text extraction via `pdf-parse` (Node.js) for indexing
- Image storage (future: OCR pipeline hook)
- Virus scanning hook (pluggable; ClamAV integration point)

---

## 4. Communication Patterns

### 4.1 Synchronous REST (client → gateway → service)

All user-initiated actions (CRUD, search queries, chat messages) flow synchronously over HTTP/1.1 REST through the gateway. The gateway validates JWT, adds `X-User-Id` and `X-Vault-Id` headers, and proxies to the appropriate downstream service. Services do not require re-validation of JWT — they trust the gateway-injected headers on the internal network.

### 4.2 Redis Streams (async event propagation)

Redis Streams are used for event-driven fan-out. When vault-service saves a note, it appends an event to the `notes.events` stream. Multiple consumer groups each process this independently:

| Stream           | Producers         | Consumer Groups                              |
|------------------|-------------------|----------------------------------------------|
| `notes.events`   | vault-service     | `graph-workers`, `embedding-workers`, `search-workers` |
| `media.events`   | media-service     | `embedding-workers`                          |

Consumer groups guarantee that each service processes every event exactly once, with automatic re-delivery on consumer failure (via PEL — pending entry list). This decouples the vault-service from all downstream processing: a note save returns immediately to the client without waiting for graph/search/embedding updates.

### 4.3 Server-Sent Events (AI streaming)

AI chat responses are streamed token-by-token from the AI provider to the client using SSE. The flow is:

```
Client → Gateway (SSE) → AI Service → LLM Provider (streaming)
                                             ↓ chunks
Client ← Gateway (SSE) ← AI Service ←──────────────────
```

The gateway passes SSE connections through transparently. The AI service sets `Content-Type: text/event-stream` and flushes each token as a `data: {...}` event. A final `data: [DONE]` event closes the stream.

---

## 5. Data Storage Strategy

### 5.1 PostgreSQL Schemas

The single PostgreSQL instance is divided into logical schemas per service:

**`auth` schema**
```sql
users          (id, email, password_hash, created_at, updated_at)
refresh_tokens (id, user_id, token_hash, expires_at, revoked_at, device_info)
api_keys       (id, user_id, key_hash, key_prefix, name, last_used_at, expires_at)
```

**`vault` schema**
```sql
vaults   (id, user_id, name, description, created_at, updated_at)
folders  (id, vault_id, parent_id, name, path, created_at)
notes    (id, vault_id, folder_id, title, content, content_url, word_count,
          fts_vector tsvector, created_at, updated_at)
links    (id, source_note_id, target_note_id, target_title, vault_id)
tags     (id, vault_id, name)
note_tags(note_id, tag_id)
```

The `content_url` column points to MinIO for notes exceeding ~50KB. Below that threshold, content is stored inline in the `content` column for fast retrieval without a round-trip to object storage.

`fts_vector` is kept up-to-date via a PostgreSQL trigger:
```sql
CREATE TRIGGER notes_fts_update
BEFORE INSERT OR UPDATE ON vault.notes
FOR EACH ROW EXECUTE FUNCTION
  tsvector_update_trigger(fts_vector, 'pg_catalog.english', title, content);
```

**`graph` schema**
```sql
nodes (id, vault_id, note_id, title, tag_ids, word_count, updated_at)
edges (id, vault_id, source_id, target_id, weight)
```

**`ai` schema**
```sql
conversations (id, user_id, vault_id, title, created_at, updated_at)
messages      (id, conversation_id, role, content, sources jsonb, created_at)
```

**`media` schema**
```sql
assets (id, vault_id, user_id, filename, mime_type, size_bytes,
        storage_key, presigned_url_cached, text_content, created_at)
```

### 5.2 Redis

| Key pattern                        | Purpose                                    | TTL        |
|------------------------------------|--------------------------------------------|------------|
| `note:{noteId}:meta`               | Cached note metadata (title, tags, folder) | 5 min      |
| `vault:{vaultId}:folder-tree`      | Cached folder structure JSON               | 10 min     |
| `user:{userId}:session`            | Session presence (used by rate limiter)    | 15 min     |
| `ratelimit:{userId}:{window}`      | Rate limit counters (sliding window)       | 1 min      |
| Stream: `notes.events`             | Note lifecycle events                      | 7 days max |
| Stream: `media.events`             | Media upload events                        | 7 days max |

### 5.3 Qdrant

One Qdrant collection per vault, named `vault_{vaultId}`. Each point in the collection represents one chunk of a note:

```json
{
  "id": "chunk-uuid",
  "vector": [0.023, -0.142, ...],
  "payload": {
    "noteId": "note-uuid",
    "vaultId": "vault-uuid",
    "chunkIndex": 2,
    "chunkText": "...",
    "noteTitle": "...",
    "tags": ["ml", "research"],
    "updatedAt": "2026-03-27T10:00:00Z"
  }
}
```

Vector dimension: 384 (BGE-small). Distance metric: cosine. Index type: HNSW (default Qdrant).

### 5.4 MinIO

Bucket: `notebooklm-assets`. Object key structure:

```
{vaultId}/notes/{noteId}/content.md       ← large note content
{vaultId}/media/{assetId}/{filename}      ← uploaded files
{vaultId}/exports/{timestamp}/export.zip ← vault exports
```

Lifecycle rules: incomplete multipart uploads deleted after 24h. Exported zips deleted after 7 days.

---

## 6. Authentication Flow

```
┌────────┐          ┌─────────┐          ┌─────────────┐          ┌────────┐
│ Client │          │ Gateway │          │ auth-service │          │  DB    │
└───┬────┘          └────┬────┘          └──────┬───────┘          └───┬────┘
    │                    │                      │                       │
    │  POST /api/auth/login                     │                       │
    │  { email, password }                      │                       │
    │──────────────────→ │                      │                       │
    │                    │  proxy (no auth req) │                       │
    │                    │─────────────────────→│                       │
    │                    │                      │  SELECT user WHERE    │
    │                    │                      │  email = ?            │
    │                    │                      │──────────────────────→│
    │                    │                      │  ← user row           │
    │                    │                      │  bcrypt.compare()     │
    │                    │                      │  sign accessToken     │
    │                    │                      │  sign refreshToken    │
    │                    │                      │  INSERT refresh_tokens│
    │                    │                      │──────────────────────→│
    │  ← 200 { accessToken, refreshToken }      │
    │←──────────────────────────────────────────│
    │                    │                      │                       │
    │  GET /api/vaults   │                      │                       │
    │  Authorization: Bearer <accessToken>       │                       │
    │──────────────────→ │                      │                       │
    │                    │  JWT.verify()        │                       │
    │                    │  (symmetric — no DB) │                       │
    │                    │  inject X-User-Id    │                       │
    │                    │  proxy to vault-svc  │                       │
    │                    │──────────────────────────────────────────→   │
    │  ← 200 vaults[]    │                                              │
    │←──────────────────────────────────────────────────────────────    │
    │                    │                      │                       │
    │  POST /api/auth/refresh                   │                       │
    │  { refreshToken }                         │                       │
    │──────────────────→ │─────────────────────→│                       │
    │                    │                      │  verify refreshToken  │
    │                    │                      │  rotate: revoke old,  │
    │                    │                      │  issue new pair       │
    │  ← 200 { accessToken, refreshToken }      │                       │
    │←──────────────────────────────────────────│                       │
```

**Key design decisions:**
- Access tokens are short-lived (15 min) and stateless — verified by the gateway using the shared `JWT_SECRET` without a DB round-trip
- Refresh tokens are long-lived (7 days), stored hashed in PostgreSQL, and rotated on every use (refresh token rotation prevents replay attacks)
- On logout, the current refresh token is immediately revoked in the DB
- API keys bypass the JWT flow entirely: the gateway hashes the incoming key and looks it up in the `api_keys` table (cached in Redis for 5 min)

---

## 7. RAG Pipeline

RAG (Retrieval-Augmented Generation) is how the AI chat works. Instead of sending the user's question directly to the LLM, we first retrieve relevant content from the user's notes and include it in the prompt. This grounds the AI's response in the user's actual knowledge base.

```
User message: "What did I write about transformer attention mechanisms?"
        │
        ▼
┌───────────────────┐
│  1. EMBED QUERY   │  Call embedding-service /embed with query text
│                   │  → 384-dim vector
└────────┬──────────┘
         │
         ▼
┌───────────────────┐
│  2. HYBRID SEARCH │  Parallel:
│                   │  a) Qdrant cosine similarity search (semantic)
│                   │  b) PostgreSQL tsvector @@ tsquery (full-text)
│                   │  → top-20 chunks from each
└────────┬──────────┘
         │
         ▼
┌───────────────────┐
│  3. RERANK / RRF  │  Reciprocal Rank Fusion merges the two ranked lists
│                   │  → top-k=5 most relevant chunks selected
└────────┬──────────┘
         │
         ▼
┌───────────────────┐
│  4. BUILD PROMPT  │  System prompt + conversation history +
│                   │  retrieved chunks (with source metadata) +
│                   │  user message
└────────┬──────────┘
         │
         ▼
┌───────────────────┐
│  5. STREAM LLM    │  Send to Anthropic / OpenAI
│                   │  Stream tokens back to client via SSE
└────────┬──────────┘
         │
         ▼
┌───────────────────┐
│  6. PERSIST       │  Save conversation message + sources[] to DB
│                   │  Sources shown as clickable citations in UI
└───────────────────┘
```

**Chunking strategy:** Notes are split into overlapping 512-token windows with 64-token overlap. This ensures context is not lost at chunk boundaries. Short notes (< 512 tokens) are stored as a single chunk.

**Prompt structure:**
```
You are a knowledgeable assistant with access to the user's personal notes.
Answer questions based ONLY on the provided note excerpts.
If the answer is not in the notes, say so clearly.
Always cite which note(s) your answer draws from.

--- NOTE EXCERPTS ---
[1] Title: "Attention is All You Need - Notes"
    Tags: #ml #transformers #research
    ...chunk text...

[2] Title: "Deep Learning Study Log"
    ...chunk text...
---

Conversation history:
User: ...
Assistant: ...

Current question: What did I write about transformer attention mechanisms?
```

---

## 8. Event Flow

Here is the complete lifecycle of a note save operation and all its downstream effects:

```
User saves note in editor
         │
         ▼
vault-service PUT /notes/{id}
  ├─ Update notes table (content, fts_vector via trigger)
  ├─ Parse [[wikilinks]] → upsert links table
  ├─ Parse #tags → upsert note_tags
  └─ XADD notes.events * eventType note.updated noteId xxx vaultId yyy
         │
         ▼  (fan-out to 3 independent consumer groups)
         │
         ├──── Consumer group: graph-workers ────────────────────────────┐
         │     graph-service                                             │
         │     ├─ Read updated links for noteId from vault-service API   │
         │     ├─ Diff old edges vs new edges                            │
         │     └─ Upsert/delete edges in graph.edges table               │
         │                                                               │
         ├──── Consumer group: embedding-workers ────────────────────────┤
         │     embedding-service (Python)                                │
         │     ├─ Fetch note content from vault-service API              │
         │     ├─ Chunk text into 512-token windows                      │
         │     ├─ Compute embeddings (BGE-small, batched)                │
         │     ├─ Delete old Qdrant points for this noteId               │
         │     └─ Upsert new Qdrant points                               │
         │                                                               │
         └──── Consumer group: search-workers ─────────────────────────┘
               search-service
               ├─ PostgreSQL fts_vector already updated by trigger
               └─ Acknowledge event (no additional work needed for FTS)
```

**Failure handling:** If any consumer crashes mid-processing, the event remains in the PEL (pending entry list) and is re-delivered after `XAUTOCLAIM` timeout (default 30 seconds). Each consumer implements idempotent processing (upsert semantics) so re-processing is safe.

---

## 9. Frontend Architecture

### Tech Stack

| Concern              | Library / Approach                      |
|---------------------|-----------------------------------------|
| Framework           | Next.js 15 (App Router)                 |
| Language            | TypeScript                              |
| Styling             | Tailwind CSS v4                         |
| Component library   | shadcn/ui (Radix UI primitives)         |
| Rich text editor    | Tiptap v2 (ProseMirror-based)           |
| Graph visualization | `@react-sigma/core` (Sigma.js v3)       |
| Server state        | TanStack Query v5                       |
| Client state        | Zustand v5                              |
| Forms               | React Hook Form + Zod                   |
| AI streaming        | Custom hook using `EventSource` / `fetch` with `ReadableStream` |

### App Router Structure

```
app/
  (auth)/
    login/page.tsx
    register/page.tsx
  (app)/
    layout.tsx              ← sidebar + nav shell
    page.tsx                ← redirect to first vault
    vaults/
      page.tsx              ← vault list
      [vaultId]/
        page.tsx            ← vault home / graph view
        notes/
          [noteId]/page.tsx ← note editor
        search/page.tsx     ← search results
        chat/
          page.tsx          ← new conversation
          [conversationId]/page.tsx ← chat thread
        graph/page.tsx      ← full-screen graph
        settings/page.tsx   ← vault settings
  api/                      ← Next.js route handlers (thin proxies / BFF layer)
```

### State Management

**Server state (TanStack Query):** All data that lives in the backend — note content, vault list, search results, conversation history — is managed by TanStack Query. This gives automatic background refetching, optimistic updates, and cache invalidation.

**Client state (Zustand):** UI state that does not need to be persisted — editor dirty state, selected graph nodes, sidebar open/closed, active vault ID, pending wikilink resolution — lives in Zustand stores.

**Editor state (Tiptap):** The Markdown editor uses Tiptap with a custom `WikilinkExtension` that detects `[[` and opens a note picker popup with fuzzy search. On blur, the editor serializes to Markdown and triggers an auto-save (debounced 1 second).

### SSE for AI Chat

```typescript
// Simplified AI streaming hook
const streamChat = async (message: string) => {
  const response = await fetch(`${GATEWAY_URL}/api/ai/chat`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ conversationId, message, vaultId }),
  })
  const reader = response.body!.getReader()
  const decoder = new TextDecoder()
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    const chunk = decoder.decode(value)
    // parse SSE data: lines, update message state
    appendToken(chunk)
  }
}
```

---

## 10. Development Setup

See `docs/getting-started.md` for the full step-by-step guide.

### Directory Structure

```
notebooklm-clone/
├── apps/
│   ├── web/                    ← Next.js frontend (port 3008)
│   ├── gateway/                ← API gateway (port 3000)
│   ├── auth-service/           ← Auth + JWT (port 3001)
│   ├── vault-service/          ← Notes + vaults (port 3002)
│   ├── graph-service/          ← Knowledge graph (port 3003)
│   ├── search-service/         ← Hybrid search (port 3004)
│   ├── ai-service/             ← RAG + chat (port 3005)
│   ├── embedding-service/      ← Python embeddings (port 3006)
│   └── media-service/          ← File uploads (port 3007)
├── packages/
│   ├── types/                  ← Shared TypeScript types
│   ├── utils/                  ← Shared utilities
│   └── db/                     ← Shared DB client + migrations (Drizzle ORM)
├── infra/
│   ├── docker-compose.yml      ← Full stack
│   └── docker-compose.dev.yml  ← Infrastructure only (for local dev)
├── docs/
│   ├── architecture.md         ← This file
│   ├── getting-started.md
│   ├── api-reference.md
│   └── adr/                    ← Architecture Decision Records
├── .env.example
├── turbo.json
├── pnpm-workspace.yaml
└── package.json
```
