import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'

import { listAdminUsers } from '../../api/adminUsers'
import { PageContainer } from '../../components/ui/PageContainer'
import { buttonClasses } from '../../components/ui/buttonClasses'
import { useAdminAuth } from '../../contexts/admin-auth-context'
import type { AdminUser } from '../../types/adminUser'

function displayName(user: AdminUser): string {
  const name = [user.first_name, user.last_name]
    .filter((part) => part && part.trim())
    .join(' ')
  return name || user.email
}

/**
 * Admin user list (`GET /api/admin/users/`).
 *
 * Lists ordinary tenant users across all companies (System Admin accounts are
 * excluded by the backend). Loading / empty / error+retry states; real API data
 * only (no fabricated counts).
 */
export function AdminUsersPage() {
  const { hasPermission } = useAdminAuth()
  const canManage = hasPermission('system.users.manage')
  const [users, setUsers] = useState<AdminUser[] | null>(null)
  const [error, setError] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    let cancelled = false
    void listAdminUsers()
      .then((data) => {
        if (cancelled) return
        setUsers(Array.isArray(data) ? data : [])
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
    <PageContainer title="Users">
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-slate-500">
            {users !== null && !error
              ? `${users.length} ${users.length === 1 ? 'user' : 'users'}`
              : null}
          </p>
          {canManage ? (
            <Link to="/admin/users/new" className={buttonClasses('primary')}>
              New user
            </Link>
          ) : null}
        </div>

        {error ? (
          <div
            role="alert"
            className="rounded-md bg-red-50 px-4 py-3 text-sm text-red-700"
          >
            Couldn't load users.
            <button
              type="button"
              onClick={retry}
              className="ml-3 font-medium underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-500"
            >
              Retry
            </button>
          </div>
        ) : null}

        {users === null && !error ? (
          <p
            data-testid="admin-users-loading"
            className="animate-pulse text-sm text-slate-400"
          >
            Loading users…
          </p>
        ) : null}

        {users !== null && users.length === 0 && !error ? (
          <div className="rounded-lg border border-dashed border-slate-300 px-4 py-10 text-center">
            <p className="text-sm text-slate-500">No users found.</p>
          </div>
        ) : null}

        {users !== null && users.length > 0 && !error ? (
          <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-200 text-sm">
                <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th scope="col" className="px-4 py-2 font-medium">
                      ID
                    </th>
                    <th scope="col" className="px-4 py-2 font-medium">
                      User
                    </th>
                    <th scope="col" className="px-4 py-2 font-medium">
                      Company
                    </th>
                    <th scope="col" className="px-4 py-2 font-medium">
                      Status
                    </th>
                    <th scope="col" className="px-4 py-2 font-medium">
                      Roles
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {users.map((user) => (
                    <tr key={user.id} className="hover:bg-slate-50">
                      <td className="px-4 py-3 font-mono text-xs text-slate-600">
                        {user.id}
                      </td>
                      <td className="px-4 py-3">
                        <Link
                          to={`/admin/users/${user.id}`}
                          className="font-medium text-slate-900 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-500"
                        >
                          {displayName(user)}
                        </Link>
                        <p className="text-xs text-slate-500">{user.email}</p>
                      </td>
                      <td className="px-4 py-3 text-slate-600">
                        <span>{user.company_name}</span>
                        <span className="ml-2 font-mono text-xs text-slate-500">
                          #{user.company_id}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span
                          data-testid="user-status"
                          className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                            user.is_active
                              ? 'bg-emerald-100 text-emerald-800'
                              : 'bg-red-100 text-red-700'
                          }`}
                        >
                          {user.is_active ? 'Active' : 'Inactive'}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-slate-600">
                        {user.roles.length > 0
                          ? user.roles.map((role) => role.name).join(', ')
                          : '—'}
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
