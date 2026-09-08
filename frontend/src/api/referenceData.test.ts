import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fetchAddressTypes, fetchBanks, fetchCurrencies, fetchDocumentTypes } from './referenceData'
import { documentTypes, jsonResponse } from '../test/templateFixtures'

const currencies = [
  { id: 1, code: 'AZN', name: 'Azerbaijani Manat', minor_unit: 2 },
  { id: 2, code: 'USD', name: 'US Dollar', minor_unit: 2 },
]

const addressTypes = [
  { id: 1, code: 'legal' },
  { id: 2, code: 'business' },
  { id: 3, code: 'residential' },
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

  it('fetches address types from the address-type catalog endpoint', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, addressTypes))

    const result = await fetchAddressTypes()

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/reference-data/address-types/')
    expect(init.method).toBe('GET')
    expect(result).toEqual(addressTypes)
  })

  it('fetches banks from the bank catalog endpoint', async () => {
    const banks = [{ id: 1, name: 'Test Bank', swift_code: 'TESTAZ22', is_active: true }]
    fetchMock.mockResolvedValue(jsonResponse(200, banks))

    const result = await fetchBanks()

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/reference-data/banks/')
    expect(init.method).toBe('GET')
    expect(result).toEqual(banks)
  })
})