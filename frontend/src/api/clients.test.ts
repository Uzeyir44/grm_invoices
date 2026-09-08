import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createClient,
  createClientAddress,
  deleteClient,
  deleteClientAddress,
  getClient,
  listClientAddresses,
  listClients,
  updateClient,
  updateClientAddress,
} from './clients'
import { clientDetail, clientSummaries, jsonResponse } from '../test/clientFixtures'
import { ApiError, HTTP_STATUS } from '../types/api'
import { setAccessToken } from '../utils/authStorage'

describe('clients API', () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    localStorage.clear()
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('lists clients with the correct endpoint and no params', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, clientSummaries))

    const result = await listClients()

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/clients/')
    expect(init.method).toBe('GET')
    expect(result).toEqual(clientSummaries)
  })

  it('builds backend-supported query parameters for the list endpoint', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, clientSummaries))

    await listClients({ search: 'acme', status: 'active', client_type: 'legal_entity' })

    const [url] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toContain('/api/clients/?')
    expect(url).toContain('search=acme')
    expect(url).toContain('status=active')
    expect(url).toContain('client_type=legal_entity')
  })

  it('omits empty query parameters', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, []))

    await listClients({ search: '', status: undefined, client_type: undefined })

    const [url] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/clients/')
  })

  it('fetches a single client from the detail endpoint', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, clientDetail))

    const result = await getClient(1)

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/clients/1/')
    expect(init.method).toBe('GET')
    expect(result).toEqual(clientDetail)
  })

  it('creates a client with the create serializer body', async () => {
    fetchMock.mockResolvedValue(jsonResponse(201, clientDetail))

    const body = {
      client_type: 'legal_entity' as const,
      status: 'active' as const,
      legal_entity: { legal_name: 'Acme Ltd', voen: '1234567890' },
    }
    const result = await createClient(body)

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/clients/')
    expect(init.method).toBe('POST')
    expect(JSON.parse(String(init.body))).toEqual(body)
    expect(result).toEqual(clientDetail)
  })

  it('updates a client with PATCH and a partial body', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, clientDetail))

    const result = await updateClient(1, { status: 'inactive' })

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/clients/1/')
    expect(init.method).toBe('PATCH')
    expect(JSON.parse(String(init.body))).toEqual({ status: 'inactive' })
    expect(result).toEqual(clientDetail)
  })

  it('deletes (soft-deletes) a client via DELETE and resolves on 204', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }))

    await expect(deleteClient(1)).resolves.toBeUndefined()

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/clients/1/')
    expect(init.method).toBe('DELETE')
  })

  it('lists a client addresses from the nested collection endpoint', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, clientDetail.addresses))
    setAccessToken('token-1')

    const result = await listClientAddresses(1)

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/clients/1/addresses/')
    expect(init.method).toBe('GET')
    expect(new Headers(init.headers).get('Authorization')).toBe('Bearer token-1')
    expect(result).toEqual(clientDetail.addresses)
  })

  it('creates an address with the nested serializer body', async () => {
    fetchMock.mockResolvedValue(jsonResponse(201, clientDetail.addresses[0]))

    const body = {
      address_type: 1,
      line1: 'Main St 1',
      city: 'Baku',
      country_code: 'AZ',
      is_primary: true,
    }
    const result = await createClientAddress(1, body)

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/clients/1/addresses/')
    expect(init.method).toBe('POST')
    expect(JSON.parse(String(init.body))).toEqual(body)
    expect(result).toEqual(clientDetail.addresses[0])
  })

  it('never sends a company_id in the address payload', async () => {
    fetchMock.mockResolvedValue(jsonResponse(201, clientDetail.addresses[0]))

    await createClientAddress(1, { address_type: 1, line1: 'Main St 1' })

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    const body = JSON.parse(String(init.body)) as Record<string, unknown>
    expect(body.company_id).toBeUndefined()
    expect(body.company).toBeUndefined()
    expect(body.client).toBeUndefined()
  })

  it('updates an address with PATCH and a partial body', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, clientDetail.addresses[0]))

    const result = await updateClientAddress(1, 7, { line1: 'New St 2' })

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/clients/1/addresses/7/')
    expect(init.method).toBe('PATCH')
    expect(JSON.parse(String(init.body))).toEqual({ line1: 'New St 2' })
    expect(result).toEqual(clientDetail.addresses[0])
  })

  it('deletes an address via DELETE and resolves on 204', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }))

    await expect(deleteClientAddress(1, 7)).resolves.toBeUndefined()

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/clients/1/addresses/7/')
    expect(init.method).toBe('DELETE')
  })

  it('preserves backend address field validation errors', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(400, { is_primary: ['This client already has a primary address.'] }),
    )

    const error = await createClientAddress(1, {
      address_type: 1,
      line1: 'Main St 1',
      is_primary: true,
    }).catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(ApiError)
    expect((error as ApiError).status).toBe(HTTP_STATUS.BAD_REQUEST)
    expect((error as ApiError).fieldErrors.is_primary).toEqual([
      'This client already has a primary address.',
    ])
  })

  it('converts an address 403 into a typed ApiError', async () => {
    fetchMock.mockResolvedValue(jsonResponse(403, { detail: 'No permission.' }))

    await expect(listClientAddresses(1)).rejects.toMatchObject({
      status: HTTP_STATUS.FORBIDDEN,
    })
    await expect(listClientAddresses(1)).rejects.toBeInstanceOf(ApiError)
  })

  it('converts an address 404 into a typed ApiError', async () => {
    fetchMock.mockResolvedValue(jsonResponse(404, { detail: 'Not found.' }))

    await expect(deleteClientAddress(1, 999)).rejects.toMatchObject({
      status: HTTP_STATUS.NOT_FOUND,
    })
  })
})