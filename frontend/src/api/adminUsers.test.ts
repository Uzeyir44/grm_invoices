import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  activateAdminUser,
  assignAdminUserRole,
  deactivateAdminUser,
  getAdminUser,
  listAdminUserRoles,
  listAdminUsers,
  removeAdminUserRole,
  updateAdminUser,
} from './adminUsers'
import { adminUser, adminUserDetail, jsonResponse } from '../test/adminFixtures'
import { setAdminAccessToken } from '../utils/adminAuthStorage'

describe('adminUsers API slice', () => {
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

  it('lists users with the admin bearer token', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, [adminUser()]))

    const users = await listAdminUsers()
    expect(users).toHaveLength(1)

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/admin/users/')
    expect(new Headers(init.headers).get('Authorization')).toBe('Bearer admin-token')
  })

  it('retrieves a user detail', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, adminUserDetail({ id: 7 })))
    const user = await getAdminUser(7)
    expect(user.id).toBe(7)
    expect((fetchMock.mock.calls[0] as [string])[0]).toBe('/api/admin/users/7/')
  })

  it('updates a user via PATCH', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, adminUserDetail({ first_name: 'Alicia' })),
    )
    await updateAdminUser(7, { first_name: 'Alicia' })

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/admin/users/7/')
    expect(init.method).toBe('PATCH')
    expect(JSON.parse(String(init.body))).toEqual({ first_name: 'Alicia' })
  })

  it('activates and deactivates a user', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(200, adminUserDetail({ is_active: true })))
      .mockResolvedValueOnce(
        jsonResponse(200, adminUserDetail({ is_active: false })),
      )

    expect((await activateAdminUser(7)).is_active).toBe(true)
    expect((fetchMock.mock.calls[0] as [string])[0]).toBe(
      '/api/admin/users/7/activate/',
    )
    expect((await deactivateAdminUser(7)).is_active).toBe(false)
    expect((fetchMock.mock.calls[1] as [string])[0]).toBe(
      '/api/admin/users/7/deactivate/',
    )
  })

  it('lists, assigns, and removes roles', async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse(200, [{ id: 1, name: 'Manager A', scope: 'tenant' }]),
      )
      .mockResolvedValueOnce(
        jsonResponse(201, { id: 2, name: 'Viewer A', scope: 'tenant' }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }))

    const roles = await listAdminUserRoles(7)
    expect(roles).toHaveLength(1)
    expect((fetchMock.mock.calls[0] as [string])[0]).toBe('/api/admin/users/7/roles/')

    await assignAdminUserRole(7, 2)
    const [, assignInit] = fetchMock.mock.calls[1] as [string, RequestInit]
    expect(JSON.parse(String(assignInit.body))).toEqual({ role_id: 2 })

    await removeAdminUserRole(7, 2)
    const [removeUrl, removeInit] = fetchMock.mock.calls[2] as [string, RequestInit]
    expect(removeUrl).toBe('/api/admin/users/7/roles/2/')
    expect(removeInit.method).toBe('DELETE')
  })

  it('surfaces backend errors as a typed ApiError', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(403, { detail: 'Forbidden.' }))
    await expect(listAdminUsers()).rejects.toMatchObject({ status: 403 })
  })
})
