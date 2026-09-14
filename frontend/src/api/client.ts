import { ApiError } from '../types/api'
import type { ApiErrorPayload, ApiFieldErrors } from '../types/api'
import { fallbackMessageForStatus } from '../types/api'
import {
  clearAuthTokens,
  getAccessToken,
  getRefreshToken,
  setAccessToken,
} from '../utils/authStorage'

/**
 * Single HTTP entry point for the existing Django REST API.
 *
 * * Resolves the base URL from `VITE_API_BASE_URL` (defaults to `/api`).
 * * Attaches the JWT access token as `Authorization: Bearer …` when present.
 * * Supports JSON and FormData bodies (multipart boundary left to the browser).
 * * Converts every failed response into a typed {@link ApiError} carrying the
 *   backend payload, field errors, and a stable HTTP status, so UI code never
 *   parses raw strings or reads backend stack traces.
 * * On a **401** it transparently attempts one access-token refresh (shared by
 *   all concurrent requests) and retries the original request exactly once.
 *   If the refresh cannot recover, it clears both tokens and notifies
 *   subscribers via {@link onUnauthorized}.
 * * `apiClient.raw` returns the unparsed `Response` (binary downloads); it
 *   still carries the access token, refresh/retry handling, and the same error
 *   conversion as every other request.
 */

const DEFAULT_BASE_URL = '/api'

function resolveBaseUrl(): string {
  const configured = import.meta.env.VITE_API_BASE_URL
  return (configured ?? DEFAULT_BASE_URL).replace(/\/+$/, '')
}

/**
 * Resolved API base URL (defaults to `/api`). Exported so the System Admin
 * client can target `/api/admin/...` with the same configuration without
 * duplicating URL resolution.
 */
export const BASE_URL = resolveBaseUrl()

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'

export interface ApiRequestOptions {
  method?: HttpMethod
  /** Serialized as JSON unless it is a `FormData` instance. */
  body?: unknown
  headers?: HeadersInit
  /** Set `false` to skip attaching the access token (e.g. public endpoints).
   *  The automatic 401 → refresh → retry flow is also skipped for these
   *  requests, so login/refresh never recurse. */
  auth?: boolean
  signal?: AbortSignal
  /** Return the raw `Response` instead of parsing the body (binary downloads).
   *  Failed responses are still converted to {@link ApiError}. */
  raw?: boolean
}

function isFormData(value: unknown): value is FormData {
  return typeof FormData !== 'undefined' && value instanceof FormData
}

function fieldErrorEntries(payload: ApiErrorPayload | null): ApiFieldErrors {
  const entries: ApiFieldErrors = {}
  if (!payload) return entries

  const collect = (prefix: string, value: unknown): void => {
    if (
      Array.isArray(value) &&
      value.every((entry) => typeof entry === 'string')
    ) {
      entries[prefix || 'non_field_errors'] = value as string[]
      return
    }
    if (value !== null && typeof value === 'object') {
      for (const [key, nested] of Object.entries(value)) {
        collect(prefix ? `${prefix}.${key}` : key, nested)
      }
    }
  }

  for (const [key, value] of Object.entries(payload)) {
    if (key === 'detail' || key === 'code') continue
    collect(key, value)
  }
  return entries
}

function firstFieldMessage(fieldErrors: ApiFieldErrors): string | undefined {
  for (const messages of Object.values(fieldErrors)) {
    if (messages.length > 0) return messages[0]
  }
  return undefined
}

export async function toApiError(response: Response): Promise<ApiError> {
  const text = await response.text().catch(() => '')
  let payload: ApiErrorPayload | null = null
  try {
    payload = text ? (JSON.parse(text) as ApiErrorPayload) : null
  } catch {
    payload = null
  }

  const fieldErrors = fieldErrorEntries(payload)
  const code = typeof payload?.code === 'string' ? payload.code : null
  const message =
    firstFieldMessage(fieldErrors) ??
    (typeof payload?.detail === 'string'
      ? payload.detail
      : fallbackMessageForStatus(response.status))

  const retryAfterRaw = response.headers.get('Retry-After')
  const retryAfter = retryAfterRaw ? Number.parseInt(retryAfterRaw, 10) : Number.NaN

  return new ApiError({
    status: response.status,
    payload,
    fieldErrors,
    code,
    message,
    retryAfterSeconds: Number.isFinite(retryAfter) ? retryAfter : null,
  })
}

