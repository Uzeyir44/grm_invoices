import { useCallback, useEffect, useMemo, useState } from 'react'

import { fetchClients } from '../../api/clients'
import { fetchGeneratedDocuments } from '../../api/documents'
import { fetchDocumentTemplates } from '../../api/templates'
import { StatCard } from '../../components/ui/StatCard'
import { PageContainer } from '../../components/ui/PageContainer'
import { useAuth } from '../../contexts/auth-context'
import type { ClientSummary } from '../../types/client'
import type { DocumentTemplate } from '../../types/documentTemplate'
import type { GeneratedDocument } from '../../types/generatedDocument'

type Section<T> =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; data: T }

function formatDate(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) {
    return iso
  }
  return date.toISOString().slice(0, 10)
}

/**
 * Initial dashboard. All numbers are derived from real backend list endpoints
 * (the caller's company-scoped data); nothing is fabricated. Each section is
 * independent, so one failed API call does not break the rest of the page.
 */
export function DashboardIndexPage() {
  const { user, companyName } = useAuth()
  const [clients, setClients] = useState<Section<ClientSummary[]>>({
    status: 'loading',
  })
  const [templates, setTemplates] = useState<Section<DocumentTemplate[]>>({
    status: 'loading',
  })
  const [documents, setDocuments] = useState<Section<GeneratedDocument[]>>({
    status: 'loading',
  })

  const loadClients = useCallback(() => {
    setClients({ status: 'loading' })
    void fetchClients()
      .then((data) => setClients({ status: 'ready', data }))
      .catch(() => setClients({ status: 'error' }))
  }, [])

  const loadTemplates = useCallback(() => {
    setTemplates({ status: 'loading' })
    void fetchDocumentTemplates()
      .then((data) => setTemplates({ status: 'ready', data }))
      .catch(() => setTemplates({ status: 'error' }))
  }, [])

  const loadDocuments = useCallback(() => {
    setDocuments({ status: 'loading' })
    void fetchGeneratedDocuments()
      .then((data) => setDocuments({ status: 'ready', data }))
      .catch(() => setDocuments({ status: 'error' }))
  }, [])

  useEffect(() => {
    let cancelled = false
    const safeSet = <T,>(setter: (value: T) => void, value: T) => {
      if (!cancelled) setter(value)
    }
    void fetchClients()
      .then((data) => safeSet(setClients, { status: 'ready', data }))
      .catch(() => safeSet(setClients, { status: 'error' }))
    void fetchDocumentTemplates()
      .then((data) => safeSet(setTemplates, { status: 'ready', data }))
      .catch(() => safeSet(setTemplates, { status: 'error' }))
    void fetchGeneratedDocuments()
      .then((data) => safeSet(setDocuments, { status: 'ready', data }))
      .catch(() => safeSet(setDocuments, { status: 'error' }))
    return () => {
      cancelled = true
    }
  }, [])

  const recentDocuments = useMemo(() => {
    if (documents.status !== 'ready') {
      return []
    }
    return [...documents.data]
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .slice(0, 5)
  }, [documents])

  const firstName = user?.first_name?.trim()
  const welcome = firstName ? `Welcome, ${firstName}` : 'Welcome'

  return (
    <PageContainer title="Dashboard">
      <div className="space-y-6">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">{welcome}</h2>
          {companyName ? (
            <p className="text-sm text-slate-500">{companyName}</p>
          ) : null}
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <StatCard
            label="Clients"
            value={clients.status === 'ready' ? clients.data.length : undefined}
            loading={clients.status === 'loading'}
            error={clients.status === 'error' ? "Couldn't load clients." : undefined}
            empty="No clients yet."
            onRetry={clients.status === 'error' ? loadClients : undefined}
          />
          <StatCard
            label="Templates"
            value={templates.status === 'ready' ? templates.data.length : undefined}
            loading={templates.status === 'loading'}
            error={templates.status === 'error' ? "Couldn't load templates." : undefined}
            empty="No templates yet."
            onRetry={templates.status === 'error' ? loadTemplates : undefined}
          />
          <StatCard
            label="Documents"
            value={documents.status === 'ready' ? documents.data.length : undefined}
            loading={documents.status === 'loading'}
            error={documents.status === 'error' ? "Couldn't load documents." : undefined}
            empty="No documents yet."
            onRetry={documents.status === 'error' ? loadDocuments : undefined}
          />
        </div>

        <section aria-label="Recent documents">
          <h2 className="mb-2 text-sm font-semibold text-slate-700">
            Recent documents
          </h2>
          {documents.status === 'loading' && (
            <p
              data-testid="recent-documents-loading"
              className="animate-pulse text-sm text-slate-400"
            >
              Loading…
            </p>
          )}
          {documents.status === 'error' && (
            <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
              Couldn't load documents.
            </p>
          )}
          {documents.status === 'ready' && documents.data.length === 0 && (
            <p className="rounded-lg border border-dashed border-slate-300 px-4 py-6 text-center text-sm text-slate-500">
              No documents yet.
            </p>
          )}
          {documents.status === 'ready' && documents.data.length > 0 && (
            <ul className="divide-y divide-slate-200 rounded-lg border border-slate-200 bg-white">
              {recentDocuments.map((document) => (
                <li
                  key={document.id}
                  className="flex items-center justify-between gap-4 px-4 py-3"
                >
                  <span className="text-sm font-medium text-slate-900">
                    {document.document_number}
                  </span>
                  <span className="flex items-center gap-4 text-sm text-slate-500">
                    <span>{document.document_type_code}</span>
                    <span data-testid="document-status">{document.status}</span>
                    <span>{formatDate(document.created_at)}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </PageContainer>
  )
}