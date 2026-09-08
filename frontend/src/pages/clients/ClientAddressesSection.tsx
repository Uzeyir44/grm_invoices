import { useCallback, useEffect, useState, type FormEvent } from 'react'

import {
  createClientAddress,
  deleteClientAddress,
  listClientAddresses,
  updateClientAddress,
} from '../../api/clients'
import { fetchAddressTypes } from '../../api/referenceData'
import { Button } from '../../components/ui/Button'
import { Field } from '../../components/ui/Field'
import { FIELD_INPUT_CLASS } from '../../components/ui/formClasses'
import { ApiError, HTTP_STATUS } from '../../types/api'
import type { ClientAddress, ClientAddressInput } from '../../types/client'
import type { AddressType } from '../../types/referenceData'

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

function loadErrorMessage(error: ApiError): string {
  if (error.status === HTTP_STATUS.FORBIDDEN) {
    return 'You do not have permission to view addresses.'
  }
  if (error.status === HTTP_STATUS.NOT_FOUND) {
    return 'The client was not found.'
  }
  if (error.status === HTTP_STATUS.TOO_MANY_REQUESTS) {
    return error.retryAfterSeconds !== null
      ? `Too many requests. Please wait ${error.retryAfterSeconds} seconds and try again.`
      : 'Too many requests. Please wait a moment and try again.'
  }
  // Fixed generic message (list-page convention) — never raw backend text.
  return "Couldn't load addresses."
}

function mutationErrorMessage(error: ApiError, verb: string): string {
  if (error.status === HTTP_STATUS.FORBIDDEN) {
    return 'You do not have permission to manage addresses.'
  }
  if (error.status === HTTP_STATUS.NOT_FOUND) {
    return 'The client or address was not found.'
  }
  if (error.status === HTTP_STATUS.TOO_MANY_REQUESTS) {
    return error.retryAfterSeconds !== null
      ? `Too many requests. Please wait ${error.retryAfterSeconds} seconds and try again.`
      : 'Too many requests. Please wait a moment and try again.'
  }
  return error.message || `Could not ${verb} the address. Please try again.`
}

interface AddressFormValues {
  address_type: string
  line1: string
  line2: string
  city: string
  region: string
  postal_code: string
  country_code: string
  is_primary: boolean
}

const EMPTY_FORM: AddressFormValues = {
  address_type: '',
  line1: '',
  line2: '',
  city: '',
  region: '',
  postal_code: '',
  country_code: '',
  is_primary: false,
}

function valuesFor(address: ClientAddress): AddressFormValues {
  return {
    address_type: String(address.address_type),
    line1: address.line1,
    line2: address.line2 ?? '',
    city: address.city ?? '',
    region: address.region ?? '',
    postal_code: address.postal_code ?? '',
    country_code: address.country_code,
    is_primary: address.is_primary,
  }
}

function formatAddress(address: ClientAddress): string {
  return [
    address.line1,
    address.line2,
    address.city,
    address.region,
    address.postal_code,
    address.country_code,
  ]
    .filter((part) => part && part.trim())
    .join(', ')
}

/**
 * Manageable Addresses section for the client detail page, backed by the
 * tenant- and parent-scoped nested address endpoints
 * (`GET/POST /api/clients/:id/addresses/`,
 * `PATCH/DELETE /api/clients/:id/addresses/:address_id/`).
 *
 * The address collection is fetched independently of the client detail so the
 * section has its own loading/error/retry states; after every successful
 * mutation the collection is refetched from the backend. Address types come
 * from the real `GET /api/reference-data/address-types/` catalog — never
 * hardcoded. Contacts and bank accounts are out of scope and untouched.
 */
