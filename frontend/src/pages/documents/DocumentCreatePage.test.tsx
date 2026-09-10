import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useParams } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DocumentCreatePage } from './DocumentCreatePage'
import { clientSummaries, jsonResponse } from '../../test/clientFixtures'
import { documentTypes, templateSummaries } from '../../test/templateFixtures'
import { generatedDocuments } from '../../test/documentFixtures'
import type { DocumentTemplate } from '../../types/documentTemplate'
import type { ClientSummary } from '../../types/client'
import type { DocumentType, Currency } from '../../types/referenceData'

const clients: ClientSummary[] = clientSummaries
const docTypes: DocumentType[] = documentTypes
const currencies: Currency[] = [
  { id: 1, code: 'AZN', name: 'Azerbaijani Manat', minor_unit: 2 },
]
const templates: DocumentTemplate[] = [templateSummaries[0]]

const createdDocument = generatedDocuments[0]

function DetailMarker() {
  const { documentId } = useParams()
  return <div data-testid="detail-view">{documentId}</div>
}

function renderCreate() {
  return render(
    <MemoryRouter initialEntries={['/documents/new']}>
      <Routes>
        <Route path="/documents/new" element={<DocumentCreatePage />} />
        <Route path="/documents/:documentId" element={<DetailMarker />} />
        <Route path="/documents" element={<div data-testid="documents-list" />} />
      </Routes>
    </MemoryRouter>,
  )
}

function optionLabels(select: HTMLElement): string[] {
  return Array.from(select.querySelectorAll('option'))
    .map((option) => option.textContent ?? '')
    .filter((label) => label !== '')
}

