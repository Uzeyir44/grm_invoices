import { Link, NavLink, Outlet } from 'react-router-dom'

const NAV_ITEMS = [
  { to: '/dashboard', label: 'Dashboard' },
  { to: '/clients', label: 'Clients' },
  { to: '/templates', label: 'Templates' },
  { to: '/documents', label: 'Documents' },
] as const

/**
 * Minimal application shell proving the rendering pipeline:
 * React -> Router -> Page. This is a placeholder shell, not the final
 * sidebar/header of the CRM.
 */
export function AppShell() {
  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center gap-8 px-4 py-3">
          <Link to="/dashboard" className="text-sm font-semibold tracking-wide">
            GRM CRM
          </Link>
          <nav aria-label="Main navigation" className="flex gap-5">
            {NAV_ITEMS.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  isActive
                    ? 'text-sm font-medium text-slate-900'
                    : 'text-sm text-slate-500 hover:text-slate-800'
                }
              >
                {item.label}
              </NavLink>
            ))}
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-8">
        <Outlet />
      </main>
    </div>
  )
}