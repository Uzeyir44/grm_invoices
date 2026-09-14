import type { AdminCompany } from '../types/adminCompany'
import type { AdminPermission } from '../types/adminPermission'
import type { AdminRoleDetail, AdminRoleListItem } from '../types/adminRole'
import type { AdminUser, AdminUserDetail } from '../types/adminUser'
import type { SystemAdmin } from '../types/adminAuth'

export function jsonResponse(
  status: number,
  body: unknown,
  headers?: Record<string, string>,
) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  })
}

export const ALL_SYSTEM_PERMISSIONS = [
  'system.companies.manage',
  'system.users.manage',
  'system.roles.manage',
  'system.reference.manage',
  'system.audit.read',
  'system.backups.manage',
  'system.settings.manage',
] as const

/** The actual shape returned by the backend `AdminCompanySerializer`. */
export function adminCompany(overrides: Partial<AdminCompany> = {}): AdminCompany {
  return {
    id: 5,
    legal_name: 'Acme LLC',
    display_name: 'Acme',
    voen: '1234567890',
    registration_number: null,
    status: 'active',
    default_language: 'az',
    default_timezone: 'Asia/Baku',
    is_platform: false,
    created_at: '2026-09-01T10:00:00+00:00',
    updated_at: '2026-09-02T10:00:00+00:00',
    ...overrides,
  }
}

/** The actual shape returned by the backend `AdminPermissionSerializer`. */
export function adminPermission(
  overrides: Partial<AdminPermission> = {},
): AdminPermission {
  return {
    id: 1,
    code: 'clients.read',
    description: 'View clients',
    scope: 'tenant',
    ...overrides,
  }
}

/** The actual shape returned by the backend `AdminRoleListSerializer`. */
export function adminRoleListItem(
  overrides: Partial<AdminRoleListItem> = {},
): AdminRoleListItem {
  return {
    id: 3,
    name: 'Manager A',
    company_id: 5,
    company_name: 'Acme',
    scope: 'tenant',
    permission_count: 1,
    created_at: '2026-09-01T10:00:00+00:00',
    ...overrides,
  }
}

/** The actual shape returned by the backend `AdminRoleDetailSerializer`. */
export function adminRoleDetail(
  overrides: Partial<AdminRoleDetail> = {},
): AdminRoleDetail {
  return {
    id: 3,
    name: 'Manager A',
    company_id: 5,
    company_name: 'Acme',
    scope: 'tenant',
    created_at: '2026-09-01T10:00:00+00:00',
    permissions: [],
    available_permissions: [],
    ...overrides,
  }
}

/** The actual shape returned by the backend `AdminUserSerializer`. */
export function adminUser(overrides: Partial<AdminUser> = {}): AdminUser {
  return {
    id: 21,
    email: 'alice@acme.example',
    first_name: 'Alice',
    last_name: 'Anderson',
    is_active: true,
    company_id: 5,
    company_name: 'Acme',
    deleted_at: null,
    created_at: '2026-09-01T10:00:00+00:00',
    updated_at: '2026-09-02T10:00:00+00:00',
    roles: [],
    ...overrides,
  }
}

/** The actual shape returned by the backend `AdminUserDetailSerializer`. */
export function adminUserDetail(
  overrides: Partial<AdminUserDetail> = {},
): AdminUserDetail {
  return {
    ...adminUser(),
    company_roles: [],
    ...overrides,
  }
}

/** The actual shape returned by the backend `SystemAdminMeSerializer`. */
export function adminMe(overrides: Partial<SystemAdmin> = {}): SystemAdmin {
  return {
    id: 1,
    email: 'admin@grm.example',
    first_name: 'Ada',
    last_name: 'Admin',
    is_active: true,
    company_id: 1,
    company_name: 'GRM Platform',
    scope: 'system_admin',
    permissions: [...ALL_SYSTEM_PERMISSIONS],
    ...overrides,
  }
}
