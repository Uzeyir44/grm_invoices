import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DocumentsIndexPage } from './DocumentsIndexPage'
import { generatedDocuments, jsonResponse } from '../../test/documentFixtures'
import type { GeneratedDocumentVersion } from '../../types/generatedDocument'

const versionWithPdf: GeneratedDocumentVersion = {
  id: 21,
  generated_document_id: 9,
  company_id: 10,
  version_number: 1,
  template_version_id: 3,
  currency_id: 1,
  exchange_rate_used: null,
  vat_rate_used_percent: null,
  generation_metadata: { engine_version: '4.4' },
  storage: { docx: true, pdf: true },
  generated_by_id: 1,
  created_at: '2026-09-04T10:00:00+00:00',
}

function renderDocuments() {
  return render(
    <MemoryRouter initialEntries={['/documents']}>
      <Routes>
        <Route path="/documents" element={<DocumentsIndexPage />} />
        <Route path="/documents/new" element={<div>create-page</div>} />
        <Route path="/documents/:documentId" element={<div>detail-page</div>} />
      </Routes>
    </MemoryRouter>,
  )
}

function binaryResponse(kind: 'docx' | 'pdf'): Response {
  return new Response(new Blob([kind === 'pdf' ? '%PDF' : 'docx-bytes']), {
    status: 200,
    headers: {
      'Content-Type':
        kind === 'pdf'
          ? 'application/pdf'
          : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    },
  })
}

