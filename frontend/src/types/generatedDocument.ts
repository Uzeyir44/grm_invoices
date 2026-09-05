/**
 * Generated document types, derived from the backend
 * `GeneratedDocumentSerializer` / `GeneratedDocumentCreateSerializer`
 * (`apps/generated_documents/api/serializers.py`).
 *
 * * `GET  /api/generated-documents/`      → array of `GeneratedDocument`
 * * `POST /api/generated-documents/`      → create → `GeneratedDocument` (201)
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
  client_id: number
  template_id: number
  document_number: string
  status: GeneratedDocumentStatus
  created_by_id: number | null
  created_at: string
  updated_at: string
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