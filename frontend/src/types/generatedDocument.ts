/**
 * Generated document types, derived from the backend
 * `GeneratedDocumentSerializer` / `GeneratedDocumentCreateSerializer` /
 * `GeneratedDocumentVersionSerializer`
 * (`apps/generated_documents/api/serializers.py`).
 *
 * * `GET  /api/generated-documents/`               → array of `GeneratedDocument`
 * * `GET  /api/generated-documents/:id/`           → `GeneratedDocument`
 *                                        (same serializer as the list — the
 *                                        detail response carries the same
 *                                        metadata, no nested client/template/
 *                                        version/line-item data)
 * * `POST /api/generated-documents/`               → create → `GeneratedDocument` (201)
 * * `POST /api/generated-documents/:id/generate/`  → generate a DOCX →
 *                                        `GeneratedDocumentVersion` (201, synchronous)
 * * `GET  /api/generated-documents/:id/versions/`  → array of `GeneratedDocumentVersion`
 * * `GET  /api/generated-documents/versions/:versionId/docx/` → authenticated DOCX download
 *
 * The create body (`GeneratedDocumentCreateSerializer`) accepts only reference
 * ids (`client_id`, `document_type_id`), an optional-but-service-required
 * `currency_id` (creation fails without one), and an optional `items` array of
 * line-item inputs. Totals are computed server-side; they are never submitted.
 * A body-supplied `company_id` is ignored by the backend.
 */

export type GeneratedDocumentStatus = 'draft' | 'generated' | 'sent' | 'void'

export interface GeneratedDocument {
  id: number
  company_id: number
  document_type: number
  document_type_code: string
  /** Nullable on the backend — documents may exist without a client. */
  client_id: number | null
  /** Human-readable client label, or null when there is no client. */
  client_name: string | null
  template_id: number
  /** Human-readable template name. */
  template_name: string
  document_number: string
  status: GeneratedDocumentStatus
  created_by_id: number | null
  /** Full name of the creating user, or null (deleted user / system). */
  created_by_name: string | null
  created_at: string
  updated_at: string
}

export interface GeneratedDocumentVersionStorage {
  /** DOCX file exists for this version. */
  docx: boolean
  /** PDF file exists for this version. */
  pdf: boolean
}

/**
 * Immutable generated-version snapshot (`GeneratedDocumentVersionSerializer`).
 * `storage.docx`/`storage.pdf` report file availability as booleans; the
 * backend never exposes storage paths.
 */
export interface GeneratedDocumentVersion {
  id: number
  generated_document_id: number
  company_id: number
  version_number: number
  template_version_id: number
  currency_id: number
  exchange_rate_used: string | null
  vat_rate_used_percent: string | null
  generation_metadata: unknown
  storage: GeneratedDocumentVersionStorage
  generated_by_id: number | null
  created_at: string
}

/** One line-item input accepted by the create serializer. */
export interface GeneratedDocumentLineItemInput {
  description: string
  quantity: number
  unit?: string | null
  unit_price: number
  discount_percent?: number
  vat_rate_percent: number
}

/** Body accepted by `POST /api/generated-documents/`. */
export interface CreateGeneratedDocumentInput {
  client_id: number
  document_type_id: number
  currency_id: number
  items: GeneratedDocumentLineItemInput[]
}