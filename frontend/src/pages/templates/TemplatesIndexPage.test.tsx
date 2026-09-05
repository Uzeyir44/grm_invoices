import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TemplatesIndexPage } from './TemplatesIndexPage'
import type { DocumentTemplate } from '../../types/documentTemplate'
import { documentTypes, jsonResponse, templateSummaries } from '../../test/templateFixtures'

function renderTemplates() {
  return render(
    <MemoryRouter initialEntries={['/templates']}>
      <Routes>
        <Route path="/templates" element={<TemplatesIndexPage />} />
        <Route path="/templates/new" element={<div>create-page</div>} />
        <Route path="/templates/:templateId" element={<div>detail-page</div>} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('TemplatesIndexPage', () => {
  const fetchMock = vi.fn()
  const user = userEvent.setup()

  function stubLists(options: { templates?: DocumentTemplate[] } = {}) {
    fetchMock.mockImplementation((input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/reference-data/document-types/')) {
        return Promise.resolve(jsonResponse(200, documentTypes))
      }
      const params = new URL(url, 'http://test').searchParams
      if (params.get('document_type') === '1') {
        return Promise.resolve(jsonResponse(200, [templateSummaries[0]]))
      }
      return Promise.resolve(jsonResponse(200, options.templates ?? templateSummaries))
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

  it('shows a loading state while the list request is pending', () => {
    fetchMock.mockReturnValue(new Promise<Response>(() => {}))
    renderTemplates()
    expect(screen.getByTestId('templates-loading')).toHaveTextContent('Loading…')
  })

  it('renders the real template list with counts and detail links', async () => {
    stubLists()
    renderTemplates()

    await screen.findByTestId('templates-count')
    expect(screen.getByTestId('templates-count')).toHaveTextContent('2 templates')
    const invoice = screen.getByRole('link', { name: /Standard Invoice/ })
    expect(invoice).toHaveAttribute('href', '/templates/1')
    expect(screen.getByRole('cell', { name: 'invoice' })).toBeInTheDocument()
    expect(screen.getByRole('cell', { name: 'consulting_contract' })).toBeInTheDocument()
    // file_name is shown as its basename only — never the raw storage path.
    expect(screen.getByRole('cell', { name: 'abc123.docx' })).toBeInTheDocument()
    expect(screen.getByRole('cell', { name: 'No file' })).toBeInTheDocument()
  })

  it('shows an empty state with a create action when there are no templates', async () => {
    stubLists({ templates: [] })
    renderTemplates()

    expect(await screen.findByText('No templates yet.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /create your first template/i })).toHaveAttribute(
      'href',
      '/templates/new',
    )
  })

  it('shows an error state and retries the list request', async () => {
    let failTemplates = true
    fetchMock.mockImplementation((input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/reference-data/document-types/')) {
        return Promise.resolve(jsonResponse(200, documentTypes))
      }
      if (failTemplates) {
        failTemplates = false
        return Promise.reject(new Error('boom'))
      }
      return Promise.resolve(jsonResponse(200, templateSummaries))
    })
    renderTemplates()

    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't load templates.")
    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /retry/i }))
    expect(await screen.findByRole('link', { name: /Standard Invoice/ })).toBeInTheDocument()
  })

  it('filters by document type using the backend document_type parameter, kept in the URL', async () => {
    stubLists()
    renderTemplates()
    await screen.findByRole('link', { name: /Standard Invoice/ })

    await user.selectOptions(
      screen.getByRole('combobox', { name: /filter by document type/i }),
      '1',
    )

    await waitFor(() =>
      expect(screen.queryByRole('link', { name: /Consulting Contract/ })).not.toBeInTheDocument(),
    )
    const call = fetchMock.mock.calls.at(-1) as [string]
    expect(call[0]).toContain('document_type=1')
  })

  it('keeps the list working when the filter options fail to load', async () => {
    fetchMock.mockImplementation((input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/reference-data/document-types/')) {
        return Promise.reject(new Error('boom'))
      }
      return Promise.resolve(jsonResponse(200, templateSummaries))
    })
    renderTemplates()

    expect(await screen.findByRole('link', { name: /Standard Invoice/ })).toBeInTheDocument()
    expect(screen.getByText(/couldn't load filter options/i)).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: /filter by document type/i })).toBeDisabled()
  })

  it('navigates to the create page', async () => {
    stubLists({ templates: [] })
    renderTemplates()
    await screen.findByText('No templates yet.')

    await user.click(screen.getByRole('link', { name: /new template/i }))
    expect(await screen.findByText('create-page')).toBeInTheDocument()
  })

  it('navigates to a template detail page from a row', async () => {
    stubLists()
    renderTemplates()
    await screen.findByRole('link', { name: /Standard Invoice/ })

    await user.click(screen.getByRole('link', { name: /Standard Invoice/ }))
    expect(await screen.findByText('detail-page')).toBeInTheDocument()
  })
})