/**
 * Document template types, derived from the backend `DocumentTemplateSerializer`
 * (`GET /api/document-templates/` returns an array). `file` is the
 * authenticated download path (never a public storage URL), or null.
 */

export interface DocumentTemplate {
  id: number
  company_id: number
  document_type: number
  document_type_code: string
  name: string
  is_active: boolean
  file: string | null
  file_name: string | null
  created_at: string
  updated_at: string
}