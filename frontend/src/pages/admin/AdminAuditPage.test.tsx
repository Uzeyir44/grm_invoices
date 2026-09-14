import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { AdminAuthProvider } from '../../contexts/AdminAuthContext'
import { adminAuditLog, adminMe, jsonResponse } from '../../test/adminFixtures'
import { setAdminAccessToken } from '../../utils/adminAuthStorage'
import { AdminAuditPage } from './AdminAuditPage'

function renderPage() {
  return render(
    <AdminAuthProvider>
      <MemoryRouter initialEntries={['/admin/audit']}>
        <AdminAuditPage />
      </MemoryRouter>
    </AdminAuthProvider>,
  )
}

function envelope(results: unknown[], overrides: Record<string, unknown> = {}) {
  return jsonResponse(200, {
    count: results.length,
    next: null,
    previous: null,
    results,
    ...overrides,
  })
}

describe('AdminAuditPage', () => {
  const fetchMock = vi.fn()
  let auditFailures = 0

  beforeEach(() => {
    localStorage.clear()
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
    setAdminAccessToken('admin-token')
    auditFailures = 0
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  function stub(handler: (url: string) => Response) {
    fetchMock.mockImplementation((input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/authentication/me/')) {
        return Promise.resolve(jsonResponse(200, adminMe()))
      }
      if (auditFailures > 0) {
        auditFailures -= 1
        return Promise.reject(new Error('boom'))
      }
      return Promise.resolve(handler(url))
    })
  }

  it('shows a loading state', () => {
    fetchMock.mockReturnValue(new Promise<Response>(() => {}))
    renderPage()
    expect(screen.getByTestId('admin-audit-loading')).toBeInTheDocument()
  })

  it('renders platform audit rows', async () => {
    stub(() => envelope([adminAuditLog()]))
    renderPage()

    expect(await screen.findByText('company.provision')).toBeInTheDocument()
    expect(screen.getByText(/Ada Admin/)).toBeInTheDocument()
    expect(screen.getByText('Acme (Company #5)')).toBeInTheDocument()
    expect(screen.getByText('Acme (company #5)')).toBeInTheDocument()
    expect(screen.getByTestId('admin-audit-count')).toHaveTextContent('1 event')
  })

  it('shows the empty state', async () => {
    stub(() => envelope([]))
    renderPage()
    expect(await screen.findByText('No platform audit events yet.')).toBeInTheDocument()
  })

  it('shows an error state and retries', async () => {
    auditFailures = 1
    stub(() => envelope([adminAuditLog()]))
    const user = userEvent.setup()
    renderPage()

    expect(await screen.findByRole('alert')).toHaveTextContent(
      "Couldn't load audit records.",
    )

    await user.click(screen.getByRole('button', { name: /retry/i }))
    expect(await screen.findByText('company.provision')).toBeInTheDocument()
  })

  it('filters by action through the backend query parameter', async () => {
    stub(() => envelope([adminAuditLog({ action: 'user.update' })]))
    const user = userEvent.setup()
    renderPage()
    await screen.findByText('user.update')

    await user.type(screen.getByLabelText(/filter by action/i), 'user.update')

    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some(([url]) =>
          String(url).includes('/admin/audit/?action=user.update'),
        ),
      ).toBe(true)
    })
  })

  it('filters by target company id', async () => {
    stub(() => envelope([adminAuditLog()]))
    const user = userEvent.setup()
    renderPage()
    await screen.findByText('company.provision')

    await user.type(screen.getByLabelText(/filter by target company id/i), '42')

    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some(([url]) =>
          String(url).includes('/admin/audit/?target_company_id=42'),
        ),
      ).toBe(true)
    })
  })

  it('paginates using the backend envelope', async () => {
    stub(() =>
      envelope([adminAuditLog()], {
        count: 60,
        next: 'http://test/api/admin/audit/?page=2',
        previous: null,
      }),
    )
    const user = userEvent.setup()
    renderPage()
    await screen.findByText('company.provision')

    await user.click(screen.getByRole('button', { name: /next/i }))

    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some(([url]) =>
          String(url).includes('/admin/audit/?page=2'),
        ),
      ).toBe(true)
    })
    expect(screen.getByTestId('admin-audit-page')).toHaveTextContent('Page 2')
  })

  it('expands row details read-only', async () => {
    stub(() =>
      envelope([
        adminAuditLog({
          previous_values: { status: 'trial' },
          new_values: { status: 'active' },
        }),
      ]),
    )
    const user = userEvent.setup()
    renderPage()
    await screen.findByText('company.provision')

    await user.click(screen.getByRole('button', { name: 'View' }))

    expect(screen.getByText(/Previous values/i)).toBeInTheDocument()
    expect(screen.getByText(/New values/i)).toBeInTheDocument()
  })

  it('is read-only: no mutation controls', async () => {
    stub(() => envelope([adminAuditLog()]))
    renderPage()
    await screen.findByText('company.provision')

    for (const name of [/edit/i, /delete/i, /restore/i, /create/i]) {
      expect(screen.queryByRole('button', { name })).not.toBeInTheDocument()
    }
  })
})
