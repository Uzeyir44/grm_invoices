import { ApiError, HTTP_STATUS } from '../../../types/api'

export type FieldErrors = Record<string, string>

export function firstFieldErrors(error: ApiError): FieldErrors {
  const result: FieldErrors = {}
  for (const [key, messages] of Object.entries(error.fieldErrors)) {
    if (messages.length > 0) result[key] = messages[0]
  }
  return result
}

export function referenceFormMessageFor(
  error: ApiError,
  fieldErrors: FieldErrors,
): string | undefined {
  if (error.status === HTTP_STATUS.FORBIDDEN) {
    return 'You do not have permission to manage reference data.'
  }
  if (error.status === HTTP_STATUS.NOT_FOUND) {
    return 'The record was not found.'
  }
  if (error.status === HTTP_STATUS.TOO_MANY_REQUESTS) {
    return error.retryAfterSeconds !== null
      ? `Too many attempts. Please wait ${error.retryAfterSeconds} seconds and try again.`
      : 'Too many attempts. Please wait a moment and try again.'
  }
  if (Object.keys(fieldErrors).length === 0) {
    return error.message || 'The operation failed. Please try again.'
  }
  return error.fieldErrors.non_field_errors?.[0]
}
