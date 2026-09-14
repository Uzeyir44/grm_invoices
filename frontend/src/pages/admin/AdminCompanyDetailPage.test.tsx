import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { AdminAuthProvider } from '../../contexts/AdminAuthContext'
import { adminCompany, adminMe, jsonResponse } from '../../test/adminFixtures'
import { setAdminAccessToken } from '../../utils/adminAuthStorage'
import { AdminCompanyDetailPage } from './AdminCompanyDetailPage'

function renderPage(path = '/admin/companies/5') {
  return render(
    <AdminAuthProvider>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/admin/companies" element={<div>companies-list</div>} />
          <Route
            path="/admin/companies/:companyId"
            element={<AdminCompanyDetailPage />}
          />
          <Route
            path="/admin/companies/:companyId/edit"
            element={<div>edit-page</div>}
          />
        </Routes>
      </MemoryRouter>
    </AdminAuthProvider>,
  )
}

describe('AdminCompanyDetailPage', () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    localStorage.clear()
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  function stub(company: unknown, status = 200) {
    setAdminAccessToken('admin-token')
    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      const method = init?.method ?? 'GET'
      if (url.includes('/authentication/me/')) {
        return Promise.resolve(jsonResponse(200, adminMe()))
      }
      if (url.endsWith('/deactivate/')) {
        return Promise.resolve(jsonResponse(200, adminCompany({ status: 'suspended' })))
      }
      if (url.endsWith('/activate/')) {
        return Promise.resolve(jsonResponse(200, adminCompany({ status: 'active' })))
      }
      if (method === 'GET') {
        return Promise.resolve(jsonResponse(status, company))
      }
      return Promise.resolve(jsonResponse(status, company))
    })
  }

  it('shows a loading state', () => {
    setAdminAccessToken('admin-token')
    fetchMock.mockReturnValue(new Promise<Response>(() => {}))
    renderPage()
    expect(screen.getByTestId('admin-company-detail-loading')).toBeInTheDocument()
  })

  it('renders the company detail from the API', async () => {
    stub(adminCompany({ id: 5, legal_name: 'Acme LLC', voen: '1234567890' }))
    renderPage()

    expect(
      await screen.findByRole('heading', { name: 'Acme' }),
    ).toBeInTheDocument()
    expect(screen.getByText('Acme LLC')).toBeInTheDocument()
    expect(screen.getByText('1234567890')).toBeInTheDocument()
    expect(screen.getByTestId('company-status')).toHaveTextContent('Active')
    expect(screen.getByRole('link', { name: /edit metadata/i })).toHaveAttribute(
      'href',
      '/admin/companies/5/edit',
    )
  })

  it('shows a safe not-found state for a 404', async () => {
    stub({ detail: 'Not found.' }, 404)
    renderPage()
    expect(await screen.findByText('Company not found.')).toBeInTheDocument()
  })

  it('deactivates a company after confirmation', async () => {
    stub(adminCompany({ id: 5, status: 'active' }))
    const user = userEvent.setup()
    renderPage()

    await screen.findByRole('heading', { name: 'Acme' })
    await user.click(screen.getByRole('button', { name: 'Deactivate' }))
    expect(screen.getByText('Suspend this company?')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /yes, deactivate/i }))

    expect(await screen.findByTestId('company-status')).toHaveTextContent(
      'Suspended',
    )
    const called = fetchMock.mock.calls.some(([url, init]) =>
      String(url).endsWith('/admin/companies/5/deactivate/') &&
      (init as RequestInit | undefined)?.method === 'POST',
    )
    expect(called).toBe(true)
  })

  it('activates a suspended company', async () => {
    stub(adminCompany({ id: 5, status: 'suspended' }))
    const user = userEvent.setup()
    renderPage()

    await screen.findByRole('heading', { name: 'Acme' })
    await user.click(screen.getByRole('button', { name: 'Activate' }))

    expect(await screen.findByTestId('company-status')).toHaveTextContent('Active')
  })

  it('protects the platform company from management actions', async () => {
    stub(adminCompany({ id: 1, display_name: 'GRM Platform', is_platform: true }))
    renderPage('/admin/companies/1')

    expect(
      await screen.findByText(/platform company is reserved/i),
    ).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /edit metadata/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Deactivate' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Activate' })).not.toBeInTheDocument()
  })
})
