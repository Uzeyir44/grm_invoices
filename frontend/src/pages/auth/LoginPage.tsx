import { useState, type FormEvent } from 'react'

import { useAuth } from '../../contexts/auth-context'
import { ApiError, HTTP_STATUS } from '../../types/api'

interface FormErrors {
  company_id?: string
  email?: string
  password?: string
  form?: string
}

function fieldErrorsFrom(error: ApiError): FormErrors {
  const result: FormErrors = {}
  const companyId = error.fieldErrors.company_id?.[0]
  const email = error.fieldErrors.email?.[0]
  const password = error.fieldErrors.password?.[0]
  if (companyId) result.company_id = companyId
  if (email) result.email = email
  if (password) result.password = password
  return result
}

/**
 * Sign-in form for the company-scoped JWT login.
 *
 * The backend identifies the tenant up front (`company_id` is a required
 * login-time lookup key because email is unique per company). All failures are
 * shown as generic, safe messages — nothing reveals whether an account exists.
 */
export function LoginPage() {
  const { login } = useAuth()
  const [companyId, setCompanyId] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [errors, setErrors] = useState<FormErrors>({})
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (submitting) return

    const nextErrors: FormErrors = {}
    const companyIdValue = companyId.trim()
    if (!companyIdValue) {
      nextErrors.company_id = 'Company ID is required.'
    } else if (!/^\d+$/.test(companyIdValue)) {
      nextErrors.company_id = 'Company ID must be a number.'
    }
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
      await login(Number(companyIdValue), email.trim(), password)
      // The router redirects the now-authenticated user to /dashboard.
    } catch (error) {
      if (error instanceof ApiError) {
        const fieldErrors = fieldErrorsFrom(error)
        const hasFieldErrors = Object.keys(fieldErrors).length > 0
        let formError: string | undefined
        if (error.status === HTTP_STATUS.UNAUTHORIZED) {
          formError = 'Invalid credentials. Please check your input and try again.'
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
      <h1 className="text-xl font-semibold text-slate-900">Sign in</h1>
      <form onSubmit={handleSubmit} className="space-y-4" noValidate>
        <div>
          <label
            htmlFor="login-company-id"
            className="mb-1 block text-sm font-medium text-slate-700"
          >
            Company ID
          </label>
          <input
            id="login-company-id"
            name="company_id"
            type="text"
            inputMode="numeric"
            autoComplete="organization"
            value={companyId}
            onChange={(event) => setCompanyId(event.target.value)}
            aria-invalid={Boolean(errors.company_id)}
            aria-describedby={errors.company_id ? 'login-company-id-error' : undefined}
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none"
          />
          {errors.company_id && (
            <p id="login-company-id-error" className="mt-1 text-sm text-red-600">
              {errors.company_id}
            </p>
          )}
        </div>

        <div>
          <label
            htmlFor="login-email"
            className="mb-1 block text-sm font-medium text-slate-700"
          >
            Email
          </label>
          <input
            id="login-email"
            name="email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            aria-invalid={Boolean(errors.email)}
            aria-describedby={errors.email ? 'login-email-error' : undefined}
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none"
          />
          {errors.email && (
            <p id="login-email-error" className="mt-1 text-sm text-red-600">
              {errors.email}
            </p>
          )}
        </div>

        <div>
          <label
            htmlFor="login-password"
            className="mb-1 block text-sm font-medium text-slate-700"
          >
            Password
          </label>
          <input
            id="login-password"
            name="password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            aria-invalid={Boolean(errors.password)}
            aria-describedby={errors.password ? 'login-password-error' : undefined}
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none"
          />
          {errors.password && (
            <p id="login-password-error" className="mt-1 text-sm text-red-600">
              {errors.password}
            </p>
          )}
        </div>

        {errors.form && (
          <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
            {errors.form}
          </p>
        )}

        <button
          type="submit"
          disabled={submitting}
          className="w-full rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {submitting ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </div>
  )
}