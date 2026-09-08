import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, RouterProvider, Routes, createMemoryRouter } from 'react-router-dom'
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ClientDetailPage } from './ClientDetailPage'
import { clientDetail, jsonResponse } from '../../test/clientFixtures'
import type { ClientAddress, ClientBankAccount, ClientContact } from '../../types/client'

const addressTypesFixture = [
  { id: 1, code: 'legal' },
  { id: 2, code: 'business' },
  { id: 3, code: 'residential' },
]

const banksFixture = [{ id: 1, name: 'Test Bank', swift_code: 'TESTAZ22', is_active: true }]

const currenciesFixture = [{ id: 1, code: 'AZN', name: 'Manat', minor_unit: 2 }]

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
  contactsBody?: unknown
  accountsBody?: unknown
  typesBody?: unknown
  typesStatus?: number
  banksBody?: unknown
  banksStatus?: number
  currenciesBody?: unknown
  currenciesStatus?: number
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
    if (url === '/api/clients/1/contacts/') {
      if (method === 'GET') {
        return Promise.resolve(
          jsonResponse(200, overrides.contactsBody ?? clientDetail.contacts),
        )
      }
      const handled = overrides.onWrite?.(url, init as RequestInit)
      if (handled) return Promise.resolve(handled)
      return Promise.resolve(jsonResponse(500, {}))
    }
    if (url === '/api/reference-data/banks/') {
      return Promise.resolve(
        jsonResponse(overrides.banksStatus ?? 200, overrides.banksBody ?? banksFixture),
      )
    }
    if (url === '/api/reference-data/currencies/') {
      return Promise.resolve(
        jsonResponse(
          overrides.currenciesStatus ?? 200,
          overrides.currenciesBody ?? currenciesFixture,
        ),
      )
    }
    if (url === '/api/clients/1/bank-accounts/') {
      if (method === 'GET') {
        return Promise.resolve(
          jsonResponse(200, overrides.accountsBody ?? clientDetail.bank_accounts),
        )
      }
      const handled = overrides.onWrite?.(url, init as RequestInit)
      if (handled) return Promise.resolve(handled)
      return Promise.resolve(jsonResponse(500, {}))
    }
    if (url.startsWith('/api/clients/1/bank-accounts/')) {
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
    // Both nested sections mount after the client detail loads, so wait for
    // their rows instead of asserting synchronously.
    expect(await screen.findByText('Alice Manager')).toBeInTheDocument()
    expect(await screen.findByText(/Main St 1/)).toBeInTheDocument()
    expect(await screen.findByText(/Test Bank/)).toBeInTheDocument()
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

  it('ignores a stale client response after navigating to another client', async () => {
    const client2 = {
      ...clientDetail,
      id: 2,
      legal_entity: { ...clientDetail.legal_entity, legal_name: 'Beta LLC' },
    }
    const addresses2 = [{ ...clientDetail.addresses[0], id: 9, line1: 'Second St 2' }]
    let resolveClient1!: (response: Response) => void
    const client1Promise = new Promise<Response>((resolve) => {
      resolveClient1 = resolve
    })
    fetchMock.mockImplementation((input: RequestInfo | URL) => {
      const url = String(input)
      if (url === '/api/clients/1/') return client1Promise
      if (url === '/api/clients/2/') return Promise.resolve(jsonResponse(200, client2))
      if (url === '/api/clients/2/addresses/') {
        return Promise.resolve(jsonResponse(200, addresses2))
      }
      if (url === '/api/clients/2/contacts/') {
        return Promise.resolve(jsonResponse(200, []))
      }
      if (url === '/api/clients/2/bank-accounts/') {
        return Promise.resolve(jsonResponse(200, []))
      }
      return Promise.resolve(jsonResponse(200, clientDetail))
    })
    const router = createMemoryRouter(
      [{ path: '/clients/:clientId', element: <ClientDetailPage /> }],
      { initialEntries: ['/clients/1'] },
    )
    render(<RouterProvider router={router} />)
    expect(screen.getByTestId('client-loading')).toBeInTheDocument()

    await act(async () => {
      await router.navigate('/clients/2')
    })
    expect(await screen.findByRole('heading', { name: 'Beta LLC' })).toBeInTheDocument()

    // The client-1 response arrives late and must be ignored — including its
    // nested sections, which never mounted for client 1.
    resolveClient1(jsonResponse(200, clientDetail))
    expect(await screen.findByText(/Second St 2/)).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Acme Ltd' })).not.toBeInTheDocument()
    expect(screen.queryByText(/Main St 1/)).not.toBeInTheDocument()
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

describe('ClientDetailPage bank accounts', () => {
  const user = userEvent.setup()

  beforeEach(() => {
    localStorage.clear()
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('renders existing bank accounts with their backend fields', async () => {
    stubBackend()
    renderDetail()

    await screen.findByRole('heading', { name: 'Acme Ltd' })
    await screen.findByText(/AZ00TEST0000000000/)
    const section = screen.getByRole('region', { name: 'Bank accounts' })
    expect(within(section).getByText('Test Bank')).toBeInTheDocument()
    expect(within(section).getByText(/AZ00TEST0000000000/)).toBeInTheDocument()
    expect(within(section).getByText(/AZN/)).toBeInTheDocument()
    expect(within(section).getByText(/default/)).toBeInTheDocument()
    expect(within(section).getByRole('button', { name: /^edit$/i })).toBeInTheDocument()
    expect(within(section).getByRole('button', { name: /^delete$/i })).toBeInTheDocument()
  })

  it('shows the section loading state once the client has loaded', async () => {
    let resolveAccounts!: (response: Response) => void
    const accountsPromise = new Promise<Response>((resolve) => {
      resolveAccounts = resolve
    })
    fetchMock.mockImplementation((input: RequestInfo | URL) => {
      const url = String(input)
      if (url === '/api/clients/1/bank-accounts/') {
        return accountsPromise
      }
      return Promise.resolve(jsonResponse(200, clientDetail))
    })
    renderDetail()
    await screen.findByRole('heading', { name: 'Acme Ltd' })

    expect(screen.getByText('Loading bank accounts…')).toBeInTheDocument()
    expect(screen.queryByText(/AZ00TEST0000000000/)).not.toBeInTheDocument()

    // The other nested sections receive the wrong shape here and render
    // nothing; only the bank accounts resolution is under test.
    resolveAccounts(jsonResponse(200, clientDetail.bank_accounts))
    expect(await screen.findByText(/AZ00TEST0000000000/)).toBeInTheDocument()
  })

  it('shows an empty state with an add action when the client has no bank accounts', async () => {
    stubBackend({ accountsBody: [] })
    renderDetail()

    await screen.findByRole('heading', { name: 'Acme Ltd' })
    expect(await screen.findByText('No bank accounts found.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^add bank account$/i })).toBeInTheDocument()
  })

  it('shows an error state with retry when loading bank accounts fails', async () => {
    let accountCalls = 0
    fetchMock.mockImplementation((input: RequestInfo | URL) => {
      const url = String(input)
      if (url === '/api/clients/1/bank-accounts/') {
        accountCalls += 1
        if (accountCalls === 1) return Promise.resolve(jsonResponse(500, {}))
        return Promise.resolve(jsonResponse(200, clientDetail.bank_accounts))
      }
      return Promise.resolve(jsonResponse(200, clientDetail))
    })
    renderDetail()
    await screen.findByRole('heading', { name: 'Acme Ltd' })

    expect(await screen.findByText("Couldn't load bank accounts.")).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /retry/i }))
    expect(await screen.findByText(/AZ00TEST0000000000/)).toBeInTheDocument()
    expect(accountCalls).toBe(2)
  })

  it('shows an access-denied state when the bank account collection returns 403', async () => {
    fetchMock.mockImplementation((input: RequestInfo | URL) => {
      const url = String(input)
      if (url === '/api/clients/1/bank-accounts/') {
        return Promise.resolve(jsonResponse(403, { detail: 'No permission.' }))
      }
      return Promise.resolve(jsonResponse(200, clientDetail))
    })
    renderDetail()
    await screen.findByRole('heading', { name: 'Acme Ltd' })

    expect(
      await screen.findByText('You do not have permission to view bank accounts.'),
    ).toBeInTheDocument()
  })

  it('creates a bank account with the correct payload and refreshes the list', async () => {
    let rows: ClientBankAccount[] = [...clientDetail.bank_accounts]
    const posts: Array<{ url: string; body: unknown }> = []
    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      const method = init?.method ?? 'GET'
      if (url === '/api/reference-data/banks/') {
        return Promise.resolve(jsonResponse(200, banksFixture))
      }
      if (url === '/api/reference-data/currencies/') {
        return Promise.resolve(jsonResponse(200, currenciesFixture))
      }
      if (url === '/api/clients/1/bank-accounts/' && method === 'GET') {
        return Promise.resolve(jsonResponse(200, rows))
      }
      if (url === '/api/clients/1/bank-accounts/' && method === 'POST') {
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>
        posts.push({ url, body })
        const created: ClientBankAccount = {
          id: 2,
          bank: (body.bank as number | null) ?? null,
          bank_name: 'Test Bank',
          currency: body.currency as number,
          currency_code: 'AZN',
          iban: body.iban as string,
          swift_bic: (body.swift_bic as string | null) ?? null,
          is_default: (body.is_default as boolean) ?? false,
        }
        rows = [...rows, created]
        return Promise.resolve(jsonResponse(201, created))
      }
      return Promise.resolve(jsonResponse(200, clientDetail))
    })
    renderDetail()
    await screen.findByRole('heading', { name: 'Acme Ltd' })
    await screen.findByText(/AZ00TEST0000000000/)

    await user.click(screen.getByRole('button', { name: /^add bank account$/i }))
    const form = await screen.findByRole('form', { name: 'Add bank account' })
    await screen.findByRole('option', { name: 'Test Bank' })
    await screen.findByRole('option', { name: 'AZN' })

    await user.selectOptions(within(form).getByLabelText(/^bank$/i), '1')
    await user.selectOptions(within(form).getByLabelText(/currency/i), '1')
    await user.type(within(form).getByLabelText(/iban/i), 'AZ99NEW0000000001')
    await user.type(within(form).getByLabelText(/swift/i), 'NEWAAZ22')

    await user.click(within(form).getByRole('button', { name: /^add bank account$/i }))

    expect(await screen.findByText('Bank account added.')).toBeInTheDocument()
    expect(await screen.findByText(/AZ99NEW0000000001/)).toBeInTheDocument()
    expect(posts).toHaveLength(1)
    expect(posts[0].url).toBe('/api/clients/1/bank-accounts/')
    expect(posts[0].body).toEqual({
      bank: 1,
      currency: 1,
      iban: 'AZ99NEW0000000001',
      swift_bic: 'NEWAAZ22',
      is_default: false,
    })
    // No company scoping parameter is ever sent.
    expect(JSON.stringify(posts[0].body)).not.toContain('company_id')
  })

  it('sends a null bank when no bank is selected', async () => {
    const posts: unknown[] = []
    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      const method = init?.method ?? 'GET'
      if (url === '/api/reference-data/banks/') {
        return Promise.resolve(jsonResponse(200, banksFixture))
      }
      if (url === '/api/reference-data/currencies/') {
        return Promise.resolve(jsonResponse(200, currenciesFixture))
      }
      if (url === '/api/clients/1/bank-accounts/' && method === 'GET') {
        return Promise.resolve(jsonResponse(200, clientDetail.bank_accounts))
      }
      if (url === '/api/clients/1/bank-accounts/' && method === 'POST') {
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>
        posts.push(body)
        return Promise.resolve(jsonResponse(201, { ...clientDetail.bank_accounts[0], id: 2 }))
      }
      return Promise.resolve(jsonResponse(200, clientDetail))
    })
    renderDetail()
    await screen.findByRole('heading', { name: 'Acme Ltd' })
    await screen.findByText(/AZ00TEST0000000000/)

    await user.click(screen.getByRole('button', { name: /^add bank account$/i }))
    const form = await screen.findByRole('form', { name: 'Add bank account' })
    await screen.findByRole('option', { name: 'AZN' })

    // Bank stays on "No bank"; only the required currency + IBAN are set.
    await user.selectOptions(within(form).getByLabelText(/currency/i), '1')
    await user.type(within(form).getByLabelText(/iban/i), 'AZ99NOBANK0000001')
    await user.click(within(form).getByRole('button', { name: /^add bank account$/i }))

    expect(await screen.findByText('Bank account added.')).toBeInTheDocument()
    expect(posts).toHaveLength(1)
    expect(posts[0]).toMatchObject({ bank: null, currency: 1 })
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
      if (url === '/api/reference-data/banks/') {
        return Promise.resolve(jsonResponse(200, banksFixture))
      }
      if (url === '/api/reference-data/currencies/') {
        return Promise.resolve(jsonResponse(200, currenciesFixture))
      }
      if (url === '/api/clients/1/bank-accounts/' && method === 'GET') {
        return Promise.resolve(jsonResponse(200, clientDetail.bank_accounts))
      }
      if (url === '/api/clients/1/bank-accounts/' && method === 'POST') {
        postCount += 1
        return postPromise
      }
      return Promise.resolve(jsonResponse(200, clientDetail))
    })
    renderDetail()
    await screen.findByRole('heading', { name: 'Acme Ltd' })
    await screen.findByText(/AZ00TEST0000000000/)

    await user.click(screen.getByRole('button', { name: /^add bank account$/i }))
    const form = await screen.findByRole('form', { name: 'Add bank account' })
    await screen.findByRole('option', { name: 'AZN' })
    await user.selectOptions(within(form).getByLabelText(/currency/i), '1')
    await user.type(within(form).getByLabelText(/iban/i), 'AZ99NEW0000000001')

    const submit = within(form).getByRole('button', { name: /^add bank account$/i })
    await user.click(submit)
    await user.click(submit)

    resolvePost(jsonResponse(201, { ...clientDetail.bank_accounts[0], id: 2 }))
    expect(await screen.findByText('Bank account added.')).toBeInTheDocument()
    expect(postCount).toBe(1)
  })

  it('validates required fields locally without calling the API', async () => {
    stubBackend()
    renderDetail()
    await screen.findByRole('heading', { name: 'Acme Ltd' })
    await screen.findByText(/AZ00TEST0000000000/)

    await user.click(screen.getByRole('button', { name: /^add bank account$/i }))
    const form = await screen.findByRole('form', { name: 'Add bank account' })

    const callsBefore = fetchMock.mock.calls.length
    await user.click(within(form).getByRole('button', { name: /^add bank account$/i }))

    expect(await screen.findByText('Currency is required.')).toBeInTheDocument()
    expect(screen.getByText('IBAN is required.')).toBeInTheDocument()
    expect(fetchMock.mock.calls.length).toBe(callsBefore)
  })

  it('surfaces backend field validation errors inline', async () => {
    stubBackend({
      onWrite: (url, init) => {
        if (url === '/api/clients/1/bank-accounts/' && init.method === 'POST') {
          return jsonResponse(400, {
            iban: ['This IBAN is already in use for this client.'],
          })
        }
        return undefined
      },
    })
    renderDetail()
    await screen.findByRole('heading', { name: 'Acme Ltd' })
    await screen.findByText(/AZ00TEST0000000000/)

    await user.click(screen.getByRole('button', { name: /^add bank account$/i }))
    const form = await screen.findByRole('form', { name: 'Add bank account' })
    await screen.findByRole('option', { name: 'AZN' })
    await user.selectOptions(within(form).getByLabelText(/currency/i), '1')
    await user.type(within(form).getByLabelText(/iban/i), 'AZ00TEST0000000000')
    await user.click(within(form).getByRole('button', { name: /^add bank account$/i }))

    expect(
      await screen.findByText('This IBAN is already in use for this client.'),
    ).toBeInTheDocument()
    // The entered values are preserved.
    expect(screen.getByLabelText(/iban/i)).toHaveValue('AZ00TEST0000000000')
  })

  it('edits a bank account with pre-filled values and PATCHes the row', async () => {
    const patches: Array<{ url: string; body: unknown }> = []
    let rows: ClientBankAccount[] = [...clientDetail.bank_accounts]
    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      const method = init?.method ?? 'GET'
      if (url === '/api/reference-data/banks/') {
        return Promise.resolve(jsonResponse(200, banksFixture))
      }
      if (url === '/api/reference-data/currencies/') {
        return Promise.resolve(jsonResponse(200, currenciesFixture))
      }
      if (url === '/api/clients/1/bank-accounts/' && method === 'GET') {
        return Promise.resolve(jsonResponse(200, rows))
      }
      if (url === '/api/clients/1/bank-accounts/1/' && method === 'PATCH') {
        const body = JSON.parse(String(init?.body)) as Partial<ClientBankAccount>
        patches.push({ url, body })
        rows = rows.map((row) => ({ ...row, ...body }))
        return Promise.resolve(jsonResponse(200, rows[0]))
      }
      return Promise.resolve(jsonResponse(200, clientDetail))
    })
    renderDetail()
    await screen.findByRole('heading', { name: 'Acme Ltd' })
    await screen.findByText(/AZ00TEST0000000000/)

    const section = screen.getByRole('region', { name: 'Bank accounts' })
    await user.click(within(section).getByRole('button', { name: /^edit$/i }))
    const form = await screen.findByRole('form', { name: 'Edit bank account' })
    // Existing values are populated, including both catalog selects.
    expect(within(form).getByLabelText(/^bank$/i)).toHaveValue('1')
    expect(within(form).getByLabelText(/currency/i)).toHaveValue('1')
    expect(within(form).getByLabelText(/iban/i)).toHaveValue('AZ00TEST0000000000')
    expect(within(form).getByLabelText(/default account/i)).toBeChecked()

    await user.clear(within(form).getByLabelText(/iban/i))
    await user.type(within(form).getByLabelText(/iban/i), 'AZ99EDIT0000000001')
    await user.click(within(form).getByRole('button', { name: /save changes/i }))

    expect(await screen.findByText('Bank account updated.')).toBeInTheDocument()
    expect(await screen.findByText(/AZ99EDIT0000000001/)).toBeInTheDocument()
    expect(patches).toHaveLength(1)
    expect(patches[0].url).toBe('/api/clients/1/bank-accounts/1/')
    expect(patches[0].body).toMatchObject({ iban: 'AZ99EDIT0000000001' })
  })

  it('deletes a bank account only after confirmation and refreshes the list', async () => {
    let rows: ClientBankAccount[] = [...clientDetail.bank_accounts]
    const deletes: string[] = []
    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      const method = init?.method ?? 'GET'
      if (url === '/api/clients/1/bank-accounts/' && method === 'GET') {
        return Promise.resolve(jsonResponse(200, rows))
      }
      if (url === '/api/clients/1/bank-accounts/1/' && method === 'DELETE') {
        deletes.push(url)
        rows = []
        return Promise.resolve(new Response(null, { status: 204 }))
      }
      return Promise.resolve(jsonResponse(200, clientDetail))
    })
    renderDetail()
    await screen.findByRole('heading', { name: 'Acme Ltd' })
    await screen.findByText(/AZ00TEST0000000000/)

    const section = screen.getByRole('region', { name: 'Bank accounts' })
    await user.click(within(section).getByRole('button', { name: /^delete$/i }))
    expect(screen.getByText('Delete this bank account?')).toBeInTheDocument()
    expect(deletes).toHaveLength(0)

    await user.click(screen.getByRole('button', { name: /^cancel$/i }))
    expect(deletes).toHaveLength(0)
    expect(screen.queryByText('Delete this bank account?')).not.toBeInTheDocument()

    await user.click(within(section).getByRole('button', { name: /^delete$/i }))
    await user.click(screen.getByRole('button', { name: /yes, delete/i }))

    expect(await screen.findByText('Bank account deleted.')).toBeInTheDocument()
    expect(await screen.findByText('No bank accounts found.')).toBeInTheDocument()
    expect(deletes).toEqual(['/api/clients/1/bank-accounts/1/'])
  })

  it('shows a safe error when deleting fails', async () => {
    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      const method = init?.method ?? 'GET'
      if (url === '/api/clients/1/bank-accounts/' && method === 'GET') {
        return Promise.resolve(jsonResponse(200, clientDetail.bank_accounts))
      }
      if (url === '/api/clients/1/bank-accounts/1/' && method === 'DELETE') {
        return Promise.resolve(jsonResponse(403, { detail: 'No permission.' }))
      }
      return Promise.resolve(jsonResponse(200, clientDetail))
    })
    renderDetail()
    await screen.findByRole('heading', { name: 'Acme Ltd' })
    await screen.findByText(/AZ00TEST0000000000/)

    const section = screen.getByRole('region', { name: 'Bank accounts' })
    await user.click(within(section).getByRole('button', { name: /^delete$/i }))
    await user.click(screen.getByRole('button', { name: /yes, delete/i }))

    expect(
      await screen.findByText('You do not have permission to manage bank accounts.'),
    ).toBeInTheDocument()
    // The row is still there — nothing was deleted.
    expect(screen.getByText(/AZ00TEST0000000000/)).toBeInTheDocument()
  })

  it('shows retry actions when the bank or currency catalog fails to load', async () => {
    let banksCalls = 0
    fetchMock.mockImplementation((input: RequestInfo | URL) => {
      const url = String(input)
      if (url === '/api/clients/1/bank-accounts/') {
        return Promise.resolve(jsonResponse(200, clientDetail.bank_accounts))
      }
      if (url === '/api/reference-data/banks/') {
        banksCalls += 1
        if (banksCalls === 1) return Promise.resolve(jsonResponse(500, {}))
        return Promise.resolve(jsonResponse(200, banksFixture))
      }
      if (url === '/api/reference-data/currencies/') {
        return Promise.resolve(jsonResponse(200, currenciesFixture))
      }
      return Promise.resolve(jsonResponse(200, clientDetail))
    })
    renderDetail()
    await screen.findByRole('heading', { name: 'Acme Ltd' })
    await screen.findByText(/AZ00TEST0000000000/)

    await user.click(screen.getByRole('button', { name: /^add bank account$/i }))
    expect(await screen.findByText("Couldn't load banks.")).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /^retry$/i }))
    expect(await screen.findByRole('option', { name: 'Test Bank' })).toBeInTheDocument()
    expect(banksCalls).toBe(2)
  })
})

