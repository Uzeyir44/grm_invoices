import { useState } from 'react'
import { Link, NavLink, Outlet } from 'react-router-dom'

import { useAuth } from '../../contexts/auth-context'

const NAV_ITEMS = [
  { to: '/dashboard', label: 'Dashboard' },
  { to: '/clients', label: 'Clients' },
  { to: '/templates', label: 'Templates' },
  { to: '/documents', label: 'Documents' },
] as const

function navLinkClasses(isActive: boolean): string {
  const base =
    'block rounded-md px-3 py-2 text-sm transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-slate-500'
  return isActive
    ? `${base} bg-slate-900 font-medium text-white`
    : `${base} text-slate-600 hover:bg-slate-100 hover:text-slate-900`
}

function Brand() {
  return (
    <Link
      to="/dashboard"
      className="px-5 py-4 text-sm font-semibold tracking-wide text-slate-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-slate-500"
    >
      GRM CRM
    </Link>
  )
}

function Navigation({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <nav aria-label="Main navigation" className="flex flex-col gap-1">
      {NAV_ITEMS.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          onClick={onNavigate}
          className={({ isActive }) => navLinkClasses(isActive)}
        >
          {item.label}
        </NavLink>
      ))}
    </nav>
  )
}

/**
 * Authenticated application shell: responsive sidebar navigation, a header
 * with the authenticated company/user and a sign-out action. The protected
 * pages render into `<Outlet />`.
 */
export function AppShell() {
  const { user, companyName, logout } = useAuth()
  const [mobileNavOpen, setMobileNavOpen] = useState(false)

  const displayName =
    [user?.first_name, user?.last_name].filter((part) => part && part.trim()).join(' ') ||
    user?.email ||
    null
  // Avoid rendering the same string twice when the name falls back to email.
  const showEmail = Boolean(user?.email) && displayName !== user?.email

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <div className="flex min-h-screen">
        {/* Desktop sidebar */}
        <aside className="hidden w-60 shrink-0 flex-col border-r border-slate-200 bg-white md:flex">
          <Brand />
          <div className="px-3 py-2">
            <Navigation />
          </div>
        </aside>

        {/* Mobile navigation overlay */}
        {mobileNavOpen && (
          <div className="fixed inset-0 z-40 md:hidden">
            <button
              type="button"
              aria-label="Close navigation"
              className="absolute inset-0 bg-slate-900/40"
              onClick={() => setMobileNavOpen(false)}
            />
            <aside className="absolute inset-y-0 left-0 flex w-64 flex-col bg-white shadow-xl">
              <Brand />
              <div className="px-3 py-2">
                <Navigation onNavigate={() => setMobileNavOpen(false)} />
              </div>
            </aside>
          </div>
        )}

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="flex items-center gap-3 border-b border-slate-200 bg-white px-4 py-3">
            <button
              type="button"
              aria-label="Open navigation"
              className="rounded-md p-2 text-slate-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-slate-500 md:hidden"
              onClick={() => setMobileNavOpen(true)}
            >
              <svg
                aria-hidden="true"
                className="h-5 w-5"
                viewBox="0 0 20 20"
                fill="currentColor"
              >
                <path
                  fillRule="evenodd"
                  d="M2 5a1 1 0 0 1 1-1h14a1 1 0 1 1 0 2H3a1 1 0 0 1-1-1Zm0 5a1 1 0 0 1 1-1h14a1 1 0 1 1 0 2H3a1 1 0 0 1-1-1Zm0 5a1 1 0 0 1 1-1h14a1 1 0 1 1 0 2H3a1 1 0 0 1-1-1Z"
                  clipRule="evenodd"
                />
              </svg>
            </button>

            <div className="ml-auto flex items-center gap-4">
              <div className="text-right">
                {companyName ? (
                  <p className="text-sm font-medium text-slate-900">{companyName}</p>
                ) : null}
                {displayName ? (
                  <p className="text-sm text-slate-600">{displayName}</p>
                ) : null}
                {showEmail ? (
                  <p className="text-xs text-slate-500">{user?.email}</p>
                ) : null}
              </div>
              <button
                type="button"
                onClick={logout}
                className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-slate-500"
              >
                Sign out
              </button>
            </div>
          </header>

          <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8">
            <Outlet />
          </main>
        </div>
      </div>
    </div>
  )
}