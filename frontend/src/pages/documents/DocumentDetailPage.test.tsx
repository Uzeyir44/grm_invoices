import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DocumentDetailPage } from './DocumentDetailPage'
import { generatedDocuments, jsonResponse } from '../../test/documentFixtures'

const document = generatedDocuments[0]

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

  it('shows a loading state while fetching', () => {
    fetchMock.mockReturnValue(new Promise<Response>(() => {}))
    renderDetail()
    expect(screen.getByTestId('document-detail-loading')).toHaveTextContent('Loading…')
  })

  it('renders the document metadata returned by the detail serializer', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, document))
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

    const clientUrl = String(fetchMock.mock.calls[0][0])
    expect(clientUrl).toBe('/api/generated-documents/9/')
  })

  it('shows a safe not-found state for 404 (covers cross-tenant too)', async () => {
    fetchMock.mockResolvedValue(jsonResponse(404, { detail: 'Not found.' }))
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
    fetchMock.mockResolvedValue(jsonResponse(403, { detail: 'No permission.' }))
    renderDetail()

    expect(
      await screen.findByText(/do not have permission to view this document/i),
    ).toBeInTheDocument()
  })

  it('shows an error state and retries', async () => {
    fetchMock.mockRejectedValueOnce(new Error('boom'))
    renderDetail()

    expect(await screen.findByText("Couldn't load the document.")).toBeInTheDocument()

    fetchMock.mockResolvedValueOnce(jsonResponse(200, document))
    await user.click(screen.getByRole('button', { name: /retry/i }))
    expect(await screen.findByRole('heading', { name: /INV-001/ })).toBeInTheDocument()
  })

  it('navigates back to the documents list', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, document))
    renderDetail()
    await screen.findByRole('heading', { name: /INV-001/ })

    await user.click(screen.getByRole('link', { name: /back to documents/i }))
    expect(await screen.findByTestId('documents-list')).toBeInTheDocument()
  })
})