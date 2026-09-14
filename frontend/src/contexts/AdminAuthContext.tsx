import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'

import { adminLogin as apiAdminLogin, getAdminMe } from '../api/adminAuth'
import { onAdminUnauthorized } from '../api/adminClient'
import type { SystemAdmin } from '../types/adminAuth'
import {
  clearAdminAuthTokens,
  getAdminAccessToken,
} from '../utils/adminAuthStorage'
import {
  AdminAuthContext,
  type AdminAuthContextValue,
  type AdminAuthStatus,
} from './admin-auth-context'

function extractPermissions(admin: SystemAdmin): string[] {
  const raw = (admin as { permissions?: unknown }).permissions
  if (!Array.isArray(raw)) {
    return []
  }
  return raw.filter((item): item is string => typeof item === 'string')
}

/**
 * System Admin authentication provider.
 *
 * Bootstraps from the Admin `/me` endpoint using the Admin access token, and
 * depends only on the Admin API client/storage. A company token cannot
 * initialize this provider: it is never read here, and the Admin client
 * attaches only Admin tokens.
 */
export function AdminAuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AdminAuthStatus>('loading')
  const [admin, setAdmin] = useState<SystemAdmin | null>(null)
  const [permissions, setPermissions] = useState<string[]>([])
  const [accessToken, setAccessTokenState] = useState<string | null>(() =>
    getAdminAccessToken(),
  )

  useEffect(() => {
    let cancelled = false

    // An unrecoverable Admin 401 (refresh failed / no refresh token) clears the
    // Admin tokens in the client and notifies this provider, which drops the
    // Admin session. Company auth state is untouched.
    const unsubscribe = onAdminUnauthorized(() => {
      if (cancelled) return
      setAdmin(null)
      setPermissions([])
      setAccessTokenState(null)
      setStatus('unauthenticated')
    })

    async function boot(): Promise<void> {
      if (!getAdminAccessToken()) {
        if (!cancelled) setStatus('unauthenticated')
        return
      }
      try {
        // The Admin client transparently refreshes the access token and retries
        // once if /me returns 401, so this only rejects when Admin auth is lost.
        const me = await getAdminMe()
        if (cancelled) return
        setAdmin(me)
        setPermissions(extractPermissions(me))
        setAccessTokenState(getAdminAccessToken())
        setStatus('authenticated')
      } catch {
        if (cancelled) return
        setStatus('unauthenticated')
      }
    }
    void boot()

    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [])

  const login = useCallback(async (email: string, password: string) => {
    // Persists Admin tokens; throws the backend ApiError on failure.
    await apiAdminLogin(email, password)
    const me = await getAdminMe()
    setAdmin(me)
    setPermissions(extractPermissions(me))
    setAccessTokenState(getAdminAccessToken())
    setStatus('authenticated')
  }, [])

  const logout = useCallback(() => {
    clearAdminAuthTokens()
    setAdmin(null)
    setPermissions([])
    setAccessTokenState(null)
    setStatus('unauthenticated')
  }, [])

  const hasPermission = useCallback(
    (code: string) => permissions.includes(code),
    [permissions],
  )

  const value = useMemo<AdminAuthContextValue>(
    () => ({
      status,
      isAuthenticated: status === 'authenticated',
      isInitializing: status === 'loading',
      admin,
      permissions,
      accessToken,
      login,
      logout,
      hasPermission,
    }),
    [status, admin, permissions, accessToken, login, logout, hasPermission],
  )

  return (
    <AdminAuthContext.Provider value={value}>
      {children}
    </AdminAuthContext.Provider>
  )
}
