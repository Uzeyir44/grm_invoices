import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'

import { getTemplateVersion } from '../../api/templates'
import { Button } from '../../components/ui/Button'
import { PageContainer } from '../../components/ui/PageContainer'
import { ApiError, HTTP_STATUS } from '../../types/api'
import type { TemplateVersion } from '../../types/documentTemplate'

type State =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'rateLimited'; retryAfterSeconds: number | null }
  | { status: 'forbidden' }
  | { status: 'notfound' }
  | { status: 'ready'; data: TemplateVersion }

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
 * Read-only template version detail
 * (`GET /api/document-templates/:templateId/versions/:versionId/`).
 *
 * The backend returns the read-only `TemplateVersionSerializer`; the lookup
 * is tenant-scoped and constrained to the parent template, so a missing,
 * cross-tenant, or template-mismatched version renders the same safe
 * "not found" state. Versions are immutable history — this page issues no
 * PATCH/POST/DELETE and offers no file download (the backend exposes no
 * version-file download endpoint; only the template's current file is
 * downloadable from the template detail page).
 */
export function TemplateVersionDetailPage() {
  const { templateId, versionId } = useParams()
  const templateNumericId = Number(templateId)
  const versionNumericId = Number(versionId)
  const invalidIds = Number.isNaN(templateNumericId) || Number.isNaN(versionNumericId)

  const [state, setState] = useState<State>({ status: 'loading' })
  const [reloadKey, setReloadKey] = useState(0)

  // The route moved to a different template/version: drop the previous
  // version's state immediately so stale data is never shown for the new one.
  // (Render-phase adjustment for the new ids; the effect below refetches, and
  // its cancellation guard discards late responses.)
  const [idKey, setIdKey] = useState(`${templateId}/${versionId}`)
  if (idKey !== `${templateId}/${versionId}`) {
    setIdKey(`${templateId}/${versionId}`)
    setState({ status: 'loading' })
  }

  useEffect(() => {
    if (invalidIds) return
    // A stale in-flight response must never overwrite newer version state
    // when navigating rapidly between version routes.
    let cancelled = false
    void getTemplateVersion(templateNumericId, versionNumericId)
      .then((data) => {
        if (cancelled) return
        setState({ status: 'ready', data })
      })
      .catch((error: unknown) => {
        if (cancelled) return
        if (error instanceof ApiError && error.status === HTTP_STATUS.NOT_FOUND) {
          setState({ status: 'notfound' })
        } else if (error instanceof ApiError && error.status === HTTP_STATUS.FORBIDDEN) {
          setState({ status: 'forbidden' })
        } else if (error instanceof ApiError && error.status === HTTP_STATUS.TOO_MANY_REQUESTS) {
          setState({ status: 'rateLimited', retryAfterSeconds: error.retryAfterSeconds })
        } else {
          setState({ status: 'error' })
        }
      })
    return () => {
      cancelled = true
    }
  }, [invalidIds, templateNumericId, versionNumericId, reloadKey])

  function retry() {
    setState({ status: 'loading' })
    setReloadKey((key) => key + 1)
  }

  if (invalidIds) {
    return (
      <PageContainer title="Version">
        <div className="rounded-md bg-slate-50 px-4 py-3 text-sm text-slate-600">
          Version not found.
        </div>
        <Link to="/templates" className="text-sm text-slate-600 underline hover:text-slate-900">
          Back to templates
        </Link>
      </PageContainer>
    )
  }

  if (state.status === 'loading') {
    return (
      <PageContainer title="Version">
        <p data-testid="version-loading" className="animate-pulse text-sm text-slate-400">
          Loading…
        </p>
      </PageContainer>
    )
  }

  if (state.status === 'notfound') {
    return (
      <PageContainer title="Version">
        <div className="rounded-md bg-slate-50 px-4 py-3 text-sm text-slate-600">
          Version not found.
        </div>
        <Link
          to={`/templates/${templateNumericId}`}
          className="text-sm text-slate-600 underline hover:text-slate-900"
        >
          Back to template
        </Link>
      </PageContainer>
    )
  }

  if (state.status === 'forbidden') {
    return (
      <PageContainer title="Version">
        <div role="alert" className="rounded-md bg-red-50 px-4 py-3 text-sm text-red-700">
          You do not have permission to view this version.
        </div>
        <Link
          to={`/templates/${templateNumericId}`}
          className="text-sm text-slate-600 underline hover:text-slate-900"
        >
          Back to template
        </Link>
      </PageContainer>
    )
  }

  if (state.status === 'rateLimited') {
    return (
      <PageContainer title="Version">
        <div role="alert" className="rounded-md bg-red-50 px-4 py-3 text-sm text-red-700">
          {state.retryAfterSeconds !== null
            ? `Too many attempts. Please wait ${state.retryAfterSeconds} seconds and try again.`
            : 'Too many attempts. Please wait a moment and try again.'}
        </div>
        <Button variant="secondary" onClick={retry}>
          Retry
        </Button>
      </PageContainer>
    )
  }

  if (state.status === 'error') {
    return (
      <PageContainer title="Version">
        <div role="alert" className="rounded-md bg-red-50 px-4 py-3 text-sm text-red-700">
          Couldn't load the version.
        </div>
        <Button variant="secondary" onClick={retry}>
          Retry
        </Button>
      </PageContainer>
    )
  }

  const version = state.data
  const fileName = fileBaseName(version.file_name)

  return (
    <PageContainer title={`Version ${version.version_number}`}>
      <div className="space-y-4">
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          <Link
            to={`/templates/${version.template_id}`}
            className="text-sm text-slate-600 underline hover:text-slate-900"
          >
            Back to template
          </Link>
          <Link to="/templates" className="text-sm text-slate-600 underline hover:text-slate-900">
            Back to templates
          </Link>
        </div>

        <dl className="grid max-w-2xl gap-x-8 gap-y-2 text-sm sm:grid-cols-2">
          <div className="min-w-0">
            <dt className="text-slate-500">Version</dt>
            <dd className="break-words text-slate-900">v{version.version_number}</dd>
          </div>
          <div className="min-w-0">
            <dt className="text-slate-500">Status</dt>
            <dd className="break-words text-slate-900">
              {version.is_active ? 'Active' : 'Inactive'}
            </dd>
          </div>
          <div className="min-w-0">
            <dt className="text-slate-500">File</dt>
            <dd className="break-words text-slate-900">{fileName ?? 'No file'}</dd>
          </div>
          <div className="min-w-0">
            <dt className="text-slate-500">File stored</dt>
            <dd className="break-words text-slate-900">{version.has_file ? 'Yes' : 'No'}</dd>
          </div>
          <div className="min-w-0">
            <dt className="text-slate-500">Checksum</dt>
            <dd className="break-words text-slate-900">{version.checksum ?? '—'}</dd>
          </div>
          <div className="min-w-0">
            <dt className="text-slate-500">Created by</dt>
            <dd className="break-words text-slate-900">
              {version.created_by_id !== null ? `User #${version.created_by_id}` : '—'}
            </dd>
          </div>
          <div className="min-w-0">
            <dt className="text-slate-500">Created</dt>
            <dd className="break-words text-slate-900">{formatDate(version.created_at)}</dd>
          </div>
          <div className="min-w-0">
            <dt className="text-slate-500">Version ID</dt>
            <dd className="break-words text-slate-900">{version.id}</dd>
          </div>
          <div className="min-w-0">
            <dt className="text-slate-500">Template ID</dt>
            <dd className="break-words text-slate-900">{version.template_id}</dd>
          </div>
        </dl>

        <p className="max-w-2xl text-sm text-slate-500">
          Versions are immutable snapshots of the template file. File downloads and version
          management stay on the template detail page.
        </p>
      </div>
    </PageContainer>
  )
}
