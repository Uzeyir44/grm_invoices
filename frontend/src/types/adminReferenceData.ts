/**
 * Admin reference-data contract types, derived from the actual backend
 * `apps/system_admin/api/reference_data_serializers.py`.
 *
 * Reference data is global — none of these carry a `company_id`. Decimal and
 * date fields are serialized as strings by DRF.
 */

export interface AdminCurrency {
  id: number
  code: string
  name: string
  minor_unit: number
}

export interface AdminDocumentType {
  id: number
  code: string
  name: string
}

export interface AdminAddressType {
  id: number
  code: string
}

export interface AdminVatRate {
  id: number
  name: string
  rate_percent: string
  valid_from: string
  valid_to: string | null
}

export interface AdminBank {
  id: number
  name: string
  swift_code: string | null
  is_active: boolean
}

export interface AdminExchangeRate {
  id: number
  from_currency_id: number
  to_currency_id: number
  rate: string
  effective_at: string
}

export interface CurrencyInput {
  code: string
  name: string
  minor_unit: number
}

export interface DocumentTypeInput {
  code: string
  name: string
}

export interface AddressTypeInput {
  code: string
}

export interface VatRateInput {
  name: string
  rate_percent: string
  valid_from: string
  valid_to: string | null
}

export interface BankInput {
  name: string
  swift_code: string | null
}
