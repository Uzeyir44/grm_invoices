import { apiClient } from './client'
import type {
  ClientAddress,
  ClientAddressInput,
  ClientAddressUpdateInput,
  ClientBankAccount,
  ClientBankAccountInput,
  ClientBankAccountUpdateInput,
  ClientContact,
  ClientContactInput,
  ClientContactUpdateInput,
  ClientCreateInput,
  ClientDetail,
  ClientSummary,
  ClientsListParams,
  ClientUpdateInput,
} from '../types/client'

/**
 * Clients API slice, built on the generic {@link apiClient}.
 *
 * Endpoint contracts (verified against the Django backend in `apps/clients`):
 *   * `GET    /clients/`      → array of `ClientSummary`, supports `search`,
 *                               `status` and `client_type` query params. No
 *                               pagination (plain array).
 *   * `GET    /clients/:id/`  → `ClientDetail`
 *   * `POST   /clients/`      → create → `ClientDetail` (201)
 *   * `PATCH  /clients/:id/`  → partial update → `ClientDetail` (200)
 *   * `DELETE /clients/:id/`  → soft-delete → 204
 *   * `GET    /clients/:id/addresses/`            → array of `ClientAddress`
 *                               (plain array, no pagination)
 *   * `POST   /clients/:id/addresses/`            → create → `ClientAddress`
 *                               (201). GET needs `clients.read`; POST needs
 *                               `clients.update`.
 *   * `PATCH  /clients/:id/addresses/:aid/`      → partial update →
 *                               `ClientAddress` (200, needs `clients.update`)
 *   * `DELETE /clients/:id/addresses/:aid/`      → physical child delete →
 *                               204 (needs `clients.update`)
 *   * `GET    /clients/:id/contacts/`             → array of `ClientContact`
 *                               (plain array, no pagination)
 *   * `POST   /clients/:id/contacts/`             → create → `ClientContact`
 *                               (201). GET needs `clients.read`; POST needs
 *                               `clients.update`.
 *   * `PATCH  /clients/:id/contacts/:cid/`       → partial update →
 *                               `ClientContact` (200, needs `clients.update`)
 *   * `DELETE /clients/:id/contacts/:cid/`       → physical child delete →
 *                               204 (needs `clients.update`)
 *   * `GET    /clients/:id/bank-accounts/`        → array of `ClientBankAccount`
 *                               (plain array, no pagination)
 *   * `POST   /clients/:id/bank-accounts/`        → create → `ClientBankAccount`
 *                               (201). GET needs `clients.read`; POST needs
 *                               `clients.update`.
 *   * `PATCH  /clients/:id/bank-accounts/:aid/`  → partial update →
 *                               `ClientBankAccount` (200, needs
 *                               `clients.update`)
 *   * `DELETE /clients/:id/bank-accounts/:aid/`  → physical child delete →
 *                               204 (needs `clients.update`)
 *
 * The company is always the authenticated user's company; no `company_id` is
 * ever sent from the client. Nested rows are scoped by company *and* parent
 * client — a missing or cross-tenant client/address is a backend 404.
 */

export function listClients(params: ClientsListParams = {}): Promise<ClientSummary[]> {
  const query = new URLSearchParams()
  if (params.client_type) query.set('client_type', params.client_type)
  if (params.status) query.set('status', params.status)
  if (params.search && params.search.trim()) query.set('search', params.search.trim())
  const queryString = query.toString()
  return apiClient.get<ClientSummary[]>(`/clients/${queryString ? `?${queryString}` : ''}`)
}

/** Backwards-compatible alias used by the dashboard read-only list. */
export function fetchClients(): Promise<ClientSummary[]> {
  return listClients()
}

export function getClient(id: number): Promise<ClientDetail> {
  return apiClient.get<ClientDetail>(`/clients/${id}/`)
}

export function createClient(input: ClientCreateInput): Promise<ClientDetail> {
  return apiClient.post<ClientDetail>('/clients/', input)
}