export async function parseSuccess<T>(response: Response): Promise<T> {
  const text = await response.text()
  if (response.status === 204 || text.length === 0) {
    return undefined as T
  }
  try {
    return JSON.parse(text) as T
  } catch {
    return text as unknown as T
  }
}

// ---------------------------------------------------------------------------
// Automatic access-token refresh (single-flight).
// ---------------------------------------------------------------------------

const unauthorizedListeners = new Set<() => void>()

/** Subscribe to unrecoverable authentication failures (tokens were cleared). */
export function onUnauthorized(listener: () => void): () => void {
  unauthorizedListeners.add(listener)
  return () => {
    unauthorizedListeners.delete(listener)
  }
}

function notifyUnauthorized(): void {
  for (const listener of unauthorizedListeners) {
    listener()
  }
}

let activeRefresh: Promise<boolean> | null = null

async function performRefresh(): Promise<boolean> {
  const refreshToken = getRefreshToken()
  if (!refreshToken) {
    return false
  }
  try {
    const data = await executeRequest<unknown>(
      '/authentication/token/refresh/',
      { method: 'POST', body: { refresh: refreshToken }, auth: false },
      true,
    )
    const access = (data as { access?: unknown } | null)?.access
    if (typeof access !== 'string') {
      return false
    }
    setAccessToken(access)
    return true
  } catch {
    return false
  }
}

/**
 * Refresh the access token once. Concurrent callers share a single in-flight
 * refresh, so a burst of simultaneous 401 responses only produces one request
 * to the refresh endpoint.
 */
function refreshAccessToken(): Promise<boolean> {
  if (activeRefresh) {
    return activeRefresh
  }
  activeRefresh = performRefresh().finally(() => {
    activeRefresh = null
  })
  return activeRefresh
}

// ---------------------------------------------------------------------------
// Core request execution.
// ---------------------------------------------------------------------------

async function executeRequest<T>(
  path: string,
  options: ApiRequestOptions,
  retried: boolean,
): Promise<T> {
  const { method = 'GET', body, headers: extraHeaders, auth = true, signal, raw = false } =
    options

  const headers = new Headers(extraHeaders)
  const token = auth ? getAccessToken() : null
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

  // Recover from an expired access token: refresh once, retry the original
  // request exactly once. Refreshing is skipped for public (auth:false)
  // requests, so login/refresh never recurse, and never on an already-retried
  // request.
  if (response.status === 401 && auth && !retried) {
    const refreshed = await refreshAccessToken()
    if (refreshed) {
      return executeRequest<T>(path, options, true)
    }
    clearAuthTokens()
    notifyUnauthorized()
  }

  if (!response.ok) {
    throw await toApiError(response)
  }
  if (raw) {
    return response as unknown as T
  }
  return parseSuccess<T>(response)
}

async function request<T>(
  path: string,
  options: ApiRequestOptions = {},
): Promise<T> {
  return executeRequest<T>(path, options, false)
}

export const apiClient = {
  get: <T>(path: string, options?: Omit<ApiRequestOptions, 'method' | 'body'>) =>
    request<T>(path, { ...options, method: 'GET' }),
  post: <T>(
    path: string,
    body?: unknown,
    options?: Omit<ApiRequestOptions, 'method' | 'body'>,
  ) => request<T>(path, { ...options, method: 'POST', body }),
  put: <T>(
    path: string,
    body?: unknown,
    options?: Omit<ApiRequestOptions, 'method' | 'body'>,
  ) => request<T>(path, { ...options, method: 'PUT', body }),
  patch: <T>(
    path: string,
    body?: unknown,
    options?: Omit<ApiRequestOptions, 'method' | 'body'>,
  ) => request<T>(path, { ...options, method: 'PATCH', body }),
  delete: <T>(path: string, options?: Omit<ApiRequestOptions, 'method' | 'body'>) =>
    request<T>(path, { ...options, method: 'DELETE' }),
  // Returns the unparsed Response for authenticated binary/both-direction
  // requests. Defaults to GET; pass `{ method, body }` for e.g. a POST that
  // returns a binary body. Bearer auth, 401 refresh/retry and typed errors are
  // unchanged.
  raw: (path: string, options?: ApiRequestOptions) =>
    request<Response>(path, { ...options, raw: true }),
}