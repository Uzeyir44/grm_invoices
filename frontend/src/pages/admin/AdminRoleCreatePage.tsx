import { useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'

import { listAdminCompanies } from '../../api/adminCompanies'
import { createAdminRole } from '../../api/adminRoles'
import { Button } from '../../components/ui/Button'
import { Field } from '../../components/ui/Field'
import { PageContainer } from '../../components/ui/PageContainer'
import { FIELD_INPUT_CLASS } from '../../components/ui/formClasses'
import { ApiError, HTTP_STATUS } from '../../types/api'
import type { AdminCompany } from '../../types/adminCompany'

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
    return 'You do not have permission to manage roles.'
  }
  if (error.status === HTTP_STATUS.TOO_MANY_REQUESTS) {
    return error.retryAfterSeconds !== null
      ? `Too many attempts. Please wait ${error.retryAfterSeconds} seconds and try again.`
      : 'Too many attempts. Please wait a moment and try again.'
  }
  if (Object.keys(fieldErrors).length === 0) {
    return error.message || 'Role creation failed. Please try again.'
  }
  return error.fieldErrors.non_field_errors?.[0]
}

/**
 * Create a tenant role (`POST /api/admin/roles/`).
 *
 * A role always belongs to a tenant company and is tenant-scoped — the backend
 * sets scope itself. The platform company is never offered.
 */
export function AdminRoleCreatePage() {
  const navigate = useNavigate()

  const [companies, setCompanies] = useState<AdminCompany[] | null>(null)
  const [companiesError, setCompaniesError] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)

  const [companyId, setCompanyId] = useState('')
  const [name, setName] = useState('')
  const [fieldErrors, setFieldErrors] = useState<Errors>({})
  const [formError, setFormError] = useState<string>()
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    let cancelled = false
    void listAdminCompanies()
      .then((data) => {
        if (cancelled) return
        setCompanies(Array.isArray(data) ? data.filter((c) => !c.is_platform) : [])
        setCompaniesError(false)
      })
      .catch(() => {
        if (cancelled) return
        setCompaniesError(true)
      })
    return () => {
      cancelled = true
    }
  }, [reloadKey])

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (submitting) return

    const errors: Errors = {}
    if (!companyId) errors.company_id = 'A company is required.'
    if (!name.trim()) errors.name = 'A role name is required.'
    setFieldErrors(errors)
    setFormError(undefined)
    if (Object.keys(errors).length > 0) return

    setSubmitting(true)
    try {
      const role = await createAdminRole({
        company_id: Number(companyId),
        name: name.trim(),
      })
      navigate(`/admin/roles/${role.id}`, { state: { roleCreated: true } })
    } catch (error) {
      if (error instanceof ApiError) {
        const fieldErrors = firstFieldErrors(error)
        setFieldErrors(fieldErrors)
        setFormError(formMessageFor(error, fieldErrors))
      } else {
        setFormError('Role creation failed. Please try again.')
      }
    } finally {
      setSubmitting(false)
    }
  }

  if (companiesError) {
    return (
      <PageContainer title="New role">
        <div
          role="alert"
          className="rounded-md bg-red-50 px-4 py-3 text-sm text-red-700"
        >
          Couldn't load companies.
        </div>
        <Button variant="secondary" onClick={() => setReloadKey((k) => k + 1)}>
          Retry
        </Button>
      </PageContainer>
    )
  }

  if (companies === null) {
    return (
      <PageContainer title="New role">
        <p
          data-testid="admin-role-create-loading"
          className="animate-pulse text-sm text-slate-400"
        >
          Loading companies…
        </p>
      </PageContainer>
    )
  }

  return (
    <PageContainer title="New role">
      <div className="max-w-2xl space-y-4">
        <p className="text-sm text-slate-600">
          Creates a tenant-scoped role for a company. Permissions can be added
          on the role's detail page after creation.
        </p>

        <div className="rounded-lg border border-slate-200 bg-white p-6">
          <form onSubmit={handleSubmit} className="space-y-4" noValidate>
            <Field
              label="Company"
              htmlFor="company_id"
              required
              error={fieldErrors.company_id}
            >
              <select
                id="company_id"
                name="company_id"
                value={companyId}
                onChange={(event) => setCompanyId(event.target.value)}
                className={FIELD_INPUT_CLASS}
                aria-invalid={Boolean(fieldErrors.company_id)}
              >
                <option value="">Select a company</option>
                {companies.map((company) => (
                  <option key={company.id} value={String(company.id)}>
                    {company.display_name}
                  </option>
                ))}
              </select>
            </Field>

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
              <Button type="submit" loading={submitting} loadingLabel="Creating…">
                Create role
              </Button>
              <Link
                to="/admin/roles"
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
