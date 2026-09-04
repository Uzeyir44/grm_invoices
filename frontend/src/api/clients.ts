import { apiClient } from './client'
import type { ClientSummary } from '../types/client'

/**
 * Client list read API (uses the existing `GET /api/clients/` endpoint).
 * The backend returns the caller's company-scoped clients as an array.
 */
export function fetchClients(): Promise<ClientSummary[]> {
  return apiClient.get<ClientSummary[]>('/clients/')
}