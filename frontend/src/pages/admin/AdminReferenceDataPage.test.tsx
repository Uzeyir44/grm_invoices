import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { AdminAuthProvider } from '../../contexts/AdminAuthContext'
import { adminMe, jsonResponse } from '../../test/adminFixtures'
import { setAdminAccessToken } from '../../utils/adminAuthStorage'
import { AdminReferenceDataPage } from './AdminReferenceDataPage'

function renderPage() {
  return render(
    <AdminAuthProvider>
      <MemoryRouter initialEntries={['/admin/reference-data']}>
        <AdminReferenceDataPage />
      </MemoryRouter>
    </AdminAuthProvider>,
  )
}

interface BackendOptions {
  currencies?: Array<Record<string, unknown>>
  documentTypes?: Array<Record<string, unknown>>
  vatRates?: Array<Record<string, unknown>>
  banks?: Array<Record<string, unknown>>
  exchangeRates?: Array<Record<string, unknown>>
  vatCreateError?: boolean
  currenciesFailOnce?: boolean
}

describe('AdminReferenceDataPage', () => {
  const fetchMock = vi.fn()
  let failingOnce = false

  beforeEach(() => {
    localStorage.clear()
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
    setAdminAccessToken('admin-token')
    failingOnce = false
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  function installBackend(options: BackendOptions = {}) {
    let currencies = options.currencies ?? []
    failingOnce = options.currenciesFailOnce ?? false

    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      const method = init?.method ?? 'GET'

      if (url.includes('/authentication/me/')) {
        return Promise.resolve(jsonResponse(200, adminMe()))
      }
      if (url.includes('/admin/reference-data/currencies/')) {
        if (method === 'POST') {
          const body = JSON.parse(String(init?.body))
          const created = { id: 99, ...body }
          currencies = [...currencies, created]
          return Promise.resolve(jsonResponse(201, created))
        }
        if (method === 'DELETE') {
          currencies = currencies.filter((c) => !url.includes(`/${c.id}/`))
          return Promise.resolve(new Response(null, { status: 204 }))
        }
        if (failingOnce) {
          failingOnce = false
          return Promise.reject(new Error('boom'))
        }
        return Promise.resolve(jsonResponse(200, currencies))
      }
      if (url.includes('/admin/reference-data/document-types/')) {
        return Promise.resolve(jsonResponse(200, options.documentTypes ?? []))
      }
      if (url.includes('/admin/reference-data/address-types/')) {
        return Promise.resolve(jsonResponse(200, []))
      }
      if (url.includes('/admin/reference-data/vat-rates/')) {
        if (method === 'POST') {
          return Promise.resolve(
            options.vatCreateError
              ? jsonResponse(400, {
                  valid_from: [
                    'A VAT rate with this name already covers an overlapping period.',
                  ],
                })
              : jsonResponse(201, { id: 1 }),
          )
        }
        return Promise.resolve(jsonResponse(200, options.vatRates ?? []))
      }
      if (url.includes('/admin/reference-data/banks/')) {
        if (method === 'POST' && url.endsWith('/deactivate/')) {
          return Promise.resolve(
            jsonResponse(200, { id: 1, name: 'Kapital', swift_code: null, is_active: false }),
          )
        }
        if (method === 'POST' && url.endsWith('/activate/')) {
          return Promise.resolve(
            jsonResponse(200, { id: 1, name: 'Kapital', swift_code: null, is_active: true }),
          )
        }
        return Promise.resolve(jsonResponse(200, options.banks ?? []))
      }
      if (url.includes('/admin/reference-data/exchange-rates/')) {
        return Promise.resolve(jsonResponse(200, options.exchangeRates ?? []))
      }
      return Promise.resolve(jsonResponse(200, []))
    })
  }

  it('renders the catalogs as tabs and lists currencies by default', async () => {
    installBackend({
      currencies: [{ id: 1, code: 'AZN', name: 'Manat', minor_unit: 2 }],
    })
    renderPage()

    expect(
      screen.getByRole('tablist', { name: /reference data catalogs/i }),
    ).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Currencies' })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    expect(await screen.findByText('AZN')).toBeInTheDocument()
    expect(screen.getByText('Manat')).toBeInTheDocument()
    // Global reference data: no company selector.
    expect(screen.queryByLabelText(/company/i)).not.toBeInTheDocument()
  })

  it('switches to the document types catalog', async () => {
    installBackend({
      documentTypes: [{ id: 1, code: 'invoice', name: 'Invoice' }],
    })
    const user = userEvent.setup()
    renderPage()

    await user.click(screen.getByRole('tab', { name: 'Document Types' }))

    expect(await screen.findByText('invoice')).toBeInTheDocument()
    expect(screen.getByText('Invoice')).toBeInTheDocument()
  })

  it('creates a currency', async () => {
    installBackend({ currencies: [] })
    const user = userEvent.setup()
    renderPage()

    await user.click(await screen.findByRole('button', { name: /new currency/i }))
    await user.type(screen.getByLabelText(/^code/i), 'USD')
    await user.type(screen.getByLabelText(/^name/i), 'US Dollar')
    await user.type(screen.getByLabelText(/minor unit/i), '2')
    await user.click(screen.getByRole('button', { name: 'Create' }))

    const post = fetchMock.mock.calls.find(
      ([url, init]) =>
        String(url).endsWith('/admin/reference-data/currencies/') &&
        (init as RequestInit | undefined)?.method === 'POST',
    ) as [string, RequestInit]
    expect(post).toBeDefined()
    expect(JSON.parse(String(post[1].body))).toEqual({
      code: 'USD',
      name: 'US Dollar',
      minor_unit: 2,
    })
    expect(await screen.findByText('USD')).toBeInTheDocument()
  })

  it('deletes a currency after confirmation', async () => {
    installBackend({
      currencies: [{ id: 1, code: 'AZN', name: 'Manat', minor_unit: 2 }],
    })
    const user = userEvent.setup()
    renderPage()
    await screen.findByText('AZN')

    await user.click(screen.getByRole('button', { name: 'Delete' }))
    await user.click(screen.getByRole('button', { name: 'Confirm' }))

    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some(
          ([url, init]) =>
            String(url).endsWith('/admin/reference-data/currencies/1/') &&
            (init as RequestInit | undefined)?.method === 'DELETE',
        ),
      ).toBe(true)
    })
  })

  it('shows an error state and retries', async () => {
    installBackend({
      currencies: [{ id: 1, code: 'AZN', name: 'Manat', minor_unit: 2 }],
      currenciesFailOnce: true,
    })
    const user = userEvent.setup()
    renderPage()

    expect(await screen.findByRole('alert')).toHaveTextContent(
      "Couldn't load currencies.",
    )

    await user.click(screen.getByRole('button', { name: /retry/i }))
    expect(await screen.findByText('AZN')).toBeInTheDocument()
  })

  it('shows the backend overlap error for a VAT rate', async () => {
    installBackend({ vatCreateError: true })
    const user = userEvent.setup()
    renderPage()

    await user.click(screen.getByRole('tab', { name: 'VAT Rates' }))
    await user.click(await screen.findByRole('button', { name: /new vat rate/i }))
    await user.type(screen.getByLabelText(/^name/i), 'Standard')
    await user.type(screen.getByLabelText(/rate percent/i), '18')
    await user.type(screen.getByLabelText(/valid from/i), '2026-01-01')
    await user.click(screen.getByRole('button', { name: 'Create' }))

    expect(
      await screen.findByText(/already covers an overlapping period/i),
    ).toBeInTheDocument()
  })

  it('deactivates a bank', async () => {
    installBackend({
      banks: [{ id: 1, name: 'Kapital', swift_code: null, is_active: true }],
    })
    const user = userEvent.setup()
    renderPage()

    await user.click(screen.getByRole('tab', { name: 'Banks' }))
    expect(await screen.findByText('Kapital')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Deactivate' }))

    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some(
          ([url, init]) =>
            String(url).endsWith('/admin/reference-data/banks/1/deactivate/') &&
            (init as RequestInit | undefined)?.method === 'POST',
        ),
      ).toBe(true)
    })
  })

  it('renders exchange rates read-only', async () => {
    installBackend({
      exchangeRates: [
        {
          id: 1,
          from_currency_id: 1,
          to_currency_id: 2,
          rate: '1.70000000',
          effective_at: '2026-09-01T10:00:00Z',
        },
      ],
    })
    const user = userEvent.setup()
    renderPage()

    await user.click(screen.getByRole('tab', { name: 'Exchange Rates' }))
    expect(await screen.findByText('1.70000000')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /new exchange rate/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument()
  })
})
