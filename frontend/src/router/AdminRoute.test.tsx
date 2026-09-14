import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { AdminAuthProvider } from '../contexts/AdminAuthContext'
import { adminMe, jsonResponse } from '../test/adminFixtures'
import { setAdminAccessToken } from '../utils/adminAuthStorage'
import { setAccessToken } from '../utils/authStorage'
import { AdminRoute } from './AdminRoute'

function renderAt(path: string) {
  return render(
    <AdminAuthProvider>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/admin/login" element={<div>admin-login-page</div>} />
          <Route path="/admin" element={<AdminRoute />}>
            <Route path="dashboard" element={<div>admin-dashboard</div>} />
          </Route>
        </Routes>
      </MemoryRouter>
    </AdminAuthProvider>,
  )
}

describe('AdminRoute', () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    localStorage.clear()
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('redirects an unauthenticated visitor to /admin/login', async () => {
    renderAt('/admin/dashboard')
    expect(await screen.findByText('admin-login-page')).toBeInTheDocument()
    expect(screen.queryByText('admin-dashboard')).not.toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('allows an authenticated System Admin through', async () => {
    setAdminAccessToken('admin-token')
    fetchMock.mockResolvedValue(jsonResponse(200, adminMe()))

    renderAt('/admin/dashboard')

    expect(await screen.findByText('admin-dashboard')).toBeInTheDocument()
  })

  it('does not admit a company-authenticated principal', async () => {
    // A company session must never open the Admin surface.
    setAccessToken('company-token')

    renderAt('/admin/dashboard')

    expect(await screen.findByText('admin-login-page')).toBeInTheDocument()
    expect(screen.queryByText('admin-dashboard')).not.toBeInTheDocument()
  })

  it('shows a loading state while Admin auth initializes', () => {
    setAdminAccessToken('admin-token')
    fetchMock.mockReturnValue(new Promise<Response>(() => {}))

    renderAt('/admin/dashboard')

    expect(screen.getByRole('status')).toHaveTextContent('Loading…')
    expect(screen.queryByText('admin-login-page')).not.toBeInTheDocument()
  })
})
