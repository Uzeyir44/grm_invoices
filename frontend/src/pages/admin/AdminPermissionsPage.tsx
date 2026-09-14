import { useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'

import { listAdminPermissions } from '../../api/adminPermissions'
import { PageContainer } from '../../components/ui/PageContainer'
import { ScopeBadge } from '../../components/ui/ScopeBadge'
import { FIELD_INPUT_CLASS } from '../../components/ui/formClasses'
import type { AdminPermission, RbacScope } from '../../types/adminPermission'

/**
 * Read-only permission catalog (`GET /api/admin/permissions/`).
 *
 * The catalog is application-defined: there is no create/delete. The `scope`
 * filter maps 1:1 to the backend query parameter and is kept in the URL.
 */
export function AdminPermissionsPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const scopeParam = (searchParams.get('scope') ?? '') as '' | RbacScope

  const [permissions, setPermissions] = useState<AdminPermission[] | null>(null)
  const [error, setError] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    let cancelled = false
    void listAdminPermissions(scopeParam ? { scope: scopeParam } : {})
      .then((data) => {
        if (cancelled) return
        setPermissions(Array.isArray(data) ? data : [])
        setError(false)
      })
      .catch(() => {
        if (cancelled) return
        setError(true)
      })
    return () => {
      cancelled = true
    }
  }, [scopeParam, reloadKey])

  const retry = useCallback(() => setReloadKey((key) => key + 1), [])

  function applyScope(value: string) {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        if (value) next.set('scope', value)
        else next.delete('scope')
        return next
      },
      { replace: true },
    )
  }

  return (
    <PageContainer title="Permission Catalog">
      <div className="space-y-4">
        <p className="text-sm text-slate-500">
          The application-defined permission catalog. Permissions are managed by
          the platform, not created or deleted here.
        </p>

        <label className="flex items-center gap-2 text-sm text-slate-600">
          Scope
          <select
            aria-label="Filter by scope"
            value={scopeParam}
            onChange={(event) => applyScope(event.target.value)}
            className={FIELD_INPUT_CLASS}
          >
            <option value="">All scopes</option>
            <option value="tenant">Tenant</option>
            <option value="system">System</option>
          </select>
        </label>

        {error ? (
          <div
            role="alert"
            className="rounded-md bg-red-50 px-4 py-3 text-sm text-red-700"
          >
            Couldn't load permissions.
            <button
              type="button"
              onClick={retry}
              className="ml-3 font-medium underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-500"
            >
              Retry
            </button>
          </div>
        ) : null}

        {permissions === null && !error ? (
          <p
            data-testid="admin-permissions-loading"
            className="animate-pulse text-sm text-slate-400"
          >
            Loading permissions…
          </p>
        ) : null}

        {permissions !== null && permissions.length === 0 && !error ? (
          <p className="text-sm text-slate-500">No permissions found.</p>
        ) : null}

        {permissions !== null && permissions.length > 0 && !error ? (
          <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-200 text-sm">
                <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th scope="col" className="px-4 py-2 font-medium">
                      Code
                    </th>
                    <th scope="col" className="px-4 py-2 font-medium">
                      Description
                    </th>
                    <th scope="col" className="px-4 py-2 font-medium">
                      Scope
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {permissions.map((permission) => (
                    <tr key={permission.id} className="hover:bg-slate-50">
                      <td className="px-4 py-3 font-mono text-xs text-slate-900">
                        {permission.code}
                      </td>
                      <td className="px-4 py-3 text-slate-600">
                        {permission.description}
                      </td>
                      <td className="px-4 py-3">
                        <ScopeBadge scope={permission.scope} />
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
