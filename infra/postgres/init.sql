-- =============================================================================
-- NotebookLM Clone — PostgreSQL Initialization Script
-- Creates schemas and tables for all microservices.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Extensions
-- ---------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";   -- for trigram-based text search

-- ---------------------------------------------------------------------------
-- Schemas
-- ---------------------------------------------------------------------------
CREATE SCHEMA IF NOT EXISTS auth;
CREATE SCHEMA IF NOT EXISTS vault;
CREATE SCHEMA IF NOT EXISTS graph_svc;
CREATE SCHEMA IF NOT EXISTS search_svc;
CREATE SCHEMA IF NOT EXISTS ai_svc;
CREATE SCHEMA IF NOT EXISTS media_svc;

-- =============================================================================
-- AUTH SCHEMA
-- =============================================================================

CREATE TABLE auth.users (
    id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email         VARCHAR(320) UNIQUE NOT NULL,
    password_hash VARCHAR(255)        NOT NULL,
    display_name  VARCHAR(100),
    avatar_url    TEXT,
    is_active     BOOLEAN            NOT NULL DEFAULT TRUE,
    created_at    TIMESTAMPTZ        NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ        NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_auth_users_email ON auth.users (email);

-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE auth.api_keys (
    id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id      UUID        NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
    key_hash     VARCHAR(255) NOT NULL UNIQUE,
    name         VARCHAR(100) NOT NULL,
    last_used_at TIMESTAMPTZ,
    expires_at   TIMESTAMPTZ,
    created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_auth_api_keys_user_id  ON auth.api_keys (user_id);
CREATE INDEX idx_auth_api_keys_key_hash ON auth.api_keys (key_hash);

-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE auth.refresh_tokens (
    id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id    UUID         NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
    token_hash VARCHAR(255) NOT NULL UNIQUE,
    expires_at TIMESTAMPTZ  NOT NULL,
    revoked_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_auth_refresh_tokens_user_id    ON auth.refresh_tokens (user_id);
CREATE INDEX idx_auth_refresh_tokens_token_hash ON auth.refresh_tokens (token_hash);
CREATE INDEX idx_auth_refresh_tokens_expires_at ON auth.refresh_tokens (expires_at);

-- =============================================================================
-- VAULT SCHEMA
-- =============================================================================

CREATE TABLE vault.vaults (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id     UUID         NOT NULL,   -- references auth.users logically (cross-schema)
    name        VARCHAR(255) NOT NULL,
    description TEXT,
    is_public   BOOLEAN      NOT NULL DEFAULT FALSE,
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_vault_vaults_user_id ON vault.vaults (user_id);

-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE vault.folders (
    id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    vault_id   UUID         NOT NULL REFERENCES vault.vaults (id) ON DELETE CASCADE,
    parent_id  UUID         REFERENCES vault.folders (id) ON DELETE CASCADE,   -- self-reference, nullable = root
    name       VARCHAR(255) NOT NULL,
    path       TEXT         NOT NULL,   -- full materialized path e.g. /docs/api
    created_at TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    UNIQUE (vault_id, path)
);

CREATE INDEX idx_vault_folders_vault_id  ON vault.folders (vault_id);
CREATE INDEX idx_vault_folders_parent_id ON vault.folders (parent_id);
CREATE INDEX idx_vault_folders_path      ON vault.folders USING BTREE (path);

-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE vault.notes (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    vault_id    UUID         NOT NULL REFERENCES vault.vaults   (id) ON DELETE CASCADE,
    folder_id   UUID         REFERENCES vault.folders (id) ON DELETE SET NULL,
    title       VARCHAR(500) NOT NULL DEFAULT 'Untitled',
    content     TEXT         NOT NULL DEFAULT '',
    frontmatter JSONB        NOT NULL DEFAULT '{}',
    slug        VARCHAR(600),
    word_count  INT          NOT NULL DEFAULT 0,
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    UNIQUE (vault_id, slug)
);

CREATE INDEX idx_vault_notes_vault_id   ON vault.notes (vault_id);
CREATE INDEX idx_vault_notes_folder_id  ON vault.notes (folder_id);
CREATE INDEX idx_vault_notes_slug       ON vault.notes (vault_id, slug);
CREATE INDEX idx_vault_notes_title_trgm ON vault.notes USING GIN (title gin_trgm_ops);
CREATE INDEX idx_vault_notes_updated_at ON vault.notes (updated_at DESC);

-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE vault.tags (
    id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    vault_id   UUID        NOT NULL REFERENCES vault.vaults (id) ON DELETE CASCADE,
    name       VARCHAR(100) NOT NULL,
    color      VARCHAR(7),    -- hex color e.g. #ff5733
    created_at TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    UNIQUE (vault_id, name)
);

CREATE INDEX idx_vault_tags_vault_id ON vault.tags (vault_id);

-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE vault.note_tags (
    note_id UUID NOT NULL REFERENCES vault.notes (id) ON DELETE CASCADE,
    tag_id  UUID NOT NULL REFERENCES vault.tags  (id) ON DELETE CASCADE,
    PRIMARY KEY (note_id, tag_id)
);

CREATE INDEX idx_vault_note_tags_tag_id  ON vault.note_tags (tag_id);
CREATE INDEX idx_vault_note_tags_note_id ON vault.note_tags (note_id);

-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE vault.wikilinks (
    id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    source_note_id UUID         NOT NULL REFERENCES vault.notes (id) ON DELETE CASCADE,
    target_title   VARCHAR(500) NOT NULL,     -- raw [[target]] text as written
    target_note_id UUID         REFERENCES vault.notes (id) ON DELETE SET NULL,  -- resolved, nullable
    created_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_vault_wikilinks_source_note_id ON vault.wikilinks (source_note_id);
CREATE INDEX idx_vault_wikilinks_target_note_id ON vault.wikilinks (target_note_id);
CREATE INDEX idx_vault_wikilinks_target_title   ON vault.wikilinks (target_title);

-- =============================================================================
-- GRAPH_SVC SCHEMA
-- (Graph service derives data from vault schema but may cache computed layouts)
-- =============================================================================

CREATE TABLE graph_svc.layout_cache (
    id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    vault_id   UUID        NOT NULL UNIQUE,
    layout     JSONB       NOT NULL DEFAULT '{}',   -- stores x,y positions for each node
    version    INT         NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_graph_svc_layout_cache_vault_id ON graph_svc.layout_cache (vault_id);

-- =============================================================================
-- SEARCH_SVC SCHEMA
-- (Search service tracks indexing state; actual vectors live in Qdrant)
-- =============================================================================

CREATE TABLE search_svc.index_status (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    note_id         UUID        NOT NULL UNIQUE,
    vault_id        UUID        NOT NULL,
    embedding_model VARCHAR(100),
    indexed_at      TIMESTAMPTZ,
    content_hash    VARCHAR(64),   -- sha256 of note content, to detect changes
    status          VARCHAR(20)  NOT NULL DEFAULT 'pending'  -- pending | indexed | failed
        CHECK (status IN ('pending', 'indexed', 'failed')),
    error_message   TEXT,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_search_svc_index_status_vault_id  ON search_svc.index_status (vault_id);
CREATE INDEX idx_search_svc_index_status_status    ON search_svc.index_status (status);

-- =============================================================================
-- AI_SVC SCHEMA
-- =============================================================================

CREATE TABLE ai_svc.conversations (
    id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id    UUID         NOT NULL,
    vault_id   UUID         NOT NULL,
    title      VARCHAR(500) NOT NULL DEFAULT 'New Conversation',
    created_at TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_ai_svc_conversations_user_id  ON ai_svc.conversations (user_id);
CREATE INDEX idx_ai_svc_conversations_vault_id ON ai_svc.conversations (vault_id);
CREATE INDEX idx_ai_svc_conversations_updated  ON ai_svc.conversations (updated_at DESC);

-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE ai_svc.messages (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    conversation_id UUID        NOT NULL REFERENCES ai_svc.conversations (id) ON DELETE CASCADE,
    role            VARCHAR(20) NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
    content         TEXT        NOT NULL,
    sources         JSONB       NOT NULL DEFAULT '[]',   -- array of ChatSource objects
    token_count     INT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_ai_svc_messages_conversation_id ON ai_svc.messages (conversation_id);
CREATE INDEX idx_ai_svc_messages_created_at      ON ai_svc.messages (created_at ASC);

-- =============================================================================
-- MEDIA_SVC SCHEMA
-- =============================================================================

CREATE TABLE media_svc.assets (
    id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id        UUID         NOT NULL,
    vault_id       UUID,             -- nullable: asset may not be tied to a vault yet
    filename       VARCHAR(255) NOT NULL,     -- sanitized filename used for storage
    original_name  VARCHAR(500) NOT NULL,     -- original filename from upload
    mime_type      VARCHAR(100) NOT NULL,
    size_bytes     BIGINT       NOT NULL,
    storage_key    VARCHAR(1000) NOT NULL UNIQUE,   -- MinIO object key
    extracted_text TEXT,            -- OCR / PDF text extraction result
    metadata       JSONB        NOT NULL DEFAULT '{}',
    created_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_media_svc_assets_user_id   ON media_svc.assets (user_id);
CREATE INDEX idx_media_svc_assets_vault_id  ON media_svc.assets (vault_id);
CREATE INDEX idx_media_svc_assets_mime_type ON media_svc.assets (mime_type);

-- =============================================================================
-- Triggers — auto-update updated_at columns
-- =============================================================================

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- auth
CREATE TRIGGER trg_auth_users_updated_at
    BEFORE UPDATE ON auth.users
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- vault
CREATE TRIGGER trg_vault_vaults_updated_at
    BEFORE UPDATE ON vault.vaults
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_vault_folders_updated_at
    BEFORE UPDATE ON vault.folders
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_vault_notes_updated_at
    BEFORE UPDATE ON vault.notes
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- graph_svc
CREATE TRIGGER trg_graph_svc_layout_cache_updated_at
    BEFORE UPDATE ON graph_svc.layout_cache
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- search_svc
CREATE TRIGGER trg_search_svc_index_status_updated_at
    BEFORE UPDATE ON search_svc.index_status
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ai_svc
CREATE TRIGGER trg_ai_svc_conversations_updated_at
    BEFORE UPDATE ON ai_svc.conversations
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- media_svc
CREATE TRIGGER trg_media_svc_assets_updated_at
    BEFORE UPDATE ON media_svc.assets
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
