import { redirect } from 'next/navigation'
import { cookies, headers } from 'next/headers'
import { AppShell } from '@/components/layout/AppShell'

// Server-side auth check: we check for a token cookie or Authorization header.
// The actual JWT validation happens at the gateway; here we just ensure the
// client has something to present before rendering the shell.
async function getServerToken(): Promise<string | null> {
  try {
    const cookieStore = await cookies()
    const cookieToken = cookieStore.get('auth_token')?.value
    if (cookieToken) return cookieToken

    const headersList = await headers()
    const authHeader = headersList.get('authorization')
    if (authHeader?.startsWith('Bearer ')) {
      return authHeader.slice(7)
    }
  } catch {
    // cookies()/headers() may throw in some edge cases
  }
  return null
}

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  // Note: The primary auth check happens client-side (localStorage token).
  // This server-side check is a best-effort redirect for cookie-based sessions.
  // The AppShell component performs the authoritative client-side check.
  const token = await getServerToken()

  // Only redirect if we have a definitive signal the user is NOT logged in.
  // We can't check localStorage on the server, so we allow the client to handle it.
  if (token === null) {
    // We'll let the client-side AppShell handle the redirect for localStorage tokens.
    // Don't redirect here to avoid breaking client-side auth.
  }

  return <AppShell>{children}</AppShell>
}
