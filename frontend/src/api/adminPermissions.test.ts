import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { listAdminPermissions } from './adminPermissions'
import { adminPermission, jsonResponse } from '../test/adminFixtures'
import { setAdminAccessToken } from '../utils/adminAuthStorage'

describe('adminPermissions API slice', () => {
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

  it('lists permissions with the admin bearer token', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, [adminPermission({ scope: 'system', code: 'system.users.manage' })]),
    )

    const permissions = await listAdminPermissions()
    expect(permissions).toHaveLength(1)

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/admin/permissions/')
    expect(new Headers(init.headers).get('Authorization')).toBe('Bearer admin-token')
  })

  it('passes the scope query parameter', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, []))
    await listAdminPermissions({ scope: 'system' })
    expect((fetchMock.mock.calls[0] as [string])[0]).toBe(
      '/api/admin/permissions/?scope=system',
    )
  })

  it('surfaces backend errors as a typed ApiError', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(403, { detail: 'Forbidden.' }))
    await expect(listAdminPermissions()).rejects.toMatchObject({ status: 403 })
  })
})
