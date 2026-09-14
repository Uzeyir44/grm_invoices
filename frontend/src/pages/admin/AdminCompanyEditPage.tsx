import { useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'

import { getAdminCompany, updateAdminCompany } from '../../api/adminCompanies'
import { Button } from '../../components/ui/Button'
import { Field } from '../../components/ui/Field'
import { PageContainer } from '../../components/ui/PageContainer'
import { FIELD_INPUT_CLASS } from '../../components/ui/formClasses'
import { ApiError, HTTP_STATUS } from '../../types/api'
import type { UpdateCompanyInput } from '../../types/adminCompany'

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
    return 'You do not have permission to edit companies.'
  }
  if (error.status === HTTP_STATUS.NOT_FOUND) {
    return 'Company not found. It may have been removed.'
  }
  if (error.status === HTTP_STATUS.TOO_MANY_REQUESTS) {
    return error.retryAfterSeconds !== null
      ? `Too many attempts. Please wait ${error.retryAfterSeconds} seconds and try again.`
      : 'Too many attempts. Please wait a moment and try again.'
  }
  if (Object.keys(fieldErrors).length === 0) {
    return error.message || 'Company update failed. Please try again.'
  }
  return error.fieldErrors.non_field_errors?.[0]
}

function orNull(value: string): string | null {
  const trimmed = value.trim()
  return trimmed ? trimmed : null
}

/**
 * Edit-company metadata form (`PATCH /api/admin/companies/:id/`).
 *
 * Only the backend-approved editable fields are collected; `status` and
 * `is_platform` are not editable here (status is changed through the detail
 * page's lifecycle action). The platform company is not editable at all.
 */
