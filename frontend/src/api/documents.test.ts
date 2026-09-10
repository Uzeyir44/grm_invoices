import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createGeneratedDocument,
  downloadGeneratedDocumentDocx,
  downloadGeneratedDocumentPdf,
  fetchGeneratedDocuments,
  generateDocumentDocx,
  generateDocumentFromInput,
  generateGeneratedDocumentPdf,
  getGeneratedDocument,
  listGeneratedDocumentVersions,
  listGeneratedDocuments,
  previewGeneratedDocument,
} from './documents'
import { generatedDocuments, jsonResponse } from '../test/documentFixtures'
import { ApiError, HTTP_STATUS } from '../types/api'
import { setAccessToken } from '../utils/authStorage'
import type { CreateGeneratedDocumentInput, GeneratedDocumentVersion } from '../types/generatedDocument'

export const generatedVersion: GeneratedDocumentVersion = {
  id: 21,
  generated_document_id: 9,
  company_id: 10,
  version_number: 1,
  template_version_id: 3,
  currency_id: 1,
  exchange_rate_used: null,
  vat_rate_used_percent: '18.00',
  generation_metadata: { engine_version: '4.4' },
  storage: { docx: true, pdf: false },
  generated_by_id: 1,
  created_at: '2026-09-05T10:00:00+00:00',
}

function docxDownloadResponse(filename = 'INV-001-v1.docx'): Response {
  return new Response(new Blob(['fake-docx'], { type: 'application/octet-stream' }), {
    status: 200,
    headers: { 'Content-Disposition': `attachment; filename="${filename}"` },
  })
}

function pdfDownloadResponse(filename = 'INV-001-v1.pdf'): Response {
  return new Response(new Blob(['%PDF-fake'], { type: 'application/pdf' }), {
    status: 200,
    headers: { 'Content-Disposition': `attachment; filename="${filename}"` },
  })
}

