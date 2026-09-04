import { createContext, useContext } from 'react'

import type { CurrentUser } from '../types/auth'

export type AuthStatus = 'loading' | 'authenticated' | 'unauthenticated'

export interface AuthContextValue {
  /** Whether authentication initialization has yet to resolve. */
  status: AuthStatus
  isInitializing: boolean
  isAuthenticated: boolean
  /** The authenticated user, or `null` while signed out / initializing. */
  user: CurrentUser | null
  companyId: number | null
  companyName: string | null
  /**
   * Permissions visible to the UI. The backend `/me` response currently does
   * NOT include a permissions field, so this is empty and `hasPermission`
   * returns false — i.e. the frontend grants nothing. Populated (without
   * re-authorizing anything) if the backend later returns permissions.
   */
  permissions: string[]
  accessToken: string | null
  login: (companyId: number, email: string, password: string) => Promise<void>
  logout: () => void
  hasPermission: (code: string) => boolean
}

export const AuthContext = createContext<AuthContextValue | null>(null)

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext)
  if (context === null) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return context
}