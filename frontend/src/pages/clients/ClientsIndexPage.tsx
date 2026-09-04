import { useCallback, useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'

import { listClients } from '../../api/clients'
import { buttonClasses } from '../../components/ui/buttonClasses'
import { PageContainer } from '../../components/ui/PageContainer'
import { FIELD_INPUT_CLASS } from '../../components/ui/formClasses'
import type { ClientStatus, ClientSummary, ClientType } from '../../types/client'

const STATUS_OPTIONS: ReadonlyArray<ClientStatus> = ['active', 'inactive', 'archived']
const TYPE_OPTIONS: ReadonlyArray<ClientType> = ['individual', 'legal_entity']

/**
 * Client list backed by `GET /api/clients/`. Search and filters map directly
 * to the backend query parameters (`search`, `status`, `client_type`) and are
 * kept in the URL so back/forward and refreshes preserve the list state. The
 * backend returns a plain array (no pagination), so there are no page controls.
 */
export function ClientsIndexPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const search = searchParams.get('search') ?? ''
  const statusParam = searchParams.get('status') ?? ''
  const typeParam = searchParams.get('client_type') ?? ''

  const [clients, setClients] = useState<ClientSummary[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)

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
    // Short debounce so typing a search does not fire a request per keystroke.
    const timer = setTimeout(() => {
      setLoading(true)
      void listClients({
        search: search || undefined,
        status: (statusParam || undefined) as ClientStatus | undefined,
        client_type: (typeParam || undefined) as ClientType | undefined,
      })
        .then((data) => {
          if (cancelled) return
          setClients(data)
          setError(false)
        })
        .catch(() => {
          if (cancelled) return
          setError(true)
        })
        .finally(() => {
          if (cancelled) return
          setLoading(false)
        })
    }, 250)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [search, statusParam, typeParam, reloadKey])

  const retry = () => setReloadKey((key) => key + 1)

  return (
    <PageContainer title="Clients">
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2 text-sm text-slate-600">
              Search
              <input
                aria-label="Search clients"
                type="search"
                value={search}
                onChange={(event) => applyParams({ search: event.target.value }, true)}
                className={`${FIELD_INPUT_CLASS} w-56`}
              />
            </label>
            <label className="flex items-center gap-2 text-sm text-slate-600">
              Status
              <select
                aria-label="Filter by status"
                value={statusParam}
                onChange={(event) => applyParams({ status: event.target.value })}
                className={FIELD_INPUT_CLASS}
              >
                <option value="">All</option>
                {STATUS_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-2 text-sm text-slate-600">
              Type
              <select
                aria-label="Filter by client type"
                value={typeParam}
                onChange={(event) => applyParams({ client_type: event.target.value })}
                className={FIELD_INPUT_CLASS}
              >
                <option value="">All</option>
                {TYPE_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <Link to="/clients/new" className={buttonClasses('primary')}>
            New client
          </Link>
        </div>

        {clients !== null && !error ? (
          <p className="text-sm text-slate-500" data-testid="clients-count">
            {clients.length} {clients.length === 1 ? 'client' : 'clients'}
          </p>
        ) : null}

        {error && (
          <div
            role="alert"
            className="rounded-md bg-red-50 px-4 py-3 text-sm text-red-700"
          >
            Couldn't load clients.
            <button
              type="button"
              onClick={retry}
              className="ml-3 font-medium text-slate-700 underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-slate-500"
            >
              Retry
            </button>
          </div>
        )}

        {clients === null && loading && !error && (
          <p data-testid="clients-loading" className="animate-pulse text-sm text-slate-400">
            Loading…
          </p>
        )}

        {clients !== null && clients.length === 0 && !error && (
          <div className="rounded-lg border border-dashed border-slate-300 px-4 py-10 text-center">
            <p className="text-sm text-slate-500">No clients yet.</p>
            <Link to="/clients/new" className="mt-2 inline-block text-sm font-medium text-slate-700 underline">
              Create your first client
            </Link>
          </div>
        )}

        {clients !== null && clients.length > 0 && !error && (
          <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th scope="col" className="px-4 py-2 font-medium">
                    Name
                  </th>
                  <th scope="col" className="px-4 py-2 font-medium">
                    Type
                  </th>
                  <th scope="col" className="px-4 py-2 font-medium">
                    Status
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {clients.map((client) => (
                  <tr key={client.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3">
                      <Link
                        to={`/clients/${client.id}`}
                        className="font-medium text-slate-900 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-slate-500"
                      >
                        {client.display_name || `Client #${client.id}`}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-slate-600">{client.client_type}</td>
                    <td className="px-4 py-3 text-slate-600">{client.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </PageContainer>
  )
}