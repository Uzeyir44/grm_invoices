import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { AdminAuthProvider } from '../../contexts/AdminAuthContext'
import { adminMe, adminPermission, jsonResponse } from '../../test/adminFixtures'
import { setAdminAccessToken } from '../../utils/adminAuthStorage'
import { AdminPermissionsPage } from './AdminPermissionsPage'

function renderPage() {
  return render(
    <AdminAuthProvider>
      <MemoryRouter initialEntries={['/admin/permissions']}>
        <AdminPermissionsPage />
      </MemoryRouter>
    </AdminAuthProvider>,
  )
}

describe('AdminPermissionsPage', () => {
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

  function stubList(rows: unknown) {
    fetchMock.mockImplementation((input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/authentication/me/')) {
        return Promise.resolve(jsonResponse(200, adminMe()))
      }
      return Promise.resolve(jsonResponse(200, rows))
    })
  }

  it('shows a loading state', () => {
    fetchMock.mockReturnValue(new Promise<Response>(() => {}))
    renderPage()
    expect(screen.getByTestId('admin-permissions-loading')).toBeInTheDocument()
  })

  it('renders the catalog with scopes and no mutation controls', async () => {
    stubList([
      adminPermission({ id: 1, code: 'clients.read', description: 'View clients', scope: 'tenant' }),
      adminPermission({ id: 2, code: 'system.users.manage', description: 'Manage users', scope: 'system' }),
    ])
    renderPage()

    expect(await screen.findByText('clients.read')).toBeInTheDocument()
    expect(screen.getByText('system.users.manage')).toBeInTheDocument()
    const badges = screen.getAllByTestId('scope-badge')
    expect(badges).toHaveLength(2)
    expect(badges.map((badge) => badge.textContent)).toEqual(
      expect.arrayContaining(['Tenant', 'System']),
    )
    // Read-only: no create/delete controls.
    expect(screen.queryByRole('button', { name: /create/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /delete/i })).not.toBeInTheDocument()
  })

  it('filters by scope through the backend query parameter', async () => {
    stubList([adminPermission()])
    const user = userEvent.setup()
    renderPage()
    await screen.findByText('clients.read')

    await user.selectOptions(screen.getByLabelText(/filter by scope/i), 'system')

    const scopedCall = fetchMock.mock.calls.some(([url]) =>
      String(url).includes('/admin/permissions/?scope=system'),
    )
    expect(scopedCall).toBe(true)
  })

  it('shows the empty state', async () => {
    stubList([])
    renderPage()
    expect(await screen.findByText('No permissions found.')).toBeInTheDocument()
  })

  it('shows an error state and retries', async () => {
    fetchMock.mockImplementation((input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/authentication/me/')) {
        return Promise.resolve(jsonResponse(200, adminMe()))
      }
      return Promise.reject(new Error('boom'))
    })
    const user = userEvent.setup()
    renderPage()

    expect(await screen.findByRole('alert')).toHaveTextContent(
      "Couldn't load permissions.",
    )

    stubList([adminPermission({ code: 'clients.read' })])
    await user.click(screen.getByRole('button', { name: /retry/i }))
    expect(await screen.findByText('clients.read')).toBeInTheDocument()
  })
})
