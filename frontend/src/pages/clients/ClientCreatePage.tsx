import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'

import { createClient } from '../../api/clients'
import { Button } from '../../components/ui/Button'
import { Field } from '../../components/ui/Field'
import { PageContainer } from '../../components/ui/PageContainer'
import { FIELD_INPUT_CLASS } from '../../components/ui/formClasses'
import { ApiError, HTTP_STATUS } from '../../types/api'
import type { ClientStatus, ClientType } from '../../types/client'

type Errors = Record<string, string>

function firstFieldErrors(error: ApiError): Errors {
  const result: Errors = {}
  for (const [key, messages] of Object.entries(error.fieldErrors)) {
    if (messages.length > 0) result[key] = messages[0]
  }
  return result
}

function orNull(value: string): string | null {
  const trimmed = value.trim()
  return trimmed ? trimmed : null
}

function formMessageFor(error: ApiError, fieldErrors: Errors): string | undefined {
  if (error.status === HTTP_STATUS.FORBIDDEN) {
    return 'You do not have permission to create clients.'
  }
  if (error.status === HTTP_STATUS.TOO_MANY_REQUESTS) {
    return error.retryAfterSeconds !== null
      ? `Too many attempts. Please wait ${error.retryAfterSeconds} seconds and try again.`
      : 'Too many attempts. Please wait a moment and try again.'
  }
  if (Object.keys(fieldErrors).length === 0) {
    return error.message || 'Client creation failed. Please try again.'
  }
  return error.fieldErrors.non_field_errors?.[0]
}

/**
 * Create-client form (`POST /api/clients/`). Fields follow the backend
 * `ClientSerializer`: `client_type` + the matching subtype object. The company
 * is never sent — the backend takes it from the authenticated user.
 */
