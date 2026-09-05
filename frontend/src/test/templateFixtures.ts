import type { DocumentTemplate, TemplateVersion } from '../types/documentTemplate'
import type { DocumentType } from '../types/referenceData'

export function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

export const documentTypes: DocumentType[] = [
  { id: 1, code: 'invoice', name: 'Invoice' },
  { id: 2, code: 'consulting_contract', name: 'Consulting contract' },
]

export const templateSummaries: DocumentTemplate[] = [
  {
    id: 1,
    company_id: 10,
    document_type: 1,
    document_type_code: 'invoice',
    name: 'Standard Invoice',
    is_active: true,
    file: '/api/document-templates/1/file/',
    file_name: 'templates/company_10/1/current/abc123.docx',
    created_at: '2026-09-01T10:00:00+00:00',
    updated_at: '2026-09-02T10:00:00+00:00',
  },
  {
    id: 2,
    company_id: 10,
    document_type: 2,
    document_type_code: 'consulting_contract',
    name: 'Consulting Contract v2',
    is_active: true,
    file: null,
    file_name: null,
    created_at: '2026-09-03T10:00:00+00:00',
    updated_at: '2026-09-04T10:00:00+00:00',
  },
]

export const templateDetail: DocumentTemplate = templateSummaries[0]

export const templateVersions: TemplateVersion[] = [
  {
    id: 10,
    template_id: 1,
    company_id: 10,
    version_number: 1,
    is_active: false,
    file_name: 'templates/company_10/1/v1_aaaa.docx',
    has_file: true,
    checksum: 'abc123',
    created_by_id: 1,
    created_at: '2026-09-01T10:00:00+00:00',
  },
  {
    id: 11,
    template_id: 1,
    company_id: 10,
    version_number: 2,
    is_active: true,
    file_name: 'templates/company_10/1/v2_bbbb.docx',
    has_file: true,
    checksum: 'def456',
    created_by_id: 1,
    created_at: '2026-09-02T11:00:00+00:00',
  },
]

export const activeTemplateVersion: TemplateVersion = templateVersions[1]

/** A binary-ish response for the authenticated file-download endpoint. */
export function fileDownloadResponse(filename = 'template.docx'): Response {
  return new Response(new Blob(['fake-docx-bytes'], { type: 'application/octet-stream' }), {
    status: 200,
    headers: { 'Content-Disposition': `attachment; filename="${filename}"` },
  })
}