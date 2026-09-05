import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'

import {
  downloadGeneratedDocumentDocx,
  generateDocumentDocx,
  getGeneratedDocument,
  listGeneratedDocumentVersions,
} from '../../api/documents'
import { Button } from '../../components/ui/Button'
import { DocumentStatusBadge } from '../../components/ui/DocumentStatusBadge'
import { PageContainer } from '../../components/ui/PageContainer'
import { ApiError, HTTP_STATUS } from '../../types/api'
import type { GeneratedDocument, GeneratedDocumentVersion } from '../../types/generatedDocument'

type State =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'forbidden' }
  | { status: 'notfound' }
  | { status: 'ready'; data: GeneratedDocument }

function formatDate(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return date.toISOString().slice(0, 10)
}

function docxError(error: unknown, fallback: string): string {
  if (!(error instanceof ApiError)) return fallback
  if (error.status === HTTP_STATUS.FORBIDDEN) {
    return 'You do not have permission to generate or download this document.'
  }
  if (error.status === HTTP_STATUS.NOT_FOUND) {
    return 'The document or its generated file is not available.'
  }
  if (error.status === HTTP_STATUS.TOO_MANY_REQUESTS) {
    return error.retryAfterSeconds !== null
      ? `Too many attempts. Please wait ${error.retryAfterSeconds} seconds and try again.`
      : 'Too many attempts. Please wait a moment and try again.'
  }
  return error.message || fallback
}

/**
 * Generated document detail (`GET /api/generated-documents/:id/`). The backend
 * returns the same `GeneratedDocumentSerializer` for detail and list, so this
 * page shows that metadata (number, document type, status, client/template
 * references, dates). The backend returns 404 for missing and cross-tenant
 * documents alike, so both render the same safe "not found" state. No
 * `company_id` is ever sent.
 *
 * DOCX generation (this phase) is synchronous: the generated file lives on a
 * document *version*, so the page also fetches the version list, offers a
 * "Generate DOCX" action when no version has a DOCX, and an authenticated
 * "Download DOCX" action (via the version-based endpoint) when one exists.
 */
