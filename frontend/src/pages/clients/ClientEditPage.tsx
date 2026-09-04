import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'

import { getClient, updateClient } from '../../api/clients'
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
    return 'You do not have permission to edit this client.'
  }
  if (error.status === HTTP_STATUS.TOO_MANY_REQUESTS) {
    return error.retryAfterSeconds !== null
      ? `Too many attempts. Please wait ${error.retryAfterSeconds} seconds and try again.`
      : 'Too many attempts. Please wait a moment and try again.'
  }
  if (Object.keys(fieldErrors).length === 0) {
    return error.message || 'Client update failed. Please try again.'
  }
  return error.fieldErrors.non_field_errors?.[0]
}

/**
 * Edit-client form (`PATCH /api/clients/:id/`). `client_type` is immutable on
 * the backend, so the type select is shown disabled. Only the matching subtype
 * is edited and sent. The company is never sent — it stays the authenticated
 * user's company.
 */
export function ClientEditPage() {
  const { clientId } = useParams()
  const id = Number(clientId)
  const navigate = useNavigate()

  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string>()
  const [notFound, setNotFound] = useState(false)

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

  const load = useCallback(() => {
    void getClient(id)
      .then((data) => {
        setClientType(data.client_type)
        setStatus(data.status)
        setLegal({
          legal_name: data.legal_entity?.legal_name ?? '',
          trading_name: data.legal_entity?.trading_name ?? '',
          voen: data.legal_entity?.voen ?? '',
          registration_number: data.legal_entity?.registration_number ?? '',
          registration_date: data.legal_entity?.registration_date ?? '',
        })
        setIndividual({
          first_name: data.individual?.first_name ?? '',
          last_name: data.individual?.last_name ?? '',
          middle_name: data.individual?.middle_name ?? '',
          date_of_birth: data.individual?.date_of_birth ?? '',
        })
        setNotFound(false)
        setLoadError(undefined)
      })
      .catch((error: unknown) => {
        if (error instanceof ApiError && error.status === HTTP_STATUS.NOT_FOUND) {
          setNotFound(true)
        } else if (error instanceof ApiError && error.status === HTTP_STATUS.FORBIDDEN) {
          setLoadError('You do not have permission to edit this client.')
        } else {
          setLoadError("Couldn't load the client.")
        }
      })
      .finally(() => setLoading(false))
  }, [id])

  const setField = (group: 'legal' | 'individual', field: string, value: string) => {
    if (group === 'legal') {
      setLegal((prev) => ({ ...prev, [field]: value }))
    } else {
      setIndividual((prev) => ({ ...prev, [field]: value }))
    }
  }

  useEffect(() => {
    if (!Number.isNaN(id)) void load()
  }, [id, load])

  function retryLoad() {
    setLoading(true)
    void load()
  }

  function validate(): Errors {
    const errors: Errors = {}
    if (clientType === 'legal_entity') {
      if (!legal.legal_name.trim()) errors['legal_entity.legal_name'] = 'Legal entity name is required.'
      if (!legal.voen.trim()) errors['legal_entity.voen'] = 'VOEN is required.'
    } else if (!individual.first_name.trim()) {
      errors['individual.first_name'] = 'First name is required.'
    } else if (!individual.last_name.trim()) {
      errors['individual.last_name'] = 'Last name is required.'
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
      await updateClient(id, payload)
      navigate(`/clients/${id}`)
    } catch (error) {
      if (error instanceof ApiError) {
        const errors = firstFieldErrors(error)
        setFieldErrors(errors)
        setFormError(formMessageFor(error, errors))
      } else {
        setFormError('Client update failed. Please try again.')
      }
    } finally {
      setSubmitting(false)
    }
  }

  if (Number.isNaN(id)) {
    return (
      <PageContainer title="Edit client">
        <p className="text-sm text-slate-600">Client not found.</p>
        <Link to="/clients" className="text-sm text-slate-600 underline hover:text-slate-900">
          Back to clients
        </Link>
      </PageContainer>
    )
  }

  if (loading) {
    return (
      <PageContainer title="Edit client">
        <p data-testid="client-loading" className="animate-pulse text-sm text-slate-400">
          Loading…
        </p>
      </PageContainer>
    )
  }

  if (notFound) {
    return (
      <PageContainer title="Edit client">
        <p className="text-sm text-slate-600">Client not found.</p>
        <Link to="/clients" className="text-sm text-slate-600 underline hover:text-slate-900">
          Back to clients
        </Link>
      </PageContainer>
    )
  }

  if (loadError) {
    return (
      <PageContainer title="Edit client">
        <div role="alert" className="rounded-md bg-red-50 px-4 py-3 text-sm text-red-700">
          {loadError}
        </div>
        <Button variant="secondary" onClick={retryLoad}>
          Retry
        </Button>
      </PageContainer>
    )
  }

  return (
    <PageContainer title={`Edit client #${id}`}>
      <div className="max-w-2xl rounded-lg border border-slate-200 bg-white p-6">
        <form onSubmit={handleSubmit} className="space-y-4" noValidate>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Client type" htmlFor="client_type" required>
              <select
                id="client_type"
                value={clientType}
                disabled
                className={`${FIELD_INPUT_CLASS} disabled:opacity-60`}
              >
                <option value="legal_entity">Legal entity</option>
                <option value="individual">Individual</option>
              </select>
            </Field>
            <Field label="Status" htmlFor="status" error={fieldErrors.status}>
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
            <Button type="submit" loading={submitting} loadingLabel="Saving…">
              Save changes
            </Button>
            <Link to={`/clients/${id}`} className="text-sm text-slate-600 underline hover:text-slate-900">
              Cancel
            </Link>
          </div>
        </form>
      </div>
    </PageContainer>
  )
}