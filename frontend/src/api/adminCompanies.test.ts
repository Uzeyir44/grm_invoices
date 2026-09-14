import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  activateAdminCompany,
  deactivateAdminCompany,
  getAdminCompany,
  listAdminCompanies,
  provisionAdminCompany,
  updateAdminCompany,
} from './adminCompanies'
import { adminCompany, jsonResponse } from '../test/adminFixtures'
import { setAdminAccessToken } from '../utils/adminAuthStorage'
import { getAccessToken, setAccessToken } from '../utils/authStorage'

const PROVISION_INPUT = {
  legal_name: 'Acme LLC',
  display_name: 'Acme',
  voen: '1234567890',
  registration_number: null,
  default_language: 'az',
  default_timezone: 'Asia/Baku',
  admin_email: 'owner@acme.example',
  admin_first_name: 'Owner',
  admin_last_name: 'One',
  admin_password: 'Str0ng-pass-123!',
}

describe('adminCompanies API slice', () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    localStorage.clear()
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  function withAdminToken() {
    setAdminAccessToken('admin-token')
  }

  it('lists companies with the admin bearer token', async () => {
    withAdminToken()
    fetchMock.mockResolvedValueOnce(jsonResponse(200, [adminCompany()]))

    const companies = await listAdminCompanies()
    expect(companies).toHaveLength(1)

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/admin/companies/')
    expect(new Headers(init.headers).get('Authorization')).toBe('Bearer admin-token')
  })

  it('retrieves a company detail', async () => {
    withAdminToken()
    fetchMock.mockResolvedValueOnce(jsonResponse(200, adminCompany({ id: 7 })))

    const company = await getAdminCompany(7)
    expect(company.id).toBe(7)

    const [url] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/admin/companies/7/')
  })

  it('provisions a company', async () => {
    withAdminToken()
    fetchMock.mockResolvedValueOnce(jsonResponse(201, adminCompany({ id: 9 })))

    const company = await provisionAdminCompany(PROVISION_INPUT)
    expect(company.id).toBe(9)

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/admin/companies/provision/')
    expect(init.method).toBe('POST')
    expect(JSON.parse(String(init.body))).toEqual(PROVISION_INPUT)
  })

  it('updates a company via PATCH', async () => {
    withAdminToken()
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, adminCompany({ display_name: 'Renamed' })),
    )

    await updateAdminCompany(5, { display_name: 'Renamed' })

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/admin/companies/5/')
    expect(init.method).toBe('PATCH')
    expect(JSON.parse(String(init.body))).toEqual({ display_name: 'Renamed' })
  })

  it('activates and deactivates a company', async () => {
    withAdminToken()
    fetchMock
      .mockResolvedValueOnce(jsonResponse(200, adminCompany({ status: 'active' })))
      .mockResolvedValueOnce(
        jsonResponse(200, adminCompany({ status: 'suspended' })),
      )

    const activated = await activateAdminCompany(5)
    expect(activated.status).toBe('active')
    expect((fetchMock.mock.calls[0] as [string])[0]).toBe(
      '/api/admin/companies/5/activate/',
    )

    const deactivated = await deactivateAdminCompany(5)
    expect(deactivated.status).toBe('suspended')
    expect((fetchMock.mock.calls[1] as [string])[0]).toBe(
      '/api/admin/companies/5/deactivate/',
    )
  })

  it('surfaces backend errors as a typed ApiError', async () => {
    withAdminToken()
    fetchMock.mockResolvedValueOnce(jsonResponse(403, { detail: 'Forbidden.' }))

    await expect(listAdminCompanies()).rejects.toMatchObject({ status: 403 })
  })

  it('does not disturb or use the company token', async () => {
    setAccessToken('company-token')
    withAdminToken()
    fetchMock.mockResolvedValueOnce(jsonResponse(200, []))

    await listAdminCompanies()

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(new Headers(init.headers).get('Authorization')).toBe('Bearer admin-token')
    expect(getAccessToken()).toBe('company-token')
  })
})
