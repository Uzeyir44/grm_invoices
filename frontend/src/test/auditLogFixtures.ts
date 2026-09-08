import type { AuditLog, PaginatedAuditLogs } from '../types/auditLog'

export function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

export const auditLogs: AuditLog[] = [
  {
    id: 7,
    company_id: 10,
    user_id: 1,
    action: 'client.created',
    entity_type: 'client',
    entity_id: 3,
    previous_values: null,
    new_values: { display_name: 'Acme' },
    ip_address: '10.0.0.1',
    user_agent: 'TestAgent/1.0',
    request_id: '11111111-1111-4111-8111-111111111111',
    created_at: '2026-09-05T10:00:00+00:00',
  },
  {
    id: 6,
    company_id: 10,
    user_id: null,
    action: 'user.role_changed',
    entity_type: 'user',
    entity_id: 2,
    previous_values: { role: 'viewer' },
    new_values: { role: 'admin' },
    ip_address: null,
    user_agent: null,
    request_id: null,
    created_at: '2026-09-04T09:30:00+00:00',
  },
]

export function paginatedAuditLogs(
  results: AuditLog[] = auditLogs,
  overrides: Partial<PaginatedAuditLogs> = {},
): PaginatedAuditLogs {
  return {
    count: results.length,
    next: null,
    previous: null,
    results,
    ...overrides,
  }
}
