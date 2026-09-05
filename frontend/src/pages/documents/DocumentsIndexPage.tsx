import { useEffect, useState } from 'react'

import { listGeneratedDocuments } from '../../api/documents'
import { PageContainer } from '../../components/ui/PageContainer'
import type { GeneratedDocument, GeneratedDocumentStatus } from '../../types/generatedDocument'

const STATUS_LABELS: Record<GeneratedDocumentStatus, string> = {
  draft: 'Draft',
  generated: 'Generated',
  sent: 'Sent',
  void: 'Void',
}

const STATUS_CLASSES: Record<GeneratedDocumentStatus, string> = {
  draft: 'bg-slate-100 text-slate-700',
  generated: 'bg-emerald-100 text-emerald-800',
  sent: 'bg-sky-100 text-sky-800',
  void: 'bg-red-100 text-red-700',
}

function formatDate(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return date.toISOString().slice(0, 10)
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
        {documents !== null && !error ? (
          <p className="text-sm text-slate-500" data-testid="documents-count">
            {documents.length} {documents.length === 1 ? 'document' : 'documents'}
          </p>
        ) : null}

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
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {documents.map((document) => (
                    <tr key={document.id} className="hover:bg-slate-50">
                      <td className="px-4 py-3 font-medium text-slate-900">
                        {document.document_number}
                      </td>
                      <td className="px-4 py-3 text-slate-600">
                        {document.document_type_code || document.document_type}
                      </td>
                      <td className="px-4 py-3 text-slate-600">
                        {document.client_id ? `Client #${document.client_id}` : '—'}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          data-testid="document-status"
                          className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_CLASSES[document.status]}`}
                        >
                          {STATUS_LABELS[document.status]}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-slate-600">
                        {formatDate(document.created_at)}
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