import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { AdminAuthProvider } from '../../contexts/AdminAuthContext'
import { adminCompany, adminMe, jsonResponse } from '../../test/adminFixtures'
import { setAdminAccessToken } from '../../utils/adminAuthStorage'
import { AdminCompaniesPage } from './AdminCompaniesPage'

function renderPage() {
  return render(
    <AdminAuthProvider>
      <MemoryRouter initialEntries={['/admin/companies']}>
        <Routes>
          <Route path="/admin/companies" element={<AdminCompaniesPage />} />
          <Route path="/admin/companies/new" element={<div>create-company-page</div>} />
          <Route
            path="/admin/companies/:companyId"
            element={<div>company-detail-page</div>}
          />
        </Routes>
      </MemoryRouter>
    </AdminAuthProvider>,
  )
}

function stubAdmin(companies: unknown, meOverrides: Parameters<typeof adminMe>[0] = {}) {
  return (input: RequestInfo | URL) => {
    const url = String(input)
    if (url.includes('/authentication/me/')) {
      return Promise.resolve(jsonResponse(200, adminMe(meOverrides)))
    }
    if (url.includes('/admin/companies/')) {
      return Promise.resolve(jsonResponse(200, companies))
    }
    return Promise.resolve(jsonResponse(200, {}))
  }
}

describe('AdminCompaniesPage', () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    localStorage.clear()
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('shows a loading state while the list loads', () => {
    setAdminAccessToken('admin-token')
    fetchMock.mockReturnValue(new Promise<Response>(() => {}))
    renderPage()
    expect(screen.getByTestId('admin-companies-loading')).toBeInTheDocument()
  })

  it('renders the real company list', async () => {
    setAdminAccessToken('admin-token')
    fetchMock.mockImplementation(
      stubAdmin([
        adminCompany({ id: 5, display_name: 'Acme', voen: '1234567890' }),
        adminCompany({
          id: 6,
          display_name: 'Beta',
          legal_name: 'Beta LLC',
          voen: null,
          status: 'suspended',
          is_platform: true,
        }),
      ]),
    )

    renderPage()

    expect(await screen.findByRole('link', { name: 'Acme' })).toHaveAttribute(
      'href',
      '/admin/companies/5',
    )
    expect(screen.getByText('1234567890')).toBeInTheDocument()
    expect(screen.getByText('Beta LLC')).toBeInTheDocument()
    expect(screen.getAllByTestId('company-status')).toHaveLength(2)
    expect(screen.getByText('Platform')).toBeInTheDocument()
    expect(screen.getByText('Tenant')).toBeInTheDocument()
  })

  it('shows the empty state when there are no companies', async () => {
    setAdminAccessToken('admin-token')
    fetchMock.mockImplementation(stubAdmin([]))
    renderPage()
    expect(await screen.findByText('No companies yet.')).toBeInTheDocument()
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
      "Couldn't load companies.",
    )

    fetchMock.mockImplementation(stubAdmin([adminCompany({ display_name: 'Acme' })]))
    await user.click(screen.getByRole('button', { name: /retry/i }))
    expect(await screen.findByRole('link', { name: 'Acme' })).toBeInTheDocument()
  })

  it('navigates to the provisioning page from the New company action', async () => {
    setAdminAccessToken('admin-token')
    fetchMock.mockImplementation(stubAdmin([adminCompany({ id: 5, display_name: 'Acme' })]))
    const user = userEvent.setup()
    renderPage()

    await user.click(await screen.findByRole('link', { name: /new company/i }))
    expect(await screen.findByText('create-company-page')).toBeInTheDocument()
  })

  it('hides the provisioning action without the manage permission', async () => {
    setAdminAccessToken('admin-token')
    fetchMock.mockImplementation(
      stubAdmin([adminCompany()], { permissions: [] }),
    )
    renderPage()

    await screen.findByRole('link', { name: 'Acme' })
    expect(screen.queryByRole('link', { name: /new company/i })).not.toBeInTheDocument()
  })
})
