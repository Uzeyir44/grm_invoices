import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ClientDetailPage } from './ClientDetailPage'
import { clientDetail, jsonResponse } from '../../test/clientFixtures'

function renderDetail() {
  return render(
    <MemoryRouter initialEntries={['/clients/1']}>
      <Routes>
        <Route path="/clients/:clientId" element={<ClientDetailPage />} />
        <Route path="/clients" element={<div data-testid="list-view" />} />
        <Route path="/clients/:clientId/edit" element={<div>edit-view</div>} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('ClientDetailPage', () => {
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

  it('shows a loading state while fetching', () => {
    fetchMock.mockReturnValue(new Promise<Response>(() => {}))
    renderDetail()
    expect(screen.getByTestId('client-loading')).toHaveTextContent('Loading…')
  })

  it('renders the client fields and read-only nested data', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, clientDetail))
    renderDetail()

    expect(await screen.findByRole('heading', { name: 'Acme Ltd' })).toBeInTheDocument()
    expect(screen.getByText('active')).toBeInTheDocument()
    expect(screen.getByText('legal_entity')).toBeInTheDocument()
    expect(screen.getByText('1234567890')).toBeInTheDocument()
    expect(screen.getByText('Alice Manager')).toBeInTheDocument()
    expect(screen.getByText(/Main St 1/)).toBeInTheDocument()
    expect(screen.getByText(/Test Bank/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /edit/i })).toHaveAttribute(
      'href',
      '/clients/1/edit',
    )
  })

  it('shows a safe not-found state for 404 (covers cross-tenant too)', async () => {
    fetchMock.mockResolvedValue(jsonResponse(404, { detail: 'Not found.' }))
    renderDetail()

    expect(await screen.findByText('Client not found.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /back to clients/i })).toBeInTheDocument()
  })

  it('shows a safe message for forbidden access', async () => {
    fetchMock.mockResolvedValue(jsonResponse(403, { detail: 'No permission.' }))
    renderDetail()

    expect(
      await screen.findByText(/do not have permission to view this client/i),
    ).toBeInTheDocument()
  })

  it('shows an error state and retries', async () => {
    fetchMock.mockRejectedValueOnce(new Error('boom'))
    renderDetail()

    expect(await screen.findByText("Couldn't load the client.")).toBeInTheDocument()

    fetchMock.mockResolvedValueOnce(jsonResponse(200, clientDetail))
    await user.click(screen.getByRole('button', { name: /retry/i }))
    expect(await screen.findByRole('heading', { name: 'Acme Ltd' })).toBeInTheDocument()
  })

  it('deletes the client after explicit confirmation and returns to the list', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(200, clientDetail))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
    renderDetail()
    await screen.findByRole('heading', { name: 'Acme Ltd' })

    await user.click(screen.getByRole('button', { name: /delete client/i }))
    expect(screen.getByText(/are you sure/i)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /yes, delete/i }))
    const deleteCall = fetchMock.mock.calls[1] as [string, RequestInit]
    expect(deleteCall[0]).toBe('/api/clients/1/')
    expect(deleteCall[1].method).toBe('DELETE')

    expect(await screen.findByTestId('list-view')).toBeInTheDocument()
  })
})