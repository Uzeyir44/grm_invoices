import { useCallback, useEffect, useState, type FormEvent } from 'react'

import {
  activateAdminBank,
  createAdminBank,
  deactivateAdminBank,
  listAdminBanks,
  updateAdminBank,
} from '../../../api/adminReferenceData'
import { Button } from '../../../components/ui/Button'
import { Field } from '../../../components/ui/Field'
import { FIELD_INPUT_CLASS } from '../../../components/ui/formClasses'
import { ApiError } from '../../../types/api'
import type { AdminBank } from '../../../types/adminReferenceData'
import { firstFieldErrors, referenceFormMessageFor } from './formErrors'

type Errors = Record<string, string>

/**
 * Bank directory administration. Banks use the existing ``is_active`` lifecycle
 * — there is deliberately no delete (client bank accounts reference banks with
 * ``PROTECT``).
 */
export function BanksSection() {
  const [rows, setRows] = useState<AdminBank[] | null>(null)
  const [error, setError] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)

  const [formOpen, setFormOpen] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [name, setName] = useState('')
  const [swiftCode, setSwiftCode] = useState('')
  const [fieldErrors, setFieldErrors] = useState<Errors>({})
  const [formError, setFormError] = useState<string>()
  const [submitting, setSubmitting] = useState(false)
  const [actionError, setActionError] = useState<string>()
  const [pendingId, setPendingId] = useState<number | null>(null)

  useEffect(() => {
    let cancelled = false
    void listAdminBanks()
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
    setName('')
    setSwiftCode('')
    setEditingId(null)
    setFieldErrors({})
    setFormError(undefined)
    setFormOpen(true)
  }

  function openEdit(row: AdminBank) {
    setName(row.name)
    setSwiftCode(row.swift_code ?? '')
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
    if (!name.trim()) errors.name = 'Name is required.'
    setFieldErrors(errors)
    setFormError(undefined)
    if (Object.keys(errors).length > 0) return

    const payload = {
      name: name.trim(),
      swift_code: swiftCode.trim() ? swiftCode.trim() : null,
    }

    setSubmitting(true)
    try {
      if (editingId === null) {
        await createAdminBank(payload)
      } else {
        await updateAdminBank(editingId, payload)
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

  async function toggleActive(row: AdminBank) {
    if (pendingId !== null) return
    setPendingId(row.id)
    setActionError(undefined)
    try {
      if (row.is_active) {
        await deactivateAdminBank(row.id)
      } else {
        await activateAdminBank(row.id)
      }
      reload()
    } catch (error) {
      setActionError(
        error instanceof ApiError ? error.message || 'Update failed.' : 'Update failed.',
      )
    } finally {
      setPendingId(null)
    }
  }

  return (
    <section aria-label="Banks" className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-slate-900">Banks</h2>
          <p className="text-sm text-slate-500">
            Maintained bank directory. Banks are deactivated rather than deleted.
          </p>
        </div>
        <Button onClick={openAdd}>New bank</Button>
      </div>

      {error ? (
        <div role="alert" className="rounded-md bg-red-50 px-4 py-3 text-sm text-red-700">
          Couldn't load banks.
          <button
            type="button"
            onClick={reload}
            className="ml-3 font-medium underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-500"
          >
            Retry
          </button>
        </div>
      ) : null}

      {actionError ? (
        <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          {actionError}
        </p>
      ) : null}

      {formOpen ? (
        <form
          onSubmit={handleSubmit}
          className="space-y-4 rounded-lg border border-slate-200 bg-white p-4"
          noValidate
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Name" htmlFor="bank-name" required error={fieldErrors.name}>
              <input
                id="bank-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                className={FIELD_INPUT_CLASS}
              />
            </Field>
            <Field label="SWIFT code" htmlFor="bank-swift" error={fieldErrors.swift_code}>
              <input
                id="bank-swift"
                value={swiftCode}
                onChange={(event) => setSwiftCode(event.target.value)}
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
        <p className="text-sm text-slate-500">No banks yet.</p>
      ) : null}

      {rows !== null && rows.length > 0 && !error ? (
        <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th scope="col" className="px-4 py-2 font-medium">Name</th>
                  <th scope="col" className="px-4 py-2 font-medium">SWIFT</th>
                  <th scope="col" className="px-4 py-2 font-medium">Status</th>
                  <th scope="col" className="px-4 py-2 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((row) => (
                  <tr key={row.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3 text-slate-900">{row.name}</td>
                    <td className="px-4 py-3 text-slate-600">{row.swift_code ?? '—'}</td>
                    <td className="px-4 py-3">
                      <span
                        data-testid="bank-status"
                        className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                          row.is_active
                            ? 'bg-emerald-100 text-emerald-800'
                            : 'bg-red-100 text-red-700'
                        }`}
                      >
                        {row.is_active ? 'Active' : 'Inactive'}
                      </span>
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
                        <button
                          type="button"
                          onClick={() => {
                            void toggleActive(row)
                          }}
                          disabled={pendingId === row.id}
                          className="text-sm text-slate-700 underline hover:text-slate-900 disabled:opacity-60"
                        >
                          {row.is_active ? 'Deactivate' : 'Activate'}
                        </button>
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