export function updateClient(id: number, input: ClientUpdateInput): Promise<ClientDetail> {
  return apiClient.patch<ClientDetail>(`/clients/${id}/`, input)
}

export function deleteClient(id: number): Promise<void> {
  return apiClient.delete<void>(`/clients/${id}/`)
}

/** List a client's addresses (`GET /clients/:id/addresses/`, plain array). */
export function listClientAddresses(clientId: number): Promise<ClientAddress[]> {
  return apiClient.get<ClientAddress[]>(`/clients/${clientId}/addresses/`)
}

/** Create an address for a client (`POST /clients/:id/addresses/` → 201). */
export function createClientAddress(
  clientId: number,
  input: ClientAddressInput,
): Promise<ClientAddress> {
  return apiClient.post<ClientAddress>(`/clients/${clientId}/addresses/`, input)
}

/** Partially update an address (`PATCH /clients/:id/addresses/:aid/`). */
export function updateClientAddress(
  clientId: number,
  addressId: number,
  input: ClientAddressUpdateInput,
): Promise<ClientAddress> {
  return apiClient.patch<ClientAddress>(`/clients/${clientId}/addresses/${addressId}/`, input)
}

/** Physically delete an address (`DELETE /clients/:id/addresses/:aid/` → 204). */
export function deleteClientAddress(clientId: number, addressId: number): Promise<void> {
  return apiClient.delete<void>(`/clients/${clientId}/addresses/${addressId}/`)
}

/** List a client's contacts (`GET /clients/:id/contacts/`, plain array). */
export function listClientContacts(clientId: number): Promise<ClientContact[]> {
  return apiClient.get<ClientContact[]>(`/clients/${clientId}/contacts/`)
}

/** Create a contact for a client (`POST /clients/:id/contacts/` → 201). */
export function createClientContact(
  clientId: number,
  input: ClientContactInput,
): Promise<ClientContact> {
  return apiClient.post<ClientContact>(`/clients/${clientId}/contacts/`, input)
}

/** Partially update a contact (`PATCH /clients/:id/contacts/:cid/`). */
export function updateClientContact(
  clientId: number,
  contactId: number,
  input: ClientContactUpdateInput,
): Promise<ClientContact> {
  return apiClient.patch<ClientContact>(`/clients/${clientId}/contacts/${contactId}/`, input)
}

/** Physically delete a contact (`DELETE /clients/:id/contacts/:cid/` → 204). */
export function deleteClientContact(clientId: number, contactId: number): Promise<void> {
  return apiClient.delete<void>(`/clients/${clientId}/contacts/${contactId}/`)
}

/** List a client's bank accounts (`GET /clients/:id/bank-accounts/`, plain array). */
export function listClientBankAccounts(clientId: number): Promise<ClientBankAccount[]> {
  return apiClient.get<ClientBankAccount[]>(`/clients/${clientId}/bank-accounts/`)
}

/** Create a bank account for a client (`POST /clients/:id/bank-accounts/` → 201). */
export function createClientBankAccount(
  clientId: number,
  input: ClientBankAccountInput,
): Promise<ClientBankAccount> {
  return apiClient.post<ClientBankAccount>(`/clients/${clientId}/bank-accounts/`, input)
}

/** Partially update a bank account (`PATCH /clients/:id/bank-accounts/:aid/`). */
export function updateClientBankAccount(
  clientId: number,
  accountId: number,
  input: ClientBankAccountUpdateInput,
): Promise<ClientBankAccount> {
  return apiClient.patch<ClientBankAccount>(
    `/clients/${clientId}/bank-accounts/${accountId}/`,
    input,
  )
}

/** Physically delete a bank account (`DELETE /clients/:id/bank-accounts/:aid/` → 204). */
export function deleteClientBankAccount(clientId: number, accountId: number): Promise<void> {
  return apiClient.delete<void>(`/clients/${clientId}/bank-accounts/${accountId}/`)
}