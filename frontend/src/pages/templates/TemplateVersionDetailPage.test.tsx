import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useNavigate, useParams } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TemplateVersionDetailPage } from './TemplateVersionDetailPage'
import { TemplateDetailPage } from './TemplateDetailPage'
import {
  activeTemplateVersion,
  jsonResponse,
  templateDetail,
  templateVersions,
} from '../../test/templateFixtures'
import type { TemplateVersion } from '../../types/documentTemplate'

const version = templateVersions[0]

function DetailMarker() {
  const { templateId } = useParams()
  return <div data-testid="template-view">{templateId}</div>
}

function NavButton({ to, label }: { to: string; label: string }) {
  const navigate = useNavigate()
  return (
    <button type="button" onClick={() => navigate(to)}>
      {label}
    </button>
  )
}

function renderVersionAt(path: string, withNav = false, navTo = '') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      {withNav ? <NavButton to={navTo} label="Go elsewhere" /> : null}
      <Routes>
        <Route
          path="/templates/:templateId/versions/:versionId"
          element={<TemplateVersionDetailPage />}
        />
        <Route path="/templates/:templateId" element={<DetailMarker />} />
        <Route path="/templates" element={<div data-testid="list-view" />} />
      </Routes>
    </MemoryRouter>,
  )
}

