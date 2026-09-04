import { Navigate, Outlet } from 'react-router-dom'

import { useAuth } from '../contexts/auth-context'

/**
 * Guards the application area.
 *
 * * While authentication is initializing → show a loading state instead of a
 *   premature redirect.
 * * Unauthenticated → redirect to `/login`.
 * * Authenticated → render the requested protected page.
 *
 * This is UX-only route protection; the Django backend remains authoritative
 * for authorization and tenant isolation.
 */
export function ProtectedRoute() {
  const { isInitializing, isAuthenticated } = useAuth()

  if (isInitializing) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50">
        <p className="text-sm text-slate-500" role="status">
          Loading…
        </p>
      </div>
    )
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />
  }

  return <Outlet />
}