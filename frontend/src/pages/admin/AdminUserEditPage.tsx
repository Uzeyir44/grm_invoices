import { useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'

import { getAdminUser, updateAdminUser } from '../../api/adminUsers'
import { Button } from '../../components/ui/Button'
import { Field } from '../../components/ui/Field'
import { PageContainer } from '../../components/ui/PageContainer'
import { FIELD_INPUT_CLASS } from '../../components/ui/formClasses'
import { ApiError, HTTP_STATUS } from '../../types/api'
import type { UpdateUserInput } from '../../types/adminUser'

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
    return 'You do not have permission to edit users.'
  }
  if (error.status === HTTP_STATUS.NOT_FOUND) {
    return 'User not found. It may have been removed.'
  }
  if (error.status === HTTP_STATUS.TOO_MANY_REQUESTS) {
    return error.retryAfterSeconds !== null
      ? `Too many attempts. Please wait ${error.retryAfterSeconds} seconds and try again.`
      : 'Too many attempts. Please wait a moment and try again.'
  }
  if (Object.keys(fieldErrors).length === 0) {
    return error.message || 'User update failed. Please try again.'
  }
  return error.fieldErrors.non_field_errors?.[0]
}

/**
 * Edit-user metadata form (`PATCH /api/admin/users/:id/`).
 *
 * Only the backend-approved editable fields are collected (`first_name`,
 * `last_name`, `email`). The company, password, MFA state, lifecycle, and
 * System Admin scope are never editable here.
 */
export function AdminUserEditPage() {
  const { userId } = useParams()
  const id = Number(userId)
  const navigate = useNavigate()

  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [loadError, setLoadError] = useState<string>()
  const [companyName, setCompanyName] = useState('')

  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [email, setEmail] = useState('')

  const [fieldErrors, setFieldErrors] = useState<Errors>({})
  const [formError, setFormError] = useState<string>()
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (Number.isNaN(id)) return
    let cancelled = false
    void getAdminUser(id)
      .then((data) => {
        if (cancelled) return
        setFirstName(data.first_name)
        setLastName(data.last_name)
        setEmail(data.email)
        setCompanyName(data.company_name)
        setNotFound(false)
        setLoadError(undefined)
      })
      .catch((error: unknown) => {
        if (cancelled) return
        if (error instanceof ApiError && error.status === HTTP_STATUS.NOT_FOUND) {
          setNotFound(true)
        } else {
          setLoadError("Couldn't load the user.")
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [id])

  function validate(): Errors {
    const errors: Errors = {}
    if (!firstName.trim()) errors.first_name = 'First name is required.'
    if (!lastName.trim()) errors.last_name = 'Last name is required.'
    if (!email.trim()) errors.email = 'Email is required.'
    return errors
  }

  function buildPatch(): UpdateUserInput {
    return {
      first_name: firstName.trim(),
      last_name: lastName.trim(),
      email: email.trim(),
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (submitting) return

    const localErrors = validate()
    setFieldErrors(localErrors)
    setFormError(undefined)
    if (Object.keys(localErrors).length > 0) return

    setSubmitting(true)
    try {
      await updateAdminUser(id, buildPatch())
      navigate(`/admin/users/${id}`, { state: { userUpdated: true } })
    } catch (error) {
      if (error instanceof ApiError) {
        const errors = firstFieldErrors(error)
        setFieldErrors(errors)
        setFormError(formMessageFor(error, errors))
      } else {
        setFormError('User update failed. Please try again.')
      }
    } finally {
      setSubmitting(false)
    }
  }

  if (notFound || Number.isNaN(id)) {
    return (
      <PageContainer title="Edit user">
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
      <PageContainer title="Edit user">
        <p
          data-testid="admin-user-edit-loading"
          className="animate-pulse text-sm text-slate-400"
        >
          Loading user…
        </p>
      </PageContainer>
    )
  }

  if (loadError) {
    return (
      <PageContainer title="Edit user">
        <div
          role="alert"
          className="rounded-md bg-red-50 px-4 py-3 text-sm text-red-700"
        >
          {loadError}
        </div>
        <Link
          to="/admin/users"
          className="text-sm text-slate-600 underline hover:text-slate-900"
        >
          Back to users
        </Link>
      </PageContainer>
    )
  }

  return (
    <PageContainer title="Edit user">
      <div className="max-w-2xl space-y-4">
        <p className="rounded-md bg-slate-50 px-4 py-3 text-sm text-slate-600">
          Company: {companyName}. A user cannot be moved between companies.
        </p>

        <div className="rounded-lg border border-slate-200 bg-white p-6">
          <form onSubmit={handleSubmit} className="space-y-4" noValidate>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                label="First name"
                htmlFor="first_name"
                required
                error={fieldErrors.first_name}
              >
                <input
                  id="first_name"
                  name="first_name"
                  value={firstName}
                  onChange={(event) => setFirstName(event.target.value)}
                  className={FIELD_INPUT_CLASS}
                  aria-invalid={Boolean(fieldErrors.first_name)}
                />
              </Field>
              <Field
                label="Last name"
                htmlFor="last_name"
                required
                error={fieldErrors.last_name}
              >
                <input
                  id="last_name"
                  name="last_name"
                  value={lastName}
                  onChange={(event) => setLastName(event.target.value)}
                  className={FIELD_INPUT_CLASS}
                  aria-invalid={Boolean(fieldErrors.last_name)}
                />
              </Field>
              <Field
                label="Email"
                htmlFor="email"
                required
                error={fieldErrors.email}
              >
                <input
                  id="email"
                  name="email"
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  className={FIELD_INPUT_CLASS}
                  aria-invalid={Boolean(fieldErrors.email)}
                />
              </Field>
            </div>

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
                to={`/admin/users/${id}`}
                className="text-sm text-slate-600 underline hover:text-slate-900"
              >
                Cancel
              </Link>
            </div>
          </form>
        </div>
      </div>
    </PageContainer>
  )
}
