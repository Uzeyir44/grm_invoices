import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'

import { deleteClient, getClient } from '../../api/clients'
import { Button } from '../../components/ui/Button'
import { buttonClasses } from '../../components/ui/buttonClasses'
import { PageContainer } from '../../components/ui/PageContainer'
import { ApiError, HTTP_STATUS } from '../../types/api'
import type { ClientDetail } from '../../types/client'
import { ClientAddressesSection } from './ClientAddressesSection'
import { ClientContactsSection } from './ClientContactsSection'

type State =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'forbidden' }
  | { status: 'notfound' }
  | { status: 'ready'; data: ClientDetail }

function formatDate(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return date.toISOString().slice(0, 10)
}

/**
 * Client detail (`GET /api/clients/:id/`). The backend intentionally returns
 * 404 for both nonexistent and cross-tenant clients, so both cases render the
 * same safe "not found" state. Deleting is a soft-delete backed by the real
 * `DELETE` endpoint and requires an explicit confirmation step. Addresses and
 * contacts are managed through the tenant-scoped nested endpoints in
 * {@link ClientAddressesSection} and {@link ClientContactsSection};
 * bank accounts remain a read-only nested display.
 */
export function ClientDetailPage() {
  const { clientId } = useParams()
  const id = Number(clientId)
  const navigate = useNavigate()

  const [state, setState] = useState<State>({ status: 'loading' })
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string>()

  const load = useCallback(() => {
    void getClient(id)
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

  async function handleDelete() {
    setDeleting(true)
    setDeleteError(undefined)
    try {
      await deleteClient(id)
      navigate('/clients')
    } catch (error) {
      setDeleteError(
        error instanceof ApiError
          ? error.message || 'Could not delete the client.'
          : 'Could not delete the client.',
      )
    } finally {
      setDeleting(false)
    }
  }

  if (state.status === 'loading') {
    return (
      <PageContainer title="Client">
        <p data-testid="client-loading" className="animate-pulse text-sm text-slate-400">
          Loading…
        </p>
      </PageContainer>
    )
  }

  if (state.status === 'notfound' || Number.isNaN(id)) {
    return (
      <PageContainer title="Client">
        <div className="rounded-md bg-slate-50 px-4 py-3 text-sm text-slate-600">
          Client not found.
        </div>
        <Link to="/clients" className="text-sm text-slate-600 underline hover:text-slate-900">
          Back to clients
        </Link>
      </PageContainer>
    )
  }

  if (state.status === 'forbidden') {
    return (
      <PageContainer title="Client">
        <div role="alert" className="rounded-md bg-red-50 px-4 py-3 text-sm text-red-700">
          You do not have permission to view this client.
        </div>
        <Link to="/clients" className="text-sm text-slate-600 underline hover:text-slate-900">
          Back to clients
        </Link>
      </PageContainer>
    )
  }

  if (state.status === 'error') {
    return (
      <PageContainer title="Client">
        <div role="alert" className="rounded-md bg-red-50 px-4 py-3 text-sm text-red-700">
          Couldn't load the client.
        </div>
        <Button variant="secondary" onClick={retry}>
          Retry
        </Button>
      </PageContainer>
    )
  }

  const client = state.data
  const legal = client.legal_entity
  const individual = client.individual
  const displayName =
    client.client_type === 'legal_entity'
      ? legal?.legal_name ?? `Client #${client.id}`
      : individual?.first_name && individual?.last_name
        ? `${individual.first_name} ${individual.last_name}`.trim()
        : `Client #${client.id}`

  return (
    <PageContainer title={displayName}>
      <div className="space-y-4">
        <Link to="/clients" className="text-sm text-slate-600 underline hover:text-slate-900">
          Back to clients
        </Link>

        <div className="flex flex-wrap items-center gap-3">
          <Link to={`/clients/${client.id}/edit`} className={buttonClasses('secondary')}>
            Edit
          </Link>
          {!confirmDelete ? (
            <Button variant="danger" onClick={() => setConfirmDelete(true)}>
              Delete client
            </Button>
          ) : (
            <span className="flex items-center gap-3 text-sm text-slate-700">
              Are you sure? This will deactivate the client.
              <Button variant="danger" loading={deleting} loadingLabel="Deleting…" onClick={handleDelete}>
                Yes, delete
              </Button>
              <Button
                variant="secondary"
                onClick={() => {
                  setConfirmDelete(false)
                  setDeleteError(undefined)
                }}
              >
                Cancel
              </Button>
            </span>
          )}
        </div>

        {deleteError ? (
          <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
            {deleteError}
          </p>
        ) : null}

        <dl className="grid max-w-2xl gap-x-8 gap-y-2 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-slate-500">Type</dt>
            <dd className="capitalize text-slate-900">{client.client_type}</dd>
          </div>
          <div>
            <dt className="text-slate-500">Status</dt>
            <dd className="text-slate-900">{client.status}</dd>
          </div>
          <div>
            <dt className="text-slate-500">Created</dt>
            <dd className="text-slate-900">{formatDate(client.created_at)}</dd>
          </div>
          {legal && (
            <>
              <div>
                <dt className="text-slate-500">Legal name</dt>
                <dd className="text-slate-900">{legal.legal_name}</dd>
              </div>
              <div>
                <dt className="text-slate-500">VOEN</dt>
                <dd className="text-slate-900">{legal.voen}</dd>
              </div>
              {legal.trading_name ? (
                <div>
                  <dt className="text-slate-500">Trading name</dt>
                  <dd className="text-slate-900">{legal.trading_name}</dd>
                </div>
              ) : null}
              {legal.registration_number ? (
                <div>
                  <dt className="text-slate-500">Registration number</dt>
                  <dd className="text-slate-900">{legal.registration_number}</dd>
                </div>
              ) : null}
              {legal.registration_date ? (
                <div>
                  <dt className="text-slate-500">Registration date</dt>
                  <dd className="text-slate-900">{legal.registration_date}</dd>
                </div>
              ) : null}
            </>
          )}
          {individual && (
            <>
              <div>
                <dt className="text-slate-500">Full name</dt>
                <dd className="text-slate-900">
                  {[individual.first_name, individual.middle_name, individual.last_name]
                    .filter(Boolean)
                    .join(' ') || `Client #${client.id}`}
                </dd>
              </div>
              {individual.date_of_birth ? (
                <div>
                  <dt className="text-slate-500">Date of birth</dt>
                  <dd className="text-slate-900">{individual.date_of_birth}</dd>
                </div>
              ) : null}
            </>
          )}
        </dl>

        <ClientContactsSection clientId={client.id} />

        <ClientAddressesSection clientId={client.id} />

        <section aria-label="Bank accounts">
          <h2 className="mb-1 text-sm font-semibold text-slate-700">Bank accounts</h2>
          {client.bank_accounts.length === 0 ? (
            <p className="text-sm text-slate-500">No bank accounts.</p>
          ) : (
            <ul className="divide-y divide-slate-200 rounded-lg border border-slate-200 bg-white text-sm">
              {client.bank_accounts.map((account) => (
                <li key={account.id} className="px-4 py-2 text-slate-700">
                  {account.bank_name ?? 'Bank'}
                  {` · ${account.iban}`}
                  {account.currency_code ? ` · ${account.currency_code}` : ''}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </PageContainer>
  )
}