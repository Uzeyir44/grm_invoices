import { useCallback, useEffect, useState } from 'react'
import { Link, useLocation, useParams } from 'react-router-dom'

import {
  activateAdminUser,
  assignAdminUserRole,
  deactivateAdminUser,
  getAdminUser,
  removeAdminUserRole,
} from '../../api/adminUsers'
import { Button } from '../../components/ui/Button'
import { buttonClasses } from '../../components/ui/buttonClasses'
import { Field } from '../../components/ui/Field'
import { PageContainer } from '../../components/ui/PageContainer'
import { FIELD_INPUT_CLASS } from '../../components/ui/formClasses'
import { ApiError, HTTP_STATUS } from '../../types/api'
import type { AdminUserDetail } from '../../types/adminUser'

function formatDateTime(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return date.toISOString().replace('T', ' ').slice(0, 16) + ' UTC'
}

function displayName(user: AdminUserDetail): string {
  const name = [user.first_name, user.last_name]
    .filter((part) => part && part.trim())
    .join(' ')
  return name || user.email
}

function actionErrorMessage(error: unknown, action: 'load' | 'status' | 'role'): string {
  if (!(error instanceof ApiError)) {
    return 'The request failed. Please try again.'
  }
  if (error.status === HTTP_STATUS.FORBIDDEN) {
    return 'You do not have permission to manage users.'
  }
  if (error.status === HTTP_STATUS.NOT_FOUND) {
    return 'The user or role was not found.'
  }
  if (error.status === HTTP_STATUS.TOO_MANY_REQUESTS) {
    return error.retryAfterSeconds !== null
      ? `Too many attempts. Please wait ${error.retryAfterSeconds} seconds and try again.`
      : 'Too many attempts. Please wait a moment and try again.'
  }
  if (action === 'load') return "Couldn't load the user."
  return error.message || 'The change failed. Please try again.'
}

/**
 * User detail (`GET /api/admin/users/:id/`) with the supported management
 * actions: metadata edit, activate/deactivate, and tenant-role assignment /
 * removal. The backend remains authoritative — system roles and other
 * companies' roles are rejected server-side and are never offered here.
 */
