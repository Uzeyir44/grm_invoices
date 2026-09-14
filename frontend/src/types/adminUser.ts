/**
 * Admin user-management contract types, derived from the actual backend
 * `apps/system_admin/api/user_serializers.py`:
 *
 *   * `GET    /api/admin/users/`                       → `AdminUser[]`
 *   * `GET    /api/admin/users/:id/`                   → `AdminUserDetail`
 *   * `PATCH  /api/admin/users/:id/`                   → `AdminUserDetail`
 *   * `POST   /api/admin/users/:id/activate/`          → `AdminUserDetail`
 *   * `POST   /api/admin/users/:id/deactivate/`        → `AdminUserDetail`
 *   * `GET    /api/admin/users/:id/roles/`             → `AdminUserRole[]`
 *   * `POST   /api/admin/users/:id/roles/`             → `AdminUserRole` (201)
 *   * `DELETE /api/admin/users/:id/roles/:role_id/`    → 204
 *
 * Responses never include credentials or secrets. `company_id` / `company` are
 * never writable — a user cannot be moved between companies.
 */

/** A compact role reference carried on a user row. */
export interface AdminUserRoleRef {
  id: number
  name: string
}

/** A role as returned by the user-roles endpoints. */
export interface AdminUserRole {
  id: number
  name: string
  scope: 'tenant' | 'system'
}

export interface AdminUser {
  id: number
  email: string
  first_name: string
  last_name: string
  is_active: boolean
  company_id: number
  company_name: string
  deleted_at: string | null
  created_at: string
  updated_at: string
  roles: AdminUserRoleRef[]
}

/** Detail additionally exposes the company's assignable tenant roles. */
export interface AdminUserDetail extends AdminUser {
  company_roles: AdminUserRoleRef[]
}

/** Body for `PATCH /api/admin/users/:id/` (admin-editable fields only). */
export interface UpdateUserInput {
  first_name?: string
  last_name?: string
  email?: string
}
