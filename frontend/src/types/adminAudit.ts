/**
 * Admin platform-audit contract types, derived from the actual backend
 * `apps/system_admin/api/audit_serializers.py` + `audit_views.py`.
 *
 * `GET /api/admin/audit/` returns a DRF paginated envelope
 * `{ count, next, previous, results }` of platform audit records ordered
 * `-created_at`, `-id` (newest first). Only platform-company audit rows are
 * served; tenant audit rows are never included. All fields are read-only.
 */

export interface AdminAuditLog {
  id: number
  company_id: number
  user_id: number | null
  /** Acting System Admin's full name, or null (deleted/system actor). */
  user_name: string | null
  action: string
  entity_type: string
  entity_id: number
  /** Label for company entities (batch-resolved), else null. */
  entity_name: string | null
  /** Affected tenant, extracted from `new_values["target_company_id"]`. */
  target_company_id: number | null
  target_company_name: string | null
  previous_values: Record<string, unknown> | null
  new_values: Record<string, unknown> | null
  ip_address: string | null
  user_agent: string | null
  request_id: string | null
  created_at: string
}

export interface PaginatedAdminAuditLogs {
  count: number
  next: string | null
  previous: string | null
  results: AdminAuditLog[]
}

/** Query parameters supported by `GET /api/admin/audit/`. */
export interface ListAdminAuditLogsParams {
  page?: number
  page_size?: number
  action?: string
  entity_type?: string
  entity_id?: number
  user_id?: number
  target_company_id?: number
  created_after?: string
  created_before?: string
}