/** Route fetch calls to the version detail endpoint by default. */
function stubVersionBackend(
  handler?: (url: string, init: RequestInit) => Response | Promise<Response>,
) {
  const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (handler) return Promise.resolve(handler(url, (init ?? {}) as RequestInit))
    if (url.includes('/versions/')) {
      return Promise.resolve(jsonResponse(200, version))
    }
    return Promise.resolve(jsonResponse(404, { detail: 'Not found.' }))
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

describe('TemplateVersionDetailPage', () => {
  const user = userEvent.setup()

  beforeEach(() => {
    localStorage.clear()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('shows a loading state while fetching', () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => {})))
    renderVersionAt('/templates/1/versions/10')
    expect(screen.getByTestId('version-loading')).toHaveTextContent('Loading…')
  })

  it('renders every serializer field of the version', async () => {
    stubVersionBackend()
    renderVersionAt('/templates/1/versions/10')

    expect(await screen.findByRole('heading', { name: /version 1/i })).toBeInTheDocument()
    expect(screen.getByText('Inactive')).toBeInTheDocument()
    expect(screen.getByText('v1_aaaa.docx')).toBeInTheDocument()
    expect(screen.getByText('abc123')).toBeInTheDocument()
    expect(screen.getByText('User #1')).toBeInTheDocument()
    expect(screen.getByText('10')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Back to template' })).toHaveAttribute(
      'href',
      '/templates/1',
    )
    expect(screen.getByRole('link', { name: 'Back to templates' })).toHaveAttribute(
      'href',
      '/templates',
    )
  })

  it('renders the active state and file metadata for a version with a file', async () => {
    stubVersionBackend((url) =>
      url.includes('/versions/11/') ? jsonResponse(200, activeTemplateVersion) : jsonResponse(200, version),
    )
    renderVersionAt('/templates/1/versions/11')

    expect(await screen.findByRole('heading', { name: /version 2/i })).toBeInTheDocument()
    expect(screen.getByText('Active')).toBeInTheDocument()
    expect(screen.getByText('v2_bbbb.docx')).toBeInTheDocument()
  })

  it('renders safe fallbacks when optional file metadata is absent', async () => {
    const bare: TemplateVersion = {
      ...version,
      file_name: null,
      has_file: false,
      checksum: null,
      created_by_id: null,
    }
    stubVersionBackend(() => jsonResponse(200, bare))
    renderVersionAt('/templates/1/versions/10')

    expect(await screen.findByRole('heading', { name: /version 1/i })).toBeInTheDocument()
    expect(screen.getByText('No file')).toBeInTheDocument()
    expect(screen.getAllByText('—').length).toBeGreaterThan(0)
  })

  it('shows a safe not-found state for 404 (covers cross-tenant and mismatched versions)', async () => {
    stubVersionBackend(() => jsonResponse(404, { detail: 'Not found.' }))
    renderVersionAt('/templates/1/versions/999')

    expect(await screen.findByText('Version not found.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Back to template' })).toHaveAttribute(
      'href',
      '/templates/1',
    )
  })

  it('shows a safe message for forbidden access', async () => {
    stubVersionBackend(() => jsonResponse(403, { detail: 'No permission.' }))
    renderVersionAt('/templates/1/versions/10')

    expect(
      await screen.findByText(/do not have permission to view this version/i),
    ).toBeInTheDocument()
  })

  it('shows a friendly retry message for 429 with the backend Retry-After value', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          new Response(JSON.stringify({ detail: 'Request was throttled.' }), {
            status: 429,
            headers: { 'Content-Type': 'application/json', 'Retry-After': '9' },
          }),
        ),
      ),
    )
    renderVersionAt('/templates/1/versions/10')

    expect(await screen.findByText(/wait 9 seconds/i)).toBeInTheDocument()
  })

  it('shows a generic error state and retries the same endpoint', async () => {
    const fetchMock = vi.fn()
    fetchMock
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValue(jsonResponse(200, version))
    vi.stubGlobal('fetch', fetchMock)
    renderVersionAt('/templates/1/versions/10')

    expect(await screen.findByText("Couldn't load the version.")).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /retry/i }))
    expect(await screen.findByRole('heading', { name: /version 1/i })).toBeInTheDocument()
    const urls = fetchMock.mock.calls.map(([url]) => String(url))
    expect(urls).toContain('/api/document-templates/1/versions/10/')
  })

  it('handles invalid template/version ids without fetching', async () => {
    const fetchMock = stubVersionBackend()
    renderVersionAt('/templates/abc/versions/xyz')

    expect(await screen.findByText('Version not found.')).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('navigates back to the parent template', async () => {
    stubVersionBackend()
    renderVersionAt('/templates/1/versions/10')

    await screen.findByRole('heading', { name: /version 1/i })
    await user.click(screen.getByRole('link', { name: 'Back to template' }))

    expect(await screen.findByTestId('template-view')).toHaveTextContent('1')
  })

  it('never lets a stale response overwrite a newer version', async () => {
    const second: TemplateVersion = { ...activeTemplateVersion, id: 21, version_number: 5 }
    let resolveFirst: (value: Response) => void = () => {}
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input)
      if (url === '/api/document-templates/1/versions/10/') {
        return new Promise<Response>((resolve) => {
          resolveFirst = resolve
        })
      }
      if (url === '/api/document-templates/2/versions/21/') {
        return Promise.resolve(jsonResponse(200, second))
      }
      return Promise.resolve(jsonResponse(404, { detail: 'Not found.' }))
    })
    vi.stubGlobal('fetch', fetchMock)
    renderVersionAt('/templates/1/versions/10', true, '/templates/2/versions/21')

    // Navigate to another version while the first request is in flight.
    await user.click(screen.getByRole('button', { name: /go elsewhere/i }))
    expect(await screen.findByRole('heading', { name: /version 5/i })).toBeInTheDocument()

    // The stale first-version response arrives late and must be ignored.
    resolveFirst(jsonResponse(200, version))
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    expect(screen.getByRole('heading', { name: /version 5/i })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: /^version 1$/i })).not.toBeInTheDocument()
  })

  it('issues no mutation requests from the page', async () => {
    const fetchMock = stubVersionBackend()
    renderVersionAt('/templates/1/versions/10')

    await screen.findByRole('heading', { name: /version 1/i })
    await user.click(screen.getByRole('link', { name: 'Back to template' }))
    await screen.findByTestId('template-view')

    expect(fetchMock).toHaveBeenCalled()
    for (const [, init] of fetchMock.mock.calls as [string, RequestInit][]) {
      expect(init?.method ?? 'GET').toBe('GET')
    }
  })

  it('opens from the template detail version list without breaking activation', async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      const method = init?.method ?? 'GET'
      if (url === '/api/document-templates/1/') {
        return Promise.resolve(jsonResponse(200, templateDetail))
      }
      if (url === '/api/document-templates/1/versions/' && method === 'GET') {
        return Promise.resolve(jsonResponse(200, templateVersions))
      }
      if (url === '/api/document-templates/1/versions/10/') {
        return Promise.resolve(jsonResponse(200, version))
      }
      return Promise.resolve(jsonResponse(404, { detail: 'Not found.' }))
    })
    vi.stubGlobal('fetch', fetchMock)
    render(
      <MemoryRouter initialEntries={['/templates/1']}>
        <Routes>
          <Route path="/templates/:templateId" element={<TemplateDetailPage />} />
          <Route
            path="/templates/:templateId/versions/:versionId"
            element={<TemplateVersionDetailPage />}
          />
          <Route path="/templates" element={<div data-testid="list-view" />} />
        </Routes>
      </MemoryRouter>,
    )
    await screen.findByRole('heading', { name: /Standard Invoice/ })

    // The existing activation action is untouched.
    expect(screen.getByRole('button', { name: 'Activate' })).toBeInTheDocument()

    await user.click(screen.getAllByRole('link', { name: /view details/i })[0])

    expect(await screen.findByRole('heading', { name: /version 1/i })).toBeInTheDocument()
    expect(screen.getByText('v1_aaaa.docx')).toBeInTheDocument()
  })
})
