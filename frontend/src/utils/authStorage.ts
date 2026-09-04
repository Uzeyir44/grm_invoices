/**
 * Token storage strategy.
 *
 * The backend issues a short-lived JWT access token (15 min) plus a refresh
 * token. Only the access token is persisted client-side so it survives page
 * reloads; refresh handling is a separate, later task and nothing about it is
 * implemented here.
 *
 * Chosen storage: `localStorage` under a namespaced key.
 *   * Survives reloads and is synchronous — the simplest correct choice for
 *     a pure SPA.
 *   * Any script running on the page can read localStorage, so the standard
 *     XSS caveat applies; a future hardening step may move to httpOnly
 *     cookies. No refresh token is stored at all.
 *
 * Every access is wrapped in try/catch so a storage failure (privacy mode,
 * quota) degrades to "signed out" instead of crashing the app.
 */

const ACCESS_TOKEN_KEY = 'grm_crm.access_token'

export { ACCESS_TOKEN_KEY }

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

export function clearAccessToken(): void {
  try {
    localStorage.removeItem(ACCESS_TOKEN_KEY)
  } catch {
    // best effort
  }
}