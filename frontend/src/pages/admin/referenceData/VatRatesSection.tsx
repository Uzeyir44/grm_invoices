import { useCallback, useEffect, useState, type FormEvent } from 'react'

import {
  createAdminVatRate,
  deleteAdminVatRate,
  listAdminVatRates,
  updateAdminVatRate,
} from '../../../api/adminReferenceData'
import { Button } from '../../../components/ui/Button'
import { Field } from '../../../components/ui/Field'
import { FIELD_INPUT_CLASS } from '../../../components/ui/formClasses'
import { ApiError } from '../../../types/api'
import type { AdminVatRate } from '../../../types/adminReferenceData'
import { firstFieldErrors, referenceFormMessageFor } from './formErrors'

type Errors = Record<string, string>

interface VatForm {
  name: string
  rate_percent: string
  valid_from: string
  valid_to: string
}

const EMPTY_FORM: VatForm = {
  name: '',
  rate_percent: '',
  valid_from: '',
  valid_to: '',
}

/**
 * VAT rate administration. The effective period is a half-open range
 * (`valid_to` empty = still in effect). Overlap/range rules are enforced by the
 * backend (serializer + PostgreSQL exclusion constraint); this UI only
 * surfaces the errors.
 */
export function VatRatesSection() {
  const [rows, setRows] = useState<AdminVatRate[] | null>(null)
  const [error, setError] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)

  const [formOpen, setFormOpen] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [values, setValues] = useState<VatForm>(EMPTY_FORM)
  const [fieldErrors, setFieldErrors] = useState<Errors>({})
  const [formError, setFormError] = useState<string>()
  const [submitting, setSubmitting] = useState(false)

  const [confirmingDeleteId, setConfirmingDeleteId] = useState<number | null>(null)
  const [deleteError, setDeleteError] = useState<string>()

  useEffect(() => {
    let cancelled = false
    void listAdminVatRates()
      .then((data) => {
        if (cancelled) return
        setRows(Array.isArray(data) ? data : [])
        setError(false)
      })
      .catch(() => {
        if (cancelled) return
        setError(true)
      })
    return () => {
      cancelled = true
    }
  }, [reloadKey])

  const reload = useCallback(() => setReloadKey((key) => key + 1), [])

  function openAdd() {
    setValues(EMPTY_FORM)
    setEditingId(null)
    setFieldErrors({})
    setFormError(undefined)
    setFormOpen(true)
  }

  function openEdit(row: AdminVatRate) {
    setValues({
      name: row.name,
      rate_percent: row.rate_percent,
      valid_from: row.valid_from,
      valid_to: row.valid_to ?? '',
    })
    setEditingId(row.id)
    setFieldErrors({})
    setFormError(undefined)
    setFormOpen(true)
  }

  function closeForm() {
    setFormOpen(false)
    setEditingId(null)
    setFieldErrors({})
    setFormError(undefined)
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (submitting) return

    const errors: Errors = {}
    if (!values.name.trim()) errors.name = 'Name is required.'
    if (!values.rate_percent.trim()) errors.rate_percent = 'Rate is required.'
    if (!values.valid_from.trim()) errors.valid_from = 'Valid from is required.'
    setFieldErrors(errors)
    setFormError(undefined)
    if (Object.keys(errors).length > 0) return

    const payload = {
      name: values.name.trim(),
      rate_percent: values.rate_percent.trim(),
      valid_from: values.valid_from,
      valid_to: values.valid_to.trim() ? values.valid_to : null,
    }

    setSubmitting(true)
    try {
      if (editingId === null) {
        await createAdminVatRate(payload)
      } else {
        await updateAdminVatRate(editingId, payload)
      }
      closeForm()
      reload()
    } catch (error) {
      if (error instanceof ApiError) {
        const fieldErrors = firstFieldErrors(error)
        setFieldErrors(fieldErrors)
        setFormError(referenceFormMessageFor(error, fieldErrors))
      } else {
        setFormError('The operation failed. Please try again.')
      }
    } finally {
      setSubmitting(false)
    }
  }

  async function confirmDelete(id: number) {
    setDeleteError(undefined)
    try {
      await deleteAdminVatRate(id)
      setConfirmingDeleteId(null)
      reload()
    } catch (error) {
      setDeleteError(
        error instanceof ApiError ? error.message || 'Delete failed.' : 'Delete failed.',
      )
      setConfirmingDeleteId(null)
    }
  }

  return (
    <section aria-label="VAT Rates" className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-slate-900">VAT Rates</h2>
          <p className="text-sm text-slate-500">
            Rate validity is a half-open date range; leave{' '}
            <em>Valid to</em> empty for a still-effective rate. Overlapping
            periods for the same name are rejected.
          </p>
        </div>
        <Button onClick={openAdd}>New VAT rate</Button>
      </div>

      {error ? (
        <div role="alert" className="rounded-md bg-red-50 px-4 py-3 text-sm text-red-700">
          Couldn't load VAT rates.
          <button
            type="button"
            onClick={reload}
            className="ml-3 font-medium underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-500"
          >
            Retry
          </button>
        </div>
      ) : null}

      {deleteError ? (
        <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          {deleteError}
        </p>
      ) : null}

      {formOpen ? (
        <form
          onSubmit={handleSubmit}
          className="space-y-4 rounded-lg border border-slate-200 bg-white p-4"
          noValidate
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Name" htmlFor="vat-name" required error={fieldErrors.name}>
              <input
                id="vat-name"
                value={values.name}
                onChange={(event) => setValues((p) => ({ ...p, name: event.target.value }))}
                className={FIELD_INPUT_CLASS}
              />
            </Field>
            <Field
              label="Rate percent"
              htmlFor="vat-rate"
              required
              error={fieldErrors.rate_percent}
            >
              <input
                id="vat-rate"
                type="number"
                step="0.01"
                value={values.rate_percent}
                onChange={(event) =>
                  setValues((p) => ({ ...p, rate_percent: event.target.value }))
                }
                className={FIELD_INPUT_CLASS}
              />
            </Field>
            <Field
              label="Valid from"
              htmlFor="vat-from"
              required
              error={fieldErrors.valid_from}
            >
              <input
                id="vat-from"
                type="date"
                value={values.valid_from}
                onChange={(event) =>
                  setValues((p) => ({ ...p, valid_from: event.target.value }))
                }
                className={FIELD_INPUT_CLASS}
              />
            </Field>
            <Field label="Valid to" htmlFor="vat-to" error={fieldErrors.valid_to}>
              <input
                id="vat-to"
                type="date"
                value={values.valid_to}
                onChange={(event) =>
                  setValues((p) => ({ ...p, valid_to: event.target.value }))
                }
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
            <Button type="submit" loading={submitting} loadingLabel="Saving…">
              {editingId === null ? 'Create' : 'Save changes'}
            </Button>
            <Button variant="secondary" onClick={closeForm} disabled={submitting}>
              Cancel
            </Button>
          </div>
        </form>
      ) : null}

      {rows === null && !error ? (
        <p role="status" className="animate-pulse text-sm text-slate-400">
          Loading…
        </p>
      ) : null}

      {rows !== null && rows.length === 0 && !error ? (
        <p className="text-sm text-slate-500">No VAT rates yet.</p>
      ) : null}

      {rows !== null && rows.length > 0 && !error ? (
        <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th scope="col" className="px-4 py-2 font-medium">Name</th>
                  <th scope="col" className="px-4 py-2 font-medium">Rate %</th>
                  <th scope="col" className="px-4 py-2 font-medium">Valid from</th>
                  <th scope="col" className="px-4 py-2 font-medium">Valid to</th>
                  <th scope="col" className="px-4 py-2 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((row) => (
                  <tr key={row.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3 text-slate-900">{row.name}</td>
                    <td className="px-4 py-3 text-slate-600">{row.rate_percent}</td>
                    <td className="px-4 py-3 text-slate-600">{row.valid_from}</td>
                    <td className="px-4 py-3 text-slate-600">
                      {row.valid_to ?? 'Still in effect'}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <button
                          type="button"
                          onClick={() => openEdit(row)}
                          className="text-sm text-slate-700 underline hover:text-slate-900"
                        >
                          Edit
                        </button>
                        {confirmingDeleteId === row.id ? (
                          <span className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => {
                                void confirmDelete(row.id)
                              }}
                              className="text-sm font-medium text-red-600 underline"
                            >
                              Confirm
                            </button>
                            <button
                              type="button"
                              onClick={() => setConfirmingDeleteId(null)}
                              className="text-sm text-slate-600 underline"
                            >
                              Cancel
                            </button>
                          </span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setConfirmingDeleteId(row.id)}
                            className="text-sm text-red-600 underline hover:text-red-700"
                          >
                            Delete
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
    </section>
  )
}
