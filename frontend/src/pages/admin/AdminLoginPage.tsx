import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'

import { Button } from '../../components/ui/Button'
import { Field } from '../../components/ui/Field'
import { FIELD_INPUT_CLASS } from '../../components/ui/formClasses'
import { useAdminAuth } from '../../contexts/admin-auth-context'
import { ApiError, HTTP_STATUS } from '../../types/api'

interface FormErrors {
  email?: string
  password?: string
  form?: string
}

function fieldErrorsFrom(error: ApiError): FormErrors {
  const result: FormErrors = {}
  const email = error.fieldErrors.email?.[0]
  const password = error.fieldErrors.password?.[0]
  if (email) result.email = email
  if (password) result.password = password
  return result
}

/**
 * System Admin sign-in form (`POST /api/admin/authentication/token/`).
 *
 * Unlike the company login, this does not collect a company id: the backend
 * resolves the reserved platform company server-side. All failures are shown as
 * generic, safe messages — nothing reveals whether an account exists. On
 * success the AdminAuthContext loads Admin `/me` and the user lands on the
 * Admin dashboard.
 */
export function AdminLoginPage() {
  const { login } = useAdminAuth()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [errors, setErrors] = useState<FormErrors>({})
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (submitting) return

    const nextErrors: FormErrors = {}
    if (!email.trim()) {
      nextErrors.email = 'Email is required.'
    }
    if (!password) {
      nextErrors.password = 'Password is required.'
    }
    setErrors(nextErrors)
    if (Object.keys(nextErrors).length > 0) return

    setSubmitting(true)
    try {
      await login(email.trim(), password)
      navigate('/admin/dashboard', { replace: true })
    } catch (error) {
      if (error instanceof ApiError) {
        const fieldErrors = fieldErrorsFrom(error)
        const hasFieldErrors = Object.keys(fieldErrors).length > 0
        let formError: string | undefined
        if (error.status === HTTP_STATUS.UNAUTHORIZED) {
          formError = 'Invalid credentials. Please check your input and try again.'
        } else if (error.status === HTTP_STATUS.FORBIDDEN) {
          formError = 'This account is not authorized as a System Admin.'
        } else if (error.status === HTTP_STATUS.TOO_MANY_REQUESTS) {
          formError =
            error.retryAfterSeconds !== null
              ? `Too many attempts. Please wait ${error.retryAfterSeconds} seconds and try again.`
              : 'Too many attempts. Please wait a moment and try again.'
        } else if (!hasFieldErrors) {
          formError = error.message || 'Sign-in failed. Please try again.'
        }
        setErrors({ ...fieldErrors, ...(formError ? { form: formError } : {}) })
      } else {
        setErrors({ form: 'Sign-in failed. Please try again.' })
      }
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="space-y-4 rounded-lg border border-slate-200 bg-white p-6">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">
          System Admin sign in
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          Platform administration access only.
        </p>
      </div>
      <form onSubmit={handleSubmit} className="space-y-4" noValidate>
        <Field label="Email" htmlFor="admin-email" required error={errors.email}>
          <input
            id="admin-email"
            name="email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            aria-invalid={Boolean(errors.email)}
            aria-describedby={errors.email ? 'admin-email-error' : undefined}
            className={FIELD_INPUT_CLASS}
          />
        </Field>

        <Field
          label="Password"
          htmlFor="admin-password"
          required
          error={errors.password}
        >
          <input
            id="admin-password"
            name="password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            aria-invalid={Boolean(errors.password)}
            aria-describedby={
              errors.password ? 'admin-password-error' : undefined
            }
            className={FIELD_INPUT_CLASS}
          />
        </Field>

        {errors.form ? (
          <p
            role="alert"
            className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700"
          >
            {errors.form}
          </p>
        ) : null}

        <Button type="submit" loading={submitting} loadingLabel="Signing in…">
          Sign in
        </Button>
      </form>
    </div>
  )
}
