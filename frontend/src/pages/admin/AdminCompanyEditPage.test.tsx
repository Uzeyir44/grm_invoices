import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { AdminAuthProvider } from '../../contexts/AdminAuthContext'
import { adminCompany, adminMe, jsonResponse } from '../../test/adminFixtures'
import { setAdminAccessToken } from '../../utils/adminAuthStorage'
import { AdminCompanyEditPage } from './AdminCompanyEditPage'

function renderPage() {
  return render(
    <AdminAuthProvider>
      <MemoryRouter initialEntries={['/admin/companies/5/edit']}>
        <Routes>
          <Route
            path="/admin/companies/:companyId/edit"
            element={<AdminCompanyEditPage />}
          />
          <Route
            path="/admin/companies/:companyId"
            element={<div>company-detail-page</div>}
          />
        </Routes>
      </MemoryRouter>
    </AdminAuthProvider>,
  )
}

describe('AdminCompanyEditPage', () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    localStorage.clear()
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  function stub(company: unknown) {
    setAdminAccessToken('admin-token')
    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      const method = init?.method ?? 'GET'
      if (url.includes('/authentication/me/')) {
        return Promise.resolve(jsonResponse(200, adminMe()))
      }
      if (method === 'PATCH') {
        const body = JSON.parse(String((init as RequestInit).body))
        return Promise.resolve(jsonResponse(200, { ...adminCompany(), ...body }))
      }
      return Promise.resolve(jsonResponse(200, company))
    })
  }

  it('pre-fills the editable fields from the API', async () => {
    stub(adminCompany({ legal_name: 'Acme LLC', display_name: 'Acme' }))
    renderPage()

    expect(await screen.findByLabelText(/legal name/i)).toHaveValue('Acme LLC')
    expect(screen.getByLabelText(/display name/i)).toHaveValue('Acme')
    // Status/platform are not editable here.
    expect(screen.queryByLabelText(/status/i)).not.toBeInTheDocument()
  })

  it('validates required fields before PATCHing', async () => {
    stub(adminCompany())
    const user = userEvent.setup()
    renderPage()
    await screen.findByLabelText(/legal name/i)

    await user.clear(screen.getByLabelText(/legal name/i))
    await user.clear(screen.getByLabelText(/display name/i))
    await user.click(screen.getByRole('button', { name: /save changes/i }))

    expect(screen.getByText('Legal name is required.')).toBeInTheDocument()
    expect(screen.getByText('Display name is required.')).toBeInTheDocument()
    const patches = fetchMock.mock.calls.filter(
      ([, init]) => (init as RequestInit | undefined)?.method === 'PATCH',
    )
    expect(patches).toHaveLength(0)
  })

  it('saves through PATCH and returns to the detail page', async () => {
    stub(adminCompany())
    const user = userEvent.setup()
    renderPage()
    const legalName = await screen.findByLabelText(/legal name/i)

    await user.clear(legalName)
    await user.type(legalName, "Acme LLC Renamed")
    await user.click(screen.getByRole('button', { name: /save changes/i }))

    const patch = fetchMock.mock.calls.find(
      ([url, init]) =>
        String(url).endsWith('/admin/companies/5/') &&
        (init as RequestInit | undefined)?.method === 'PATCH',
    ) as [string, RequestInit]
    expect(patch).toBeDefined()
    expect(JSON.parse(String(patch[1].body))).toMatchObject({
      legal_name: "Acme LLC Renamed",
    })
    expect(await screen.findByText('company-detail-page')).toBeInTheDocument()
  })

  it('renders backend field errors', async () => {
    setAdminAccessToken('admin-token')
    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.includes('/authentication/me/')) {
        return Promise.resolve(jsonResponse(200, adminMe()))
      }
      if ((init?.method ?? 'GET') === 'PATCH') {
        return Promise.resolve(
          jsonResponse(400, { voen: ['A company with this VOEN already exists.'] }),
        )
      }
      return Promise.resolve(jsonResponse(200, adminCompany()))
    })
    const user = userEvent.setup()
    renderPage()
    await screen.findByLabelText(/legal name/i)

    await user.click(screen.getByRole('button', { name: /save changes/i }))

    expect(
      await screen.findByText(/a company with this voen already exists/i),
    ).toBeInTheDocument()
  })

  it('does not allow editing the platform company', async () => {
    stub(adminCompany({ is_platform: true, display_name: 'GRM Platform' }))
    renderPage()
    expect(
      await screen.findByText(/platform company cannot be edited/i),
    ).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /save changes/i })).not.toBeInTheDocument()
  })
})
