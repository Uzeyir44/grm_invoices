import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'

import {
  activateTemplateVersion,
  createTemplateVersion,
  deleteTemplate,
  deleteTemplateFile,
  downloadTemplateFile,
  getTemplate,
  listTemplateVersions,
  uploadTemplateFile,
} from '../../api/templates'
import { Button } from '../../components/ui/Button'
import { buttonClasses } from '../../components/ui/buttonClasses'
import { PageContainer } from '../../components/ui/PageContainer'
import { ApiError, HTTP_STATUS } from '../../types/api'
import type { DocumentTemplate, TemplateVersion } from '../../types/documentTemplate'

type State =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'forbidden' }
  | { status: 'notfound' }
  | { status: 'ready'; data: DocumentTemplate }

function fileBaseName(fileName: string | null): string | null {
  if (!fileName) return null
  const normalized = fileName.replace(/\\/g, '/')
  return normalized.split('/').pop() || null
}

function formatDate(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return date.toISOString().slice(0, 10)
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof ApiError ? error.message || fallback : fallback
}

function uploadErrorFor(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === HTTP_STATUS.FORBIDDEN) {
      return 'You do not have permission to update this template.'
    }
    if (error.status === HTTP_STATUS.TOO_MANY_REQUESTS) {
      return 'Too many attempts. Please wait a moment and try again.'
    }
    return error.message || 'Could not upload the file.'
  }
  return 'Could not upload the file.'
}

function removeFileErrorFor(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === HTTP_STATUS.FORBIDDEN) {
      return 'You do not have permission to update this template.'
    }
    if (error.status === HTTP_STATUS.NOT_FOUND) {
      return error.message || 'This template has no file to remove.'
    }
    if (error.status === HTTP_STATUS.TOO_MANY_REQUESTS) {
      return error.retryAfterSeconds !== null
        ? `Too many attempts. Please wait ${error.retryAfterSeconds} seconds and try again.`
        : 'Too many attempts. Please wait a moment and try again.'
    }
    return error.message || 'Could not remove the file.'
  }
  return 'Could not remove the file.'
}

/**
 * Template detail (`GET /api/document-templates/:id/`). The backend returns
 * 404 for both nonexistent and cross-tenant templates, so both render the same
 * safe "not found" state. File / version operations stream only through the
 * authenticated backend endpoints — never `/media/...` URLs. A failed optional
 * section (e.g. the version history) never takes down the whole page.
 * Metadata editing lives on `/templates/:templateId/edit`; after a successful
 * edit the router carries `location.state.templateUpdated` so this page can
 * show a confirmation notice. Each version-history row links to the read-only
 * version detail page (`/templates/:templateId/versions/:versionId`).
 * The current file can be removed through `DELETE .../file/` after an
 * explicit inline confirmation; the detail is then refetched from the backend
 * and the upload form stays available for a replacement.
 * Detail and version fetches are sequence-guarded
 * so a stale in-flight response can never overwrite newer template state.
 */
