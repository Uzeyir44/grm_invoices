import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  activateTemplateVersion,
  createTemplate,
  createTemplateVersion,
  deleteTemplate,
  deleteTemplateFile,
  downloadTemplateFile,
  getTemplate,
  getTemplateVersion,
  listTemplateVersions,
  listTemplates,
  updateTemplate,
  uploadTemplateFile,
} from './templates'
import {
  activeTemplateVersion,
  fileDownloadResponse,
  jsonResponse,
  templateDetail,
  templateSummaries,
  templateVersions,
} from '../test/templateFixtures'
import { setAccessToken } from '../utils/authStorage'

describe('templates API', () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    localStorage.clear()
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('lists templates with the correct endpoint and no params', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, templateSummaries))

    const result = await listTemplates()

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/document-templates/')
    expect(init.method).toBe('GET')
    expect(result).toEqual(templateSummaries)
  })

  it('builds the backend-supported document_type filter query parameter', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, templateSummaries))

    await listTemplates({ document_type: '1' })

    const [url] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/document-templates/?document_type=1')
  })

  it('omits the document_type parameter when empty', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, []))

    await listTemplates({ document_type: '' })

    const [url] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/document-templates/')
  })

  it('fetches a template from the detail endpoint', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, templateDetail))

    const result = await getTemplate(1)

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/document-templates/1/')
    expect(init.method).toBe('GET')
    expect(result).toEqual(templateDetail)
  })

  it('creates a template with the create serializer body', async () => {
    fetchMock.mockResolvedValue(jsonResponse(201, templateDetail))

    const result = await createTemplate({ name: 'Standard Invoice', document_type: 1 })

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/document-templates/')
    expect(init.method).toBe('POST')
    expect(JSON.parse(String(init.body))).toEqual({ name: 'Standard Invoice', document_type: 1 })
    expect(result).toEqual(templateDetail)
  })

  it('deletes (soft-deletes) a template via DELETE and resolves on 204', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }))

    await expect(deleteTemplate(1)).resolves.toBeUndefined()

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/document-templates/1/')
    expect(init.method).toBe('DELETE')
  })

  it('uploads a file as multipart FormData without a manual content type', async () => {
    fetchMock.mockResolvedValue(jsonResponse(201, { id: 1, file_name: 'tpl.docx' }))
    const file = new File(['bytes'], 'tpl.docx', { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' })

    const result = await uploadTemplateFile(1, file)

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/document-templates/1/file/')
    expect(init.method).toBe('POST')
    expect(init.body).toBeInstanceOf(FormData)
    expect(new Headers(init.headers).get('Content-Type')).toBeNull()
    const sentFile = (init.body as FormData).get('file')
    expect(sentFile).toBe(file)
    expect(result).toEqual({ id: 1, file_name: 'tpl.docx' })
  })

  it('removes only the file via DELETE and resolves on 204 with no body', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }))

    await expect(deleteTemplateFile(1)).resolves.toBeUndefined()

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/document-templates/1/file/')
    expect(init.method).toBe('DELETE')
    expect(init.body).toBeUndefined()
  })

  it('propagates the 404 when there is no file to remove', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(404, { detail: 'This template has no file uploaded yet.' }),
    )

    await expect(deleteTemplateFile(1)).rejects.toMatchObject({ status: 404 })
  })

  it('propagates permission errors from the file removal endpoint', async () => {
    fetchMock.mockResolvedValue(jsonResponse(403, { detail: 'No permission.' }))

    await expect(deleteTemplateFile(1)).rejects.toMatchObject({ status: 403 })
  })

  it('lists versions from the version list endpoint', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, templateVersions))

    const result = await listTemplateVersions(1)

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/document-templates/1/versions/')
    expect(init.method).toBe('GET')
    expect(result).toEqual(templateVersions)
  })

  it('fetches a single version from the version detail endpoint', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, activeTemplateVersion))

    const result = await getTemplateVersion(1, 11)

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/document-templates/1/versions/11/')
    expect(init.method).toBe('GET')
    expect(init.body).toBeUndefined()
    expect(result).toEqual(activeTemplateVersion)
  })

  it('propagates backend errors from the version detail endpoint', async () => {
    fetchMock.mockResolvedValue(jsonResponse(404, { detail: 'Not found.' }))

    // A missing, cross-tenant, or template-mismatched version is a 404.
    await expect(getTemplateVersion(1, 999)).rejects.toMatchObject({ status: 404 })
  })

  it('creates a version snapshotting the current file', async () => {
    fetchMock.mockResolvedValue(jsonResponse(201, activeTemplateVersion))

    const result = await createTemplateVersion(1)

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/document-templates/1/versions/')
    expect(init.method).toBe('POST')
    expect(init.body).toBeUndefined()
    expect(result).toEqual(activeTemplateVersion)
  })

  it('activates a version through the dedicated activate endpoint', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, activeTemplateVersion))

    const result = await activateTemplateVersion(1, 10)

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/document-templates/1/versions/10/activate/')
    expect(init.method).toBe('POST')
    expect(result).toEqual(activeTemplateVersion)
  })

  it('updates template metadata through PATCH and parses the response', async () => {
    const updated = { ...templateDetail, name: 'Renamed Template', is_active: false }
    fetchMock.mockResolvedValue(jsonResponse(200, updated))

    const result = await updateTemplate(1, { name: 'Renamed Template', is_active: false })

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/document-templates/1/')
    expect(init.method).toBe('PATCH')
    expect(JSON.parse(String(init.body))).toEqual({ name: 'Renamed Template', is_active: false })
    expect(result).toEqual(updated)
  })

  it('supports partial PATCH semantics for a single field', async () => {
    const updated = { ...templateDetail, document_type: 2, document_type_code: 'consulting_contract' }
    fetchMock.mockResolvedValue(jsonResponse(200, updated))

    const result = await updateTemplate(1, { document_type: 2 })

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/document-templates/1/')
    expect(init.method).toBe('PATCH')
    // Only the supplied field is sent; no tenant/company identifiers leak in.
    expect(JSON.parse(String(init.body))).toEqual({ document_type: 2 })
    expect(result.document_type_code).toBe('consulting_contract')
  })

  it('surfaces backend validation errors from the PATCH endpoint', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(400, { name: ['Ensure this field has no more than 200 characters.'] }),
    )

    const error = await updateTemplate(1, { name: 'x'.repeat(201) }).catch((e: unknown) => e)
    expect(error).toMatchObject({ status: 400 })
    expect((error as { fieldErrors: Record<string, string[]> }).fieldErrors.name).toEqual([
      'Ensure this field has no more than 200 characters.',
    ])
  })

  it('converts a 404 PATCH into an ApiError', async () => {
    fetchMock.mockResolvedValue(jsonResponse(404, { detail: 'Not found.' }))

    await expect(updateTemplate(999, { name: 'Ghost' })).rejects.toMatchObject({ status: 404 })
  })

  it('downloads the authenticated file as a blob with the response filename', async () => {
    fetchMock.mockResolvedValue(fileDownloadResponse('template.docx'))
    setAccessToken('token-1')

    const result = await downloadTemplateFile(1)

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/document-templates/1/file/')
    expect(init.method).toBe('GET')
    expect(new Headers(init.headers).get('Authorization')).toBe('Bearer token-1')
    expect(result.filename).toBe('template.docx')
    expect(result.blob).toBeInstanceOf(Blob)
    expect(result.blob.size).toBeGreaterThan(0)
  })

  it('falls back to a default filename when Content-Disposition is absent', async () => {
    fetchMock.mockResolvedValue(new Response(new Blob(['x']), { status: 200 }))

    const result = await downloadTemplateFile(2)

    expect(result.filename).toBe('template.docx')
  })

  it('converts a 404 download into an ApiError', async () => {
    fetchMock.mockResolvedValue(jsonResponse(404, { detail: 'This template has no file uploaded yet.' }))

    await expect(downloadTemplateFile(3)).rejects.toMatchObject({ status: 404 })
  })
})