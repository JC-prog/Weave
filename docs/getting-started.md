# Getting Started

This guide walks you through running the full NotebookLM Clone stack locally, from first clone to creating your first AI-powered note.

---

## Prerequisites

Ensure the following are installed before continuing:

| Tool         | Minimum Version | Notes                                              |
|--------------|-----------------|----------------------------------------------------|
| Node.js      | 20.0.0+         | Use [nvm](https://github.com/nvm-sh/nvm) or [fnm](https://github.com/Schniz/fnm) to manage versions |
| pnpm         | 9.0.0+          | `npm install -g pnpm`                              |
| Docker       | 24.0+           | Required for all infrastructure services           |
| Docker Compose | v2 (plugin)   | Comes bundled with Docker Desktop                  |
| Python       | 3.12+           | Required only if running embedding-service locally outside Docker |
| Git          | any             |                                                    |

**Verify your environment:**
```bash
node --version    # should print v20.x.x or higher
pnpm --version    # should print 9.x.x or higher
docker --version  # should print 24.x.x or higher
python3 --version # should print 3.12.x or higher
```

---

## Step 1 — Clone the Repository

```bash
git clone https://github.com/your-org/notebooklm-clone.git
cd notebooklm-clone
```

---

## Step 2 — Install Dependencies

From the repo root, install all workspace dependencies in one command. Turbo and pnpm handle the monorepo automatically:

```bash
pnpm install
```

This installs dependencies for all packages in `apps/*` and `packages/*`. It will also set up the shared `packages/types`, `packages/utils`, and `packages/db` workspace packages.

**Troubleshooting:** If you see peer dependency warnings, they are generally safe to ignore. If `pnpm install` fails with a Node.js version error, ensure you are on Node 20+.

---

## Step 3 — Configure Environment Variables

Copy the example environment file to `.env`:

```bash
cp .env.example .env
```

Now open `.env` in your editor and fill in the required values:

### Required — AI Provider (pick one)

**Option A: Anthropic Claude (recommended)**
```env
AI_PROVIDER=anthropic
ANTHROPIC_API_KEY=sk-ant-api03-...   # Get from https://console.anthropic.com
```

**Option B: OpenAI**
```env
AI_PROVIDER=openai
OPENAI_API_KEY=sk-proj-...           # Get from https://platform.openai.com
```

**Option C: Local Ollama (no API key needed)**
```env
AI_PROVIDER=ollama
# Make sure Ollama is running locally: https://ollama.ai
```

### Required — JWT Secrets

Generate cryptographically strong secrets:
```bash
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
```

Set the output as `JWT_SECRET` and run again for `JWT_REFRESH_SECRET`.

### Optional — Change Default Ports

If any default ports (3000–3008) conflict with existing services on your machine, change the `*_PORT` variables in `.env`. If you change service ports, also update the corresponding `*_SERVICE_URL` variables.

### All other variables

The remaining variables (database credentials, MinIO keys, Redis URL, Qdrant URL) work out of the box with the Docker Compose setup provided. Only change them if you are connecting to external services.

---

## Step 4 — Start Infrastructure Services

The infrastructure services (PostgreSQL, Redis, Qdrant, MinIO) are run via Docker Compose. You do not need to install any of these locally.

```bash
docker compose -f infra/docker-compose.yml up -d postgres redis qdrant minio
```

This starts:

| Service    | Port  | Admin UI                                    |
|------------|-------|---------------------------------------------|
| PostgreSQL | 5432  | Use `psql` or any GUI (TablePlus, DBeaver)  |
| Redis      | 6379  | `redis-cli` or RedisInsight                 |
| Qdrant     | 6333  | http://localhost:6333/dashboard             |
| MinIO      | 9000  | http://localhost:9001 (admin: minioadmin / minioadmin123) |

Wait ~10 seconds for all containers to become healthy. You can check with:

```bash
docker compose -f infra/docker-compose.yml ps
```

All services should show `healthy` in the status column.

---

## Step 5 — Run Database Migrations

Apply all schema migrations to set up the PostgreSQL database:

```bash
pnpm db:migrate
```

This runs Drizzle ORM migrations for all services (auth, vault, graph, ai, media schemas) in the correct order.

---

## Step 6 — Start All Services in Development Mode

### Option A: Local development (recommended for contributing)

Start all services with hot-reload using Turborepo:

```bash
pnpm dev
```

Turborepo's interactive TUI will show you logs for each service. All TypeScript services use `tsx --watch` for hot-reload. The Python embedding service uses `uvicorn --reload`.

Individual service logs can be filtered in the TUI by pressing the service name. To exit, press `q` or `Ctrl+C`.

**First start:** The embedding service downloads the `BAAI/bge-small-en-v1.5` model (~130MB) from HuggingFace on first startup. This is cached in `.cache/huggingface/` and only downloaded once.

### Option B: Run a single service

If you only need to work on one service, you can start just that service (plus its dependencies):

```bash
# Start only the web frontend
pnpm --filter web dev

# Start only the vault service
pnpm --filter vault-service dev

# Start only the AI service
pnpm --filter ai-service dev
```

---

## Step 7 — Run the Full Stack with Docker (Alternative)

If you prefer not to install Node.js or Python locally, you can run everything in Docker:

```bash
docker compose -f infra/docker-compose.yml up
```

This builds and starts all services including the web frontend. Use `--build` to force a rebuild after code changes:

```bash
docker compose -f infra/docker-compose.yml up --build
```

To run in the background:
```bash
docker compose -f infra/docker-compose.yml up -d
docker compose -f infra/docker-compose.yml logs -f  # follow logs
```

---

## Step 8 — Access the Application

Once all services are running:

| Service          | URL                        | Description                      |
|------------------|----------------------------|----------------------------------|
| Web App          | http://localhost:3008      | Main application UI              |
| API Gateway      | http://localhost:3000      | All API requests go through here |
| Qdrant Dashboard | http://localhost:6333/dashboard | Vector store admin UI       |
| MinIO Console    | http://localhost:9001      | Object storage admin UI          |

---

## Step 9 — First-Time Setup

### Register an Account

1. Open http://localhost:3008
2. Click **Get Started** or navigate to `/register`
3. Enter your email and a password (min 8 characters)
4. You will be automatically logged in and redirected to the vault creation screen

### Create Your First Vault

A **vault** is your top-level workspace — think of it as an Obsidian vault or a Google NotebookLM notebook collection. You can have multiple vaults for different projects or contexts.

1. Click **New Vault**
2. Give it a name (e.g., "Research", "Personal", "Work")
3. Optionally add a description
4. Click **Create**

### Create Your First Note

1. In the left sidebar, click **+ New Note** (or press `Cmd/Ctrl + N`)
2. Give the note a title
3. Start writing in Markdown. Try:
   - `# Heading`, `**bold**`, `*italic*`
   - `[[Another Note]]` — this creates a wikilink. If the target note doesn't exist, it will be created on first visit
   - `#tag` — inline tags for organization
4. Notes save automatically with a 1-second debounce (you'll see a subtle "Saved" indicator)

### Upload a Document

1. Click **Upload** in the sidebar or drag a file into the vault
2. Supported formats: PDF, plain text (`.txt`, `.md`), images (PNG, JPEG, WebP)
3. PDFs are automatically parsed and their text is indexed for semantic search

### Chat with Your Notes

1. Click **AI Chat** in the left sidebar
2. Type a question about your notes, e.g., "What are the main themes across my research notes?"
3. The AI will search your notes, retrieve relevant excerpts, and answer with citations pointing to specific notes
4. Click any cited note title to jump directly to it

### Explore the Graph

1. Click **Graph View** to see all your notes as an interactive force-directed graph
2. Nodes are notes; edges are `[[wikilinks]]` between them
3. Drag nodes to rearrange. Click a node to open the note in a side panel
4. Use filters to highlight by tag or folder

---

## Development Workflow Tips

### Adding a new dependency to a specific app

```bash
pnpm --filter auth-service add fastify-plugin
pnpm --filter web add @tanstack/react-query
```

### Adding a shared dependency

```bash
pnpm --filter @notebooklm/types add zod
```

### Running tests

```bash
pnpm test                        # all tests
pnpm --filter vault-service test # single service
```

### Linting and formatting

```bash
pnpm lint     # run ESLint across all packages
pnpm format   # run Prettier across all packages
```

### Resetting the database

If you need a clean slate:
```bash
docker compose -f infra/docker-compose.yml down -v  # removes volumes
docker compose -f infra/docker-compose.yml up -d postgres redis qdrant minio
pnpm db:migrate
```

### Viewing Redis Streams

```bash
docker exec -it notebooklm-redis redis-cli
> XLEN notes.events
> XRANGE notes.events - + COUNT 10
```

---

## Environment Variable Reference

See `.env.example` for the full list with descriptions. Key variables:

| Variable            | Required | Default              | Description                          |
|---------------------|----------|----------------------|--------------------------------------|
| `DATABASE_URL`      | Yes      | (Docker default)     | PostgreSQL connection string         |
| `REDIS_URL`         | Yes      | (Docker default)     | Redis connection string              |
| `QDRANT_URL`        | Yes      | (Docker default)     | Qdrant HTTP URL                      |
| `JWT_SECRET`        | Yes      | (must set)           | HS256 secret for access tokens       |
| `JWT_REFRESH_SECRET`| Yes      | (must set)           | HS256 secret for refresh tokens      |
| `ANTHROPIC_API_KEY` | If using Anthropic | —         | Claude API key                       |
| `OPENAI_API_KEY`    | If using OpenAI    | —         | OpenAI API key                       |
| `AI_PROVIDER`       | No       | `anthropic`          | `anthropic` \| `openai` \| `ollama`  |
| `EMBEDDING_MODEL`   | No       | `BAAI/bge-small-en-v1.5` | HuggingFace model ID            |
| `LOG_LEVEL`         | No       | `debug`              | `debug` \| `info` \| `warn` \| `error` |