export function ClientAddressesSection({ clientId }: { clientId: number }) {
  const [addresses, setAddresses] = useState<ClientAddress[] | null>(null)
  const [loadError, setLoadError] = useState<ApiError | null>(null)
  const [reloadKey, setReloadKey] = useState(0)

  const [addressTypes, setAddressTypes] = useState<AddressType[] | null>(null)
  const [typesError, setTypesError] = useState(false)
  const [typesReloadKey, setTypesReloadKey] = useState(0)
  const [typesRequested, setTypesRequested] = useState(false)

  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<ClientAddress | null>(null)
  const [values, setValues] = useState<AddressFormValues>(EMPTY_FORM)
  const [fieldErrors, setFieldErrors] = useState<Errors>({})
  const [formError, setFormError] = useState<string>()
  const [submitting, setSubmitting] = useState(false)

  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null)
  const [deletingId, setDeletingId] = useState<number | null>(null)
  const [deleteError, setDeleteError] = useState<string>()
  const [notice, setNotice] = useState<string>()

  const loadAddresses = useCallback(() => {
    void listClientAddresses(clientId)
      .then((data) => {
        setAddresses(data)
        setLoadError(null)
      })
      .catch((error: unknown) => {
        setLoadError(
          error instanceof ApiError
            ? error
            : new ApiError({ status: 0, payload: null, message: "Couldn't load addresses." }),
        )
      })
  }, [clientId])

  useEffect(() => {
    loadAddresses()
  }, [clientId, reloadKey, loadAddresses])

  // The type catalog is only needed for the form; load it lazily on first
  // open so the section does not depend on a second catalog to display rows.
  useEffect(() => {
    if (!typesRequested) return
    let cancelled = false
    void fetchAddressTypes()
      .then((data) => {
        if (cancelled) return
        setAddressTypes(data)
        setTypesError(false)
      })
      .catch(() => {
        if (cancelled) return
        setTypesError(true)
      })
    return () => {
      cancelled = true
    }
  }, [typesRequested, typesReloadKey])

  const retry = () => setReloadKey((key) => key + 1)

  function openCreate() {
    setEditing(null)
    setValues(EMPTY_FORM)
    setFieldErrors({})
    setFormError(undefined)
    setNotice(undefined)
    setFormOpen(true)
    setTypesRequested(true)
  }

  function openEdit(address: ClientAddress) {
    setEditing(address)
    setValues(valuesFor(address))
    setFieldErrors({})
    setFormError(undefined)
    setNotice(undefined)
    setFormOpen(true)
    setTypesRequested(true)
  }

  function closeForm() {
    setFormOpen(false)
    setEditing(null)
    setFieldErrors({})
    setFormError(undefined)
  }

  function setValue<K extends keyof AddressFormValues>(field: K, value: AddressFormValues[K]) {
    setValues((prev) => ({ ...prev, [field]: value }))
  }

  function validate(): Errors {
    const errors: Errors = {}
    if (!values.address_type.trim() || !Number.isFinite(Number(values.address_type))) {
      errors.address_type = 'Address type is required.'
    }
    if (!values.line1.trim()) {
      errors.line1 = 'Street address is required.'
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

    // `country_code` is not nullable on the backend (it has a default), so an
    // empty value is omitted rather than sent as null; the other optional
    // fields are nullable and sent as null when empty.
    const countryCode = values.country_code.trim()
    const payload: ClientAddressInput = {
      address_type: Number(values.address_type),
      line1: values.line1.trim(),
      line2: orNull(values.line2),
      city: orNull(values.city),
      region: orNull(values.region),
      postal_code: orNull(values.postal_code),
      is_primary: values.is_primary,
      ...(countryCode ? { country_code: countryCode } : {}),
    }

    setSubmitting(true)
    try {
      if (editing) {
        await updateClientAddress(clientId, editing.id, payload)
        setNotice('Address updated.')
      } else {
        await createClientAddress(clientId, payload)
        setNotice('Address added.')
      }
      closeForm()
      loadAddresses()
    } catch (error) {
      if (error instanceof ApiError) {
        const backendFieldErrors = firstFieldErrors(error)
        setFieldErrors(backendFieldErrors)
        setFormError(
          Object.keys(backendFieldErrors).length === 0 || error.status !== HTTP_STATUS.BAD_REQUEST
            ? mutationErrorMessage(error, editing ? 'update' : 'add')
            : error.fieldErrors.non_field_errors?.[0],
        )
      } else {
        setFormError(editing ? 'Could not update the address.' : 'Could not add the address.')
      }
    } finally {
      setSubmitting(false)
    }
  }

  async function handleDelete(addressId: number) {
    if (deletingId !== null) return
    setDeletingId(addressId)
    setDeleteError(undefined)
    setNotice(undefined)
    try {
      await deleteClientAddress(clientId, addressId)
      setConfirmDeleteId(null)
      setNotice('Address deleted.')
      loadAddresses()
    } catch (error) {
      setDeleteError(
        error instanceof ApiError
          ? mutationErrorMessage(error, 'delete')
          : 'Could not delete the address.',
      )
    } finally {
      setDeletingId(null)
    }
  }

  return (
    <section aria-label="Addresses">
      <h2 className="mb-1 text-sm font-semibold text-slate-700">Addresses</h2>

      {notice ? (
        <p role="status" className="mb-2 text-sm text-emerald-700">
          {notice}
        </p>
      ) : null}

      {loadError ? (
        <div role="alert" className="rounded-md bg-red-50 px-4 py-3 text-sm text-red-700">
          {loadErrorMessage(loadError)}
          <button
            type="button"
            onClick={retry}
            className="ml-3 font-medium text-slate-700 underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-slate-500"
          >
            Retry
          </button>
        </div>
      ) : null}

      {addresses === null && !loadError ? (
        <p role="status" className="animate-pulse text-sm text-slate-400">
          Loading addresses…
        </p>
      ) : null}

      {addresses !== null && !loadError ? (
        <div className="space-y-3">
          {addresses.length === 0 && !formOpen ? (
            <div className="rounded-lg border border-dashed border-slate-300 px-4 py-6 text-center">
              <p className="text-sm text-slate-500">No addresses found.</p>
              <Button variant="secondary" onClick={openCreate} className="mt-2">
                Add address
              </Button>
            </div>
          ) : null}

          {addresses.length > 0 ? (
            <ul className="divide-y divide-slate-200 rounded-lg border border-slate-200 bg-white text-sm">
              {addresses.map((address) => (
                <li
                  key={address.id}
                  className="flex flex-wrap items-center justify-between gap-2 px-4 py-2"
                >
                  <div className="min-w-0 text-slate-700">
                    <span className="font-medium text-slate-900">{formatAddress(address)}</span>
                    {address.address_type_code ? (
                      <span className="text-slate-500"> · {address.address_type_code}</span>
                    ) : null}
                    {address.is_primary ? (
                      <span className="text-slate-500"> · primary</span>
                    ) : null}
                  </div>
                  <div className="flex items-center gap-2">
                    <Button variant="secondary" onClick={() => openEdit(address)}>
                      Edit
                    </Button>
                    {confirmDeleteId === address.id ? (
                      <span className="flex items-center gap-2 text-sm text-slate-700">
                        Delete this address?
                        <Button
                          variant="danger"
                          loading={deletingId === address.id}
                          loadingLabel="Deleting…"
                          onClick={() => void handleDelete(address.id)}
                        >
                          Yes, delete
                        </Button>
                        <Button
                          variant="secondary"
                          onClick={() => {
                            setConfirmDeleteId(null)
                            setDeleteError(undefined)
                          }}
                        >
                          Cancel
                        </Button>
                      </span>
                    ) : (
                      <Button variant="danger" onClick={() => setConfirmDeleteId(address.id)}>
                        Delete
                      </Button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          ) : null}

          {(addresses.length > 0 || formOpen) && !formOpen ? (
            <div>
              <Button variant="secondary" onClick={openCreate}>
                Add address
              </Button>
            </div>
          ) : null}

          {deleteError ? (
            <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
              {deleteError}
            </p>
          ) : null}

          {formOpen ? (
            <form
              aria-label={editing ? 'Edit address' : 'Add address'}
              onSubmit={(event) => void handleSubmit(event)}
              className="space-y-3 rounded-lg border border-slate-200 bg-white p-4"
            >
              <h3 className="text-sm font-semibold text-slate-700">
                {editing ? 'Edit address' : 'Add address'}
              </h3>

              {typesError || addressTypes === null ? (
                <div>
                  {typesError ? (
                    <p role="alert" className="text-sm text-red-700">
                      Couldn't load address types.{' '}
                      <button
                        type="button"
                        onClick={() => setTypesReloadKey((key) => key + 1)}
                        className="font-medium text-slate-700 underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-slate-500"
                      >
                        Retry
                      </button>
                    </p>
                  ) : (
                    <p role="status" className="animate-pulse text-sm text-slate-400">
                      Loading address types…
                    </p>
                  )}
                </div>
              ) : null}

              {formError ? (
                <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
                  {formError}
                </p>
              ) : null}

              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Address type" htmlFor="client-address-type" required error={fieldErrors.address_type}>
                  <select
                    id="client-address-type"
                    value={values.address_type}
                    onChange={(event) => setValue('address_type', event.target.value)}
                    disabled={addressTypes === null || submitting}
                    aria-invalid={Boolean(fieldErrors.address_type)}
                    aria-describedby={fieldErrors.address_type ? 'client-address-type-error' : undefined}
                    className={FIELD_INPUT_CLASS}
                  >
                    <option value="">Select address type</option>
                    {(addressTypes ?? []).map((type) => (
                      <option key={type.id} value={String(type.id)}>
                        {type.code}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Street address" htmlFor="client-address-line1" required error={fieldErrors.line1}>
                  <input
                    id="client-address-line1"
                    type="text"
                    value={values.line1}
                    onChange={(event) => setValue('line1', event.target.value)}
                    aria-invalid={Boolean(fieldErrors.line1)}
                    aria-describedby={fieldErrors.line1 ? 'client-address-line1-error' : undefined}
                    className={FIELD_INPUT_CLASS}
                  />
                </Field>
                <Field label="Address line 2" htmlFor="client-address-line2" error={fieldErrors.line2}>
                  <input
                    id="client-address-line2"
                    type="text"
                    value={values.line2}
                    onChange={(event) => setValue('line2', event.target.value)}
                    className={FIELD_INPUT_CLASS}
                  />
                </Field>
                <Field label="City" htmlFor="client-address-city" error={fieldErrors.city}>
                  <input
                    id="client-address-city"
                    type="text"
                    value={values.city}
                    onChange={(event) => setValue('city', event.target.value)}
                    className={FIELD_INPUT_CLASS}
                  />
                </Field>
                <Field label="Region" htmlFor="client-address-region" error={fieldErrors.region}>
                  <input
                    id="client-address-region"
                    type="text"
                    value={values.region}
                    onChange={(event) => setValue('region', event.target.value)}
                    className={FIELD_INPUT_CLASS}
                  />
                </Field>
                <Field label="Postal code" htmlFor="client-address-postal-code" error={fieldErrors.postal_code}>
                  <input
                    id="client-address-postal-code"
                    type="text"
                    value={values.postal_code}
                    onChange={(event) => setValue('postal_code', event.target.value)}
                    className={FIELD_INPUT_CLASS}
                  />
                </Field>
                <Field
                  label="Country code"
                  htmlFor="client-address-country-code"
                  error={fieldErrors.country_code}
                >
                  <input
                    id="client-address-country-code"
                    type="text"
                    value={values.country_code}
                    onChange={(event) => setValue('country_code', event.target.value)}
                    maxLength={2}
                    placeholder="AZ"
                    className={FIELD_INPUT_CLASS}
                  />
                </Field>
                <div className="flex items-center gap-2 text-sm text-slate-700">
                  <input
                    id="client-address-is-primary"
                    type="checkbox"
                    checked={values.is_primary}
                    onChange={(event) => setValue('is_primary', event.target.checked)}
                    aria-describedby={fieldErrors.is_primary ? 'client-address-is-primary-error' : undefined}
                    className="h-4 w-4 rounded border-slate-300"
                  />
                  <label htmlFor="client-address-is-primary">
                    Primary address
                  </label>
                </div>
              </div>
              {fieldErrors.is_primary ? (
                <p id="client-address-is-primary-error" className="text-sm text-red-600">
                  {fieldErrors.is_primary}
                </p>
              ) : null}

              <div className="flex flex-wrap items-center gap-3">
                <Button
                  type="submit"
                  variant="primary"
                  loading={submitting}
                  loadingLabel={editing ? 'Saving…' : 'Adding…'}
                >
                  {editing ? 'Save changes' : 'Add address'}
                </Button>
                <Button variant="secondary" onClick={closeForm}>
                  Cancel
                </Button>
              </div>
            </form>
          ) : null}
        </div>
      ) : null}
    </section>
  )
}
