import { render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AuthProvider } from '../../contexts/AuthContext'
import { DashboardIndexPage } from './DashboardIndexPage'

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

const CLIENTS = [
  { id: 1, client_type: 'legal_entity', status: 'active', display_name: 'Acme Ltd', company_id: 10 },
  { id: 2, client_type: 'individual', status: 'active', display_name: 'Jane Doe', company_id: 10 },
  { id: 3, client_type: 'legal_entity', status: 'inactive', display_name: 'Globex', company_id: 10 },
]

const TEMPLATES = [
  {
    id: 1,
    company_id: 10,
    document_type: 1,
    document_type_code: 'invoice',
    name: 'Standard Invoice',
    is_active: true,
    file: '/api/document-templates/1/file/',
    file_name: 'tpl.docx',
    created_at: '2026-09-01T10:00:00+00:00',
    updated_at: '2026-09-01T10:00:00+00:00',
  },
]

const DOCUMENTS = [
  {
    id: 2,
    company_id: 10,
    document_type: 1,
    document_type_code: 'invoice',
    client_id: 1,
    template_id: 1,
    document_number: 'INV-002',
    status: 'draft',
    created_by_id: 1,
    created_at: '2026-09-02T10:00:00+00:00',
    updated_at: '2026-09-02T10:00:00+00:00',
  },
  {
    id: 1,
    company_id: 10,
    document_type: 1,
    document_type_code: 'invoice',
    client_id: 1,
    template_id: 1,
    document_number: 'INV-001',
    status: 'generated',
    created_by_id: 1,
    created_at: '2026-09-01T10:00:00+00:00',
    updated_at: '2026-09-01T10:00:00+00:00',
  },
]

function renderDashboard() {
  return render(
    <AuthProvider>
      <MemoryRouter initialEntries={['/dashboard']}>
        <Routes>
          <Route path="/dashboard" element={<DashboardIndexPage />} />
        </Routes>
      </MemoryRouter>
    </AuthProvider>,
  )
}

describe('DashboardIndexPage', () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    localStorage.clear()
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  function stubLists(overrides: {
    clients?: typeof CLIENTS
    templates?: typeof TEMPLATES
    documents?: typeof DOCUMENTS
    failClients?: boolean
    pending?: boolean
  } = {}) {
    const {
      clients = CLIENTS,
      templates = TEMPLATES,
      documents = DOCUMENTS,
      failClients = false,
      pending = false,
    } = overrides
    fetchMock.mockImplementation((input: RequestInfo | URL) => {
      const url = String(input)
      if (pending) {
        return new Promise<Response>(() => {})
      }
      if (url.includes('/clients/')) {
        return failClients
          ? Promise.reject(new Error('boom'))
          : Promise.resolve(jsonResponse(200, clients))
      }
      if (url.includes('/document-templates/')) {
        return Promise.resolve(jsonResponse(200, templates))
      }
      if (url.includes('/generated-documents/')) {
        return Promise.resolve(jsonResponse(200, documents))
      }
      return Promise.resolve(jsonResponse(200, {}))
    })
    vi.stubGlobal('fetch', fetchMock)
  }

  it('renders loading states while the list requests are pending', () => {
    stubLists({ pending: true })
    renderDashboard()
    expect(within(screen.getByTestId('stat-clients')).getByText('Loading…')).toBeInTheDocument()
    expect(
      within(screen.getByTestId('stat-templates')).getByText('Loading…'),
    ).toBeInTheDocument()
    expect(
      within(screen.getByTestId('stat-documents')).getByText('Loading…'),
    ).toBeInTheDocument()
    expect(screen.getByTestId('recent-documents-loading')).toBeInTheDocument()
  })

  it('renders counts and recent documents derived from real responses', async () => {
    stubLists()
    renderDashboard()

    await waitFor(() =>
      expect(within(screen.getByTestId('stat-clients')).getByTestId('stat-clients-value')).toHaveTextContent('3'),
    )
    expect(within(screen.getByTestId('stat-templates')).getByTestId('stat-templates-value')).toHaveTextContent('1')
    expect(within(screen.getByTestId('stat-documents')).getByTestId('stat-documents-value')).toHaveTextContent('2')
    expect(screen.getByText('INV-001')).toBeInTheDocument()
    expect(screen.getByText('INV-002')).toBeInTheDocument()
  })

  it('shows empty states instead of fabricated zeroes', async () => {
    stubLists({ clients: [], templates: [], documents: [] })
    renderDashboard()

    expect(
      await within(screen.getByTestId('stat-clients')).findByText('No clients yet.'),
    ).toBeInTheDocument()
    expect(within(screen.getByTestId('stat-templates')).getByText('No templates yet.')).toBeInTheDocument()
    expect(within(screen.getByTestId('stat-documents')).getByText('No documents yet.')).toBeInTheDocument()
    // Shown both in the stat card and the recent-documents section.
    expect(await screen.findAllByText('No documents yet.')).toHaveLength(2)
  })

  it('does not fabricate statistics — numbers equal the real data lengths', async () => {
    stubLists({ clients: CLIENTS, templates: TEMPLATES, documents: DOCUMENTS })
    renderDashboard()

    const clientsValue = await within(screen.getByTestId('stat-clients')).findByTestId(
      'stat-clients-value',
    )
    expect(clientsValue).toHaveTextContent(String(CLIENTS.length))
    const docsValue = within(screen.getByTestId('stat-documents')).getByTestId(
      'stat-documents-value',
    )
    expect(docsValue).toHaveTextContent(String(DOCUMENTS.length))
  })

  it('keeps other sections usable when one section fails', async () => {
    stubLists({ failClients: true })
    renderDashboard()

    expect(
      await within(screen.getByTestId('stat-clients')).findByText("Couldn't load clients."),
    ).toBeInTheDocument()
    // Unrelated sections still work.
    expect(
      within(screen.getByTestId('stat-templates')).getByTestId('stat-templates-value'),
    ).toHaveTextContent('1')
    expect(within(screen.getByTestId('stat-documents')).getByTestId('stat-documents-value')).toHaveTextContent('2')
    expect(screen.getByText('INV-001')).toBeInTheDocument()
  })
})