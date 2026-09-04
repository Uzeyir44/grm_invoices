import { apiClient } from './client'
import type { GeneratedDocument } from '../types/generatedDocument'

/**
 * Generated document list read API (uses the existing
 * `GET /api/generated-documents/` endpoint). The backend returns the caller's
 * company-scoped documents as an array.
 */
export function fetchGeneratedDocuments(): Promise<GeneratedDocument[]> {
  return apiClient.get<GeneratedDocument[]>('/generated-documents/')
}