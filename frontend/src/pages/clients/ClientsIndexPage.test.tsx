import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ClientsIndexPage } from './ClientsIndexPage'
import { clientSummaries, jsonResponse } from '../../test/clientFixtures'

function renderClients() {
  return render(
    <MemoryRouter initialEntries={['/clients']}>
      <Routes>
        <Route path="/clients" element={<ClientsIndexPage />} />
        <Route path="/clients/new" element={<div>create-page</div>} />
        <Route path="/clients/:clientId" element={<div>detail-page</div>} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('ClientsIndexPage', () => {
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
    renderClients()
    expect(screen.getByTestId('clients-loading')).toHaveTextContent('Loading…')
  })

  it('renders the real client list with counts and detail links', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, clientSummaries))
    renderClients()

    await screen.findByTestId('clients-count')
    expect(screen.getByTestId('clients-count')).toHaveTextContent('2 clients')
    const acme = screen.getByRole('link', { name: /Acme Ltd/ })
    expect(acme).toHaveAttribute('href', '/clients/1')
    expect(screen.getByRole('link', { name: /Jane Doe/ })).toHaveAttribute('href', '/clients/2')
    expect(screen.getAllByRole('cell', { name: 'legal_entity' })).toHaveLength(1)
    expect(screen.getByRole('cell', { name: 'inactive' })).toBeInTheDocument()
  })

  it('shows an empty state with a create action when there are no clients', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, []))
    renderClients()

    expect(await screen.findByText('No clients yet.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /create your first client/i })).toHaveAttribute(
      'href',
      '/clients/new',
    )
  })

  it('shows an error state and retries the request', async () => {
    fetchMock.mockRejectedValueOnce(new Error('boom'))
    renderClients()

    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't load clients.")
    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument()

    fetchMock.mockResolvedValueOnce(jsonResponse(200, clientSummaries))
    await user.click(screen.getByRole('button', { name: /retry/i }))

    expect(await screen.findByRole('link', { name: /Acme Ltd/ })).toBeInTheDocument()
  })

  it('refreshes the list with the backend search parameter', async () => {
    fetchMock.mockImplementation((input: RequestInfo | URL) => {
      const params = new URL(String(input), 'http://test').searchParams
      if (params.get('search') === 'jane') {
        return Promise.resolve(jsonResponse(200, [clientSummaries[1]]))
      }
      return Promise.resolve(jsonResponse(200, clientSummaries))
    })
    renderClients()
    await screen.findByRole('link', { name: /Acme Ltd/ })

    await user.type(screen.getByRole('searchbox', { name: /search clients/i }), 'jane')

    await waitFor(() =>
      expect(screen.queryByRole('link', { name: /Acme Ltd/ })).not.toBeInTheDocument(),
    )
    expect(screen.getByRole('link', { name: /Jane Doe/ })).toBeInTheDocument()
    const searchCall = fetchMock.mock.calls.at(-1) as [string]
    expect(searchCall[0]).toContain('search=jane')
  })

  it('filters by status using the backend status parameter', async () => {
    fetchMock.mockImplementation((input: RequestInfo | URL) => {
      const params = new URL(String(input), 'http://test').searchParams
      if (params.get('status') === 'inactive') {
        return Promise.resolve(jsonResponse(200, [clientSummaries[1]]))
      }
      return Promise.resolve(jsonResponse(200, clientSummaries))
    })
    renderClients()
    await screen.findByRole('link', { name: /Acme Ltd/ })

    await user.selectOptions(screen.getByRole('combobox', { name: /filter by status/i }), 'inactive')

    await waitFor(() =>
      expect(screen.queryByRole('link', { name: /Acme Ltd/ })).not.toBeInTheDocument(),
    )
    const call = fetchMock.mock.calls.at(-1) as [string]
    expect(call[0]).toContain('status=inactive')
  })

  it('navigates to the create page', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, []))
    renderClients()
    await screen.findByText('No clients yet.')

    await user.click(screen.getByRole('link', { name: /new client/i }))
    expect(await screen.findByText('create-page')).toBeInTheDocument()
  })

  it('navigates to a client detail page from a row', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, clientSummaries))
    renderClients()
    await screen.findByRole('link', { name: /Acme Ltd/ })

    await user.click(screen.getByRole('link', { name: /Acme Ltd/ }))
    expect(await screen.findByText('detail-page')).toBeInTheDocument()
  })
})