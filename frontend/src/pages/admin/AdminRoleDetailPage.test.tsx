import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { AdminAuthProvider } from '../../contexts/AdminAuthContext'
import {
  adminMe,
  adminPermission,
  adminRoleDetail,
  jsonResponse,
} from '../../test/adminFixtures'
import { setAdminAccessToken } from '../../utils/adminAuthStorage'
import { AdminRoleDetailPage } from './AdminRoleDetailPage'

function renderPage(path = '/admin/roles/3') {
  return render(
    <AdminAuthProvider>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/admin/roles" element={<div>roles-list</div>} />
          <Route path="/admin/roles/:roleId" element={<AdminRoleDetailPage />} />
          <Route path="/admin/roles/:roleId/edit" element={<div>role-edit-page</div>} />
        </Routes>
      </MemoryRouter>
    </AdminAuthProvider>,
  )
}

describe('AdminRoleDetailPage', () => {
  const fetchMock = vi.fn()
  let current = adminRoleDetail()

  beforeEach(() => {
    localStorage.clear()
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
    setAdminAccessToken('admin-token')
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  function stub(initial = adminRoleDetail()) {
    current = initial
    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      const method = init?.method ?? 'GET'
      if (url.includes('/authentication/me/')) {
        return Promise.resolve(jsonResponse(200, adminMe()))
      }
      if (method === 'POST' && url.endsWith('/permissions/')) {
        const body = JSON.parse(String(init?.body)) as { permission_id: number }
        const permission = current.available_permissions.find(
          (p) => p.id === body.permission_id,
        )
        if (permission) {
          current = adminRoleDetail({
            ...current,
            permissions: [...current.permissions, permission],
            available_permissions: current.available_permissions.filter(
              (p) => p.id !== body.permission_id,
            ),
          })
        }
        return Promise.resolve(jsonResponse(201, permission))
      }
      if (method === 'DELETE' && /\/permissions\/\d+\/$/.test(url)) {
        const permissionId = Number(/\/permissions\/(\d+)\/$/.exec(url)?.[1])
        const removed = current.permissions.find((p) => p.id === permissionId)
        current = adminRoleDetail({
          ...current,
          permissions: current.permissions.filter((p) => p.id !== permissionId),
          available_permissions: removed
            ? [...current.available_permissions, removed]
            : current.available_permissions,
        })
        return Promise.resolve(new Response(null, { status: 204 }))
      }
      return Promise.resolve(jsonResponse(200, current))
    })
  }

  it('shows a loading state', () => {
    fetchMock.mockReturnValue(new Promise<Response>(() => {}))
    renderPage()
    expect(screen.getByTestId('admin-role-detail-loading')).toBeInTheDocument()
  })

  it('renders a tenant role with permission management', async () => {
    stub(
      adminRoleDetail({
        permissions: [adminPermission({ id: 1, code: 'clients.read', description: 'View clients' })],
        available_permissions: [
          adminPermission({ id: 2, code: 'clients.update', description: 'Update clients' }),
        ],
      }),
    )
    renderPage()

    expect(
      await screen.findByRole('heading', { name: 'Manager A' }),
    ).toBeInTheDocument()
    expect(screen.getByText('clients.read')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /edit role/i })).toHaveAttribute(
      'href',
      '/admin/roles/3/edit',
    )
    expect(screen.getByLabelText(/add permission/i)).toBeInTheDocument()
  })

  it('assigns a tenant permission', async () => {
    stub(
      adminRoleDetail({
        permissions: [],
        available_permissions: [adminPermission({ id: 2, code: 'clients.update' })],
      }),
    )
    const user = userEvent.setup()
    renderPage()

    await screen.findByRole('heading', { name: 'Manager A' })
    await user.selectOptions(screen.getByLabelText(/add permission/i), '2')
    await user.click(screen.getByRole('button', { name: /assign permission/i }))

    // The assignment triggers a refetch; the assigned permission now renders a
    // Remove control (it was previously only an available option).
    expect(await screen.findByRole('button', { name: /remove/i })).toBeInTheDocument()

    const post = fetchMock.mock.calls.find(
      ([url, init]) =>
        String(url).endsWith('/permissions/') &&
        (init as RequestInit | undefined)?.method === 'POST',
    ) as [string, RequestInit]
    expect(post).toBeDefined()
    expect(JSON.parse(String(post[1].body))).toEqual({ permission_id: 2 })
  })

  it('removes an assigned permission', async () => {
    stub(
      adminRoleDetail({
        permissions: [adminPermission({ id: 1, code: 'clients.read' })],
        available_permissions: [],
      }),
    )
    const user = userEvent.setup()
    renderPage()

    await screen.findByRole('heading', { name: 'Manager A' })
    await user.click(screen.getByRole('button', { name: /remove/i }))

    expect(
      await screen.findByText('No permissions assigned.'),
    ).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /remove/i })).not.toBeInTheDocument()
  })

  it('protects system roles from mutation', async () => {
    stub(
      adminRoleDetail({
        id: 1,
        name: 'System Admin',
        scope: 'system',
        company_id: null,
        company_name: null,
        permissions: [adminPermission({ id: 9, code: 'system.users.manage', scope: 'system' })],
        available_permissions: [],
      }),
    )
    renderPage('/admin/roles/1')

    expect(
      await screen.findByText(/part of the platform administration architecture/i),
    ).toBeInTheDocument()
    expect(screen.getByText('system.users.manage')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /edit role/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /remove/i })).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/add permission/i)).not.toBeInTheDocument()
  })

  it('shows a safe not-found state for a 404', async () => {
    fetchMock.mockImplementation((input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/authentication/me/')) {
        return Promise.resolve(jsonResponse(200, adminMe()))
      }
      return Promise.resolve(jsonResponse(404, { detail: 'Not found.' }))
    })
    renderPage()
    expect(await screen.findByText('Role not found.')).toBeInTheDocument()
  })
})
