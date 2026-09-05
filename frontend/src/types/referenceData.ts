/**
 * Reference-data catalog types, derived from the read-only Django
 * `apps/reference_data/api/serializers.py`. These catalogs are shared/global
 * (no company ownership); `GET /api/reference-data/document-types/` returns an
 * array of `DocumentType`.
 */

export interface DocumentType {
  id: number
  code: string
  name: string
}