import { apiClient } from './client'
import type { AddressType, Bank, Currency, DocumentType } from '../types/referenceData'

/**
 * Read-only reference-data catalog API slice, built on the generic
 * {@link apiClient}.
 *
 * Endpoint contracts (verified against the Django backend in `apps/reference_data`):
 *   * `GET /reference-data/document-types/` → array of `DocumentType`
 *     (`{ id, code, name }`), ordered by `code`.
 *   * `GET /reference-data/currencies/` → array of `Currency`
 *     (`{ id, code, name, minor_unit }`), ordered by `code`.
 *   * `GET /reference-data/address-types/` → array of `AddressType`
 *     (`{ id, code }`), ordered by `code`.
 *   * `GET /reference-data/banks/` → array of `Bank`
 *     (`{ id, name, swift_code, is_active }`), ordered by `name`.
 */
export function fetchDocumentTypes(): Promise<DocumentType[]> {
  return apiClient.get<DocumentType[]>('/reference-data/document-types/')
}

export function fetchCurrencies(): Promise<Currency[]> {
  return apiClient.get<Currency[]>('/reference-data/currencies/')
}

export function fetchAddressTypes(): Promise<AddressType[]> {
  return apiClient.get<AddressType[]>('/reference-data/address-types/')
}

export function fetchBanks(): Promise<Bank[]> {
  return apiClient.get<Bank[]>('/reference-data/banks/')
}