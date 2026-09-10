/**
 * Audit log types, derived from the backend read-only serializers
 * (`apps/audit_logs/api/serializers.py`) and the paginated list view
 * (`apps/audit_logs/api/views.py`).
 *
 * * `GET /api/audit-logs/` → DRF `PageNumberPagination` envelope
 *   `{ count, next, previous, results }` of `AuditLog` rows, ordered
 *   `-created_at`, `-id`. Default page size 50, `?page=` / `?page_size=`
 *   supported, max page size 100. An out-of-range `?page=` is a 404.
 * * Row fields (`AuditLogSerializer`, strictly read-only): `id`,
 *   `company_id`, `user_id` (nullable — the user may have been deleted),
 *   `user_name` (nullable display name of the acting user), `action`,
 *   `entity_type`, `entity_id`, `entity_name` (nullable tenant-scoped label
 *   of the referenced entity), `previous_values`, `new_values`,
 *   `ip_address`, `user_agent`, `request_id`, `created_at`. Only compact
 *   identifiers plus these two display strings are exposed — never full
 *   `User` / `Company` objects.
 *
 * The company is always the authenticated user's company; no `company_id` is
 * ever sent from the client.
 */

/** One immutable audit record, exactly as `AuditLogSerializer` returns it. */
export interface AuditLog {
  id: number
  company_id: number
  user_id: number | null
  /** Full name of the acting user, or null (deleted user / system event). */
  user_name: string | null
  action: string
  entity_type: string
  entity_id: number
  /** Human-readable label of the referenced entity, or null when unknown. */
  entity_name: string | null
  previous_values: Record<string, unknown> | null
  new_values: Record<string, unknown> | null
  ip_address: string | null
  user_agent: string | null
  request_id: string | null
  created_at: string
}

/**
 * The backend's DRF paginated envelope for `GET /api/audit-logs/`.
 * `next` / `previous` are absolute URLs (or null); the frontend follows them
 * only via `?page=` state, never by fetching those URLs directly.
 */
export interface PaginatedAuditLogs {
  count: number
  next: string | null
  previous: string | null
  results: AuditLog[]
}

/** Query parameters supported by `GET /api/audit-logs/` for this step. */
export interface ListAuditLogsParams {
  /** 1-based page number (`?page=`). Omitted for the first page. */
  page?: number
  /** Page size (`?page_size=`, clamped to 100 by the backend). */
  page_size?: number
  /**
   * Exact action match (`?action=`, e.g. `client.created`). Empty values are
   * never sent.
   */
  action?: string
  /** Exact entity-type match (`?entity_type=`, e.g. `client`). */
  entity_type?: string
  /** Exact entity-id match (`?entity_id=`). Must be a valid backend integer. */
  entity_id?: number
  /** Exact user-id match (`?user_id=`). Must be a valid backend integer. */
  user_id?: number
  /**
   * Lower bound for `created_at` (`?created_after=`, ISO-8601 datetime).
   * The backend rejects `created_after > created_before` with a 400.
   */
  created_after?: string
  /** Upper bound for `created_at` (`?created_before=`, ISO-8601 datetime). */
  created_before?: string
}
