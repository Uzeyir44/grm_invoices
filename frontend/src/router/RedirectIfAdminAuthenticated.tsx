import type { ReactNode } from 'react'
import { Navigate } from 'react-router-dom'

import { useAdminAuth } from '../contexts/admin-auth-context'

/**
 * Wraps the signed-out-only Admin login page (`/admin/login`): an already
 * Admin-authenticated visitor is sent to `/admin/dashboard`. While Admin
 * authentication initializes it shows a loading state, so a signed-in Admin
 * never sees a flash of the login form.
 */
export function RedirectIfAdminAuthenticated({
  children,
}: {
  children: ReactNode
}) {
  const { isInitializing, isAuthenticated } = useAdminAuth()

  if (isInitializing) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-100">
        <p className="text-sm text-slate-500" role="status">
          Loading…
        </p>
      </div>
    )
  }

  if (isAuthenticated) {
    return <Navigate to="/admin/dashboard" replace />
  }
  return <>{children}</>
}
