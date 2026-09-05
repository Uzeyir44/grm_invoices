import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createGeneratedDocument,
  fetchGeneratedDocuments,
  getGeneratedDocument,
  listGeneratedDocuments,
} from './documents'
import { generatedDocuments, jsonResponse } from '../test/documentFixtures'
import { ApiError, HTTP_STATUS } from '../types/api'
import { setAccessToken } from '../utils/authStorage'
import type { CreateGeneratedDocumentInput } from '../types/generatedDocument'

describe('documents API', () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    localStorage.clear()
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('lists generated documents from the endpoint with no parameters', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, generatedDocuments))
    setAccessToken('token-1')

    const result = await listGeneratedDocuments()

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/generated-documents/')
    expect(init.method).toBe('GET')
    expect(new Headers(init.headers).get('Authorization')).toBe('Bearer token-1')
    expect(result).toEqual(generatedDocuments)
  })

  it('sends no query parameters for the list', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, []))

    await listGeneratedDocuments()

    const [url] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url.includes('?')).toBe(false)
  })

  it('keeps fetchGeneratedDocuments as a compatible alias for the dashboard', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, generatedDocuments))

    const result = await fetchGeneratedDocuments()

    expect(String(fetchMock.mock.calls[0][0])).toBe('/api/generated-documents/')
    expect(result).toEqual(generatedDocuments)
  })

  it('converts a failed request into a typed ApiError', async () => {
    fetchMock.mockResolvedValue(jsonResponse(403, { detail: 'Missing required permission: generated_documents.read' }))

    await expect(listGeneratedDocuments()).rejects.toMatchObject({
      status: HTTP_STATUS.FORBIDDEN,
    })
    await expect(listGeneratedDocuments()).rejects.toBeInstanceOf(ApiError)
  })

  it('creates a document with the create serializer body', async () => {
    fetchMock.mockResolvedValue(jsonResponse(201, generatedDocuments[0]))

    const body: CreateGeneratedDocumentInput = {
      client_id: 1,
      document_type_id: 2,
      currency_id: 1,
      items: [
        {
          description: 'Consulting hours',
          quantity: 10,
          unit_price: 100,
          vat_rate_percent: 18,
          unit: 'hour',
          discount_percent: 0,
        },
      ],
    }
    const result = await createGeneratedDocument(body)

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/generated-documents/')
    expect(init.method).toBe('POST')
    expect(JSON.parse(String(init.body))).toEqual(body)
    expect(result).toEqual(generatedDocuments[0])
  })

  it('never sends a company_id in the create payload', async () => {
    fetchMock.mockResolvedValue(jsonResponse(201, generatedDocuments[0]))

    await createGeneratedDocument({
      client_id: 1,
      document_type_id: 2,
      currency_id: 1,
      items: [],
    })

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    const body = JSON.parse(String(init.body)) as Record<string, unknown>
    expect(body.company_id).toBeUndefined()
    expect(body.company).toBeUndefined()
  })

  it('preserves backend field validation errors on the create endpoint', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(400, {
        client_id: ['This field is required.'],
        items: [{ quantity: ['A valid number is required.'] }],
      }),
    )

    const error = await createGeneratedDocument({
      client_id: 0,
      document_type_id: 2,
      currency_id: 1,
      items: [],
    }).catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(ApiError)
    const apiError = error as ApiError
    expect(apiError.status).toBe(HTTP_STATUS.BAD_REQUEST)
    expect(apiError.fieldErrors.client_id).toEqual(['This field is required.'])
    expect(apiError.fieldErrors['items.0.quantity']).toEqual(['A valid number is required.'])
  })

  it('fetches a single document from the detail endpoint', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, generatedDocuments[0]))
    setAccessToken('token-1')

    const result = await getGeneratedDocument(9)

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/generated-documents/9/')
    expect(init.method).toBe('GET')
    expect(new Headers(init.headers).get('Authorization')).toBe('Bearer token-1')
    expect(result).toEqual(generatedDocuments[0])
  })

  it('converts a 404 detail response into a typed ApiError', async () => {
    fetchMock.mockResolvedValue(jsonResponse(404, { detail: 'No GeneratedDocument matches the given query.' }))

    await expect(getGeneratedDocument(999)).rejects.toMatchObject({
      status: HTTP_STATUS.NOT_FOUND,
    })
    await expect(getGeneratedDocument(999)).rejects.toBeInstanceOf(ApiError)
  })
})