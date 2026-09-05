/**
 * Document template types, derived from the actual Django
 * `apps/document_templates` serializers.
 *
 * * `GET /api/document-templates/`      → array of `DocumentTemplate`
 * * `GET /api/document-templates/:id/`  → `DocumentTemplate`
 * * `POST /api/document-templates/`     → `DocumentTemplate` (201)
 * * `DELETE /api/document-templates/:id/` → 204 (soft-delete)
 * * `GET /api/document-templates/:id/versions/` → array of `TemplateVersion`
 * * `POST /api/document-templates/:id/versions/` → `TemplateVersion` (201)
 * * `POST /api/document-templates/:id/versions/:vid/activate/`
 *                                    → `TemplateVersion` (single active version)
 *
 * The list response carries no pagination metadata: the backend returns the
 * caller's company-scoped templates as a plain array. `file` is the
 * authenticated download path (never a public storage URL), or null.
 * `file_name` is the stored file's storage-relative name and must be treated
 * as opaque metadata — never as a URL.
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

/** Immutable snapshot of a template's file (`TemplateVersionSerializer`). */
export interface TemplateVersion {
  id: number
  template_id: number
  company_id: number
  version_number: number
  is_active: boolean
  file_name: string | null
  has_file: boolean
  checksum: string | null
  created_by_id: number | null
  created_at: string
}

/** Body accepted by `POST /api/document-templates/`. */
export interface CreateTemplateInput {
  name: string
  document_type: number
  is_active?: boolean
}

/** Backend-supported list query parameter (`GET /api/document-templates/`). */
export interface TemplatesListParams {
  document_type?: string
}