/**
 * Generated document types, derived from the backend
 * `GeneratedDocumentSerializer` (`GET /api/generated-documents/` returns an
 * array).
 */

export type GeneratedDocumentStatus = 'draft' | 'generated' | 'sent' | 'void'

export interface GeneratedDocument {
  id: number
  company_id: number
  document_type: number
  document_type_code: string
  client_id: number
  template_id: number
  document_number: string
  status: GeneratedDocumentStatus
  created_by_id: number | null
  created_at: string
  updated_at: string
}