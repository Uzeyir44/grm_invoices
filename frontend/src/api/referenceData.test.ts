import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fetchCurrencies, fetchDocumentTypes } from './referenceData'
import { documentTypes, jsonResponse } from '../test/templateFixtures'

const currencies = [
  { id: 1, code: 'AZN', name: 'Azerbaijani Manat', minor_unit: 2 },
  { id: 2, code: 'USD', name: 'US Dollar', minor_unit: 2 },
]

describe('referenceData API', () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    localStorage.clear()
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('fetches document types from the document-type catalog endpoint', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, documentTypes))

    const result = await fetchDocumentTypes()

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/reference-data/document-types/')
    expect(init.method).toBe('GET')
    expect(result).toEqual(documentTypes)
  })

  it('fetches currencies from the currency catalog endpoint', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, currencies))

    const result = await fetchCurrencies()

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/reference-data/currencies/')
    expect(init.method).toBe('GET')
    expect(result).toEqual(currencies)
  })
})