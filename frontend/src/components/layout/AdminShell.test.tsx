import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { AdminAuthProvider } from '../../contexts/AdminAuthContext'
import { adminMe, jsonResponse } from '../../test/adminFixtures'
import { getAdminAccessToken, setAdminAccessToken } from '../../utils/adminAuthStorage'
import { getAccessToken, setAccessToken } from '../../utils/authStorage'
import { AdminRoute } from '../../router/AdminRoute'
import { AdminShell } from './AdminShell'

function renderShell() {
  return render(
    <AdminAuthProvider>
      <MemoryRouter initialEntries={['/admin/dashboard']}>
        <Routes>
          <Route path="/admin/login" element={<div>admin-login-page</div>} />
          <Route path="/admin" element={<AdminRoute />}>
            <Route element={<AdminShell />}>
              <Route path="dashboard" element={<div>admin-dashboard-content</div>} />
            </Route>
          </Route>
        </Routes>
      </MemoryRouter>
    </AdminAuthProvider>,
  )
}

describe('AdminShell', () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    localStorage.clear()
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('renders the admin navigation and identity', async () => {
    setAdminAccessToken('admin-token')
    fetchMock.mockResolvedValue(jsonResponse(200, adminMe()))

    renderShell()

    expect(
      await screen.findByRole('navigation', { name: /admin navigation/i }),
    ).toBeInTheDocument()
    expect(screen.getByText('admin-dashboard-content')).toBeInTheDocument()
    expect(screen.getByText('GRM Platform')).toBeInTheDocument()
    expect(screen.getByText('Ada Admin')).toBeInTheDocument()
    expect(screen.getByText('admin@grm.example')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Companies' })).toHaveAttribute(
      'href',
      '/admin/companies',
    )
  })

  it('hides management sections the admin has no permission for', async () => {
    setAdminAccessToken('admin-token')
    fetchMock.mockResolvedValue(
      jsonResponse(
        200,
        adminMe({
          permissions: ['system.companies.manage', 'system.users.manage'],
        }),
      ),
    )

    renderShell()
    await screen.findByRole('navigation', { name: /admin navigation/i })

    expect(screen.getByRole('link', { name: 'Companies' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Users' })).toBeInTheDocument()
    // Sections requiring other permissions are not exposed in navigation.
    expect(screen.queryByRole('link', { name: /roles & permissions/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /reference data/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /audit & security/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Backups' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Settings' })).not.toBeInTheDocument()
    // Dashboard needs no management permission and stays visible.
    expect(screen.getByRole('link', { name: 'Dashboard' })).toBeInTheDocument()
  })

  it('toggles the mobile navigation overlay', async () => {
    setAdminAccessToken('admin-token')
    fetchMock.mockResolvedValue(jsonResponse(200, adminMe()))
    const user = userEvent.setup()

    renderShell()
    await screen.findByRole('navigation', { name: /admin navigation/i })
    expect(screen.getAllByRole('navigation', { name: /admin navigation/i })).toHaveLength(1)

    await user.click(screen.getByRole('button', { name: /open navigation/i }))
    expect(
      screen.getByRole('button', { name: /close navigation/i }),
    ).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /close navigation/i }))
    await waitFor(() =>
      expect(
        screen.queryByRole('button', { name: /close navigation/i }),
      ).not.toBeInTheDocument(),
    )
  })

  it('signs out of the admin session only', async () => {
    setAccessToken('company-token')
    setAdminAccessToken('admin-token')
    fetchMock.mockResolvedValue(jsonResponse(200, adminMe()))
    const user = userEvent.setup()

    renderShell()
    await screen.findByRole('navigation', { name: /admin navigation/i })

    await user.click(screen.getByRole('button', { name: /sign out/i }))

    expect(await screen.findByText('admin-login-page')).toBeInTheDocument()
    expect(getAdminAccessToken()).toBeNull()
    // Company session is untouched.
    expect(getAccessToken()).toBe('company-token')
  })
})