describe('documents API', () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    localStorage.clear()
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('lists generated documents from the endpoint with no parameters', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, generatedDocuments))
    setAccessToken('token-1')

    const result = await listGeneratedDocuments()

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/generated-documents/')
    expect(init.method).toBe('GET')
    expect(new Headers(init.headers).get('Authorization')).toBe('Bearer token-1')
    expect(result).toEqual(generatedDocuments)
  })

  it('sends no query parameters for the list', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, []))

    await listGeneratedDocuments()

    const [url] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url.includes('?')).toBe(false)
  })

  it('keeps fetchGeneratedDocuments as a compatible alias for the dashboard', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, generatedDocuments))

    const result = await fetchGeneratedDocuments()

    expect(String(fetchMock.mock.calls[0][0])).toBe('/api/generated-documents/')
    expect(result).toEqual(generatedDocuments)
  })

  it('converts a failed request into a typed ApiError', async () => {
    fetchMock.mockResolvedValue(jsonResponse(403, { detail: 'Missing required permission: generated_documents.read' }))

    await expect(listGeneratedDocuments()).rejects.toMatchObject({
      status: HTTP_STATUS.FORBIDDEN,
    })
    await expect(listGeneratedDocuments()).rejects.toBeInstanceOf(ApiError)
  })

  it('creates a document with the create serializer body', async () => {
    fetchMock.mockResolvedValue(jsonResponse(201, generatedDocuments[0]))

    const body: CreateGeneratedDocumentInput = {
      client_id: 1,
      document_type_id: 2,
      currency_id: 1,
      items: [
        {
          description: 'Consulting hours',
          quantity: 10,
          unit_price: 100,
          vat_rate_percent: 18,
          unit: 'hour',
          discount_percent: 0,
        },
      ],
    }
    const result = await createGeneratedDocument(body)

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/generated-documents/')
    expect(init.method).toBe('POST')
    expect(JSON.parse(String(init.body))).toEqual(body)
    expect(result).toEqual(generatedDocuments[0])
  })

  it('never sends a company_id in the create payload', async () => {
    fetchMock.mockResolvedValue(jsonResponse(201, generatedDocuments[0]))

    await createGeneratedDocument({
      client_id: 1,
      document_type_id: 2,
      currency_id: 1,
      items: [],
    })

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    const body = JSON.parse(String(init.body)) as Record<string, unknown>
    expect(body.company_id).toBeUndefined()
    expect(body.company).toBeUndefined()
  })

  it('preserves backend field validation errors on the create endpoint', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(400, {
        client_id: ['This field is required.'],
        items: [{ quantity: ['A valid number is required.'] }],
      }),
    )

    const error = await createGeneratedDocument({
      client_id: 0,
      document_type_id: 2,
      currency_id: 1,
      items: [],
    }).catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(ApiError)
    const apiError = error as ApiError
    expect(apiError.status).toBe(HTTP_STATUS.BAD_REQUEST)
    expect(apiError.fieldErrors.client_id).toEqual(['This field is required.'])
    expect(apiError.fieldErrors['items.0.quantity']).toEqual(['A valid number is required.'])
  })

  it('generates a document from input via the atomic endpoint with one request', async () => {
    fetchMock.mockResolvedValue(jsonResponse(201, generatedDocuments[0]))

    const body: CreateGeneratedDocumentInput = {
      client_id: 1,
      document_type_id: 2,
      currency_id: 1,
      items: [
        {
          description: 'Consulting hours',
          quantity: 10,
          unit_price: 100,
          vat_rate_percent: 18,
          unit: 'hour',
          discount_percent: 0,
        },
      ],
    }
    const result = await generateDocumentFromInput(body)

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/generated-documents/generate-from-input/')
    expect(init.method).toBe('POST')
    expect(JSON.parse(String(init.body))).toEqual(body)
    expect(fetchMock.mock.calls).toHaveLength(1)
    expect(result).toEqual(generatedDocuments[0])
  })

  it('renders a preview PDF via the authenticated preview endpoint', async () => {
    fetchMock.mockResolvedValue(
      new Response(new Blob(['%PDF-preview'], { type: 'application/pdf' }), {
        status: 200,
        headers: { 'Content-Type': 'application/pdf' },
      }),
    )
    setAccessToken('token-1')

    const body: CreateGeneratedDocumentInput = {
      client_id: 1,
      document_type_id: 2,
      currency_id: 1,
      items: [{ description: 'Consulting hours', quantity: 10, unit_price: 100, vat_rate_percent: 18 }],
    }
    const result = await previewGeneratedDocument(body)

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/generated-documents/preview/')
    expect(init.method).toBe('POST')
    expect(new Headers(init.headers).get('Authorization')).toBe('Bearer token-1')
    expect(new Headers(init.headers).get('Accept')).toBe('*/*')
    expect(JSON.parse(String(init.body))).toEqual(body)
    expect(result).toBeInstanceOf(Blob)
  })

  it('propagates a preview failure as a typed ApiError', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(503, { detail: 'PDF preview is currently unavailable.' }),
    )

    await expect(
      previewGeneratedDocument({
        client_id: 1,
        document_type_id: 2,
        currency_id: 1,
        items: [],
      }),
    ).rejects.toMatchObject({ status: 503 })
  })

  it('propagates an atomic generation failure as a typed ApiError', async () => {
    fetchMock.mockResolvedValue(jsonResponse(400, { detail: 'Document generation failed.' }))

    await expect(
      generateDocumentFromInput({
        client_id: 1,
        document_type_id: 2,
        currency_id: 1,
        items: [],
      }),
    ).rejects.toMatchObject({ status: HTTP_STATUS.BAD_REQUEST })
  })

  it('fetches a single document from the detail endpoint', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, generatedDocuments[0]))
    setAccessToken('token-1')

    const result = await getGeneratedDocument(9)

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/generated-documents/9/')
    expect(init.method).toBe('GET')
    expect(new Headers(init.headers).get('Authorization')).toBe('Bearer token-1')
    expect(result).toEqual(generatedDocuments[0])
  })

  it('converts a 404 detail response into a typed ApiError', async () => {
    fetchMock.mockResolvedValue(jsonResponse(404, { detail: 'No GeneratedDocument matches the given query.' }))

    await expect(getGeneratedDocument(999)).rejects.toMatchObject({
      status: HTTP_STATUS.NOT_FOUND,
    })
    await expect(getGeneratedDocument(999)).rejects.toBeInstanceOf(ApiError)
  })

  it('generates a document DOCX via POST with no body and returns the version', async () => {
    fetchMock.mockResolvedValue(jsonResponse(201, generatedVersion))

    const result = await generateDocumentDocx(9)

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/generated-documents/9/generate/')
    expect(init.method).toBe('POST')
    expect(JSON.parse(String(init.body))).toEqual({})
    expect(result).toEqual(generatedVersion)
  })

  it('lists a document versions from the version list endpoint', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, [generatedVersion]))

    const result = await listGeneratedDocumentVersions(9)

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/generated-documents/9/versions/')
    expect(init.method).toBe('GET')
    expect(result).toEqual([generatedVersion])
  })

  it('downloads the DOCX from the version endpoint with the response filename', async () => {
    fetchMock.mockResolvedValue(docxDownloadResponse('INV-001-v1.docx'))
    setAccessToken('token-1')

    const result = await downloadGeneratedDocumentDocx(21)

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/generated-documents/versions/21/docx/')
    expect(init.method).toBe('GET')
    expect(new Headers(init.headers).get('Authorization')).toBe('Bearer token-1')
    expect(result.filename).toBe('INV-001-v1.docx')
    expect(result.blob).toBeInstanceOf(Blob)
    expect(result.blob.size).toBeGreaterThan(0)
  })

  it('falls back to the supplied filename when Content-Disposition is absent', async () => {
    fetchMock.mockResolvedValue(new Response(new Blob(['x']), { status: 200 }))

    const result = await downloadGeneratedDocumentDocx(21, 'GEN-001.docx')

    expect(result.filename).toBe('GEN-001.docx')
  })

  it('converts a 404 DOCX download into a typed ApiError', async () => {
    fetchMock.mockResolvedValue(jsonResponse(404, { detail: 'The requested file does not exist.' }))

    await expect(downloadGeneratedDocumentDocx(999)).rejects.toMatchObject({
      status: HTTP_STATUS.NOT_FOUND,
    })
  })

  it('generates a version PDF via POST with no body and returns the version', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { ...generatedVersion, storage: { docx: true, pdf: true } }))

    const result = await generateGeneratedDocumentPdf(21)

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/generated-documents/versions/21/generate-pdf/')
    expect(init.method).toBe('POST')
    expect(JSON.parse(String(init.body))).toEqual({})
    expect(result.storage.pdf).toBe(true)
  })

  it('propagates a 503 when the PDF conversion runtime is unavailable', async () => {
    fetchMock.mockResolvedValue(jsonResponse(503, { detail: 'PDF conversion is currently unavailable.' }))

    await expect(generateGeneratedDocumentPdf(21)).rejects.toMatchObject({
      status: 503,
    })
  })

  it('downloads the PDF from the version endpoint with the response filename and type', async () => {
    fetchMock.mockResolvedValue(pdfDownloadResponse('INV-001-v1.pdf'))
    setAccessToken('token-1')

    const result = await downloadGeneratedDocumentPdf(21)

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/generated-documents/versions/21/pdf/')
    expect(init.method).toBe('GET')
    expect(new Headers(init.headers).get('Authorization')).toBe('Bearer token-1')
    expect(new Headers(init.headers).get('Accept')).toBe('*/*')
    expect(result.filename).toBe('INV-001-v1.pdf')
    expect(result.blob).toBeInstanceOf(Blob)
    expect(result.blob.size).toBeGreaterThan(0)
  })

  it('falls back to the supplied PDF filename when Content-Disposition is absent', async () => {
    fetchMock.mockResolvedValue(new Response(new Blob(['%PDF-x']), { status: 200 }))

    const result = await downloadGeneratedDocumentPdf(21, 'GEN-001.pdf')

    expect(result.filename).toBe('GEN-001.pdf')
  })

  it('converts a 404 PDF download into a typed ApiError', async () => {
    fetchMock.mockResolvedValue(jsonResponse(404, { detail: 'The requested file does not exist.' }))

    await expect(downloadGeneratedDocumentPdf(999)).rejects.toMatchObject({
      status: HTTP_STATUS.NOT_FOUND,
    })
  })
})