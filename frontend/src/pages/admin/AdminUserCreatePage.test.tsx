import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { AdminAuthProvider } from '../../contexts/AdminAuthContext'
import { adminMe, adminUserDetail, jsonResponse } from '../../test/adminFixtures'
import { setAdminAccessToken } from '../../utils/adminAuthStorage'
import { AdminUserCreatePage } from './AdminUserCreatePage'

describe('AdminUserCreatePage', () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    localStorage.clear()
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  function renderPage() {
    return render(
      <AdminAuthProvider>
        <MemoryRouter initialEntries={['/admin/users/new']}>
          <Routes>
            <Route path="/admin/users/new" element={<AdminUserCreatePage />} />
            <Route path="/admin/users/:userId" element={<div>user-detail-page</div>} />
          </Routes>
        </MemoryRouter>
      </AdminAuthProvider>,
    )
  }

  it('creates a user for the selected company without rendering the password afterward', async () => {
    setAdminAccessToken('admin-token')
    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.includes('/authentication/me/')) {
        return Promise.resolve(jsonResponse(200, adminMe()))
      }
      if (url.includes('/company-choices/')) {
        return Promise.resolve(
          jsonResponse(200, [
            {
              id: 5,
              legal_name: 'Acme LLC',
              display_name: 'Acme',
              roles: [{ id: 9, name: 'Manager' }],
            },
          ]),
        )
      }
      if (url.endsWith('/admin/users/') && init?.method === 'POST') {
        const body = JSON.parse(String(init.body)) as Record<string, unknown>
        expect(body).toMatchObject({ company_id: 5, email: 'new@acme.example', role_ids: [9] })
        expect(body.password).toBe('Str0ng-pass-123!')
        return Promise.resolve(jsonResponse(201, adminUserDetail({ id: 31 })))
      }
      return Promise.resolve(jsonResponse(200, {}))
    })

    const user = userEvent.setup()
    renderPage()
    await user.selectOptions(await screen.findByLabelText(/^Company/), '5')
    await user.type(screen.getByLabelText(/^Email/), 'new@acme.example')
    await user.type(screen.getByLabelText(/^Password/), 'Str0ng-pass-123!')
    await user.selectOptions(screen.getByLabelText('Tenant role'), '9')
    await user.click(screen.getByRole('button', { name: 'Create user' }))

    expect(await screen.findByText('user-detail-page')).toBeInTheDocument()
    expect(screen.queryByText('Str0ng-pass-123!')).not.toBeInTheDocument()
  })
})
