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

const versionWithPdf: GeneratedDocumentVersion = {
  ...versionV1,
  id: 22,
  version_number: 2,
  storage: { docx: true, pdf: true },
}

function fileDownloadResponse(kind: 'docx' | 'pdf', filename = `INV-001-v2.${kind}`): Response {
  return new Response(new Blob([kind === 'pdf' ? '%PDF-fake' : 'fake-docx']), {
    status: 200,
    headers: { 'Content-Disposition': `attachment; filename="${filename}"` },
  })
}

function stubObjectUrl() {
  const createSpy = vi.fn(() => 'blob:viewer')
  const revokeSpy = vi.fn()
  const originalCreate = URL.createObjectURL
  const originalRevoke = URL.revokeObjectURL
  URL.createObjectURL = createSpy
  URL.revokeObjectURL = revokeSpy
  return {
    createSpy,
    revokeSpy,
    restore() {
      URL.createObjectURL = originalCreate
      URL.revokeObjectURL = originalRevoke
    },
  }
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
      generateDocx?: (input: RequestInfo | URL) => Promise<Response>
      generatePdf?: (input: RequestInfo | URL) => Promise<Response>
    } = {},
  ) {
    let currentVersions = options.versions ?? []
    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      const method = init?.method ?? 'GET'
      if (method === 'POST' && url.endsWith('/generate-pdf/')) {
        if (options.generatePdf) return options.generatePdf(input)
        currentVersions = currentVersions.map((version) =>
          version.id === 22 ? { ...version, storage: { docx: true, pdf: true } } : version,
        )
        return Promise.resolve(jsonResponse(200, versionWithPdf))
      }
      if (method === 'POST' && url.endsWith('/generate/')) {
        if (options.generateDocx) return options.generateDocx(input)
        const created = versionWithDocx
        currentVersions = [...currentVersions, created]
        return Promise.resolve(jsonResponse(201, created))
      }
      if (url.endsWith(`/api/generated-documents/${doc.id}/versions/`)) {
        return Promise.resolve(jsonResponse(200, currentVersions))
      }
      if (url.endsWith(`/api/generated-documents/versions/${versionWithDocx.id}/docx/`)) {
        return Promise.resolve(fileDownloadResponse('docx'))
      }
      if (url.endsWith(`/api/generated-documents/versions/${versionWithPdf.id}/pdf/`)) {
        return Promise.resolve(fileDownloadResponse('pdf'))
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
    expect(screen.getByRole('link', { name: 'Acme Ltd (Client #1)' })).toHaveAttribute(
      'href',
      '/clients/1',
    )
    expect(screen.getByRole('link', { name: 'Invoice Template (Template #1)' })).toHaveAttribute(
      'href',
      '/templates/1',
    )
    expect(screen.getAllByText('2026-09-04')).toHaveLength(2)
    expect(screen.getByText('Test User (User #1)')).toBeInTheDocument()

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
    stubBackend({ generateDocx: () => new Promise<Response>((resolve) => { resolveGenerate = resolve }) })
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
      generateDocx: () =>
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
      generateDocx: () =>
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
      generateDocx: () =>
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

  it('offers Generate PDF when a DOCX version exists without a PDF', async () => {
    stubBackend({ versions: [versionWithDocx] })
    renderDetail()

    expect(await screen.findByRole('button', { name: /generate pdf/i })).toBeInTheDocument()
    expect(screen.getByText('No PDF generated yet.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /download docx/i })).toBeInTheDocument()
  })

  it('offers Download PDF once a version has both a DOCX and a PDF', async () => {
    stubBackend({ versions: [versionWithPdf] })
    renderDetail()

    expect(await screen.findByRole('button', { name: /download pdf/i })).toBeInTheDocument()
    expect(screen.getByText(/PDF file available \(version 2\)/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /download docx/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /generate pdf/i })).not.toBeInTheDocument()
  })

  it('generates a PDF, shows the state, and refreshes the generated files', async () => {
    stubBackend({ versions: [versionWithDocx] })
    renderDetail()
    await screen.findByRole('button', { name: /generate pdf/i })

    await user.click(screen.getByRole('button', { name: /generate pdf/i }))

    const [url] = await waitFor(() => {
      const call = fetchMock.mock.calls.find(([callUrl, callInit]) => {
        const initObject = callInit as RequestInit | undefined
        return String(callUrl).endsWith('/generate-pdf/') && (initObject?.method ?? 'GET') === 'POST'
      })
      expect(call).toBeDefined()
      return call as [string, RequestInit]
    })
    expect(url).toBe('/api/generated-documents/versions/22/generate-pdf/')

    expect(await screen.findByRole('status')).toHaveTextContent(/PDF generated for version 2/i)
    expect(await screen.findByRole('button', { name: /download pdf/i })).toBeInTheDocument()
  })

  it('keeps the DOCX download independent while a PDF is generated', async () => {
    let resolveGeneratePdf: (value: Response) => void = () => {}
    stubBackend({
      versions: [versionWithDocx],
      generatePdf: () =>
        new Promise<Response>((resolve) => {
          resolveGeneratePdf = resolve
        }),
    })
    renderDetail()
    await screen.findByRole('button', { name: /generate pdf/i })

    await user.click(screen.getByRole('button', { name: /generate pdf/i }))

    const generatingPdf = screen.getByRole('button', { name: /generating pdf/i })
    expect(generatingPdf).toBeDisabled()
    expect(screen.getByRole('button', { name: /download docx/i })).not.toBeDisabled()

    resolveGeneratePdf(jsonResponse(200, versionWithPdf))
    await screen.findByText(/PDF generated for version 2/i)
  })

  it('prevents duplicate PDF generation requests while one is in flight', async () => {
    let resolveGeneratePdf: (value: Response) => void = () => {}
    stubBackend({
      versions: [versionWithDocx],
      generatePdf: () =>
        new Promise<Response>((resolve) => {
          resolveGeneratePdf = resolve
        }),
    })
    renderDetail()
    await screen.findByRole('button', { name: /generate pdf/i })

    await user.click(screen.getByRole('button', { name: /generate pdf/i }))

    const generatingPdf = screen.getByRole('button', { name: /generating pdf/i })
    expect(generatingPdf).toBeDisabled()
    await user.click(generatingPdf)

    const pdfCalls = fetchMock.mock.calls.filter(([callUrl, callInit]) => {
      const initObject = callInit as RequestInit | undefined
      return String(callUrl).endsWith('/generate-pdf/') && (initObject?.method ?? 'GET') === 'POST'
    })
    expect(pdfCalls).toHaveLength(1)

    resolveGeneratePdf(jsonResponse(200, versionWithPdf))
    await screen.findByText(/PDF generated for version 2/i)
  })

  it('shows the backend error when the PDF conversion runtime is unavailable', async () => {
    stubBackend({
      versions: [versionWithDocx],
      generatePdf: () =>
        Promise.resolve(jsonResponse(503, { detail: 'PDF conversion is currently unavailable.' })),
    })
    renderDetail()
    await screen.findByRole('button', { name: /generate pdf/i })

    await user.click(screen.getByRole('button', { name: /generate pdf/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/PDF conversion is currently unavailable/i)
  })

  it('shows a permission error when PDF generation is forbidden', async () => {
    stubBackend({
      versions: [versionWithDocx],
      generatePdf: () =>
        Promise.resolve(jsonResponse(403, { detail: 'Missing required permission: generated_documents.generate' })),
    })
    renderDetail()
    await screen.findByRole('button', { name: /generate pdf/i })

    await user.click(screen.getByRole('button', { name: /generate pdf/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      /do not have permission to generate or download this document/i,
    )
  })

  it('downloads the PDF through the authenticated endpoint with the response filename', async () => {
    const createSpy = vi.fn(() => 'blob:mock')
    const revokeSpy = vi.fn()
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    const originalCreate = URL.createObjectURL
    const originalRevoke = URL.revokeObjectURL
    URL.createObjectURL = createSpy
    URL.revokeObjectURL = revokeSpy
    try {
      stubBackend({ versions: [versionWithPdf] })
      renderDetail()
      await screen.findByRole('button', { name: /download pdf/i })

      await user.click(screen.getByRole('button', { name: /download pdf/i }))

      await waitFor(() => expect(createSpy).toHaveBeenCalledTimes(1))
      const downloadCall = fetchMock.mock.calls.find(([callUrl, callInit]) => {
        const initObject = callInit as RequestInit | undefined
        return String(callUrl).endsWith('/pdf/') && (initObject?.method ?? 'GET') === 'GET'
      })
      expect(downloadCall).toBeDefined()
      expect(String((downloadCall as [string, RequestInit])[0])).toBe(
        '/api/generated-documents/versions/22/pdf/',
      )
      expect(clickSpy).toHaveBeenCalledTimes(1)
      expect(revokeSpy).toHaveBeenCalledTimes(1)
    } finally {
      URL.createObjectURL = originalCreate
      URL.revokeObjectURL = originalRevoke
      clickSpy.mockRestore()
    }
  })

  it('shows a safe error when the PDF download fails', async () => {
    stubBackend({ versions: [versionWithPdf] })
    fetchMock.mockImplementation((input: RequestInfo | URL) => {
      const url = String(input)
      if (url.endsWith('/api/generated-documents/versions/22/pdf/')) {
        return Promise.resolve(jsonResponse(404, { detail: 'The requested file does not exist.' }))
      }
      if (url.endsWith(`/api/generated-documents/${doc.id}/versions/`)) {
        return Promise.resolve(jsonResponse(200, [versionWithPdf]))
      }
      return Promise.resolve(jsonResponse(200, doc))
    })
    renderDetail()
    await screen.findByRole('button', { name: /download pdf/i })

    await user.click(screen.getByRole('button', { name: /download pdf/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      /document or its generated file is not available/i,
    )
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

    resolveDownload(fileDownloadResponse('docx'))
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

  it('opens the PDF viewer from the View PDF button with one authenticated request', async () => {
    const objectUrl = stubObjectUrl()
    try {
      stubBackend({ versions: [versionWithPdf] })
      renderDetail()
      await screen.findByRole('button', { name: /view pdf/i })

      await user.click(screen.getByRole('button', { name: /view pdf/i }))

      const iframe = await screen.findByTestId('document-pdf-viewer')
      expect(iframe).toHaveAttribute('src', 'blob:viewer')
      const pdfCalls = fetchMock.mock.calls.filter(([url, init]) => {
        const initObject = init as RequestInit | undefined
        return (
          String(url).endsWith('/api/generated-documents/versions/22/pdf/') &&
          (initObject?.method ?? 'GET') === 'GET'
        )
      })
      expect(pdfCalls).toHaveLength(1)
      // Viewing never generates or regenerates anything.
      const postCalls = fetchMock.mock.calls.filter(
        ([, init]) => (init as RequestInit | undefined)?.method === 'POST',
      )
      expect(postCalls).toHaveLength(0)
    } finally {
      objectUrl.restore()
    }
  })

  it('auto-opens the PDF viewer from the Documents list View link', async () => {
    const objectUrl = stubObjectUrl()
    try {
      stubBackend({ versions: [versionWithPdf] })
      renderDetail('/documents/9?view=pdf')

      const iframe = await screen.findByTestId('document-pdf-viewer')
      expect(iframe).toHaveAttribute('src', 'blob:viewer')
      const pdfCalls = fetchMock.mock.calls.filter(([url, init]) => {
        const initObject = init as RequestInit | undefined
        return (
          String(url).endsWith('/api/generated-documents/versions/22/pdf/') &&
          (initObject?.method ?? 'GET') === 'GET'
        )
      })
      expect(pdfCalls).toHaveLength(1)
    } finally {
      objectUrl.restore()
    }
  })

  it('closing the viewer revokes the object URL and removes the iframe', async () => {
    const objectUrl = stubObjectUrl()
    try {
      stubBackend({ versions: [versionWithPdf] })
      renderDetail('/documents/9?view=pdf')
      await screen.findByTestId('document-pdf-viewer')

      await user.click(screen.getByRole('button', { name: /close viewer/i }))

      expect(screen.queryByTestId('document-pdf-viewer')).not.toBeInTheDocument()
      expect(objectUrl.revokeSpy).toHaveBeenCalledWith('blob:viewer')
    } finally {
      objectUrl.restore()
    }
  })

  it('shows a loading state while the PDF is being retrieved', async () => {
    let resolvePdf: (value: Response) => void = () => {}
    stubBackend({ versions: [versionWithPdf] })
    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.endsWith('/api/generated-documents/versions/22/pdf/')) {
        return new Promise<Response>((resolve) => {
          resolvePdf = resolve
        })
      }
      if (url.endsWith(`/api/generated-documents/${doc.id}/versions/`)) {
        return Promise.resolve(jsonResponse(200, [versionWithPdf]))
      }
      if (init?.method === 'POST') return Promise.resolve(jsonResponse(201, versionWithPdf))
      return Promise.resolve(jsonResponse(200, doc))
    })
    const objectUrl = stubObjectUrl()
    try {
      renderDetail()
      await screen.findByRole('button', { name: /view pdf/i })

      await user.click(screen.getByRole('button', { name: /view pdf/i }))

      expect(screen.getByTestId('pdf-viewer-loading')).toHaveTextContent('Loading PDF…')
      expect(screen.getByRole('button', { name: /loading pdf/i })).toBeDisabled()

      resolvePdf(fileDownloadResponse('pdf'))
      await screen.findByTestId('document-pdf-viewer')
    } finally {
      objectUrl.restore()
    }
  })

  it('shows a safe error when the PDF file is missing on storage', async () => {
    stubBackend({ versions: [versionWithPdf] })
    fetchMock.mockImplementation((input: RequestInfo | URL) => {
      const url = String(input)
      if (url.endsWith('/api/generated-documents/versions/22/pdf/')) {
        return Promise.resolve(jsonResponse(404, { detail: 'The requested file does not exist.' }))
      }
      if (url.endsWith(`/api/generated-documents/${doc.id}/versions/`)) {
        return Promise.resolve(jsonResponse(200, [versionWithPdf]))
      }
      return Promise.resolve(jsonResponse(200, doc))
    })
    renderDetail()
    await screen.findByRole('button', { name: /view pdf/i })

    await user.click(screen.getByRole('button', { name: /view pdf/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/file is not available/i)
    expect(screen.queryByTestId('document-pdf-viewer')).not.toBeInTheDocument()
  })

  it('shows a permission error when viewing is forbidden', async () => {
    stubBackend({ versions: [versionWithPdf] })
    fetchMock.mockImplementation((input: RequestInfo | URL) => {
      const url = String(input)
      if (url.endsWith('/api/generated-documents/versions/22/pdf/')) {
        return Promise.resolve(
          jsonResponse(403, { detail: 'Missing required permission: generated_documents.read' }),
        )
      }
      if (url.endsWith(`/api/generated-documents/${doc.id}/versions/`)) {
        return Promise.resolve(jsonResponse(200, [versionWithPdf]))
      }
      return Promise.resolve(jsonResponse(200, doc))
    })
    renderDetail()
    await screen.findByRole('button', { name: /view pdf/i })

    await user.click(screen.getByRole('button', { name: /view pdf/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/do not have permission/i)
  })

  it('revokes the object URL when the page unmounts', async () => {
    const objectUrl = stubObjectUrl()
    try {
      stubBackend({ versions: [versionWithPdf] })
      const view = renderDetail('/documents/9?view=pdf')
      await screen.findByTestId('document-pdf-viewer')

      view.unmount()

      expect(objectUrl.revokeSpy).toHaveBeenCalledWith('blob:viewer')
    } finally {
      objectUrl.restore()
    }
  })

  it('ignores a stale viewer request that finishes after the viewer is closed', async () => {
    let resolvePdf: (value: Response) => void = () => {}
    stubBackend({ versions: [versionWithPdf] })
    fetchMock.mockImplementation((input: RequestInfo | URL) => {
      const url = String(input)
      if (url.endsWith('/api/generated-documents/versions/22/pdf/')) {
        return new Promise<Response>((resolve) => {
          resolvePdf = resolve
        })
      }
      if (url.endsWith(`/api/generated-documents/${doc.id}/versions/`)) {
        return Promise.resolve(jsonResponse(200, [versionWithPdf]))
      }
      return Promise.resolve(jsonResponse(200, doc))
    })
    const objectUrl = stubObjectUrl()
    try {
      renderDetail()
      await screen.findByRole('button', { name: /view pdf/i })

      await user.click(screen.getByRole('button', { name: /view pdf/i }))
      await user.click(screen.getByRole('button', { name: /close viewer/i }))

      resolvePdf(fileDownloadResponse('pdf'))
      await new Promise((resolve) => setTimeout(resolve, 0))

      expect(objectUrl.createSpy).not.toHaveBeenCalled()
      expect(screen.queryByTestId('document-pdf-viewer')).not.toBeInTheDocument()
    } finally {
      objectUrl.restore()
    }
  })
})