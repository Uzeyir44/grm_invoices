import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TemplateDetailPage } from './TemplateDetailPage'
import {
  activeTemplateVersion,
  fileDownloadResponse,
  jsonResponse,
  templateDetail,
  templateVersions,
} from '../../test/templateFixtures'
import type { TemplateVersion } from '../../types/documentTemplate'

function renderDetail() {
  return render(
    <MemoryRouter initialEntries={['/templates/1']}>
      <Routes>
        <Route path="/templates/:templateId" element={<TemplateDetailPage />} />
        <Route path="/templates" element={<div data-testid="list-view" />} />
      </Routes>
    </MemoryRouter>,
  )
}

function allVersionsActive(versionId: number): TemplateVersion[] {
  return templateVersions.map((version) => ({
    ...version,
    is_active: version.id === versionId,
  }))
}

describe('TemplateDetailPage', () => {
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
    expect(screen.getByTestId('template-loading')).toHaveTextContent('Loading…')
  })

  it('renders template metadata, the active version, and version history', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(200, templateDetail))
      .mockResolvedValueOnce(jsonResponse(200, templateVersions))
    renderDetail()

    expect(await screen.findByRole('heading', { name: /Standard Invoice/ })).toBeInTheDocument()
    expect(screen.getByText('invoice')).toBeInTheDocument()
    expect(screen.getByText('abc123.docx')).toBeInTheDocument()
    expect(screen.getByText('v1')).toBeInTheDocument()
    expect(screen.getByText('v2')).toBeInTheDocument()
    // Exactly one version is marked as current.
    expect(screen.getByText('Current version')).toBeInTheDocument()
    // The current file can be downloaded through the authenticated endpoint.
    expect(screen.getByRole('button', { name: /download file/i })).toBeInTheDocument()
  })

  it('handles an empty version history gracefully', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(200, templateDetail))
      .mockResolvedValueOnce(jsonResponse(200, []))
    renderDetail()

    expect(await screen.findByRole('heading', { name: /Standard Invoice/ })).toBeInTheDocument()
    expect(screen.getByText('No versions yet.')).toBeInTheDocument()
  })

  it('shows a safe not-found state for 404 (covers cross-tenant too)', async () => {
    fetchMock.mockResolvedValue(jsonResponse(404, { detail: 'Not found.' }))
    renderDetail()

    expect(await screen.findByText('Template not found.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /back to templates/i })).toBeInTheDocument()
  })

  it('shows a safe message for forbidden access', async () => {
    fetchMock.mockResolvedValue(jsonResponse(403, { detail: 'No permission.' }))
    renderDetail()

    expect(
      await screen.findByText(/do not have permission to view this template/i),
    ).toBeInTheDocument()
  })

  it('shows an error state and retries', async () => {
    fetchMock
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce(jsonResponse(200, templateVersions))
    renderDetail()

    expect(await screen.findByText("Couldn't load the template.")).toBeInTheDocument()

    fetchMock.mockResolvedValueOnce(jsonResponse(200, templateDetail))
    await user.click(screen.getByRole('button', { name: /retry/i }))
    expect(await screen.findByRole('heading', { name: /Standard Invoice/ })).toBeInTheDocument()
  })

  it('replaces the file through the authenticated upload endpoint and refreshes', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(200, templateDetail)) // detail
      .mockResolvedValueOnce(jsonResponse(200, templateVersions)) // versions
      .mockResolvedValueOnce(jsonResponse(201, { id: 1, file_name: 'tpl.docx' })) // upload
      .mockResolvedValueOnce(jsonResponse(200, templateDetail)) // refreshed detail
      .mockResolvedValueOnce(jsonResponse(200, templateVersions)) // refreshed versions
    renderDetail()
    await screen.findByRole('heading', { name: /Standard Invoice/ })

    const file = new File(['bytes'], 'contract.docx')
    await user.upload(screen.getByLabelText(/replace template file/i), file)
    await user.click(screen.getByRole('button', { name: /upload file/i }))

    expect(await screen.findByRole('status')).toHaveTextContent(/File uploaded successfully/i)
    const uploadCall = fetchMock.mock.calls[2] as [string, RequestInit]
    expect(uploadCall[0]).toBe('/api/document-templates/1/file/')
    expect(uploadCall[1].method).toBe('POST')
    expect(uploadCall[1].body).toBeInstanceOf(FormData)
    expect((uploadCall[1].body as FormData).get('file')).toBe(file)
  })

  it('blocks uploading a non-.docx file before sending it', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(200, templateDetail))
      .mockResolvedValueOnce(jsonResponse(200, templateVersions))
    renderDetail()
    await screen.findByRole('heading', { name: /Standard Invoice/ })

    // fireEvent.change bypasses user-event's accept-attribute filtering so a
    // non-.docx file can be forced onto the input to exercise client-side
    // validation (the input itself carries accept=".docx" for real browsers).
    const file = new File(['x'], 'notes.txt')
    fireEvent.change(screen.getByLabelText(/replace template file/i), {
      target: { files: [file] },
    })
    await user.click(screen.getByRole('button', { name: /upload file/i }))

    expect(screen.getByText('Only .docx template files are supported.')).toBeInTheDocument()
    const uploadCalls = fetchMock.mock.calls.filter(([url, init]) => {
      const initObject = init as RequestInit | undefined
      return String(url).includes('/file/') && (initObject?.method ?? 'GET') === 'POST'
    })
    expect(uploadCalls).toHaveLength(0)
  })

  it('displays backend validation errors for a failed upload', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(200, templateDetail))
      .mockResolvedValueOnce(jsonResponse(200, templateVersions))
      .mockResolvedValueOnce(
        jsonResponse(400, { file: ['The uploaded file is not a valid .docx (Word) file.'] }),
      )
    renderDetail()
    await screen.findByRole('heading', { name: /Standard Invoice/ })

    const file = new File(['invalid'], 'broken.docx')
    await user.upload(screen.getByLabelText(/replace template file/i), file)
    await user.click(screen.getByRole('button', { name: /upload file/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/not a valid .docx/i)
  })

  it('downloads the file through the authenticated endpoint with a real filename', async () => {
    const createSpy = vi.fn(() => 'blob:mock')
    const revokeSpy = vi.fn()
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    const originalCreate = URL.createObjectURL
    const originalRevoke = URL.revokeObjectURL
    URL.createObjectURL = createSpy
    URL.revokeObjectURL = revokeSpy
    try {
      fetchMock
        .mockResolvedValueOnce(jsonResponse(200, templateDetail))
        .mockResolvedValueOnce(jsonResponse(200, templateVersions))
        .mockResolvedValueOnce(fileDownloadResponse('template.docx'))
      renderDetail()
      await screen.findByRole('heading', { name: /Standard Invoice/ })

      await user.click(screen.getByRole('button', { name: /download file/i }))

      await waitFor(() => expect(createSpy).toHaveBeenCalledTimes(1))
      const downloadCall = fetchMock.mock.calls[2] as [string, RequestInit]
      expect(downloadCall[0]).toBe('/api/document-templates/1/file/')
      expect(downloadCall[1].method).toBe('GET')
      expect(clickSpy).toHaveBeenCalledTimes(1)
      expect(revokeSpy).toHaveBeenCalledTimes(1)
    } finally {
      URL.createObjectURL = originalCreate
      URL.revokeObjectURL = originalRevoke
      clickSpy.mockRestore()
    }
  })

  it('shows a safe error when the download fails', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(200, templateDetail))
      .mockResolvedValueOnce(jsonResponse(200, templateVersions))
      .mockResolvedValueOnce(jsonResponse(404, { detail: 'This template has no file uploaded yet.' }))
    renderDetail()
    await screen.findByRole('heading', { name: /Standard Invoice/ })

    await user.click(screen.getByRole('button', { name: /download file/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/no file uploaded yet/i)
  })

  it('creates a version from the current file and refreshes the history', async () => {
    const newVersion: TemplateVersion = { ...activeTemplateVersion, id: 12, version_number: 3 }
    fetchMock
      .mockResolvedValueOnce(jsonResponse(200, templateDetail))
      .mockResolvedValueOnce(jsonResponse(200, templateVersions))
      .mockResolvedValueOnce(jsonResponse(201, newVersion))
      .mockResolvedValueOnce(jsonResponse(200, [...templateVersions, newVersion]))
    renderDetail()
    await screen.findByRole('heading', { name: /Standard Invoice/ })

    await user.click(screen.getByRole('button', { name: /create version/i }))

    expect(await screen.findByRole('status')).toHaveTextContent(/new version was created/i)
    const createCall = fetchMock.mock.calls[2] as [string, RequestInit]
    expect(createCall[0]).toBe('/api/document-templates/1/versions/')
    expect(createCall[1].method).toBe('POST')
    expect(await screen.findByText('v3')).toBeInTheDocument()
  })

  it('shows a backend error when a version cannot be created', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(200, templateDetail))
      .mockResolvedValueOnce(jsonResponse(200, templateVersions))
      .mockResolvedValueOnce(
        jsonResponse(400, { detail: 'This template has no file to snapshot.' }),
      )
    renderDetail()
    await screen.findByRole('heading', { name: /Standard Invoice/ })

    await user.click(screen.getByRole('button', { name: /create version/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/no file to snapshot/i)
  })

  it('activates a version after confirmation and refreshes the version state', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(200, templateDetail))
      .mockResolvedValueOnce(jsonResponse(200, templateVersions))
      .mockResolvedValueOnce(jsonResponse(200, { ...templateVersions[0], is_active: true }))
      .mockResolvedValueOnce(jsonResponse(200, allVersionsActive(10)))
    renderDetail()
    await screen.findByRole('heading', { name: /Standard Invoice/ })

    await user.click(screen.getByRole('button', { name: 'Activate' }))
    expect(screen.getByText(/make this the active version/i)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Activate' }))

    await waitFor(() => {
      const call = fetchMock.mock.calls[2] as [string, RequestInit]
      expect(call[0]).toBe('/api/document-templates/1/versions/10/activate/')
      expect(call[1].method).toBe('POST')
    })
    // After the refresh the activated version is the single current version.
    await waitFor(() => {
      expect(screen.getByText('Current version')).toBeInTheDocument()
      expect(screen.getAllByText('Current version')).toHaveLength(1)
    })
  })

  it('disables the activation action while an activation is in flight', async () => {
    let resolveActivate: (value: Response) => void = () => {}
    fetchMock
      .mockResolvedValueOnce(jsonResponse(200, templateDetail))
      .mockResolvedValueOnce(jsonResponse(200, templateVersions))
      .mockReturnValueOnce(
        new Promise<Response>((resolve) => {
          resolveActivate = resolve
        }),
      )
      .mockResolvedValueOnce(jsonResponse(200, allVersionsActive(10)))
    renderDetail()
    await screen.findByRole('heading', { name: /Standard Invoice/ })

    await user.click(screen.getByRole('button', { name: 'Activate' }))
    await user.click(screen.getByRole('button', { name: 'Activate' }))

    const activating = screen.getByRole('button', { name: /activating/i })
    expect(activating).toBeDisabled()
    const activateCalls = fetchMock.mock.calls.filter(([url]) =>
      String(url).includes('/activate/'),
    )
    expect(activateCalls).toHaveLength(1)

    resolveActivate(jsonResponse(200, { ...templateVersions[0], is_active: true }))
    await waitFor(() => expect(screen.queryByRole('button', { name: /activating/i })).not.toBeInTheDocument())
  })

  it('shows a safe error when activation fails', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(200, templateDetail))
      .mockResolvedValueOnce(jsonResponse(200, templateVersions))
      .mockResolvedValueOnce(jsonResponse(400, { detail: 'Could not activate this version.' }))
    renderDetail()
    await screen.findByRole('heading', { name: /Standard Invoice/ })

    await user.click(screen.getByRole('button', { name: 'Activate' }))
    await user.click(screen.getByRole('button', { name: 'Activate' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/could not activate this version/i)
  })

  it('shows a safe error state when the version history fails alone', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(200, templateDetail))
      .mockRejectedValueOnce(new Error('boom'))
    renderDetail()

    // Metadata still renders; only the version section shows a retryable error.
    expect(await screen.findByRole('heading', { name: /Standard Invoice/ })).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent(/couldn't load the version history/i)
    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument()

    fetchMock.mockResolvedValue(jsonResponse(200, templateVersions))
    await user.click(screen.getByRole('button', { name: /retry/i }))
    expect(await screen.findByText('v1')).toBeInTheDocument()
  })

  it('deletes the template after explicit confirmation and returns to the list', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(200, templateDetail))
      .mockResolvedValueOnce(jsonResponse(200, templateVersions))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
    renderDetail()
    await screen.findByRole('heading', { name: /Standard Invoice/ })

    await user.click(screen.getByRole('button', { name: /delete template/i }))
    expect(screen.getByText(/are you sure/i)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /yes, delete/i }))
    const deleteCall = fetchMock.mock.calls[2] as [string, RequestInit]
    expect(deleteCall[0]).toBe('/api/document-templates/1/')
    expect(deleteCall[1].method).toBe('DELETE')

    expect(await screen.findByTestId('list-view')).toBeInTheDocument()
  })
})