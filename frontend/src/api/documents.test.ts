import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fetchGeneratedDocuments, listGeneratedDocuments } from './documents'
import { generatedDocuments, jsonResponse } from '../test/documentFixtures'
import { ApiError, HTTP_STATUS } from '../types/api'
import { setAccessToken } from '../utils/authStorage'

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
})