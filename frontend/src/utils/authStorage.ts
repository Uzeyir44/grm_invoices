/**
 * Token storage strategy.
 *
 * The backend issues a short-lived JWT access token (15 min) plus a refresh
 * token (1 day). Both must survive page reloads, so both are persisted in
 * `localStorage` under namespaced keys. The refresh token is only ever sent to
 * the dedicated refresh endpoint (in the request body), never placed in URLs,
 * logged, or rendered in the UI; the access token is attached by the API
 * client as `Authorization: Bearer …`.
 *
 * Trade-offs (chosen deliberately):
 *   * localStorage survives reloads and is synchronous — the simplest correct
 *     choice for a pure SPA backed by a bearer-token JSON API.
 *   * Any script running on the page can read localStorage, so the standard
 *     XSS caveat applies; a future hardening step may move to httpOnly
 *     cookies. No other storage mechanism is used, so there are no duplicate
 *     token copies to reconcile.
 *
 * Every access is wrapped in try/catch so a storage failure (privacy mode,
 * quota) degrades to "signed out" instead of crashing the app.
 */

const ACCESS_TOKEN_KEY = 'grm_crm.access_token'
const REFRESH_TOKEN_KEY = 'grm_crm.refresh_token'

export { ACCESS_TOKEN_KEY, REFRESH_TOKEN_KEY }

export function getAccessToken(): string | null {
  try {
    return localStorage.getItem(ACCESS_TOKEN_KEY)
  } catch {
    return null
  }
}

export function setAccessToken(token: string): void {
  try {
    localStorage.setItem(ACCESS_TOKEN_KEY, token)
  } catch {
    // storage unavailable — the in-memory request flow still works
  }
}

export function getRefreshToken(): string | null {
  try {
    return localStorage.getItem(REFRESH_TOKEN_KEY)
  } catch {
    return null
  }
}

export function setRefreshToken(token: string): void {
  try {
    localStorage.setItem(REFRESH_TOKEN_KEY, token)
  } catch {
    // storage unavailable — a later refresh simply cannot recover
  }
}

export function clearAccessToken(): void {
  try {
    localStorage.removeItem(ACCESS_TOKEN_KEY)
  } catch {
    // best effort
  }
}

export function clearRefreshToken(): void {
  try {
    localStorage.removeItem(REFRESH_TOKEN_KEY)
  } catch {
    // best effort
  }
}

/** Remove both tokens; used on logout and unrecoverable refresh failure. */
export function clearAuthTokens(): void {
  clearAccessToken()
  clearRefreshToken()
}