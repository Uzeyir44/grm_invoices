import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useParams } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ClientCreatePage } from './ClientCreatePage'
import { clientDetail, jsonResponse } from '../../test/clientFixtures'

function DetailMarker() {
  const { clientId } = useParams()
  return <div data-testid="detail-view">{clientId}</div>
}

function renderCreate() {
  return render(
    <MemoryRouter initialEntries={['/clients/new']}>
      <Routes>
        <Route path="/clients/new" element={<ClientCreatePage />} />
        <Route path="/clients/:clientId" element={<DetailMarker />} />
        <Route path="/clients" element={<div data-testid="list-view" />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('ClientCreatePage', () => {
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

  it('renders company-agnostic required fields for the default legal entity', () => {
    renderCreate()
    expect(screen.getByLabelText(/client type/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/legal name/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/voen/i)).toBeInTheDocument()
    // No company id field exists — the tenant comes from the backend.
    expect(screen.queryByLabelText(/company/i)).not.toBeInTheDocument()
  })

  it('switches to individual subtype fields', async () => {
    renderCreate()
    await user.selectOptions(screen.getByLabelText(/client type/i), 'individual')
    expect(screen.getByLabelText(/first name/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/last name/i)).toBeInTheDocument()
    expect(screen.queryByLabelText(/legal name/i)).not.toBeInTheDocument()
  })

  it('blocks submission without required fields and does not call the API', async () => {
    renderCreate()
    await user.click(screen.getByRole('button', { name: /create client/i }))

    expect(screen.getByText('Legal entity name is required.')).toBeInTheDocument()
    expect(screen.getByText('VOEN is required.')).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('creates a client and navigates to its detail page', async () => {
    fetchMock.mockResolvedValue(jsonResponse(201, clientDetail))
    renderCreate()

    await user.type(screen.getByLabelText(/legal name/i), 'Acme Ltd')
    await user.type(screen.getByLabelText(/voen/i), '1234567890')
    await user.click(screen.getByRole('button', { name: /create client/i }))

    const [url, init] = await waitFor(() => {
      expect(fetchMock).toHaveBeenCalled()
      return fetchMock.mock.calls[0] as [string, RequestInit]
    })
    expect(url).toBe('/api/clients/')
    expect(JSON.parse(String(init.body))).toEqual({
      client_type: 'legal_entity',
      status: 'active',
      legal_entity: {
        legal_name: 'Acme Ltd',
        trading_name: null,
        voen: '1234567890',
        registration_number: null,
        registration_date: null,
      },
    })

    const detail = await screen.findByTestId('detail-view')
    expect(within(detail).getByText('1')).toBeInTheDocument()
  })

  it('shows backend validation errors and preserves entered values', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(400, { legal_entity: { voen: ['A legal entity with this VOEN already exists.'] } }),
    )
    renderCreate()

    await user.type(screen.getByLabelText(/legal name/i), 'Acme Ltd')
    await user.type(screen.getByLabelText(/voen/i), '999')
    await user.click(screen.getByRole('button', { name: /create client/i }))

    expect(await screen.findByText(/VOEN already exists/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/legal name/i)).toHaveValue('Acme Ltd')
    expect(screen.getByLabelText(/voen/i)).toHaveValue('999')
  })

  it('prevents duplicate submissions while a request is in flight', async () => {
    let resolveRequest: (value: Response) => void = () => {}
    fetchMock.mockReturnValue(new Promise<Response>((resolve) => { resolveRequest = resolve }))
    renderCreate()

    await user.type(screen.getByLabelText(/legal name/i), 'Acme Ltd')
    await user.type(screen.getByLabelText(/voen/i), '1234567890')
    await user.click(screen.getByRole('button', { name: /create client/i }))

    const submitting = screen.getByRole('button', { name: /creating/i })
    expect(submitting).toBeDisabled()
    await user.click(submitting)
    expect(fetchMock).toHaveBeenCalledTimes(1)

    resolveRequest(jsonResponse(201, clientDetail))
    await screen.findByTestId('detail-view')
  })
})