export function DocumentDetailPage() {
  const { documentId } = useParams()
  const id = Number(documentId)

  const [state, setState] = useState<State>({ status: 'loading' })

  const [versions, setVersions] = useState<GeneratedDocumentVersion[] | null>(null)
  const [versionsError, setVersionsError] = useState(false)
  const [versionsReloadKey, setVersionsReloadKey] = useState(0)

  const [generating, setGenerating] = useState(false)
  const [generationError, setGenerationError] = useState<string>()

  const [downloading, setDownloading] = useState(false)
  const [downloadError, setDownloadError] = useState<string>()

  const [fileNotice, setFileNotice] = useState<string>()

  const load = useCallback(() => {
    void getGeneratedDocument(id)
      .then((data) => setState({ status: 'ready', data }))
      .catch((error: unknown) => {
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
    void listGeneratedDocumentVersions(id)
      .then((data) => {
        setVersions(data)
        setVersionsError(false)
      })
      .catch(() => setVersionsError(true))
  }, [id])

  useEffect(() => {
    if (Number.isNaN(id)) return
    void load()
  }, [id, load])

  useEffect(() => {
    if (Number.isNaN(id)) return
    void loadVersions()
  }, [id, loadVersions, versionsReloadKey])

  function retry() {
    setState({ status: 'loading' })
    void load()
  }

  function reloadVersions() {
    setVersionsError(false)
    setVersionsReloadKey((key) => key + 1)
  }

  const docxVersion = useMemo(() => {
    if (versions === null) return null
    return [...versions].reverse().find((version) => version.storage.docx) ?? null
  }, [versions])

  function handleGenerate() {
    if (generating) return
    setGenerating(true)
    setGenerationError(undefined)
    setFileNotice(undefined)
    void generateDocumentDocx(id)
      .then((version) => {
        setFileNotice(`DOCX generated as version ${version.version_number}.`)
        reloadVersions()
      })
      .catch((error: unknown) =>
        setGenerationError(docxError(error, 'Could not generate the DOCX.')),
      )
      .finally(() => setGenerating(false))
  }

  function handleDownload(version: GeneratedDocumentVersion) {
    if (downloading) return
    setDownloading(true)
    setDownloadError(undefined)
    setFileNotice(undefined)
    const fallbackFilename = state.status === 'ready' ? `${state.data.document_number || `document-${state.data.id}`}.docx` : 'document.docx'
    void downloadGeneratedDocumentDocx(version.id, fallbackFilename)
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
      .catch((error: unknown) =>
        setDownloadError(docxError(error, 'Could not download the DOCX.')),
      )
      .finally(() => setDownloading(false))
  }

  if (Number.isNaN(id)) {
    return (
      <PageContainer title="Document">
        <div className="rounded-md bg-slate-50 px-4 py-3 text-sm text-slate-600">
          Document not found.
        </div>
        <Link to="/documents" className="text-sm text-slate-600 underline hover:text-slate-900">
          Back to documents
        </Link>
      </PageContainer>
    )
  }

  if (state.status === 'loading') {
    return (
      <PageContainer title="Document">
        <p data-testid="document-detail-loading" className="animate-pulse text-sm text-slate-400">
          Loading…
        </p>
      </PageContainer>
    )
  }

  if (state.status === 'notfound') {
    return (
      <PageContainer title="Document">
        <div className="rounded-md bg-slate-50 px-4 py-3 text-sm text-slate-600">
          Document not found.
        </div>
        <Link to="/documents" className="text-sm text-slate-600 underline hover:text-slate-900">
          Back to documents
        </Link>
      </PageContainer>
    )
  }

  if (state.status === 'forbidden') {
    return (
      <PageContainer title="Document">
        <div role="alert" className="rounded-md bg-red-50 px-4 py-3 text-sm text-red-700">
          You do not have permission to view this document.
        </div>
        <Link to="/documents" className="text-sm text-slate-600 underline hover:text-slate-900">
          Back to documents
        </Link>
      </PageContainer>
    )
  }

  if (state.status === 'error') {
    return (
      <PageContainer title="Document">
        <div role="alert" className="rounded-md bg-red-50 px-4 py-3 text-sm text-red-700">
          Couldn't load the document.
        </div>
        <Button variant="secondary" onClick={retry}>
          Retry
        </Button>
      </PageContainer>
    )
  }

  const generatedDocument = state.data
  const title = generatedDocument.document_number || `Document #${generatedDocument.id}`

  return (
    <PageContainer title={title}>
      <div className="space-y-4">
        <Link to="/documents" className="text-sm text-slate-600 underline hover:text-slate-900">
          Back to documents
        </Link>

        <div>
          <DocumentStatusBadge status={generatedDocument.status} />
        </div>

        <dl className="grid max-w-2xl gap-x-8 gap-y-2 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-slate-500">Document type</dt>
            <dd className="text-slate-900">
              {generatedDocument.document_type_code || generatedDocument.document_type}
            </dd>
          </div>
          <div>
            <dt className="text-slate-500">Status</dt>
            <dd className="capitalize text-slate-900">{generatedDocument.status}</dd>
          </div>
          <div>
            <dt className="text-slate-500">Client</dt>
            <dd className="text-slate-900">
              {generatedDocument.client_id ? (
                <Link
                  to={`/clients/${generatedDocument.client_id}`}
                  className="underline hover:text-slate-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-slate-500"
                >
                  Client #{generatedDocument.client_id}
                </Link>
              ) : (
                '—'
              )}
            </dd>
          </div>
          <div>
            <dt className="text-slate-500">Template</dt>
            <dd className="text-slate-900">
              {generatedDocument.template_id ? (
                <Link
                  to={`/templates/${generatedDocument.template_id}`}
                  className="underline hover:text-slate-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-slate-500"
                >
                  Template #{generatedDocument.template_id}
                </Link>
              ) : (
                '—'
              )}
            </dd>
          </div>
          <div>
            <dt className="text-slate-500">Created</dt>
            <dd className="text-slate-900">{formatDate(generatedDocument.created_at)}</dd>
          </div>
          <div>
            <dt className="text-slate-500">Updated</dt>
            <dd className="text-slate-900">{formatDate(generatedDocument.updated_at)}</dd>
          </div>
          {generatedDocument.created_by_id ? (
            <div>
              <dt className="text-slate-500">Created by</dt>
              <dd className="text-slate-900">User #{generatedDocument.created_by_id}</dd>
            </div>
          ) : null}
        </dl>

        <section aria-label="Generated document file" className="space-y-2">
          <h2 className="text-sm font-semibold text-slate-700">Generated file</h2>
          {versions === null && !versionsError ? (
            <p className="animate-pulse text-sm text-slate-400">Loading generated files…</p>
          ) : null}
          {versionsError ? (
            <div role="alert" className="rounded-md bg-red-50 px-4 py-3 text-sm text-red-700">
              Couldn't load the generated files.
              <button
                type="button"
                onClick={reloadVersions}
                className="ml-3 font-medium text-slate-700 underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-slate-500"
              >
                Retry
              </button>
            </div>
          ) : null}
          {!versionsError && versions !== null ? (
            <div className="flex flex-wrap items-center gap-3 rounded-lg border border-slate-200 bg-white p-4">
              {docxVersion ? (
                <>
                  <p className="text-sm text-slate-600">
                    DOCX file available (version {docxVersion.version_number}).
                  </p>
                  <Button
                    variant="secondary"
                    loading={downloading}
                    loadingLabel="Downloading…"
                    disabled={downloading}
                    onClick={() => handleDownload(docxVersion)}
                  >
                    Download DOCX
                  </Button>
                </>
              ) : (
                <>
                  <p className="text-sm text-slate-500">No DOCX generated yet.</p>
                  <Button
                    variant="secondary"
                    loading={generating}
                    loadingLabel="Generating DOCX…"
                    onClick={handleGenerate}
                  >
                    Generate DOCX
                  </Button>
                </>
              )}
            </div>
          ) : null}
          {fileNotice ? (
            <p role="status" className="text-sm text-emerald-700">
              {fileNotice}
            </p>
          ) : null}
          {generationError ? (
            <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
              {generationError}
            </p>
          ) : null}
          {downloadError ? (
            <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
              {downloadError}
            </p>
          ) : null}
        </section>
      </div>
    </PageContainer>
  )
}