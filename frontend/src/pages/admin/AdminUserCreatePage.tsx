import { useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'

import {
  createAdminUser,
  listAdminUserCompanyChoices,
} from '../../api/adminUsers'
import { Button } from '../../components/ui/Button'
import { Field } from '../../components/ui/Field'
import { PageContainer } from '../../components/ui/PageContainer'
import { FIELD_INPUT_CLASS } from '../../components/ui/formClasses'
import { ApiError, HTTP_STATUS } from '../../types/api'
import type {
  AdminUserCompanyChoice,
  CreateUserInput,
} from '../../types/adminUser'

type Errors = Record<string, string>

function firstFieldErrors(error: ApiError): Errors {
  const result: Errors = {}
  for (const [key, messages] of Object.entries(error.fieldErrors)) {
    if (messages.length > 0) result[key] = messages[0]
  }
  return result
}

function formMessageFor(error: ApiError, fieldErrors: Errors): string {
  if (error.status === HTTP_STATUS.FORBIDDEN) {
    return 'You do not have permission to create users.'
  }
  if (error.status === HTTP_STATUS.TOO_MANY_REQUESTS) {
    return 'Too many attempts. Please wait and try again.'
  }
  if (Object.keys(fieldErrors).length > 0) {
    return error.fieldErrors.non_field_errors?.[0] ?? ''
  }
  return error.message || 'User creation failed. Please try again.'
}

export function AdminUserCreatePage() {
  const navigate = useNavigate()
  const [companies, setCompanies] = useState<AdminUserCompanyChoice[] | null>(null)
  const [choicesError, setChoicesError] = useState(false)
  const [companyId, setCompanyId] = useState('')
  const [email, setEmail] = useState('')
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [password, setPassword] = useState('')
  const [roleId, setRoleId] = useState('')
  const [fieldErrors, setFieldErrors] = useState<Errors>({})
  const [formError, setFormError] = useState<string>()
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    let cancelled = false
    void listAdminUserCompanyChoices()
      .then((data) => {
        if (cancelled) return
        setCompanies(data)
        setChoicesError(false)
      })
      .catch(() => {
        if (!cancelled) setChoicesError(true)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const selectedCompany = companies?.find((company) => String(company.id) === companyId)

  function validate(): Errors {
    const errors: Errors = {}
    if (!companyId) errors.company_id = 'Company is required.'
    if (!email.trim()) errors.email = 'Email is required.'
    if (!password) errors.password = 'Password is required.'
    return errors
  }

  function buildPayload(): CreateUserInput {
    return {
      company_id: Number(companyId),
      email: email.trim(),
      first_name: firstName.trim(),
      last_name: lastName.trim(),
      password,
      role_ids: roleId ? [Number(roleId)] : [],
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (submitting) return
    const errors = validate()
    setFieldErrors(errors)
    setFormError(undefined)
    if (Object.keys(errors).length > 0) return

    setSubmitting(true)
    try {
      const created = await createAdminUser(buildPayload())
      navigate(`/admin/users/${created.id}`, { state: { userCreated: true } })
    } catch (error) {
      if (error instanceof ApiError) {
        const nextErrors = firstFieldErrors(error)
        setFieldErrors(nextErrors)
        setFormError(formMessageFor(error, nextErrors) || undefined)
      } else {
        setFormError('User creation failed. Please try again.')
      }
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <PageContainer title="New user">
      <div className="max-w-3xl space-y-4">
        <p className="text-sm text-slate-600">
          Creates an ordinary user for a tenant company. The password is hashed
          by the backend and is never returned or stored in the browser.
        </p>
        <form
          onSubmit={handleSubmit}
          className="space-y-6 rounded-lg border border-slate-200 bg-white p-6"
          noValidate
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Company" htmlFor="company_id" required error={fieldErrors.company_id}>
              {choicesError ? (
                <p className="text-sm text-red-700">Could not load companies.</p>
              ) : (
                <select
                  id="company_id"
                  name="company_id"
                  value={companyId}
                  onChange={(event) => {
                    setCompanyId(event.target.value)
                    setRoleId('')
                  }}
                  className={FIELD_INPUT_CLASS}
                  disabled={companies === null}
                >
                  <option value="">Select a company</option>
                  {companies?.map((company) => (
                    <option key={company.id} value={String(company.id)}>
                      {company.display_name} (ID {company.id})
                    </option>
                  ))}
                </select>
              )}
            </Field>
            <Field label="Tenant role" htmlFor="role_id" error={fieldErrors.role_ids}>
              <select
                id="role_id"
                name="role_id"
                value={roleId}
                onChange={(event) => setRoleId(event.target.value)}
                className={FIELD_INPUT_CLASS}
                disabled={!selectedCompany}
              >
                <option value="">No role initially</option>
                {selectedCompany?.roles.map((role) => (
                  <option key={role.id} value={String(role.id)}>
                    {role.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Email" htmlFor="email" required error={fieldErrors.email}>
              <input
                id="email"
                name="email"
                type="email"
                autoComplete="off"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                className={FIELD_INPUT_CLASS}
              />
            </Field>
            <Field label="Password" htmlFor="password" required error={fieldErrors.password}>
              <input
                id="password"
                name="password"
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                className={FIELD_INPUT_CLASS}
              />
            </Field>
            <Field label="First name" htmlFor="first_name" error={fieldErrors.first_name}>
              <input
                id="first_name"
                name="first_name"
                value={firstName}
                onChange={(event) => setFirstName(event.target.value)}
                className={FIELD_INPUT_CLASS}
              />
            </Field>
            <Field label="Last name" htmlFor="last_name" error={fieldErrors.last_name}>
              <input
                id="last_name"
                name="last_name"
                value={lastName}
                onChange={(event) => setLastName(event.target.value)}
                className={FIELD_INPUT_CLASS}
              />
            </Field>
          </div>

          {formError ? (
            <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
              {formError}
            </p>
          ) : null}

          <div className="flex items-center gap-3">
            <Button type="submit" loading={submitting} loadingLabel="Creating…">
              Create user
            </Button>
            <Link to="/admin/users" className="text-sm text-slate-600 underline">
              Cancel
            </Link>
          </div>
        </form>
      </div>
    </PageContainer>
  )
}
