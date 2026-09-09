import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useNavigate, useParams } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TemplateEditPage } from './TemplateEditPage'
import {
  documentTypes,
  jsonResponse,
  templateDetail,
} from '../../test/templateFixtures'

function DetailMarker() {
  const { templateId } = useParams()
  return <div data-testid="detail-view">{templateId}</div>
}

function NavButton({ to, label }: { to: string; label: string }) {
  const navigate = useNavigate()
  return (
    <button type="button" onClick={() => navigate(to)}>
      {label}
    </button>
  )
}

function renderEditAt(path: string, withNav = false) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      {withNav ? <NavButton to="/templates/2/edit" label="Go to second" /> : null}
      <Routes>
        <Route path="/templates/:templateId/edit" element={<TemplateEditPage />} />
        <Route path="/templates/:templateId" element={<DetailMarker />} />
        <Route path="/templates" element={<div data-testid="list-view" />} />
      </Routes>
    </MemoryRouter>,
  )
}

const secondTemplate = {
  ...templateDetail,
  id: 2,
  name: 'Second Template',
  document_type: 2,
  document_type_code: 'consulting_contract',
}

/** Route fetch calls: template detail, document-type catalog, and PATCH. */
function stubBackend(handlers: {
  onGetTemplate?: (url: string) => Response | Promise<Response>
  onPatch?: (url: string, init: RequestInit) => Response | Promise<Response>
} = {}) {
  const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const method = init?.method ?? 'GET'
    if (url.includes('/reference-data/document-types/')) {
      return Promise.resolve(jsonResponse(200, documentTypes))
    }
    if (method === 'PATCH' && url.includes('/document-templates/')) {
      if (handlers.onPatch) return Promise.resolve(handlers.onPatch(url, init as RequestInit))
      const body = JSON.parse(String((init as RequestInit).body))
      return Promise.resolve(jsonResponse(200, { ...templateDetail, ...body }))
    }
    if (method === 'GET' && url.includes('/document-templates/2/')) {
      if (handlers.onGetTemplate) return Promise.resolve(handlers.onGetTemplate(url))
      return Promise.resolve(jsonResponse(200, secondTemplate))
    }
    if (method === 'GET' && url.includes('/document-templates/')) {
      if (handlers.onGetTemplate) return Promise.resolve(handlers.onGetTemplate(url))
      return Promise.resolve(jsonResponse(200, templateDetail))
    }
    return Promise.resolve(jsonResponse(404, { detail: 'Not found.' }))
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

describe('TemplateEditPage', () => {
  const user = userEvent.setup()

  beforeEach(() => {
    localStorage.clear()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('shows a loading state while fetching the current metadata', () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => {})))
    renderEditAt('/templates/1/edit')
    expect(screen.getByTestId('template-edit-loading')).toHaveTextContent('Loading…')
  })

  it('opens with the existing metadata and no company field', async () => {
    stubBackend()
    renderEditAt('/templates/1/edit')

    expect(await screen.findByLabelText(/template name/i)).toHaveValue('Standard Invoice')
    expect(screen.getByLabelText(/document type/i)).toHaveValue('1')
    expect(screen.getByLabelText(/active/i)).toBeChecked()
    // The tenant is backend-derived; no company input may exist.
    expect(screen.queryByLabelText(/company/i)).not.toBeInTheDocument()
  })

  it('distinguishes editable fields from read-only information', async () => {
    stubBackend()
    renderEditAt('/templates/1/edit')
    await screen.findByLabelText(/template name/i)

    expect(screen.getByText('Read-only information')).toBeInTheDocument()
    expect(screen.getByText('File uploads')).toBeInTheDocument()
  })

  it('saves through PATCH and returns to the detail page', async () => {
    const fetchMock = stubBackend()
    renderEditAt('/templates/1/edit')

    const nameInput = await screen.findByLabelText(/template name/i)
    await user.clear(nameInput)
    await user.type(nameInput, 'Renamed Template')
    await user.selectOptions(screen.getByLabelText(/document type/i), '2')
    await user.click(screen.getByLabelText(/active/i))
    await user.click(screen.getByRole('button', { name: /save changes/i }))

    const patchCall = await waitFor(() => {
      const call = fetchMock.mock.calls.find(
        ([url, init]) =>
          String(url).endsWith('/document-templates/1/') &&
          (init as RequestInit)?.method === 'PATCH',
      )
      expect(call).toBeDefined()
      return call as [string, RequestInit]
    })
    expect(JSON.parse(String(patchCall[1].body))).toEqual({
      name: 'Renamed Template',
      document_type: 2,
      is_active: false,
    })

    expect(await screen.findByTestId('detail-view')).toHaveTextContent('1')
  })

  it('cancel returns to the detail view without saving', async () => {
    const fetchMock = stubBackend()
    renderEditAt('/templates/1/edit')
    await screen.findByLabelText(/template name/i)

    await user.click(screen.getByRole('link', { name: /cancel/i }))

    expect(await screen.findByTestId('detail-view')).toHaveTextContent('1')
    const patchCalls = fetchMock.mock.calls.filter(
      ([, init]) => (init as RequestInit)?.method === 'PATCH',
    )
    expect(patchCalls).toHaveLength(0)
  })

  it('shows a submitting state and prevents duplicate submissions', async () => {
    let resolvePatch: (value: Response) => void = () => {}
    const fetchMock = stubBackend({
      onPatch: () =>
        new Promise<Response>((resolve) => {
          resolvePatch = resolve
        }),
    })
    renderEditAt('/templates/1/edit')
    await screen.findByLabelText(/template name/i)

    await user.click(screen.getByRole('button', { name: /save changes/i }))

    const saving = await screen.findByRole('button', { name: /saving/i })
    expect(saving).toBeDisabled()
    await user.click(saving)
    const patchCalls = fetchMock.mock.calls.filter(
      ([, init]) => (init as RequestInit)?.method === 'PATCH',
    )
    expect(patchCalls).toHaveLength(1)

    resolvePatch(jsonResponse(200, templateDetail))
    expect(await screen.findByTestId('detail-view')).toHaveTextContent('1')
  })

  it('blocks submission without required fields and does not PATCH', async () => {
    const fetchMock = stubBackend()
    renderEditAt('/templates/1/edit')
    const nameInput = await screen.findByLabelText(/template name/i)

    await user.clear(nameInput)
    await user.selectOptions(screen.getByLabelText(/document type/i), '')
    await user.click(screen.getByRole('button', { name: /save changes/i }))

    expect(screen.getByText('Template name is required.')).toBeInTheDocument()
    expect(screen.getByText('A document type is required.')).toBeInTheDocument()
    const patchCalls = fetchMock.mock.calls.filter(
      ([, init]) => (init as RequestInit)?.method === 'PATCH',
    )
    expect(patchCalls).toHaveLength(0)
  })

  it('renders backend field errors and preserves entered values', async () => {
    stubBackend({
      onPatch: () =>
        jsonResponse(400, { name: ['A template with this name already exists.'] }),
    })
    renderEditAt('/templates/1/edit')
    const nameInput = await screen.findByLabelText(/template name/i)

    await user.clear(nameInput)
    await user.type(nameInput, 'Duplicate')
    await user.click(screen.getByRole('button', { name: /save changes/i }))

    expect(await screen.findByText(/name already exists/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/template name/i)).toHaveValue('Duplicate')
  })

  it('renders generic API errors without exposing internals', async () => {
    stubBackend({
      onPatch: () => jsonResponse(500, { detail: 'Database exploded: relation xyz' }),
    })
    renderEditAt('/templates/1/edit')
    await screen.findByLabelText(/template name/i)

    await user.click(screen.getByRole('button', { name: /save changes/i }))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Database exploded')
    expect(alert.textContent).not.toMatch(/traceback|line \d+|File "/i)
  })

  it('maps a 403 submit failure to the safe permission message', async () => {
    stubBackend({ onPatch: () => jsonResponse(403, { detail: 'No permission.' }) })
    renderEditAt('/templates/1/edit')
    await screen.findByLabelText(/template name/i)

    await user.click(screen.getByRole('button', { name: /save changes/i }))

    expect(
      await screen.findByText(/do not have permission to edit this template/i),
    ).toBeInTheDocument()
    // The entered values are preserved for a retry after gaining permission.
    expect(screen.getByLabelText(/template name/i)).toHaveValue('Standard Invoice')
  })

  it('maps a 404 submit failure to the safe not-found message', async () => {
    stubBackend({ onPatch: () => jsonResponse(404, { detail: 'Not found.' }) })
    renderEditAt('/templates/1/edit')
    await screen.findByLabelText(/template name/i)

    await user.click(screen.getByRole('button', { name: /save changes/i }))

    expect(await screen.findByText(/may have been deleted/i)).toBeInTheDocument()
  })

  it('maps a 429 submit failure to the friendly retry message', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input)
        if (url.includes('/reference-data/document-types/')) {
          return Promise.resolve(jsonResponse(200, documentTypes))
        }
        if ((init?.method ?? 'GET') === 'PATCH') {
          return Promise.resolve(
            new Response(JSON.stringify({ detail: 'Request was throttled.' }), {
              status: 429,
              headers: { 'Content-Type': 'application/json', 'Retry-After': '7' },
            }),
          )
        }
        return Promise.resolve(jsonResponse(200, templateDetail))
      }),
    )
    renderEditAt('/templates/1/edit')
    await screen.findByLabelText(/template name/i)

    await user.click(screen.getByRole('button', { name: /save changes/i }))

    expect(await screen.findByText(/wait 7 seconds/i)).toBeInTheDocument()
  })

  it('shows a safe not-found state when the template does not exist', async () => {
    stubBackend({ onGetTemplate: () => jsonResponse(404, { detail: 'Not found.' }) })
    renderEditAt('/templates/999/edit')

    expect(await screen.findByText('Template not found.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /back to templates/i })).toBeInTheDocument()
  })

  it('shows a safe message when editing is forbidden', async () => {
    stubBackend({ onGetTemplate: () => jsonResponse(403, { detail: 'No permission.' }) })
    renderEditAt('/templates/1/edit')

    expect(
      await screen.findByText(/do not have permission to edit this template/i),
    ).toBeInTheDocument()
  })

  it('shows an error state with retry when loading fails', async () => {
    const fetchMock = vi.fn()
    fetchMock.mockRejectedValueOnce(new Error('boom'))
    fetchMock.mockImplementation((input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/reference-data/document-types/')) {
        return Promise.resolve(jsonResponse(200, documentTypes))
      }
      return Promise.resolve(jsonResponse(200, templateDetail))
    })
    vi.stubGlobal('fetch', fetchMock)
    renderEditAt('/templates/1/edit')

    expect(await screen.findByText("Couldn't load the template.")).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /retry/i }))
    expect(await screen.findByLabelText(/template name/i)).toBeInTheDocument()
  })

  it('never lets a stale response overwrite newer template state', async () => {
    let resolveFirst: (value: Response) => void = () => {}
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      const method = init?.method ?? 'GET'
      if (url.includes('/reference-data/document-types/')) {
        return Promise.resolve(jsonResponse(200, documentTypes))
      }
      if (method === 'GET' && /\/document-templates\/1\/$/.test(url)) {
        return new Promise<Response>((resolve) => {
          resolveFirst = resolve
        })
      }
      if (method === 'GET' && /\/document-templates\/2\/$/.test(url)) {
        return Promise.resolve(jsonResponse(200, secondTemplate))
      }
      return Promise.resolve(jsonResponse(404, { detail: 'Not found.' }))
    })
    vi.stubGlobal('fetch', fetchMock)
    renderEditAt('/templates/1/edit', true)

    // Navigate to the second template while the first request is in flight.
    await user.click(screen.getByRole('button', { name: /go to second/i }))
    expect(await screen.findByDisplayValue('Second Template')).toBeInTheDocument()

    // The stale first-template response arrives late and must be ignored.
    resolveFirst(jsonResponse(200, templateDetail))
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    expect(screen.getByLabelText(/template name/i)).toHaveValue('Second Template')
  })

  it('ignores a late submit outcome after moving to another template', async () => {
    let resolvePatch: (value: Response) => void = () => {}
    stubBackend({
      onPatch: () =>
        new Promise<Response>((resolve) => {
          resolvePatch = resolve
        }),
    })
    renderEditAt('/templates/1/edit', true)
    await screen.findByLabelText(/template name/i)

    // Submit for template 1, then move to template 2 while it is in flight.
    await user.click(screen.getByRole('button', { name: /save changes/i }))
    await user.click(screen.getByRole('button', { name: /go to second/i }))
    expect(await screen.findByDisplayValue('Second Template')).toBeInTheDocument()

    // The late success must not navigate back to template 1's detail page
    // nor disturb template 2's form.
    resolvePatch(jsonResponse(200, { ...templateDetail, name: 'Renamed Template' }))
    // Let the guarded continuation run: a macrotask flush guarantees the
    // late PATCH outcome was processed before asserting.
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(screen.queryByTestId('detail-view')).not.toBeInTheDocument()
    expect(screen.getByLabelText(/template name/i)).toHaveValue('Second Template')
    expect(screen.getByRole('button', { name: /save changes/i })).toBeEnabled()
  })
})
