import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'

import { provisionAdminCompany } from '../../api/adminCompanies'
import { Button } from '../../components/ui/Button'
import { Field } from '../../components/ui/Field'
import { PageContainer } from '../../components/ui/PageContainer'
import { FIELD_INPUT_CLASS } from '../../components/ui/formClasses'
import { ApiError, HTTP_STATUS } from '../../types/api'
import type { ProvisionCompanyInput } from '../../types/adminCompany'

type Errors = Record<string, string>

function firstFieldErrors(error: ApiError): Errors {
  const result: Errors = {}
  for (const [key, messages] of Object.entries(error.fieldErrors)) {
    if (messages.length > 0 && !key.startsWith('admin_')) {
      result[key] = messages[0]
    }
  }
  for (const key of [
    'admin_email',
    'admin_first_name',
    'admin_last_name',
    'admin_password',
  ]) {
    const messages = error.fieldErrors[key]
    if (messages && messages.length > 0) result[key] = messages[0]
  }
  return result
}

function formMessageFor(error: ApiError, fieldErrors: Errors): string | undefined {
  if (error.status === HTTP_STATUS.FORBIDDEN) {
    return 'You do not have permission to provision companies.'
  }
  if (error.status === HTTP_STATUS.TOO_MANY_REQUESTS) {
    return error.retryAfterSeconds !== null
      ? `Too many attempts. Please wait ${error.retryAfterSeconds} seconds and try again.`
      : 'Too many attempts. Please wait a moment and try again.'
  }
  if (Object.keys(fieldErrors).length === 0) {
    return error.message || 'Company provisioning failed. Please try again.'
  }
  return error.fieldErrors.non_field_errors?.[0]
}

function orNull(value: string): string | null {
  const trimmed = value.trim()
  return trimmed ? trimmed : null
}

/**
 * Provision-company form (`POST /api/admin/companies/provision/`).
 *
 * Collects the new company's details plus its initial administrator's
 * credentials. The initial password is transient form state only — it is never
 * persisted, returned, or placed in the URL/storage, and the page navigates
 * away on success. The backend hashes it and records no credentials in audit.
 */
export function AdminCompanyCreatePage() {
  const navigate = useNavigate()

  const [legalName, setLegalName] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [voen, setVoen] = useState('')
  const [registrationNumber, setRegistrationNumber] = useState('')
  const [defaultLanguage, setDefaultLanguage] = useState('az')
  const [defaultTimezone, setDefaultTimezone] = useState('Asia/Baku')

  const [adminEmail, setAdminEmail] = useState('')
  const [adminFirstName, setAdminFirstName] = useState('')
  const [adminLastName, setAdminLastName] = useState('')
  const [adminPassword, setAdminPassword] = useState('')

  const [fieldErrors, setFieldErrors] = useState<Errors>({})
  const [formError, setFormError] = useState<string>()
  const [submitting, setSubmitting] = useState(false)

  function validate(): Errors {
    const errors: Errors = {}
    if (!legalName.trim()) errors.legal_name = 'Legal name is required.'
    if (!displayName.trim()) errors.display_name = 'Display name is required.'
    if (!adminEmail.trim()) errors.admin_email = "Administrator email is required."
    if (!adminPassword) errors.admin_password = 'Initial password is required.'
    return errors
  }

  function buildPayload(): ProvisionCompanyInput {
    return {
      legal_name: legalName.trim(),
      display_name: displayName.trim(),
      voen: orNull(voen),
      registration_number: orNull(registrationNumber),
      default_language: defaultLanguage.trim() || 'az',
      default_timezone: defaultTimezone.trim() || 'Asia/Baku',
      admin_email: adminEmail.trim(),
      admin_first_name: adminFirstName.trim(),
      admin_last_name: adminLastName.trim(),
      admin_password: adminPassword,
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
      const created = await provisionAdminCompany(buildPayload())
      navigate(`/admin/companies/${created.id}`, {
        state: { companyProvisioned: true },
      })
    } catch (error) {
      if (error instanceof ApiError) {
        const errors = firstFieldErrors(error)
        setFieldErrors(errors)
        setFormError(formMessageFor(error, errors))
      } else {
        setFormError('Company provisioning failed. Please try again.')
      }
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <PageContainer title="New company">
      <div className="max-w-3xl space-y-4">
        <p className="text-sm text-slate-600">
          Provisions a new tenant company together with its initial
          administrator. The whole operation is atomic — a failure leaves
          nothing behind.
        </p>

        <form
          onSubmit={handleSubmit}
          className="space-y-6 rounded-lg border border-slate-200 bg-white p-6"
          noValidate
        >
          <fieldset className="space-y-4">
            <legend className="text-sm font-semibold text-slate-700">
              Company
            </legend>
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
          </fieldset>

          <fieldset className="space-y-4">
            <legend className="text-sm font-semibold text-slate-700">
              Initial administrator
            </legend>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                label="Administrator email"
                htmlFor="admin_email"
                required
                error={fieldErrors.admin_email}
              >
                <input
                  id="admin_email"
                  name="admin_email"
                  type="email"
                  autoComplete="off"
                  value={adminEmail}
                  onChange={(event) => setAdminEmail(event.target.value)}
                  className={FIELD_INPUT_CLASS}
                  aria-invalid={Boolean(fieldErrors.admin_email)}
                />
              </Field>
              <Field
                label="Initial password"
                htmlFor="admin_password"
                required
                error={fieldErrors.admin_password}
              >
                <input
                  id="admin_password"
                  name="admin_password"
                  type="password"
                  autoComplete="new-password"
                  value={adminPassword}
                  onChange={(event) => setAdminPassword(event.target.value)}
                  className={FIELD_INPUT_CLASS}
                  aria-invalid={Boolean(fieldErrors.admin_password)}
                />
              </Field>
              <Field
                label="First name"
                htmlFor="admin_first_name"
                error={fieldErrors.admin_first_name}
              >
                <input
                  id="admin_first_name"
                  name="admin_first_name"
                  value={adminFirstName}
                  onChange={(event) => setAdminFirstName(event.target.value)}
                  className={FIELD_INPUT_CLASS}
                  aria-invalid={Boolean(fieldErrors.admin_first_name)}
                />
              </Field>
              <Field
                label="Last name"
                htmlFor="admin_last_name"
                error={fieldErrors.admin_last_name}
              >
                <input
                  id="admin_last_name"
                  name="admin_last_name"
                  value={adminLastName}
                  onChange={(event) => setAdminLastName(event.target.value)}
                  className={FIELD_INPUT_CLASS}
                  aria-invalid={Boolean(fieldErrors.admin_last_name)}
                />
              </Field>
            </div>
          </fieldset>

          {formError ? (
            <p
              role="alert"
              className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700"
            >
              {formError}
            </p>
          ) : null}

          <div className="flex items-center gap-3">
            <Button type="submit" loading={submitting} loadingLabel="Provisioning…">
              Provision company
            </Button>
            <Link
              to="/admin/companies"
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
