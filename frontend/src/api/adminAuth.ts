import { adminApiClient } from './adminClient'
import {
  setAdminAccessToken,
  setAdminRefreshToken,
} from '../utils/adminAuthStorage'
import type {
  AdminRefreshResponse,
  AdminTokenResponse,
  SystemAdmin,
} from '../types/adminAuth'

/**
 * System Admin authentication API slice.
 *
 * Endpoint contracts (verified against `apps/system_admin/api/`):
 *   * `POST /api/admin/authentication/token/`         `{ email, password }`
 *                                                     → `{ access, refresh }`
 *   * `POST /api/admin/authentication/token/refresh/` `{ refresh }`
 *                                                     → `{ access }`
 *   * `GET  /api/admin/authentication/me/`            → `SystemAdmin`
 *
 * The Admin login does **not** send a company id (unlike the company login):
 * the backend resolves the reserved platform company server-side. Only the two
 * tokens are persisted, under the Admin-specific storage keys.
 */

export async function adminLogin(
  email: string,
  password: string,
): Promise<AdminTokenResponse> {
  const tokens = await adminApiClient.post<AdminTokenResponse>(
    '/admin/authentication/token/',
    { email, password },
    { auth: false },
  )
  setAdminAccessToken(tokens.access)
  setAdminRefreshToken(tokens.refresh)
  return tokens
}

/**
 * Explicitly exchange an Admin refresh token for a new access token and store
 * it. (The Admin client also performs this automatically on a 401; this export
 * exists for callers/tests that need to refresh deliberately.)
 */
export async function adminRefresh(
  refreshToken: string,
): Promise<AdminRefreshResponse> {
  const data = await adminApiClient.post<AdminRefreshResponse>(
    '/admin/authentication/token/refresh/',
    { refresh: refreshToken },
    { auth: false },
  )
  setAdminAccessToken(data.access)
  return data
}

export function getAdminMe(): Promise<SystemAdmin> {
  return adminApiClient.get<SystemAdmin>('/admin/authentication/me/')
}
