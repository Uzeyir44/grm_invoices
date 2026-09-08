import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ClientDetailPage } from './ClientDetailPage'
import { clientDetail, jsonResponse } from '../../test/clientFixtures'
import type { ClientAddress } from '../../types/client'

const addressTypesFixture = [
  { id: 1, code: 'legal' },
  { id: 2, code: 'business' },
  { id: 3, code: 'residential' },
]

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

/**
 * Route fetch calls the way the page does: client detail, the nested
 * address collection (plus writes), and the address-type catalog. The
 * addresses section fetches its collection independently of the client
 * detail, so a single static mock response would hand it the wrong shape.
 */
function stubBackend(overrides: {
  detailStatus?: number
  detailBody?: unknown
  addressesBody?: unknown
  typesBody?: unknown
  typesStatus?: number
  onWrite?: (url: string, init: RequestInit) => Response | undefined
} = {}) {
  fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const method = init?.method ?? 'GET'
    if (url === '/api/reference-data/address-types/') {
      return Promise.resolve(
        jsonResponse(overrides.typesStatus ?? 200, overrides.typesBody ?? addressTypesFixture),
      )
    }
    if (url === '/api/clients/1/addresses/') {
      if (method === 'GET') {
        return Promise.resolve(
          jsonResponse(200, overrides.addressesBody ?? clientDetail.addresses),
        )
      }
      const handled = overrides.onWrite?.(url, init as RequestInit)
      if (handled) return Promise.resolve(handled)
      return Promise.resolve(jsonResponse(500, {}))
    }
    if (url.startsWith('/api/clients/1/addresses/')) {
      const handled = overrides.onWrite?.(url, init as RequestInit)
      if (handled) return Promise.resolve(handled)
      return Promise.resolve(jsonResponse(500, {}))
    }
    return Promise.resolve(
      jsonResponse(overrides.detailStatus ?? 200, overrides.detailBody ?? clientDetail),
    )
  })
}

const fetchMock = vi.fn()

describe('ClientDetailPage', () => {
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
    stubBackend()
    renderDetail()

    expect(await screen.findByRole('heading', { name: 'Acme Ltd' })).toBeInTheDocument()
    expect(screen.getByText('active')).toBeInTheDocument()
    expect(screen.getByText('legal_entity')).toBeInTheDocument()
    expect(screen.getByText('1234567890')).toBeInTheDocument()
    expect(screen.getByText('Alice Manager')).toBeInTheDocument()
    // The addresses section mounts after the client detail loads, so wait
    // for its rows instead of asserting synchronously.
    expect(await screen.findByText(/Main St 1/)).toBeInTheDocument()
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
    let detailCalls = 0
    fetchMock.mockImplementation((input: RequestInfo | URL) => {
      const url = String(input)
      if (url === '/api/clients/1/addresses/') {
        return Promise.resolve(jsonResponse(200, clientDetail.addresses))
      }
      detailCalls += 1
      if (detailCalls === 1) return Promise.reject(new Error('boom'))
      return Promise.resolve(jsonResponse(200, clientDetail))
    })
    renderDetail()

    expect(await screen.findByText("Couldn't load the client.")).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /retry/i }))
    expect(await screen.findByRole('heading', { name: 'Acme Ltd' })).toBeInTheDocument()
  })

  it('deletes the client after explicit confirmation and returns to the list', async () => {
    stubBackend()
    renderDetail()
    await screen.findByRole('heading', { name: 'Acme Ltd' })

    await user.click(screen.getByRole('button', { name: /delete client/i }))
    expect(screen.getByText(/are you sure/i)).toBeInTheDocument()

    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }))
    await user.click(screen.getByRole('button', { name: /yes, delete/i }))
    const deleteCall = fetchMock.mock.calls.find(([, init]) => init.method === 'DELETE') as
      | [string, RequestInit]
      | undefined
    expect(deleteCall?.[0]).toBe('/api/clients/1/')

    expect(await screen.findByTestId('list-view')).toBeInTheDocument()
  })
})

