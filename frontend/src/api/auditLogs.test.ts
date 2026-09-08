import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { listAuditLogs } from './auditLogs'
import { auditLogs, jsonResponse, paginatedAuditLogs } from '../test/auditLogFixtures'
import { ApiError, HTTP_STATUS } from '../types/api'
import { setAccessToken } from '../utils/authStorage'

describe('auditLogs API', () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    localStorage.clear()
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('lists audit logs from the endpoint with no query string by default', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, paginatedAuditLogs()))
    setAccessToken('token-1')

    const result = await listAuditLogs()

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/audit-logs/')
    expect(init.method).toBe('GET')
    expect(new Headers(init.headers).get('Authorization')).toBe('Bearer token-1')
    expect(result.results).toEqual(auditLogs)
    expect(result.count).toBe(2)
  })

  it('preserves the backend pagination envelope', async () => {
    const envelope = paginatedAuditLogs([auditLogs[0]], {
      count: 120,
      next: 'http://testserver/api/audit-logs/?page=2',
      previous: null,
    })
    fetchMock.mockResolvedValue(jsonResponse(200, envelope))

    const result = await listAuditLogs()

    expect(result.count).toBe(120)
    expect(result.next).toBe('http://testserver/api/audit-logs/?page=2')
    expect(result.previous).toBeNull()
    expect(result.results).toEqual([auditLogs[0]])
  })

  it('requests the given page via the backend page parameter', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, paginatedAuditLogs([])))

    await listAuditLogs({ page: 3 })

    const [url] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/audit-logs/?page=3')
  })

  it('requests a page size via the backend page_size parameter', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, paginatedAuditLogs([])))

    await listAuditLogs({ page: 2, page_size: 10 })

    const [url] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/audit-logs/?page=2&page_size=10')
  })

  it('sends the supported exact-match filters', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, paginatedAuditLogs([])))

    await listAuditLogs({ action: 'update', entity_type: 'client', entity_id: 2, user_id: 1 })

    const [url] = fetchMock.mock.calls[0] as [string, RequestInit]
    const params = new URL(String(url), 'http://testserver').searchParams
    expect(params.get('action')).toBe('update')
    expect(params.get('entity_type')).toBe('client')
    expect(params.get('entity_id')).toBe('2')
    expect(params.get('user_id')).toBe('1')
  })

  it('sends the created_at bounds', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, paginatedAuditLogs([])))

    await listAuditLogs({
      created_after: '2026-09-01T00:00:00+00:00',
      created_before: '2026-09-06T00:00:00+00:00',
    })

    const [url] = fetchMock.mock.calls[0] as [string, RequestInit]
    const params = new URL(String(url), 'http://testserver').searchParams
    expect(params.get('created_after')).toBe('2026-09-01T00:00:00+00:00')
    expect(params.get('created_before')).toBe('2026-09-06T00:00:00+00:00')
  })

  it('combines filters with pagination', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, paginatedAuditLogs([])))

    await listAuditLogs({ action: 'update', entity_type: 'client', page: 2 })

    const [url] = fetchMock.mock.calls[0] as [string, RequestInit]
    const params = new URL(String(url), 'http://testserver').searchParams
    expect(params.get('action')).toBe('update')
    expect(params.get('entity_type')).toBe('client')
    expect(params.get('page')).toBe('2')
  })

  it('omits empty or blank filter values', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, paginatedAuditLogs([])))

    await listAuditLogs({ action: '   ', entity_type: '', created_after: '' })

    const [url] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/audit-logs/')
  })

  it('omits non-finite numeric filters', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, paginatedAuditLogs([])))

    await listAuditLogs({ entity_id: Number.NaN, user_id: Number.POSITIVE_INFINITY })

    const [url] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/audit-logs/')
  })

  it('propagates a 400 for backend-rejected filter values as a typed ApiError', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(400, {
        non_field_errors: ['created_after must not be later than created_before.'],
      }),
    )

    const error = await listAuditLogs({
      created_after: '2026-09-06T00:00:00+00:00',
      created_before: '2026-09-05T00:00:00+00:00',
    }).catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(ApiError)
    expect((error as ApiError).status).toBe(400)
    expect((error as ApiError).message).toBe(
      'created_after must not be later than created_before.',
    )
  })

  it('never sends a company_id query parameter', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, paginatedAuditLogs([])))

    await listAuditLogs({ page: 2 })

    const [url] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).not.toContain('company_id')
    expect(url).not.toContain('tenant_id')
  })

  it('converts a 403 into a typed ApiError', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(403, { detail: 'Missing required permission: audit_logs.read' }),
    )

    await expect(listAuditLogs()).rejects.toMatchObject({
      status: HTTP_STATUS.FORBIDDEN,
    })
    await expect(listAuditLogs()).rejects.toBeInstanceOf(ApiError)
  })

  it('converts an out-of-range page 404 into a typed ApiError', async () => {
    fetchMock.mockResolvedValue(jsonResponse(404, { detail: 'Invalid page.' }))

    await expect(listAuditLogs({ page: 999 })).rejects.toMatchObject({
      status: HTTP_STATUS.NOT_FOUND,
    })
  })
})
