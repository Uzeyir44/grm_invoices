import { Outlet } from 'react-router-dom'

/**
 * Minimal centered container for the future authentication pages. No auth UI
 * is implemented yet.
 */
export function AuthLayout() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-100 p-4">
      <div className="w-full max-w-sm">
        <Outlet />
      </div>
    </div>
  )
}