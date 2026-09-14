import { adminApiClient } from './adminClient'
import type { AdminPermission, RbacScope } from '../types/adminPermission'

/**
 * Read-only System Admin permission catalog.
 *
 * `GET /api/admin/permissions/` supports the `scope` query parameter
 * (`tenant` | `system`). Permissions are application-defined and cannot be
 * created or deleted through the API.
 */

export function listAdminPermissions(
  params: { scope?: RbacScope } = {},
): Promise<AdminPermission[]> {
  const query = new URLSearchParams()
  if (params.scope) {
    query.set('scope', params.scope)
  }
  const queryString = query.toString()
  return adminApiClient.get<AdminPermission[]>(
    `/admin/permissions/${queryString ? `?${queryString}` : ''}`,
  )
}
