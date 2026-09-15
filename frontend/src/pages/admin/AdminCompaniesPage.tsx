import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'

import { listAdminCompanies } from '../../api/adminCompanies'
import { buttonClasses } from '../../components/ui/buttonClasses'
import { CompanyStatusBadge } from '../../components/ui/CompanyStatusBadge'
import { PageContainer } from '../../components/ui/PageContainer'
import { useAdminAuth } from '../../contexts/admin-auth-context'
import type { AdminCompany } from '../../types/adminCompany'

function formatDate(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return date.toISOString().slice(0, 10)
}

/**
 * Admin company list (`GET /api/admin/companies/`).
 *
 * Loading / empty / error+retry states, real API data only (no fabricated
 * counts), responsive table with a link to each company's detail page.
 */
export function AdminCompaniesPage() {
  const { hasPermission } = useAdminAuth()
  const canManage = hasPermission('system.companies.manage')

  const [companies, setCompanies] = useState<AdminCompany[] | null>(null)
  const [error, setError] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    let cancelled = false
    void listAdminCompanies()
      .then((data) => {
        if (cancelled) return
        setCompanies(Array.isArray(data) ? data : [])
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

  const retry = useCallback(() => setReloadKey((key) => key + 1), [])

  return (
    <PageContainer title="Companies">
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-slate-500">
            {companies !== null && !error
              ? `${companies.length} ${companies.length === 1 ? 'company' : 'companies'}`
              : null}
          </p>
          {canManage ? (
            <Link to="/admin/companies/new" className={buttonClasses('primary')}>
              New company
            </Link>
          ) : null}
        </div>

        {error ? (
          <div
            role="alert"
            className="rounded-md bg-red-50 px-4 py-3 text-sm text-red-700"
          >
            Couldn't load companies.
            <button
              type="button"
              onClick={retry}
              className="ml-3 font-medium underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-500"
            >
              Retry
            </button>
          </div>
        ) : null}

        {companies === null && !error ? (
          <p
            data-testid="admin-companies-loading"
            className="animate-pulse text-sm text-slate-400"
          >
            Loading companies…
          </p>
        ) : null}

        {companies !== null && companies.length === 0 && !error ? (
          <div className="rounded-lg border border-dashed border-slate-300 px-4 py-10 text-center">
            <p className="text-sm text-slate-500">No companies yet.</p>
            {canManage ? (
              <Link
                to="/admin/companies/new"
                className="mt-2 inline-block text-sm font-medium underline"
              >
                Provision the first company
              </Link>
            ) : null}
          </div>
        ) : null}

        {companies !== null && companies.length > 0 && !error ? (
          <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-200 text-sm">
                <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th scope="col" className="px-4 py-2 font-medium">
                      ID
                    </th>
                    <th scope="col" className="px-4 py-2 font-medium">
                      Company
                    </th>
                    <th scope="col" className="px-4 py-2 font-medium">
                      VOEN
                    </th>
                    <th scope="col" className="px-4 py-2 font-medium">
                      Status
                    </th>
                    <th scope="col" className="px-4 py-2 font-medium">
                      Type
                    </th>
                    <th scope="col" className="px-4 py-2 font-medium">
                      Created
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {companies.map((company) => (
                    <tr key={company.id} className="hover:bg-slate-50">
                      <td className="px-4 py-3 font-mono text-xs text-slate-600">
                        {company.id}
                      </td>
                      <td className="px-4 py-3">
                        <Link
                          to={`/admin/companies/${company.id}`}
                          className="font-medium text-slate-900 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-500"
                        >
                          {company.display_name}
                        </Link>
                        <p className="text-xs text-slate-500">{company.legal_name}</p>
                      </td>
                      <td className="px-4 py-3 text-slate-600">
                        {company.voen ?? '—'}
                      </td>
                      <td className="px-4 py-3">
                        <CompanyStatusBadge status={company.status} />
                      </td>
                      <td className="px-4 py-3 text-slate-600">
                        {company.is_platform ? 'Platform' : 'Tenant'}
                      </td>
                      <td className="px-4 py-3 text-slate-600">
                        {formatDate(company.created_at)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}
      </div>
    </PageContainer>
  )
}
