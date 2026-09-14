import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { AdminAuthProvider } from '../../contexts/AdminAuthContext'
import { adminMe, adminUserDetail, jsonResponse } from '../../test/adminFixtures'
import { setAdminAccessToken } from '../../utils/adminAuthStorage'
import { AdminUserEditPage } from './AdminUserEditPage'

function renderPage() {
  return render(
    <AdminAuthProvider>
      <MemoryRouter initialEntries={['/admin/users/21/edit']}>
        <Routes>
          <Route path="/admin/users/:userId/edit" element={<AdminUserEditPage />} />
          <Route path="/admin/users/:userId" element={<div>user-detail-page</div>} />
        </Routes>
      </MemoryRouter>
    </AdminAuthProvider>,
  )
}

describe('AdminUserEditPage', () => {
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

  function stub() {
    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      const method = init?.method ?? 'GET'
      if (url.includes('/authentication/me/')) {
        return Promise.resolve(jsonResponse(200, adminMe()))
      }
      if (method === 'PATCH') {
        const body = JSON.parse(String((init as RequestInit).body))
        return Promise.resolve(jsonResponse(200, adminUserDetail({ ...body })))
      }
      return Promise.resolve(jsonResponse(200, adminUserDetail()))
    })
  }

  it('pre-fills the editable fields and shows the company as read-only', async () => {
    stub()
    renderPage()

    expect(await screen.findByLabelText(/first name/i)).toHaveValue('Alice')
    expect(screen.getByLabelText(/last name/i)).toHaveValue('Anderson')
    expect(screen.getByLabelText(/email/i)).toHaveValue('alice@acme.example')
    expect(screen.getByText(/Company: Acme/i)).toBeInTheDocument()
    // Company is not an editable control.
    expect(screen.queryByLabelText(/^company$/i)).not.toBeInTheDocument()
  })

  it('validates required fields before PATCHing', async () => {
    stub()
    const user = userEvent.setup()
    renderPage()
    await screen.findByLabelText(/first name/i)

    await user.clear(screen.getByLabelText(/first name/i))
    await user.clear(screen.getByLabelText(/last name/i))
    await user.clear(screen.getByLabelText(/email/i))
    await user.click(screen.getByRole('button', { name: /save changes/i }))

    expect(screen.getByText('First name is required.')).toBeInTheDocument()
    expect(screen.getByText('Last name is required.')).toBeInTheDocument()
    expect(screen.getByText('Email is required.')).toBeInTheDocument()
    const patches = fetchMock.mock.calls.filter(
      ([, init]) => (init as RequestInit | undefined)?.method === 'PATCH',
    )
    expect(patches).toHaveLength(0)
  })

  it('saves through PATCH and returns to the detail page', async () => {
    stub()
    const user = userEvent.setup()
    renderPage()
    const firstName = await screen.findByLabelText(/first name/i)

    await user.clear(firstName)
    await user.type(firstName, 'Alicia')
    await user.click(screen.getByRole('button', { name: /save changes/i }))

    const patch = fetchMock.mock.calls.find(
      ([url, init]) =>
        String(url).endsWith('/admin/users/21/') &&
        (init as RequestInit | undefined)?.method === 'PATCH',
    ) as [string, RequestInit]
    expect(patch).toBeDefined()
    expect(JSON.parse(String(patch[1].body))).toMatchObject({ first_name: 'Alicia' })
    expect(await screen.findByText('user-detail-page')).toBeInTheDocument()
  })

  it('renders backend validation errors', async () => {
    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.includes('/authentication/me/')) {
        return Promise.resolve(jsonResponse(200, adminMe()))
      }
      if ((init?.method ?? 'GET') === 'PATCH') {
        return Promise.resolve(
          jsonResponse(400, {
            email: ['A user with this email already exists in this company.'],
          }),
        )
      }
      return Promise.resolve(jsonResponse(200, adminUserDetail()))
    })
    const user = userEvent.setup()
    renderPage()
    await screen.findByLabelText(/first name/i)

    await user.click(screen.getByRole('button', { name: /save changes/i }))

    expect(
      await screen.findByText(/already exists in this company/i),
    ).toBeInTheDocument()
  })
})
