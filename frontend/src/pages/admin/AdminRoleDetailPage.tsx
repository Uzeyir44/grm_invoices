import { useCallback, useEffect, useState } from 'react'
import { Link, useLocation, useParams } from 'react-router-dom'

import {
  assignAdminRolePermission,
  getAdminRole,
  removeAdminRolePermission,
} from '../../api/adminRoles'
import { Button } from '../../components/ui/Button'
import { buttonClasses } from '../../components/ui/buttonClasses'
import { Field } from '../../components/ui/Field'
import { PageContainer } from '../../components/ui/PageContainer'
import { ScopeBadge } from '../../components/ui/ScopeBadge'
import { FIELD_INPUT_CLASS } from '../../components/ui/formClasses'
import { ApiError, HTTP_STATUS } from '../../types/api'
import type { AdminRoleDetail } from '../../types/adminRole'

function formatDateTime(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return date.toISOString().replace('T', ' ').slice(0, 16) + ' UTC'
}

function actionErrorMessage(error: unknown, action: 'load' | 'permission'): string {
  if (!(error instanceof ApiError)) {
    return 'The request failed. Please try again.'
  }
  if (error.status === HTTP_STATUS.FORBIDDEN) {
    return 'You do not have permission to manage roles.'
  }
  if (error.status === HTTP_STATUS.NOT_FOUND) {
    return 'The role or permission was not found.'
  }
  if (error.status === HTTP_STATUS.TOO_MANY_REQUESTS) {
    return error.retryAfterSeconds !== null
      ? `Too many attempts. Please wait ${error.retryAfterSeconds} seconds and try again.`
      : 'Too many attempts. Please wait a moment and try again.'
  }
  if (action === 'load') return "Couldn't load the role."
  return error.message || 'The change failed. Please try again.'
}

/**
 * Role detail (`GET /api/admin/roles/:id/`).
 *
 * Tenant roles expose permission assignment/removal and an edit link. System
 * roles are protected: their permissions are shown read-only and no mutation
 * controls are rendered. The backend enforces both regardless of the UI.
 */
