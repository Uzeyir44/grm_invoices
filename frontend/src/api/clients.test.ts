import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createClient,
  deleteClient,
  getClient,
  listClients,
  updateClient,
} from './clients'
import { clientDetail, clientSummaries, jsonResponse } from '../test/clientFixtures'

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
})