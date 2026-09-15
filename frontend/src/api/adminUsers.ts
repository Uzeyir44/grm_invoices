import { adminApiClient } from './adminClient'
import type {
  AdminUser,
  AdminUserDetail,
  AdminUserRole,
  AdminUserCompanyChoice,
  CreateUserInput,
  UpdateUserInput,
} from '../types/adminUser'

/**
 * System Admin user-management API slice.
 *
 * All calls go through the Admin API client (`/api/admin/...`), which attaches
 * only the Admin bearer token and performs the Admin 401 → refresh → retry
 * flow. These endpoints manage ordinary tenant users only and require the
 * `system.users.manage` system permission on the backend.
 */

export function listAdminUsers(): Promise<AdminUser[]> {
  return adminApiClient.get<AdminUser[]>('/admin/users/')
}

export function listAdminUserCompanyChoices(): Promise<AdminUserCompanyChoice[]> {
  return adminApiClient.get<AdminUserCompanyChoice[]>(
    '/admin/users/company-choices/',
  )
}

export function createAdminUser(input: CreateUserInput): Promise<AdminUserDetail> {
  return adminApiClient.post<AdminUserDetail>('/admin/users/', input)
}

export function getAdminUser(id: number): Promise<AdminUserDetail> {
  return adminApiClient.get<AdminUserDetail>(`/admin/users/${id}/`)
}

export function updateAdminUser(
  id: number,
  input: UpdateUserInput,
): Promise<AdminUserDetail> {
  return adminApiClient.patch<AdminUserDetail>(`/admin/users/${id}/`, input)
}

export function activateAdminUser(id: number): Promise<AdminUserDetail> {
  return adminApiClient.post<AdminUserDetail>(`/admin/users/${id}/activate/`)
}

export function deactivateAdminUser(id: number): Promise<AdminUserDetail> {
  return adminApiClient.post<AdminUserDetail>(`/admin/users/${id}/deactivate/`)
}

export function listAdminUserRoles(id: number): Promise<AdminUserRole[]> {
  return adminApiClient.get<AdminUserRole[]>(`/admin/users/${id}/roles/`)
}

export function assignAdminUserRole(
  id: number,
  roleId: number,
): Promise<AdminUserRole> {
  return adminApiClient.post<AdminUserRole>(`/admin/users/${id}/roles/`, {
    role_id: roleId,
  })
}

export function removeAdminUserRole(id: number, roleId: number): Promise<void> {
  return adminApiClient.delete<void>(`/admin/users/${id}/roles/${roleId}/`)
}
