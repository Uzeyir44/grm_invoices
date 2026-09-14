import { useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'

import { getAdminRole, updateAdminRole } from '../../api/adminRoles'
import { Button } from '../../components/ui/Button'
import { Field } from '../../components/ui/Field'
import { PageContainer } from '../../components/ui/PageContainer'
import { FIELD_INPUT_CLASS } from '../../components/ui/formClasses'
import { ApiError, HTTP_STATUS } from '../../types/api'

type Errors = Record<string, string>

function firstFieldErrors(error: ApiError): Errors {
  const result: Errors = {}
  for (const [key, messages] of Object.entries(error.fieldErrors)) {
    if (messages.length > 0) result[key] = messages[0]
  }
  return result
}

function formMessageFor(error: ApiError, fieldErrors: Errors): string | undefined {
  if (error.status === HTTP_STATUS.FORBIDDEN) {
    return 'You do not have permission to edit roles.'
  }
  if (error.status === HTTP_STATUS.NOT_FOUND) {
    return 'Role not found. It may have been removed.'
  }
  if (error.status === HTTP_STATUS.TOO_MANY_REQUESTS) {
    return error.retryAfterSeconds !== null
      ? `Too many attempts. Please wait ${error.retryAfterSeconds} seconds and try again.`
      : 'Too many attempts. Please wait a moment and try again.'
  }
  if (Object.keys(fieldErrors).length === 0) {
    return error.message || 'Role update failed. Please try again.'
  }
  return error.fieldErrors.non_field_errors?.[0]
}

/**
 * Edit a tenant role's name (`PATCH /api/admin/roles/:id/`).
 *
 * Scope and company are immutable and never exposed as editable. System roles
 * are protected and cannot be edited at all.
 */
export function AdminRoleEditPage() {
  const { roleId } = useParams()
  const id = Number(roleId)
  const navigate = useNavigate()

  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [loadError, setLoadError] = useState<string>()
  const [isSystemRole, setIsSystemRole] = useState(false)

  const [name, setName] = useState('')
  const [fieldErrors, setFieldErrors] = useState<Errors>({})
  const [formError, setFormError] = useState<string>()
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (Number.isNaN(id)) return
    let cancelled = false
    void getAdminRole(id)
      .then((data) => {
        if (cancelled) return
        setIsSystemRole(data.scope === 'system')
        setName(data.name)
        setNotFound(false)
        setLoadError(undefined)
      })
      .catch((error: unknown) => {
        if (cancelled) return
        if (error instanceof ApiError && error.status === HTTP_STATUS.NOT_FOUND) {
          setNotFound(true)
        } else {
          setLoadError("Couldn't load the role.")
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [id])

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (submitting) return

    const errors: Errors = {}
    if (!name.trim()) errors.name = 'A role name is required.'
    setFieldErrors(errors)
    setFormError(undefined)
    if (Object.keys(errors).length > 0) return

    setSubmitting(true)
    try {
      await updateAdminRole(id, { name: name.trim() })
      navigate(`/admin/roles/${id}`, { state: { roleUpdated: true } })
    } catch (error) {
      if (error instanceof ApiError) {
        const fieldErrors = firstFieldErrors(error)
        setFieldErrors(fieldErrors)
        setFormError(formMessageFor(error, fieldErrors))
      } else {
        setFormError('Role update failed. Please try again.')
      }
    } finally {
      setSubmitting(false)
    }
  }

  if (notFound || Number.isNaN(id)) {
    return (
      <PageContainer title="Edit role">
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
      <PageContainer title="Edit role">
        <p
          data-testid="admin-role-edit-loading"
          className="animate-pulse text-sm text-slate-400"
        >
          Loading role…
        </p>
      </PageContainer>
    )
  }

  if (isSystemRole) {
    return (
      <PageContainer title="Edit role">
        <p className="rounded-md bg-slate-50 px-4 py-3 text-sm text-slate-600">
          System roles are protected and cannot be edited.
        </p>
        <Link
          to={`/admin/roles/${id}`}
          className="text-sm text-slate-600 underline hover:text-slate-900"
        >
          Back to role
        </Link>
      </PageContainer>
    )
  }

  if (loadError) {
    return (
      <PageContainer title="Edit role">
        <div
          role="alert"
          className="rounded-md bg-red-50 px-4 py-3 text-sm text-red-700"
        >
          {loadError}
        </div>
        <Link
          to="/admin/roles"
          className="text-sm text-slate-600 underline hover:text-slate-900"
        >
          Back to roles
        </Link>
      </PageContainer>
    )
  }

  return (
    <PageContainer title="Edit role">
      <div className="max-w-2xl rounded-lg border border-slate-200 bg-white p-6">
        <form onSubmit={handleSubmit} className="space-y-4" noValidate>
          <Field label="Role name" htmlFor="name" required error={fieldErrors.name}>
            <input
              id="name"
              name="name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              className={FIELD_INPUT_CLASS}
              aria-invalid={Boolean(fieldErrors.name)}
            />
          </Field>

          {formError ? (
            <p
              role="alert"
              className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700"
            >
              {formError}
            </p>
          ) : null}

          <div className="flex items-center gap-3">
            <Button type="submit" loading={submitting} loadingLabel="Saving…">
              Save changes
            </Button>
            <Link
              to={`/admin/roles/${id}`}
              className="text-sm text-slate-600 underline hover:text-slate-900"
            >
              Cancel
            </Link>
          </div>
        </form>
      </div>
    </PageContainer>
  )
}