describe('ClientDetailPage addresses', () => {
  const user = userEvent.setup()

  beforeEach(() => {
    localStorage.clear()
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('renders existing addresses with their backend fields', async () => {
    stubBackend()
    renderDetail()

    await screen.findByRole('heading', { name: 'Acme Ltd' })
    await screen.findByText(/Main St 1, Baku, AZ/)
    const section = screen.getByRole('region', { name: 'Addresses' })
    expect(within(section).getByText(/Main St 1, Baku, AZ/)).toBeInTheDocument()
    expect(within(section).getByText(/billing/)).toBeInTheDocument()
    expect(within(section).getByText(/primary/)).toBeInTheDocument()
    expect(within(section).getByRole('button', { name: /^edit$/i })).toBeInTheDocument()
    expect(within(section).getByRole('button', { name: /^delete$/i })).toBeInTheDocument()
  })

  it('shows an addresses loading state without fabricated rows', () => {
    fetchMock.mockImplementation((input: RequestInfo | URL) => {
      const url = String(input)
      if (url === '/api/clients/1/addresses/') {
        return new Promise<Response>(() => {})
      }
      return Promise.resolve(jsonResponse(200, clientDetail))
    })
    renderDetail()

    expect(screen.getByTestId('client-loading')).toBeInTheDocument()
  })

  it('shows the section loading state once the client has loaded', async () => {
    let resolveAddresses!: (response: Response) => void
    const addressesPromise = new Promise<Response>((resolve) => {
      resolveAddresses = resolve
    })
    fetchMock.mockImplementation((input: RequestInfo | URL) => {
      const url = String(input)
      if (url === '/api/clients/1/addresses/') {
        return addressesPromise
      }
      return Promise.resolve(jsonResponse(200, clientDetail))
    })
    renderDetail()
    await screen.findByRole('heading', { name: 'Acme Ltd' })

    expect(screen.getByText('Loading addresses…')).toBeInTheDocument()
    expect(screen.queryByText(/Main St 1/)).not.toBeInTheDocument()

    resolveAddresses(jsonResponse(200, clientDetail.addresses))
    expect(await screen.findByText(/Main St 1/)).toBeInTheDocument()
  })

  it('shows an empty state with an add action when the client has no addresses', async () => {
    stubBackend({ addressesBody: [] })
    renderDetail()

    await screen.findByRole('heading', { name: 'Acme Ltd' })
    expect(await screen.findByText('No addresses found.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^add address$/i })).toBeInTheDocument()
  })

  it('shows an error state with retry when loading addresses fails', async () => {
    let addressCalls = 0
    fetchMock.mockImplementation((input: RequestInfo | URL) => {
      const url = String(input)
      if (url === '/api/clients/1/addresses/') {
        addressCalls += 1
        if (addressCalls === 1) return Promise.resolve(jsonResponse(500, {}))
        return Promise.resolve(jsonResponse(200, clientDetail.addresses))
      }
      return Promise.resolve(jsonResponse(200, clientDetail))
    })
    renderDetail()
    await screen.findByRole('heading', { name: 'Acme Ltd' })

    expect(await screen.findByText("Couldn't load addresses.")).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /retry/i }))
    expect(await screen.findByText(/Main St 1/)).toBeInTheDocument()
    expect(addressCalls).toBe(2)
  })

  it('shows an access-denied state when the address collection returns 403', async () => {
    fetchMock.mockImplementation((input: RequestInfo | URL) => {
      const url = String(input)
      if (url === '/api/clients/1/addresses/') {
        return Promise.resolve(jsonResponse(403, { detail: 'No permission.' }))
      }
      if (url === '/api/reference-data/address-types/') {
        return Promise.resolve(jsonResponse(200, addressTypesFixture))
      }
      return Promise.resolve(jsonResponse(200, clientDetail))
    })
    renderDetail()
    await screen.findByRole('heading', { name: 'Acme Ltd' })

    expect(
      await screen.findByText('You do not have permission to view addresses.'),
    ).toBeInTheDocument()
  })

  it('creates an address with the correct payload and refreshes the list', async () => {
    let rows: ClientAddress[] = [...clientDetail.addresses]
    const posts: Array<{ url: string; body: unknown }> = []
    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      const method = init?.method ?? 'GET'
      if (url === '/api/reference-data/address-types/') {
        return Promise.resolve(jsonResponse(200, addressTypesFixture))
      }
      if (url === '/api/clients/1/addresses/' && method === 'GET') {
        return Promise.resolve(jsonResponse(200, rows))
      }
      if (url === '/api/clients/1/addresses/' && method === 'POST') {
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>
        posts.push({ url, body })
        const created: ClientAddress = {
          id: 2,
          address_type: body.address_type as number,
          address_type_code: 'legal',
          line1: body.line1 as string,
          line2: (body.line2 as string | null) ?? null,
          city: (body.city as string | null) ?? null,
          region: null,
          postal_code: null,
          country_code: 'AZ',
          is_primary: false,
        }
        rows = [...rows, created]
        return Promise.resolve(jsonResponse(201, created))
      }
      return Promise.resolve(jsonResponse(200, clientDetail))
    })
    renderDetail()
    await screen.findByRole('heading', { name: 'Acme Ltd' })
    await screen.findByText(/Main St 1/)

    await user.click(screen.getByRole('button', { name: /^add address$/i }))
    await screen.findByRole('option', { name: 'legal' })

    await user.selectOptions(screen.getByLabelText(/address type/i), '1')
    await user.type(screen.getByLabelText(/street address/i), 'Second St 5')
    await user.type(screen.getByLabelText(/^city$/i), 'Ganja')

    const form = screen.getByRole('form', { name: 'Add address' })
    await user.click(within(form).getByRole('button', { name: /^add address$/i }))

    expect(await screen.findByText('Address added.')).toBeInTheDocument()
    expect(await screen.findByText(/Second St 5/)).toBeInTheDocument()
    expect(posts).toHaveLength(1)
    expect(posts[0].url).toBe('/api/clients/1/addresses/')
    expect(posts[0].body).toEqual({
      address_type: 1,
      line1: 'Second St 5',
      line2: null,
      city: 'Ganja',
      region: null,
      postal_code: null,
      is_primary: false,
    })
    // No company scoping parameter is ever sent.
    expect(JSON.stringify(posts[0].body)).not.toContain('company_id')
  })

  it('prevents duplicate submissions while creating', async () => {
    let resolvePost!: (response: Response) => void
    const postPromise = new Promise<Response>((resolve) => {
      resolvePost = resolve
    })
    let postCount = 0
    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      const method = init?.method ?? 'GET'
      if (url === '/api/reference-data/address-types/') {
        return Promise.resolve(jsonResponse(200, addressTypesFixture))
      }
      if (url === '/api/clients/1/addresses/' && method === 'GET') {
        return Promise.resolve(jsonResponse(200, clientDetail.addresses))
      }
      if (url === '/api/clients/1/addresses/' && method === 'POST') {
        postCount += 1
        return postPromise
      }
      return Promise.resolve(jsonResponse(200, clientDetail))
    })
    renderDetail()
    await screen.findByRole('heading', { name: 'Acme Ltd' })
    await screen.findByText(/Main St 1/)

    await user.click(screen.getByRole('button', { name: /^add address$/i }))
    await screen.findByRole('option', { name: 'legal' })
    await user.selectOptions(screen.getByLabelText(/address type/i), '1')
    await user.type(screen.getByLabelText(/street address/i), 'Second St 5')

    const form = screen.getByRole('form', { name: 'Add address' })
    const submit = within(form).getByRole('button', { name: /^add address$/i })
    await user.click(submit)
    await user.click(submit)

    resolvePost(jsonResponse(201, { ...clientDetail.addresses[0], id: 2 }))
    expect(await screen.findByText('Address added.')).toBeInTheDocument()
    expect(postCount).toBe(1)
  })

  it('validates required fields locally without calling the API', async () => {
    stubBackend()
    renderDetail()
    await screen.findByRole('heading', { name: 'Acme Ltd' })
    await screen.findByText(/Main St 1/)

    await user.click(screen.getByRole('button', { name: /^add address$/i }))
    await screen.findByRole('option', { name: 'legal' })

    const callsBefore = fetchMock.mock.calls.length
    const form = screen.getByRole('form', { name: 'Add address' })
    await user.click(within(form).getByRole('button', { name: /^add address$/i }))

    expect(await screen.findByText('Address type is required.')).toBeInTheDocument()
    expect(screen.getByText('Street address is required.')).toBeInTheDocument()
    expect(fetchMock.mock.calls.length).toBe(callsBefore)
  })

  it('surfaces backend field validation errors inline', async () => {
    stubBackend({
      onWrite: (url, init) => {
        if (url === '/api/clients/1/addresses/' && init.method === 'POST') {
          return jsonResponse(400, {
            is_primary: ['This client already has a primary address.'],
          })
        }
        return undefined
      },
    })
    renderDetail()
    await screen.findByRole('heading', { name: 'Acme Ltd' })
    await screen.findByText(/Main St 1/)

    await user.click(screen.getByRole('button', { name: /^add address$/i }))
    await screen.findByRole('option', { name: 'legal' })
    await user.selectOptions(screen.getByLabelText(/address type/i), '1')
    await user.type(screen.getByLabelText(/street address/i), 'Second St 5')
    await user.click(screen.getByLabelText(/primary address/i))

    const form = screen.getByRole('form', { name: 'Add address' })
    await user.click(within(form).getByRole('button', { name: /^add address$/i }))

    expect(
      await screen.findByText('This client already has a primary address.'),
    ).toBeInTheDocument()
    // The entered values are preserved.
    expect(screen.getByLabelText(/street address/i)).toHaveValue('Second St 5')
  })

  it('edits an address with pre-filled values and PATCHes the row', async () => {
    const patches: Array<{ url: string; body: unknown }> = []
    let rows: ClientAddress[] = [...clientDetail.addresses]
    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      const method = init?.method ?? 'GET'
      if (url === '/api/reference-data/address-types/') {
        return Promise.resolve(jsonResponse(200, addressTypesFixture))
      }
      if (url === '/api/clients/1/addresses/' && method === 'GET') {
        return Promise.resolve(jsonResponse(200, rows))
      }
      if (url === '/api/clients/1/addresses/1/' && method === 'PATCH') {
        const body = JSON.parse(String(init?.body)) as Partial<ClientAddress>
        patches.push({ url, body })
        rows = rows.map((row) => ({ ...row, ...body }))
        return Promise.resolve(jsonResponse(200, rows[0]))
      }
      return Promise.resolve(jsonResponse(200, clientDetail))
    })
    renderDetail()
    await screen.findByRole('heading', { name: 'Acme Ltd' })
    await screen.findByText(/Main St 1/)

    await user.click(screen.getByRole('button', { name: /^edit$/i }))
    const form = await screen.findByRole('form', { name: 'Edit address' })
    // Existing values are populated, including the type select.
    expect(screen.getByLabelText(/street address/i)).toHaveValue('Main St 1')
    expect(screen.getByLabelText(/city$/i)).toHaveValue('Baku')
    expect(screen.getByLabelText(/address type/i)).toHaveValue('1')

    await user.clear(screen.getByLabelText(/street address/i))
    await user.type(screen.getByLabelText(/street address/i), 'Updated St 9')
    await user.click(within(form).getByRole('button', { name: /save changes/i }))

    expect(await screen.findByText('Address updated.')).toBeInTheDocument()
    expect(await screen.findByText(/Updated St 9/)).toBeInTheDocument()
    expect(patches).toHaveLength(1)
    expect(patches[0].url).toBe('/api/clients/1/addresses/1/')
    expect(patches[0].body).toMatchObject({ line1: 'Updated St 9' })
  })

  it('deletes an address only after confirmation and refreshes the list', async () => {
    let rows: ClientAddress[] = [...clientDetail.addresses]
    const deletes: string[] = []
    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      const method = init?.method ?? 'GET'
      if (url === '/api/clients/1/addresses/' && method === 'GET') {
        return Promise.resolve(jsonResponse(200, rows))
      }
      if (url === '/api/clients/1/addresses/1/' && method === 'DELETE') {
        deletes.push(url)
        rows = []
        return Promise.resolve(new Response(null, { status: 204 }))
      }
      return Promise.resolve(jsonResponse(200, clientDetail))
    })
    renderDetail()
    await screen.findByRole('heading', { name: 'Acme Ltd' })
    await screen.findByText(/Main St 1/)

    await user.click(screen.getByRole('button', { name: /^delete$/i }))
    expect(screen.getByText('Delete this address?')).toBeInTheDocument()
    expect(deletes).toHaveLength(0)

    await user.click(screen.getByRole('button', { name: /^cancel$/i }))
    expect(deletes).toHaveLength(0)
    expect(screen.queryByText('Delete this address?')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /^delete$/i }))
    await user.click(screen.getByRole('button', { name: /yes, delete/i }))

    expect(await screen.findByText('Address deleted.')).toBeInTheDocument()
    expect(await screen.findByText('No addresses found.')).toBeInTheDocument()
    expect(deletes).toEqual(['/api/clients/1/addresses/1/'])
  })

  it('shows a safe error when deleting fails', async () => {
    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      const method = init?.method ?? 'GET'
      if (url === '/api/clients/1/addresses/' && method === 'GET') {
        return Promise.resolve(jsonResponse(200, clientDetail.addresses))
      }
      if (url === '/api/clients/1/addresses/1/' && method === 'DELETE') {
        return Promise.resolve(jsonResponse(403, { detail: 'No permission.' }))
      }
      return Promise.resolve(jsonResponse(200, clientDetail))
    })
    renderDetail()
    await screen.findByRole('heading', { name: 'Acme Ltd' })
    await screen.findByText(/Main St 1/)

    await user.click(screen.getByRole('button', { name: /^delete$/i }))
    await user.click(screen.getByRole('button', { name: /yes, delete/i }))

    expect(
      await screen.findByText('You do not have permission to manage addresses.'),
    ).toBeInTheDocument()
    // The row is still there — nothing was deleted.
    expect(screen.getByText(/Main St 1/)).toBeInTheDocument()
  })

  it('shows a retry action when address types fail to load', async () => {
    let typesCalls = 0
    fetchMock.mockImplementation((input: RequestInfo | URL) => {
      const url = String(input)
      if (url === '/api/clients/1/addresses/') {
        return Promise.resolve(jsonResponse(200, clientDetail.addresses))
      }
      if (url === '/api/reference-data/address-types/') {
        typesCalls += 1
        if (typesCalls === 1) return Promise.resolve(jsonResponse(500, {}))
        return Promise.resolve(jsonResponse(200, addressTypesFixture))
      }
      return Promise.resolve(jsonResponse(200, clientDetail))
    })
    renderDetail()
    await screen.findByRole('heading', { name: 'Acme Ltd' })
    await screen.findByText(/Main St 1/)

    await user.click(screen.getByRole('button', { name: /^add address$/i }))
    expect(await screen.findByText("Couldn't load address types.")).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /^retry$/i }))
    expect(await screen.findByRole('option', { name: 'legal' })).toBeInTheDocument()
    expect(typesCalls).toBe(2)
  })
})
