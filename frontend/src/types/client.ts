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
 * Nested contacts (`ClientContactSerializer`, tenant- and parent-scoped):
 * * `GET /api/clients/:id/contacts/`           → array of `ClientContact`
 *                                                  (plain array, no pagination)
 * * `POST /api/clients/:id/contacts/`          → `ClientContact` (201)
 * * `PATCH /api/clients/:id/contacts/:cid/`    → `ClientContact` (200, partial)
 * * `DELETE /api/clients/:id/contacts/:cid/`   → 204 (physical child delete)
 *
 * Nested bank accounts (`ClientBankAccountSerializer`, tenant- and
 * parent-scoped):
 * * `GET /api/clients/:id/bank-accounts/`         → array of
 *                                                  `ClientBankAccount`
 *                                                  (plain array, no pagination)
 * * `POST /api/clients/:id/bank-accounts/`        → `ClientBankAccount` (201)
 * * `PATCH /api/clients/:id/bank-accounts/:aid/`  → `ClientBankAccount`
 *                                                  (200, partial)
 * * `DELETE /api/clients/:id/bank-accounts/:aid/` → 204 (physical child
 *                                                  delete)
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

/**
 * Contact inputs accepted by the nested contact serializer
 * (`ClientContactSerializer`). Writable fields only (`id` is read-only).
 * `full_name` is required; `position`/`phone`/`email` are nullable optionals
 * (`email` is validated as an email address); `is_primary` defaults to false
 * and the backend allows only one primary contact per client. No reference
 * data is involved — unlike addresses, contacts have no catalog FK.
 */
export interface ClientContactInput {
  full_name: string
  position?: string | null
  phone?: string | null
  email?: string | null
  is_primary?: boolean
}

/** Partial update accepted by `PATCH /api/clients/:id/contacts/:cid/`. */
export type ClientContactUpdateInput = Partial<ClientContactInput>

/**
 * Bank account inputs accepted by the nested bank account serializer
 * (`ClientBankAccountSerializer`). Writable fields only: `id`, `bank_name`
 * and `currency_code` are read-only. `bank` is the Bank id (optional —
 * nullable FK); `currency` is the Currency id (required); `iban` is required
 * (unique per client); `swift_bic` is an optional nullable code;
 * `is_default` defaults to false and the backend allows only one default
 * account per client.
 */
export interface ClientBankAccountInput {
  bank?: number | null
  currency: number
  iban: string
  swift_bic?: string | null
  is_default?: boolean
}

/** Partial update accepted by `PATCH /api/clients/:id/bank-accounts/:aid/`. */
export type ClientBankAccountUpdateInput = Partial<ClientBankAccountInput>

/** Backend-supported list query parameters (`GET /api/clients/`). */
export interface ClientsListParams {
  search?: string
  status?: ClientStatus
  client_type?: ClientType
}