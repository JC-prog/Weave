# ADR 001 — Use Microservices Architecture

**Status:** Accepted
**Date:** 2026-03-27
**Author:** Engineering Team

---

## Context

We are building a self-hosted personal knowledge management system with AI capabilities. The system needs to support a web frontend initially, with a clear path to future mobile and desktop clients. It must handle several distinct workloads simultaneously:

- **Real-time note editing** with wikilink resolution (latency-sensitive, requires direct DB access)
- **Graph computation** from wikilinks (moderately CPU-intensive, can tolerate slight delay)
- **Embedding generation** for semantic search (CPU/GPU intensive, batch-friendly, long-running)
- **Full-text search** indexing (I/O-bound, needs tight coupling with PostgreSQL)
- **AI chat** with LLM providers (I/O-bound, streaming, third-party rate limits)
- **File storage and processing** (I/O-bound, requires multipart handling)
- **Authentication and authorization** (critical path, must be fast and isolated)

In a monolithic design, all of these concerns share the same process, deployment unit, and technology. This creates several problems:

1. **Scaling conflicts:** Embedding generation is CPU/GPU intensive and benefits from vertical scaling or GPU nodes, while the note editor API is I/O-bound and scales horizontally. In a monolith, you must scale both together.

2. **Technology lock-in:** Embedding generation is best implemented in Python (rich ML ecosystem: `sentence-transformers`, `torch`, HuggingFace Hub). The rest of the stack is best served by Node.js/TypeScript (Fastify, Next.js). A monolith forces a single language choice.

3. **Deployment coupling:** A bug or memory leak in the embedding worker would bring down the entire note-taking API in a monolith.

4. **Team parallelism:** As the project grows, independent services allow different developers (or future contributors) to work on different services without merge conflicts and without needing to understand the full codebase.

5. **Multi-client future:** Future mobile or desktop clients (Electron, React Native, Tauri) need a clean API surface, not a tightly coupled server-side rendered monolith. An API gateway pattern is the natural fit.

### Alternatives Considered

**Option A: Monolith with modular structure**
A single Node.js process with clear internal module boundaries. Simpler to operate, easier to debug, lower latency (no network hops between modules). However, it rules out the Python embedding service, makes independent scaling impossible, and creates a single point of failure for all features.

**Option B: Modular monolith + embedding sidecar**
Keep the main application as a monolith but run the embedding service as a separate Python process. This is a partial decomposition — better than a full monolith, but doesn't solve the scaling problem for other concerns (e.g., AI service may have completely different scaling needs than vault CRUD).

**Option C: Full microservices (8 services)**
Each concern is its own deployable service with its own technology choice, independent scaling, and isolated failure domain. Higher operational complexity, but each service is small and focused.

---

## Decision

We adopt **Option C: full microservices architecture** with 8 services:

| Service           | Port | Technology       | Primary Responsibility                   |
|-------------------|------|------------------|------------------------------------------|
| gateway           | 3000 | Node.js/Fastify  | Auth middleware, routing, rate limiting  |
| auth-service      | 3001 | Node.js/Fastify  | JWT auth, user management, API keys      |
| vault-service     | 3002 | Node.js/Fastify  | Notes, folders, wikilinks, tags          |
| graph-service     | 3003 | Node.js/Fastify  | Knowledge graph, analytics               |
| search-service    | 3004 | Node.js/Fastify  | Hybrid full-text + semantic search       |
| ai-service        | 3005 | Node.js/Fastify  | RAG pipeline, chat, summarization        |
| embedding-service | 3006 | Python/FastAPI   | Text embedding, Qdrant indexing          |
| media-service     | 3007 | Node.js/Fastify  | File upload, MinIO, PDF extraction       |

Services communicate via:
- **Synchronous REST** (client-initiated requests via gateway)
- **Redis Streams** (async event propagation for graph, search, and embedding updates)
- **Server-Sent Events** (AI response streaming from ai-service to client through gateway)

All services run behind the API gateway. Clients never call downstream services directly. The gateway handles JWT validation, adds `X-User-Id` to forwarded requests, and enforces rate limits.

---

## Consequences

### Positive

**Independent scaling:** The embedding service can be given more CPU/GPU resources without affecting the note editor API. The AI service can be scaled up during peak chat usage without scaling the vault service.

**Technology diversity:** The embedding service is written in Python 3.12 with `sentence-transformers` and FastAPI — the best tooling for this problem. All other services use Node.js/TypeScript — consistent, well-typed, fast I/O. We don't force a compromise.

**Fault isolation:** If the embedding service crashes, users can still create and read notes. If the AI service hits a rate limit from the LLM provider, search and editing continue to work normally. Failures are contained to the affected service.

**Clear API contracts:** Each service exposes a well-defined REST API. This makes it straightforward to replace a service's implementation, add new clients, or write integration tests against the public interface.

**Independent deployment:** In a future CI/CD pipeline, a change to the graph service only requires rebuilding and redeploying that service, not the entire stack.

### Negative

**Operational complexity:** Running 8 services (plus 4 infrastructure services) locally requires Docker Compose. Debugging a request that touches multiple services requires distributed tracing or careful log correlation. A monolith would be far simpler to run and debug.

**Network latency:** Operations that require inter-service calls (e.g., embedding service fetching note content from vault service) incur network round-trips. In a monolith this would be a function call. This is mitigated by Redis caching and keeping inter-service calls to a minimum.

**Data consistency:** With multiple services each owning their portion of the data, maintaining consistency across service boundaries requires care. We use the Redis Streams event bus for eventual consistency (graph, embeddings) and accept that these may lag slightly behind vault writes by a few hundred milliseconds.

**Shared code duplication risk:** Without a well-maintained `packages/` directory, each service will duplicate types, utility functions, and HTTP client code. We mitigate this with the shared `packages/types` and `packages/utils` workspace packages.

### Neutral / Mitigations

- **Local development:** `pnpm dev` with Turborepo's TUI makes running all services locally as simple as a monolith from the developer's perspective.
- **Shared database:** Services share one PostgreSQL instance (with separate schemas) to simplify infrastructure in the self-hosted case. In a cloud deployment, each service could have its own database instance.
- **Start small:** Services can begin as simple pass-through implementations and grow in complexity over time. The architecture doesn't impose complexity upfront.
