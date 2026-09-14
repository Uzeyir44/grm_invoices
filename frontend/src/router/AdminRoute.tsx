import { Navigate, Outlet } from 'react-router-dom'

import { useAdminAuth } from '../contexts/admin-auth-context'

/**
 * Guards the System Admin application area (`/admin/*`).
 *
 * * While Admin authentication is initializing → show a loading state instead
 *   of a premature redirect.
 * * No Admin session → redirect to `/admin/login`. Because `/admin/login` sits
 *   outside this guard, there is no redirect loop.
 * * Authenticated System Admin → render the requested page.
 *
 * This is UX-only route protection and is entirely independent of the company
 * `ProtectedRoute`: a company-authenticated user has no Admin session, so they
 * are redirected here. The Django backend remains authoritative.
 */
export function AdminRoute() {
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

  if (!isAuthenticated) {
    return <Navigate to="/admin/login" replace />
  }

  return <Outlet />
}
