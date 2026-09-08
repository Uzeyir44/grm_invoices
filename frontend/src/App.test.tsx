import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import { AuthProvider } from './contexts/AuthContext'
import { setAccessToken } from './utils/authStorage'

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

const ME = {
  id: 1,
  email: 'alice@example.com',
  first_name: 'Alice',
  last_name: 'User',
  is_active: true,
  mfa_enabled: false,
  company_id: 10,
  company_name: 'Acme Co',
}

const DOC_DETAIL = {
  id: 1,
  company_id: 10,
  document_type: 1,
  document_type_code: 'invoice',
  client_id: 1,
  template_id: 1,
  document_number: 'INV-001',
  status: 'draft',
  created_by_id: 1,
  created_at: '2026-09-01T10:00:00+00:00',
  updated_at: '2026-09-01T10:00:00+00:00',
}

function renderAt(path: string) {
  return render(
    <AuthProvider>
      <MemoryRouter initialEntries={[path]}>
        <App />
      </MemoryRouter>
    </AuthProvider>,
  )
}

describe('App', () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    localStorage.clear()
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  /** Real /me response plus empty (but valid) list responses for dashboard. */
  function stubBackend() {
    fetchMock.mockImplementation((input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/authentication/me/')) return Promise.resolve(jsonResponse(200, ME))
      if (url.includes('/clients/')) return Promise.resolve(jsonResponse(200, []))
      if (url.includes('/document-templates/')) {
        return Promise.resolve(jsonResponse(200, []))
      }
      if (url.includes('/generated-documents/')) {
        // List (exact) returns an empty array; a versions list is empty too;
        // any other path is a single document row.
        if (url.endsWith('/versions/')) return Promise.resolve(jsonResponse(200, []))
        return Promise.resolve(
          jsonResponse(200, url.endsWith('/generated-documents/') ? [] : DOC_DETAIL),
        )
      }
      if (url.includes('/reference-data/document-types/')) {
        return Promise.resolve(jsonResponse(200, []))
      }
      if (url.includes('/reference-data/currencies/')) {
        return Promise.resolve(jsonResponse(200, []))
      }
      if (url.includes('/audit-logs/')) {
        return Promise.resolve(
          jsonResponse(200, { count: 0, next: null, previous: null, results: [] }),
        )
      }
      return Promise.resolve(jsonResponse(200, {}))
    })
    vi.stubGlobal('fetch', fetchMock)
  }

  it('redirects an unauthenticated user from a protected route to login', async () => {
    renderAt('/dashboard')
    expect(await screen.findByRole('heading', { name: /sign in/i })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: /dashboard/i })).not.toBeInTheDocument()
  })

  it('grants an authenticated user access to the dashboard inside the shell', async () => {
    setAccessToken('token-1')
    stubBackend()

    renderAt('/dashboard')

    expect(
      await screen.findByRole('navigation', { name: /main navigation/i }),
    ).toBeInTheDocument()
    expect(await screen.findByRole('heading', { name: /dashboard/i })).toBeInTheDocument()
  })

  it('redirects an authenticated user away from /login to the dashboard', async () => {
    setAccessToken('token-1')
    stubBackend()

    renderAt('/login')

    expect(await screen.findByRole('heading', { name: /dashboard/i })).toBeInTheDocument()
  })

  it('keeps the application shell (navigation) out of /login', async () => {
    renderAt('/login')
    expect(await screen.findByRole('heading', { name: /sign in/i })).toBeInTheDocument()
    expect(
      screen.queryByRole('navigation', { name: /main navigation/i }),
    ).not.toBeInTheDocument()
  })

  it('shows a loading state instead of redirecting while auth initializes', async () => {
    setAccessToken('token-1')
    fetchMock.mockReturnValue(new Promise<Response>(() => {}))

    renderAt('/dashboard')

    expect(screen.getByRole('status')).toHaveTextContent('Loading…')
    expect(screen.queryByRole('heading', { name: /sign in/i })).not.toBeInTheDocument()
  })

  it('lets an authenticated user navigate between protected sections', async () => {
    setAccessToken('token-1')
    stubBackend()
    const user = userEvent.setup()
    renderAt('/dashboard')

    await screen.findByRole('heading', { name: /dashboard/i })
    await user.click(screen.getByRole('link', { name: /clients/i }))
    expect(await screen.findByRole('heading', { name: /clients/i })).toBeInTheDocument()
  })

  it('redirects to login after signing out', async () => {
    setAccessToken('token-1')
    stubBackend()
    const user = userEvent.setup()
    renderAt('/dashboard')

    await screen.findByRole('heading', { name: /dashboard/i })
    await user.click(screen.getByRole('button', { name: /sign out/i }))

    expect(await screen.findByRole('heading', { name: /sign in/i })).toBeInTheDocument()
  })

  it('redirects unauthenticated users away from client routes', async () => {
    for (const path of ['/clients', '/clients/new', '/clients/1', '/clients/1/edit']) {
      const { unmount } = renderAt(path)
      expect(await screen.findByRole('heading', { name: /sign in/i })).toBeInTheDocument()
      unmount()
    }
  })

  it('redirects unauthenticated users away from template routes', async () => {
    for (const path of ['/templates', '/templates/new', '/templates/1']) {
      const { unmount } = renderAt(path)
      expect(await screen.findByRole('heading', { name: /sign in/i })).toBeInTheDocument()
      unmount()
    }
  })

  it('redirects unauthenticated users away from the documents route', async () => {
    const { unmount } = renderAt('/documents')
    expect(await screen.findByRole('heading', { name: /sign in/i })).toBeInTheDocument()
    unmount()
  })

  it('redirects unauthenticated users away from the document create route', async () => {
    const { unmount } = renderAt('/documents/new')
    expect(await screen.findByRole('heading', { name: /sign in/i })).toBeInTheDocument()
    unmount()
  })

  it('redirects unauthenticated users away from the document detail route', async () => {
    const { unmount } = renderAt('/documents/1')
    expect(await screen.findByRole('heading', { name: /sign in/i })).toBeInTheDocument()
    unmount()
  })

  it('renders the document detail page inside the protected shell for authenticated users', async () => {
    setAccessToken('token-1')
    stubBackend()

    renderAt('/documents/1')

    expect(
      await screen.findByRole('navigation', { name: /main navigation/i }),
    ).toBeInTheDocument()
    expect(await screen.findByRole('heading', { name: /INV-001/ })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /back to documents/i })).toBeInTheDocument()
  })

  it('renders the document create form inside the protected shell for authenticated users', async () => {
    setAccessToken('token-1')
    stubBackend()

    renderAt('/documents/new')

    expect(
      await screen.findByRole('navigation', { name: /main navigation/i }),
    ).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /new document/i })).toBeInTheDocument()
    // All dependency catalogs are empty in the stub, so the form still renders.
    expect(await screen.findByLabelText(/client/i)).toBeInTheDocument()
  })

  it('renders the documents list inside the protected shell for authenticated users', async () => {
    setAccessToken('token-1')
    stubBackend()

    renderAt('/documents')

    expect(
      await screen.findByRole('navigation', { name: /main navigation/i }),
    ).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /documents/i })).toBeInTheDocument()
    // The empty backend documents list produces the empty state (no fabricated rows).
    expect(await screen.findByText('No documents yet.')).toBeInTheDocument()
  })

  it('renders the template list inside the protected shell for authenticated users', async () => {
    setAccessToken('token-1')
    stubBackend()

    renderAt('/templates')

    expect(
      await screen.findByRole('navigation', { name: /main navigation/i }),
    ).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /templates/i })).toBeInTheDocument()
    // The empty backend template list produces the empty state (no fabricated rows).
    expect(await screen.findByText('No templates yet.')).toBeInTheDocument()
  })

  it('renders the client list inside the protected shell for authenticated users', async () => {
    setAccessToken('token-1')
    stubBackend()

    renderAt('/clients')

    expect(
      await screen.findByRole('navigation', { name: /main navigation/i }),
    ).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /clients/i })).toBeInTheDocument()
    // The empty backend client list produces the empty state (no fabricated rows).
    expect(await screen.findByText('No clients yet.')).toBeInTheDocument()
  })

  it('redirects unauthenticated users away from the audit logs route', async () => {
    const { unmount } = renderAt('/audit-logs')
    expect(await screen.findByRole('heading', { name: /sign in/i })).toBeInTheDocument()
    unmount()
  })

  it('renders the audit logs list inside the protected shell for authenticated users', async () => {
    setAccessToken('token-1')
    stubBackend()

    renderAt('/audit-logs')

    expect(
      await screen.findByRole('navigation', { name: /main navigation/i }),
    ).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /audit logs/i })).toBeInTheDocument()
    // The empty backend audit log envelope produces the empty state (no fabricated rows).
    expect(await screen.findByText('No audit logs found.')).toBeInTheDocument()
  })

  it('exposes the audit logs section in the main navigation', async () => {
    setAccessToken('token-1')
    stubBackend()
    const user = userEvent.setup()
    renderAt('/dashboard')

    await screen.findByRole('heading', { name: /dashboard/i })
    const auditLogsLink = screen.getByRole('link', { name: /audit logs/i })
    expect(auditLogsLink).toHaveAttribute('href', '/audit-logs')

    await user.click(auditLogsLink)
    expect(await screen.findByText('No audit logs found.')).toBeInTheDocument()
  })

  it('renders a not-found page for unknown routes', async () => {
    renderAt('/definitely-not-a-route')
    expect(await screen.findByRole('heading', { name: /not found/i })).toBeInTheDocument()
  })
})