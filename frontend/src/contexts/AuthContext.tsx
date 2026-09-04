import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'

import { fetchCurrentUser, login as apiLogin } from '../api/auth'
import { onUnauthorized } from '../api/client'
import type { CurrentUser } from '../types/auth'
import { clearAuthTokens, getAccessToken } from '../utils/authStorage'
import { AuthContext, type AuthContextValue } from './auth-context'

type AuthStatus = AuthContextValue['status']

function extractPermissions(user: CurrentUser): string[] {
  const raw = (user as { permissions?: unknown }).permissions
  if (!Array.isArray(raw)) {
    return []
  }
  return raw.filter((item): item is string => typeof item === 'string')
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>('loading')
  const [user, setUser] = useState<CurrentUser | null>(null)
  const [permissions, setPermissions] = useState<string[]>([])
  const [accessToken, setAccessTokenState] = useState<string | null>(() =>
    getAccessToken(),
  )

  useEffect(() => {
    let cancelled = false

    // Any API request that hits an unrecoverable 401 (refresh failed, or no
    // refresh token) triggers this: tokens are already cleared by the client,
    // so the context drops the user and returns to the signed-out state.
    const unsubscribe = onUnauthorized(() => {
      if (cancelled) return
      setUser(null)
      setPermissions([])
      setAccessTokenState(null)
      setStatus('unauthenticated')
    })

    async function boot(): Promise<void> {
      if (!getAccessToken()) {
        if (!cancelled) setStatus('unauthenticated')
        return
      }
      try {
        // The API client transparently refreshes the access token and retries
        // once if /me returns 401, so this only rejects when auth is lost.
        const me = await fetchCurrentUser()
        if (cancelled) return
        setUser(me)
        setPermissions(extractPermissions(me))
        setAccessTokenState(getAccessToken())
        setStatus('authenticated')
      } catch {
        if (cancelled) return
        // Auth could not be resolved (a failed refresh already cleared tokens
        // and notified subscribers). Treat the app as signed out.
        setStatus('unauthenticated')
      }
    }
    void boot()

    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [])

  const login = useCallback(
    async (companyId: number, email: string, password: string) => {
      // Persists tokens; throws the backend ApiError on failure.
      await apiLogin(companyId, email, password)
      const me = await fetchCurrentUser()
      setUser(me)
      setPermissions(extractPermissions(me))
      setAccessTokenState(getAccessToken())
      setStatus('authenticated')
    },
    [],
  )

  const logout = useCallback(() => {
    clearAuthTokens()
    setUser(null)
    setPermissions([])
    setAccessTokenState(null)
    setStatus('unauthenticated')
  }, [])

  const hasPermission = useCallback(
    (code: string) => permissions.includes(code),
    [permissions],
  )

  const value = useMemo<AuthContextValue>(
    () => ({
      status,
      isAuthenticated: status === 'authenticated',
      isInitializing: status === 'loading',
      user,
      companyId: user?.company_id ?? null,
      companyName: user?.company_name ?? null,
      permissions,
      accessToken,
      login,
      logout,
      hasPermission,
    }),
    [status, user, permissions, accessToken, login, logout, hasPermission],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}