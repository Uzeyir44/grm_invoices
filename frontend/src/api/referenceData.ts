import { apiClient } from './client'
import type { DocumentType } from '../types/referenceData'

/**
 * Read-only reference-data catalog API slice, built on the generic
 * {@link apiClient}.
 *
 * Endpoint contracts (verified against the Django backend in `apps/reference_data`):
 *   * `GET /reference-data/document-types/` → array of `DocumentType`
 *     (`{ id, code, name }`), ordered by `code`. Used by the document-template
 *     create form and list filter, where `document_type` is a foreign-key id.
 */
export function fetchDocumentTypes(): Promise<DocumentType[]> {
  return apiClient.get<DocumentType[]>('/reference-data/document-types/')
}