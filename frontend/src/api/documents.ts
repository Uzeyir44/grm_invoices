import { apiClient } from './client'
import type { GeneratedDocument } from '../types/generatedDocument'

/**
 * Generated documents API slice, built on the generic {@link apiClient}.
 *
 * Endpoint contract (verified against the Django backend in
 * `apps/generated_documents/api/`):
 *   * `GET /generated-documents/` → array of `GeneratedDocument`
 *     (plain array, **no pagination**, **no query parameters**). The backend
 *     orders the caller's company-scoped documents newest-first
 *     (`-created_at`); no search / status / type / client / date filtering or
 *     ordering parameters are supported.
 *
 * The company is never sent from the client — the backend derives it from the
 * authenticated user's tenant.
 */

export function listGeneratedDocuments(): Promise<GeneratedDocument[]> {
  return apiClient.get<GeneratedDocument[]>('/generated-documents/')
}

/** Backwards-compatible alias used by the dashboard recent-documents section. */
export function fetchGeneratedDocuments(): Promise<GeneratedDocument[]> {
  return listGeneratedDocuments()
}