import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'

import {
  downloadGeneratedDocumentDocx,
  downloadGeneratedDocumentPdf,
  fetchGeneratedDocumentPdf,
  generateDocumentDocx,
  generateGeneratedDocumentPdf,
  getGeneratedDocument,
  listGeneratedDocumentVersions,
} from '../../api/documents'
import { Button } from '../../components/ui/Button'
import { DocumentStatusBadge } from '../../components/ui/DocumentStatusBadge'
import { PageContainer } from '../../components/ui/PageContainer'
import { ApiError, HTTP_STATUS } from '../../types/api'
import type { GeneratedDocument, GeneratedDocumentVersion } from '../../types/generatedDocument'
import { triggerBrowserDownload } from '../../utils/download'
import { fileActionError } from '../../utils/fileActionError'
import { selectLatestDownloadableVersion } from './generatedDocumentVersions'

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

/**
 * Generated document detail (`GET /api/generated-documents/:id/`). The backend
 * returns the same `GeneratedDocumentSerializer` for detail and list, so this
 * page shows that metadata (number, document type, status, client/template
 * references, dates). The backend returns 404 for missing and cross-tenant
 * documents alike, so both render the same safe "not found" state. No
 * `company_id` is ever sent.
 *
 * DOCX and PDF generation (this phase) are synchronous and both live on a
 * document *version*: the page fetches the version list, offers "Generate
 * DOCX" when no version has a DOCX, "Download DOCX" when one exists, and —
 * once a DOCX version exists — the matching "Generate PDF"/"Download PDF"
 * actions driven by the version's `storage.pdf` state. The two workflows keep
 * independent loading states.
 */
