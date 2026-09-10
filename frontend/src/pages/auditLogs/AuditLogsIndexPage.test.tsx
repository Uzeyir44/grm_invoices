import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AuditLogsIndexPage } from './AuditLogsIndexPage'
import { auditLogs, jsonResponse, paginatedAuditLogs } from '../../test/auditLogFixtures'

function renderAuditLogs(initialEntry = '/audit-logs') {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        <Route path="/audit-logs" element={<AuditLogsIndexPage />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('AuditLogsIndexPage', () => {
  const fetchMock = vi.fn()
  const user = userEvent.setup()

  beforeEach(() => {
    localStorage.clear()
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('shows a loading state while the list request is pending', () => {
    fetchMock.mockReturnValue(new Promise<Response>(() => {}))
    renderAuditLogs()
    expect(screen.getByTestId('audit-logs-loading')).toHaveTextContent('Loading…')
    // Announced to assistive technology as a live-region status.
    expect(screen.getByRole('status')).toHaveTextContent('Loading…')
  })

  it('requests the first page without a page query parameter', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, paginatedAuditLogs()))
    renderAuditLogs()

    await screen.findByTestId('audit-logs-count')

    const [url] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/audit-logs/')
  })

  it('renders the real audit logs with counts, actions, entities, and users', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, paginatedAuditLogs()))
    renderAuditLogs()

    await screen.findByTestId('audit-logs-count')
    expect(screen.getByTestId('audit-logs-count')).toHaveTextContent('2 audit logs')
    expect(screen.getByRole('cell', { name: 'client.created' })).toBeInTheDocument()
    expect(screen.getByRole('cell', { name: 'user.role_changed' })).toBeInTheDocument()
    expect(screen.getByRole('cell', { name: 'Acme Corp (client #3)' })).toBeInTheDocument()
    expect(screen.getByRole('cell', { name: 'user #2' })).toBeInTheDocument()
    expect(screen.getByRole('cell', { name: 'Alice Adams (User #1)' })).toBeInTheDocument()
    expect(screen.getByRole('cell', { name: '10.0.0.1' })).toBeInTheDocument()
    expect(
      screen.getByRole('cell', { name: '11111111-1111-4111-8111-111111111111' }),
    ).toBeInTheDocument()
    expect(screen.getByRole('cell', { name: '2026-09-05 10:00 UTC' })).toBeInTheDocument()
    // The table carries an accessible caption describing content and order.
    expect(
      screen.getByRole('table', { name: 'Audit logs, newest first. Timestamps are in UTC.' }),
    ).toBeInTheDocument()
    // A deleted/null user renders as an em dash, never a fabricated name.
    const nullUserRow = screen.getByRole('cell', { name: 'user.role_changed' }).closest('tr')
    const nullUserRowText = within(nullUserRow as HTMLElement)
    expect(nullUserRowText.getAllByRole('cell', { name: '—' }).length).toBeGreaterThan(0)
    expect(nullUserRowText.queryByRole('cell', { name: /User #/ })).not.toBeInTheDocument()
  })

  it('shows a singular count for a single audit log', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(200, paginatedAuditLogs([auditLogs[0]], { count: 1 })),
    )
    renderAuditLogs()

    expect(await screen.findByTestId('audit-logs-count')).toHaveTextContent('1 audit log')
  })

  it('shows an empty state when the backend returns zero audit logs', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, paginatedAuditLogs([], { count: 0 })))
    renderAuditLogs()

    expect(await screen.findByText('No audit logs found.')).toBeInTheDocument()
    expect(screen.getByTestId('audit-logs-count')).toHaveTextContent('0 audit logs')
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })

  it('shows an error state and retries the request', async () => {
    fetchMock.mockRejectedValueOnce(new Error('boom'))
    renderAuditLogs()

    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't load audit logs.")
    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument()

    fetchMock.mockResolvedValueOnce(jsonResponse(200, paginatedAuditLogs()))
    await user.click(screen.getByRole('button', { name: /retry/i }))

    expect(await screen.findByRole('cell', { name: 'client.created' })).toBeInTheDocument()
  })

  it('shows an access-denied state on 403 without exposing backend internals', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(403, { detail: 'Missing required permission: audit_logs.read' }),
    )
    renderAuditLogs()

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('You do not have permission to view audit logs.')
    expect(alert).not.toHaveTextContent('audit_logs.read')
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })

  it('shows a rate-limit message on 429 and lets the user retry', async () => {
    fetchMock.mockResolvedValue(jsonResponse(429, { detail: 'Request was throttled.' }))
    renderAuditLogs()

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Too many requests. Please wait a moment and try again.',
    )

    fetchMock.mockResolvedValueOnce(jsonResponse(200, paginatedAuditLogs()))
    await user.click(screen.getByRole('button', { name: /retry/i }))

    expect(await screen.findByRole('cell', { name: 'client.created' })).toBeInTheDocument()
  })

  it('shows a not-found state with a back-to-first-page action for an out-of-range page', async () => {
    fetchMock.mockResolvedValue(jsonResponse(404, { detail: 'Invalid page.' }))
    renderAuditLogs('/audit-logs?page=999')

    const requestedUrls = () =>
      fetchMock.mock.calls.map(([url]) => String(url).split('?')[1] ?? '')
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The requested audit log page was not found.',
    )
    expect(requestedUrls()).toEqual(['page=999'])

    fetchMock.mockResolvedValueOnce(jsonResponse(200, paginatedAuditLogs()))
    await user.click(screen.getByRole('button', { name: /back to first page/i }))

    expect(await screen.findByRole('cell', { name: 'client.created' })).toBeInTheDocument()
    expect(fetchMock.mock.calls.at(-1)?.[0]).toBe('/api/audit-logs/')
  })

  it('moves between pages with the backend page parameter and keeps the page in the URL', async () => {
    const page1 = paginatedAuditLogs([auditLogs[0]], {
      count: 3,
      next: 'http://testserver/api/audit-logs/?page=2',
      previous: null,
    })
    const page2 = paginatedAuditLogs([auditLogs[1]], {
      count: 3,
      next: 'http://testserver/api/audit-logs/?page=3',
      previous: 'http://testserver/api/audit-logs/',
    })
    fetchMock.mockImplementation((input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('page=2')) return Promise.resolve(jsonResponse(200, page2))
      return Promise.resolve(jsonResponse(200, page1))
    })
    renderAuditLogs()

    await screen.findByRole('cell', { name: 'client.created' })
    expect(screen.getByRole('button', { name: /previous/i })).toBeDisabled()
    expect(screen.getByTestId('audit-logs-page')).toHaveTextContent('Page 1')

    await user.click(screen.getByRole('button', { name: /next/i }))

    expect(await screen.findByRole('cell', { name: 'user.role_changed' })).toBeInTheDocument()
    expect(screen.queryByRole('cell', { name: 'client.created' })).not.toBeInTheDocument()
    expect(screen.getByTestId('audit-logs-page')).toHaveTextContent('Page 2')
    const requestedUrls = fetchMock.mock.calls.map(([url]) => String(url))
    expect(requestedUrls).toContain('/api/audit-logs/?page=2')
    expect(requestedUrls[0]).toBe('/api/audit-logs/')

    // No company scoping parameter is ever sent.
    for (const url of requestedUrls) {
      expect(url).not.toContain('company_id')
      expect(url).not.toContain('tenant_id')
    }
  })

  it('loads the page given in the URL on first render', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(
        200,
        paginatedAuditLogs([auditLogs[1]], {
          count: 3,
          next: null,
          previous: 'http://testserver/api/audit-logs/?page=2',
        }),
      ),
    )
    renderAuditLogs('/audit-logs?page=3')

    await screen.findByRole('cell', { name: 'user.role_changed' })
    expect(fetchMock.mock.calls[0][0]).toBe('/api/audit-logs/?page=3')
    expect(screen.getByTestId('audit-logs-page')).toHaveTextContent('Page 3')
  })

  it('shows a loading indicator while changing pages without inventing rows', async () => {
    const page1 = paginatedAuditLogs([auditLogs[0]], {
      count: 3,
      next: 'http://testserver/api/audit-logs/?page=2',
      previous: null,
    })
    let resolvePage2!: (response: Response) => void
    const page2Promise = new Promise<Response>((resolve) => {
      resolvePage2 = resolve
    })
    fetchMock.mockImplementation((input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('page=2')) return page2Promise
      return Promise.resolve(jsonResponse(200, page1))
    })
    renderAuditLogs()

    await screen.findByRole('cell', { name: 'client.created' })
    await user.click(screen.getByRole('button', { name: /next/i }))

    expect(await screen.findByTestId('audit-logs-page-loading')).toHaveTextContent('Loading…')
    // The previous page's real rows stay visible; no fabricated rows appear.
    expect(screen.getByRole('cell', { name: 'client.created' })).toBeInTheDocument()

    resolvePage2(
      jsonResponse(
        200,
        paginatedAuditLogs([auditLogs[1]], {
          count: 3,
          next: null,
          previous: 'http://testserver/api/audit-logs/',
        }),
      ),
    )
    expect(await screen.findByRole('cell', { name: 'user.role_changed' })).toBeInTheDocument()
  })

  it('hides pagination controls when the backend reports a single page', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, paginatedAuditLogs()))
    renderAuditLogs()
    await screen.findByTestId('audit-logs-count')

    expect(screen.queryByRole('button', { name: /next/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /previous/i })).not.toBeInTheDocument()
    expect(screen.queryByTestId('audit-logs-page')).not.toBeInTheDocument()
  })

  it('renders only backend-supported filter controls and no write actions', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, paginatedAuditLogs()))
    renderAuditLogs()
    await screen.findByTestId('audit-logs-count')

    expect(screen.getByRole('form', { name: /filter audit logs/i })).toBeInTheDocument()
    expect(screen.getByLabelText(/filter by action/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/filter by entity type/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/filter by entity ID/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/filter by user ID/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/filter by earliest timestamp/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/filter by latest timestamp/i)).toBeInTheDocument()
    // No free-text search (the backend supports none) and no write actions.
    expect(screen.queryByRole('searchbox')).not.toBeInTheDocument()
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /new/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /export|delete|create/i })).not.toBeInTheDocument()
  })

  it('filters by action: typing updates the URL and fires one debounced filtered request', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, paginatedAuditLogs()))
    renderAuditLogs()
    await screen.findByTestId('audit-logs-count')
    fetchMock.mockClear()

    await user.type(screen.getByLabelText(/filter by action/i), 'client.created')

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    const [url] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/audit-logs/?action=client.created')
    expect(screen.getByLabelText(/filter by action/i)).toHaveValue('client.created')
  })

  it('combines multiple supported filters in one request', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, paginatedAuditLogs()))
    renderAuditLogs()
    await screen.findByTestId('audit-logs-count')
    fetchMock.mockClear()

    await user.type(screen.getByLabelText(/filter by action/i), 'update')
    await user.type(screen.getByLabelText(/filter by entity type/i), 'client')
    await user.type(screen.getByLabelText(/filter by entity ID/i), '2')
    await user.type(screen.getByLabelText(/filter by user ID/i), '1')
    fireEvent.change(screen.getByLabelText(/filter by earliest timestamp/i), {
      target: { value: '2026-09-01T00:00' },
    })
    fireEvent.change(screen.getByLabelText(/filter by latest timestamp/i), {
      target: { value: '2026-09-06T00:00' },
    })

    await vi.waitFor(() => {
      const lastUrl = String(fetchMock.mock.calls.at(-1)?.[0] ?? '')
      expect(lastUrl).toContain('created_before')
    })
    const lastUrl = String(fetchMock.mock.calls.at(-1)?.[0])
    const params = new URL(lastUrl, 'http://testserver').searchParams
    expect(params.get('action')).toBe('update')
    expect(params.get('entity_type')).toBe('client')
    expect(params.get('entity_id')).toBe('2')
    expect(params.get('user_id')).toBe('1')
    expect(params.get('created_after')).toBe('2026-09-01T00:00')
    expect(params.get('created_before')).toBe('2026-09-06T00:00')
    expect(lastUrl).not.toContain('company_id')
  })

  it('restores filters from the URL on first render', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, paginatedAuditLogs()))
    renderAuditLogs('/audit-logs?action=update&entity_type=client&user_id=1')

    await screen.findByTestId('audit-logs-count')

    const [url] = fetchMock.mock.calls[0] as [string, RequestInit]
    const params = new URL(String(url), 'http://testserver').searchParams
    expect(params.get('action')).toBe('update')
    expect(params.get('entity_type')).toBe('client')
    expect(params.get('user_id')).toBe('1')
    expect(screen.getByLabelText(/filter by action/i)).toHaveValue('update')
    expect(screen.getByLabelText(/filter by entity type/i)).toHaveValue('client')
    expect(screen.getByLabelText(/filter by user ID/i)).toHaveValue(1)
  })

  it('resets pagination to page 1 when a filter changes', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(
        200,
        paginatedAuditLogs([auditLogs[1]], {
          count: 3,
          next: null,
          previous: 'http://testserver/api/audit-logs/?page=2',
        }),
      ),
    )
    renderAuditLogs('/audit-logs?page=3')
    await screen.findByTestId('audit-logs-page')
    fetchMock.mockClear()

    // A single synchronous change: per-keystroke typing time varies with
    // suite load and would eat the wait budget before the fixed 250 ms
    // debounce even starts. Keystroke coalescing is covered by the dedicated
    // debounce test; the page-reset assertion here is unchanged.
    fireEvent.change(screen.getByLabelText(/filter by action/i), {
      target: { value: 'update' },
    })

    await vi.waitFor(() => {
      const urls = fetchMock.mock.calls.map(([callUrl]) => String(callUrl))
      expect(urls.some((callUrl) => callUrl.includes('action=update'))).toBe(true)
    })
    const lastUrl = String(fetchMock.mock.calls.at(-1)?.[0])
    const params = new URL(lastUrl, 'http://testserver').searchParams
    expect(params.get('action')).toBe('update')
    expect(params.get('page')).toBeNull()
    expect(screen.queryByTestId('audit-logs-page')).not.toBeInTheDocument()
  })

  it('keeps active filters when moving between pages', async () => {
    const filteredPage1 = paginatedAuditLogs([auditLogs[0]], {
      count: 2,
      next: 'http://testserver/api/audit-logs/?action=update&page=2',
      previous: null,
    })
    const filteredPage2 = paginatedAuditLogs([auditLogs[1]], {
      count: 2,
      next: null,
      previous: 'http://testserver/api/audit-logs/?action=update',
    })
    fetchMock.mockImplementation((input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('action=update') && url.includes('page=2')) {
        return Promise.resolve(jsonResponse(200, filteredPage2))
      }
      if (url.includes('action=update')) {
        return Promise.resolve(jsonResponse(200, filteredPage1))
      }
      return Promise.resolve(jsonResponse(200, paginatedAuditLogs()))
    })
    renderAuditLogs()
    await screen.findByTestId('audit-logs-count')
    fetchMock.mockClear()

    // Single synchronous change (see the page-reset test): keeps this test
    // independent of keystroke timing under suite load.
    fireEvent.change(screen.getByLabelText(/filter by action/i), {
      target: { value: 'update' },
    })
    await vi.waitFor(() => {
      const urls = fetchMock.mock.calls.map(([callUrl]) => String(callUrl))
      expect(urls.some((callUrl) => callUrl.includes('action=update'))).toBe(true)
    })
    expect(await screen.findByRole('cell', { name: 'client.created' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /next/i }))

    await vi.waitFor(() => {
      const urls = fetchMock.mock.calls.map(([callUrl]) => String(callUrl))
      expect(urls.some((callUrl) => callUrl.includes('page=2'))).toBe(true)
    })
    expect(screen.getByTestId('audit-logs-page')).toHaveTextContent('Page 2')
    const lastUrl = String(fetchMock.mock.calls.at(-1)?.[0])
    const params = new URL(lastUrl, 'http://testserver').searchParams
    expect(params.get('action')).toBe('update')
    expect(params.get('page')).toBe('2')
    // The filter input still holds its value after paging.
    expect(screen.getByLabelText(/filter by action/i)).toHaveValue('update')
  })

  it('clears filters and reloads the unfiltered list', async () => {
    fetchMock.mockImplementation((input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('action=update')) {
        return Promise.resolve(jsonResponse(200, paginatedAuditLogs([auditLogs[0]], { count: 1 })))
      }
      return Promise.resolve(jsonResponse(200, paginatedAuditLogs()))
    })
    renderAuditLogs('/audit-logs?action=update')
    await screen.findByTestId('audit-logs-count')
    expect(screen.getByLabelText(/filter by action/i)).toHaveValue('update')
    fetchMock.mockClear()

    await user.click(screen.getByRole('button', { name: /clear filters/i }))

    await screen.findByRole('cell', { name: 'user.role_changed' })
    expect(fetchMock.mock.calls.at(-1)?.[0]).toBe('/api/audit-logs/')
    expect(screen.getByLabelText(/filter by action/i)).toHaveValue('')
    expect(screen.queryByRole('button', { name: /clear filters/i })).not.toBeInTheDocument()
  })

  it('shows a filter-specific empty state with a clear action', async () => {
    fetchMock.mockImplementation((input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('action=nonexistent-action')) {
        return Promise.resolve(jsonResponse(200, paginatedAuditLogs([], { count: 0 })))
      }
      return Promise.resolve(jsonResponse(200, paginatedAuditLogs()))
    })
    renderAuditLogs()
    await screen.findByTestId('audit-logs-count')
    fetchMock.mockClear()

    await user.type(screen.getByLabelText(/filter by action/i), 'nonexistent-action')

    expect(await screen.findByText('No audit logs match your filters.')).toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()

    const emptyState = screen.getByText('No audit logs match your filters.').closest('div')
    await user.click(
      within(emptyState as HTMLElement).getByRole('button', { name: /clear filters/i }),
    )

    expect(await screen.findByRole('cell', { name: 'client.created' })).toBeInTheDocument()
    expect(fetchMock.mock.calls.at(-1)?.[0]).toBe('/api/audit-logs/')
  })

  it('keeps filter state visible when a filtered request fails and retries with the same filters', async () => {
    fetchMock.mockRejectedValueOnce(new Error('boom'))
    renderAuditLogs('/audit-logs?action=update')

    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't load audit logs.")
    expect(screen.getByLabelText(/filter by action/i)).toHaveValue('update')

    fetchMock.mockResolvedValueOnce(jsonResponse(200, paginatedAuditLogs()))
    await user.click(screen.getByRole('button', { name: /retry/i }))

    expect(await screen.findByRole('cell', { name: 'client.created' })).toBeInTheDocument()
    const lastUrl = String(fetchMock.mock.calls.at(-1)?.[0])
    expect(new URL(lastUrl, 'http://testserver').searchParams.get('action')).toBe('update')
  })

  it('surfaces the backend validation error when the date range is inverted', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(400, {
        non_field_errors: ['created_after must not be later than created_before.'],
      }),
    )
    renderAuditLogs('/audit-logs?created_after=2026-09-06T00%3A00&created_before=2026-09-05T00%3A00')

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'created_after must not be later than created_before.',
    )
    // The invalid filter values stay in place so the user can correct them.
    expect(screen.getByLabelText(/filter by earliest timestamp/i)).toHaveValue('2026-09-06T00:00')
    expect(screen.getByLabelText(/filter by latest timestamp/i)).toHaveValue('2026-09-05T00:00')
  })

  it('ignores an invalid entity ID in the URL instead of sending it', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, paginatedAuditLogs()))
    renderAuditLogs('/audit-logs?entity_id=not-a-number')

    await screen.findByTestId('audit-logs-count')

    const [url] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(new URL(String(url), 'http://testserver').searchParams.get('entity_id')).toBeNull()
  })
})
