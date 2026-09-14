/**
 * System Admin backup contract types, derived from the actual backend
 * `apps/system_admin/api/backup_serializers.py` + `backup_views.py` (Phase 9).
 *
 * Backups are **system-level**: they contain the entire CRM dataset, are never
 * company-scoped, and are only reachable through the authenticated System Admin
 * API. The response exposes a logical `storage` label (`"backup-storage"`) —
 * never a filesystem path — and no credentials.
 *
 * Endpoints (all require `system.backups.manage`):
 *   * `GET    /api/admin/backups/`            → `PaginatedAdminBackups`
 *   * `GET    /api/admin/backups/capability/` → `BackupCapabilities`
 *   * `POST   /api/admin/backups/` `{backup_type}` → `AdminBackup`
 *   * `GET    /api/admin/backups/:id/`        → `AdminBackup`
 *   * `GET    /api/admin/backups/:id/download/` → binary attachment
 *   * `POST   /api/admin/backups/:id/verify/` → `BackupVerification`
 *   * `DELETE /api/admin/backups/:id/`        → 204
 */

export type AdminBackupType = 'database' | 'media'

/**
 * Real lifecycle states: a row is only `completed` after a real artifact
 * exists on the server with its size and checksum recorded.
 */
export type AdminBackupStatus = 'pending' | 'running' | 'completed' | 'failed'

export interface AdminBackup {
  id: number
  backup_type: AdminBackupType
  status: AdminBackupStatus
  created_at: string
  updated_at: string
  completed_at: string | null
  /** Server-generated artifact filename (safe; never a client-supplied path). */
  file_name: string
  file_size: number | null
  checksum_sha256: string
  /** Logical storage label — never an absolute filesystem path. */
  storage: string
  /** Generic, non-secret failure detail; empty on success. */
  error_message: string
  created_by_id: number | null
  created_by_name: string | null
}

export interface PaginatedAdminBackups {
  count: number
  next: string | null
  previous: string | null
  results: AdminBackup[]
}

export interface AdminBackupCapability {
  available: boolean
  reason: string
}

export interface BackupCapabilities {
  database: AdminBackupCapability
  media: AdminBackupCapability
}

export interface BackupVerification {
  exists: boolean
  size: number | null
  checksum_matches: boolean
}

export interface ListAdminBackupsParams {
  page?: number
  page_size?: number
}