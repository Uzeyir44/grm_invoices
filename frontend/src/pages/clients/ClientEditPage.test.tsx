import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useParams } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ClientEditPage } from './ClientEditPage'
import { clientDetail, jsonResponse } from '../../test/clientFixtures'

function DetailMarker() {
  const { clientId } = useParams()
  return <div data-testid="detail-view">{clientId}</div>
}

function renderEdit() {
  return render(
    <MemoryRouter initialEntries={['/clients/1/edit']}>
      <Routes>
        <Route path="/clients/:clientId/edit" element={<ClientEditPage />} />
        <Route path="/clients/:clientId" element={<DetailMarker />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('ClientEditPage', () => {
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

  it('shows a loading state while loading current values', () => {
    fetchMock.mockReturnValue(new Promise<Response>(() => {}))
    renderEdit()
    expect(screen.getByTestId('client-loading')).toHaveTextContent('Loading…')
  })

  it('loads current values and keeps the client type immutable', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, clientDetail))
    renderEdit()

    const legalName = await screen.findByLabelText(/legal name/i)
    expect(legalName).toHaveValue('Acme Ltd')
    expect(screen.getByLabelText(/voen/i)).toHaveValue('1234567890')

    const typeSelect = screen.getByLabelText(/client type/i)
    expect(typeSelect).toHaveValue('legal_entity')
    expect(typeSelect).toBeDisabled()
  })

  it('updates the client with PATCH and navigates to the detail page', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(200, clientDetail))
      .mockResolvedValueOnce(jsonResponse(200, { ...clientDetail, status: 'active' }))
    renderEdit()
    const legalName = await screen.findByLabelText(/legal name/i)

    await user.clear(legalName)
    await user.type(legalName, 'Acme Holdings')
    await user.click(screen.getByRole('button', { name: /save changes/i }))

    const updateCall = await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(2)
      return fetchMock.mock.calls[1] as [string, RequestInit]
    })
    expect(updateCall[0]).toBe('/api/clients/1/')
    expect(updateCall[1].method).toBe('PATCH')
    expect(JSON.parse(String(updateCall[1].body))).toMatchObject({
      status: 'active',
      legal_entity: { legal_name: 'Acme Holdings', voen: '1234567890' },
    })

    const detail = await screen.findByTestId('detail-view')
    expect(detail.textContent).toBe('1')
  })

  it('shows backend validation errors on update', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(200, clientDetail))
      .mockResolvedValueOnce(
        jsonResponse(400, { legal_entity: { voen: ['This VOEN is already in use.'] } }),
      )
    renderEdit()
    await screen.findByLabelText(/legal name/i)

    await user.click(screen.getByRole('button', { name: /save changes/i }))

    expect(await screen.findByText(/VOEN is already in use/i)).toBeInTheDocument()
  })
})