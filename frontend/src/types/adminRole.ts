import type { AdminPermission, RbacScope } from './adminPermission'

/** A role row in the global role list. */
export interface AdminRoleListItem {
  id: number
  name: string
  company_id: number | null
  company_name: string | null
  scope: RbacScope
  permission_count: number
  created_at: string
}

/** Role detail, including assigned and assignable permissions. */
export interface AdminRoleDetail {
  id: number
  name: string
  company_id: number | null
  company_name: string | null
  scope: RbacScope
  created_at: string
  permissions: AdminPermission[]
  available_permissions: AdminPermission[]
}

/** Body for `POST /api/admin/roles/` (scope is always tenant, set by backend). */
export interface CreateRoleInput {
  company_id: number
  name: string
}

/** Body for `PATCH /api/admin/roles/:id/` (name is the only editable field). */
export interface UpdateRoleInput {
  name: string
}

/** Backend-supported role-list query parameters. */
export interface AdminRolesListParams {
  scope?: RbacScope
  company_id?: number
}
