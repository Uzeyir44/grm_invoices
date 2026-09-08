import { useEffect, useState, type FormEvent } from 'react'

import {
  createClientBankAccount,
  deleteClientBankAccount,
  listClientBankAccounts,
  updateClientBankAccount,
} from '../../api/clients'
import { fetchBanks, fetchCurrencies } from '../../api/referenceData'
import { Button } from '../../components/ui/Button'
import { Field } from '../../components/ui/Field'
import { FIELD_INPUT_CLASS } from '../../components/ui/formClasses'
import { ApiError, HTTP_STATUS } from '../../types/api'
import type { ClientBankAccount, ClientBankAccountInput } from '../../types/client'
import type { Bank, Currency } from '../../types/referenceData'

type Errors = Record<string, string>

function firstFieldErrors(error: ApiError): Errors {
  const result: Errors = {}
  for (const [key, messages] of Object.entries(error.fieldErrors)) {
    if (messages.length > 0) result[key] = messages[0]
  }
  return result
}

function loadErrorMessage(error: ApiError): string {
  if (error.status === HTTP_STATUS.FORBIDDEN) {
    return 'You do not have permission to view bank accounts.'
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
  return "Couldn't load bank accounts."
}

function mutationErrorMessage(error: ApiError, verb: string): string {
  if (error.status === HTTP_STATUS.FORBIDDEN) {
    return 'You do not have permission to manage bank accounts.'
  }
  if (error.status === HTTP_STATUS.NOT_FOUND) {
    return 'The client or bank account was not found.'
  }
  if (error.status === HTTP_STATUS.TOO_MANY_REQUESTS) {
    return error.retryAfterSeconds !== null
      ? `Too many requests. Please wait ${error.retryAfterSeconds} seconds and try again.`
      : 'Too many requests. Please wait a moment and try again.'
  }
  return error.message || `Could not ${verb} the bank account. Please try again.`
}

interface BankAccountFormValues {
  bank: string
  currency: string
  iban: string
  swift_bic: string
  is_default: boolean
}

const EMPTY_FORM: BankAccountFormValues = {
  bank: '',
  currency: '',
  iban: '',
  swift_bic: '',
  is_default: false,
}

function valuesFor(account: ClientBankAccount): BankAccountFormValues {
  return {
    bank: account.bank === null ? '' : String(account.bank),
    currency: String(account.currency),
    iban: account.iban,
    swift_bic: account.swift_bic ?? '',
    is_default: account.is_default,
  }
}

/**
 * Manageable Bank Accounts section for the client detail page, backed by the
 * tenant- and parent-scoped nested bank account endpoints
 * (`GET/POST /api/clients/:id/bank-accounts/`,
 * `PATCH/DELETE /api/clients/:id/bank-accounts/:account_id/`).
 *
 * Mirrors the address/contact section architecture: the collection is fetched
 * independently of the client detail (own loading/error/retry states), and
 * after every successful mutation the collection is refetched from the
 * backend. The `bank` (optional) and `currency` (required) selects come from
 * the real `banks` / `currencies` reference-data catalogs — never hardcoded;
 * the read-only `bank_name` / `currency_code` come back on the row.
 */
export function ClientBankAccountsSection({ clientId }: { clientId: number }) {
  const [accounts, setAccounts] = useState<ClientBankAccount[] | null>(null)
  const [loadError, setLoadError] = useState<ApiError | null>(null)
  const [reloadKey, setReloadKey] = useState(0)

  const [banks, setBanks] = useState<Bank[] | null>(null)
  const [banksError, setBanksError] = useState(false)
  const [banksReloadKey, setBanksReloadKey] = useState(0)
  const [currencies, setCurrencies] = useState<Currency[] | null>(null)
  const [currenciesError, setCurrenciesError] = useState(false)
  const [currenciesReloadKey, setCurrenciesReloadKey] = useState(0)
  const [catalogsRequested, setCatalogsRequested] = useState(false)

  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<ClientBankAccount | null>(null)
  const [values, setValues] = useState<BankAccountFormValues>(EMPTY_FORM)
  const [fieldErrors, setFieldErrors] = useState<Errors>({})
  const [formError, setFormError] = useState<string>()
  const [submitting, setSubmitting] = useState(false)

  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null)
  const [deletingId, setDeletingId] = useState<number | null>(null)
  const [deleteError, setDeleteError] = useState<string>()
  const [notice, setNotice] = useState<string>()

  // Refresh the collection through the effect below (which guards against
  // stale in-flight responses) rather than fetching imperatively.
  const refreshAccounts = () => {
    setReloadKey((key) => key + 1)
  }

  useEffect(() => {
    // A stale in-flight response must never overwrite a newer client when
    // navigating rapidly between detail routes.
    let cancelled = false
    void listClientBankAccounts(clientId)
      .then((data) => {
        if (cancelled) return
        setAccounts(data)
        setLoadError(null)
      })
      .catch((error: unknown) => {
        if (cancelled) return
        setLoadError(
          error instanceof ApiError
            ? error
            : new ApiError({ status: 0, payload: null, message: "Couldn't load bank accounts." }),
        )
      })
    return () => {
      cancelled = true
    }
  }, [clientId, reloadKey])

  // Both catalogs are only needed for the form; load them lazily on first
  // open so the section does not depend on catalogs to display rows.
  useEffect(() => {
    if (!catalogsRequested) return
    let cancelled = false
    void fetchBanks()
      .then((data) => {
        if (cancelled) return
        setBanks(data)
        setBanksError(false)
      })
      .catch(() => {
        if (cancelled) return
        setBanksError(true)
      })
    return () => {
      cancelled = true
    }
  }, [catalogsRequested, banksReloadKey])

  useEffect(() => {
    if (!catalogsRequested) return
    let cancelled = false
    void fetchCurrencies()
      .then((data) => {
        if (cancelled) return
        setCurrencies(data)
        setCurrenciesError(false)
      })
      .catch(() => {
        if (cancelled) return
        setCurrenciesError(true)
      })
    return () => {
      cancelled = true
    }
  }, [catalogsRequested, currenciesReloadKey])

  const retry = () => setReloadKey((key) => key + 1)
  const catalogsReady = banks !== null && currencies !== null

  function openCreate() {
    setEditing(null)
    setValues(EMPTY_FORM)
    setFieldErrors({})
    setFormError(undefined)
    setNotice(undefined)
    setFormOpen(true)
    setCatalogsRequested(true)
  }

  function openEdit(account: ClientBankAccount) {
    setEditing(account)
    setValues(valuesFor(account))
    setFieldErrors({})
    setFormError(undefined)
    setNotice(undefined)
    setFormOpen(true)
    setCatalogsRequested(true)
  }

  function closeForm() {
    setFormOpen(false)
    setEditing(null)
    setFieldErrors({})
    setFormError(undefined)
  }

  function setValue<K extends keyof BankAccountFormValues>(
    field: K,
    value: BankAccountFormValues[K],
  ) {
    setValues((prev) => ({ ...prev, [field]: value }))
  }

  function validate(): Errors {
    const errors: Errors = {}
    if (!values.currency.trim() || !Number.isFinite(Number(values.currency))) {
      errors.currency = 'Currency is required.'
    }
    if (!values.iban.trim()) {
      errors.iban = 'IBAN is required.'
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

    // `bank` is a nullable FK: an empty select is sent as null. Optional text
    // fields are nullable and sent as null when empty.
    const payload: ClientBankAccountInput = {
      bank: values.bank.trim() ? Number(values.bank) : null,
      currency: Number(values.currency),
      iban: values.iban.trim(),
      swift_bic: values.swift_bic.trim() ? values.swift_bic.trim() : null,
      is_default: values.is_default,
    }

    setSubmitting(true)
    try {
      if (editing) {
        await updateClientBankAccount(clientId, editing.id, payload)
        setNotice('Bank account updated.')
      } else {
        await createClientBankAccount(clientId, payload)
        setNotice('Bank account added.')
      }
      closeForm()
      refreshAccounts()
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
        setFormError(
          editing ? 'Could not update the bank account.' : 'Could not add the bank account.',
        )
      }
    } finally {
      setSubmitting(false)
    }
  }

  async function handleDelete(accountId: number) {
    if (deletingId !== null) return
    setDeletingId(accountId)
    setDeleteError(undefined)
    setNotice(undefined)
    try {
      await deleteClientBankAccount(clientId, accountId)
      setConfirmDeleteId(null)
      setNotice('Bank account deleted.')
      refreshAccounts()
    } catch (error) {
      setDeleteError(
        error instanceof ApiError
          ? mutationErrorMessage(error, 'delete')
          : 'Could not delete the bank account.',
      )
    } finally {
      setDeletingId(null)
    }
  }

  return (
    <section aria-label="Bank accounts">
      <h2 className="mb-1 text-sm font-semibold text-slate-700">Bank accounts</h2>

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

      {accounts === null && !loadError ? (
        <p role="status" className="animate-pulse text-sm text-slate-400">
          Loading bank accounts…
        </p>
      ) : null}

      {accounts !== null && !loadError ? (
        <div className="space-y-3">
          {accounts.length === 0 && !formOpen ? (
            <div className="rounded-lg border border-dashed border-slate-300 px-4 py-6 text-center">
              <p className="text-sm text-slate-500">No bank accounts found.</p>
              <Button variant="secondary" onClick={openCreate} className="mt-2">
                Add bank account
              </Button>
            </div>
          ) : null}

          {accounts.length > 0 ? (
            <ul className="divide-y divide-slate-200 rounded-lg border border-slate-200 bg-white text-sm">
              {accounts.map((account) => (
                <li
                  key={account.id}
                  className="flex flex-wrap items-center justify-between gap-2 px-4 py-2"
                >
                  <div className="min-w-0 break-words text-slate-700">
                    <span className="font-medium text-slate-900">
                      {account.bank_name ?? 'Bank'}
                    </span>
                    {` · ${account.iban}`}
                    {account.currency_code ? ` · ${account.currency_code}` : ''}
                    {account.is_default ? (
                      <span className="text-slate-500"> · default</span>
                    ) : null}
                  </div>
                  <div className="flex items-center gap-2">
                    <Button variant="secondary" onClick={() => openEdit(account)}>
                      Edit
                    </Button>
                    {confirmDeleteId === account.id ? (
                      <span className="flex items-center gap-2 text-sm text-slate-700">
                        Delete this bank account?
                        <Button
                          variant="danger"
                          loading={deletingId === account.id}
                          loadingLabel="Deleting…"
                          onClick={() => void handleDelete(account.id)}
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
                      <Button variant="danger" onClick={() => setConfirmDeleteId(account.id)}>
                        Delete
                      </Button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          ) : null}

          {(accounts.length > 0 || formOpen) && !formOpen ? (
            <div>
              <Button variant="secondary" onClick={openCreate}>
                Add bank account
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
              aria-label={editing ? 'Edit bank account' : 'Add bank account'}
              onSubmit={(event) => void handleSubmit(event)}
              className="space-y-3 rounded-lg border border-slate-200 bg-white p-4"
            >
              <h3 className="text-sm font-semibold text-slate-700">
                {editing ? 'Edit bank account' : 'Add bank account'}
              </h3>

              {banksError || currenciesError || !catalogsReady ? (
                <div>
                  {banksError ? (
                    <p role="alert" className="text-sm text-red-700">
                      Couldn't load banks.{' '}
                      <button
                        type="button"
                        onClick={() => setBanksReloadKey((key) => key + 1)}
                        className="font-medium text-slate-700 underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-slate-500"
                      >
                        Retry
                      </button>
                    </p>
                  ) : null}
                  {currenciesError ? (
                    <p role="alert" className="text-sm text-red-700">
                      Couldn't load currencies.{' '}
                      <button
                        type="button"
                        onClick={() => setCurrenciesReloadKey((key) => key + 1)}
                        className="font-medium text-slate-700 underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-slate-500"
                      >
                        Retry
                      </button>
                    </p>
                  ) : null}
                  {!banksError && !currenciesError ? (
                    <p role="status" className="animate-pulse text-sm text-slate-400">
                      Loading banks and currencies…
                    </p>
                  ) : null}
                </div>
              ) : null}

              {formError ? (
                <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
                  {formError}
                </p>
              ) : null}

              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Bank" htmlFor="client-bank-account-bank" error={fieldErrors.bank}>
                  <select
                    id="client-bank-account-bank"
                    value={values.bank}
                    onChange={(event) => setValue('bank', event.target.value)}
                    disabled={!catalogsReady || submitting}
                    aria-invalid={Boolean(fieldErrors.bank)}
                    aria-describedby={fieldErrors.bank ? 'client-bank-account-bank-error' : undefined}
                    className={FIELD_INPUT_CLASS}
                  >
                    <option value="">No bank</option>
                    {(banks ?? []).map((bank) => (
                      <option key={bank.id} value={String(bank.id)}>
                        {bank.name}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field
                  label="Currency"
                  htmlFor="client-bank-account-currency"
                  required
                  error={fieldErrors.currency}
                >
                  <select
                    id="client-bank-account-currency"
                    value={values.currency}
                    onChange={(event) => setValue('currency', event.target.value)}
                    disabled={!catalogsReady || submitting}
                    aria-invalid={Boolean(fieldErrors.currency)}
                    aria-describedby={
                      fieldErrors.currency ? 'client-bank-account-currency-error' : undefined
                    }
                    className={FIELD_INPUT_CLASS}
                  >
                    <option value="">Select currency</option>
                    {(currencies ?? []).map((currency) => (
                      <option key={currency.id} value={String(currency.id)}>
                        {currency.code}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field
                  label="IBAN"
                  htmlFor="client-bank-account-iban"
                  required
                  error={fieldErrors.iban}
                >
                  <input
                    id="client-bank-account-iban"
                    type="text"
                    value={values.iban}
                    onChange={(event) => setValue('iban', event.target.value)}
                    aria-invalid={Boolean(fieldErrors.iban)}
                    aria-describedby={fieldErrors.iban ? 'client-bank-account-iban-error' : undefined}
                    className={FIELD_INPUT_CLASS}
                  />
                </Field>
                <Field
                  label="SWIFT/BIC"
                  htmlFor="client-bank-account-swift-bic"
                  error={fieldErrors.swift_bic}
                >
                  <input
                    id="client-bank-account-swift-bic"
                    type="text"
                    value={values.swift_bic}
                    onChange={(event) => setValue('swift_bic', event.target.value)}
                    maxLength={11}
                    className={FIELD_INPUT_CLASS}
                  />
                </Field>
                <div className="flex items-center gap-2 text-sm text-slate-700">
                  <input
                    id="client-bank-account-is-default"
                    type="checkbox"
                    checked={values.is_default}
                    onChange={(event) => setValue('is_default', event.target.checked)}
                    aria-describedby={
                      fieldErrors.is_default ? 'client-bank-account-is-default-error' : undefined
                    }
                    className="h-4 w-4 rounded border-slate-300"
                  />
                  <label htmlFor="client-bank-account-is-default">
                    Default account
                  </label>
                </div>
              </div>
              {fieldErrors.is_default ? (
                <p id="client-bank-account-is-default-error" className="text-sm text-red-600">
                  {fieldErrors.is_default}
                </p>
              ) : null}

              <div className="flex flex-wrap items-center gap-3">
                <Button
                  type="submit"
                  variant="primary"
                  loading={submitting}
                  loadingLabel={editing ? 'Saving…' : 'Adding…'}
                >
                  {editing ? 'Save changes' : 'Add bank account'}
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
