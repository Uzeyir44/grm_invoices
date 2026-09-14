import { adminApiClient } from './adminClient'
import type {
  AdminBackup,
  BackupCapabilities,
  BackupVerification,
  ListAdminBackupsParams,
  PaginatedAdminBackups,
} from '../types/adminBackup'

/**
 * System Admin backup API slice (Phase 9).
 *
 * All endpoints require the `system.backups.manage` system permission on the
 * backend (the full System Admin boundary). Backups are system-level and never
 * company-scoped. The backend produces **real artifacts** and reports actual
 * capability; this slice never invents statuses, sizes, or schedule info.
 *
 *   * `GET    /api/admin/backups/` → paginated `PaginatedAdminBackups`
 *   * `GET    /api/admin/backups/capability/` → `BackupCapabilities`
 *   * `POST   /api/admin/backups/` `{ backup_type }` → created `AdminBackup`
 *   * `GET    /api/admin/backups/:id/` → `AdminBackup`
 *   * `GET    /api/admin/backups/:id/download/` → binary attachment
 *   * `POST   /api/admin/backups/:id/verify/` → `BackupVerification`
 *   * `DELETE /api/admin/backups/:id/` → 204
 *
 * Downloads stream through the authenticated endpoint and are never persisted
 * in application state or localStorage.
 */

export function listAdminBackups(
  params: ListAdminBackupsParams = {},
): Promise<PaginatedAdminBackups> {
  const query = new URLSearchParams()
  if (params.page !== undefined && Number.isFinite(params.page)) {
    query.set('page', String(Math.trunc(params.page)))
  }
  if (params.page_size !== undefined && Number.isFinite(params.page_size)) {
    query.set('page_size', String(Math.trunc(params.page_size)))
  }
  const queryString = query.toString()
  return adminApiClient.get<PaginatedAdminBackups>(
    `/admin/backups/${queryString ? `?${queryString}` : ''}`,
  )
}

export function getAdminBackupCapabilities(): Promise<BackupCapabilities> {
  return adminApiClient.get<BackupCapabilities>('/admin/backups/capability/')
}

export function getAdminBackup(id: number): Promise<AdminBackup> {
  return adminApiClient.get<AdminBackup>(`/admin/backups/${id}/`)
}

export function createAdminBackup(
  backupType: 'database' | 'media',
): Promise<AdminBackup> {
  return adminApiClient.post<AdminBackup>('/admin/backups/', {
    backup_type: backupType,
  })
}

function filenameFromContentDisposition(response: Response): string | null {
  const value = response.headers.get('Content-Disposition')
  if (!value) return null
  const match = /filename="?([^";]+)"?/.exec(value)
  return match ? match[1] : null
}

export interface AdminBackupDownload {
  blob: Blob
  filename: string
}

/**
 * Download a backup artifact through the authenticated System Admin endpoint.
 * The filename is taken from `Content-Disposition` when present, falling back
 * to the recorded server-generated `file_name`. Never a `/media/...` URL,
 * never a token in a URL, never a filesystem path.
 */
export async function downloadAdminBackup(
  backup: AdminBackup,
): Promise<AdminBackupDownload> {
  const response = await adminApiClient.raw(
    `/admin/backups/${backup.id}/download/`,
  )
  const blob = await response.blob()
  return {
    blob,
    filename: filenameFromContentDisposition(response) ?? backup.file_name,
  }
}

/** Verify an artifact's integrity on demand (`POST /api/admin/backups/:id/verify/`). */
export function verifyAdminBackup(id: number): Promise<BackupVerification> {
  return adminApiClient.post<BackupVerification>(
    `/admin/backups/${id}/verify/`,
    {},
  )
}

/** Permanently delete a backup artifact and its record (`DELETE .../:id/` → 204). */
export function deleteAdminBackup(id: number): Promise<void> {
  return adminApiClient.delete<void>(`/admin/backups/${id}/`)
}