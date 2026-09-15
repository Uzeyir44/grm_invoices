import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { AdminAuthProvider } from '../contexts/AdminAuthContext'
import { AuthProvider } from '../contexts/AuthContext'
import { adminMe, jsonResponse } from '../test/adminFixtures'
import { setAdminAccessToken } from '../utils/adminAuthStorage'
import { AppRouter } from './index'

function renderAt(path: string) {
  return render(
    <AuthProvider>
      <AdminAuthProvider>
        <MemoryRouter initialEntries={[path]}>
          <AppRouter />
        </MemoryRouter>
      </AdminAuthProvider>
    </AuthProvider>,
  )
}

describe('Admin routing', () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    localStorage.clear()
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  function authenticateAdmin(overrides: Parameters<typeof adminMe>[0] = {}) {
    setAdminAccessToken('admin-token')
    fetchMock.mockImplementation((input: RequestInfo | URL) => {
      const url = String(input)
      // List endpoints are real now; return empty lists for them.
      if (
        url.includes('/admin/companies/') ||
        url.includes('/admin/users/') ||
        url.includes('/admin/roles/') ||
        url.includes('/admin/permissions/') ||
        url.includes('/admin/reference-data/') ||
        url.includes('/admin/audit/')
      ) {
        return Promise.resolve(jsonResponse(200, []))
      }
      if (url.includes('/admin/backups/capability/')) {
        return Promise.resolve(
          jsonResponse(200, {
            database: { available: true, reason: 'available' },
            media: { available: true, reason: 'available' },
          }),
        )
      }
      if (url.includes('/admin/backups/')) {
        return Promise.resolve(
          jsonResponse(200, { count: 0, next: null, previous: null, results: [] }),
        )
      }
      return Promise.resolve(jsonResponse(200, adminMe(overrides)))
    })
  }

  it('renders the admin login page at /admin/login', async () => {
    renderAt('/admin/login')
    expect(
      await screen.findByRole('heading', { name: /system admin sign in/i }),
    ).toBeInTheDocument()
  })

  it('redirects an authenticated admin from /admin/login to the dashboard', async () => {
    authenticateAdmin()
    renderAt('/admin/login')
    expect(
      await screen.findByRole('heading', { name: /admin dashboard/i }),
    ).toBeInTheDocument()
  })

  it('redirects /admin to /admin/dashboard', async () => {
    authenticateAdmin()
    renderAt('/admin')
    expect(
      await screen.findByRole('heading', { name: /admin dashboard/i }),
    ).toBeInTheDocument()
  })

  it('renders each admin section', async () => {
    const cases: ReadonlyArray<[string, RegExp]> = [
      ['/admin/dashboard', /admin dashboard/i],
      ['/admin/companies', /^companies$/i],
      ['/admin/users', /^users$/i],
      ['/admin/roles', /roles & permissions/i],
      ['/admin/permissions', /permission catalog/i],
      ['/admin/reference-data', /reference data/i],
      ['/admin/audit', /audit & security/i],
      ['/admin/backups', /^backups$/i],
      ['/admin/settings', /^settings$/i],
    ]

    for (const [path, heading] of cases) {
      authenticateAdmin()
      const { unmount } = renderAt(path)
      expect(
        await screen.findByRole('heading', { name: heading }),
      ).toBeInTheDocument()
      unmount()
    }
  })

  it('renders a not-found page for an unknown admin route', async () => {
    authenticateAdmin()
    renderAt('/admin/does-not-exist')
    expect(
      await screen.findByRole('heading', { name: /not found/i }),
    ).toBeInTheDocument()
  })

  it('keeps company routes behind company authentication', async () => {
    renderAt('/dashboard')
    expect(
      await screen.findByRole('heading', { name: /^sign in$/i }),
    ).toBeInTheDocument()
  })

  it('keeps the company login independent of the admin surface', async () => {
    renderAt('/login')
    expect(
      await screen.findByRole('heading', { name: /^sign in$/i }),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('heading', { name: /system admin sign in/i }),
    ).not.toBeInTheDocument()
  })
})
