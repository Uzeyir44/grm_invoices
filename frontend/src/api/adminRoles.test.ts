import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  assignAdminRolePermission,
  createAdminRole,
  getAdminRole,
  listAdminRolePermissions,
  listAdminRoles,
  removeAdminRolePermission,
  updateAdminRole,
} from './adminRoles'
import { adminPermission, adminRoleDetail, adminRoleListItem, jsonResponse } from '../test/adminFixtures'
import { setAdminAccessToken } from '../utils/adminAuthStorage'

describe('adminRoles API slice', () => {
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

  it('lists roles with filters', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, [adminRoleListItem()]))
    const roles = await listAdminRoles({ scope: 'tenant', company_id: 5 })
    expect(roles).toHaveLength(1)
    expect((fetchMock.mock.calls[0] as [string])[0]).toBe(
      '/api/admin/roles/?scope=tenant&company_id=5',
    )
  })

  it('retrieves a role detail', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, adminRoleDetail({ id: 3 })))
    const role = await getAdminRole(3)
    expect(role.id).toBe(3)
    expect((fetchMock.mock.calls[0] as [string])[0]).toBe('/api/admin/roles/3/')
  })

  it('creates a tenant role', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(201, adminRoleDetail({ id: 9 })))
    const role = await createAdminRole({ company_id: 5, name: 'Accountant' })
    expect(role.id).toBe(9)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/admin/roles/')
    expect(init.method).toBe('POST')
    expect(JSON.parse(String(init.body))).toEqual({
      company_id: 5,
      name: 'Accountant',
    })
  })

  it('updates a role via PATCH', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, adminRoleDetail({ name: 'Renamed' })),
    )
    await updateAdminRole(3, { name: 'Renamed' })
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(init.method).toBe('PATCH')
    expect(JSON.parse(String(init.body))).toEqual({ name: 'Renamed' })
  })

  it('lists, assigns, and removes role permissions', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(200, [adminPermission()]))
      .mockResolvedValueOnce(jsonResponse(201, adminPermission({ id: 2 })))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))

    await listAdminRolePermissions(3)
    expect((fetchMock.mock.calls[0] as [string])[0]).toBe(
      '/api/admin/roles/3/permissions/',
    )

    await assignAdminRolePermission(3, 2)
    const [, assignInit] = fetchMock.mock.calls[1] as [string, RequestInit]
    expect(JSON.parse(String(assignInit.body))).toEqual({ permission_id: 2 })

    await removeAdminRolePermission(3, 2)
    const [removeUrl, removeInit] = fetchMock.mock.calls[2] as [string, RequestInit]
    expect(removeUrl).toBe('/api/admin/roles/3/permissions/2/')
    expect(removeInit.method).toBe('DELETE')
  })

  it('surfaces backend errors as a typed ApiError', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(400, { detail: 'Nope.' }))
    await expect(createAdminRole({ company_id: 1, name: 'x' })).rejects.toMatchObject(
      { status: 400 },
    )
  })
})
