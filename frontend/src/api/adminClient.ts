import { BASE_URL, parseSuccess, toApiError } from './client'
import type { ApiRequestOptions } from './client'
import {
  clearAdminAuthTokens,
  getAdminAccessToken,
  getAdminRefreshToken,
  setAdminAccessToken,
} from '../utils/adminAuthStorage'

/**
 * HTTP entry point for the System Admin API surface (`/api/admin/...`).
 *
 * Deliberately separate from the company {@link apiClient}: it reads and
 * writes only the Admin token storage, refreshes through the Admin refresh
 * endpoint, and notifies its own subscribers. It shares the low-level request
 * plumbing (URL resolution, typed {@link ApiError} conversion, JSON parsing)
 * so error behavior stays identical, but it can never attach or refresh a
 * company token — and therefore cannot silently fall back to company
 * authentication.
 */

/** Subscribe to unrecoverable Admin authentication failures. */
const adminUnauthorizedListeners = new Set<() => void>()

export function onAdminUnauthorized(listener: () => void): () => void {
  adminUnauthorizedListeners.add(listener)
  return () => {
    adminUnauthorizedListeners.delete(listener)
  }
}

function notifyAdminUnauthorized(): void {
  for (const listener of adminUnauthorizedListeners) {
    listener()
  }
}

function isFormData(value: unknown): value is FormData {
  return typeof FormData !== 'undefined' && value instanceof FormData
}

let activeAdminRefresh: Promise<boolean> | null = null

async function performAdminRefresh(): Promise<boolean> {
  const refreshToken = getAdminRefreshToken()
  if (!refreshToken) {
    return false
  }
  try {
    const data = await executeAdminRequest<unknown>(
      '/admin/authentication/token/refresh/',
      { method: 'POST', body: { refresh: refreshToken }, auth: false },
      true,
    )
    const access = (data as { access?: unknown } | null)?.access
    if (typeof access !== 'string') {
      return false
    }
    setAdminAccessToken(access)
    return true
  } catch {
    return false
  }
}

/**
 * Refresh the Admin access token once. Concurrent 401s share a single
 * in-flight refresh, so a burst of simultaneous failures produces exactly one
 * request to the Admin refresh endpoint.
 */
function refreshAdminAccessToken(): Promise<boolean> {
  if (activeAdminRefresh) {
    return activeAdminRefresh
  }
  activeAdminRefresh = performAdminRefresh().finally(() => {
    activeAdminRefresh = null
  })
  return activeAdminRefresh
}

async function executeAdminRequest<T>(
  path: string,
  options: ApiRequestOptions,
  retried: boolean,
): Promise<T> {
  const {
    method = 'GET',
    body,
    headers: extraHeaders,
    auth = true,
    signal,
    raw = false,
  } = options

  const headers = new Headers(extraHeaders)
  const token = auth ? getAdminAccessToken() : null
  if (token) {
    headers.set('Authorization', `Bearer ${token}`)
  }
  if (!headers.has('Accept')) {
    headers.set('Accept', raw ? '*/*' : 'application/json')
  }

  let requestBody: BodyInit | undefined
  if (isFormData(body)) {
    requestBody = body
  } else if (body !== undefined) {
    headers.set('Content-Type', 'application/json')
    requestBody = JSON.stringify(body)
  }

  const response = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    body: requestBody,
    signal,
  })

  // Recover from an expired Admin access token: refresh once, retry exactly
  // once. Public (auth:false) requests skip this, so login/refresh never
  // recurse; an already-retried request never loops.
  if (response.status === 401 && auth && !retried) {
    const refreshed = await refreshAdminAccessToken()
    if (refreshed) {
      return executeAdminRequest<T>(path, options, true)
    }
    clearAdminAuthTokens()
    notifyAdminUnauthorized()
  }

  if (!response.ok) {
    throw await toApiError(response)
  }
  if (raw) {
    return response as unknown as T
  }
  return parseSuccess<T>(response)
}

async function adminRequest<T>(
  path: string,
  options: ApiRequestOptions = {},
): Promise<T> {
  return executeAdminRequest<T>(path, options, false)
}

export const adminApiClient = {
  get: <T>(path: string, options?: Omit<ApiRequestOptions, 'method' | 'body'>) =>
    adminRequest<T>(path, { ...options, method: 'GET' }),
  post: <T>(
    path: string,
    body?: unknown,
    options?: Omit<ApiRequestOptions, 'method' | 'body'>,
  ) => adminRequest<T>(path, { ...options, method: 'POST', body }),
  put: <T>(
    path: string,
    body?: unknown,
    options?: Omit<ApiRequestOptions, 'method' | 'body'>,
  ) => adminRequest<T>(path, { ...options, method: 'PUT', body }),
  patch: <T>(
    path: string,
    body?: unknown,
    options?: Omit<ApiRequestOptions, 'method' | 'body'>,
  ) => adminRequest<T>(path, { ...options, method: 'PATCH', body }),
  delete: <T>(path: string, options?: Omit<ApiRequestOptions, 'method' | 'body'>) =>
    adminRequest<T>(path, { ...options, method: 'DELETE' }),
  raw: (path: string, options?: ApiRequestOptions) =>
    adminRequest<Response>(path, { ...options, raw: true }),
}
