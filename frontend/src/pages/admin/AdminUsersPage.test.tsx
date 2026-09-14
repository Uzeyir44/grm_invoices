import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { AdminAuthProvider } from '../../contexts/AdminAuthContext'
import { adminMe, adminUser, jsonResponse } from '../../test/adminFixtures'
import { setAdminAccessToken } from '../../utils/adminAuthStorage'
import { AdminUsersPage } from './AdminUsersPage'

function renderPage() {
  return render(
    <AdminAuthProvider>
      <MemoryRouter initialEntries={['/admin/users']}>
        <Routes>
          <Route path="/admin/users" element={<AdminUsersPage />} />
          <Route path="/admin/users/:userId" element={<div>user-detail-page</div>} />
        </Routes>
      </MemoryRouter>
    </AdminAuthProvider>,
  )
}

function stubAdmin(users: unknown) {
  return (input: RequestInfo | URL) => {
    const url = String(input)
    if (url.includes('/authentication/me/')) {
      return Promise.resolve(jsonResponse(200, adminMe()))
    }
    if (url.includes('/admin/users/')) {
      return Promise.resolve(jsonResponse(200, users))
    }
    return Promise.resolve(jsonResponse(200, {}))
  }
}

describe('AdminUsersPage', () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    localStorage.clear()
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('shows a loading state', () => {
    setAdminAccessToken('admin-token')
    fetchMock.mockReturnValue(new Promise<Response>(() => {}))
    renderPage()
    expect(screen.getByTestId('admin-users-loading')).toBeInTheDocument()
  })

  it('renders the real user list', async () => {
    setAdminAccessToken('admin-token')
    fetchMock.mockImplementation(
      stubAdmin([
        adminUser({
          id: 21,
          first_name: 'Alice',
          last_name: 'Anderson',
          email: 'alice@acme.example',
          company_name: 'Acme',
          roles: [{ id: 1, name: 'Manager A' }],
        }),
        adminUser({
          id: 22,
          first_name: 'Bob',
          last_name: 'Brown',
          email: 'bob@beta.example',
          company_name: 'Beta',
          is_active: false,
        }),
      ]),
    )

    renderPage()

    expect(
      await screen.findByRole('link', { name: 'Alice Anderson' }),
    ).toHaveAttribute('href', '/admin/users/21')
    expect(screen.getByText('alice@acme.example')).toBeInTheDocument()
    expect(screen.getByText('Acme')).toBeInTheDocument()
    expect(screen.getByText('Manager A')).toBeInTheDocument()
    expect(screen.getAllByTestId('user-status')).toHaveLength(2)
    expect(screen.getByText('Inactive')).toBeInTheDocument()
  })

  it('shows the empty state', async () => {
    setAdminAccessToken('admin-token')
    fetchMock.mockImplementation(stubAdmin([]))
    renderPage()
    expect(await screen.findByText('No users found.')).toBeInTheDocument()
  })

  it('shows an error state and retries', async () => {
    setAdminAccessToken('admin-token')
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
      "Couldn't load users.",
    )

    fetchMock.mockImplementation(stubAdmin([adminUser({ first_name: 'Alice' })]))
    await user.click(screen.getByRole('button', { name: /retry/i }))
    expect(await screen.findByRole('link', { name: 'Alice Anderson' })).toBeInTheDocument()
  })
})
