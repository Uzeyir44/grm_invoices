import { apiClient } from './client'
import type { ListAuditLogsParams, PaginatedAuditLogs } from '../types/auditLog'

/**
 * Audit logs API slice, built on the generic {@link apiClient}.
 *
 * Endpoint contract (verified against the Django backend in
 * `apps/audit_logs/api/`):
 *   * `GET /audit-logs/` → DRF paginated envelope `{ count, next, previous,
 *     results }` of `AuditLog` rows (`AuditLogSerializer`, strictly
 *     read-only). Ordered `-created_at`, `-id` (newest first). Default page
 *     size 50, `?page=` / `?page_size=` supported, max page size 100. An
 *     out-of-range `?page=` is a 404.
 *   * Optional exact-match filters, all composable and tenant-scoped
 *     (`AuditLogQuerySerializer` — the only accepted keys): `action`,
 *     `entity_type` (exact strings), `entity_id` / `user_id` (integers),
 *     `created_after` (`created_at >=`) / `created_before` (`created_at <=`,
 *     ISO-8601 datetimes). Invalid integers/datetimes, or `created_after`
 *     later than `created_before`, are a backend 400. There is **no**
 *     free-text `search` and **no** ordering parameter.
 *   * Requires the `audit_logs.read` backend permission (otherwise 403); the
 *     backend derives the tenant from the authenticated user.
 *   * Write methods are not supported (405); there is no detail endpoint.
 *
 * The company is never sent from the client — the backend scopes the queryset
 * to the authenticated user's company first (`company_id` is not an accepted
 * query parameter).
 */

export function listAuditLogs(params: ListAuditLogsParams = {}): Promise<PaginatedAuditLogs> {
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
  if (params.created_after !== undefined && params.created_after.trim()) {
    query.set('created_after', params.created_after.trim())
  }
  if (params.created_before !== undefined && params.created_before.trim()) {
    query.set('created_before', params.created_before.trim())
  }
  const queryString = query.toString()
  return apiClient.get<PaginatedAuditLogs>(`/audit-logs/${queryString ? `?${queryString}` : ''}`)
}
