import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'

import { getGeneratedDocument } from '../../api/documents'
import { Button } from '../../components/ui/Button'
import { DocumentStatusBadge } from '../../components/ui/DocumentStatusBadge'
import { PageContainer } from '../../components/ui/PageContainer'
import { ApiError, HTTP_STATUS } from '../../types/api'
import type { GeneratedDocument } from '../../types/generatedDocument'

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
 * `company_id` is ever sent and generation/download are intentionally not part
 * of this scope.
 */
export function DocumentDetailPage() {
  const { documentId } = useParams()
  const id = Number(documentId)

  const [state, setState] = useState<State>({ status: 'loading' })

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

  useEffect(() => {
    if (Number.isNaN(id)) return
    void load()
  }, [id, load])

  function retry() {
    setState({ status: 'loading' })
    void load()
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

  const document = state.data
  const title = document.document_number || `Document #${document.id}`

  return (
    <PageContainer title={title}>
      <div className="space-y-4">
        <Link to="/documents" className="text-sm text-slate-600 underline hover:text-slate-900">
          Back to documents
        </Link>

        <div>
          <DocumentStatusBadge status={document.status} />
        </div>

        <dl className="grid max-w-2xl gap-x-8 gap-y-2 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-slate-500">Document type</dt>
            <dd className="text-slate-900">
              {document.document_type_code || document.document_type}
            </dd>
          </div>
          <div>
            <dt className="text-slate-500">Status</dt>
            <dd className="capitalize text-slate-900">{document.status}</dd>
          </div>
          <div>
            <dt className="text-slate-500">Client</dt>
            <dd className="text-slate-900">
              {document.client_id ? (
                <Link
                  to={`/clients/${document.client_id}`}
                  className="underline hover:text-slate-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-slate-500"
                >
                  Client #{document.client_id}
                </Link>
              ) : (
                '—'
              )}
            </dd>
          </div>
          <div>
            <dt className="text-slate-500">Template</dt>
            <dd className="text-slate-900">
              {document.template_id ? (
                <Link
                  to={`/templates/${document.template_id}`}
                  className="underline hover:text-slate-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-slate-500"
                >
                  Template #{document.template_id}
                </Link>
              ) : (
                '—'
              )}
            </dd>
          </div>
          <div>
            <dt className="text-slate-500">Created</dt>
            <dd className="text-slate-900">{formatDate(document.created_at)}</dd>
          </div>
          <div>
            <dt className="text-slate-500">Updated</dt>
            <dd className="text-slate-900">{formatDate(document.updated_at)}</dd>
          </div>
          {document.created_by_id ? (
            <div>
              <dt className="text-slate-500">Created by</dt>
              <dd className="text-slate-900">User #{document.created_by_id}</dd>
            </div>
          ) : null}
        </dl>
      </div>
    </PageContainer>
  )
}