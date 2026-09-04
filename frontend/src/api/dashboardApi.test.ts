import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fetchClients } from './clients'
import { fetchDocumentTemplates } from './templates'
import { fetchGeneratedDocuments } from './documents'
import { setAccessToken } from '../utils/authStorage'

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('dashboard API modules', () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    localStorage.clear()
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('fetches company-scoped clients as an array with the expected shape', async () => {
    const payload = [
      { id: 7, client_type: 'legal_entity', status: 'active', display_name: 'Acme Ltd', company_id: 10 },
    ]
    fetchMock.mockResolvedValue(jsonResponse(200, payload))
    setAccessToken('token-1')

    const clients = await fetchClients()

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/api/clients/'),
      expect.objectContaining({ method: 'GET' }),
    )
    const headers = new Headers(
      (fetchMock.mock.calls[0] as [string, RequestInit])[1].headers,
    )
    expect(headers.get('Authorization')).toBe('Bearer token-1')
    expect(clients).toEqual(payload)
  })

  it('fetches document templates as an array from the list endpoint', async () => {
    const payload = [
      {
        id: 3,
        company_id: 10,
        document_type: 1,
        document_type_code: 'invoice',
        name: 'Standard Invoice',
        is_active: true,
        file: '/api/document-templates/3/file/',
        file_name: 'tpl.docx',
        created_at: '2026-09-01T10:00:00+00:00',
        updated_at: '2026-09-01T10:00:00+00:00',
      },
    ]
    fetchMock.mockResolvedValue(jsonResponse(200, payload))

    const templates = await fetchDocumentTemplates()

    expect(String(fetchMock.mock.calls[0][0])).toContain('/api/document-templates/')
    expect(templates).toEqual(payload)
  })

  it('fetches generated documents as an array from the list endpoint', async () => {
    const payload = [
      {
        id: 9,
        company_id: 10,
        document_type: 1,
        document_type_code: 'invoice',
        client_id: 1,
        template_id: 1,
        document_number: 'INV-001',
        status: 'draft',
        created_by_id: 1,
        created_at: '2026-09-01T10:00:00+00:00',
        updated_at: '2026-09-01T10:00:00+00:00',
      },
    ]
    fetchMock.mockResolvedValue(jsonResponse(200, payload))

    const documents = await fetchGeneratedDocuments()

    expect(String(fetchMock.mock.calls[0][0])).toContain('/api/generated-documents/')
    expect(documents).toEqual(payload)
  })
})