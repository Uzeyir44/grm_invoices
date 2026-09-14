import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react'

import { Button } from '../../../components/ui/Button'
import { Field } from '../../../components/ui/Field'
import { FIELD_INPUT_CLASS } from '../../../components/ui/formClasses'
import { ApiError } from '../../../types/api'
import {
  firstFieldErrors,
  referenceFormMessageFor,
} from './formErrors'

type Values = Record<string, string>
type Errors = Record<string, string>

export interface CatalogField {
  name: string
  label: string
  type?: 'text' | 'number' | 'date'
  required?: boolean
  placeholder?: string
}

export interface CatalogColumn<T> {
  header: string
  render: (row: T) => ReactNode
}

interface SimpleCatalogSectionProps<T> {
  title: string
  description: string
  addLabel: string
  emptyMessage: string
  fields: CatalogField[]
  columns: ReadonlyArray<CatalogColumn<T>>
  list: () => Promise<T[]>
  create: (values: Values) => Promise<unknown>
  update: (id: number, values: Values) => Promise<unknown>
  remove: (id: number) => Promise<void>
  getId: (row: T) => number
  toFormValues: (row: T) => Values
  canDelete?: boolean
}

/**
 * Reusable list + inline create/edit/delete section for a simple global
 * reference catalog (currencies, document types, address types). API calls are
 * injected so no request logic lives in this component.
 */
export function SimpleCatalogSection<T>({
  title,
  description,
  addLabel,
  emptyMessage,
  fields,
  columns,
  list,
  create,
  update,
  remove,
  getId,
  toFormValues,
  canDelete = true,
}: SimpleCatalogSectionProps<T>) {
  const [rows, setRows] = useState<T[] | null>(null)
  const [error, setError] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)

  const [formOpen, setFormOpen] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [values, setValues] = useState<Values>({})
  const [fieldErrors, setFieldErrors] = useState<Errors>({})
  const [formError, setFormError] = useState<string>()
  const [submitting, setSubmitting] = useState(false)

  const [confirmingDeleteId, setConfirmingDeleteId] = useState<number | null>(null)
  const [deleteError, setDeleteError] = useState<string>()

  useEffect(() => {
    let cancelled = false
    void list()
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
  }, [list, reloadKey])

  const reload = useCallback(() => setReloadKey((key) => key + 1), [])

  function openAdd() {
    const initial: Values = {}
    for (const field of fields) initial[field.name] = ''
    setValues(initial)
    setEditingId(null)
    setFieldErrors({})
    setFormError(undefined)
    setFormOpen(true)
  }

  function openEdit(row: T) {
    setValues(toFormValues(row))
    setEditingId(getId(row))
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
    for (const field of fields) {
      if (field.required && !(values[field.name] ?? '').trim()) {
        errors[field.name] = `${field.label} is required.`
      }
    }
    setFieldErrors(errors)
    setFormError(undefined)
    if (Object.keys(errors).length > 0) return

    setSubmitting(true)
    try {
      if (editingId === null) {
        await create(values)
      } else {
        await update(editingId, values)
      }
      closeForm()
      reload()
    } catch (error) {
      if (error instanceof ApiError) {
        const errors = firstFieldErrors(error)
        setFieldErrors(errors)
        setFormError(referenceFormMessageFor(error, errors))
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
      await remove(id)
      setConfirmingDeleteId(null)
      reload()
    } catch (error) {
      setDeleteError(
        error instanceof ApiError
          ? error.message || 'Delete failed.'
          : 'Delete failed.',
      )
      setConfirmingDeleteId(null)
    }
  }

  return (
    <section aria-label={title} className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-slate-900">{title}</h2>
          <p className="text-sm text-slate-500">{description}</p>
        </div>
        <Button onClick={openAdd}>{addLabel}</Button>
      </div>

      {error ? (
        <div
          role="alert"
          className="rounded-md bg-red-50 px-4 py-3 text-sm text-red-700"
        >
          Couldn't load {title.toLowerCase()}.
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
            {fields.map((field) => (
              <Field
                key={field.name}
                label={field.label}
                htmlFor={`${title}-${field.name}`}
                required={field.required}
                error={fieldErrors[field.name]}
              >
                <input
                  id={`${title}-${field.name}`}
                  name={field.name}
                  type={field.type ?? 'text'}
                  value={values[field.name] ?? ''}
                  placeholder={field.placeholder}
                  onChange={(event) =>
                    setValues((prev) => ({ ...prev, [field.name]: event.target.value }))
                  }
                  className={FIELD_INPUT_CLASS}
                  aria-invalid={Boolean(fieldErrors[field.name])}
                />
              </Field>
            ))}
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
        <p className="animate-pulse text-sm text-slate-400" role="status">
          Loading…
        </p>
      ) : null}

      {rows !== null && rows.length === 0 && !error ? (
        <p className="text-sm text-slate-500">{emptyMessage}</p>
      ) : null}

      {rows !== null && rows.length > 0 && !error ? (
        <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  {columns.map((column) => (
                    <th key={column.header} scope="col" className="px-4 py-2 font-medium">
                      {column.header}
                    </th>
                  ))}
                  <th scope="col" className="px-4 py-2 font-medium">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((row) => {
                  const id = getId(row)
                  return (
                    <tr key={id} className="hover:bg-slate-50">
                      {columns.map((column) => (
                        <td key={column.header} className="px-4 py-3 text-slate-600">
                          {column.render(row)}
                        </td>
                      ))}
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <button
                            type="button"
                            onClick={() => openEdit(row)}
                            className="text-sm text-slate-700 underline hover:text-slate-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-500"
                          >
                            Edit
                          </button>
                          {canDelete ? (
                            confirmingDeleteId === id ? (
                              <span className="flex items-center gap-2">
                                <button
                                  type="button"
                                  onClick={() => {
                                    void confirmDelete(id)
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
                                onClick={() => setConfirmingDeleteId(id)}
                                className="text-sm text-red-600 underline hover:text-red-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-500"
                              >
                                Delete
                              </button>
                            )
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
    </section>
  )
}
