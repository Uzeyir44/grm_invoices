import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { AdminAuthProvider } from '../../contexts/AdminAuthContext'
import { adminMe, adminUserDetail, jsonResponse } from '../../test/adminFixtures'
import { setAdminAccessToken } from '../../utils/adminAuthStorage'
import { AdminUserDetailPage } from './AdminUserDetailPage'

function renderPage(path = '/admin/users/21') {
  return render(
    <AdminAuthProvider>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/admin/users" element={<div>users-list</div>} />
          <Route path="/admin/users/:userId" element={<AdminUserDetailPage />} />
          <Route path="/admin/users/:userId/edit" element={<div>user-edit-page</div>} />
        </Routes>
      </MemoryRouter>
    </AdminAuthProvider>,
  )
}

describe('AdminUserDetailPage', () => {
  const fetchMock = vi.fn()
  let current = adminUserDetail()

  beforeEach(() => {
    localStorage.clear()
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
    setAdminAccessToken('admin-token')
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  function stub(initial = adminUserDetail()) {
    current = initial
    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      const method = init?.method ?? 'GET'
      if (url.includes('/authentication/me/')) {
        return Promise.resolve(jsonResponse(200, adminMe()))
      }
      if (method === 'POST' && url.endsWith('/deactivate/')) {
        current = adminUserDetail({ ...current, is_active: false })
        return Promise.resolve(jsonResponse(200, current))
      }
      if (method === 'POST' && url.endsWith('/activate/')) {
        current = adminUserDetail({ ...current, is_active: true })
        return Promise.resolve(jsonResponse(200, current))
      }
      if (method === 'POST' && url.endsWith('/roles/')) {
        const body = JSON.parse(String(init?.body)) as { role_id: number }
        const role = current.company_roles.find((r) => r.id === body.role_id)
        if (role) {
          current = adminUserDetail({ ...current, roles: [...current.roles, role] })
        }
        return Promise.resolve(jsonResponse(201, { ...role, scope: 'tenant' }))
      }
      if (method === 'DELETE' && /\/roles\/\d+\/$/.test(url)) {
        const roleId = Number(/\/roles\/(\d+)\/$/.exec(url)?.[1])
        current = adminUserDetail({
          ...current,
          roles: current.roles.filter((r) => r.id !== roleId),
        })
        return Promise.resolve(new Response(null, { status: 204 }))
      }
      return Promise.resolve(jsonResponse(200, current))
    })
  }

  it('shows a loading state', () => {
    fetchMock.mockReturnValue(new Promise<Response>(() => {}))
    renderPage()
    expect(screen.getByTestId('admin-user-detail-loading')).toBeInTheDocument()
  })

  it('renders the user detail from the API', async () => {
    stub(adminUserDetail({ company_roles: [{ id: 1, name: 'Manager A' }] }))
    renderPage()

    expect(
      await screen.findByRole('heading', { name: 'Alice Anderson' }),
    ).toBeInTheDocument()
    expect(screen.getByText('alice@acme.example')).toBeInTheDocument()
    expect(screen.getAllByText('Acme').length).toBeGreaterThan(0)
    expect(screen.getByTestId('user-status')).toHaveTextContent('Active')
    expect(screen.getByText('No roles assigned.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /edit metadata/i })).toHaveAttribute(
      'href',
      '/admin/users/21/edit',
    )
  })

  it('shows a safe not-found state for a 404', async () => {
    stub()
    fetchMock.mockImplementation((input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/authentication/me/')) {
        return Promise.resolve(jsonResponse(200, adminMe()))
      }
      return Promise.resolve(jsonResponse(404, { detail: 'Not found.' }))
    })
    renderPage()
    expect(await screen.findByText('User not found.')).toBeInTheDocument()
  })

  it('deactivates a user after confirmation', async () => {
    stub()
    const user = userEvent.setup()
    renderPage()

    await screen.findByRole('heading', { name: 'Alice Anderson' })
    await user.click(screen.getByRole('button', { name: 'Deactivate' }))
    expect(screen.getByText('Deactivate this user?')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /yes, deactivate/i }))
    expect(await screen.findByTestId('user-status')).toHaveTextContent('Inactive')
  })

  it('activates an inactive user', async () => {
    stub(adminUserDetail({ is_active: false }))
    const user = userEvent.setup()
    renderPage()

    await screen.findByRole('heading', { name: 'Alice Anderson' })
    await user.click(screen.getByRole('button', { name: 'Activate' }))
    expect(await screen.findByTestId('user-status')).toHaveTextContent('Active')
  })

  it('assigns a tenant role', async () => {
    stub(adminUserDetail({ company_roles: [{ id: 1, name: 'Manager A' }] }))
    const user = userEvent.setup()
    renderPage()

    await screen.findByRole('heading', { name: 'Alice Anderson' })
    await user.selectOptions(screen.getByLabelText(/add role/i), '1')
    await user.click(screen.getByRole('button', { name: /assign role/i }))

    await waitFor(() =>
      expect(screen.queryByText('No roles assigned.')).not.toBeInTheDocument(),
    )
    expect(screen.getByText('Manager A')).toBeInTheDocument()
  })

  it('removes a tenant role', async () => {
    stub(adminUserDetail({ roles: [{ id: 1, name: 'Manager A' }] }))
    const user = userEvent.setup()
    renderPage()

    await screen.findByRole('heading', { name: 'Alice Anderson' })
    await user.click(screen.getByRole('button', { name: /remove/i }))

    expect(await screen.findByText('No roles assigned.')).toBeInTheDocument()
  })
})
