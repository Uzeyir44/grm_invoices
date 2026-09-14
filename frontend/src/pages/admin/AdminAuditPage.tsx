import { Fragment, useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'

import { listAdminAuditLogs } from '../../api/adminAudit'
import { PageContainer } from '../../components/ui/PageContainer'
import { FIELD_INPUT_CLASS } from '../../components/ui/formClasses'
import { ApiError, HTTP_STATUS } from '../../types/api'
import type { PaginatedAdminAuditLogs } from '../../types/adminAudit'

/** Backend-supported filter keys (`AdminAuditLogQuerySerializer`). */
const FILTER_KEYS = [
  'action',
  'entity_type',
  'entity_id',
  'user_id',
  'target_company_id',
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

function formatTimestamp(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return `${date.toISOString().slice(0, 10)} ${date.toISOString().slice(11, 16)} UTC`
}

function formatActor(userId: number | null, userName: string | null): string {
  if (userName) return userId === null ? userName : `${userName} (User #${userId})`
  return userId === null ? '—' : `User #${userId}`
}

function formatEntity(entityType: string, entityId: number, entityName: string | null): string {
  return entityName ? `${entityName} (${entityType} #${entityId})` : `${entityType} #${entityId}`
}

function formatTargetCompany(
  targetId: number | null,
  targetName: string | null,
): string {
  if (targetId === null) return '—'
  return targetName ? `${targetName} (Company #${targetId})` : `Company #${targetId}`
}

function errorMessage(error: ApiError): string {
  if (error.status === HTTP_STATUS.FORBIDDEN) {
    return 'You do not have permission to view platform audit records.'
  }
  if (error.status === HTTP_STATUS.NOT_FOUND) {
    return 'The requested audit page was not found.'
  }
  if (error.status === HTTP_STATUS.TOO_MANY_REQUESTS) {
    return error.retryAfterSeconds !== null
      ? `Too many requests. Please wait ${error.retryAfterSeconds} seconds and try again.`
      : 'Too many requests. Please wait a moment and try again.'
  }
  return error.message || "Couldn't load audit records."
}

function DetailsPayload({
  previous,
  next,
}: {
  previous: Record<string, unknown> | null
  next: Record<string, unknown> | null
}) {
  if (!previous && !next) {
    return <p className="text-xs text-slate-500">No payload recorded.</p>
  }
  return (
    <dl className="grid gap-3 sm:grid-cols-2">
      <div>
        <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">
          Previous values
        </dt>
        <dd>
          <pre className="mt-1 max-h-60 overflow-auto rounded bg-slate-50 p-2 text-xs text-slate-700">
            {previous ? JSON.stringify(previous, null, 2) : '—'}
          </pre>
        </dd>
      </div>
      <div>
        <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">
          New values
        </dt>
        <dd>
          <pre className="mt-1 max-h-60 overflow-auto rounded bg-slate-50 p-2 text-xs text-slate-700">
            {next ? JSON.stringify(next, null, 2) : '—'}
          </pre>
        </dd>
      </div>
    </dl>
  )
}

/**
 * System Admin platform audit (`GET /api/admin/audit/`).
 *
 * Read-only investigation of platform audit activity (System Admin actions,
 * company/user/role/reference-data administration). Platform audit records are
 * globally scoped and distinct from the tenant `/audit-logs` page; tenant audit
 * rows are never shown here. Filters map 1:1 to the backend query serializer and
 * live in the URL; pagination follows the backend envelope.
 */
export function AdminAuditPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const page = parsePage(searchParams.get('page'))
  const actionFilter = searchParams.get('action') ?? ''
  const entityTypeFilter = searchParams.get('entity_type') ?? ''
  const entityIdFilter = searchParams.get('entity_id') ?? ''
  const userIdFilter = searchParams.get('user_id') ?? ''
  const targetCompanyFilter = searchParams.get('target_company_id') ?? ''
  const createdAfterFilter = searchParams.get('created_after') ?? ''
  const createdBeforeFilter = searchParams.get('created_before') ?? ''

  const filtersActive =
    actionFilter !== '' ||
    entityTypeFilter !== '' ||
    entityIdFilter !== '' ||
    userIdFilter !== '' ||
    targetCompanyFilter !== '' ||
    createdAfterFilter !== '' ||
    createdBeforeFilter !== ''

  const querySignature = JSON.stringify({
    action: actionFilter,
    entity_type: entityTypeFilter,
    entity_id: entityIdFilter,
    user_id: userIdFilter,
    target_company_id: targetCompanyFilter,
    created_after: createdAfterFilter,
    created_before: createdBeforeFilter,
    page,
  })

  const [loaded, setLoaded] = useState<{
    query: string
    key: number
    body: PaginatedAdminAuditLogs
  } | null>(null)
  const [failed, setFailed] = useState<{
    query: string
    key: number
    error: ApiError
  } | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const [expandedId, setExpandedId] = useState<number | null>(null)

  useEffect(() => {
    let cancelled = false
    const timer = setTimeout(() => {
      const entityId = toOptionalInt(entityIdFilter)
      const userId = toOptionalInt(userIdFilter)
      const targetCompanyId = toOptionalInt(targetCompanyFilter)
      void listAdminAuditLogs({
        ...(page > 1 ? { page } : {}),
        ...(actionFilter.trim() ? { action: actionFilter.trim() } : {}),
        ...(entityTypeFilter.trim() ? { entity_type: entityTypeFilter.trim() } : {}),
        ...(entityId !== undefined ? { entity_id: entityId } : {}),
        ...(userId !== undefined ? { user_id: userId } : {}),
        ...(targetCompanyId !== undefined
          ? { target_company_id: targetCompanyId }
          : {}),
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
                    message: "Couldn't load audit records.",
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
    targetCompanyFilter,
    createdAfterFilter,
    createdBeforeFilter,
    page,
    querySignature,
    reloadKey,
  ])

  const isCurrent = (entry: { query: string; key: number } | null): boolean =>
    entry !== null && entry.query === querySignature && entry.key === reloadKey
  const current = isCurrent(loaded) ? loaded?.body ?? null : null
  const error = isCurrent(failed) ? (failed?.error ?? null) : null
  const loading = current === null && error === null
  const visible = current ?? loaded?.body ?? null

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
    <PageContainer title="Audit & Security">
      <div className="space-y-4">
        <p className="text-sm text-slate-500">
          Platform-wide audit activity (read-only). Records are immutable
          evidence and cannot be edited or deleted here.
        </p>

        <form
          aria-label="Filter platform audit"
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
              placeholder="company.provision"
              className={`${FIELD_INPUT_CLASS} w-48`}
            />
          </label>
          <label className="flex flex-col gap-1 text-sm text-slate-600">
            Entity type
            <input
              aria-label="Filter by entity type"
              type="text"
              value={entityTypeFilter}
              onChange={(event) => applyFilters({ entity_type: event.target.value }, true)}
              placeholder="company"
              className={`${FIELD_INPUT_CLASS} w-40`}
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
            Target company ID
            <input
              aria-label="Filter by target company ID"
              type="number"
              value={targetCompanyFilter}
              onChange={(event) =>
                applyFilters({ target_company_id: event.target.value })
              }
              className={`${FIELD_INPUT_CLASS} w-40`}
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
              className="rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-500"
            >
              Clear filters
            </button>
          ) : null}
        </form>
        <p className="text-xs text-slate-500">
          Action and entity type match exactly; target company matches platform
          events whose payload records that company. Timestamps are UTC.
        </p>

        {visible !== null && error === null ? (
          <p className="text-sm text-slate-500" data-testid="admin-audit-count">
            {visible.count} {visible.count === 1 ? 'event' : 'events'}
          </p>
        ) : null}

        {error ? (
          <div
            role="alert"
            className="rounded-md bg-red-50 px-4 py-3 text-sm text-red-700"
          >
            {errorMessage(error)}
            {error.status === HTTP_STATUS.NOT_FOUND && page > 1 ? (
              <button
                type="button"
                onClick={backToFirstPage}
                className="ml-3 font-medium underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-500"
              >
                Back to first page
              </button>
            ) : null}
            <button
              type="button"
              onClick={retry}
              className="ml-3 font-medium underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-500"
            >
              Retry
            </button>
          </div>
        ) : null}

        {showInitialLoading ? (
          <p
            role="status"
            data-testid="admin-audit-loading"
            className="animate-pulse text-sm text-slate-400"
          >
            Loading…
          </p>
        ) : null}

        {visible !== null && results.length === 0 && error === null ? (
          <div className="rounded-lg border border-dashed border-slate-300 px-4 py-10 text-center">
            {filtersActive ? (
              <>
                <p className="text-sm text-slate-500">
                  No audit events match your filters.
                </p>
                <button
                  type="button"
                  onClick={clearFilters}
                  className="mt-2 text-sm font-medium text-slate-700 underline"
                >
                  Clear filters
                </button>
              </>
            ) : (
              <p className="text-sm text-slate-500">No platform audit events yet.</p>
            )}
          </div>
        ) : null}

        {visible !== null && results.length > 0 && error === null ? (
          <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-200 text-sm">
                <caption className="sr-only">
                  Platform audit events, newest first. Timestamps are in UTC.
                </caption>
                <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th scope="col" className="px-4 py-2 font-medium">
                      Timestamp
                    </th>
                    <th scope="col" className="px-4 py-2 font-medium">
                      Actor
                    </th>
                    <th scope="col" className="px-4 py-2 font-medium">
                      Action
                    </th>
                    <th scope="col" className="px-4 py-2 font-medium">
                      Entity
                    </th>
                    <th scope="col" className="px-4 py-2 font-medium">
                      Target company
                    </th>
                    <th scope="col" className="px-4 py-2 font-medium">
                      IP address
                    </th>
                    <th scope="col" className="px-4 py-2 font-medium">
                      Details
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {results.map((log) => (
                    <Fragment key={log.id}>
                      <tr className="hover:bg-slate-50">
                        <td className="whitespace-nowrap px-4 py-3 text-slate-600">
                          {formatTimestamp(log.created_at)}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-slate-600">
                          {formatActor(log.user_id, log.user_name)}
                        </td>
                        <td className="px-4 py-3 font-medium text-slate-900">
                          {log.action}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-slate-600">
                          {formatEntity(log.entity_type, log.entity_id, log.entity_name)}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-slate-600">
                          {formatTargetCompany(
                            log.target_company_id,
                            log.target_company_name,
                          )}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-slate-600">
                          {log.ip_address ?? '—'}
                        </td>
                        <td className="px-4 py-3">
                          <button
                            type="button"
                            aria-expanded={expandedId === log.id}
                            onClick={() =>
                              setExpandedId((prev) =>
                                prev === log.id ? null : log.id,
                              )
                            }
                            className="text-sm text-slate-700 underline hover:text-slate-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-500"
                          >
                            {expandedId === log.id ? 'Hide' : 'View'}
                          </button>
                        </td>
                      </tr>
                      {expandedId === log.id ? (
                        <tr className="bg-slate-50">
                          <td colSpan={7} className="px-4 py-3">
                            <DetailsPayload
                              previous={log.previous_values}
                              next={log.new_values}
                            />
                          </td>
                        </tr>
                      ) : null}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}

        {visible !== null &&
        error === null &&
        (visible.next !== null || visible.previous !== null) ? (
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => goToPage(page - 1)}
              disabled={visible.previous === null || loading}
              className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-500 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Previous
            </button>
            <p className="text-sm text-slate-500" data-testid="admin-audit-page">
              Page {page}
            </p>
            <button
              type="button"
              onClick={() => goToPage(page + 1)}
              disabled={visible.next === null || loading}
              className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-500 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Next
            </button>
            {showPageChanging ? (
              <p
                role="status"
                data-testid="admin-audit-page-loading"
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
