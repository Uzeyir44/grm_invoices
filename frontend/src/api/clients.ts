import { apiClient } from './client'
import type {
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
 *
 * The company is always the authenticated user's company; no `company_id` is
 * ever sent from the client.
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