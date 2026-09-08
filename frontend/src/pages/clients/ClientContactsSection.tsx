import { useCallback, useEffect, useState, type FormEvent } from 'react'

import {
  createClientContact,
  deleteClientContact,
  listClientContacts,
  updateClientContact,
} from '../../api/clients'
import { Button } from '../../components/ui/Button'
import { Field } from '../../components/ui/Field'
import { FIELD_INPUT_CLASS } from '../../components/ui/formClasses'
import { ApiError, HTTP_STATUS } from '../../types/api'
import type { ClientContact, ClientContactInput } from '../../types/client'

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
    return 'You do not have permission to view contacts.'
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
  return "Couldn't load contacts."
}

function mutationErrorMessage(error: ApiError, verb: string): string {
  if (error.status === HTTP_STATUS.FORBIDDEN) {
    return 'You do not have permission to manage contacts.'
  }
  if (error.status === HTTP_STATUS.NOT_FOUND) {
    return 'The client or contact was not found.'
  }
  if (error.status === HTTP_STATUS.TOO_MANY_REQUESTS) {
    return error.retryAfterSeconds !== null
      ? `Too many requests. Please wait ${error.retryAfterSeconds} seconds and try again.`
      : 'Too many requests. Please wait a moment and try again.'
  }
  return error.message || `Could not ${verb} the contact. Please try again.`
}

interface ContactFormValues {
  full_name: string
  position: string
  phone: string
  email: string
  is_primary: boolean
}

const EMPTY_FORM: ContactFormValues = {
  full_name: '',
  position: '',
  phone: '',
  email: '',
  is_primary: false,
}

function valuesFor(contact: ClientContact): ContactFormValues {
  return {
    full_name: contact.full_name,
    position: contact.position ?? '',
    phone: contact.phone ?? '',
    email: contact.email ?? '',
    is_primary: contact.is_primary,
  }
}

/**
 * Manageable Contacts section for the client detail page, backed by the
 * tenant- and parent-scoped nested contact endpoints
 * (`GET/POST /api/clients/:id/contacts/`,
 * `PATCH/DELETE /api/clients/:id/contacts/:contact_id/`).
 *
 * Mirrors the `ClientAddressesSection` architecture: the contact collection
 * is fetched independently of the client detail (own loading/error/retry
 * states), and after every successful mutation the collection is refetched
 * from the backend. Unlike addresses, contacts involve no reference-data
 * catalog. Bank accounts are out of scope and untouched.
 */
