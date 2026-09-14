import { createContext, useContext } from 'react'

import type { SystemAdmin } from '../types/adminAuth'

export type AdminAuthStatus = 'loading' | 'authenticated' | 'unauthenticated'

export interface AdminAuthContextValue {
  /** Whether Admin authentication initialization has yet to resolve. */
  status: AdminAuthStatus
  isInitializing: boolean
  isAuthenticated: boolean
  /** The authenticated System Admin, or `null` while signed out / initializing. */
  admin: SystemAdmin | null
  /** System permission codes granted to this Admin (from Admin `/me`). */
  permissions: string[]
  accessToken: string | null
  login: (email: string, password: string) => Promise<void>
  logout: () => void
  hasPermission: (code: string) => boolean
}

/**
 * System Admin authentication context — deliberately separate from the company
 * `AuthContext`. The two sessions share no state and no token storage.
 */
export const AdminAuthContext = createContext<AdminAuthContextValue | null>(null)

export function useAdminAuth(): AdminAuthContextValue {
  const context = useContext(AdminAuthContext)
  if (context === null) {
    throw new Error('useAdminAuth must be used within an AdminAuthProvider')
  }
  return context
}
