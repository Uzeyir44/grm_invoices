/**
 * Backend auth contract types, derived from the actual DRF serializer
 * responses:
 *
 *   * `POST /api/authentication/token/` (login) returns `{ "access", "refresh" }`;
 *   * `POST /api/authentication/token/refresh/` returns `{ "access" }`;
 *   * `GET /api/authentication/me/` returns the current user + company.
 */

export interface AccessTokenResponse {
  access: string
}

export interface RefreshTokenResponse extends AccessTokenResponse {
  refresh: string
}

export interface CurrentUser {
  id: number
  email: string
  first_name: string
  last_name: string
  is_active: boolean
  mfa_enabled: boolean
  company_id: number
  company_name: string
}