export function TemplateDetailPage() {
  const { templateId } = useParams()
  const id = Number(templateId)
  const navigate = useNavigate()
  const location = useLocation()
  const updatedNotice =
    (location.state as { templateUpdated?: boolean } | null)?.templateUpdated === true

  const [state, setState] = useState<State>({ status: 'loading' })

  const [versions, setVersions] = useState<TemplateVersion[] | null>(null)
  const [versionsError, setVersionsError] = useState(false)
  const [versionsReloadKey, setVersionsReloadKey] = useState(0)

  const [downloading, setDownloading] = useState(false)
  const [downloadError, setDownloadError] = useState<string>()

  const [confirmRemoveFile, setConfirmRemoveFile] = useState(false)
  const [removingFile, setRemovingFile] = useState(false)
  const [removeFileError, setRemoveFileError] = useState<string>()
  const [removeFileSuccess, setRemoveFileSuccess] = useState(false)

  const [uploadFile, setUploadFile] = useState<File | null>(null)
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string>()
  const [uploadSuccess, setUploadSuccess] = useState(false)

  const [creatingVersion, setCreatingVersion] = useState(false)
  const [versionError, setVersionError] = useState<string>()
  const [versionSuccess, setVersionSuccess] = useState(false)

  const [confirmActivateId, setConfirmActivateId] = useState<number | null>(null)
  const [activatingId, setActivatingId] = useState<number | null>(null)
  const [activationError, setActivationError] = useState<string>()

  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string>()

  // Monotonic request ids: only the latest detail / versions response for the
  // current template may update state.
  const templateRequestRef = useRef(0)
  const versionsRequestRef = useRef(0)
  // Latest route id, so late async continuations can tell whether their
  // template is still current (e.g. a file-removal DELETE or refresh
  // finishing after navigation to another template). Synced in an effect
  // declared before the loading effects below.
  const idRef = useRef(id)

  // The route moved to a different template: drop the previous template's
  // state immediately so stale metadata/versions are never shown for the new
  // one. (Render-phase adjustment for the new `id`; the effects below refetch.
  // The sequence guards above additionally discard late responses.)
  const [idKey, setIdKey] = useState(id)
  if (idKey !== id) {
    setIdKey(id)
    setState({ status: 'loading' })
    setVersions(null)
    setVersionsError(false)
    setConfirmRemoveFile(false)
    setRemoveFileError(undefined)
    setRemoveFileSuccess(false)
  }

  const loadTemplate = useCallback(() => {
    // Sequence-guarded: a stale in-flight response must never overwrite newer
    // template state when navigating rapidly between detail routes (the same
    // race previously fixed in the Clients domain).
    const requestId = ++templateRequestRef.current
    const requestTemplateId = id
    void getTemplate(requestTemplateId)
      .then((data) => {
        if (templateRequestRef.current !== requestId) return
        if (idRef.current !== requestTemplateId) return
        setState({ status: 'ready', data })
      })
      .catch((error: unknown) => {
        if (templateRequestRef.current !== requestId) return
        if (idRef.current !== requestTemplateId) return
        if (error instanceof ApiError && error.status === HTTP_STATUS.NOT_FOUND) {
          setState({ status: 'notfound' })
        } else if (error instanceof ApiError && error.status === HTTP_STATUS.FORBIDDEN) {
          setState({ status: 'forbidden' })
        } else {
          setState({ status: 'error' })
        }
      })
  }, [id])

  const loadVersions = useCallback(() => {
    const requestId = ++versionsRequestRef.current
    const requestTemplateId = id
    void listTemplateVersions(requestTemplateId)
      .then((data) => {
        if (versionsRequestRef.current !== requestId) return
        if (idRef.current !== requestTemplateId) return
        setVersions(data)
      })
      .catch(() => {
        if (versionsRequestRef.current !== requestId) return
        if (idRef.current !== requestTemplateId) return
        setVersionsError(true)
      })
  }, [id])

  useEffect(() => {
    idRef.current = id
  })

  useEffect(() => {
    if (Number.isNaN(id)) return
    void loadTemplate()
  }, [id, loadTemplate])

  useEffect(() => {
    if (Number.isNaN(id)) return
    void loadVersions()
  }, [id, loadVersions, versionsReloadKey])

  function retryTemplate() {
    setState({ status: 'loading' })
    void loadTemplate()
  }

  function reloadVersions() {
    setVersionsError(false)
    setVersionsReloadKey((key) => key + 1)
  }

  function handleDownload() {
    setDownloading(true)
    setDownloadError(undefined)
    void downloadTemplateFile(id)
      .then(({ blob, filename }) => {
        const url = URL.createObjectURL(blob)
        const anchor = document.createElement('a')
        anchor.href = url
        anchor.download = filename
        document.body.appendChild(anchor)
        anchor.click()
        document.body.removeChild(anchor)
        URL.revokeObjectURL(url)
      })
      .catch((error: unknown) => {
        setDownloadError(errorMessage(error, 'Could not download the file.'))
      })
      .finally(() => setDownloading(false))
  }

  function handleUpload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (uploading || !uploadFile) return

    const uploadedName = uploadFile.name.toLowerCase()
    if (!uploadedName.endsWith('.docx')) {
      setUploadError('Only .docx template files are supported.')
      return
    }

    setUploading(true)
    setUploadError(undefined)
    setUploadSuccess(false)
    void uploadTemplateFile(id, uploadFile)
      .then(() => {
        setUploadSuccess(true)
        setUploadFile(null)
        event.currentTarget.reset()
        loadTemplate()
        reloadVersions()
      })
      .catch((error: unknown) => {
        setUploadError(uploadErrorFor(error))
      })
      .finally(() => setUploading(false))
  }

