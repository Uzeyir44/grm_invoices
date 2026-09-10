import { apiClient } from './client'
import type {
  CreateGeneratedDocumentInput,
  GeneratedDocument,
  GeneratedDocumentVersion,
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
 *   * `GET /generated-documents/:id/` → `GeneratedDocument`. The detail view
 *     uses the same `GeneratedDocumentSerializer` as the list, so it returns
 *     the same metadata (no nested client/template/version/line-item data).
 *   * `POST /generated-documents/` → create a document (automatic numbering +
 *     initial draft version + optional line items). Body follows
 *     `GeneratedDocumentCreateSerializer`: `client_id`, `document_type_id`,
 *     `currency_id`, `items?`. Returns `GeneratedDocument` (201). The generic
 *     client passes DRF field/nested validation errors through as a typed
 *     {@link ApiError}; a missing/cross-company client is a 404. Retained for
 *     backward compatibility; the creation form no longer calls it.
 *   * `POST /generated-documents/generate-from-input/` → **atomic Generate** —
 *     creates the document (automatic numbering + version 1 + optional line
 *     items) **and** generates its DOCX + PDF in one backend transaction.
 *     Same body as the create endpoint. Returns the created
 *     `GeneratedDocument` (201, status `generated`). A failed generation
 *     persists nothing: no document, no version, no line items, no audit
 *     record, no consumed document number, no orphan files.
 *   * `POST /generated-documents/:id/generate/` → **DOCX generation** —
 *     synchronous. No body is required (an optional `currency_id` is
 *     accepted; omitted when unknown). Returns the created
 *     `GeneratedDocumentVersion` (201) with `storage.docx` true. Regenerating
 *     creates a new version.
 *   * `GET /generated-documents/:id/versions/` → array of
 *     `GeneratedDocumentVersion`, ordered by `version_number`.
 *   * `GET /generated-documents/versions/:versionId/docx/` → authenticated
 *     DOCX download (binary, `Content-Disposition` attachment, DOCX MIME).
 *     Requires a **version** id — the detail serializer exposes no version ids.
 *   * `POST /generated-documents/versions/:versionId/generate-pdf/` →
 *     **PDF generation** — synchronous conversion of an already-generated
 *     DOCX *version* to PDF; no body is consumed. Returns the
 *     `GeneratedDocumentVersion` with `storage.pdf` true (503 when the
 *     LibreOffice conversion runtime is unavailable, 400 on conversion
 *     failure). Requires a **version** id.
 *   * `GET /generated-documents/versions/:versionId/pdf/` → authenticated
 *     PDF download (binary, `Content-Disposition` attachment, `application/pdf`).
 *
 * The company is never sent from the client — the backend derives it from the
 * authenticated user's tenant (a body `company_id` is ignored).
 */

const DEFAULT_DOCX_FILENAME = 'document.docx'
const DEFAULT_PDF_FILENAME = 'document.pdf'

function filenameFromContentDisposition(response: Response): string | null {
  const value = response.headers.get('Content-Disposition')
  if (!value) return null
  const match = /filename="?([^";]+)"?/.exec(value)
  return match ? match[1] : null
}

export function listGeneratedDocuments(): Promise<GeneratedDocument[]> {
  return apiClient.get<GeneratedDocument[]>('/generated-documents/')
}

/** Backwards-compatible alias used by the dashboard recent-documents section. */
export function fetchGeneratedDocuments(): Promise<GeneratedDocument[]> {
  return listGeneratedDocuments()
}

/** Fetch one document by its backend identifier (`GET /generated-documents/:id/`). */
export function getGeneratedDocument(id: number): Promise<GeneratedDocument> {
  return apiClient.get<GeneratedDocument>(`/generated-documents/${id}/`)
}

/** Generate (and persist) a DOCX synchronously (`POST /generated-documents/:id/generate/`). */
export function generateDocumentDocx(id: number): Promise<GeneratedDocumentVersion> {
  return apiClient.post<GeneratedDocumentVersion>(`/generated-documents/${id}/generate/`, {})
}

/**
 * Generate a PDF for an already-generated DOCX version, synchronously
 * (`POST /generated-documents/versions/:versionId/generate-pdf/`). No body is
 * consumed by the backend.
 */
export function generateGeneratedDocumentPdf(versionId: number): Promise<GeneratedDocumentVersion> {
  return apiClient.post<GeneratedDocumentVersion>(
    `/generated-documents/versions/${versionId}/generate-pdf/`,
    {},
  )
}

/** List a document's generated versions (`GET /generated-documents/:id/versions/`). */
export function listGeneratedDocumentVersions(id: number): Promise<GeneratedDocumentVersion[]> {
  return apiClient.get<GeneratedDocumentVersion[]>(`/generated-documents/${id}/versions/`)
}

export interface DocumentDownload {
  blob: Blob
  filename: string
}

type VersionFileKind = 'docx' | 'pdf'

const FILE_PATH_SEGMENT: Record<VersionFileKind, string> = { docx: 'docx', pdf: 'pdf' }

async function downloadVersionFile(
  versionId: number,
  kind: VersionFileKind,
  fallbackFilename: string,
): Promise<DocumentDownload> {
  const response = await apiClient.raw(`/generated-documents/versions/${versionId}/${FILE_PATH_SEGMENT[kind]}/`)
  const blob = await response.blob()
  return {
    blob,
    filename: filenameFromContentDisposition(response) ?? fallbackFilename,
  }
}

/**
 * Download a document version's DOCX through the authenticated endpoint
 * (`GET /generated-documents/versions/:versionId/docx/`). The filename is taken
 * from the response's `Content-Disposition` when present, falling back to
 * `fallbackFilename`. Never a `/media/...` URL, never a token in a URL.
 */
export function downloadGeneratedDocumentDocx(
  versionId: number,
  fallbackFilename: string = DEFAULT_DOCX_FILENAME,
): Promise<DocumentDownload> {
  return downloadVersionFile(versionId, 'docx', fallbackFilename)
}

/**
 * Download a document version's PDF through the authenticated endpoint
 * (`GET /generated-documents/versions/:versionId/pdf/`). The filename is taken
 * from the response's `Content-Disposition` when present, falling back to
 * `fallbackFilename`. Never a `/media/...` URL, never a token in a URL.
 */
export function downloadGeneratedDocumentPdf(
  versionId: number,
  fallbackFilename: string = DEFAULT_PDF_FILENAME,
): Promise<DocumentDownload> {
  return downloadVersionFile(versionId, 'pdf', fallbackFilename)
}

export function createGeneratedDocument(
  input: CreateGeneratedDocumentInput,
): Promise<GeneratedDocument> {
  return apiClient.post<GeneratedDocument>('/generated-documents/', input)
}

/**
 * Atomically create a document from form input and generate its DOCX + PDF
 * (`POST /generated-documents/generate-from-input/`). The backend commits the
 * document (status `generated`, version 1 with both files) only when the whole
 * operation succeeds; a failure leaves no persistent draft behind. Returns the
 * created `GeneratedDocument` (201).
 */
export function generateDocumentFromInput(
  input: CreateGeneratedDocumentInput,
): Promise<GeneratedDocument> {
  return apiClient.post<GeneratedDocument>('/generated-documents/generate-from-input/', input)
}