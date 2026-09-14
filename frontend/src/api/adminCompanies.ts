import { adminApiClient } from './adminClient'
import type {
  AdminCompany,
  ProvisionCompanyInput,
  UpdateCompanyInput,
} from '../types/adminCompany'

/**
 * System Admin company-management API slice.
 *
 * All calls go through the Admin API client (`/api/admin/...`), which attaches
 * only the Admin bearer token and performs the Admin 401 → refresh → retry
 * flow. These endpoints are entirely separate from the tenant company APIs and
 * require the `system.companies.manage` system permission on the backend.
 */

export function listAdminCompanies(): Promise<AdminCompany[]> {
  return adminApiClient.get<AdminCompany[]>('/admin/companies/')
}

export function getAdminCompany(id: number): Promise<AdminCompany> {
  return adminApiClient.get<AdminCompany>(`/admin/companies/${id}/`)
}

export function provisionAdminCompany(
  input: ProvisionCompanyInput,
): Promise<AdminCompany> {
  return adminApiClient.post<AdminCompany>('/admin/companies/provision/', input)
}

export function updateAdminCompany(
  id: number,
  input: UpdateCompanyInput,
): Promise<AdminCompany> {
  return adminApiClient.patch<AdminCompany>(`/admin/companies/${id}/`, input)
}

export function activateAdminCompany(id: number): Promise<AdminCompany> {
  return adminApiClient.post<AdminCompany>(`/admin/companies/${id}/activate/`)
}

export function deactivateAdminCompany(id: number): Promise<AdminCompany> {
  return adminApiClient.post<AdminCompany>(`/admin/companies/${id}/deactivate/`)
}
