import { useCallback, useEffect, useState } from 'react'
import { Link, useLocation, useParams } from 'react-router-dom'

import {
  activateAdminCompany,
  deactivateAdminCompany,
  getAdminCompany,
} from '../../api/adminCompanies'
import { Button } from '../../components/ui/Button'
import { buttonClasses } from '../../components/ui/buttonClasses'
import { CompanyStatusBadge } from '../../components/ui/CompanyStatusBadge'
import { PageContainer } from '../../components/ui/PageContainer'
import { ApiError, HTTP_STATUS } from '../../types/api'
import type { AdminCompany } from '../../types/adminCompany'

function formatDateTime(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return date.toISOString().replace('T', ' ').slice(0, 16) + ' UTC'
}

function actionErrorMessage(error: unknown, action: 'load' | 'activate' | 'deactivate'): string {
  if (!(error instanceof ApiError)) {
    return 'The request failed. Please try again.'
  }
  if (error.status === HTTP_STATUS.FORBIDDEN) {
    return 'You do not have permission to manage companies.'
  }
  if (error.status === HTTP_STATUS.NOT_FOUND) {
    return 'Company not found. It may have been removed.'
  }
  if (error.status === HTTP_STATUS.TOO_MANY_REQUESTS) {
    return error.retryAfterSeconds !== null
      ? `Too many attempts. Please wait ${error.retryAfterSeconds} seconds and try again.`
      : 'Too many attempts. Please wait a moment and try again.'
  }
  return action === 'load'
    ? "Couldn't load the company."
    : 'The status change failed. Please try again.'
}

/**
 * Company detail (`GET /api/admin/companies/:id/`) with the supported
 * lifecycle action (activate/deactivate). Status transitions are never
 * inferred on the client — the backend response is authoritative.
 */