function versionErrorMessage(error: unknown): string {
  if (error instanceof ApiError && error.status === HTTP_STATUS.TOO_MANY_REQUESTS) {
    return 'Too many attempts. Please wait a moment and try again.'
  }
  const message = errorMessage(error, 'Could not create a version.')
  const invalid = error instanceof ApiError ? error.payload?.invalid_placeholders : undefined
  if (Array.isArray(invalid) && invalid.length > 0) {
    return `${message} Invalid placeholders: ${invalid.join(', ')}`
  }
  return message
}

  function handleCreateVersion() {
    if (creatingVersion) return
    setCreatingVersion(true)
    setVersionError(undefined)
    setVersionSuccess(false)
    void createTemplateVersion(id)
      .then(() => {
        setVersionSuccess(true)
        reloadVersions()
      })
      .catch((error: unknown) => setVersionError(versionErrorMessage(error)))
      .finally(() => setCreatingVersion(false))
  }

  function handleActivate(versionId: number) {
    if (activatingId !== null) return
    setActivatingId(versionId)
    setActivationError(undefined)
    void activateTemplateVersion(id, versionId)
      .then(() => {
        setConfirmActivateId(null)
        reloadVersions()
      })
      .catch((error: unknown) => {
        setActivationError(errorMessage(error, 'Could not activate the version.'))
      })
      .finally(() => setActivatingId(null))
  }

  function handleDelete() {
    setDeleting(true)
    setDeleteError(undefined)
    void deleteTemplate(id)
      .then(() => navigate('/templates'))
      .catch((error: unknown) => {
        setDeleteError(errorMessage(error, 'Could not delete the template.'))
      })
      .finally(() => setDeleting(false))
  }

  function handleRemoveFile() {
    if (removingFile) return
    // The template may change while the DELETE is in flight; only the
    // still-current template may apply the outcome or refresh.
    const requestTemplateId = id
    setRemovingFile(true)
    setRemoveFileError(undefined)
    setRemoveFileSuccess(false)
    void deleteTemplateFile(requestTemplateId)
      .then(() => {
        if (idRef.current !== requestTemplateId) return
        setConfirmRemoveFile(false)
        setRemoveFileSuccess(true)
        loadTemplate()
      })
      .catch((error: unknown) => {
        if (idRef.current !== requestTemplateId) return
        setRemoveFileError(removeFileErrorFor(error))
      })
      .finally(() => setRemovingFile(false))
  }

  if (Number.isNaN(id)) {
    return (
      <PageContainer title="Template">
        <div className="rounded-md bg-slate-50 px-4 py-3 text-sm text-slate-600">
          Template not found.
        </div>
        <Link to="/templates" className="text-sm text-slate-600 underline hover:text-slate-900">
          Back to templates
        </Link>
      </PageContainer>
    )
  }

  if (state.status === 'loading') {
    return (
      <PageContainer title="Template">
        <p data-testid="template-loading" className="animate-pulse text-sm text-slate-400">
          Loading…
        </p>
      </PageContainer>
    )
  }

  if (state.status === 'notfound') {
    return (
      <PageContainer title="Template">
        <div className="rounded-md bg-slate-50 px-4 py-3 text-sm text-slate-600">
          Template not found.
        </div>
        <Link to="/templates" className="text-sm text-slate-600 underline hover:text-slate-900">
          Back to templates
        </Link>
      </PageContainer>
    )
  }

  if (state.status === 'forbidden') {
    return (
      <PageContainer title="Template">
        <div role="alert" className="rounded-md bg-red-50 px-4 py-3 text-sm text-red-700">
          You do not have permission to view this template.
        </div>
        <Link to="/templates" className="text-sm text-slate-600 underline hover:text-slate-900">
          Back to templates
        </Link>
      </PageContainer>
    )
  }

  if (state.status === 'error') {
    return (
      <PageContainer title="Template">
        <div role="alert" className="rounded-md bg-red-50 px-4 py-3 text-sm text-red-700">
          Couldn't load the template.
        </div>
        <Button variant="secondary" onClick={retryTemplate}>
          Retry
        </Button>
      </PageContainer>
    )
  }

  const template = state.data
  const fileName = fileBaseName(template.file_name)

  return (
    <PageContainer title={template.name || `Template #${template.id}`}>
      <div className="space-y-4">
        <Link to="/templates" className="text-sm text-slate-600 underline hover:text-slate-900">
          Back to templates
        </Link>

        {updatedNotice ? (
          <p role="status" className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
            Template updated successfully.
          </p>
        ) : null}

        <div className="flex flex-wrap items-center gap-3">
          <Link to={`/templates/${template.id}/edit`} className={buttonClasses('secondary')}>
            Edit metadata
          </Link>
          {template.file ? (
            <>
              <Button
                variant="secondary"
                onClick={handleDownload}
                loading={downloading}
                loadingLabel="Downloading…"
              >
                Download file
              </Button>
              {!confirmRemoveFile ? (
                <Button variant="danger" onClick={() => setConfirmRemoveFile(true)}>
                  Remove file
                </Button>
              ) : (
                <span className="flex flex-wrap items-center gap-3 text-sm text-slate-700">
                  Remove the current file? The template itself stays.
                  <Button
                    variant="danger"
                    loading={removingFile}
                    loadingLabel="Removing…"
                    onClick={handleRemoveFile}
                  >
                    Yes, remove file
                  </Button>
                  <Button
                    variant="secondary"
                    onClick={() => {
                      setConfirmRemoveFile(false)
                      setRemoveFileError(undefined)
                    }}
                  >
                    Cancel
                  </Button>
                </span>
              )}
            </>
          ) : (
            <span className="text-sm text-slate-500">No file uploaded yet.</span>
          )}
          {!confirmDelete ? (
            <Button variant="danger" onClick={() => setConfirmDelete(true)}>
              Delete template
            </Button>
          ) : (
            <span className="flex flex-wrap items-center gap-3 text-sm text-slate-700">
              Are you sure? This deactivates the template and removes it from the list.
              <Button variant="danger" loading={deleting} loadingLabel="Deleting…" onClick={handleDelete}>
                Yes, delete
              </Button>
              <Button
                variant="secondary"
                onClick={() => {
                  setConfirmDelete(false)
                  setDeleteError(undefined)
                }}
              >
                Cancel
              </Button>
            </span>
          )}
        </div>

        {downloadError ? (
          <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
            {downloadError}
          </p>
        ) : null}
        {removeFileError ? (
          <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
            {removeFileError}
          </p>
        ) : null}
        {removeFileSuccess ? (
          <p role="status" className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
            File removed successfully. You can upload a replacement below.
          </p>
        ) : null}
        {deleteError ? (
          <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
            {deleteError}
          </p>
        ) : null}

        <dl className="grid max-w-2xl gap-x-8 gap-y-2 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-slate-500">Document type</dt>
            <dd className="text-slate-900">{template.document_type_code || template.document_type}</dd>
          </div>
          <div>
            <dt className="text-slate-500">Template status</dt>
            <dd className="text-slate-900">{template.is_active ? 'Active' : 'Inactive'}</dd>
          </div>
          <div>
            <dt className="text-slate-500">Current file</dt>
            <dd className="break-words text-slate-900">{fileName ?? 'No file uploaded'}</dd>
          </div>
          <div>
            <dt className="text-slate-500">Created</dt>
            <dd className="text-slate-900">{formatDate(template.created_at)}</dd>
          </div>
          <div>
            <dt className="text-slate-500">Updated</dt>
            <dd className="text-slate-900">{formatDate(template.updated_at)}</dd>
          </div>
        </dl>

        <section aria-label="Template file and versions" className="space-y-4">
          <h2 className="text-sm font-semibold text-slate-700">File and versions</h2>

          <form
            onSubmit={handleUpload}
            className="space-y-3 rounded-lg border border-slate-200 bg-white p-4"
            data-testid="upload-form"
          >
            <div>
              <label htmlFor="template-file" className="block text-sm font-medium text-slate-700">
                Replace template file
                <span className="ml-1 text-xs font-normal text-slate-500">
                  (only .docx files are supported)
                </span>
              </label>
              <input
                id="template-file"
                name="file"
                type="file"
                accept=".docx"
                onChange={(event) => {
                  setUploadFile(event.target.files?.[0] ?? null)
                  setUploadError(undefined)
                }}
                className="mt-1 block w-full max-w-md text-sm text-slate-700 file:mr-3 file:rounded-md file:border-0 file:bg-slate-900 file:px-3 file:py-1.5 file:text-sm file:text-white"
                aria-describedby={uploadError ? 'template-file-error' : undefined}
                aria-invalid={Boolean(uploadError)}
              />
              {uploadError ? (
                <p id="template-file-error" role="alert" className="mt-1 text-sm text-red-600">
                  {uploadError}
                </p>
              ) : null}
            </div>
            {uploadSuccess ? (
              <p role="status" className="text-sm text-emerald-700">
                File uploaded successfully. The current file was replaced.
              </p>
            ) : null}
            <div className="flex items-center gap-3">
              <Button
                type="submit"
                loading={uploading}
                loadingLabel="Uploading…"
                disabled={uploadFile === null}
              >
                Upload file
              </Button>
            </div>
          </form>

          <div className="rounded-lg border border-slate-200 bg-white p-4">
            <div className="flex flex-wrap items-center gap-3">
              <Button
                variant="secondary"
                onClick={handleCreateVersion}
                loading={creatingVersion}
                loadingLabel="Creating version…"
              >
                Create version
              </Button>
              <p className="text-sm text-slate-500">
                Creates an immutable snapshot of the current file as a new version. The new
                version becomes the template's active version.
              </p>
            </div>
            {versionSuccess ? (
              <p role="status" className="mt-2 text-sm text-emerald-700">
                A new version was created and is now active.
              </p>
            ) : null}
            {versionError ? (
              <p role="alert" className="mt-2 text-sm text-red-600">
                {versionError}
              </p>
            ) : null}
          </div>

          <h3 className="text-sm font-semibold text-slate-700">Version history</h3>
          {versions === null && !versionsError ? (
            <p className="animate-pulse text-sm text-slate-400">Loading versions…</p>
          ) : null}
          {versionsError ? (
            <div role="alert" className="rounded-md bg-red-50 px-4 py-3 text-sm text-red-700">
              Couldn't load the version history.
              <button
                type="button"
                onClick={reloadVersions}
                className="ml-3 font-medium text-slate-700 underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-slate-500"
              >
                Retry
              </button>
            </div>
          ) : null}
          {!versionsError && versions !== null && versions.length === 0 ? (
            <p className="text-sm text-slate-500">No versions yet.</p>
          ) : null}
          {!versionsError && versions !== null && versions.length > 0 ? (
            <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-slate-200 text-sm">
                  <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                    <tr>
                      <th scope="col" className="px-4 py-2 font-medium">
                        Version
                      </th>
                      <th scope="col" className="px-4 py-2 font-medium">
                        Status
                      </th>
                      <th scope="col" className="px-4 py-2 font-medium">
                        File
                      </th>
                      <th scope="col" className="px-4 py-2 font-medium">
                        Created
                      </th>
                      <th scope="col" className="px-4 py-2 font-medium">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {versions.map((version) => {
                      const versionFilename = fileBaseName(version.file_name)
                      return (
                        <tr key={version.id} className="hover:bg-slate-50">
                          <td className="px-4 py-3 font-medium text-slate-900">
                            v{version.version_number}
                          </td>
                          <td className="px-4 py-3 text-slate-600">
                            {version.is_active ? (
                              <span className="inline-flex items-center gap-1">
                                <span aria-hidden="true">✓</span> Active
                              </span>
                            ) : (
                              'Inactive'
                            )}
                          </td>
                          <td className="px-4 py-3 text-slate-600">
                            {version.has_file ? (versionFilename ?? 'File') : 'No file'}
                          </td>
                          <td className="px-4 py-3 text-slate-600">
                            {formatDate(version.created_at)}
                          </td>
                          <td className="px-4 py-3 text-slate-600">
                            <span className="flex flex-wrap items-center gap-2">
                              {version.is_active ? (
                                <span className="text-xs text-slate-400">Current version</span>
                              ) : confirmActivateId === version.id ? (
                                <span className="flex flex-wrap items-center gap-2">
                                  <span className="text-slate-700">Make this the active version?</span>
                                  <Button
                                    variant="secondary"
                                    loading={activatingId === version.id}
                                    loadingLabel="Activating…"
                                    disabled={activatingId !== null}
                                    onClick={() => handleActivate(version.id)}
                                  >
                                    Activate
                                  </Button>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setConfirmActivateId(null)
                                      setActivationError(undefined)
                                    }}
                                    className="text-sm text-slate-600 underline hover:text-slate-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-slate-500"
                                  >
                                    Cancel
                                  </button>
                                </span>
                              ) : (
                                <Button
                                  variant="secondary"
                                  disabled={activatingId !== null}
                                  onClick={() => {
                                    setConfirmActivateId(version.id)
                                    setActivationError(undefined)
                                  }}
                                >
                                  Activate
                                </Button>
                              )}
                              <Link
                                to={`/templates/${template.id}/versions/${version.id}`}
                                className="text-sm text-slate-600 underline hover:text-slate-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-slate-500"
                              >
                                View details
                              </Link>
                            </span>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
              {activationError ? (
                <p role="alert" className="border-t border-slate-200 px-4 py-3 text-sm text-red-700">
                  {activationError}
                </p>
              ) : null}
            </div>
          ) : null}
        </section>
      </div>
    </PageContainer>
  )
}