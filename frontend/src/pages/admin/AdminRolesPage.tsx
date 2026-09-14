import { useCallback, useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'

import { listAdminCompanies } from '../../api/adminCompanies'
import { listAdminRoles } from '../../api/adminRoles'
import { buttonClasses } from '../../components/ui/buttonClasses'
import { PageContainer } from '../../components/ui/PageContainer'
import { ScopeBadge } from '../../components/ui/ScopeBadge'
import { FIELD_INPUT_CLASS } from '../../components/ui/formClasses'
import type { AdminCompany } from '../../types/adminCompany'
import type { RbacScope } from '../../types/adminPermission'
import type { AdminRoleListItem } from '../../types/adminRole'

/**
 * Global role list (`GET /api/admin/roles/`).
 *
 * Shows tenant roles (global templates and company-specific roles) and system
 * roles (protected). The `scope` / `company_id` filters map 1:1 to backend
 * query parameters and are kept in the URL.
 */
export function AdminRolesPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const scopeParam = (searchParams.get('scope') ?? '') as '' | RbacScope
  const companyParam = searchParams.get('company_id') ?? ''

  const [roles, setRoles] = useState<AdminRoleListItem[] | null>(null)
  const [error, setError] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)

  const [companies, setCompanies] = useState<AdminCompany[]>([])

  useEffect(() => {
    let cancelled = false
    void listAdminCompanies().then((data) => {
      if (!cancelled) setCompanies(Array.isArray(data) ? data : [])
    }).catch(() => {
      // Non-blocking: only the company filter is affected.
    })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    void listAdminRoles({
      scope: scopeParam || undefined,
      company_id: companyParam ? Number(companyParam) : undefined,
    })
      .then((data) => {
        if (cancelled) return
        setRoles(Array.isArray(data) ? data : [])
        setError(false)
      })
      .catch(() => {
        if (cancelled) return
        setError(true)
      })
    return () => {
      cancelled = true
    }
  }, [scopeParam, companyParam, reloadKey])

  const retry = useCallback(() => setReloadKey((key) => key + 1), [])

  const applyParams = useCallback(
    (updates: Record<string, string>) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev)
          for (const [key, value] of Object.entries(updates)) {
            if (value) next.set(key, value)
            else next.delete(key)
          }
          return next
        },
        { replace: true },
      )
    },
    [setSearchParams],
  )

  return (
    <PageContainer title="Roles & Permissions">
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2 text-sm text-slate-600">
              Scope
              <select
                aria-label="Filter by scope"
                value={scopeParam}
                onChange={(event) => applyParams({ scope: event.target.value })}
                className={FIELD_INPUT_CLASS}
              >
                <option value="">All scopes</option>
                <option value="tenant">Tenant</option>
                <option value="system">System</option>
              </select>
            </label>
            <label className="flex items-center gap-2 text-sm text-slate-600">
              Company
              <select
                aria-label="Filter by company"
                value={companyParam}
                onChange={(event) =>
                  applyParams({ company_id: event.target.value })
                }
                className={FIELD_INPUT_CLASS}
                disabled={companies.length === 0}
              >
                <option value="">All companies</option>
                {companies.map((company) => (
                  <option key={company.id} value={String(company.id)}>
                    {company.display_name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <Link to="/admin/roles/new" className={buttonClasses('primary')}>
            New role
          </Link>
        </div>

        {error ? (
          <div
            role="alert"
            className="rounded-md bg-red-50 px-4 py-3 text-sm text-red-700"
          >
            Couldn't load roles.
            <button
              type="button"
              onClick={retry}
              className="ml-3 font-medium underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-500"
            >
              Retry
            </button>
          </div>
        ) : null}

        {roles === null && !error ? (
          <p
            data-testid="admin-roles-loading"
            className="animate-pulse text-sm text-slate-400"
          >
            Loading roles…
          </p>
        ) : null}

        {roles !== null && roles.length === 0 && !error ? (
          <p className="text-sm text-slate-500">No roles found.</p>
        ) : null}

        {roles !== null && roles.length > 0 && !error ? (
          <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-200 text-sm">
                <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th scope="col" className="px-4 py-2 font-medium">
                      Role
                    </th>
                    <th scope="col" className="px-4 py-2 font-medium">
                      Scope
                    </th>
                    <th scope="col" className="px-4 py-2 font-medium">
                      Company
                    </th>
                    <th scope="col" className="px-4 py-2 font-medium">
                      Permissions
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {roles.map((role) => (
                    <tr key={role.id} className="hover:bg-slate-50">
                      <td className="px-4 py-3">
                        <Link
                          to={`/admin/roles/${role.id}`}
                          className="font-medium text-slate-900 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-500"
                        >
                          {role.name}
                        </Link>
                      </td>
                      <td className="px-4 py-3">
                        <ScopeBadge scope={role.scope} />
                      </td>
                      <td className="px-4 py-3 text-slate-600">
                        {role.scope === 'system'
                          ? 'Platform (protected)'
                          : role.company_name ?? 'Global template'}
                      </td>
                      <td className="px-4 py-3 text-slate-600">
                        {role.permission_count}
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
