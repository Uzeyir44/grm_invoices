import { useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'

import { listAuditLogs } from '../../api/auditLogs'
import { PageContainer } from '../../components/ui/PageContainer'
import { FIELD_INPUT_CLASS } from '../../components/ui/formClasses'
import { ApiError, HTTP_STATUS } from '../../types/api'
import type { PaginatedAuditLogs } from '../../types/auditLog'

/** Backend-supported filter keys (`AuditLogQuerySerializer` — the only accepted keys). */
const FILTER_KEYS = [
  'action',
  'entity_type',
  'entity_id',
  'user_id',
  'created_after',
  'created_before',
] as const

function parsePage(raw: string | null): number {
  const parsed = Number.parseInt(raw ?? '', 10)
  return Number.isFinite(parsed) && parsed >= 1 ? parsed : 1
}

function toOptionalInt(raw: string): number | undefined {
  if (!raw.trim()) return undefined
  const parsed = Number(raw)
  return Number.isFinite(parsed) ? Math.trunc(parsed) : undefined
}

/**
 * Deterministic UTC rendering (`YYYY-MM-DD HH:mm UTC`); falls back to raw
 * input. The backend stores UTC and the application displays UTC (via
 * `toISOString`), so the zone is labeled explicitly instead of silently
 * assumed.
 */
function formatTimestamp(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return `${date.toISOString().slice(0, 10)} ${date.toISOString().slice(11, 16)} UTC`
}

function formatUserId(userId: number | null): string {
  return userId === null ? '—' : `User #${userId}`
}

function errorMessage(error: ApiError): string {
  if (error.status === HTTP_STATUS.FORBIDDEN) {
    return 'You do not have permission to view audit logs.'
  }
  if (error.status === HTTP_STATUS.NOT_FOUND) {
    return 'The requested audit log page was not found.'
  }
  if (error.status === HTTP_STATUS.TOO_MANY_REQUESTS) {
    return error.retryAfterSeconds !== null
      ? `Too many requests. Please wait ${error.retryAfterSeconds} seconds and try again.`
      : 'Too many requests. Please wait a moment and try again.'
  }
  return error.message || "Couldn't load audit logs."
}

/**
 * Audit logs list backed by `GET /api/audit-logs/`. The backend returns a DRF
 * paginated envelope (`{ count, next, previous, results }`) ordered newest
 * first — this page renders that collection directly with Previous/Next
 * controls driven by the envelope's `next`/`previous` presence.
 *
 * Filtering maps 1:1 to the backend's `AuditLogQuerySerializer` (the only
 * accepted keys): exact-match `action` / `entity_type`, integer `entity_id` /
 * `user_id`, and the `created_after` (`>=`) / `created_before` (`<=`)
 * timestamp bounds. There is no backend free-text search and no ordering
 * parameter, so none is shown; action/entity options are free-form text
 * because the backend defines no fixed choices. Filters and the current page
 * live in the URL so refresh / back-forward preserve the list state; changing
 * a filter resets to page 1, while paging keeps the active filters.
 *
 * Read-only: no create/edit/delete/detail/export actions exist. The company is
 * always the authenticated user's company; no `company_id` is ever sent. The
 * backend remains the authoritative authorization boundary (a 403 renders a
 * safe access-denied state).
 */
export function AuditLogsIndexPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const page = parsePage(searchParams.get('page'))
  const actionFilter = searchParams.get('action') ?? ''
  const entityTypeFilter = searchParams.get('entity_type') ?? ''
  const entityIdFilter = searchParams.get('entity_id') ?? ''
  const userIdFilter = searchParams.get('user_id') ?? ''
  const createdAfterFilter = searchParams.get('created_after') ?? ''
  const createdBeforeFilter = searchParams.get('created_before') ?? ''

  const filtersActive =
    actionFilter !== '' ||
    entityTypeFilter !== '' ||
    entityIdFilter !== '' ||
    userIdFilter !== '' ||
    createdAfterFilter !== '' ||
    createdBeforeFilter !== ''

  // Identifies the exact backend query (filters + page) a completed request
  // was fetched for. Loading is derived during render (no completed request
  // or recorded failure for the current query/key yet), never set
  // synchronously in an effect.
  const querySignature = JSON.stringify({
    action: actionFilter,
    entity_type: entityTypeFilter,
    entity_id: entityIdFilter,
    user_id: userIdFilter,
    created_after: createdAfterFilter,
    created_before: createdBeforeFilter,
    page,
  })

  const [loaded, setLoaded] = useState<{
    query: string
    key: number
    body: PaginatedAuditLogs
  } | null>(null)
  const [failed, setFailed] = useState<{
    query: string
    key: number
    error: ApiError
  } | null>(null)
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    let cancelled = false
    // Short debounce so typing a filter does not fire a request per keystroke.
    const timer = setTimeout(() => {
      const entityId = toOptionalInt(entityIdFilter)
      const userId = toOptionalInt(userIdFilter)
      void listAuditLogs({
        ...(page > 1 ? { page } : {}),
        ...(actionFilter.trim() ? { action: actionFilter.trim() } : {}),
        ...(entityTypeFilter.trim() ? { entity_type: entityTypeFilter.trim() } : {}),
        ...(entityId !== undefined ? { entity_id: entityId } : {}),
        ...(userId !== undefined ? { user_id: userId } : {}),
        ...(createdAfterFilter ? { created_after: createdAfterFilter } : {}),
        ...(createdBeforeFilter ? { created_before: createdBeforeFilter } : {}),
      })
        .then((response) => {
          if (cancelled) return
          setLoaded({ query: querySignature, key: reloadKey, body: response })
        })
        .catch((caught: unknown) => {
          if (cancelled) return
          setFailed({
            query: querySignature,
            key: reloadKey,
            error:
              caught instanceof ApiError
                ? caught
                : new ApiError({
                    status: 0,
                    payload: null,
                    message: "Couldn't load audit logs.",
                  }),
          })
        })
    }, 250)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [
    actionFilter,
    entityTypeFilter,
    entityIdFilter,
    userIdFilter,
    createdAfterFilter,
    createdBeforeFilter,
    page,
    querySignature,
    reloadKey,
  ])

  const isCurrent = (entry: { query: string; key: number } | null): boolean =>
    entry !== null && entry.query === querySignature && entry.key === reloadKey
  // Data for the current query/key, if its request has completed.
  const current = isCurrent(loaded) ? loaded?.body ?? null : null
  const error = isCurrent(failed) ? (failed?.error ?? null) : null
  const loading = current === null && error === null
  // Latest known data (stale during a filter/page change) so the previous
  // real rows stay visible with an inline loading indicator — never replaced
  // by fabricated rows.
  const visible = current ?? loaded?.body ?? null

  /** Update filter params in the URL; any filter change resets to page 1. */
  const applyFilters = useCallback(
    (updates: Record<string, string>, replace = false) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev)
          for (const [key, value] of Object.entries(updates)) {
            if (value) next.set(key, value)
            else next.delete(key)
          }
          next.delete('page')
          return next
        },
        replace ? { replace: true } : undefined,
      )
    },
    [setSearchParams],
  )

  const goToPage = (nextPage: number) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev)
      if (nextPage <= 1) next.delete('page')
      else next.set('page', String(nextPage))
      return next
    })
  }

  const clearFilters = () => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev)
      for (const key of FILTER_KEYS) next.delete(key)
      next.delete('page')
      return next
    })
  }

  const retry = () => setReloadKey((key) => key + 1)
  const backToFirstPage = () => goToPage(1)

  const results = visible?.results ?? []
  const showInitialLoading = loading && visible === null
  const showPageChanging = loading && visible !== null

  return (
    <PageContainer title="Audit logs">
      <div className="space-y-4">
        <form
          aria-label="Filter audit logs"
          onSubmit={(event) => event.preventDefault()}
          className="flex flex-wrap items-end gap-3"
        >
          <label className="flex flex-col gap-1 text-sm text-slate-600">
            Action
            <input
              aria-label="Filter by action"
              type="text"
              value={actionFilter}
              onChange={(event) => applyFilters({ action: event.target.value }, true)}
              placeholder="client.created"
              className={`${FIELD_INPUT_CLASS} w-44`}
            />
          </label>
          <label className="flex flex-col gap-1 text-sm text-slate-600">
            Entity type
            <input
              aria-label="Filter by entity type"
              type="text"
              value={entityTypeFilter}
              onChange={(event) => applyFilters({ entity_type: event.target.value }, true)}
              placeholder="client"
              className={`${FIELD_INPUT_CLASS} w-44`}
            />
          </label>
          <label className="flex flex-col gap-1 text-sm text-slate-600">
            Entity ID
            <input
              aria-label="Filter by entity ID"
              type="number"
              value={entityIdFilter}
              onChange={(event) => applyFilters({ entity_id: event.target.value })}
              className={`${FIELD_INPUT_CLASS} w-32`}
            />
          </label>
          <label className="flex flex-col gap-1 text-sm text-slate-600">
            User ID
            <input
              aria-label="Filter by user ID"
              type="number"
              value={userIdFilter}
              onChange={(event) => applyFilters({ user_id: event.target.value })}
              className={`${FIELD_INPUT_CLASS} w-32`}
            />
          </label>
          <label className="flex flex-col gap-1 text-sm text-slate-600">
            Created after
            <input
              aria-label="Filter by earliest timestamp"
              type="datetime-local"
              value={createdAfterFilter}
              onChange={(event) => applyFilters({ created_after: event.target.value })}
              className={`${FIELD_INPUT_CLASS} w-52`}
            />
          </label>
          <label className="flex flex-col gap-1 text-sm text-slate-600">
            Created before
            <input
              aria-label="Filter by latest timestamp"
              type="datetime-local"
              value={createdBeforeFilter}
              onChange={(event) => applyFilters({ created_before: event.target.value })}
              className={`${FIELD_INPUT_CLASS} w-52`}
            />
          </label>
          {filtersActive ? (
            <button
              type="button"
              onClick={clearFilters}
              className="rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-slate-500"
            >
              Clear filters
            </button>
          ) : null}
        </form>
        <p className="text-xs text-slate-500">
          Action and entity type match exactly; the timestamps bound the record
          time.
        </p>

        {visible !== null && error === null ? (
          <p className="text-sm text-slate-500" data-testid="audit-logs-count">
            {visible.count} {visible.count === 1 ? 'audit log' : 'audit logs'}
          </p>
        ) : null}

        {error && (
          <div
            role="alert"
            className="rounded-md bg-red-50 px-4 py-3 text-sm text-red-700"
          >
            {errorMessage(error)}
            {error.status === HTTP_STATUS.NOT_FOUND && page > 1 ? (
              <button
                type="button"
                onClick={backToFirstPage}
                className="ml-3 font-medium text-slate-700 underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-slate-500"
              >
                Back to first page
              </button>
            ) : null}
            <button
              type="button"
              onClick={retry}
              className="ml-3 font-medium text-slate-700 underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-slate-500"
            >
              Retry
            </button>
          </div>
        )}

        {showInitialLoading && (
          <p
            role="status"
            data-testid="audit-logs-loading"
            className="animate-pulse text-sm text-slate-400"
          >
            Loading…
          </p>
        )}

        {visible !== null && results.length === 0 && error === null && (
          <div className="rounded-lg border border-dashed border-slate-300 px-4 py-10 text-center">
            {filtersActive ? (
              <>
                <p className="text-sm text-slate-500">No audit logs match your filters.</p>
                <button
                  type="button"
                  onClick={clearFilters}
                  className="mt-2 text-sm font-medium text-slate-700 underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-slate-500"
                >
                  Clear filters
                </button>
              </>
            ) : (
              <p className="text-sm text-slate-500">No audit logs found.</p>
            )}
          </div>
        )}

        {visible !== null && results.length > 0 && error === null && (
          <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-200 text-sm">
                <caption className="sr-only">
                  Audit logs, newest first. Timestamps are in UTC.
                </caption>
                <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th scope="col" className="px-4 py-2 font-medium">
                      Timestamp
                    </th>
                    <th scope="col" className="px-4 py-2 font-medium">
                      Action
                    </th>
                    <th scope="col" className="px-4 py-2 font-medium">
                      Entity
                    </th>
                    <th scope="col" className="px-4 py-2 font-medium">
                      User
                    </th>
                    <th scope="col" className="px-4 py-2 font-medium">
                      IP address
                    </th>
                    <th scope="col" className="px-4 py-2 font-medium">
                      Request ID
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {results.map((log) => (
                    <tr key={log.id} className="hover:bg-slate-50">
                      <td className="whitespace-nowrap px-4 py-3 text-slate-600">
                        {formatTimestamp(log.created_at)}
                      </td>
                      <td className="px-4 py-3 font-medium text-slate-900">{log.action}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-slate-600">
                        {log.entity_type} #{log.entity_id}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-slate-600">
                        {formatUserId(log.user_id)}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-slate-600">
                        {log.ip_address ?? '—'}
                      </td>
                      <td
                        className="max-w-48 truncate px-4 py-3 text-slate-600"
                        title={log.request_id ?? undefined}
                      >
                        {log.request_id ?? '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {visible !== null && error === null && (visible.next !== null || visible.previous !== null) ? (
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => goToPage(page - 1)}
              disabled={visible.previous === null || loading}
              className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-slate-500 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Previous
            </button>
            <p className="text-sm text-slate-500" data-testid="audit-logs-page">
              Page {page}
            </p>
            <button
              type="button"
              onClick={() => goToPage(page + 1)}
              disabled={visible.next === null || loading}
              className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-slate-500 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Next
            </button>
            {showPageChanging ? (
              <p
                role="status"
                data-testid="audit-logs-page-loading"
                className="animate-pulse text-sm text-slate-400"
              >
                Loading…
              </p>
            ) : null}
          </div>
        ) : null}
      </div>
    </PageContainer>
  )
}
