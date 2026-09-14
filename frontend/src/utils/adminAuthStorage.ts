/**
 * System Admin token storage.
 *
 * Deliberately separate from the company authentication storage
 * (`utils/authStorage.ts`): the Admin access/refresh tokens use their own
 * localStorage keys so a company token and a System Admin token can never
 * overwrite or masquerade as one another. Only the two tokens are persisted —
 * no identity/permission data is cached in browser storage (it is re-fetched
 * from the Admin `/me` endpoint on bootstrap).
 *
 * Same trade-offs and failure handling as the company storage: localStorage
 * survives reloads, the standard XSS caveat applies, and every access is
 * wrapped so an unavailable storage degrades to "signed out".
 */

const ADMIN_ACCESS_TOKEN_KEY = 'grm_crm.admin_access_token'
const ADMIN_REFRESH_TOKEN_KEY = 'grm_crm.admin_refresh_token'

export { ADMIN_ACCESS_TOKEN_KEY, ADMIN_REFRESH_TOKEN_KEY }

export function getAdminAccessToken(): string | null {
  try {
    return localStorage.getItem(ADMIN_ACCESS_TOKEN_KEY)
  } catch {
    return null
  }
}

export function setAdminAccessToken(token: string): void {
  try {
    localStorage.setItem(ADMIN_ACCESS_TOKEN_KEY, token)
  } catch {
    // storage unavailable — the in-memory request flow still works
  }
}

export function getAdminRefreshToken(): string | null {
  try {
    return localStorage.getItem(ADMIN_REFRESH_TOKEN_KEY)
  } catch {
    return null
  }
}

export function setAdminRefreshToken(token: string): void {
  try {
    localStorage.setItem(ADMIN_REFRESH_TOKEN_KEY, token)
  } catch {
    // storage unavailable — a later refresh simply cannot recover
  }
}

export function clearAdminAccessToken(): void {
  try {
    localStorage.removeItem(ADMIN_ACCESS_TOKEN_KEY)
  } catch {
    // best effort
  }
}

export function clearAdminRefreshToken(): void {
  try {
    localStorage.removeItem(ADMIN_REFRESH_TOKEN_KEY)
  } catch {
    // best effort
  }
}

/** Remove both Admin tokens; used on logout and unrecoverable refresh failure. */
export function clearAdminAuthTokens(): void {
  clearAdminAccessToken()
  clearAdminRefreshToken()
}
