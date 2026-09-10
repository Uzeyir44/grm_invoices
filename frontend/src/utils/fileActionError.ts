import { ApiError, HTTP_STATUS } from '../types/api'

/**
 * Map a failed file action (download/view) to a safe, human-readable message.
 * 404 covers both "missing/cross-tenant" and "file disappeared on disk"; 403
 * and 429 get their own friendly messages; everything else falls back to the
 * backend's `message` or the supplied fallback.
 */
export function fileActionError(error: unknown, fallback: string): string {
  if (!(error instanceof ApiError)) return fallback
  if (error.status === HTTP_STATUS.FORBIDDEN) {
    return 'You do not have permission to generate or download this document.'
  }
  if (error.status === HTTP_STATUS.NOT_FOUND) {
    return 'The document or its generated file is not available.'
  }
  if (error.status === HTTP_STATUS.TOO_MANY_REQUESTS) {
    return error.retryAfterSeconds !== null
      ? `Too many attempts. Please wait ${error.retryAfterSeconds} seconds and try again.`
      : 'Too many attempts. Please wait a moment and try again.'
  }
  return error.message || fallback
}