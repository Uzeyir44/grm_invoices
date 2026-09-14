import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  createAdminBackup,
  deleteAdminBackup,
  downloadAdminBackup,
  getAdminBackup,
  getAdminBackupCapabilities,
  listAdminBackups,
  verifyAdminBackup,
} from './adminBackups'
import {
  adminBackup,
  adminBackupCapabilities,
  jsonResponse,
} from '../test/adminFixtures'
import { setAdminAccessToken } from '../utils/adminAuthStorage'

describe('adminBackups API slice', () => {
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

  it('lists backups with the admin bearer token', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, {
        count: 1,
        next: null,
        previous: null,
        results: [adminBackup()],
      }),
    )

    const body = await listAdminBackups()
    expect(body.count).toBe(1)
    expect(body.results[0].id).toBe(7)

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/admin/backups/')
    expect(new Headers(init.headers).get('Authorization')).toBe('Bearer admin-token')
  })

  it('passes page query parameters', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, { count: 0, next: null, previous: null, results: [] }),
    )
    await listAdminBackups({ page: 2, page_size: 10 })
    const [url] = fetchMock.mock.calls[0] as [string]
    expect(url).toContain('/api/admin/backups/?')
    expect(url).toContain('page=2')
    expect(url).toContain('page_size=10')
  })

  it('fetches capability', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, adminBackupCapabilities()))
    const capability = await getAdminBackupCapabilities()
    expect(capability.database.available).toBe(true)
    expect(capability.media.available).toBe(true)
    const [url] = fetchMock.mock.calls[0] as [string]
    expect(url).toBe('/api/admin/backups/capability/')
  })

  it('fetches a single backup', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, adminBackup()))
    const backup = await getAdminBackup(7)
    expect(backup.id).toBe(7)
    const [url] = fetchMock.mock.calls[0] as [string]
    expect(url).toBe('/api/admin/backups/7/')
  })

  it('creates a backup with the correct body', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(201, adminBackup({ backup_type: 'database' })))
    const backup = await createAdminBackup('database')
    expect(backup.status).toBe('completed')

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/admin/backups/')
    expect(init.method).toBe('POST')
    expect(JSON.parse(String(init.body))).toEqual({ backup_type: 'database' })
  })

  it('verifies a backup', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, { exists: true, size: 4096, checksum_matches: true }),
    )
    const result = await verifyAdminBackup(7)
    expect(result.exists).toBe(true)
    expect(result.checksum_matches).toBe(true)

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/admin/backups/7/verify/')
    expect(init.method).toBe('POST')
  })

  it('deletes a backup via DELETE', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }))
    await deleteAdminBackup(7)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/admin/backups/7/')
    expect(init.method).toBe('DELETE')
  })

  it('downloads the artifact as a blob with a filename', async () => {
    const backup = adminBackup({ file_name: 'grm-backup-test.dump' })
    fetchMock.mockResolvedValueOnce(
      new Response(new Blob(['dump-bytes']), {
        status: 200,
        headers: {
          'Content-Type': 'application/octet-stream',
          'Content-Disposition': `attachment; filename="${backup.file_name}"`,
        },
      }),
    )

    const download = await downloadAdminBackup(backup)
    expect(download.blob).toBeInstanceOf(Blob)
    expect(download.blob.size).toBeGreaterThan(0)
    expect(download.filename).toBe('grm-backup-test.dump')

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/admin/backups/7/download/')
    expect(init.method).toBe('GET')
  })

  it('falls back to the recorded file_name when Content-Disposition is absent', async () => {
    const backup = adminBackup({ file_name: 'fallback.dump' })
    fetchMock.mockResolvedValueOnce(
      new Response(new Blob(['dump-bytes']), { status: 200 }),
    )
    const download = await downloadAdminBackup(backup)
    expect(download.filename).toBe('fallback.dump')
  })

  it('surfaces backend errors as a typed ApiError', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(400, { detail: 'Unavailable.' }))
    await expect(createAdminBackup('database')).rejects.toMatchObject({ status: 400 })
  })
})