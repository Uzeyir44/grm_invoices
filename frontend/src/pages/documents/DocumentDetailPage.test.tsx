import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DocumentDetailPage } from './DocumentDetailPage'
import { generatedDocuments, jsonResponse } from '../../test/documentFixtures'
import type { GeneratedDocumentVersion } from '../../types/generatedDocument'

const doc = generatedDocuments[0]

const versionV1: GeneratedDocumentVersion = {
  id: 21,
  generated_document_id: 9,
  company_id: 10,
  version_number: 1,
  template_version_id: 3,
  currency_id: 1,
  exchange_rate_used: null,
  vat_rate_used_percent: null,
  generation_metadata: { engine_version: '4.4' },
  storage: { docx: false, pdf: false },
  generated_by_id: 1,
  created_at: '2026-09-05T10:00:00+00:00',
}

const versionWithDocx: GeneratedDocumentVersion = {
  ...versionV1,
  id: 22,
  version_number: 2,
  storage: { docx: true, pdf: false },
}

function docxDownloadResponse(filename = 'INV-001-v2.docx'): Response {
  return new Response(new Blob(['fake-docx'], { type: 'application/octet-stream' }), {
    status: 200,
    headers: { 'Content-Disposition': `attachment; filename="${filename}"` },
  })
}

function renderDetail(path = '/documents/9') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/documents/:documentId" element={<DocumentDetailPage />} />
        <Route path="/documents" element={<div data-testid="documents-list" />} />
        <Route path="/clients/:clientId" element={<div data-testid="client-view" />} />
        <Route path="/templates/:templateId" element={<div data-testid="template-view" />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('DocumentDetailPage', () => {
  const fetchMock = vi.fn()
  const user = userEvent.setup()

  beforeEach(() => {
    localStorage.clear()
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  function stubBackend(
    options: {
      detail?: () => Promise<Response>
      versions?: GeneratedDocumentVersion[]
      generate?: (input: RequestInfo | URL) => Promise<Response>
    } = {},
  ) {
    let currentVersions = options.versions ?? []
    const onGenerate = options.generate
    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      const method = init?.method ?? 'GET'
      if (method === 'POST' && url.includes('/generate/')) {
        if (onGenerate) return onGenerate(input)
        const created = versionWithDocx
        currentVersions = [...currentVersions, created]
        return Promise.resolve(jsonResponse(201, created))
      }
      if (url.endsWith(`/api/generated-documents/${doc.id}/versions/`)) {
        return Promise.resolve(jsonResponse(200, currentVersions))
      }
      if (url.endsWith('/api/generated-documents/versions/' + versionWithDocx.id + '/docx/')) {
        return Promise.resolve(docxDownloadResponse())
      }
      if (options.detail) return options.detail()
      return Promise.resolve(jsonResponse(200, doc))
    })
  }

  it('shows a loading state while fetching', () => {
    fetchMock.mockReturnValue(new Promise<Response>(() => {}))
    renderDetail()
    expect(screen.getByTestId('document-detail-loading')).toHaveTextContent('Loading…')
  })

  it('renders the document metadata returned by the detail serializer', async () => {
    stubBackend()
    renderDetail()

    expect(await screen.findByRole('heading', { name: /INV-001/ })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /back to documents/i })).toHaveAttribute(
      'href',
      '/documents',
    )
    expect(screen.getByText('invoice')).toBeInTheDocument()
    expect(screen.getByText('generated')).toBeInTheDocument()
    expect(screen.getByText('Generated')).toBeInTheDocument()
    // Client and template reference the existing, functional detail routes.
    expect(screen.getByRole('link', { name: 'Client #1' })).toHaveAttribute('href', '/clients/1')
    expect(screen.getByRole('link', { name: 'Template #1' })).toHaveAttribute(
      'href',
      '/templates/1',
    )
    expect(screen.getAllByText('2026-09-04')).toHaveLength(2)
    expect(screen.getByText('User #1')).toBeInTheDocument()

    const detailUrl = String(fetchMock.mock.calls[0][0])
    expect(detailUrl).toBe('/api/generated-documents/9/')
  })

  it('offers Generate DOCX when no version has a DOCX and Download DOCX once one exists', async () => {
    stubBackend()
    const first = renderDetail()
    expect(await screen.findByRole('button', { name: /generate docx/i })).toBeInTheDocument()
    expect(screen.getByText('No DOCX generated yet.')).toBeInTheDocument()
    first.unmount()

    stubBackend({ versions: [versionWithDocx] })
    const second = renderDetail()
    expect(
      await screen.findByRole('button', { name: /download docx/i }),
    ).toBeInTheDocument()
    expect(screen.getByText(/DOCX file available \(version 2\)/)).toBeInTheDocument()
    second.unmount()
  })

  it('generates a DOCX, shows the state, and refreshes the generated files', async () => {
    stubBackend()
    renderDetail()
    await screen.findByRole('button', { name: /generate docx/i })

    await user.click(screen.getByRole('button', { name: /generate docx/i }))

    const [url] = await waitFor(() => {
      const call = fetchMock.mock.calls.find(([callUrl, callInit]) => {
        const initObject = callInit as RequestInit | undefined
        return String(callUrl).includes('/generate/') && (initObject?.method ?? 'GET') === 'POST'
      })
      expect(call).toBeDefined()
      return call as [string, RequestInit]
    })
    expect(url).toBe('/api/generated-documents/9/generate/')

    // After the refresh the newly generated version's DOCX is available.
    expect(await screen.findByRole('status')).toHaveTextContent(
      /DOCX generated as version 2/i,
    )
    expect(await screen.findByRole('button', { name: /download docx/i })).toBeInTheDocument()
  })

  it('prevents duplicate generation requests while one is in flight', async () => {
    let resolveGenerate: (value: Response) => void = () => {}
    stubBackend({ generate: () => new Promise<Response>((resolve) => { resolveGenerate = resolve }) })
    renderDetail()
    await screen.findByRole('button', { name: /generate docx/i })

    await user.click(screen.getByRole('button', { name: /generate docx/i }))

    const generating = screen.getByRole('button', { name: /generating docx/i })
    expect(generating).toBeDisabled()
    await user.click(generating)
    const generateCalls = fetchMock.mock.calls.filter(([callUrl, callInit]) => {
      const initObject = callInit as RequestInit | undefined
      return String(callUrl).includes('/generate/') && (initObject?.method ?? 'GET') === 'POST'
    })
    expect(generateCalls).toHaveLength(1)

    resolveGenerate(jsonResponse(201, versionWithDocx))
    await screen.findByText(/DOCX generated as version 2/i)
  })

  it('shows a backend error when generation fails', async () => {
    stubBackend({
      generate: () =>
        Promise.resolve(
          jsonResponse(400, { detail: 'Document generation failed. Check the document, client, and template version data.' }),
        ),
    })
    renderDetail()
    await screen.findByRole('button', { name: /generate docx/i })

    await user.click(screen.getByRole('button', { name: /generate docx/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/document generation failed/i)
  })

  it('shows a permission error when generation is forbidden', async () => {
    stubBackend({
      generate: () =>
        Promise.resolve(jsonResponse(403, { detail: 'Missing required permission: generated_documents.generate' })),
    })
    renderDetail()
    await screen.findByRole('button', { name: /generate docx/i })

    await user.click(screen.getByRole('button', { name: /generate docx/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      /do not have permission to generate or download this document/i,
    )
  })

  it('respects Retry-After when generation is rate limited', async () => {
    stubBackend({
      generate: () =>
        Promise.resolve(
          new Response(JSON.stringify({ detail: 'Request was throttled.' }), {
            status: 429,
            headers: { 'Content-Type': 'application/json', 'Retry-After': '7' },
          }),
        ),
    })
    renderDetail()
    await screen.findByRole('button', { name: /generate docx/i })

    await user.click(screen.getByRole('button', { name: /generate docx/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/wait 7 seconds/i)
  })

  it('downloads the DOCX through the authenticated endpoint with the response filename', async () => {
    const createSpy = vi.fn(() => 'blob:mock')
    const revokeSpy = vi.fn()
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    const originalCreate = URL.createObjectURL
    const originalRevoke = URL.revokeObjectURL
    URL.createObjectURL = createSpy
    URL.revokeObjectURL = revokeSpy
    try {
      stubBackend({ versions: [versionWithDocx] })
      renderDetail()
      await screen.findByRole('button', { name: /download docx/i })

      await user.click(screen.getByRole('button', { name: /download docx/i }))

      await waitFor(() => expect(createSpy).toHaveBeenCalledTimes(1))
      const downloadCall = fetchMock.mock.calls.find(([callUrl, callInit]) => {
        const initObject = callInit as RequestInit | undefined
        return String(callUrl).includes('/docx/') && (initObject?.method ?? 'GET') === 'GET'
      })
      expect(downloadCall).toBeDefined()
      expect(String((downloadCall as [string, RequestInit])[0])).toBe(
        '/api/generated-documents/versions/22/docx/',
      )
      expect(clickSpy).toHaveBeenCalledTimes(1)
      expect(revokeSpy).toHaveBeenCalledTimes(1)
    } finally {
      URL.createObjectURL = originalCreate
      URL.revokeObjectURL = originalRevoke
      clickSpy.mockRestore()
    }
  })

  it('shows a loading state on the download button while downloading', async () => {
    let resolveDownload: (value: Response) => void = () => {}
    stubBackend({
      versions: [versionWithDocx],
    })
    fetchMock.mockImplementation((input: RequestInfo | URL) => {
      const url = String(input)
      if (url.endsWith('/api/generated-documents/versions/22/docx/')) {
        return new Promise<Response>((resolve) => { resolveDownload = resolve })
      }
      if (url.endsWith(`/api/generated-documents/${doc.id}/versions/`)) {
        return Promise.resolve(jsonResponse(200, [versionWithDocx]))
      }
      return Promise.resolve(jsonResponse(200, doc))
    })
    renderDetail()
    await screen.findByRole('button', { name: /download docx/i })

    await user.click(screen.getByRole('button', { name: /download docx/i }))

    const downloading = screen.getByRole('button', { name: /downloading/i })
    expect(downloading).toBeDisabled()

    resolveDownload(docxDownloadResponse())
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: /downloading/i })).not.toBeInTheDocument(),
    )
  })

  it('shows a safe error when the DOCX download fails', async () => {
    stubBackend({ versions: [versionWithDocx] })
    fetchMock.mockImplementation((input: RequestInfo | URL) => {
      const url = String(input)
      if (url.endsWith('/api/generated-documents/versions/22/docx/')) {
        return Promise.resolve(jsonResponse(404, { detail: 'The requested file does not exist.' }))
      }
      if (url.endsWith(`/api/generated-documents/${doc.id}/versions/`)) {
        return Promise.resolve(jsonResponse(200, [versionWithDocx]))
      }
      return Promise.resolve(jsonResponse(200, doc))
    })
    renderDetail()
    await screen.findByRole('button', { name: /download docx/i })

    await user.click(screen.getByRole('button', { name: /download docx/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      /document or its generated file is not available/i,
    )
  })

  it('shows a safe not-found state for 404 (covers cross-tenant too)', async () => {
    stubBackend({ detail: () => Promise.resolve(jsonResponse(404, { detail: 'Not found.' })) })
    renderDetail()

    expect(await screen.findByText('Document not found.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /back to documents/i })).toBeInTheDocument()
  })

  it('shows a not-found state for a non-numeric id without fetching', async () => {
    renderDetail('/documents/not-a-number')

    expect(await screen.findByText('Document not found.')).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('shows a safe message for forbidden access', async () => {
    stubBackend({ detail: () => Promise.resolve(jsonResponse(403, { detail: 'No permission.' })) })
    renderDetail()

    expect(
      await screen.findByText(/do not have permission to view this document/i),
    ).toBeInTheDocument()
  })

  it('shows an error state and retries', async () => {
    stubBackend()
    let fail = true
    fetchMock.mockImplementation((input: RequestInfo | URL) => {
      const url = String(input)
      if (fail) {
        fail = false
        return Promise.reject(new Error('boom'))
      }
      if (url.endsWith(`/api/generated-documents/${doc.id}/versions/`)) {
        return Promise.resolve(jsonResponse(200, []))
      }
      return Promise.resolve(jsonResponse(200, doc))
    })
    renderDetail()

    expect(await screen.findByText("Couldn't load the document.")).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /retry/i }))
    expect(await screen.findByRole('heading', { name: /INV-001/ })).toBeInTheDocument()
  })

  it('navigates back to the documents list', async () => {
    stubBackend()
    renderDetail()
    await screen.findByRole('heading', { name: /INV-001/ })

    await user.click(screen.getByRole('link', { name: /back to documents/i }))
    expect(await screen.findByTestId('documents-list')).toBeInTheDocument()
  })
})