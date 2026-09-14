import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { AdminAuthProvider } from '../../contexts/AdminAuthContext'
import {
  adminCompany,
  adminMe,
  adminRoleListItem,
  jsonResponse,
} from '../../test/adminFixtures'
import { setAdminAccessToken } from '../../utils/adminAuthStorage'
import { AdminRolesPage } from './AdminRolesPage'

function renderPage() {
  return render(
    <AdminAuthProvider>
      <MemoryRouter initialEntries={['/admin/roles']}>
        <Routes>
          <Route path="/admin/roles" element={<AdminRolesPage />} />
          <Route path="/admin/roles/new" element={<div>role-create-page</div>} />
          <Route path="/admin/roles/:roleId" element={<div>role-detail-page</div>} />
        </Routes>
      </MemoryRouter>
    </AdminAuthProvider>,
  )
}

describe('AdminRolesPage', () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    localStorage.clear()
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
    setAdminAccessToken('admin-token')
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  function stubList(roles: unknown) {
    fetchMock.mockImplementation((input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/authentication/me/')) {
        return Promise.resolve(jsonResponse(200, adminMe()))
      }
      if (url.includes('/admin/companies/')) {
        return Promise.resolve(
          jsonResponse(200, [adminCompany({ id: 5, display_name: 'Acme' })]),
        )
      }
      return Promise.resolve(jsonResponse(200, roles))
    })
  }

  it('shows a loading state', () => {
    fetchMock.mockReturnValue(new Promise<Response>(() => {}))
    renderPage()
    expect(screen.getByTestId('admin-roles-loading')).toBeInTheDocument()
  })

  it('renders tenant and system roles with scope and company', async () => {
    stubList([
      adminRoleListItem({ id: 3, name: 'Manager A', scope: 'tenant', company_name: 'Acme', permission_count: 4 }),
      adminRoleListItem({ id: 4, name: 'Global Template', scope: 'tenant', company_id: null, company_name: null }),
      adminRoleListItem({ id: 1, name: 'System Admin', scope: 'system', company_id: null, company_name: null, permission_count: 7 }),
    ])
    renderPage()

    expect(await screen.findByRole('link', { name: 'Manager A' })).toHaveAttribute(
      'href',
      '/admin/roles/3',
    )
    expect(screen.getAllByText('Acme').length).toBeGreaterThan(0)
    expect(screen.getByText('Global template')).toBeInTheDocument()
    expect(screen.getByText('Platform (protected)')).toBeInTheDocument()
    expect(screen.getByText('4')).toBeInTheDocument()
    expect(screen.getByText('7')).toBeInTheDocument()
  })

  it('filters by scope through the backend query parameter', async () => {
    stubList([adminRoleListItem()])
    const user = userEvent.setup()
    renderPage()
    await screen.findByRole('link', { name: 'Manager A' })

    await user.selectOptions(screen.getByLabelText(/filter by scope/i), 'system')

    const scopedCall = fetchMock.mock.calls.some(([url]) =>
      String(url).includes('/admin/roles/?scope=system'),
    )
    expect(scopedCall).toBe(true)
  })

  it('navigates to the create page', async () => {
    stubList([adminRoleListItem()])
    const user = userEvent.setup()
    renderPage()
    await user.click(await screen.findByRole('link', { name: /new role/i }))
    expect(await screen.findByText('role-create-page')).toBeInTheDocument()
  })

  it('shows an error state and retries', async () => {
    fetchMock.mockImplementation((input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/authentication/me/')) {
        return Promise.resolve(jsonResponse(200, adminMe()))
      }
      if (url.includes('/admin/companies/')) {
        return Promise.resolve(jsonResponse(200, []))
      }
      return Promise.reject(new Error('boom'))
    })
    const user = userEvent.setup()
    renderPage()

    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't load roles.")

    stubList([adminRoleListItem({ name: 'Manager A' })])
    await user.click(screen.getByRole('button', { name: /retry/i }))
    expect(await screen.findByRole('link', { name: 'Manager A' })).toBeInTheDocument()
  })
})
