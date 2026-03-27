import pino, { Logger, LoggerOptions } from 'pino';

// =============================================================================
// Environment helpers
// =============================================================================

const isDevelopment =
  process.env['NODE_ENV'] === 'development' || process.env['NODE_ENV'] === undefined;

const logLevel = (process.env['LOG_LEVEL'] ?? (isDevelopment ? 'debug' : 'info')) as pino.Level;

// =============================================================================
// Transport configuration
// =============================================================================

/**
 * In development we pipe through pino-pretty for human-readable output.
 * In production we emit raw JSON which can be ingested by any log aggregator
 * (Loki, Datadog, CloudWatch, etc.).
 */
function buildTransport(): LoggerOptions['transport'] {
  if (!isDevelopment) return undefined;

  return {
    target: 'pino-pretty',
    options: {
      colorize: true,
      translateTime: 'SYS:yyyy-mm-dd HH:MM:ss',
      ignore: 'pid,hostname',
      messageFormat: '[{service}] {msg}',
      singleLine: false,
    },
  };
}

// =============================================================================
// Base logger options
// =============================================================================

const baseOptions: LoggerOptions = {
  level: logLevel,
  formatters: {
    level(label) {
      // Use the string label ("info", "error", …) instead of the numeric value
      return { level: label };
    },
    bindings(bindings) {
      // Drop the default pid/hostname in the JSON output — they add noise without
      // being useful when running inside containers that already tag logs.
      return {
        pid: bindings['pid'],
        host: bindings['hostname'],
      };
    },
  },
  timestamp: pino.stdTimeFunctions.isoTime,
  base: {
    env: process.env['NODE_ENV'] ?? 'development',
  },
  transport: buildTransport(),
  // Redact sensitive fields from all log output
  redact: {
    paths: [
      'password',
      'passwordHash',
      'password_hash',
      'token',
      'accessToken',
      'refreshToken',
      'apiKey',
      'api_key',
      'authorization',
      'req.headers.authorization',
      'req.headers.cookie',
      '*.secret',
      '*.password',
    ],
    censor: '[REDACTED]',
  },
};

// =============================================================================
// Root logger instance
// =============================================================================

const rootLogger: Logger = pino(baseOptions);

// =============================================================================
// Public API
// =============================================================================

/**
 * Create a child logger tagged with a `service` name.  All log lines emitted
 * by this child will include `"service": "<name>"` in the JSON output (and in
 * the pino-pretty message prefix during development).
 *
 * @example
 * ```ts
 * import { createLogger } from '@notebooklm/logger';
 * const logger = createLogger('vault-service');
 * logger.info({ vaultId }, 'Vault created');
 * ```
 */
export function createLogger(name: string): Logger {
  return rootLogger.child({ service: name });
}

/**
 * Create a child logger scoped to a specific HTTP request context.
 * Attach `requestId`, `method`, and `path` to every log line within a request.
 */
export function createRequestLogger(
  parentLogger: Logger,
  requestId: string,
  method: string,
  path: string,
): Logger {
  return parentLogger.child({ requestId, method, path });
}

/**
 * Convenience helper: log an unhandled error with full stack trace and optional
 * extra context, then re-throw so the process can exit cleanly.
 */
export function logFatalAndExit(err: unknown, context?: Record<string, unknown>): never {
  rootLogger.fatal({ err, ...context }, 'Unhandled fatal error — shutting down');
  process.exit(1);
}

/**
 * Default logger instance using the root service name "app".
 * Import this directly when you don't need a named service logger.
 *
 * @example
 * ```ts
 * import { logger } from '@notebooklm/logger';
 * logger.info('Server started');
 * ```
 */
export const logger: Logger = createLogger('app');

// Re-export pino types so consumers don't need a direct pino dependency
export type { Logger, Level } from 'pino';
export default logger;
