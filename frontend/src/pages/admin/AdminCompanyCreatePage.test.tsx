import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { AdminAuthProvider } from '../../contexts/AdminAuthContext'
import { adminCompany, adminMe, jsonResponse } from '../../test/adminFixtures'
import { setAdminAccessToken } from '../../utils/adminAuthStorage'
import { AdminCompanyCreatePage } from './AdminCompanyCreatePage'

const PASSWORD = 'Str0ng-pass-123!'

function renderPage() {
  return render(
    <AdminAuthProvider>
      <MemoryRouter initialEntries={['/admin/companies/new']}>
        <Routes>
          <Route path="/admin/companies/new" element={<AdminCompanyCreatePage />} />
          <Route
            path="/admin/companies/:companyId"
            element={<div>company-detail-page</div>}
          />
        </Routes>
      </MemoryRouter>
    </AdminAuthProvider>,
  )
}

describe('AdminCompanyCreatePage', () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    localStorage.clear()
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  function stubMe() {
    setAdminAccessToken('admin-token')
    fetchMock.mockImplementation((input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/authentication/me/')) {
        return Promise.resolve(jsonResponse(200, adminMe()))
      }
      return Promise.resolve(jsonResponse(201, adminCompany({ id: 9 })))
    })
  }

  async function fillRequired(
    user: ReturnType<typeof userEvent.setup>,
    overrides: { legalName?: string; displayName?: string; email?: string; password?: string } = {},
  ) {
    const {
      legalName = 'Acme LLC',
      displayName = 'Acme',
      email = 'owner@acme.example',
      password = PASSWORD,
    } = overrides
    if (legalName !== '') await user.type(screen.getByLabelText(/legal name/i), legalName)
    if (displayName !== '') await user.type(screen.getByLabelText(/display name/i), displayName)
    if (email !== '') await user.type(screen.getByLabelText(/administrator email/i), email)
    if (password !== '') await user.type(screen.getByLabelText(/initial password/i), password)
    await user.click(screen.getByRole('button', { name: /provision company/i }))
  }

  it('renders the company and administrator fields', async () => {
    stubMe()
    renderPage()
    expect(await screen.findByLabelText(/legal name/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/administrator email/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/initial password/i)).toHaveAttribute(
      'type',
      'password',
    )
  })

  it('validates required fields before calling the API', async () => {
    stubMe()
    const user = userEvent.setup()
    renderPage()
    await screen.findByLabelText(/legal name/i)

    await fillRequired(user, { legalName: '', displayName: '', email: '', password: '' })

    expect(screen.getByText('Legal name is required.')).toBeInTheDocument()
    expect(screen.getByText('Display name is required.')).toBeInTheDocument()
    expect(screen.getByText('Administrator email is required.')).toBeInTheDocument()
    expect(screen.getByText('Initial password is required.')).toBeInTheDocument()
    const posts = fetchMock.mock.calls.filter(
      ([, init]) => (init as RequestInit | undefined)?.method === 'POST',
    )
    expect(posts).toHaveLength(0)
  })

  it('submits the real provisioning body and navigates to the detail', async () => {
    stubMe()
    const user = userEvent.setup()
    renderPage()
    await screen.findByLabelText(/legal name/i)

    await fillRequired(user)

    const post = fetchMock.mock.calls.find(
      ([url, init]) =>
        String(url).includes('/admin/companies/provision/') &&
        (init as RequestInit | undefined)?.method === 'POST',
    ) as [string, RequestInit]
    expect(post).toBeDefined()
    expect(JSON.parse(String(post[1].body))).toMatchObject({
      legal_name: 'Acme LLC',
      display_name: 'Acme',
      admin_email: 'owner@acme.example',
      admin_password: PASSWORD,
    })
    expect(await screen.findByText('company-detail-page')).toBeInTheDocument()
    // The password is never persisted to browser storage.
    expect(JSON.stringify(localStorage)).not.toContain(PASSWORD)
  })

  it('shows backend field errors (duplicate VOEN)', async () => {
    setAdminAccessToken('admin-token')
    fetchMock.mockImplementation((input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/authentication/me/')) {
        return Promise.resolve(jsonResponse(200, adminMe()))
      }
      return Promise.resolve(
        jsonResponse(400, { voen: ['A company with this VOEN already exists.'] }),
      )
    })
    const user = userEvent.setup()
    renderPage()
    await screen.findByLabelText(/legal name/i)

    await fillRequired(user)

    expect(
      await screen.findByText(/a company with this voen already exists/i),
    ).toBeInTheDocument()
  })

  it('shows backend password validation errors', async () => {
    setAdminAccessToken('admin-token')
    fetchMock.mockImplementation((input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/authentication/me/')) {
        return Promise.resolve(jsonResponse(200, adminMe()))
      }
      return Promise.resolve(
        jsonResponse(400, {
          admin_password: ['This password is too short. It must contain at least 8 characters.'],
        }),
      )
    })
    const user = userEvent.setup()
    renderPage()
    await screen.findByLabelText(/legal name/i)

    await fillRequired(user)

    expect(
      await screen.findByText(/this password is too short/i),
    ).toBeInTheDocument()
  })

  it('shows a throttle message on 429', async () => {
    setAdminAccessToken('admin-token')
    fetchMock.mockImplementation((input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/authentication/me/')) {
        return Promise.resolve(jsonResponse(200, adminMe()))
      }
      return Promise.resolve(
        new Response(JSON.stringify({ detail: 'Request was throttled.' }), {
          status: 429,
          headers: { 'Content-Type': 'application/json', 'Retry-After': '7' },
        }),
      )
    })
    const user = userEvent.setup()
    renderPage()
    await screen.findByLabelText(/legal name/i)

    await fillRequired(user)

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toMatch(/too many attempts/i)
    expect(alert.textContent).toContain('7')
  })
})
