import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { AdminAuthProvider } from '../../contexts/AdminAuthContext'
import {
  adminCompany,
  adminMe,
  adminRoleDetail,
  jsonResponse,
} from '../../test/adminFixtures'
import { setAdminAccessToken } from '../../utils/adminAuthStorage'
import { AdminRoleCreatePage } from './AdminRoleCreatePage'

function renderPage() {
  return render(
    <AdminAuthProvider>
      <MemoryRouter initialEntries={['/admin/roles/new']}>
        <Routes>
          <Route path="/admin/roles/new" element={<AdminRoleCreatePage />} />
          <Route path="/admin/roles/:roleId" element={<div>role-detail-page</div>} />
        </Routes>
      </MemoryRouter>
    </AdminAuthProvider>,
  )
}

describe('AdminRoleCreatePage', () => {
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

  function stub(additional: (url: string, init?: RequestInit) => Response | null = () => null) {
    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      const extra = additional(url, init)
      if (extra) return Promise.resolve(extra)
      if (url.includes('/authentication/me/')) {
        return Promise.resolve(jsonResponse(200, adminMe()))
      }
      if (url.includes('/admin/companies/')) {
        return Promise.resolve(
          jsonResponse(200, [
            adminCompany({ id: 5, display_name: 'Acme' }),
            adminCompany({ id: 1, display_name: 'GRM Platform', is_platform: true }),
          ]),
        )
      }
      if (url.endsWith('/admin/roles/') && init?.method === 'POST') {
        return Promise.resolve(jsonResponse(201, adminRoleDetail({ id: 9 })))
      }
      return Promise.resolve(jsonResponse(200, {}))
    })
  }

  it('offers tenant companies only (no platform company) and a name field', async () => {
    stub()
    renderPage()

    const companySelect = await screen.findByLabelText(/company/i)
    expect(companySelect).toBeInTheDocument()
    expect(screen.getByLabelText(/role name/i)).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Acme' })).toBeInTheDocument()
    expect(
      screen.queryByRole('option', { name: /grm platform/i }),
    ).not.toBeInTheDocument()
  })

  it('validates required fields before POSTing', async () => {
    stub()
    const user = userEvent.setup()
    renderPage()
    await screen.findByLabelText(/company/i)

    await user.click(screen.getByRole('button', { name: /create role/i }))

    expect(screen.getByText('A company is required.')).toBeInTheDocument()
    expect(screen.getByText('A role name is required.')).toBeInTheDocument()
    const posts = fetchMock.mock.calls.filter(
      ([, init]) => (init as RequestInit | undefined)?.method === 'POST',
    )
    expect(posts).toHaveLength(0)
  })

  it('creates the role and navigates to its detail', async () => {
    stub()
    const user = userEvent.setup()
    renderPage()
    await screen.findByLabelText(/company/i)

    await user.selectOptions(screen.getByLabelText(/company/i), '5')
    await user.type(screen.getByLabelText(/role name/i), 'Accountant')
    await user.click(screen.getByRole('button', { name: /create role/i }))

    const post = fetchMock.mock.calls.find(
      ([url, init]) =>
        String(url).endsWith('/admin/roles/') &&
        (init as RequestInit | undefined)?.method === 'POST',
    ) as [string, RequestInit]
    expect(post).toBeDefined()
    expect(JSON.parse(String(post[1].body))).toEqual({
      company_id: 5,
      name: 'Accountant',
    })
    expect(await screen.findByText('role-detail-page')).toBeInTheDocument()
  })

  it('shows backend business-rule errors', async () => {
    stub((url, init) => {
      if (url.endsWith('/admin/roles/') && init?.method === 'POST') {
        return jsonResponse(400, {
          detail: 'A role with this name already exists in this company.',
        })
      }
      return null
    })
    const user = userEvent.setup()
    renderPage()
    await screen.findByLabelText(/company/i)

    await user.selectOptions(screen.getByLabelText(/company/i), '5')
    await user.type(screen.getByLabelText(/role name/i), 'Manager A')
    await user.click(screen.getByRole('button', { name: /create role/i }))

    expect(
      await screen.findByText(/a role with this name already exists/i),
    ).toBeInTheDocument()
  })
})
