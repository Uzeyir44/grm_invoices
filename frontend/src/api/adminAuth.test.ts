import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { adminLogin, adminRefresh, getAdminMe } from './adminAuth'
import { onAdminUnauthorized } from './adminClient'
import { adminMe, jsonResponse } from '../test/adminFixtures'
import {
  getAdminAccessToken,
  getAdminRefreshToken,
  setAdminAccessToken,
  setAdminRefreshToken,
} from '../utils/adminAuthStorage'
import {
  getAccessToken,
  getRefreshToken,
  setAccessToken,
  setRefreshToken,
} from '../utils/authStorage'

describe('adminAuth API slice', () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    localStorage.clear()
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('logs in through the admin endpoint and stores only admin tokens', async () => {
    setAccessToken('company-access')
    setRefreshToken('company-refresh')

    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, { access: 'admin-access', refresh: 'admin-refresh' }),
    )

    const tokens = await adminLogin('admin@grm.example', 'secret')
    expect(tokens).toEqual({ access: 'admin-access', refresh: 'admin-refresh' })

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/admin/authentication/token/')
    expect(JSON.parse(String(init.body))).toEqual({
      email: 'admin@grm.example',
      password: 'secret',
    })
    // Public endpoint: no bearer token is attached.
    expect(new Headers(init.headers).get('Authorization')).toBeNull()

    expect(getAdminAccessToken()).toBe('admin-access')
    expect(getAdminRefreshToken()).toBe('admin-refresh')
    // Company tokens are untouched.
    expect(getAccessToken()).toBe('company-access')
    expect(getRefreshToken()).toBe('company-refresh')
  })

  it('loads /me with the admin bearer token, never the company token', async () => {
    setAccessToken('company-token')
    setAdminAccessToken('admin-token')
    fetchMock.mockResolvedValueOnce(jsonResponse(200, adminMe()))

    const me = await getAdminMe()
    expect(me.email).toBe('admin@grm.example')

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/admin/authentication/me/')
    expect(new Headers(init.headers).get('Authorization')).toBe('Bearer admin-token')
  })

  it('refreshes via the admin refresh endpoint and stores the new access token', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { access: 'fresh' }))

    await adminRefresh('refresh-1')

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/admin/authentication/token/refresh/')
    expect(JSON.parse(String(init.body))).toEqual({ refresh: 'refresh-1' })
    expect(getAdminAccessToken()).toBe('fresh')
  })

  it('recovers from a 401 with one admin refresh + retry (no unauthorized notify)', async () => {
    setAdminAccessToken('expired')
    setAdminRefreshToken('refresh-1')
    fetchMock
      .mockResolvedValueOnce(jsonResponse(401, { detail: 'expired' }))
      .mockResolvedValueOnce(jsonResponse(200, { access: 'fresh' }))
      .mockResolvedValueOnce(jsonResponse(200, adminMe()))

    let unauthorized = 0
    const unsubscribe = onAdminUnauthorized(() => {
      unauthorized += 1
    })

    const me = await getAdminMe()
    expect(me.email).toBe('admin@grm.example')
    expect(getAdminAccessToken()).toBe('fresh')
    expect(unauthorized).toBe(0)
    unsubscribe()
  })

  it('clears admin tokens and notifies on an unrecoverable 401, leaving company tokens intact', async () => {
    setAccessToken('company-token')
    setRefreshToken('company-refresh')
    setAdminAccessToken('expired')
    setAdminRefreshToken('refresh-1')
    fetchMock
      .mockResolvedValueOnce(jsonResponse(401, { detail: 'expired' }))
      .mockResolvedValueOnce(jsonResponse(401, { detail: 'invalid refresh' }))

    let unauthorized = 0
    const unsubscribe = onAdminUnauthorized(() => {
      unauthorized += 1
    })

    await expect(getAdminMe()).rejects.toMatchObject({ status: 401 })

    expect(getAdminAccessToken()).toBeNull()
    expect(getAdminRefreshToken()).toBeNull()
    expect(unauthorized).toBe(1)
    // Company session is not disturbed by an admin auth failure.
    expect(getAccessToken()).toBe('company-token')
    expect(getRefreshToken()).toBe('company-refresh')
    unsubscribe()
  })

  it('never attaches a company token to an admin request', async () => {
    setAccessToken('company-token')
    fetchMock.mockResolvedValueOnce(jsonResponse(200, adminMe()))

    await getAdminMe()

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(new Headers(init.headers).get('Authorization')).toBeNull()
  })
})
