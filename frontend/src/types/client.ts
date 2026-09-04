/**
 * Client list types, derived from the backend `ClientSummarySerializer`
 * (`GET /api/clients/` returns an array).
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