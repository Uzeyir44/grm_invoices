import { apiClient } from './client'
import type { DocumentTemplate } from '../types/documentTemplate'

/**
 * Document template list read API (uses the existing
 * `GET /api/document-templates/` endpoint). The backend returns the caller's
 * company-scoped templates as an array.
 */
export function fetchDocumentTemplates(): Promise<DocumentTemplate[]> {
  return apiClient.get<DocumentTemplate[]>('/document-templates/')
}