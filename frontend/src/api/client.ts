import { ApiError } from '../types/api'
import type { ApiErrorPayload, ApiFieldErrors } from '../types/api'
import { fallbackMessageForStatus } from '../types/api'
import { getAccessToken } from '../utils/authStorage'

/**
 * Single HTTP entry point for the existing Django REST API.
 *
 * * Resolves the base URL from `VITE_API_BASE_URL` (defaults to `/api`).
 * * Attaches the JWT access token as `Authorization: Bearer …` when present.
 * * Supports JSON and FormData bodies (multipart boundary left to the browser).
 * * Converts every failed response into a typed {@link ApiError} carrying the
 *   backend payload, field errors, and a stable HTTP status, so future UI code
 *   never parses raw strings or reads backend stack traces.
 *
 * Individual business modules (auth, clients, templates, documents) will build
 * on this client; nothing endpoint-specific is implemented yet.
 */

const DEFAULT_BASE_URL = '/api'

function resolveBaseUrl(): string {
  const configured = import.meta.env.VITE_API_BASE_URL
  return (configured ?? DEFAULT_BASE_URL).replace(/\/+$/, '')
}

const BASE_URL = resolveBaseUrl()

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'

export interface ApiRequestOptions {
  method?: HttpMethod
  /** Serialized as JSON unless it is a `FormData` instance. */
  body?: unknown
  headers?: HeadersInit
  /** Set `false` to skip attaching the access token (e.g. public endpoints). */
  auth?: boolean
  signal?: AbortSignal
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

async function toApiError(response: Response): Promise<ApiError> {
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

async function parseSuccess<T>(response: Response): Promise<T> {
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

async function request<T>(
  path: string,
  options: ApiRequestOptions = {},
): Promise<T> {
  const { method = 'GET', body, headers: extraHeaders, auth = true, signal } =
    options

  const headers = new Headers(extraHeaders)
  const token = auth ? getAccessToken() : null
  if (token) {
    headers.set('Authorization', `Bearer ${token}`)
  }
  if (!headers.has('Accept')) {
    headers.set('Accept', 'application/json')
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

  if (!response.ok) {
    throw await toApiError(response)
  }
  return parseSuccess<T>(response)
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
}