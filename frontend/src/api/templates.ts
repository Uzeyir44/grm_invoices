import { apiClient } from './client'
import type {
  CreateTemplateInput,
  DocumentTemplate,
  TemplateVersion,
  TemplatesListParams,
  UpdateTemplateInput,
} from '../types/documentTemplate'

/**
 * Document template API slice, built on the generic {@link apiClient}.
 *
 * Endpoint contracts (verified against the Django backend in
 * `apps/document_templates/api/`):
 *   * `GET    /document-templates/`      → array of `DocumentTemplate`
 *                                          (plain array, **no pagination**).
 *                                          Supports the `document_type` query
 *                                          param (foreign-key id filter). No
 *                                          search/ordering params.
 *   * `POST   /document-templates/`      → create → `DocumentTemplate` (201)
 *   * `GET    /document-templates/:id/`  → `DocumentTemplate`
 *   * `PATCH  /document-templates/:id/`  → partial metadata update
 *                                          (`name`, `document_type`,
 *                                          `is_active`) → `DocumentTemplate`
 *                                          (200). `company_id` in the payload
 *                                          is ignored — the backend keeps the
 *                                          authenticated user's company.
 *   * `DELETE /document-templates/:id/`  → soft-delete → 204
 *   * `GET    /document-templates/:id/file/`  → authenticated file download
 *                                          (binary, `Content-Disposition`
 *                                          attachment)
 *   * `POST   /document-templates/:id/file/`  → upload / replace the current
 *                                          `.docx` (multipart `file`) → 201
 *   * `DELETE /document-templates/:id/file/`  → remove the file → 204
 *   * `GET    /document-templates/:id/versions/` → array of `TemplateVersion`,
 *                                          ordered by `version_number`
 *   * `GET    /document-templates/:id/versions/:versionId/`
 *                                          → single `TemplateVersion`
 *                                          (tenant-scoped; the version must
 *                                          belong to the template, otherwise
 *                                          404)
 *   * `POST   /document-templates/:id/versions/` → snapshot the current file as
 *                                          a new version (auto-activated) → 201
 *   * `POST   /document-templates/:id/versions/:versionId/activate/`
 *                                          → make that version active → 200
 *
 * The company is never sent from the client — the backend derives it from the
 * authenticated user. `file_name` values are opaque storage metadata (the
 * frontend never constructs `/media/...` URLs); downloads go through the
 * authenticated file endpoint.
 */

export function listTemplates(params: TemplatesListParams = {}): Promise<DocumentTemplate[]> {
  const query = new URLSearchParams()
  if (params.document_type && params.document_type.trim()) {
    query.set('document_type', params.document_type.trim())
  }
  const queryString = query.toString()
  return apiClient.get<DocumentTemplate[]>(
    `/document-templates/${queryString ? `?${queryString}` : ''}`,
  )
}

/** Backwards-compatible alias used by the dashboard read-only list. */
export function fetchDocumentTemplates(): Promise<DocumentTemplate[]> {
  return listTemplates()
}

export function getTemplate(id: number): Promise<DocumentTemplate> {
  return apiClient.get<DocumentTemplate>(`/document-templates/${id}/`)
}

export function createTemplate(input: CreateTemplateInput): Promise<DocumentTemplate> {
  return apiClient.post<DocumentTemplate>('/document-templates/', input)
}

/**
 * Partially update a template's metadata
 * (`PATCH /api/document-templates/:id/` → `DocumentTemplate`, 200).
 *
 * Only `name`, `document_type`, and `is_active` are writable (the backend
 * serializer runs with `partial=True`; any subset may be sent). The caller
 * must never include `company_id` / `tenant_id` / `organization_id` — the
 * backend derives the company from the authenticated user and ignores a
 * client-sent company. Backend validation failures surface as a typed
 * `ApiError` with `fieldErrors` (e.g. `{ name: [...] }`).
 */
export function updateTemplate(id: number, input: UpdateTemplateInput): Promise<DocumentTemplate> {
  return apiClient.patch<DocumentTemplate>(`/document-templates/${id}/`, input)
}

export function deleteTemplate(id: number): Promise<void> {
  return apiClient.delete<void>(`/document-templates/${id}/`)
}

export function deleteTemplateFile(id: number): Promise<void> {
  return apiClient.delete<void>(`/document-templates/${id}/file/`)
}

export function uploadTemplateFile(id: number, file: File): Promise<{ id: number; file_name: string | null }> {
  const form = new FormData()
  form.append('file', file)
  // Multipart boundary is left to the browser; never set Content-Type manually.
  return apiClient.post<{ id: number; file_name: string | null }>(
    `/document-templates/${id}/file/`,
    form,
  )
}

export interface TemplateDownload {
  blob: Blob
  filename: string
}

const DEFAULT_DOWNLOAD_FILENAME = 'template.docx'

function filenameFromContentDisposition(response: Response): string | null {
  const value = response.headers.get('Content-Disposition')
  if (!value) return null
  const match = /filename="?([^";]+)"?/.exec(value)
  return match ? match[1] : null
}

/** Download the authenticated template file as a `Blob` plus its filename. */
export async function downloadTemplateFile(id: number): Promise<TemplateDownload> {
  const response = await apiClient.raw(`/document-templates/${id}/file/`)
  const blob = await response.blob()
  return {
    blob,
    filename: filenameFromContentDisposition(response) ?? DEFAULT_DOWNLOAD_FILENAME,
  }
}

export function listTemplateVersions(id: number): Promise<TemplateVersion[]> {
  return apiClient.get<TemplateVersion[]>(`/document-templates/${id}/versions/`)
}

/**
 * Retrieve a single immutable version
 * (`GET /api/document-templates/:templateId/versions/:versionId/` → 200).
 *
 * The backend response is the read-only `TemplateVersionSerializer`; the
 * lookup is tenant-scoped and constrained to the parent template, so a
 * missing, cross-tenant, or mismatched version surfaces as 404. This is a
 * pure GET — no tenant/company identifiers are ever sent.
 */
export function getTemplateVersion(templateId: number, versionId: number): Promise<TemplateVersion> {
  return apiClient.get<TemplateVersion>(
    `/document-templates/${templateId}/versions/${versionId}/`,
  )
}

export function createTemplateVersion(id: number): Promise<TemplateVersion> {
  return apiClient.post<TemplateVersion>(`/document-templates/${id}/versions/`)
}

export function activateTemplateVersion(templateId: number, versionId: number): Promise<TemplateVersion> {
  return apiClient.post<TemplateVersion>(
    `/document-templates/${templateId}/versions/${versionId}/activate/`,
  )
}