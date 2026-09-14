import { adminApiClient } from './adminClient'
import type {
  ListAdminAuditLogsParams,
  PaginatedAdminAuditLogs,
} from '../types/adminAudit'

/**
 * System Admin platform audit API slice.
 *
 * `GET /api/admin/audit/` returns the platform audit dataset (never tenant
 * audit rows), newest first, paginated (`?page=` / `?page_size=`, max 100).
 * The backend requires the `system.audit.read` system permission. The endpoint
 * is strictly read-only — there is no create/update/delete.
 */

export function listAdminAuditLogs(
  params: ListAdminAuditLogsParams = {},
): Promise<PaginatedAdminAuditLogs> {
  const query = new URLSearchParams()
  if (params.page !== undefined && Number.isFinite(params.page)) {
    query.set('page', String(Math.trunc(params.page)))
  }
  if (params.page_size !== undefined && Number.isFinite(params.page_size)) {
    query.set('page_size', String(Math.trunc(params.page_size)))
  }
  if (params.action !== undefined && params.action.trim()) {
    query.set('action', params.action.trim())
  }
  if (params.entity_type !== undefined && params.entity_type.trim()) {
    query.set('entity_type', params.entity_type.trim())
  }
  if (params.entity_id !== undefined && Number.isFinite(params.entity_id)) {
    query.set('entity_id', String(Math.trunc(params.entity_id)))
  }
  if (params.user_id !== undefined && Number.isFinite(params.user_id)) {
    query.set('user_id', String(Math.trunc(params.user_id)))
  }
  if (
    params.target_company_id !== undefined &&
    Number.isFinite(params.target_company_id)
  ) {
    query.set('target_company_id', String(Math.trunc(params.target_company_id)))
  }
  if (params.created_after !== undefined && params.created_after.trim()) {
    query.set('created_after', params.created_after.trim())
  }
  if (params.created_before !== undefined && params.created_before.trim()) {
    query.set('created_before', params.created_before.trim())
  }
  const queryString = query.toString()
  return adminApiClient.get<PaginatedAdminAuditLogs>(
    `/admin/audit/${queryString ? `?${queryString}` : ''}`,
  )
}
