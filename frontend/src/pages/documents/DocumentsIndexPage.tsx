import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'

import {
  downloadGeneratedDocumentDocx,
  downloadGeneratedDocumentPdf,
  listGeneratedDocumentVersions,
  listGeneratedDocuments,
} from '../../api/documents'
import { Button } from '../../components/ui/Button'
import { buttonClasses } from '../../components/ui/buttonClasses'
import { DocumentStatusBadge } from '../../components/ui/DocumentStatusBadge'
import { PageContainer } from '../../components/ui/PageContainer'
import type { GeneratedDocument, GeneratedDocumentVersion } from '../../types/generatedDocument'
import { triggerBrowserDownload } from '../../utils/download'
import { fileActionError } from '../../utils/fileActionError'
import { selectLatestDownloadableVersion } from './generatedDocumentVersions'

function formatDate(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return date.toISOString().slice(0, 10)
}

type RowFilesState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; version: GeneratedDocumentVersion | null }

/**
 * Per-row file actions. The list serializer exposes no version/file metadata,
 * so each row loads its versions through the existing
 * `GET /api/generated-documents/:id/versions/` endpoint and shows actions based
 * on the real `storage.docx` / `storage.pdf` booleans. Actions never regenerate
 * a document: View links to the detail page's PDF viewer (`?view=pdf`), and
 * Download DOCX/PDF reuse the authenticated version download endpoints.
 */
function DocumentRowActions({ document }: { document: GeneratedDocument }) {
  const [files, setFiles] = useState<RowFilesState>({ status: 'loading' })
  const [downloading, setDownloading] = useState<'docx' | 'pdf' | null>(null)
  const [error, setError] = useState<string>()
  const tokenRef = useRef(0)

  const loadVersions = () => {
    const token = tokenRef.current + 1
    tokenRef.current = token
    setFiles({ status: 'loading' })
    void listGeneratedDocumentVersions(document.id)
      .then((versions) => {
        if (tokenRef.current !== token) return
        setFiles({
          status: 'ready',
          version: selectLatestDownloadableVersion(versions),
        })
      })
      .catch(() => {
        if (tokenRef.current !== token) return
        setFiles({ status: 'error' })
      })
  }

  useEffect(() => {
    const token = tokenRef.current + 1
    tokenRef.current = token
    void listGeneratedDocumentVersions(document.id)
      .then((versions) => {
        if (tokenRef.current !== token) return
        setFiles({
          status: 'ready',
          version: selectLatestDownloadableVersion(versions),
        })
      })
      .catch(() => {
        if (tokenRef.current !== token) return
        setFiles({ status: 'error' })
      })
  }, [document.id])

  const handleDownload = (kind: 'docx' | 'pdf') => {
    if (downloading) return
    if (files.status !== 'ready' || files.version === null) return
    setDownloading(kind)
    const fallback = `${document.document_number || `document-${document.id}`}.${kind}`
    const promise =
      kind === 'docx'
        ? downloadGeneratedDocumentDocx(files.version.id, fallback)
        : downloadGeneratedDocumentPdf(files.version.id, fallback)
    void promise
      .then(({ blob, filename }) => {
        triggerBrowserDownload(blob, filename)
        setError(undefined)
      })
      .catch((err: unknown) =>
        setError(fileActionError(err, 'Could not download the file.')),
      )
      .finally(() => setDownloading(null))
  }

  if (files.status === 'loading') {
    return <span className="text-xs text-slate-400">Loading files…</span>
  }

  if (files.status === 'error') {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-red-600">Files unavailable.</span>
        <button
          type="button"
          onClick={loadVersions}
          className="text-xs font-medium text-slate-700 underline hover:text-slate-900"
        >
          Retry
        </button>
      </div>
    )
  }

  const version = files.version
  if (version === null) {
    return <span className="text-xs text-slate-400">No generated files</span>
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {version.storage.pdf ? (
        <Link
          to={`/documents/${document.id}?view=pdf`}
          className={buttonClasses('secondary', 'px-2 py-1 text-xs')}
        >
          View
        </Link>
      ) : null}
      <Button
        variant="secondary"
        className="px-2 py-1 text-xs"
        loading={downloading === 'docx'}
        loadingLabel="Downloading DOCX…"
        disabled={downloading !== null}
        onClick={() => handleDownload('docx')}
      >
        Download DOCX
      </Button>
      {version.storage.pdf ? (
        <Button
          variant="secondary"
          className="px-2 py-1 text-xs"
          loading={downloading === 'pdf'}
          loadingLabel="Downloading PDF…"
          disabled={downloading !== null}
          onClick={() => handleDownload('pdf')}
        >
          Download PDF
        </Button>
      ) : null}
      {error ? <span className="text-xs text-red-600">{error}</span> : null}
    </div>
  )
}

