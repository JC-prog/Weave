import type { TokenPayload } from '@notebooklm/types'

const TOKEN_KEY = 'auth_token'
const REFRESH_KEY = 'refresh_token'

// ---------------------------------------------------------------------------
// Token storage
// ---------------------------------------------------------------------------

export function getToken(): string | null {
  if (typeof window === 'undefined') return null
  return localStorage.getItem(TOKEN_KEY)
}

export function setToken(token: string): void {
  if (typeof window === 'undefined') return
  localStorage.setItem(TOKEN_KEY, token)
}

export function clearToken(): void {
  if (typeof window === 'undefined') return
  localStorage.removeItem(TOKEN_KEY)
  localStorage.removeItem(REFRESH_KEY)
}

export function getRefreshToken(): string | null {
  if (typeof window === 'undefined') return null
  return localStorage.getItem(REFRESH_KEY)
}

export function setRefreshToken(token: string): void {
  if (typeof window === 'undefined') return
  localStorage.setItem(REFRESH_KEY, token)
}

// ---------------------------------------------------------------------------
// JWT decoding (without verification — verification happens on the server)
// ---------------------------------------------------------------------------

function base64UrlDecode(str: string): string {
  // Pad the string
  const padded = str.replace(/-/g, '+').replace(/_/g, '/')
  const padding = 4 - (padded.length % 4)
  const padStr = padding < 4 ? '='.repeat(padding) : ''
  return atob(padded + padStr)
}

export function decodeJwt(token: string): TokenPayload | null {
  try {
    const parts = token.split('.')
    if (parts.length !== 3) return null
    const payload = base64UrlDecode(parts[1])
    return JSON.parse(payload) as TokenPayload
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// Auth state
// ---------------------------------------------------------------------------

/**
 * Decode the stored JWT and return its payload.
 * Returns null if no token is stored or if it can't be decoded.
 */
export function getUser(): TokenPayload | null {
  const token = getToken()
  if (!token) return null
  return decodeJwt(token)
}

/**
 * Returns true if a non-expired access token exists in localStorage.
 */
export function isAuthenticated(): boolean {
  const token = getToken()
  if (!token) return false

  const payload = decodeJwt(token)
  if (!payload) return false

  // Check expiry (exp is in Unix seconds)
  const nowSeconds = Math.floor(Date.now() / 1000)
  if (payload.exp && payload.exp < nowSeconds) {
    clearToken()
    return false
  }

  return true
}

/**
 * Returns the number of seconds until the token expires.
 * Returns 0 if no token or already expired.
 */
export function tokenTtl(): number {
  const token = getToken()
  if (!token) return 0
  const payload = decodeJwt(token)
  if (!payload?.exp) return 0
  const nowSeconds = Math.floor(Date.now() / 1000)
  return Math.max(0, payload.exp - nowSeconds)
}
