/**
 * Admin company-management contract types, derived from the actual backend
 * `apps/system_admin/api/company_serializers.py`:
 *
 *   * `GET   /api/admin/companies/`                    → `AdminCompany[]`
 *   * `GET   /api/admin/companies/:id/`                → `AdminCompany`
 *   * `PATCH /api/admin/companies/:id/`                → `AdminCompany`
 *   * `POST  /api/admin/companies/provision/`          → `AdminCompany` (201)
 *   * `POST  /api/admin/companies/:id/activate/`       → `AdminCompany`
 *   * `POST  /api/admin/companies/:id/deactivate/`     → `AdminCompany`
 *
 * The response never includes credentials. Only the admin-editable Company
 * fields are writable; `status` is changed through the dedicated lifecycle
 * endpoints and `is_platform` is immutable.
 */

export type CompanyStatus = 'trial' | 'active' | 'suspended' | 'cancelled'

export interface AdminCompany {
  id: number
  legal_name: string
  display_name: string
  voen: string | null
  registration_number: string | null
  status: CompanyStatus
  default_language: string
  default_timezone: string
  is_platform: boolean
  created_at: string
  updated_at: string
}

/** Body for `POST /api/admin/companies/provision/`. */
export interface ProvisionCompanyInput {
  legal_name: string
  display_name: string
  voen: string | null
  registration_number: string | null
  default_language: string
  default_timezone: string
  admin_email: string
  admin_first_name: string
  admin_last_name: string
  admin_password: string
}

/** Body for `PATCH /api/admin/companies/:id/` (admin-editable fields only). */
export interface UpdateCompanyInput {
  legal_name?: string
  display_name?: string
  voen?: string | null
  registration_number?: string | null
  default_language?: string
  default_timezone?: string
}
