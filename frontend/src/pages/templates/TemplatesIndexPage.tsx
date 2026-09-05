import { useCallback, useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'

import { listTemplates } from '../../api/templates'
import { fetchDocumentTypes } from '../../api/referenceData'
import { buttonClasses } from '../../components/ui/buttonClasses'
import { PageContainer } from '../../components/ui/PageContainer'
import { FIELD_INPUT_CLASS } from '../../components/ui/formClasses'
import type { DocumentTemplate } from '../../types/documentTemplate'
import type { DocumentType } from '../../types/referenceData'

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

/**
 * Template list backed by `GET /api/document-templates/`. The only supported
 * filter is the backend `document_type` query parameter (a foreign-key id), so
 * the document-type select maps 1:1 to that parameter and is kept in the URL
 * so refresh / back-forward preserve the list state. The backend returns a
 * plain array (no pagination) and supports no search, so none is shown. The
 * document-type options come from the read-only reference-data catalog; if
 * that catalog call fails the list still works (only the filter is disabled).
 */
export function TemplatesIndexPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const documentTypeParam = searchParams.get('document_type') ?? ''

  const [templates, setTemplates] = useState<DocumentTemplate[] | null>(null)
  const [error, setError] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)

  const [documentTypes, setDocumentTypes] = useState<DocumentType[] | null>(null)
  const [typesError, setTypesError] = useState(false)
  const [typesReloadKey, setTypesReloadKey] = useState(0)

  const applyParams = useCallback(
    (updates: Record<string, string>, replace = false) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev)
          for (const [key, value] of Object.entries(updates)) {
            if (value) next.set(key, value)
            else next.delete(key)
          }
          return next
        },
        replace ? { replace: true } : undefined,
      )
    },
    [setSearchParams],
  )

  useEffect(() => {
    let cancelled = false
    void listTemplates({ document_type: documentTypeParam || undefined })
      .then((data) => {
        if (cancelled) return
        setTemplates(data)
        setError(false)
      })
      .catch(() => {
        if (cancelled) return
        setError(true)
      })
    return () => {
      cancelled = true
    }
  }, [documentTypeParam, reloadKey])

  useEffect(() => {
    let cancelled = false
    void fetchDocumentTypes()
      .then((data) => {
        if (cancelled) return
        setDocumentTypes(data)
        setTypesError(false)
      })
      .catch(() => {
        if (cancelled) return
        setTypesError(true)
      })
    return () => {
      cancelled = true
    }
  }, [typesReloadKey])

  const retry = () => setReloadKey((key) => key + 1)

  return (
    <PageContainer title="Templates">
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <label className="flex items-center gap-2 text-sm text-slate-600">
            Document type
            <select
              aria-label="Filter by document type"
              value={documentTypeParam}
              onChange={(event) => applyParams({ document_type: event.target.value })}
              className={FIELD_INPUT_CLASS}
              disabled={templates === null || typesError || documentTypes === null}
            >
              <option value="">All document types</option>
              {(documentTypes ?? []).map((type) => (
                <option key={type.id} value={String(type.id)}>
                  {type.name}
                </option>
              ))}
            </select>
          </label>
          {typesError ? (
            <span className="text-sm text-slate-500">
              Couldn't load filter options.{' '}
              <button
                type="button"
                onClick={() => setTypesReloadKey((key) => key + 1)}
                className="font-medium text-slate-700 underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-slate-500"
              >
                Retry
              </button>
            </span>
          ) : null}
          <Link to="/templates/new" className={buttonClasses('primary')}>
            New template
          </Link>
        </div>

        {templates !== null && !error ? (
          <p className="text-sm text-slate-500" data-testid="templates-count">
            {templates.length} {templates.length === 1 ? 'template' : 'templates'}
          </p>
        ) : null}

        {error && (
          <div
            role="alert"
            className="rounded-md bg-red-50 px-4 py-3 text-sm text-red-700"
          >
            Couldn't load templates.
            <button
              type="button"
              onClick={retry}
              className="ml-3 font-medium text-slate-700 underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-slate-500"
            >
              Retry
            </button>
          </div>
        )}

        {templates === null && !error && (
          <p data-testid="templates-loading" className="animate-pulse text-sm text-slate-400">
            Loading…
          </p>
        )}

        {templates !== null && templates.length === 0 && !error && (
          <div className="rounded-lg border border-dashed border-slate-300 px-4 py-10 text-center">
            <p className="text-sm text-slate-500">No templates yet.</p>
            <Link
              to="/templates/new"
              className="mt-2 inline-block text-sm font-medium text-slate-700 underline"
            >
              Create your first template
            </Link>
          </div>
        )}

        {templates !== null && templates.length > 0 && !error && (
          <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-200 text-sm">
                <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th scope="col" className="px-4 py-2 font-medium">
                      Name
                    </th>
                    <th scope="col" className="px-4 py-2 font-medium">
                      Document type
                    </th>
                    <th scope="col" className="px-4 py-2 font-medium">
                      Status
                    </th>
                    <th scope="col" className="px-4 py-2 font-medium">
                      File
                    </th>
                    <th scope="col" className="px-4 py-2 font-medium">
                      Updated
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {templates.map((template) => {
                    const fileName = fileBaseName(template.file_name)
                    return (
                      <tr key={template.id} className="hover:bg-slate-50">
                        <td className="px-4 py-3">
                          <Link
                            to={`/templates/${template.id}`}
                            className="font-medium text-slate-900 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-slate-500"
                          >
                            {template.name || `Template #${template.id}`}
                          </Link>
                        </td>
                        <td className="px-4 py-3 text-slate-600">
                          {template.document_type_code || String(template.document_type)}
                        </td>
                        <td className="px-4 py-3 text-slate-600">
                          {template.is_active ? 'Active' : 'Inactive'}
                        </td>
                        <td className="px-4 py-3 text-slate-600">
                          {fileName ?? 'No file'}
                        </td>
                        <td className="px-4 py-3 text-slate-600">
                          {formatDate(template.updated_at)}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </PageContainer>
  )
}