import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  activateAdminBank,
  createAdminCurrency,
  deactivateAdminBank,
  deleteAdminCurrency,
  listAdminAddressTypes,
  listAdminBanks,
  listAdminCurrencies,
  listAdminDocumentTypes,
  listAdminExchangeRates,
  listAdminVatRates,
  updateAdminCurrency,
} from './adminReferenceData'
import { jsonResponse } from '../test/adminFixtures'
import { setAdminAccessToken } from '../utils/adminAuthStorage'

describe('adminReferenceData API slice', () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    localStorage.clear()
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
    setAdminAccessToken('admin-token')
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('lists each catalog with the admin bearer token', async () => {
    const catalogs: Array<[() => Promise<unknown>, string]> = [
      [listAdminCurrencies, '/api/admin/reference-data/currencies/'],
      [listAdminDocumentTypes, '/api/admin/reference-data/document-types/'],
      [listAdminAddressTypes, '/api/admin/reference-data/address-types/'],
      [listAdminVatRates, '/api/admin/reference-data/vat-rates/'],
      [listAdminBanks, '/api/admin/reference-data/banks/'],
      [listAdminExchangeRates, '/api/admin/reference-data/exchange-rates/'],
    ]
    for (const [fn, url] of catalogs) {
      fetchMock.mockResolvedValueOnce(jsonResponse(200, []))
      await fn()
      const [calledUrl, init] = fetchMock.mock.calls.at(-1) as [string, RequestInit]
      expect(calledUrl).toBe(url)
      expect(new Headers(init.headers).get('Authorization')).toBe('Bearer admin-token')
    }
  })

  it('creates a currency', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(201, { id: 4 }))
    await createAdminCurrency({ code: 'GBP', name: 'Pound', minor_unit: 2 })
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/admin/reference-data/currencies/')
    expect(init.method).toBe('POST')
    expect(JSON.parse(String(init.body))).toEqual({
      code: 'GBP',
      name: 'Pound',
      minor_unit: 2,
    })
  })

  it('updates and deletes a currency', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(200, { id: 4 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))

    await updateAdminCurrency(4, { name: 'Pound Sterling' })
    expect((fetchMock.mock.calls[0] as [string, RequestInit])[0]).toBe(
      '/api/admin/reference-data/currencies/4/',
    )
    expect((fetchMock.mock.calls[0] as [string, RequestInit])[1].method).toBe('PATCH')

    await deleteAdminCurrency(4)
    expect((fetchMock.mock.calls[1] as [string, RequestInit])[0]).toBe(
      '/api/admin/reference-data/currencies/4/',
    )
    expect((fetchMock.mock.calls[1] as [string, RequestInit])[1].method).toBe('DELETE')
  })

  it('activates and deactivates a bank', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(200, { id: 2, is_active: false }))
      .mockResolvedValueOnce(jsonResponse(200, { id: 2, is_active: true }))

    await deactivateAdminBank(2)
    expect((fetchMock.mock.calls[0] as [string, RequestInit])[0]).toBe(
      '/api/admin/reference-data/banks/2/deactivate/',
    )
    await activateAdminBank(2)
    expect((fetchMock.mock.calls[1] as [string, RequestInit])[0]).toBe(
      '/api/admin/reference-data/banks/2/activate/',
    )
  })

  it('surfaces backend errors as a typed ApiError', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(403, { detail: 'Forbidden.' }))
    await expect(listAdminCurrencies()).rejects.toMatchObject({ status: 403 })
  })
})
