import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { listAdminAuditLogs } from './adminAudit'
import { adminAuditLog, jsonResponse } from '../test/adminFixtures'
import { setAdminAccessToken } from '../utils/adminAuthStorage'

describe('adminAudit API slice', () => {
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

  it('lists platform audit with the admin bearer token', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, { count: 1, next: null, previous: null, results: [adminAuditLog()] }),
    )

    const body = await listAdminAuditLogs()
    expect(body.count).toBe(1)

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/admin/audit/')
    expect(new Headers(init.headers).get('Authorization')).toBe('Bearer admin-token')
  })

  it('passes all supported filters', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, { count: 0, next: null, previous: null, results: [] }),
    )
    await listAdminAuditLogs({
      page: 2,
      page_size: 10,
      action: 'company.provision',
      entity_type: 'company',
      entity_id: 5,
      user_id: 1,
      target_company_id: 9,
      created_after: '2026-01-01T00:00:00Z',
      created_before: '2026-12-31T00:00:00Z',
    })

    const [url] = fetchMock.mock.calls[0] as [string]
    expect(url).toContain('/api/admin/audit/?')
    for (const part of [
      'page=2',
      'page_size=10',
      'action=company.provision',
      'entity_type=company',
      'entity_id=5',
      'user_id=1',
      'target_company_id=9',
      'created_after=2026-01-01T00%3A00%3A00Z',
      'created_before=2026-12-31T00%3A00%3A00Z',
    ]) {
      expect(url).toContain(part)
    }
  })

  it('surfaces backend errors as a typed ApiError', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(403, { detail: 'Forbidden.' }))
    await expect(listAdminAuditLogs()).rejects.toMatchObject({ status: 403 })
  })
})