function stubObjectUrl() {
  const createSpy = vi.fn(() => 'blob:download')
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

describe('DocumentsIndexPage', () => {
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

  function stubBackend() {
    fetchMock.mockImplementation((input: RequestInfo | URL) => {
      const url = String(input)
      if (url.endsWith('/generated-documents/')) {
        return Promise.resolve(jsonResponse(200, generatedDocuments))
      }
      if (url.endsWith('/generated-documents/9/versions/')) {
        return Promise.resolve(jsonResponse(200, [versionWithPdf]))
      }
      if (url.endsWith('/generated-documents/10/versions/')) {
        return Promise.resolve(jsonResponse(200, []))
      }
      if (url.endsWith('/versions/21/docx/')) {
        return Promise.resolve(binaryResponse('docx'))
      }
      if (url.endsWith('/versions/21/pdf/')) {
        return Promise.resolve(binaryResponse('pdf'))
      }
      return Promise.resolve(jsonResponse(404, {}))
    })
  }

  it('shows a loading state while the list request is pending', () => {
    fetchMock.mockReturnValue(new Promise<Response>(() => {}))
    renderDocuments()
    expect(screen.getByTestId('documents-loading')).toHaveTextContent('Loading…')
  })

  it('renders the real generated documents with counts, types, clients, and statuses', async () => {
    stubBackend()
    renderDocuments()

    await screen.findByTestId('documents-count')
    expect(screen.getByTestId('documents-count')).toHaveTextContent('2 documents')
    expect(screen.getByRole('cell', { name: 'INV-001' })).toBeInTheDocument()
    expect(screen.getByRole('cell', { name: 'CC-001' })).toBeInTheDocument()
    expect(screen.getByRole('cell', { name: 'invoice' })).toBeInTheDocument()
    expect(screen.getByRole('cell', { name: 'consulting_contract' })).toBeInTheDocument()
    expect(screen.getByRole('cell', { name: 'Acme Ltd (Client #1)' })).toBeInTheDocument()
    expect(screen.getByRole('cell', { name: 'Jane Doe (Client #2)' })).toBeInTheDocument()
    expect(screen.getAllByTestId('document-status')).toHaveLength(2)
    expect(screen.getByText('Generated')).toBeInTheDocument()
    expect(screen.getByText('Draft')).toBeInTheDocument()
    expect(screen.getByRole('cell', { name: '2026-09-04' })).toBeInTheDocument()
  })

  it('links each document number to its detail route', async () => {
    stubBackend()
    renderDocuments()

    await screen.findByRole('link', { name: 'INV-001' })
    expect(screen.getByRole('link', { name: 'INV-001' })).toHaveAttribute(
      'href',
      '/documents/9',
    )
    expect(screen.getByRole('link', { name: 'CC-001' })).toHaveAttribute(
      'href',
      '/documents/10',
    )
  })

  it('navigates to a document detail page from a row', async () => {
    stubBackend()
    renderDocuments()
    await screen.findByRole('link', { name: 'INV-001' })

    await user.click(screen.getByRole('link', { name: 'INV-001' }))
    expect(await screen.findByText('detail-page')).toBeInTheDocument()
  })

  it('shows an empty state when the backend returns zero documents', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, []))
    renderDocuments()

    expect(await screen.findByText('No documents yet.')).toBeInTheDocument()
    expect(screen.getByTestId('documents-count')).toHaveTextContent('0 documents')
    // The empty state offers the real create route.
    expect(screen.getByRole('link', { name: /create your first document/i })).toHaveAttribute(
      'href',
      '/documents/new',
    )
  })

  it('navigates to the create page from the New document action', async () => {
    stubBackend()
    renderDocuments()
    await screen.findByRole('link', { name: 'INV-001' })

    const createLink = screen.getByRole('link', { name: /new document/i })
    expect(createLink).toHaveAttribute('href', '/documents/new')

    await user.click(createLink)
    expect(await screen.findByText('create-page')).toBeInTheDocument()
  })

  it('shows an error state and retries the request', async () => {
    let fail = true
    fetchMock.mockImplementation((input: RequestInfo | URL) => {
      const url = String(input)
      if (url.endsWith('/generated-documents/') && fail) {
        fail = false
        return Promise.reject(new Error('boom'))
      }
      if (url.endsWith('/generated-documents/')) {
        return Promise.resolve(jsonResponse(200, generatedDocuments))
      }
      if (url.endsWith('/generated-documents/9/versions/')) {
        return Promise.resolve(jsonResponse(200, [versionWithPdf]))
      }
      if (url.endsWith('/generated-documents/10/versions/')) {
        return Promise.resolve(jsonResponse(200, []))
      }
      return Promise.resolve(jsonResponse(404, {}))
    })
    renderDocuments()

    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't load documents.")
    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /retry/i }))

    expect(await screen.findByRole('cell', { name: 'INV-001' })).toBeInTheDocument()
  })

  it('shows file actions for generated documents and none for draft-only documents', async () => {
    stubBackend()
    renderDocuments()

    // INV-001 (generated, PDF available) exposes View / Download DOCX / Download PDF.
    const view = await screen.findByRole('link', { name: /view/i })
    expect(view).toHaveAttribute('href', '/documents/9?view=pdf')
    expect(screen.getByRole('button', { name: /download docx/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /download pdf/i })).toBeInTheDocument()

    // CC-001 is still a draft with no generated files.
    expect(screen.getByText('No generated files')).toBeInTheDocument()
  })

  it('shows a loading state for file actions while versions load', async () => {
    let resolveVersions: (value: Response) => void = () => {}
    fetchMock.mockImplementation((input: RequestInfo | URL) => {
      const url = String(input)
      if (url.endsWith('/generated-documents/')) {
        return Promise.resolve(jsonResponse(200, [generatedDocuments[0]]))
      }
      if (url.endsWith('/generated-documents/9/versions/')) {
        return new Promise<Response>((resolve) => {
          resolveVersions = resolve
        })
      }
      return Promise.resolve(jsonResponse(404, {}))
    })
    renderDocuments()

    await screen.findByRole('cell', { name: 'INV-001' })
    expect(screen.getByText('Loading files…')).toBeInTheDocument()

    resolveVersions(jsonResponse(200, [versionWithPdf]))
    expect(await screen.findByRole('link', { name: /view/i })).toBeInTheDocument()
  })

  it('shows a per-row error and retry when versions fail to load', async () => {
    let failVersions = true
    fetchMock.mockImplementation((input: RequestInfo | URL) => {
      const url = String(input)
      if (url.endsWith('/generated-documents/')) {
        return Promise.resolve(jsonResponse(200, [generatedDocuments[0]]))
      }
      if (url.endsWith('/generated-documents/9/versions/')) {
        if (failVersions) {
          failVersions = false
          return Promise.reject(new Error('boom'))
        }
        return Promise.resolve(jsonResponse(200, [versionWithPdf]))
      }
      return Promise.resolve(jsonResponse(404, {}))
    })
    renderDocuments()

    expect(await screen.findByText('Files unavailable.')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /retry/i }))
    expect(await screen.findByRole('link', { name: /view/i })).toBeInTheDocument()
  })

  it('downloads the DOCX from the list without regenerating the document', async () => {
    const objectUrl = stubObjectUrl()
    try {
      stubBackend()
      renderDocuments()
      await screen.findByRole('link', { name: /view/i })

      await user.click(screen.getByRole('button', { name: /download docx/i }))

      await waitFor(() => {
        const call = fetchMock.mock.calls.find(([url, init]) => {
          const initObject = init as RequestInit | undefined
          return (
            String(url).endsWith('/api/generated-documents/versions/21/docx/') &&
            (initObject?.method ?? 'GET') === 'GET'
          )
        })
        expect(call).toBeDefined()
      })
      const postCalls = fetchMock.mock.calls.filter(
        ([, init]) => (init as RequestInit | undefined)?.method === 'POST',
      )
      expect(postCalls).toHaveLength(0)
    } finally {
      objectUrl.restore()
    }
  })

  it('downloads the PDF from the list without regenerating the document', async () => {
    const objectUrl = stubObjectUrl()
    try {
      stubBackend()
      renderDocuments()
      await screen.findByRole('link', { name: /view/i })

      await user.click(screen.getByRole('button', { name: /download pdf/i }))

      await waitFor(() => {
        const call = fetchMock.mock.calls.find(([url, init]) => {
          const initObject = init as RequestInit | undefined
          return (
            String(url).endsWith('/api/generated-documents/versions/21/pdf/') &&
            (initObject?.method ?? 'GET') === 'GET'
          )
        })
        expect(call).toBeDefined()
      })
      const postCalls = fetchMock.mock.calls.filter(
        ([, init]) => (init as RequestInit | undefined)?.method === 'POST',
      )
      expect(postCalls).toHaveLength(0)
    } finally {
      objectUrl.restore()
    }
  })

  it('does not invent search or pagination controls the backend does not support', async () => {
    stubBackend()
    renderDocuments()
    await screen.findByTestId('documents-count')

    expect(screen.queryByRole('searchbox')).not.toBeInTheDocument()
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /next/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /previous/i })).not.toBeInTheDocument()
  })
})