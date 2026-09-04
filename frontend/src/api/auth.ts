import { apiClient } from './client'
import { setAccessToken, setRefreshToken } from '../utils/authStorage'
import type { CurrentUser, RefreshTokenResponse } from '../types/auth'

/**
 * Authentication API slice, built on the generic {@link apiClient}.
 *
 * Endpoint contracts (verified against the Django backend):
 *   * `POST /authentication/token/`  body `{ company_id, email, password }` →
 *     `{ access, refresh }`. `company_id` is the login-time lookup key because
 *     email is unique per company, not globally.
 *   * `GET /authentication/me/`       returns the current user + company.
 */

export async function login(
  companyId: number,
  email: string,
  password: string,
): Promise<RefreshTokenResponse> {
  const tokens = await apiClient.post<RefreshTokenResponse>(
    '/authentication/token/',
    { company_id: companyId, email, password },
    { auth: false },
  )
  setAccessToken(tokens.access)
  setRefreshToken(tokens.refresh)
  return tokens
}

export function fetchCurrentUser(): Promise<CurrentUser> {
  return apiClient.get<CurrentUser>('/authentication/me/')
}