export function ClientContactsSection({ clientId }: { clientId: number }) {
  const [contacts, setContacts] = useState<ClientContact[] | null>(null)
  const [loadError, setLoadError] = useState<ApiError | null>(null)
  const [reloadKey, setReloadKey] = useState(0)

  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<ClientContact | null>(null)
  const [values, setValues] = useState<ContactFormValues>(EMPTY_FORM)
  const [fieldErrors, setFieldErrors] = useState<Errors>({})
  const [formError, setFormError] = useState<string>()
  const [submitting, setSubmitting] = useState(false)

  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null)
  const [deletingId, setDeletingId] = useState<number | null>(null)
  const [deleteError, setDeleteError] = useState<string>()
  const [notice, setNotice] = useState<string>()

  const loadContacts = useCallback(() => {
    void listClientContacts(clientId)
      .then((data) => {
        setContacts(data)
        setLoadError(null)
      })
      .catch((error: unknown) => {
        setLoadError(
          error instanceof ApiError
            ? error
            : new ApiError({ status: 0, payload: null, message: "Couldn't load contacts." }),
        )
      })
  }, [clientId])

  useEffect(() => {
    loadContacts()
  }, [clientId, reloadKey, loadContacts])

  const retry = () => setReloadKey((key) => key + 1)

  function openCreate() {
    setEditing(null)
    setValues(EMPTY_FORM)
    setFieldErrors({})
    setFormError(undefined)
    setNotice(undefined)
    setFormOpen(true)
  }

  function openEdit(contact: ClientContact) {
    setEditing(contact)
    setValues(valuesFor(contact))
    setFieldErrors({})
    setFormError(undefined)
    setNotice(undefined)
    setFormOpen(true)
  }

  function closeForm() {
    setFormOpen(false)
    setEditing(null)
    setFieldErrors({})
    setFormError(undefined)
  }

  function setValue<K extends keyof ContactFormValues>(field: K, value: ContactFormValues[K]) {
    setValues((prev) => ({ ...prev, [field]: value }))
  }

  function validate(): Errors {
    const errors: Errors = {}
    if (!values.full_name.trim()) {
      errors.full_name = 'Full name is required.'
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

    const payload: ClientContactInput = {
      full_name: values.full_name.trim(),
      position: orNull(values.position),
      phone: orNull(values.phone),
      email: orNull(values.email),
      is_primary: values.is_primary,
    }

    setSubmitting(true)
    try {
      if (editing) {
        await updateClientContact(clientId, editing.id, payload)
        setNotice('Contact updated.')
      } else {
        await createClientContact(clientId, payload)
        setNotice('Contact added.')
      }
      closeForm()
      loadContacts()
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
        setFormError(editing ? 'Could not update the contact.' : 'Could not add the contact.')
      }
    } finally {
      setSubmitting(false)
    }
  }

  async function handleDelete(contactId: number) {
    if (deletingId !== null) return
    setDeletingId(contactId)
    setDeleteError(undefined)
    setNotice(undefined)
    try {
      await deleteClientContact(clientId, contactId)
      setConfirmDeleteId(null)
      setNotice('Contact deleted.')
      loadContacts()
    } catch (error) {
      setDeleteError(
        error instanceof ApiError
          ? mutationErrorMessage(error, 'delete')
          : 'Could not delete the contact.',
      )
    } finally {
      setDeletingId(null)
    }
  }

  return (
    <section aria-label="Contacts">
      <h2 className="mb-1 text-sm font-semibold text-slate-700">Contacts</h2>

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

      {contacts === null && !loadError ? (
        <p role="status" className="animate-pulse text-sm text-slate-400">
          Loading contacts…
        </p>
      ) : null}

      {contacts !== null && !loadError ? (
        <div className="space-y-3">
          {contacts.length === 0 && !formOpen ? (
            <div className="rounded-lg border border-dashed border-slate-300 px-4 py-6 text-center">
              <p className="text-sm text-slate-500">No contacts found.</p>
              <Button variant="secondary" onClick={openCreate} className="mt-2">
                Add contact
              </Button>
            </div>
          ) : null}

          {contacts.length > 0 ? (
            <ul className="divide-y divide-slate-200 rounded-lg border border-slate-200 bg-white text-sm">
              {contacts.map((contact) => (
                <li
                  key={contact.id}
                  className="flex flex-wrap items-center justify-between gap-2 px-4 py-2"
                >
                  <div className="min-w-0 text-slate-700">
                    <span className="font-medium text-slate-900">{contact.full_name}</span>
                    {contact.position ? ` — ${contact.position}` : ''}
                    {contact.email ? ` · ${contact.email}` : ''}
                    {contact.phone ? ` · ${contact.phone}` : ''}
                    {contact.is_primary ? (
                      <span className="text-slate-500"> · primary</span>
                    ) : null}
                  </div>
                  <div className="flex items-center gap-2">
                    <Button variant="secondary" onClick={() => openEdit(contact)}>
                      Edit
                    </Button>
                    {confirmDeleteId === contact.id ? (
                      <span className="flex items-center gap-2 text-sm text-slate-700">
                        Delete this contact?
                        <Button
                          variant="danger"
                          loading={deletingId === contact.id}
                          loadingLabel="Deleting…"
                          onClick={() => void handleDelete(contact.id)}
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
                      <Button variant="danger" onClick={() => setConfirmDeleteId(contact.id)}>
                        Delete
                      </Button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          ) : null}

          {(contacts.length > 0 || formOpen) && !formOpen ? (
            <div>
              <Button variant="secondary" onClick={openCreate}>
                Add contact
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
              aria-label={editing ? 'Edit contact' : 'Add contact'}
              onSubmit={(event) => void handleSubmit(event)}
              className="space-y-3 rounded-lg border border-slate-200 bg-white p-4"
            >
              <h3 className="text-sm font-semibold text-slate-700">
                {editing ? 'Edit contact' : 'Add contact'}
              </h3>

              {formError ? (
                <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
                  {formError}
                </p>
              ) : null}

              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Full name" htmlFor="client-contact-full-name" required error={fieldErrors.full_name}>
                  <input
                    id="client-contact-full-name"
                    type="text"
                    value={values.full_name}
                    onChange={(event) => setValue('full_name', event.target.value)}
                    aria-invalid={Boolean(fieldErrors.full_name)}
                    aria-describedby={fieldErrors.full_name ? 'client-contact-full-name-error' : undefined}
                    className={FIELD_INPUT_CLASS}
                  />
                </Field>
                <Field label="Position" htmlFor="client-contact-position" error={fieldErrors.position}>
                  <input
                    id="client-contact-position"
                    type="text"
                    value={values.position}
                    onChange={(event) => setValue('position', event.target.value)}
                    className={FIELD_INPUT_CLASS}
                  />
                </Field>
                <Field label="Phone" htmlFor="client-contact-phone" error={fieldErrors.phone}>
                  <input
                    id="client-contact-phone"
                    type="text"
                    value={values.phone}
                    onChange={(event) => setValue('phone', event.target.value)}
                    className={FIELD_INPUT_CLASS}
                  />
                </Field>
                <Field label="Email" htmlFor="client-contact-email" error={fieldErrors.email}>
                  <input
                    id="client-contact-email"
                    type="email"
                    value={values.email}
                    onChange={(event) => setValue('email', event.target.value)}
                    className={FIELD_INPUT_CLASS}
                  />
                </Field>
                <div className="flex items-center gap-2 text-sm text-slate-700">
                  <input
                    id="client-contact-is-primary"
                    type="checkbox"
                    checked={values.is_primary}
                    onChange={(event) => setValue('is_primary', event.target.checked)}
                    aria-describedby={fieldErrors.is_primary ? 'client-contact-is-primary-error' : undefined}
                    className="h-4 w-4 rounded border-slate-300"
                  />
                  <label htmlFor="client-contact-is-primary">
                    Primary contact
                  </label>
                </div>
              </div>
              {fieldErrors.is_primary ? (
                <p id="client-contact-is-primary-error" className="text-sm text-red-600">
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
                  {editing ? 'Save changes' : 'Add contact'}
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
