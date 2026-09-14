/**
 * Admin RBAC contract types, derived from the actual backend
 * `apps/system_admin/api/role_serializers.py`:
 *
 *   * `GET  /api/admin/permissions/`                    → `AdminPermission[]`
 *   * `GET  /api/admin/roles/`                          → `AdminRoleListItem[]`
 *   * `POST /api/admin/roles/`                          → `AdminRoleDetail` (201)
 *   * `GET  /api/admin/roles/:id/`                      → `AdminRoleDetail`
 *   * `PATCH /api/admin/roles/:id/`                     → `AdminRoleDetail`
 *   * `GET  /api/admin/roles/:id/permissions/`          → `AdminPermission[]`
 *   * `POST /api/admin/roles/:id/permissions/`          → `AdminPermission` (201)
 *   * `DELETE /api/admin/roles/:id/permissions/:pid/`   → 204
 *
 * Scopes are always explicit. The permission catalog is read-only. `scope` is
 * never writable — the backend always creates tenant roles.
 */

export type RbacScope = 'tenant' | 'system'

export interface AdminPermission {
  id: number
  code: string
  description: string
  scope: RbacScope
}
