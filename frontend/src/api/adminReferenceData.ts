import { adminApiClient } from './adminClient'
import type {
  AdminAddressType,
  AdminBank,
  AdminCurrency,
  AdminDocumentType,
  AdminExchangeRate,
  AdminVatRate,
  AddressTypeInput,
  BankInput,
  CurrencyInput,
  DocumentTypeInput,
  VatRateInput,
} from '../types/adminReferenceData'

/**
 * System Admin reference-data API slice (`/api/admin/reference-data/...`).
 *
 * Reference data is global (no tenant scoping) and gated by
 * `system.reference.manage`. Create/update/delete are supported for
 * currencies, document types, address types, and VAT rates; banks support
 * create/update + activate/deactivate; exchange rates are read-only.
 */

// --------------------------------------------------------------------------
// Currencies
// --------------------------------------------------------------------------
export function listAdminCurrencies(): Promise<AdminCurrency[]> {
  return adminApiClient.get<AdminCurrency[]>('/admin/reference-data/currencies/')
}
export function createAdminCurrency(input: CurrencyInput): Promise<AdminCurrency> {
  return adminApiClient.post<AdminCurrency>('/admin/reference-data/currencies/', input)
}
export function updateAdminCurrency(
  id: number,
  input: Partial<CurrencyInput>,
): Promise<AdminCurrency> {
  return adminApiClient.patch<AdminCurrency>(
    `/admin/reference-data/currencies/${id}/`,
    input,
  )
}
export function deleteAdminCurrency(id: number): Promise<void> {
  return adminApiClient.delete<void>(`/admin/reference-data/currencies/${id}/`)
}

// --------------------------------------------------------------------------
// Document types
// --------------------------------------------------------------------------
export function listAdminDocumentTypes(): Promise<AdminDocumentType[]> {
  return adminApiClient.get<AdminDocumentType[]>(
    '/admin/reference-data/document-types/',
  )
}
export function createAdminDocumentType(
  input: DocumentTypeInput,
): Promise<AdminDocumentType> {
  return adminApiClient.post<AdminDocumentType>(
    '/admin/reference-data/document-types/',
    input,
  )
}
export function updateAdminDocumentType(
  id: number,
  input: Partial<DocumentTypeInput>,
): Promise<AdminDocumentType> {
  return adminApiClient.patch<AdminDocumentType>(
    `/admin/reference-data/document-types/${id}/`,
    input,
  )
}
export function deleteAdminDocumentType(id: number): Promise<void> {
  return adminApiClient.delete<void>(
    `/admin/reference-data/document-types/${id}/`,
  )
}

// --------------------------------------------------------------------------
// Address types
// --------------------------------------------------------------------------
export function listAdminAddressTypes(): Promise<AdminAddressType[]> {
  return adminApiClient.get<AdminAddressType[]>(
    '/admin/reference-data/address-types/',
  )
}
export function createAdminAddressType(
  input: AddressTypeInput,
): Promise<AdminAddressType> {
  return adminApiClient.post<AdminAddressType>(
    '/admin/reference-data/address-types/',
    input,
  )
}
export function updateAdminAddressType(
  id: number,
  input: Partial<AddressTypeInput>,
): Promise<AdminAddressType> {
  return adminApiClient.patch<AdminAddressType>(
    `/admin/reference-data/address-types/${id}/`,
    input,
  )
}
export function deleteAdminAddressType(id: number): Promise<void> {
  return adminApiClient.delete<void>(
    `/admin/reference-data/address-types/${id}/`,
  )
}

// --------------------------------------------------------------------------
// VAT rates
// --------------------------------------------------------------------------
export function listAdminVatRates(): Promise<AdminVatRate[]> {
  return adminApiClient.get<AdminVatRate[]>('/admin/reference-data/vat-rates/')
}
export function createAdminVatRate(input: VatRateInput): Promise<AdminVatRate> {
  return adminApiClient.post<AdminVatRate>('/admin/reference-data/vat-rates/', input)
}
export function updateAdminVatRate(
  id: number,
  input: Partial<VatRateInput>,
): Promise<AdminVatRate> {
  return adminApiClient.patch<AdminVatRate>(
    `/admin/reference-data/vat-rates/${id}/`,
    input,
  )
}
export function deleteAdminVatRate(id: number): Promise<void> {
  return adminApiClient.delete<void>(`/admin/reference-data/vat-rates/${id}/`)
}

// --------------------------------------------------------------------------
// Banks
// --------------------------------------------------------------------------
export function listAdminBanks(): Promise<AdminBank[]> {
  return adminApiClient.get<AdminBank[]>('/admin/reference-data/banks/')
}
export function createAdminBank(input: BankInput): Promise<AdminBank> {
  return adminApiClient.post<AdminBank>('/admin/reference-data/banks/', input)
}
export function updateAdminBank(
  id: number,
  input: Partial<BankInput>,
): Promise<AdminBank> {
  return adminApiClient.patch<AdminBank>(`/admin/reference-data/banks/${id}/`, input)
}
export function activateAdminBank(id: number): Promise<AdminBank> {
  return adminApiClient.post<AdminBank>(`/admin/reference-data/banks/${id}/activate/`)
}
export function deactivateAdminBank(id: number): Promise<AdminBank> {
  return adminApiClient.post<AdminBank>(
    `/admin/reference-data/banks/${id}/deactivate/`,
  )
}

// --------------------------------------------------------------------------
// Exchange rates (read-only feed)
// --------------------------------------------------------------------------
export function listAdminExchangeRates(): Promise<AdminExchangeRate[]> {
  return adminApiClient.get<AdminExchangeRate[]>(
    '/admin/reference-data/exchange-rates/',
  )
}