/**
 * Generated documents list backed by `GET /api/generated-documents/`. The
 * backend returns a plain array (no pagination), has no search/filter
 * parameters, and orders newest-first server-side — so this page renders that
 * collection directly with no invented controls. The company is always the
 * authenticated user's company; no `company_id` is ever sent.
 */
export function DocumentsIndexPage() {
  const [documents, setDocuments] = useState<GeneratedDocument[] | null>(null)
  const [error, setError] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    let cancelled = false
    void listGeneratedDocuments()
      .then((data) => {
        if (cancelled) return
        setDocuments(data)
        setError(false)
      })
      .catch(() => {
        if (cancelled) return
        setError(true)
      })
    return () => {
      cancelled = true
    }
  }, [reloadKey])

  const retry = () => setReloadKey((key) => key + 1)

  return (
    <PageContainer title="Documents">
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            {documents !== null && !error ? (
              <p className="text-sm text-slate-500" data-testid="documents-count">
                {documents.length} {documents.length === 1 ? 'document' : 'documents'}
              </p>
            ) : null}
          </div>
          <Link to="/documents/new" className={buttonClasses('primary')}>
            New document
          </Link>
        </div>

        {error && (
          <div
            role="alert"
            className="rounded-md bg-red-50 px-4 py-3 text-sm text-red-700"
          >
            Couldn't load documents.
            <button
              type="button"
              onClick={retry}
              className="ml-3 font-medium text-slate-700 underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-slate-500"
            >
              Retry
            </button>
          </div>
        )}

        {documents === null && !error && (
          <p data-testid="documents-loading" className="animate-pulse text-sm text-slate-400">
            Loading…
          </p>
        )}

        {documents !== null && documents.length === 0 && !error && (
          <div className="rounded-lg border border-dashed border-slate-300 px-4 py-10 text-center">
            <p className="text-sm text-slate-500">No documents yet.</p>
            <Link
              to="/documents/new"
              className="mt-2 inline-block text-sm font-medium text-slate-700 underline"
            >
              Create your first document
            </Link>
          </div>
        )}

        {documents !== null && documents.length > 0 && !error && (
          <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-200 text-sm">
                <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th scope="col" className="px-4 py-2 font-medium">
                      Number
                    </th>
                    <th scope="col" className="px-4 py-2 font-medium">
                      Document type
                    </th>
                    <th scope="col" className="px-4 py-2 font-medium">
                      Client
                    </th>
                    <th scope="col" className="px-4 py-2 font-medium">
                      Status
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
                  {documents.map((document) => (
                    <tr key={document.id} className="hover:bg-slate-50">
                      <td className="px-4 py-3 font-medium text-slate-900">
                        <Link
                          to={`/documents/${document.id}`}
                          className="hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-slate-500"
                        >
                          {document.document_number}
                        </Link>
                      </td>
                      <td className="px-4 py-3 text-slate-600">
                        {document.document_type_code || document.document_type}
                      </td>
                      <td className="px-4 py-3 text-slate-600">
                        {document.client_name
                          ? `${document.client_name} (Client #${document.client_id})`
                          : document.client_id
                            ? `Client #${document.client_id}`
                            : '—'}
                      </td>
                      <td className="px-4 py-3">
                        <DocumentStatusBadge status={document.status} />
                      </td>
                      <td className="px-4 py-3 text-slate-600">
                        {formatDate(document.created_at)}
                      </td>
                      <td className="px-4 py-3">
                        <DocumentRowActions
                          key={`${document.id}-${reloadKey}`}
                          document={document}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </PageContainer>
  )
}