export function ClientCreatePage() {
  const navigate = useNavigate()
  const [clientType, setClientType] = useState<ClientType>('legal_entity')
  const [status, setStatus] = useState<ClientStatus>('active')
  const [legal, setLegal] = useState({
    legal_name: '',
    trading_name: '',
    voen: '',
    registration_number: '',
    registration_date: '',
  })
  const [individual, setIndividual] = useState({
    first_name: '',
    last_name: '',
    middle_name: '',
    date_of_birth: '',
  })
  const [fieldErrors, setFieldErrors] = useState<Errors>({})
  const [formError, setFormError] = useState<string>()
  const [submitting, setSubmitting] = useState(false)

  const setField = (
    group: 'legal' | 'individual',
    field: string,
    value: string,
  ) => {
    if (group === 'legal') {
      setLegal((prev) => ({ ...prev, [field]: value }))
    } else {
      setIndividual((prev) => ({ ...prev, [field]: value }))
    }
  }

  function validate(): Errors {
    const errors: Errors = {}
    if (clientType === 'legal_entity') {
      if (!legal.legal_name.trim()) errors['legal_entity.legal_name'] = 'Legal entity name is required.'
      if (!legal.voen.trim()) errors['legal_entity.voen'] = 'VOEN is required.'
    } else {
      if (!individual.first_name.trim()) errors['individual.first_name'] = 'First name is required.'
      if (!individual.last_name.trim()) errors['individual.last_name'] = 'Last name is required.'
    }
    return errors
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (submitting) return

    const localErrors = validate()
    setFieldErrors(localErrors)
    setFormError(undefined)
    if (Object.keys(localErrors).length > 0) return

    const payload =
      clientType === 'legal_entity'
        ? {
            client_type: clientType,
            status,
            legal_entity: {
              legal_name: legal.legal_name.trim(),
              trading_name: orNull(legal.trading_name),
              voen: legal.voen.trim(),
              registration_number: orNull(legal.registration_number),
              registration_date: orNull(legal.registration_date),
            },
          }
        : {
            client_type: clientType,
            status,
            individual: {
              first_name: individual.first_name.trim(),
              last_name: individual.last_name.trim(),
              middle_name: orNull(individual.middle_name),
              date_of_birth: orNull(individual.date_of_birth),
            },
          }

    setSubmitting(true)
    try {
      const created = await createClient(payload)
      navigate(`/clients/${created.id}`)
    } catch (error) {
      if (error instanceof ApiError) {
        const errors = firstFieldErrors(error)
        setFieldErrors(errors)
        setFormError(formMessageFor(error, errors))
      } else {
        setFormError('Client creation failed. Please try again.')
      }
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <PageContainer title="New client">
      <div className="max-w-2xl rounded-lg border border-slate-200 bg-white p-6">
        <form onSubmit={handleSubmit} className="space-y-4" noValidate>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Client type" htmlFor="client_type" required>
              <select
                id="client_type"
                name="client_type"
                value={clientType}
                onChange={(event) => setClientType(event.target.value as ClientType)}
                className={FIELD_INPUT_CLASS}
                aria-invalid={Boolean(fieldErrors.client_type)}
                aria-describedby={fieldErrors.client_type ? 'client_type-error' : undefined}
              >
                <option value="legal_entity">Legal entity</option>
                <option value="individual">Individual</option>
              </select>
            </Field>
            <Field label="Status" htmlFor="status">
              <select
                id="status"
                name="status"
                value={status}
                onChange={(event) => setStatus(event.target.value as ClientStatus)}
                className={FIELD_INPUT_CLASS}
                aria-invalid={Boolean(fieldErrors.status)}
                aria-describedby={fieldErrors.status ? 'status-error' : undefined}
              >
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
                <option value="archived">Archived</option>
              </select>
            </Field>
          </div>

          {clientType === 'legal_entity' ? (
            <div className="space-y-4">
              <Field label="Legal name" htmlFor="legal_name" required error={fieldErrors['legal_entity.legal_name']}>
                <input
                  id="legal_name"
                  name="legal_entity.legal_name"
                  value={legal.legal_name}
                  onChange={(event) => setField('legal', 'legal_name', event.target.value)}
                  className={FIELD_INPUT_CLASS}
                  aria-invalid={Boolean(fieldErrors['legal_entity.legal_name'])}
                  aria-describedby={
                    fieldErrors['legal_entity.legal_name'] ? 'legal_name-error' : undefined
                  }
                />
              </Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Trading name" htmlFor="trading_name" error={fieldErrors['legal_entity.trading_name']}>
                  <input
                    id="trading_name"
                    name="legal_entity.trading_name"
                    value={legal.trading_name}
                    onChange={(event) => setField('legal', 'trading_name', event.target.value)}
                    className={FIELD_INPUT_CLASS}
                  />
                </Field>
                <Field label="VOEN" htmlFor="voen" required error={fieldErrors['legal_entity.voen']}>
                  <input
                    id="voen"
                    name="legal_entity.voen"
                    value={legal.voen}
                    onChange={(event) => setField('legal', 'voen', event.target.value)}
                    className={FIELD_INPUT_CLASS}
                    aria-invalid={Boolean(fieldErrors['legal_entity.voen'])}
                    aria-describedby={fieldErrors['legal_entity.voen'] ? 'voen-error' : undefined}
                  />
                </Field>
                <Field label="Registration number" htmlFor="registration_number" error={fieldErrors['legal_entity.registration_number']}>
                  <input
                    id="registration_number"
                    name="legal_entity.registration_number"
                    value={legal.registration_number}
                    onChange={(event) => setField('legal', 'registration_number', event.target.value)}
                    className={FIELD_INPUT_CLASS}
                  />
                </Field>
                <Field label="Registration date" htmlFor="registration_date" error={fieldErrors['legal_entity.registration_date']}>
                  <input
                    id="registration_date"
                    name="legal_entity.registration_date"
                    type="date"
                    value={legal.registration_date}
                    onChange={(event) => setField('legal', 'registration_date', event.target.value)}
                    className={FIELD_INPUT_CLASS}
                  />
                </Field>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="First name" htmlFor="first_name" required error={fieldErrors['individual.first_name']}>
                  <input
                    id="first_name"
                    name="individual.first_name"
                    value={individual.first_name}
                    onChange={(event) => setField('individual', 'first_name', event.target.value)}
                    className={FIELD_INPUT_CLASS}
                    aria-invalid={Boolean(fieldErrors['individual.first_name'])}
                    aria-describedby={
                      fieldErrors['individual.first_name'] ? 'first_name-error' : undefined
                    }
                  />
                </Field>
                <Field label="Last name" htmlFor="last_name" required error={fieldErrors['individual.last_name']}>
                  <input
                    id="last_name"
                    name="individual.last_name"
                    value={individual.last_name}
                    onChange={(event) => setField('individual', 'last_name', event.target.value)}
                    className={FIELD_INPUT_CLASS}
                    aria-invalid={Boolean(fieldErrors['individual.last_name'])}
                    aria-describedby={
                      fieldErrors['individual.last_name'] ? 'last_name-error' : undefined
                    }
                  />
                </Field>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Middle name" htmlFor="middle_name" error={fieldErrors['individual.middle_name']}>
                  <input
                    id="middle_name"
                    name="individual.middle_name"
                    value={individual.middle_name}
                    onChange={(event) => setField('individual', 'middle_name', event.target.value)}
                    className={FIELD_INPUT_CLASS}
                  />
                </Field>
                <Field label="Date of birth" htmlFor="date_of_birth" error={fieldErrors['individual.date_of_birth']}>
                  <input
                    id="date_of_birth"
                    name="individual.date_of_birth"
                    type="date"
                    value={individual.date_of_birth}
                    onChange={(event) => setField('individual', 'date_of_birth', event.target.value)}
                    className={FIELD_INPUT_CLASS}
                  />
                </Field>
              </div>
            </div>
          )}

          {formError ? (
            <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
              {formError}
            </p>
          ) : null}

          <div className="flex items-center gap-3">
            <Button type="submit" loading={submitting} loadingLabel="Creating…">
              Create client
            </Button>
            <Link to="/clients" className="text-sm text-slate-600 underline hover:text-slate-900">
              Cancel
            </Link>
          </div>
        </form>
      </div>
    </PageContainer>
  )
}