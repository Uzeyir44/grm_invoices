import { adminApiClient } from './adminClient'
import type { AdminPermission } from '../types/adminPermission'
import type {
  AdminRoleDetail,
  AdminRoleListItem,
  AdminRolesListParams,
  CreateRoleInput,
  UpdateRoleInput,
} from '../types/adminRole'

/**
 * System Admin RBAC role-management API slice.
 *
 * All calls go through the Admin API client (`/api/admin/...`) and require the
 * `system.roles.manage` system permission on the backend. Role creation always
 * produces a tenant-scoped role; system roles are protected and read-only.
 */

export function listAdminRoles(
  params: AdminRolesListParams = {},
): Promise<AdminRoleListItem[]> {
  const query = new URLSearchParams()
  if (params.scope) query.set('scope', params.scope)
  if (params.company_id !== undefined) {
    query.set('company_id', String(params.company_id))
  }
  const queryString = query.toString()
  return adminApiClient.get<AdminRoleListItem[]>(
    `/admin/roles/${queryString ? `?${queryString}` : ''}`,
  )
}

export function getAdminRole(id: number): Promise<AdminRoleDetail> {
  return adminApiClient.get<AdminRoleDetail>(`/admin/roles/${id}/`)
}

export function createAdminRole(input: CreateRoleInput): Promise<AdminRoleDetail> {
  return adminApiClient.post<AdminRoleDetail>('/admin/roles/', input)
}

export function updateAdminRole(
  id: number,
  input: UpdateRoleInput,
): Promise<AdminRoleDetail> {
  return adminApiClient.patch<AdminRoleDetail>(`/admin/roles/${id}/`, input)
}

export function listAdminRolePermissions(id: number): Promise<AdminPermission[]> {
  return adminApiClient.get<AdminPermission[]>(`/admin/roles/${id}/permissions/`)
}

export function assignAdminRolePermission(
  id: number,
  permissionId: number,
): Promise<AdminPermission> {
  return adminApiClient.post<AdminPermission>(`/admin/roles/${id}/permissions/`, {
    permission_id: permissionId,
  })
}

export function removeAdminRolePermission(
  id: number,
  permissionId: number,
): Promise<void> {
  return adminApiClient.delete<void>(
    `/admin/roles/${id}/permissions/${permissionId}/`,
  )
}
