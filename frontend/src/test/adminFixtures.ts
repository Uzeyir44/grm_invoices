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