export function AdminCompanyDetailPage() {
  const { companyId } = useParams()
  const id = Number(companyId)
  const location = useLocation()

  const [company, setCompany] = useState<AdminCompany | null>(null)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [loadError, setLoadError] = useState<string>()
  const [reloadKey, setReloadKey] = useState(0)

  const [confirming, setConfirming] = useState(false)
  const [actionPending, setActionPending] = useState(false)
  const [actionError, setActionError] = useState<string>()

  const provisioned = Boolean(
    (location.state as { companyProvisioned?: boolean } | null)?.companyProvisioned,
  )
  const updated = Boolean(
    (location.state as { companyUpdated?: boolean } | null)?.companyUpdated,
  )

  useEffect(() => {
    if (Number.isNaN(id)) return
    let cancelled = false
    void getAdminCompany(id)
      .then((data) => {
        if (cancelled) return
        setCompany(data)
        setNotFound(false)
        setLoadError(undefined)
      })
      .catch((error: unknown) => {
        if (cancelled) return
        if (error instanceof ApiError && error.status === HTTP_STATUS.NOT_FOUND) {
          setNotFound(true)
        } else {
          setLoadError(actionErrorMessage(error, 'load'))
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [id, reloadKey])

  const retry = useCallback(() => {
    setLoading(true)
    setLoadError(undefined)
    setReloadKey((key) => key + 1)
  }, [])

  async function runStatusAction(next: 'activate' | 'deactivate') {
    if (actionPending) return
    setActionPending(true)
    setActionError(undefined)
    try {
      const updatedCompany =
        next === 'activate'
          ? await activateAdminCompany(id)
          : await deactivateAdminCompany(id)
      setCompany(updatedCompany)
      setConfirming(false)
    } catch (error) {
      setActionError(actionErrorMessage(error, next))
      setConfirming(false)
    } finally {
      setActionPending(false)
    }
  }

  if (notFound || Number.isNaN(id)) {
    return (
      <PageContainer title="Company">
        <p className="text-sm text-slate-600">Company not found.</p>
        <Link
          to="/admin/companies"
          className="text-sm text-slate-600 underline hover:text-slate-900"
        >
          Back to companies
        </Link>
      </PageContainer>
    )
  }

  if (loading) {
    return (
      <PageContainer title="Company">
        <p
          data-testid="admin-company-detail-loading"
          className="animate-pulse text-sm text-slate-400"
        >
          Loading company…
        </p>
      </PageContainer>
    )
  }

  if (loadError || company === null) {
    return (
      <PageContainer title="Company">
        <div
          role="alert"
          className="rounded-md bg-red-50 px-4 py-3 text-sm text-red-700"
        >
          {loadError ?? "Couldn't load the company."}
        </div>
        <div className="mt-2 flex items-center gap-3">
          <Button variant="secondary" onClick={retry}>
            Retry
          </Button>
          <Link
            to="/admin/companies"
            className="text-sm text-slate-600 underline hover:text-slate-900"
          >
            Back to companies
          </Link>
        </div>
      </PageContainer>
    )
  }

  return (
    <PageContainer title={company.display_name}>
      <div className="max-w-3xl space-y-4">
        {provisioned ? (
          <p
            role="status"
            className="rounded-md bg-emerald-50 px-4 py-3 text-sm text-emerald-800"
          >
            Company provisioned successfully.
          </p>
        ) : null}
        {updated ? (
          <p
            role="status"
            className="rounded-md bg-emerald-50 px-4 py-3 text-sm text-emerald-800"
          >
            Company updated.
          </p>
        ) : null}

        <div className="flex flex-wrap items-center gap-2">
          <CompanyStatusBadge status={company.status} />
          <span className="text-sm text-slate-600">
            {company.is_platform ? 'Platform company' : 'Tenant company'}
          </span>
        </div>

        <dl className="grid gap-x-8 gap-y-3 rounded-lg border border-slate-200 bg-white p-6 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-slate-500">Company ID</dt>
            <dd className="font-mono text-slate-900">{company.id}</dd>
          </div>
          <div>
            <dt className="text-slate-500">Legal name</dt>
            <dd className="break-words text-slate-900">{company.legal_name}</dd>
          </div>
          <div>
            <dt className="text-slate-500">Display name</dt>
            <dd className="break-words text-slate-900">{company.display_name}</dd>
          </div>
          <div>
            <dt className="text-slate-500">VOEN</dt>
            <dd className="break-words text-slate-900">{company.voen ?? '—'}</dd>
          </div>
          <div>
            <dt className="text-slate-500">Registration number</dt>
            <dd className="break-words text-slate-900">
              {company.registration_number ?? '—'}
            </dd>
          </div>
          <div>
            <dt className="text-slate-500">Default language</dt>
            <dd className="break-words text-slate-900">{company.default_language}</dd>
          </div>
          <div>
            <dt className="text-slate-500">Default timezone</dt>
            <dd className="break-words text-slate-900">{company.default_timezone}</dd>
          </div>
          <div>
            <dt className="text-slate-500">Created</dt>
            <dd className="break-words text-slate-900">
              {formatDateTime(company.created_at)}
            </dd>
          </div>
          <div>
            <dt className="text-slate-500">Updated</dt>
            <dd className="break-words text-slate-900">
              {formatDateTime(company.updated_at)}
            </dd>
          </div>
        </dl>

        {company.is_platform ? (
          <p className="rounded-md bg-slate-50 px-4 py-3 text-sm text-slate-600">
            The platform company is reserved for System Admin accounts and
            cannot be edited or deactivated.
          </p>
        ) : (
          <div className="space-y-3 rounded-lg border border-slate-200 bg-white p-6">
            <h2 className="text-sm font-semibold text-slate-700">Management</h2>

            {actionError ? (
              <p
                role="alert"
                className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700"
              >
                {actionError}
              </p>
            ) : null}

            <div className="flex flex-wrap items-center gap-3">
              <Link
                to={`/admin/companies/${company.id}/edit`}
                className={buttonClasses('secondary')}
              >
                Edit metadata
              </Link>

              {company.status === 'active' ? (
                !confirming ? (
                  <Button
                    variant="danger"
                    onClick={() => setConfirming(true)}
                    disabled={actionPending}
                  >
                    Deactivate
                  </Button>
                ) : (
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="text-sm text-slate-700">
                      Suspend this company?
                    </span>
                    <Button
                      variant="danger"
                      loading={actionPending}
                      loadingLabel="Deactivating…"
                      onClick={() => {
                        void runStatusAction('deactivate')
                      }}
                    >
                      Yes, deactivate
                    </Button>
                    <Button
                      variant="secondary"
                      onClick={() => setConfirming(false)}
                      disabled={actionPending}
                    >
                      Cancel
                    </Button>
                  </span>
                )
              ) : (
                <Button
                  loading={actionPending}
                  loadingLabel="Activating…"
                  onClick={() => {
                    void runStatusAction('activate')
                  }}
                >
                  Activate
                </Button>
              )}
            </div>
          </div>
        )}

        <Link
          to="/admin/companies"
          className="inline-block text-sm text-slate-600 underline hover:text-slate-900"
        >
          Back to companies
        </Link>
      </div>
    </PageContainer>
  )
}