describe('DocumentCreatePage', () => {
  const fetchMock = vi.fn()
  const user = userEvent.setup()

  function previewPdfResponse(): Response {
    return new Response(new Blob(['%PDF-preview'], { type: 'application/pdf' }), {
      status: 200,
      headers: { 'Content-Type': 'application/pdf' },
    })
  }

  function stubBackend(
    overrides: {
      create?: (input: RequestInfo | URL) => Promise<Response>
      preview?: (input: RequestInfo | URL) => Promise<Response>
    } = {},
  ) {
    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      const method = init?.method ?? 'GET'
      if (method === 'POST' && url.endsWith('/generated-documents/generate-from-input/')) {
        if (overrides.create) return overrides.create(input)
        return Promise.resolve(jsonResponse(201, createdDocument))
      }
      if (method === 'POST' && url.endsWith('/generated-documents/preview/')) {
        if (overrides.preview) return overrides.preview(input)
        return Promise.resolve(previewPdfResponse())
      }
      if (url.includes('/clients/')) return Promise.resolve(jsonResponse(200, clients))
      if (url.includes('/reference-data/document-types/')) {
        return Promise.resolve(jsonResponse(200, docTypes))
      }
      if (url.includes('/reference-data/currencies/')) {
        return Promise.resolve(jsonResponse(200, currencies))
      }
      if (url.includes('/document-templates/')) {
        return Promise.resolve(jsonResponse(200, templates))
      }
      return Promise.resolve(jsonResponse(200, {}))
    })
  }

  async function fillRequiredSelections() {
    await user.selectOptions(screen.getByLabelText(/client/i), '1')
    await user.selectOptions(screen.getByLabelText(/document type/i), '1')
    await user.selectOptions(screen.getByLabelText(/currency/i), '1')
  }

  function postCalls() {
    return fetchMock.mock.calls.filter(([url, init]) => {
      const initObject = init as RequestInit | undefined
      return (
        String(url).endsWith('/generated-documents/generate-from-input/') &&
        (initObject?.method ?? 'GET') === 'POST'
      )
    })
  }

  function previewCalls() {
    return fetchMock.mock.calls.filter(([url, init]) => {
      const initObject = init as RequestInit | undefined
      return (
        String(url).endsWith('/generated-documents/preview/') &&
        (initObject?.method ?? 'GET') === 'POST'
      )
    })
  }

  beforeEach(() => {
    localStorage.clear()
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('shows a loading state while dependency data loads', () => {
    fetchMock.mockReturnValue(new Promise<Response>(() => {}))
    renderCreate()
    expect(screen.getByTestId('document-create-loading')).toHaveTextContent('Loading form data…')
  })

  it('shows a per-dependency error and retries it independently', async () => {
    let failClients = true
    fetchMock.mockImplementation((input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/clients/')) {
        if (failClients) {
          failClients = false
          return Promise.reject(new Error('boom'))
        }
        return Promise.resolve(jsonResponse(200, clients))
      }
      if (url.includes('/reference-data/document-types/')) {
        return Promise.resolve(jsonResponse(200, docTypes))
      }
      if (url.includes('/reference-data/currencies/')) {
        return Promise.resolve(jsonResponse(200, currencies))
      }
      if (url.includes('/document-templates/')) {
        return Promise.resolve(jsonResponse(200, templates))
      }
      return Promise.resolve(jsonResponse(200, {}))
    })
    renderCreate()

    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't load clients.")
    await user.click(screen.getByRole('button', { name: /retry/i }))

    expect(await screen.findByLabelText(/client/i)).toBeInTheDocument()
  })

  it('renders the form with the real clients, valid document types, and currencies', async () => {
    stubBackend()
    renderCreate()

    expect(await screen.findByText('Acme Ltd')).toBeInTheDocument()
    const typeSelect = screen.getByLabelText(/document type/i)
    // Only document types with an active template are selectable.
    expect(optionLabels(typeSelect)).toContain('Invoice')
    expect(optionLabels(typeSelect)).not.toContain('Consulting contract')
    expect(screen.getByRole('option', { name: 'AZN' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^generate$/i })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /cancel/i })).toHaveAttribute('href', '/documents')
  })

  it('blocks submission without required selections and does not POST', async () => {
    stubBackend()
    renderCreate()
    await screen.findByLabelText(/client/i)

    await user.click(screen.getByRole('button', { name: /^generate$/i }))

    expect(screen.getByText('A client is required.')).toBeInTheDocument()
    expect(screen.getByText('A document type is required.')).toBeInTheDocument()
    expect(screen.getByText('A currency is required.')).toBeInTheDocument()
    expect(postCalls()).toHaveLength(0)
  })

  it('sends no request while opening the page and filling fields', async () => {
    stubBackend()
    renderCreate()
    await screen.findByLabelText(/client/i)
    await fillRequiredSelections()

    await user.click(screen.getByRole('button', { name: /add line item/i }))
    await user.type(screen.getByLabelText(/description/i), 'Consulting hours')

    // Opening the page and filling the form must not create any draft: the
    // atomic Generate endpoint and the preview endpoint are only called when
    // their buttons are clicked.
    expect(postCalls()).toHaveLength(0)
    expect(previewCalls()).toHaveLength(0)
  })

  it('previews the current form state into a PDF iframe with exactly one request', async () => {
    const createSpy = vi.fn(() => 'blob:preview')
    const originalCreate = URL.createObjectURL
    URL.createObjectURL = createSpy
    try {
      stubBackend()
      renderCreate()
      await screen.findByLabelText(/client/i)
      await fillRequiredSelections()
      await user.click(screen.getByRole('button', { name: /add line item/i }))
      await user.type(screen.getByLabelText(/description/i), 'Consulting hours')
      await user.type(screen.getByLabelText(/quantity/i), '10')
      await user.type(screen.getByLabelText(/unit price/i), '100')
      await user.type(screen.getByLabelText(/vat %/i), '18')

      await user.click(screen.getByRole('button', { name: /^preview$/i }))

      const iframe = await screen.findByTestId('document-preview')
      expect(iframe).toHaveAttribute('src', 'blob:preview')

      const calls = previewCalls()
      expect(calls).toHaveLength(1)
      const [url, init] = calls[0] as [string, RequestInit]
      expect(url).toBe('/api/generated-documents/preview/')
      expect(JSON.parse(String(init.body))).toEqual({
        client_id: 1,
        document_type_id: 1,
        currency_id: 1,
        items: [
          {
            description: 'Consulting hours',
            quantity: 10,
            unit: null,
            unit_price: 100,
            discount_percent: 0,
            vat_rate_percent: 18,
          },
        ],
      })
      // A preview is not a generate: no atomic Generate request is sent.
      expect(postCalls()).toHaveLength(0)
    } finally {
      URL.createObjectURL = originalCreate
    }
  })

  it('shows an error and stays on the page when preview fails', async () => {
    stubBackend({
      preview: () =>
        Promise.resolve(
          jsonResponse(400, {
            detail: 'Preview failed. Check the document, client, and template version data.',
          }),
        ),
    })
    renderCreate()
    await screen.findByLabelText(/client/i)
    await fillRequiredSelections()

    await user.click(screen.getByRole('button', { name: /^preview$/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/Preview failed/i)
    expect(screen.queryByTestId('document-preview')).not.toBeInTheDocument()
    expect(screen.queryByTestId('detail-view')).not.toBeInTheDocument()
    expect(previewCalls()).toHaveLength(1)
    expect(postCalls()).toHaveLength(0)
  })

  it('clears and revokes the preview when a relevant input changes', async () => {
    const createSpy = vi.fn(() => 'blob:preview')
    const revokeSpy = vi.fn()
    const originalCreate = URL.createObjectURL
    const originalRevoke = URL.revokeObjectURL
    URL.createObjectURL = createSpy
    URL.revokeObjectURL = revokeSpy
    try {
      stubBackend()
      renderCreate()
      await screen.findByLabelText(/client/i)
      await fillRequiredSelections()

      await user.click(screen.getByRole('button', { name: /^preview$/i }))
      await screen.findByTestId('document-preview')

      // Changing a relevant input invalidates the stale preview: the PDF
      // disappears and its object URL is revoked.
      await user.click(screen.getByRole('button', { name: /add line item/i }))

      expect(screen.queryByTestId('document-preview')).not.toBeInTheDocument()
      expect(revokeSpy).toHaveBeenCalledWith('blob:preview')
    } finally {
      URL.createObjectURL = originalCreate
      URL.revokeObjectURL = originalRevoke
    }
  })

  it('prevents duplicate preview requests while one is in flight', async () => {
    let resolvePreview: (value: Response) => void = () => {}
    stubBackend({
      preview: () =>
        new Promise<Response>((resolve) => {
          resolvePreview = resolve
        }),
    })
    renderCreate()
    await screen.findByLabelText(/client/i)
    await fillRequiredSelections()

    await user.click(screen.getByRole('button', { name: /^preview$/i }))

    const previewing = screen.getByRole('button', { name: /previewing/i })
    expect(previewing).toBeDisabled()
    await user.click(previewing)
    expect(previewCalls()).toHaveLength(1)

    resolvePreview(previewPdfResponse())
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /^preview$/i })).toBeEnabled(),
    )
    expect(previewCalls()).toHaveLength(1)
  })

  it('generates a document with exactly one request and navigates to its detail page using the real id', async () => {
    stubBackend()
    renderCreate()
    await screen.findByLabelText(/client/i)
    await fillRequiredSelections()

    await user.click(screen.getByRole('button', { name: /add line item/i }))
    await user.type(screen.getByLabelText(/description/i), 'Consulting hours')
    await user.type(screen.getByLabelText(/quantity/i), '10')
    await user.type(screen.getByLabelText(/unit price/i), '100')
    await user.type(screen.getByLabelText(/vat %/i), '18')

    await user.click(screen.getByRole('button', { name: /^generate$/i }))

    // POST /api/generated-documents/generate-from-input/ returns the created
    // document (id 9); the form must navigate to that real id, not fabricate
    // one — and must issue exactly one request (no separate create call).
    const detail = await screen.findByTestId('detail-view')
    expect(detail).toHaveTextContent('9')
    const calls = postCalls()
    expect(calls).toHaveLength(1)
    const [url, init] = calls[0] as [string, RequestInit]
    expect(url).toBe('/api/generated-documents/generate-from-input/')
    expect(JSON.parse(String(init.body))).toEqual({
      client_id: 1,
      document_type_id: 1,
      currency_id: 1,
      items: [
        {
          description: 'Consulting hours',
          quantity: 10,
          unit: null,
          unit_price: 100,
          discount_percent: 0,
          vat_rate_percent: 18,
        },
      ],
    })
  })

  it('shows an error and stays on the page when generation fails', async () => {
    stubBackend({
      create: () =>
        Promise.resolve(jsonResponse(400, { detail: 'Document generation failed.' })),
    })
    renderCreate()
    await screen.findByLabelText(/client/i)
    await fillRequiredSelections()

    await user.click(screen.getByRole('button', { name: /^generate$/i }))

    // A failed Generate shows the backend message and navigates nowhere: no
    // draft is left behind, so the form stays open for correction/retry.
    expect(await screen.findByRole('alert')).toHaveTextContent(
      /Document generation failed/i,
    )
    expect(screen.queryByTestId('detail-view')).not.toBeInTheDocument()
    expect(postCalls()).toHaveLength(1)
  })

  it('submits line items added, edited, and removed correctly', async () => {
    stubBackend()
    renderCreate()
    await screen.findByLabelText(/client/i)
    await fillRequiredSelections()

    await user.click(screen.getByRole('button', { name: /add line item/i }))
    await user.type(screen.getByLabelText(/description/i), 'First line')
    await user.type(screen.getByLabelText(/quantity/i), '2')
    await user.type(screen.getByLabelText(/unit price/i), '50')
    await user.type(screen.getByLabelText(/vat %/i), '18')

    await user.click(screen.getByRole('button', { name: /add line item/i }))
    await user.type(screen.getAllByLabelText(/description/i)[1], 'Second line')
    await user.type(screen.getAllByLabelText(/quantity/i)[1], '3')
    await user.type(screen.getAllByLabelText(/unit price/i)[1], '20')
    await user.type(screen.getAllByLabelText(/vat %/i)[1], '10')

    // Remove the second line.
    await user.click(screen.getAllByRole('button', { name: /remove/i })[1])

    await user.click(screen.getByRole('button', { name: /^generate$/i }))
    const detail = await screen.findByTestId('detail-view')
    expect(detail).toHaveTextContent('9')

    const [, init] = postCalls()[0] as [string, RequestInit]
    const body = JSON.parse(String(init.body)) as {
      items: Array<{ description: string; quantity: number; unit_price: number }>
    }
    expect(body.items).toEqual([
      { description: 'First line', quantity: 2, unit_price: 50, vat_rate_percent: 18, discount_percent: 0, unit: null },
    ])
  })

  it('prevents duplicate submissions while a request is in flight', async () => {
    let resolvePost: (value: Response) => void = () => {}
    stubBackend({
      create: () =>
        new Promise<Response>((resolve) => {
          resolvePost = resolve
        }),
    })
    renderCreate()
    await screen.findByLabelText(/client/i)
    await fillRequiredSelections()

    await user.click(screen.getByRole('button', { name: /^generate$/i }))

    const generating = screen.getByRole('button', { name: /generating/i })
    expect(generating).toBeDisabled()
    await user.click(generating)
    expect(postCalls()).toHaveLength(1)

    resolvePost(jsonResponse(201, createdDocument))
    const detail = await screen.findByTestId('detail-view')
    expect(detail).toHaveTextContent('9')
  })

  it('shows backend field validation errors next to the relevant field', async () => {
    stubBackend({
      create: () =>
        Promise.resolve(jsonResponse(400, { client_id: ['This field is required.'] })),
    })
    renderCreate()
    await screen.findByLabelText(/client/i)
    await fillRequiredSelections()

    await user.click(screen.getByRole('button', { name: /^generate$/i }))

    expect(await screen.findByText('This field is required.')).toBeInTheDocument()
  })

  it('shows backend line-item validation errors on the row', async () => {
    stubBackend({
      create: () =>
        Promise.resolve(
          jsonResponse(400, {
            items: [{ quantity: ['Ensure this value is greater than or equal to 1.'] }],
          }),
        ),
    })
    renderCreate()
    await screen.findByLabelText(/client/i)
    await fillRequiredSelections()
    await user.click(screen.getByRole('button', { name: /add line item/i }))
    await user.type(screen.getByLabelText(/description/i), 'X')
    await user.type(screen.getByLabelText(/quantity/i), '0')
    await user.type(screen.getByLabelText(/unit price/i), '1')
    await user.type(screen.getByLabelText(/vat %/i), '18')

    await user.click(screen.getByRole('button', { name: /^generate$/i }))

    // The error is rendered next to the offending line-item field (it also
    // appears in the form banner, so target the row-level error element).
    await screen.findByText(/greater than or equal to 1/i, { selector: '#item-0-quantity-error' })
    expect(screen.getByLabelText(/quantity/i)).toHaveAttribute('aria-invalid', 'true')
  })

  it('shows a backend non-field detail message', async () => {
    stubBackend({
      create: () =>
        Promise.resolve(
          jsonResponse(400, {
            detail: 'No active document template exists in this company for the selected document type.',
          }),
        ),
    })
    renderCreate()
    await screen.findByLabelText(/client/i)
    await fillRequiredSelections()

    await user.click(screen.getByRole('button', { name: /^generate$/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      /No active document template exists/i,
    )
  })

  it('cancels back to the documents list', async () => {
    stubBackend()
    renderCreate()
    await screen.findByLabelText(/client/i)

    await user.click(screen.getByRole('link', { name: /cancel/i }))

    expect(await screen.findByTestId('documents-list')).toBeInTheDocument()
  })
})