/**
 * System Admin authentication contract types, derived from the actual backend
 * serializers/views in `apps/system_admin/api/`:
 *
 *   * `POST /api/admin/authentication/token/`         body `{ email, password }`
 *                                                     → `{ access, refresh }`
 *   * `POST /api/admin/authentication/token/refresh/` body `{ refresh }`
 *                                                     → `{ access }`
 *   * `GET  /api/admin/authentication/me/`            → `SystemAdmin`
 *
 * The Admin `/me` response only exposes identity plus the system authorization
 * scope and permission codes. It never includes password hashes or MFA
 * secrets, and no tenant/business data beyond the platform company identity.
 */

export interface AdminTokenResponse {
  access: string
  refresh: string
}

export interface AdminRefreshResponse {
  access: string
}

/** The value carried by the Admin token's scope claim. */
export type SystemAdminScope = 'system_admin'

export interface SystemAdmin {
  id: number
  email: string
  first_name: string
  last_name: string
  is_active: boolean
  company_id: number
  company_name: string
  scope: SystemAdminScope
  /** System permission codes granted to this admin (e.g. `system.users.manage`). */
  permissions: string[]
}