export function AdminRoleDetailPage() {
  const { roleId } = useParams()
  const id = Number(roleId)
  const location = useLocation()

  const [role, setRole] = useState<AdminRoleDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [loadError, setLoadError] = useState<string>()
  const [reloadKey, setReloadKey] = useState(0)

  const [selectedPermissionId, setSelectedPermissionId] = useState('')
  const [permissionPending, setPermissionPending] = useState(false)
  const [actionError, setActionError] = useState<string>()

  const created = Boolean(
    (location.state as { roleCreated?: boolean } | null)?.roleCreated,
  )
  const updated = Boolean(
    (location.state as { roleUpdated?: boolean } | null)?.roleUpdated,
  )

  useEffect(() => {
    if (Number.isNaN(id)) return
    let cancelled = false
    void getAdminRole(id)
      .then((data) => {
        if (cancelled) return
        setRole(data)
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

  const reload = useCallback(() => setReloadKey((key) => key + 1), [])

  const retry = useCallback(() => {
    setLoading(true)
    setLoadError(undefined)
    reload()
  }, [reload])

  async function assignPermission() {
    const permissionId = Number(selectedPermissionId)
    if (!permissionId || permissionPending) return
    setPermissionPending(true)
    setActionError(undefined)
    try {
      await assignAdminRolePermission(id, permissionId)
      setSelectedPermissionId('')
      reload()
    } catch (error) {
      setActionError(actionErrorMessage(error, 'permission'))
    } finally {
      setPermissionPending(false)
    }
  }

  async function removePermission(permissionId: number) {
    if (permissionPending) return
    setPermissionPending(true)
    setActionError(undefined)
    try {
      await removeAdminRolePermission(id, permissionId)
      reload()
    } catch (error) {
      setActionError(actionErrorMessage(error, 'permission'))
    } finally {
      setPermissionPending(false)
    }
  }

  if (notFound || Number.isNaN(id)) {
    return (
      <PageContainer title="Role">
        <p className="text-sm text-slate-600">Role not found.</p>
        <Link
          to="/admin/roles"
          className="text-sm text-slate-600 underline hover:text-slate-900"
        >
          Back to roles
        </Link>
      </PageContainer>
    )
  }

  if (loading) {
    return (
      <PageContainer title="Role">
        <p
          data-testid="admin-role-detail-loading"
          className="animate-pulse text-sm text-slate-400"
        >
          Loading role…
        </p>
      </PageContainer>
    )
  }

  if (loadError || role === null) {
    return (
      <PageContainer title="Role">
        <div
          role="alert"
          className="rounded-md bg-red-50 px-4 py-3 text-sm text-red-700"
        >
          {loadError ?? "Couldn't load the role."}
        </div>
        <div className="mt-2 flex items-center gap-3">
          <Button variant="secondary" onClick={retry}>
            Retry
          </Button>
          <Link
            to="/admin/roles"
            className="text-sm text-slate-600 underline hover:text-slate-900"
          >
            Back to roles
          </Link>
        </div>
      </PageContainer>
    )
  }

  const isSystemRole = role.scope === 'system'

  return (
    <PageContainer title={role.name}>
      <div className="max-w-3xl space-y-4">
        {created ? (
          <p
            role="status"
            className="rounded-md bg-emerald-50 px-4 py-3 text-sm text-emerald-800"
          >
            Role created.
          </p>
        ) : null}
        {updated ? (
          <p
            role="status"
            className="rounded-md bg-emerald-50 px-4 py-3 text-sm text-emerald-800"
          >
            Role updated.
          </p>
        ) : null}

        <div className="flex flex-wrap items-center gap-2">
          <ScopeBadge scope={role.scope} />
          <span className="text-sm text-slate-600">
            {isSystemRole
              ? 'Platform role (protected)'
              : role.company_name ?? 'Global tenant template'}
          </span>
        </div>

        <dl className="grid gap-x-8 gap-y-3 rounded-lg border border-slate-200 bg-white p-6 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-slate-500">Name</dt>
            <dd className="break-words text-slate-900">{role.name}</dd>
          </div>
          <div>
            <dt className="text-slate-500">Scope</dt>
            <dd className="break-words text-slate-900">{role.scope}</dd>
          </div>
          <div>
            <dt className="text-slate-500">Company</dt>
            <dd className="break-words text-slate-900">
              {isSystemRole
                ? '—'
                : role.company_name ?? 'Global template'}
            </dd>
          </div>
          <div>
            <dt className="text-slate-500">Created</dt>
            <dd className="break-words text-slate-900">
              {formatDateTime(role.created_at)}
            </dd>
          </div>
        </dl>

        {isSystemRole ? (
          <p className="rounded-md bg-slate-50 px-4 py-3 text-sm text-slate-600">
            This system role is part of the platform administration architecture
            and is protected. It cannot be edited or have its permissions changed
            here.
          </p>
        ) : (
          <div className="flex flex-wrap items-center gap-3">
            <Link
              to={`/admin/roles/${role.id}/edit`}
              className={buttonClasses('secondary')}
            >
              Edit role
            </Link>
          </div>
        )}

        {actionError ? (
          <p
            role="alert"
            className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700"
          >
            {actionError}
          </p>
        ) : null}

        <div className="space-y-4 rounded-lg border border-slate-200 bg-white p-6">
          <h2 className="text-sm font-semibold text-slate-700">Permissions</h2>

          {role.permissions.length === 0 ? (
            <p className="text-sm text-slate-500">No permissions assigned.</p>
          ) : (
            <ul className="space-y-2">
              {role.permissions.map((permission) => (
                <li
                  key={permission.id}
                  className="flex items-center justify-between gap-3 rounded-md border border-slate-200 px-3 py-2"
                >
                  <span className="min-w-0">
                    <span className="block font-mono text-xs text-slate-900">
                      {permission.code}
                    </span>
                    <span className="block text-xs text-slate-500">
                      {permission.description}
                    </span>
                  </span>
                  {!isSystemRole ? (
                    <button
                      type="button"
                      onClick={() => {
                        void removePermission(permission.id)
                      }}
                      disabled={permissionPending}
                      className="text-sm text-red-600 underline hover:text-red-700 disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-500"
                    >
                      Remove
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
          )}

          {!isSystemRole ? (
            role.available_permissions.length > 0 ? (
              <div className="flex flex-wrap items-end gap-3">
                <Field label="Add permission" htmlFor="assign-permission">
                  <select
                    id="assign-permission"
                    name="assign-permission"
                    value={selectedPermissionId}
                    onChange={(event) => setSelectedPermissionId(event.target.value)}
                    className={FIELD_INPUT_CLASS}
                  >
                    <option value="">Select a tenant permission</option>
                    {role.available_permissions.map((permission) => (
                      <option key={permission.id} value={String(permission.id)}>
                        {permission.code}
                      </option>
                    ))}
                  </select>
                </Field>
                <Button
                  onClick={() => {
                    void assignPermission()
                  }}
                  disabled={!selectedPermissionId || permissionPending}
                  loading={permissionPending}
                  loadingLabel="Assigning…"
                >
                  Assign permission
                </Button>
              </div>
            ) : (
              <p className="text-sm text-slate-500">
                No further tenant permissions are available.
              </p>
            )
          ) : null}
        </div>

        <Link
          to="/admin/roles"
          className="inline-block text-sm text-slate-600 underline hover:text-slate-900"
        >
          Back to roles
        </Link>
      </div>
    </PageContainer>
  )
}