export function DocumentDetailPage() {
  const { documentId } = useParams()
  const id = Number(documentId)
  const [searchParams, setSearchParams] = useSearchParams()

  const [state, setState] = useState<State>({ status: 'loading' })

  const [versions, setVersions] = useState<GeneratedDocumentVersion[] | null>(null)
  const [versionsError, setVersionsError] = useState(false)
  const [versionsReloadKey, setVersionsReloadKey] = useState(0)

  const [docxGenerating, setDocxGenerating] = useState(false)
  const [docxGenerationError, setDocxGenerationError] = useState<string>()

  const [pdfGenerating, setPdfGenerating] = useState(false)
  const [pdfGenerationError, setPdfGenerationError] = useState<string>()

  const [docxDownloading, setDocxDownloading] = useState(false)
  const [pdfDownloading, setPdfDownloading] = useState(false)
  const [downloadError, setDownloadError] = useState<string>()

  const [fileNotice, setFileNotice] = useState<string>()

  const [viewerState, setViewerState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const [viewerUrl, setViewerUrl] = useState<string>()
  const [viewerError, setViewerError] = useState<string>()
  const [viewerVersion, setViewerVersion] = useState<GeneratedDocumentVersion | null>(null)
  const viewerUrlRef = useRef<string | undefined>(undefined)
  const viewerAbortRef = useRef<AbortController | null>(null)
  const viewerSeqRef = useRef(0)
  const autoOpenedForRef = useRef<string | null>(null)

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
    return selectLatestDownloadableVersion(versions)
  }, [versions])

  const openViewer = useCallback((version: GeneratedDocumentVersion) => {
    if (!version.storage.pdf) return
    if (viewerState === 'loading') return

    viewerAbortRef.current?.abort()
    viewerAbortRef.current = null
    if (viewerUrlRef.current) {
      URL.revokeObjectURL(viewerUrlRef.current)
      viewerUrlRef.current = undefined
    }

    const seq = viewerSeqRef.current + 1
    viewerSeqRef.current = seq
    const controller = new AbortController()
    viewerAbortRef.current = controller

    setViewerVersion(version)
    setViewerUrl(undefined)
    setViewerError(undefined)
    setViewerState('loading')

    void fetchGeneratedDocumentPdf(version.id, controller.signal)
      .then((blob) => {
        if (viewerSeqRef.current !== seq) return
        if (typeof URL.createObjectURL !== 'function') {
          setViewerError('PDF viewing is not supported in this browser.')
          setViewerState('error')
          return
        }
        const url = URL.createObjectURL(blob)
        viewerUrlRef.current = url
        setViewerUrl(url)
        setViewerState('ready')
      })
      .catch((error: unknown) => {
        if (viewerSeqRef.current !== seq) return
        if (controller.signal.aborted) return
        setViewerError(fileActionError(error, 'Could not load the PDF.'))
        setViewerState('error')
      })
  }, [viewerState])

  function closeViewer() {
    viewerAbortRef.current?.abort()
    viewerAbortRef.current = null
    if (viewerUrlRef.current) {
      URL.revokeObjectURL(viewerUrlRef.current)
      viewerUrlRef.current = undefined
    }
    viewerSeqRef.current += 1
    setViewerVersion(null)
    setViewerUrl(undefined)
    setViewerError(undefined)
    setViewerState('idle')
    if (searchParams.get('view') === 'pdf') {
      setSearchParams({})
    }
  }

  // Release the viewer's object URL and cancel any in-flight PDF request when
  // the page unmounts (also when navigating to another document).
  useEffect(() => {
    return () => {
      viewerAbortRef.current?.abort()
      viewerAbortRef.current = null
      if (viewerUrlRef.current) {
        URL.revokeObjectURL(viewerUrlRef.current)
        viewerUrlRef.current = undefined
      }
    }
  }, [])

  // `?view=pdf` (from the Documents list "View" action) opens the viewer once
  // the version list has loaded and the selected version has a PDF. The
  // handled-search marker prevents a close/clear race from re-opening the
  // viewer on an intermediate render, while still allowing a fresh `?view=pdf`
  // navigation (the marker is reset whenever the parameter is absent).
  useEffect(() => {
    if (searchParams.get('view') !== 'pdf') {
      autoOpenedForRef.current = null
      return
    }
    if (autoOpenedForRef.current === searchParams.toString()) return
    if (docxVersion === null) return
    if (!docxVersion.storage.pdf) return
    if (viewerState !== 'idle') return
    autoOpenedForRef.current = searchParams.toString()
    // Intentional: a `?view=pdf` navigation should open the viewer on arrival.
    // oxlint-disable-next-line react/set-state-in-effect
    openViewer(docxVersion)
  }, [searchParams, docxVersion, viewerState, openViewer])

  function handleGenerateDocx() {
    if (docxGenerating) return
    setDocxGenerating(true)
    setDocxGenerationError(undefined)
    setFileNotice(undefined)
    void generateDocumentDocx(id)
      .then((version) => {
        setFileNotice(`DOCX generated as version ${version.version_number}.`)
        reloadVersions()
      })
      .catch((error: unknown) =>
        setDocxGenerationError(fileActionError(error, 'Could not generate the DOCX.')),
      )
      .finally(() => setDocxGenerating(false))
  }

  function handleGeneratePdf(version: GeneratedDocumentVersion) {
    if (pdfGenerating) return
    setPdfGenerating(true)
    setPdfGenerationError(undefined)
    setFileNotice(undefined)
    void generateGeneratedDocumentPdf(version.id)
      .then((result) => {
        setFileNotice(`PDF generated for version ${result.version_number}.`)
        reloadVersions()
      })
      .catch((error: unknown) =>
        setPdfGenerationError(fileActionError(error, 'Could not generate the PDF.')),
      )
      .finally(() => setPdfGenerating(false))
  }

  function handleDownloadDocx(version: GeneratedDocumentVersion) {
    if (docxDownloading) return
    setDocxDownloading(true)
    setDownloadError(undefined)
    const fallbackFilename = state.status === 'ready' ? `${state.data.document_number || `document-${state.data.id}`}.docx` : 'document.docx'
    void downloadGeneratedDocumentDocx(version.id, fallbackFilename)
      .then(({ blob, filename }) => triggerBrowserDownload(blob, filename))
      .catch((error: unknown) =>
        setDownloadError(fileActionError(error, 'Could not download the DOCX.')),
      )
      .finally(() => setDocxDownloading(false))
  }

  function handleDownloadPdf(version: GeneratedDocumentVersion) {
    if (pdfDownloading) return
    setPdfDownloading(true)
    setDownloadError(undefined)
    const fallbackFilename = state.status === 'ready' ? `${state.data.document_number || `document-${state.data.id}`}.pdf` : 'document.pdf'
    void downloadGeneratedDocumentPdf(version.id, fallbackFilename)
      .then(({ blob, filename }) => triggerBrowserDownload(blob, filename))
      .catch((error: unknown) =>
        setDownloadError(fileActionError(error, 'Could not download the PDF.')),
      )
      .finally(() => setPdfDownloading(false))
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
                  {generatedDocument.client_name
                    ? `${generatedDocument.client_name} (Client #${generatedDocument.client_id})`
                    : `Client #${generatedDocument.client_id}`}
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
                  {generatedDocument.template_name
                    ? `${generatedDocument.template_name} (Template #${generatedDocument.template_id})`
                    : `Template #${generatedDocument.template_id}`}
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
              <dd className="text-slate-900">
                {generatedDocument.created_by_name
                  ? `${generatedDocument.created_by_name} (User #${generatedDocument.created_by_id})`
                  : `User #${generatedDocument.created_by_id}`}
              </dd>
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
            docxVersion ? (
              <div className="space-y-3">
                <div className="flex flex-wrap items-center gap-3 rounded-lg border border-slate-200 bg-white p-4">
                  <p className="text-sm text-slate-600">
                    DOCX file available (version {docxVersion.version_number}).
                  </p>
                  <Button
                    variant="secondary"
                    loading={docxDownloading}
                    loadingLabel="Downloading DOCX…"
                    disabled={docxDownloading}
                    onClick={() => handleDownloadDocx(docxVersion)}
                  >
                    Download DOCX
                  </Button>
                </div>
                {docxVersion.storage.pdf ? (
                  <div className="flex flex-wrap items-center gap-3 rounded-lg border border-slate-200 bg-white p-4">
                    <p className="text-sm text-slate-600">
                      PDF file available (version {docxVersion.version_number}).
                    </p>
                    <Button
                      variant="secondary"
                      loading={viewerState === 'loading'}
                      loadingLabel="Loading PDF…"
                      disabled={viewerState === 'loading'}
                      onClick={() => openViewer(docxVersion)}
                    >
                      View PDF
                    </Button>
                    <Button
                      variant="secondary"
                      loading={pdfDownloading}
                      loadingLabel="Downloading PDF…"
                      disabled={pdfDownloading}
                      onClick={() => handleDownloadPdf(docxVersion)}
                    >
                      Download PDF
                    </Button>
                  </div>
                ) : (
                  <div className="flex flex-wrap items-center gap-3 rounded-lg border border-slate-200 bg-white p-4">
                    <p className="text-sm text-slate-500">No PDF generated yet.</p>
                    <Button
                      variant="secondary"
                      loading={pdfGenerating}
                      loadingLabel="Generating PDF…"
                      onClick={() => handleGeneratePdf(docxVersion)}
                    >
                      Generate PDF
                    </Button>
                  </div>
                )}
              </div>
            ) : (
              <div className="flex flex-wrap items-center gap-3 rounded-lg border border-slate-200 bg-white p-4">
                <p className="text-sm text-slate-500">No DOCX generated yet.</p>
                <Button
                  variant="secondary"
                  loading={docxGenerating}
                  loadingLabel="Generating DOCX…"
                  onClick={handleGenerateDocx}
                >
                  Generate DOCX
                </Button>
              </div>
            )
          ) : null}
          {fileNotice ? (
            <p role="status" className="text-sm text-emerald-700">
              {fileNotice}
            </p>
          ) : null}
          {docxGenerationError ? (
            <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
              {docxGenerationError}
            </p>
          ) : null}
          {pdfGenerationError ? (
            <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
              {pdfGenerationError}
            </p>
          ) : null}
          {downloadError ? (
            <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
              {downloadError}
            </p>
          ) : null}
        </section>

        {viewerState !== 'idle' ? (
          <section aria-label="PDF viewer" className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-sm font-semibold text-slate-700">PDF viewer</h2>
              <button
                type="button"
                onClick={closeViewer}
                className="text-sm text-slate-600 underline hover:text-slate-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-slate-500"
              >
                Close viewer
              </button>
            </div>
            {viewerState === 'loading' ? (
              <div
                data-testid="pdf-viewer-loading"
                className="flex h-[600px] items-center justify-center rounded-lg border border-slate-200 bg-white text-sm text-slate-500"
              >
                Loading PDF…
              </div>
            ) : null}
            {viewerState === 'error' ? (
              <div
                role="alert"
                className="space-y-2 rounded-md bg-red-50 px-4 py-3 text-sm text-red-700"
              >
                <p>{viewerError}</p>
                <Button
                  variant="secondary"
                  onClick={() => viewerVersion && openViewer(viewerVersion)}
                >
                  Retry
                </Button>
              </div>
            ) : null}
            {viewerState === 'ready' && viewerUrl ? (
              <iframe
                src={viewerUrl}
                title="Generated document PDF"
                data-testid="document-pdf-viewer"
                className="h-[700px] w-full rounded-lg border border-slate-200 bg-white"
              />
            ) : null}
          </section>
        ) : null}
      </div>
    </PageContainer>
  )
}