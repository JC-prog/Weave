import { z } from 'zod';

// =============================================================================
// Individual environment variable schemas
// =============================================================================

const commonSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'production', 'test'])
    .default('development'),
  LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
    .default('info'),
});

const databaseSchema = z.object({
  DATABASE_URL: z
    .string()
    .url()
    .default('postgresql://notebooklm:secret@localhost:5432/notebooklm'),
});

const redisSchema = z.object({
  REDIS_URL: z.string().url().default('redis://localhost:6379'),
});

const authSchema = z.object({
  JWT_SECRET: z
    .string()
    .min(32, 'JWT_SECRET must be at least 32 characters')
    .default('change-me-in-production-jwt-secret-32chars'),
  JWT_REFRESH_SECRET: z
    .string()
    .min(32, 'JWT_REFRESH_SECRET must be at least 32 characters')
    .default('change-me-in-production-refresh-secret-32chars'),
  JWT_EXPIRES_IN: z.string().default('15m'),
  JWT_REFRESH_EXPIRES_IN: z.string().default('7d'),
});

const qdrantSchema = z.object({
  QDRANT_URL: z.string().url().default('http://localhost:6333'),
});

const minioSchema = z.object({
  MINIO_ENDPOINT: z.string().default('localhost'),
  MINIO_PORT: z.coerce.number().int().positive().default(9000),
  MINIO_USE_SSL: z
    .string()
    .transform((v) => v === 'true')
    .default('false'),
  MINIO_ACCESS_KEY: z.string().default('minioadmin'),
  MINIO_SECRET_KEY: z.string().default('minioadmin123'),
  MINIO_BUCKET: z.string().default('notebooklm-assets'),
});

const aiSchema = z.object({
  ANTHROPIC_API_KEY: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),
  AI_PROVIDER: z.enum(['anthropic', 'openai']).default('anthropic'),
  EMBEDDING_MODEL: z.string().default('text-embedding-3-small'),
  AI_MAX_TOKENS: z.coerce.number().int().positive().default(4096),
  AI_TEMPERATURE: z.coerce.number().min(0).max(2).default(0.7),
  /** Number of source notes to retrieve per RAG query */
  RAG_TOP_K: z.coerce.number().int().positive().default(5),
  RAG_SIMILARITY_THRESHOLD: z.coerce.number().min(0).max(1).default(0.7),
});

const servicesSchema = z.object({
  AUTH_SERVICE_URL: z
    .string()
    .url()
    .default('http://localhost:3001'),
  VAULT_SERVICE_URL: z
    .string()
    .url()
    .default('http://localhost:3002'),
  GRAPH_SERVICE_URL: z
    .string()
    .url()
    .default('http://localhost:3003'),
  SEARCH_SERVICE_URL: z
    .string()
    .url()
    .default('http://localhost:3004'),
  AI_SERVICE_URL: z
    .string()
    .url()
    .default('http://localhost:3005'),
  EMBEDDING_SERVICE_URL: z
    .string()
    .url()
    .default('http://localhost:3006'),
  MEDIA_SERVICE_URL: z
    .string()
    .url()
    .default('http://localhost:3007'),
});

// =============================================================================
// Combined schema
// =============================================================================

const envSchema = commonSchema
  .merge(databaseSchema)
  .merge(redisSchema)
  .merge(authSchema)
  .merge(qdrantSchema)
  .merge(minioSchema)
  .merge(aiSchema)
  .merge(servicesSchema);

// =============================================================================
// Inferred types
// =============================================================================

export type Env = z.infer<typeof envSchema>;

export type CommonConfig = z.infer<typeof commonSchema>;
export type DatabaseConfig = z.infer<typeof databaseSchema>;
export type RedisConfig = z.infer<typeof redisSchema>;
export type AuthConfig = z.infer<typeof authSchema>;
export type QdrantConfig = z.infer<typeof qdrantSchema>;
export type MinioConfig = z.infer<typeof minioSchema>;
export type AiConfig = z.infer<typeof aiSchema>;
export type ServicesConfig = z.infer<typeof servicesSchema>;

// =============================================================================
// Config accessor — parsed lazily and cached per process
// =============================================================================

let _cache: Env | null = null;

/**
 * Parse `process.env` against the full environment schema.
 *
 * - In development, any missing required variables will throw with a clear
 *   Zod error message listing each problem.
 * - Sensible defaults are applied so that the app starts with a minimal
 *   `.env` (or no `.env` at all) during local development.
 *
 * The result is memoised — subsequent calls return the same object.
 * Call `resetConfig()` in tests to force re-parsing.
 */
export function getConfig(): Env {
  if (_cache) return _cache;

  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    const formatted = result.error.errors
      .map((e) => `  • ${e.path.join('.')}: ${e.message}`)
      .join('\n');
    throw new Error(
      `[config] Environment validation failed:\n${formatted}\n\nPlease check your .env file.`,
    );
  }

  _cache = result.data;
  return _cache;
}

/**
 * Reset the config cache — primarily useful in test suites that manipulate
 * `process.env` between test cases.
 */
export function resetConfig(): void {
  _cache = null;
}

/**
 * Validate the environment without caching — useful in health-check endpoints
 * or startup scripts that want an explicit parse every time.
 */
export function validateEnv(): { success: true; config: Env } | { success: false; errors: string[] } {
  const result = envSchema.safeParse(process.env);
  if (result.success) {
    return { success: true, config: result.data };
  }
  return {
    success: false,
    errors: result.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`),
  };
}

// Re-export zod for consumers that want to extend the schema
export { z };
