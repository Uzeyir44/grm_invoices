import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DocumentsIndexPage } from './DocumentsIndexPage'
import { generatedDocuments, jsonResponse } from '../../test/documentFixtures'

function renderDocuments() {
  return render(
    <MemoryRouter initialEntries={['/documents']}>
      <Routes>
        <Route path="/documents" element={<DocumentsIndexPage />} />
        <Route path="/documents/:documentId" element={<div>detail-page</div>} />
      </Routes>
    </MemoryRouter>,
  )
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

  it('shows a loading state while the list request is pending', () => {
    fetchMock.mockReturnValue(new Promise<Response>(() => {}))
    renderDocuments()
    expect(screen.getByTestId('documents-loading')).toHaveTextContent('Loading…')
  })

  it('renders the real generated documents with counts, types, clients, and statuses', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, generatedDocuments))
    renderDocuments()

    await screen.findByTestId('documents-count')
    expect(screen.getByTestId('documents-count')).toHaveTextContent('2 documents')
    expect(screen.getByRole('cell', { name: 'INV-001' })).toBeInTheDocument()
    expect(screen.getByRole('cell', { name: 'CC-001' })).toBeInTheDocument()
    expect(screen.getByRole('cell', { name: 'invoice' })).toBeInTheDocument()
    expect(screen.getByRole('cell', { name: 'consulting_contract' })).toBeInTheDocument()
    expect(screen.getByRole('cell', { name: 'Client #1' })).toBeInTheDocument()
    expect(screen.getByRole('cell', { name: 'Client #2' })).toBeInTheDocument()
    expect(screen.getAllByTestId('document-status')).toHaveLength(2)
    expect(screen.getByText('Generated')).toBeInTheDocument()
    expect(screen.getByText('Draft')).toBeInTheDocument()
    expect(screen.getByRole('cell', { name: '2026-09-04' })).toBeInTheDocument()
  })

  it('links each document number to its detail route', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, generatedDocuments))
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
    fetchMock.mockResolvedValue(jsonResponse(200, generatedDocuments))
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
  })

  it('shows an error state and retries the request', async () => {
    fetchMock.mockRejectedValueOnce(new Error('boom'))
    renderDocuments()

    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't load documents.")
    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument()

    fetchMock.mockResolvedValueOnce(jsonResponse(200, generatedDocuments))
    await user.click(screen.getByRole('button', { name: /retry/i }))

    expect(await screen.findByRole('cell', { name: 'INV-001' })).toBeInTheDocument()
  })

  it('does not invent search or pagination controls the backend does not support', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, generatedDocuments))
    renderDocuments()
    await screen.findByTestId('documents-count')

    expect(screen.queryByRole('searchbox')).not.toBeInTheDocument()
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /next/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /previous/i })).not.toBeInTheDocument()
  })
})