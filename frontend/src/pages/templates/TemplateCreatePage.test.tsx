import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useParams } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TemplateCreatePage } from './TemplateCreatePage'
import { documentTypes, jsonResponse, templateDetail } from '../../test/templateFixtures'

function DetailMarker() {
  const { templateId } = useParams()
  return <div data-testid="detail-view">{templateId}</div>
}

function renderCreate() {
  return render(
    <MemoryRouter initialEntries={['/templates/new']}>
      <Routes>
        <Route path="/templates/new" element={<TemplateCreatePage />} />
        <Route path="/templates/:templateId" element={<DetailMarker />} />
        <Route path="/templates" element={<div data-testid="list-view" />} />
      </Routes>
    </MemoryRouter>,
  )
}

/** Mocked backend: document-type catalog + a create endpoint. */

describe('TemplateCreatePage', () => {
  const fetchMock = vi.fn()
  const user = userEvent.setup()

  function stubCreate() {
    fetchMock.mockImplementation((input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/reference-data/document-types/')) {
        return Promise.resolve(jsonResponse(200, documentTypes))
      }
      return Promise.resolve(jsonResponse(201, templateDetail))
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

  it('renders the actual serializer fields without any company field', async () => {
    stubCreate()
    renderCreate()

    expect(await screen.findByLabelText(/template name/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/document type/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/active/i)).toBeInTheDocument()
    // No company id field exists — the tenant comes from the backend.
    expect(screen.queryByLabelText(/company/i)).not.toBeInTheDocument()
  })

  it('shows a loading state while the document-type catalog loads', () => {
    fetchMock.mockReturnValue(new Promise<Response>(() => {}))
    renderCreate()
    expect(screen.getByTestId('template-create-loading')).toHaveTextContent(
      'Loading document types…',
    )
  })

  it('shows an error state when the document-type catalog fails and retries', async () => {
    fetchMock.mockRejectedValueOnce(new Error('boom'))
    renderCreate()

    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't load document types.")

    fetchMock.mockResolvedValue(jsonResponse(200, documentTypes))
    await user.click(screen.getByRole('button', { name: /retry/i }))
    expect(await screen.findByLabelText(/template name/i)).toBeInTheDocument()
  })

  it('blocks submission without required fields and does not POST', async () => {
    stubCreate()
    renderCreate()
    await screen.findByLabelText(/template name/i)

    await user.click(screen.getByRole('button', { name: /create template/i }))

    expect(screen.getByText('Template name is required.')).toBeInTheDocument()
    expect(screen.getByText('A document type is required.')).toBeInTheDocument()
    const postCalls = fetchMock.mock.calls.filter(([url]) =>
      String(url).endsWith('/document-templates/'),
    )
    expect(postCalls).toHaveLength(0)
  })

  it('creates a template and navigates to its detail page', async () => {
    stubCreate()
    renderCreate()
    await screen.findByLabelText(/template name/i)

    await user.type(screen.getByLabelText(/template name/i), 'Standard Invoice')
    await user.selectOptions(screen.getByLabelText(/document type/i), '1')
    await user.click(screen.getByRole('button', { name: /create template/i }))

    const postCall = await screen.findByTestId('detail-view')
    expect(postCall).toHaveTextContent('1')
    const [url, init] = fetchMock.mock.calls.at(-1) as [string, RequestInit]
    expect(url).toBe('/api/document-templates/')
    expect(JSON.parse(String(init.body))).toEqual({
      name: 'Standard Invoice',
      document_type: 1,
      is_active: true,
    })
  })

  it('shows backend validation errors and preserves entered values', async () => {
    fetchMock.mockImplementation((input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/reference-data/document-types/')) {
        return Promise.resolve(jsonResponse(200, documentTypes))
      }
      return Promise.resolve(jsonResponse(400, { name: ['A template with this name already exists.'] }))
    })
    renderCreate()
    await screen.findByLabelText(/template name/i)

    await user.type(screen.getByLabelText(/template name/i), 'Duplicate')
    await user.selectOptions(screen.getByLabelText(/document type/i), '1')
    await user.click(screen.getByRole('button', { name: /create template/i }))

    expect(await screen.findByText(/name already exists/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/template name/i)).toHaveValue('Duplicate')
  })

  it('prevents duplicate submissions while a request is in flight', async () => {
    let resolvePost: (value: Response) => void = () => {}
    fetchMock.mockImplementation((input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/reference-data/document-types/')) {
        return Promise.resolve(jsonResponse(200, documentTypes))
      }
      return new Promise<Response>((resolve) => {
        resolvePost = resolve
      })
    })
    renderCreate()
    await screen.findByLabelText(/template name/i)

    await user.type(screen.getByLabelText(/template name/i), 'Standard Invoice')
    await user.selectOptions(screen.getByLabelText(/document type/i), '1')
    await user.click(screen.getByRole('button', { name: /create template/i }))

    const creating = screen.getByRole('button', { name: /creating/i })
    expect(creating).toBeDisabled()
    await user.click(creating)
    const postCalls = fetchMock.mock.calls.filter(([url]) =>
      String(url).endsWith('/document-templates/'),
    )
    expect(postCalls).toHaveLength(1)

    resolvePost(jsonResponse(201, templateDetail))
    await screen.findByTestId('detail-view')
  })
})