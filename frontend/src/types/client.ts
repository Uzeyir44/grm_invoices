/**
 * Client types, derived from the actual Django `apps/clients` serializers.
 *
 * * `GET /api/clients/`        → array of `ClientSummary`
 *                                  (`ClientSummarySerializer`)
 * * `GET /api/clients/:id/`    → `ClientDetail` (`ClientSerializer`)
 * * `POST /api/clients/`       → `ClientDetail` (201)
 * * `PATCH /api/clients/:id/`  → `ClientDetail` (200, partial update)
 * * `DELETE /api/clients/:id/` → 204 (soft-delete: sets `deleted_at`)
 *
 * Nested addresses (`ClientAddressSerializer`, tenant- and parent-scoped):
 * * `GET /api/clients/:id/addresses/`          → array of `ClientAddress`
 *                                                  (plain array, no pagination)
 * * `POST /api/clients/:id/addresses/`         → `ClientAddress` (201)
 * * `PATCH /api/clients/:id/addresses/:aid/`   → `ClientAddress` (200, partial)
 * * `DELETE /api/clients/:id/addresses/:aid/`  → 204 (physical child delete)
 *
 * The list response carries no pagination metadata: the backend returns the
 * caller's company-scoped clients as a plain array.
 */

export type ClientType = 'individual' | 'legal_entity'
export type ClientStatus = 'active' | 'inactive' | 'archived'

export interface ClientSummary {
  id: number
  client_type: ClientType
  status: ClientStatus
  display_name: string
  company_id: number
}

export interface ClientIndividual {
  first_name: string
  last_name: string
  middle_name: string | null
  date_of_birth: string | null
}

export interface ClientLegalEntity {
  legal_name: string
  trading_name: string | null
  voen: string
  registration_number: string | null
  registration_date: string | null
}

export interface ClientAddress {
  id: number
  address_type: number
  address_type_code: string
  line1: string
  line2: string | null
  city: string | null
  region: string | null
  postal_code: string | null
  country_code: string
  is_primary: boolean
}

export interface ClientContact {
  id: number
  full_name: string
  position: string | null
  phone: string | null
  email: string | null
  is_primary: boolean
}

export interface ClientBankAccount {
  id: number
  bank: number | null
  bank_name: string | null
  currency: number
  currency_code: string | null
  iban: string
  swift_bic: string | null
  is_default: boolean
}

export interface ClientDetail {
  id: number
  client_type: ClientType
  status: ClientStatus
  company_id: number
  individual: ClientIndividual | null
  legal_entity: ClientLegalEntity | null
  addresses: ClientAddress[]
  contacts: ClientContact[]
  bank_accounts: ClientBankAccount[]
  created_at: string
}

/** Individual subtype inputs accepted by the create/update serializer. */
export interface ClientIndividualInput {
  first_name: string
  last_name: string
  middle_name?: string | null
  date_of_birth?: string | null
}

/** Legal-entity subtype inputs accepted by the create/update serializer. */
export interface ClientLegalEntityInput {
  legal_name: string
  trading_name?: string | null
  voen: string
  registration_number?: string | null
  registration_date?: string | null
}

export interface ClientCreateInput {
  client_type: ClientType
  status?: ClientStatus
  individual?: ClientIndividualInput | null
  legal_entity?: ClientLegalEntityInput | null
}

export type ClientUpdateInput = Partial<ClientCreateInput>

/**
 * Address inputs accepted by the nested address serializer
 * (`ClientAddressSerializer`). Writable fields only: `id` and
 * `address_type_code` are read-only. `address_type` is the AddressType id
 * (required on create); `line1` is required; `country_code` falls back to
 * the backend default (`AZ`) when omitted — it is not nullable, so an empty
 * value must be omitted rather than sent as `null`.
 */
export interface ClientAddressInput {
  address_type: number
  line1: string
  line2?: string | null
  city?: string | null
  region?: string | null
  postal_code?: string | null
  country_code?: string | null
  is_primary?: boolean
}

/** Partial update accepted by `PATCH /api/clients/:id/addresses/:aid/`. */
export type ClientAddressUpdateInput = Partial<ClientAddressInput>

/** Backend-supported list query parameters (`GET /api/clients/`). */
export interface ClientsListParams {
  search?: string
  status?: ClientStatus
  client_type?: ClientType
}