describe('ClientDetailPage contacts', () => {
  const user = userEvent.setup()

  beforeEach(() => {
    localStorage.clear()
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('renders existing contacts with their backend fields', async () => {
    stubBackend()
    renderDetail()

    await screen.findByRole('heading', { name: 'Acme Ltd' })
    await screen.findByText('Alice Manager')
    const section = screen.getByRole('region', { name: 'Contacts' })
    expect(within(section).getByText('Alice Manager')).toBeInTheDocument()
    expect(within(section).getByText(/CEO/)).toBeInTheDocument()
    expect(within(section).getByText(/alice@acme.az/)).toBeInTheDocument()
    expect(within(section).getByText(/\+994000000000/)).toBeInTheDocument()
    expect(within(section).getByText(/primary/)).toBeInTheDocument()
    expect(within(section).getByRole('button', { name: /^edit$/i })).toBeInTheDocument()
    expect(within(section).getByRole('button', { name: /^delete$/i })).toBeInTheDocument()
  })

  it('shows the section loading state once the client has loaded', async () => {
    let resolveContacts!: (response: Response) => void
    const contactsPromise = new Promise<Response>((resolve) => {
      resolveContacts = resolve
    })
    fetchMock.mockImplementation((input: RequestInfo | URL) => {
      const url = String(input)
      if (url === '/api/clients/1/contacts/') {
        return contactsPromise
      }
      if (url === '/api/clients/1/addresses/') {
        return Promise.resolve(jsonResponse(200, clientDetail.addresses))
      }
      return Promise.resolve(jsonResponse(200, clientDetail))
    })
    renderDetail()
    await screen.findByRole('heading', { name: 'Acme Ltd' })

    expect(screen.getByText('Loading contacts…')).toBeInTheDocument()
    expect(screen.queryByText('Alice Manager')).not.toBeInTheDocument()

    resolveContacts(jsonResponse(200, clientDetail.contacts))
    expect(await screen.findByText('Alice Manager')).toBeInTheDocument()
  })

  it('shows an empty state with an add action when the client has no contacts', async () => {
    stubBackend({ contactsBody: [] })
    renderDetail()

    await screen.findByRole('heading', { name: 'Acme Ltd' })
    expect(await screen.findByText('No contacts found.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^add contact$/i })).toBeInTheDocument()
  })

  it('shows an error state with retry when loading contacts fails', async () => {
    let contactCalls = 0
    fetchMock.mockImplementation((input: RequestInfo | URL) => {
      const url = String(input)
      if (url === '/api/clients/1/contacts/') {
        contactCalls += 1
        if (contactCalls === 1) return Promise.resolve(jsonResponse(500, {}))
        return Promise.resolve(jsonResponse(200, clientDetail.contacts))
      }
      if (url === '/api/clients/1/addresses/') {
        return Promise.resolve(jsonResponse(200, clientDetail.addresses))
      }
      return Promise.resolve(jsonResponse(200, clientDetail))
    })
    renderDetail()
    await screen.findByRole('heading', { name: 'Acme Ltd' })

    expect(await screen.findByText("Couldn't load contacts.")).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /retry/i }))
    expect(await screen.findByText('Alice Manager')).toBeInTheDocument()
    expect(contactCalls).toBe(2)
  })

  it('shows an access-denied state when the contact collection returns 403', async () => {
    fetchMock.mockImplementation((input: RequestInfo | URL) => {
      const url = String(input)
      if (url === '/api/clients/1/contacts/') {
        return Promise.resolve(jsonResponse(403, { detail: 'No permission.' }))
      }
      if (url === '/api/clients/1/addresses/') {
        return Promise.resolve(jsonResponse(200, clientDetail.addresses))
      }
      return Promise.resolve(jsonResponse(200, clientDetail))
    })
    renderDetail()
    await screen.findByRole('heading', { name: 'Acme Ltd' })

    expect(
      await screen.findByText('You do not have permission to view contacts.'),
    ).toBeInTheDocument()
  })

  it('creates a contact with the correct payload and refreshes the list', async () => {
    let rows: ClientContact[] = [...clientDetail.contacts]
    const posts: Array<{ url: string; body: unknown }> = []
    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      const method = init?.method ?? 'GET'
      if (url === '/api/clients/1/addresses/') {
        return Promise.resolve(jsonResponse(200, clientDetail.addresses))
      }
      if (url === '/api/clients/1/contacts/' && method === 'GET') {
        return Promise.resolve(jsonResponse(200, rows))
      }
      if (url === '/api/clients/1/contacts/' && method === 'POST') {
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>
        posts.push({ url, body })
        const created: ClientContact = {
          id: 2,
          full_name: body.full_name as string,
          position: (body.position as string | null) ?? null,
          phone: (body.phone as string | null) ?? null,
          email: (body.email as string | null) ?? null,
          is_primary: (body.is_primary as boolean) ?? false,
        }
        rows = [...rows, created]
        return Promise.resolve(jsonResponse(201, created))
      }
      return Promise.resolve(jsonResponse(200, clientDetail))
    })
    renderDetail()
    await screen.findByRole('heading', { name: 'Acme Ltd' })
    await screen.findByText('Alice Manager')

    await user.click(screen.getByRole('button', { name: /^add contact$/i }))
    const form = await screen.findByRole('form', { name: 'Add contact' })
    expect(
      within(form).getByLabelText(/full name/i),
    ).toBeInTheDocument()

    await user.type(within(form).getByLabelText(/full name/i), 'Bob Smith')
    await user.type(within(form).getByLabelText(/^position$/i), 'Driver')
    await user.type(within(form).getByLabelText(/^phone$/i), '+994551234567')
    await user.type(within(form).getByLabelText(/^email$/i), 'bob@example.com')

    await user.click(within(form).getByRole('button', { name: /^add contact$/i }))

    expect(await screen.findByText('Contact added.')).toBeInTheDocument()
    expect(await screen.findByText('Bob Smith')).toBeInTheDocument()
    expect(posts).toHaveLength(1)
    expect(posts[0].url).toBe('/api/clients/1/contacts/')
    expect(posts[0].body).toEqual({
      full_name: 'Bob Smith',
      position: 'Driver',
      phone: '+994551234567',
      email: 'bob@example.com',
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
      if (url === '/api/clients/1/addresses/') {
        return Promise.resolve(jsonResponse(200, clientDetail.addresses))
      }
      if (url === '/api/clients/1/contacts/' && method === 'GET') {
        return Promise.resolve(jsonResponse(200, clientDetail.contacts))
      }
      if (url === '/api/clients/1/contacts/' && method === 'POST') {
        postCount += 1
        return postPromise
      }
      return Promise.resolve(jsonResponse(200, clientDetail))
    })
    renderDetail()
    await screen.findByRole('heading', { name: 'Acme Ltd' })
    await screen.findByText('Alice Manager')

    await user.click(screen.getByRole('button', { name: /^add contact$/i }))
    const form = await screen.findByRole('form', { name: 'Add contact' })
    await user.type(within(form).getByLabelText(/full name/i), 'Bob Smith')

    const submit = within(form).getByRole('button', { name: /^add contact$/i })
    await user.click(submit)
    await user.click(submit)

    resolvePost(jsonResponse(201, { ...clientDetail.contacts[0], id: 2 }))
    expect(await screen.findByText('Contact added.')).toBeInTheDocument()
    expect(postCount).toBe(1)
  })

  it('validates required fields locally without calling the API', async () => {
    stubBackend()
    renderDetail()
    await screen.findByRole('heading', { name: 'Acme Ltd' })
    await screen.findByText('Alice Manager')

    await user.click(screen.getByRole('button', { name: /^add contact$/i }))
    const form = await screen.findByRole('form', { name: 'Add contact' })

    const callsBefore = fetchMock.mock.calls.length
    await user.click(within(form).getByRole('button', { name: /^add contact$/i }))

    expect(await screen.findByText('Full name is required.')).toBeInTheDocument()
    expect(fetchMock.mock.calls.length).toBe(callsBefore)
  })

  it('surfaces backend field validation errors inline', async () => {
    stubBackend({
      onWrite: (url, init) => {
        if (url === '/api/clients/1/contacts/' && init.method === 'POST') {
          return jsonResponse(400, {
            is_primary: ['This client already has a primary contact.'],
          })
        }
        return undefined
      },
    })
    renderDetail()
    await screen.findByRole('heading', { name: 'Acme Ltd' })
    await screen.findByText('Alice Manager')

    await user.click(screen.getByRole('button', { name: /^add contact$/i }))
    const form = await screen.findByRole('form', { name: 'Add contact' })
    await user.type(within(form).getByLabelText(/full name/i), 'Bob Smith')
    await user.click(within(form).getByLabelText(/primary contact/i))
    await user.click(within(form).getByRole('button', { name: /^add contact$/i }))

    expect(
      await screen.findByText('This client already has a primary contact.'),
    ).toBeInTheDocument()
    // The entered values are preserved.
    expect(screen.getByLabelText(/full name/i)).toHaveValue('Bob Smith')
  })

  it('edits a contact with pre-filled values and PATCHes the row', async () => {
    const patches: Array<{ url: string; body: unknown }> = []
    let rows: ClientContact[] = [...clientDetail.contacts]
    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      const method = init?.method ?? 'GET'
      if (url === '/api/clients/1/addresses/') {
        return Promise.resolve(jsonResponse(200, clientDetail.addresses))
      }
      if (url === '/api/clients/1/contacts/' && method === 'GET') {
        return Promise.resolve(jsonResponse(200, rows))
      }
      if (url === '/api/clients/1/contacts/1/' && method === 'PATCH') {
        const body = JSON.parse(String(init?.body)) as Partial<ClientContact>
        patches.push({ url, body })
        rows = rows.map((row) => ({ ...row, ...body }))
        return Promise.resolve(jsonResponse(200, rows[0]))
      }
      return Promise.resolve(jsonResponse(200, clientDetail))
    })
    renderDetail()
    await screen.findByRole('heading', { name: 'Acme Ltd' })
    await screen.findByText('Alice Manager')

    const section = screen.getByRole('region', { name: 'Contacts' })
    await user.click(within(section).getByRole('button', { name: /^edit$/i }))
    const form = await screen.findByRole('form', { name: 'Edit contact' })
    // Existing values are populated.
    expect(within(form).getByLabelText(/full name/i)).toHaveValue('Alice Manager')
    expect(within(form).getByLabelText(/^position$/i)).toHaveValue('CEO')
    expect(within(form).getByLabelText(/^email$/i)).toHaveValue('alice@acme.az')
    expect(within(form).getByLabelText(/primary contact/i)).toBeChecked()

    await user.clear(within(form).getByLabelText(/^position$/i))
    await user.type(within(form).getByLabelText(/^position$/i), 'CTO')
    await user.click(within(form).getByRole('button', { name: /save changes/i }))

    expect(await screen.findByText('Contact updated.')).toBeInTheDocument()
    expect(await screen.findByText(/CTO/)).toBeInTheDocument()
    expect(patches).toHaveLength(1)
    expect(patches[0].url).toBe('/api/clients/1/contacts/1/')
    expect(patches[0].body).toMatchObject({ position: 'CTO' })
  })

  it('deletes a contact only after confirmation and refreshes the list', async () => {
    let rows: ClientContact[] = [...clientDetail.contacts]
    const deletes: string[] = []
    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      const method = init?.method ?? 'GET'
      if (url === '/api/clients/1/addresses/') {
        return Promise.resolve(jsonResponse(200, clientDetail.addresses))
      }
      if (url === '/api/clients/1/contacts/' && method === 'GET') {
        return Promise.resolve(jsonResponse(200, rows))
      }
      if (url === '/api/clients/1/contacts/1/' && method === 'DELETE') {
        deletes.push(url)
        rows = []
        return Promise.resolve(new Response(null, { status: 204 }))
      }
      return Promise.resolve(jsonResponse(200, clientDetail))
    })
    renderDetail()
    await screen.findByRole('heading', { name: 'Acme Ltd' })
    await screen.findByText('Alice Manager')

    const section = screen.getByRole('region', { name: 'Contacts' })
    await user.click(within(section).getByRole('button', { name: /^delete$/i }))
    expect(screen.getByText('Delete this contact?')).toBeInTheDocument()
    expect(deletes).toHaveLength(0)

    await user.click(screen.getByRole('button', { name: /^cancel$/i }))
    expect(deletes).toHaveLength(0)
    expect(screen.queryByText('Delete this contact?')).not.toBeInTheDocument()

    await user.click(within(section).getByRole('button', { name: /^delete$/i }))
    await user.click(screen.getByRole('button', { name: /yes, delete/i }))

    expect(await screen.findByText('Contact deleted.')).toBeInTheDocument()
    expect(await screen.findByText('No contacts found.')).toBeInTheDocument()
    expect(deletes).toEqual(['/api/clients/1/contacts/1/'])
  })

  it('shows a safe error when deleting fails', async () => {
    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      const method = init?.method ?? 'GET'
      if (url === '/api/clients/1/addresses/') {
        return Promise.resolve(jsonResponse(200, clientDetail.addresses))
      }
      if (url === '/api/clients/1/contacts/' && method === 'GET') {
        return Promise.resolve(jsonResponse(200, clientDetail.contacts))
      }
      if (url === '/api/clients/1/contacts/1/' && method === 'DELETE') {
        return Promise.resolve(jsonResponse(403, { detail: 'No permission.' }))
      }
      return Promise.resolve(jsonResponse(200, clientDetail))
    })
    renderDetail()
    await screen.findByRole('heading', { name: 'Acme Ltd' })
    await screen.findByText('Alice Manager')

    const section = screen.getByRole('region', { name: 'Contacts' })
    await user.click(within(section).getByRole('button', { name: /^delete$/i }))
    await user.click(screen.getByRole('button', { name: /yes, delete/i }))

    expect(
      await screen.findByText('You do not have permission to manage contacts.'),
    ).toBeInTheDocument()
    // The row is still there — nothing was deleted.
    expect(screen.getByText('Alice Manager')).toBeInTheDocument()
  })
})
