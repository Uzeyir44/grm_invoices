import { apiClient } from './client'
import type {
  CreateGeneratedDocumentInput,
  GeneratedDocument,
} from '../types/generatedDocument'

/**
 * Generated documents API slice, built on the generic {@link apiClient}.
 *
 * Endpoint contracts (verified against the Django backend in
 * `apps/generated_documents/api/`):
 *   * `GET /generated-documents/` → array of `GeneratedDocument`
 *     (plain array, **no pagination**, **no query parameters**). The backend
 *     orders the caller's company-scoped documents newest-first
 *     (`-created_at`); no search / status / type / client / date filtering or
 *     ordering parameters are supported.
 *   * `POST /generated-documents/` → create a document (automatic numbering +
 *     initial draft version + optional line items). Body follows
 *     `GeneratedDocumentCreateSerializer`: `client_id`, `document_type_id`,
 *     `currency_id`, `items?`. Returns `GeneratedDocument` (201). The axios-ish
 *     client passes DRF field/nested validation errors through as a typed
 *     {@link ApiError}; a missing/cross-company client is a 404.
 *
 * The company is never sent from the client — the backend derives it from the
 * authenticated user's tenant (a body `company_id` is ignored).
 */

export function listGeneratedDocuments(): Promise<GeneratedDocument[]> {
  return apiClient.get<GeneratedDocument[]>('/generated-documents/')
}

/** Backwards-compatible alias used by the dashboard recent-documents section. */
export function fetchGeneratedDocuments(): Promise<GeneratedDocument[]> {
  return listGeneratedDocuments()
}

export function createGeneratedDocument(
  input: CreateGeneratedDocumentInput,
): Promise<GeneratedDocument> {
  return apiClient.post<GeneratedDocument>('/generated-documents/', input)
}