export function AdminUserDetailPage() {
  const { userId } = useParams()
  const id = Number(userId)
  const location = useLocation()

  const [user, setUser] = useState<AdminUserDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [loadError, setLoadError] = useState<string>()
  const [reloadKey, setReloadKey] = useState(0)

  const [confirming, setConfirming] = useState(false)
  const [statusPending, setStatusPending] = useState(false)
  const [actionError, setActionError] = useState<string>()

  const [selectedRoleId, setSelectedRoleId] = useState('')
  const [rolePending, setRolePending] = useState(false)

  const updated = Boolean(
    (location.state as { userUpdated?: boolean } | null)?.userUpdated,
  )

  useEffect(() => {
    if (Number.isNaN(id)) return
    let cancelled = false
    void getAdminUser(id)
      .then((data) => {
        if (cancelled) return
        setUser(data)
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

  const reload = useCallback(() => {
    setReloadKey((key) => key + 1)
  }, [])

  const retry = useCallback(() => {
    setLoading(true)
    setLoadError(undefined)
    reload()
  }, [reload])

  async function runStatusAction(next: 'activate' | 'deactivate') {
    if (statusPending) return
    setStatusPending(true)
    setActionError(undefined)
    try {
      const updatedUser =
        next === 'activate'
          ? await activateAdminUser(id)
          : await deactivateAdminUser(id)
      setUser(updatedUser)
      setConfirming(false)
    } catch (error) {
      setActionError(actionErrorMessage(error, 'status'))
      setConfirming(false)
    } finally {
      setStatusPending(false)
    }
  }

  async function assignRole() {
    const roleId = Number(selectedRoleId)
    if (!roleId || rolePending) return
    setRolePending(true)
    setActionError(undefined)
    try {
      await assignAdminUserRole(id, roleId)
      setSelectedRoleId('')
      reload()
    } catch (error) {
      setActionError(actionErrorMessage(error, 'role'))
    } finally {
      setRolePending(false)
    }
  }

  async function removeRole(roleId: number) {
    if (rolePending) return
    setRolePending(true)
    setActionError(undefined)
    try {
      await removeAdminUserRole(id, roleId)
      reload()
    } catch (error) {
      setActionError(actionErrorMessage(error, 'role'))
    } finally {
      setRolePending(false)
    }
  }

  if (notFound || Number.isNaN(id)) {
    return (
      <PageContainer title="User">
        <p className="text-sm text-slate-600">User not found.</p>
        <Link
          to="/admin/users"
          className="text-sm text-slate-600 underline hover:text-slate-900"
        >
          Back to users
        </Link>
      </PageContainer>
    )
  }

  if (loading) {
    return (
      <PageContainer title="User">
        <p
          data-testid="admin-user-detail-loading"
          className="animate-pulse text-sm text-slate-400"
        >
          Loading user…
        </p>
      </PageContainer>
    )
  }

  if (loadError || user === null) {
    return (
      <PageContainer title="User">
        <div
          role="alert"
          className="rounded-md bg-red-50 px-4 py-3 text-sm text-red-700"
        >
          {loadError ?? "Couldn't load the user."}
        </div>
        <div className="mt-2 flex items-center gap-3">
          <Button variant="secondary" onClick={retry}>
            Retry
          </Button>
          <Link
            to="/admin/users"
            className="text-sm text-slate-600 underline hover:text-slate-900"
          >
            Back to users
          </Link>
        </div>
      </PageContainer>
    )
  }

  const assignedIds = new Set(user.roles.map((role) => role.id))
  const availableRoles = user.company_roles.filter(
    (role) => !assignedIds.has(role.id),
  )

  return (
    <PageContainer title={displayName(user)}>
      <div className="max-w-3xl space-y-4">
        {updated ? (
          <p
            role="status"
            className="rounded-md bg-emerald-50 px-4 py-3 text-sm text-emerald-800"
          >
            User updated.
          </p>
        ) : null}

        <div className="flex flex-wrap items-center gap-2">
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
          <span className="text-sm text-slate-600">{user.company_name}</span>
        </div>

        <dl className="grid gap-x-8 gap-y-3 rounded-lg border border-slate-200 bg-white p-6 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-slate-500">Email</dt>
            <dd className="break-words text-slate-900">{user.email}</dd>
          </div>
          <div>
            <dt className="text-slate-500">Company</dt>
            <dd className="break-words text-slate-900">{user.company_name}</dd>
          </div>
          <div>
            <dt className="text-slate-500">First name</dt>
            <dd className="break-words text-slate-900">{user.first_name || '—'}</dd>
          </div>
          <div>
            <dt className="text-slate-500">Last name</dt>
            <dd className="break-words text-slate-900">{user.last_name || '—'}</dd>
          </div>
          <div>
            <dt className="text-slate-500">Created</dt>
            <dd className="break-words text-slate-900">
              {formatDateTime(user.created_at)}
            </dd>
          </div>
          <div>
            <dt className="text-slate-500">Updated</dt>
            <dd className="break-words text-slate-900">
              {formatDateTime(user.updated_at)}
            </dd>
          </div>
        </dl>

        {actionError ? (
          <p
            role="alert"
            className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700"
          >
            {actionError}
          </p>
        ) : null}

        <div className="space-y-3 rounded-lg border border-slate-200 bg-white p-6">
          <h2 className="text-sm font-semibold text-slate-700">Account</h2>
          <div className="flex flex-wrap items-center gap-3">
            <Link
              to={`/admin/users/${user.id}/edit`}
              className={buttonClasses('secondary')}
            >
              Edit metadata
            </Link>
            {user.is_active ? (
              !confirming ? (
                <Button
                  variant="danger"
                  onClick={() => setConfirming(true)}
                  disabled={statusPending}
                >
                  Deactivate
                </Button>
              ) : (
                <span className="flex flex-wrap items-center gap-2">
                  <span className="text-sm text-slate-700">
                    Deactivate this user?
                  </span>
                  <Button
                    variant="danger"
                    loading={statusPending}
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
                    disabled={statusPending}
                  >
                    Cancel
                  </Button>
                </span>
              )
            ) : (
              <Button
                loading={statusPending}
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

        <div className="space-y-4 rounded-lg border border-slate-200 bg-white p-6">
          <h2 className="text-sm font-semibold text-slate-700">Tenant roles</h2>

          {user.roles.length === 0 ? (
            <p className="text-sm text-slate-500">No roles assigned.</p>
          ) : (
            <ul className="space-y-2">
              {user.roles.map((role) => (
                <li
                  key={role.id}
                  className="flex items-center justify-between gap-3 rounded-md border border-slate-200 px-3 py-2"
                >
                  <span className="text-sm text-slate-900">{role.name}</span>
                  <button
                    type="button"
                    onClick={() => {
                      void removeRole(role.id)
                    }}
                    disabled={rolePending}
                    className="text-sm text-red-600 underline hover:text-red-700 disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-500"
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          )}

          {availableRoles.length > 0 ? (
            <div className="flex flex-wrap items-end gap-3">
              <Field label="Add role" htmlFor="assign-role">
                <select
                  id="assign-role"
                  name="assign-role"
                  value={selectedRoleId}
                  onChange={(event) => setSelectedRoleId(event.target.value)}
                  className={FIELD_INPUT_CLASS}
                >
                  <option value="">Select a role</option>
                  {availableRoles.map((role) => (
                    <option key={role.id} value={String(role.id)}>
                      {role.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Button
                onClick={() => {
                  void assignRole()
                }}
                disabled={!selectedRoleId || rolePending}
                loading={rolePending}
                loadingLabel="Assigning…"
              >
                Assign role
              </Button>
            </div>
          ) : (
            <p className="text-sm text-slate-500">
              No further tenant roles are available for this company.
            </p>
          )}
        </div>

        <Link
          to="/admin/users"
          className="inline-block text-sm text-slate-600 underline hover:text-slate-900"
        >
          Back to users
        </Link>
      </div>
    </PageContainer>
  )
}
