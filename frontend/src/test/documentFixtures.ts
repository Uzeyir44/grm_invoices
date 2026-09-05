import type { GeneratedDocument } from '../types/generatedDocument'

export function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

export const generatedDocuments: GeneratedDocument[] = [
  {
    id: 9,
    company_id: 10,
    document_type: 1,
    document_type_code: 'invoice',
    client_id: 1,
    template_id: 1,
    document_number: 'INV-001',
    status: 'generated',
    created_by_id: 1,
    created_at: '2026-09-04T10:00:00+00:00',
    updated_at: '2026-09-04T10:00:00+00:00',
  },
  {
    id: 10,
    company_id: 10,
    document_type: 2,
    document_type_code: 'consulting_contract',
    client_id: 2,
    template_id: 2,
    document_number: 'CC-001',
    status: 'draft',
    created_by_id: 2,
    created_at: '2026-09-05T12:00:00+00:00',
    updated_at: '2026-09-05T12:00:00+00:00',
  },
]