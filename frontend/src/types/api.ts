/**
 * Typed model of the backend's HTTP error contract.
 *
 * The Django REST framework returns:
 *   * non-field errors as `{ "detail": "...", "code": "..." }`;
 *   * field errors as `{ "<field>": ["...", ...] }` — possibly nested one
 *     level, e.g. `{ "legal_entity": { "voen": ["..."] } }`;
 *   * a `Retry-After` header on 429 responses.
 *
 * UI code must never decide how to react by inspecting raw strings; it reads
 * `ApiError.status` (or one of the `HTTP_STATUS` constants) instead.
 */

export const HTTP_STATUS = {
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  PAYLOAD_TOO_LARGE: 413,
  TOO_MANY_REQUESTS: 429,
  INTERNAL_SERVER_ERROR: 500,
} as const

export interface ApiErrorPayload {
  detail?: string
  code?: string
  [field: string]: unknown
}

/** `field -> messages`. Nested keys use dotted paths, e.g. `legal_entity.voen`. */
export type ApiFieldErrors = Record<string, string[]>

const FALLBACK_MESSAGES: Record<number, string> = {
  [HTTP_STATUS.BAD_REQUEST]: 'The request was invalid.',
  [HTTP_STATUS.UNAUTHORIZED]: 'Authentication is required.',
  [HTTP_STATUS.FORBIDDEN]: 'You do not have permission to perform this action.',
  [HTTP_STATUS.NOT_FOUND]: 'The requested resource was not found.',
  [HTTP_STATUS.PAYLOAD_TOO_LARGE]: 'The request body is too large.',
  [HTTP_STATUS.TOO_MANY_REQUESTS]: 'Too many requests. Please try again later.',
  [HTTP_STATUS.INTERNAL_SERVER_ERROR]: 'An unexpected server error occurred.',
}

export function fallbackMessageForStatus(status: number): string {
  return FALLBACK_MESSAGES[status] ?? `The request failed with status ${status}.`
}

/**
 * A consistent, typed representation of a failed backend request.
 *
 * `status` and the HTTP_STATUS constants let future UI code distinguish
 * 400 / 401 / 403 / 404 / 413 / 429 / 500 without string matching. The raw
 * backend payload is preserved (for recovery/display) but is never shown to
 * users wholesale; `message` is a safe, human-readable summary.
 */
export class ApiError extends Error {
  readonly status: number
  readonly payload: ApiErrorPayload | null
  readonly fieldErrors: ApiFieldErrors
  readonly code: string | null
  readonly retryAfterSeconds: number | null

  constructor(init: {
    status: number
    payload: ApiErrorPayload | null
    message: string
    fieldErrors?: ApiFieldErrors
    code?: string | null
    retryAfterSeconds?: number | null
  }) {
    super(init.message)
    this.name = 'ApiError'
    this.status = init.status
    this.payload = init.payload
    this.fieldErrors = init.fieldErrors ?? {}
    this.code = init.code ?? null
    this.retryAfterSeconds = init.retryAfterSeconds ?? null
  }
}

export function isApiError(value: unknown): value is ApiError {
  return value instanceof ApiError
}

export function isApiErrorWithStatus(error: unknown, status: number): boolean {
  return isApiError(error) && error.status === status
}