// =============================================================================
// Auth types — shared between auth-service and gateway / client
// =============================================================================

export interface User {
  id: string;
  email: string;
  displayName: string | null;
  avatarUrl: string | null;
  isActive: boolean;
  createdAt: string; // ISO 8601
  updatedAt: string;
}

/** Public projection — never includes password_hash */
export type PublicUser = Omit<User, 'isActive'>;

export interface ApiKey {
  id: string;
  userId: string;
  /** The key itself is only returned once at creation time; afterwards only the hash is stored */
  key?: string;
  name: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// JWT Payload
// ---------------------------------------------------------------------------

export interface TokenPayload {
  /** Subject — equals user.id */
  sub: string;
  userId: string;
  email: string;
  /** Issued-at (Unix seconds) */
  iat: number;
  /** Expires-at (Unix seconds) */
  exp: number;
  /** Token type — distinguish access vs refresh on the payload level */
  type: 'access' | 'refresh';
}

// ---------------------------------------------------------------------------
// DTOs
// ---------------------------------------------------------------------------

export interface RegisterDto {
  email: string;
  password: string;
  displayName?: string;
}

export interface LoginDto {
  email: string;
  password: string;
}

export interface RefreshTokenDto {
  refreshToken: string;
}

export interface ChangePasswordDto {
  currentPassword: string;
  newPassword: string;
}

export interface CreateApiKeyDto {
  name: string;
  expiresAt?: string;
}

// ---------------------------------------------------------------------------
// Responses
// ---------------------------------------------------------------------------

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  /** Seconds until access token expiry */
  expiresIn: number;
}

export interface AuthResponse extends AuthTokens {
  user: PublicUser;
}

export interface ApiKeyCreatedResponse {
  apiKey: ApiKey;
  /** The plain-text key — shown only once */
  plainKey: string;
}
