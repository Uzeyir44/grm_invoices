/**
 * Reference-data catalog types, derived from the read-only Django
 * `apps/reference_data/api/serializers.py`. These catalogs are shared/global
 * (no company ownership).
 */

export interface DocumentType {
  id: number
  code: string
  name: string
}

/** `GET /api/reference-data/currencies/` populates document currency selects. */
export interface Currency {
  id: number
  code: string
  name: string
  minor_unit: number
}

/**
 * `GET /api/reference-data/address-types/` populates client address-type
 * selects (`{ id, code }`, ordered by `code`). The address serializer takes
 * the type *id*; the read-only `address_type_code` comes back on the row.
 */
export interface AddressType {
  id: number
  code: string
}