export function AdminCompanyEditPage() {
  const { companyId } = useParams()
  const id = Number(companyId)
  const navigate = useNavigate()

  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [loadError, setLoadError] = useState<string>()
  const [isPlatform, setIsPlatform] = useState(false)

  const [legalName, setLegalName] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [voen, setVoen] = useState('')
  const [registrationNumber, setRegistrationNumber] = useState('')
  const [defaultLanguage, setDefaultLanguage] = useState('')
  const [defaultTimezone, setDefaultTimezone] = useState('')

  const [fieldErrors, setFieldErrors] = useState<Errors>({})
  const [formError, setFormError] = useState<string>()
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (Number.isNaN(id)) return
    let cancelled = false
    void getAdminCompany(id)
      .then((data) => {
        if (cancelled) return
        setIsPlatform(data.is_platform)
        setLegalName(data.legal_name)
        setDisplayName(data.display_name)
        setVoen(data.voen ?? '')
        setRegistrationNumber(data.registration_number ?? '')
        setDefaultLanguage(data.default_language)
        setDefaultTimezone(data.default_timezone)
        setNotFound(false)
        setLoadError(undefined)
      })
      .catch((error: unknown) => {
        if (cancelled) return
        if (error instanceof ApiError && error.status === HTTP_STATUS.NOT_FOUND) {
          setNotFound(true)
        } else {
          setLoadError("Couldn't load the company.")
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
    if (!legalName.trim()) errors.legal_name = 'Legal name is required.'
    if (!displayName.trim()) errors.display_name = 'Display name is required.'
    return errors
  }

  function buildPatch(): UpdateCompanyInput {
    return {
      legal_name: legalName.trim(),
      display_name: displayName.trim(),
      voen: orNull(voen),
      registration_number: orNull(registrationNumber),
      default_language: defaultLanguage.trim() || 'az',
      default_timezone: defaultTimezone.trim() || 'Asia/Baku',
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
      await updateAdminCompany(id, buildPatch())
      navigate(`/admin/companies/${id}`, {
        state: { companyUpdated: true },
      })
    } catch (error) {
      if (error instanceof ApiError) {
        const errors = firstFieldErrors(error)
        setFieldErrors(errors)
        setFormError(formMessageFor(error, errors))
      } else {
        setFormError('Company update failed. Please try again.')
      }
    } finally {
      setSubmitting(false)
    }
  }

  if (notFound || Number.isNaN(id)) {
    return (
      <PageContainer title="Edit company">
        <p className="text-sm text-slate-600">Company not found.</p>
        <Link
          to="/admin/companies"
          className="text-sm text-slate-600 underline hover:text-slate-900"
        >
          Back to companies
        </Link>
      </PageContainer>
    )
  }

  if (loading) {
    return (
      <PageContainer title="Edit company">
        <p
          data-testid="admin-company-edit-loading"
          className="animate-pulse text-sm text-slate-400"
        >
          Loading company…
        </p>
      </PageContainer>
    )
  }

  if (isPlatform) {
    return (
      <PageContainer title="Edit company">
        <p className="rounded-md bg-slate-50 px-4 py-3 text-sm text-slate-600">
          The platform company cannot be edited.
        </p>
        <Link
          to={`/admin/companies/${id}`}
          className="text-sm text-slate-600 underline hover:text-slate-900"
        >
          Back to company
        </Link>
      </PageContainer>
    )
  }

  if (loadError) {
    return (
      <PageContainer title="Edit company">
        <div
          role="alert"
          className="rounded-md bg-red-50 px-4 py-3 text-sm text-red-700"
        >
          {loadError}
        </div>
        <Link
          to="/admin/companies"
          className="text-sm text-slate-600 underline hover:text-slate-900"
        >
          Back to companies
        </Link>
      </PageContainer>
    )
  }

  return (
    <PageContainer title="Edit company">
      <div className="max-w-2xl rounded-lg border border-slate-200 bg-white p-6">
        <form onSubmit={handleSubmit} className="space-y-4" noValidate>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Legal name"
              htmlFor="legal_name"
              required
              error={fieldErrors.legal_name}
            >
              <input
                id="legal_name"
                name="legal_name"
                value={legalName}
                onChange={(event) => setLegalName(event.target.value)}
                className={FIELD_INPUT_CLASS}
                aria-invalid={Boolean(fieldErrors.legal_name)}
              />
            </Field>
            <Field
              label="Display name"
              htmlFor="display_name"
              required
              error={fieldErrors.display_name}
            >
              <input
                id="display_name"
                name="display_name"
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
                className={FIELD_INPUT_CLASS}
                aria-invalid={Boolean(fieldErrors.display_name)}
              />
            </Field>
            <Field label="VOEN" htmlFor="voen" error={fieldErrors.voen}>
              <input
                id="voen"
                name="voen"
                value={voen}
                onChange={(event) => setVoen(event.target.value)}
                className={FIELD_INPUT_CLASS}
                aria-invalid={Boolean(fieldErrors.voen)}
              />
            </Field>
            <Field
              label="Registration number"
              htmlFor="registration_number"
              error={fieldErrors.registration_number}
            >
              <input
                id="registration_number"
                name="registration_number"
                value={registrationNumber}
                onChange={(event) => setRegistrationNumber(event.target.value)}
                className={FIELD_INPUT_CLASS}
                aria-invalid={Boolean(fieldErrors.registration_number)}
              />
            </Field>
            <Field
              label="Default language"
              htmlFor="default_language"
              error={fieldErrors.default_language}
            >
              <input
                id="default_language"
                name="default_language"
                value={defaultLanguage}
                onChange={(event) => setDefaultLanguage(event.target.value)}
                className={FIELD_INPUT_CLASS}
                aria-invalid={Boolean(fieldErrors.default_language)}
              />
            </Field>
            <Field
              label="Default timezone"
              htmlFor="default_timezone"
              error={fieldErrors.default_timezone}
            >
              <input
                id="default_timezone"
                name="default_timezone"
                value={defaultTimezone}
                onChange={(event) => setDefaultTimezone(event.target.value)}
                className={FIELD_INPUT_CLASS}
                aria-invalid={Boolean(fieldErrors.default_timezone)}
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
              to={`/admin/companies/${id}`}
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
