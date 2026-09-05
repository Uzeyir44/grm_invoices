import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
} from 'react'
import { Link, useNavigate } from 'react-router-dom'

import { listClients } from '../../api/clients'
import { createGeneratedDocument } from '../../api/documents'
import { fetchCurrencies, fetchDocumentTypes } from '../../api/referenceData'
import { listTemplates } from '../../api/templates'
import { Button } from '../../components/ui/Button'
import { Field } from '../../components/ui/Field'
import { PageContainer } from '../../components/ui/PageContainer'
import { FIELD_INPUT_CLASS } from '../../components/ui/formClasses'
import { ApiError, HTTP_STATUS } from '../../types/api'
import type { CreateGeneratedDocumentInput } from '../../types/generatedDocument'

type DepState<T> =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; data: T }

type Errors = Record<string, string>

interface ItemRow {
  key: string
  description: string
  quantity: string
  unit: string
  discount_percent: string
  unit_price: string
  vat_rate_percent: string
}

const ITEM_FIELD_LABELS: Record<string, string> = {
  description: 'Description',
  quantity: 'Quantity',
  unit: 'Unit',
  unit_price: 'Unit price',
  discount_percent: 'Discount %',
  vat_rate_percent: 'VAT %',
}

function emptyItemRow(key: string): ItemRow {
  return {
    key,
    description: '',
    quantity: '',
    unit: '',
    discount_percent: '',
    unit_price: '',
    vat_rate_percent: '',
  }
}

function newItemKey(): string {
  return `item-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function validNumber(value: string): boolean {
  const trimmed = value.trim()
  if (trimmed === '') return false
  const parsed = Number(trimmed)
  return Number.isFinite(parsed)
}

/**
 * Load a single dependency of the create form independently, exposing a retry
 * that restarts the request so a failed dependency is clearly distinguishable
 * from a successfully empty one. Callers pass stable module-level API
 * functions, so `loader` is a constant effect dependency.
 */
function useDependency<T>(loader: () => Promise<T>): [DepState<T>, () => void] {
  const [state, setState] = useState<DepState<T>>({ status: 'loading' })

  useEffect(() => {
    let cancelled = false
    void loader()
      .then((data) => {
        if (!cancelled) setState({ status: 'ready', data })
      })
      .catch(() => {
        if (!cancelled) setState({ status: 'error' })
      })
    return () => {
      cancelled = true
    }
  }, [loader])

  const retry = useCallback(() => {
    setState({ status: 'loading' })
    void loader()
      .then((data) => setState({ status: 'ready', data }))
      .catch(() => setState({ status: 'error' }))
  }, [loader])

  return [state, retry]
}

function topLevelFieldErrors(error: ApiError): Errors {
  const result: Errors = {}
  for (const [key, messages] of Object.entries(error.fieldErrors)) {
    if (messages.length > 0 && !key.startsWith('items.')) result[key] = messages[0]
  }
  return result
}

function lineItemFieldErrors(
  error: ApiError,
  count: number,
): Array<Errors> {
  const result: Array<Errors> = Array.from({ length: count }, () => ({}))
  for (const [key, messages] of Object.entries(error.fieldErrors)) {
    const match = /^items\.(\d+)\.(.+)$/.exec(key)
    if (!match || messages.length === 0) continue
    const index = Number(match[1])
    if (Number.isInteger(index) && index >= 0 && index < result.length) {
      result[index][match[2]] = messages[0]
    }
  }
  return result
}

function formMessageFor(error: ApiError, fieldErrors: Errors): string | undefined {
  if (error.status === HTTP_STATUS.FORBIDDEN) {
    return 'You do not have permission to create documents.'
  }
  if (error.status === HTTP_STATUS.NOT_FOUND) {
    return 'The referenced client or document type was not found in your company.'
  }
  if (error.status === HTTP_STATUS.PAYLOAD_TOO_LARGE) {
    return 'The document is too large to create.'
  }
  if (error.status === HTTP_STATUS.TOO_MANY_REQUESTS) {
    return error.retryAfterSeconds !== null
      ? `Too many attempts. Please wait ${error.retryAfterSeconds} seconds and try again.`
      : 'Too many attempts. Please wait a moment and try again.'
  }
  if (Object.keys(fieldErrors).length === 0) {
    return error.message || 'Document creation failed. Please try again.'
  }
  return error.fieldErrors.non_field_errors?.[0]
}

/**
 * Create-generated-document form (`POST /api/generated-documents/`), backed by
 * the existing real clients / reference-data / templates APIs. Fields follow
 * `GeneratedDocumentCreateSerializer` (client, document type, currency, and
 * optional line items); totals and numbering are computed server-side and are
 * never submitted. `company_id` is never sent — the backend owns the tenant.
 * On success the backend's real created-document id is used to open its detail
 * page.
 */
export function DocumentCreatePage() {
  const navigate = useNavigate()

  const [clients, retryClients] = useDependency(listClients)
  const [documentTypes, retryDocumentTypes] = useDependency(fetchDocumentTypes)
  const [currencies, retryCurrencies] = useDependency(fetchCurrencies)
  const [templates] = useDependency(listTemplates)

  const [clientId, setClientId] = useState('')
  const [documentTypeId, setDocumentTypeId] = useState('')
  const [currencyId, setCurrencyId] = useState('')
  const [items, setItems] = useState<ItemRow[]>([])

  const [fieldErrors, setFieldErrors] = useState<Errors>({})
  const [itemErrors, setItemErrors] = useState<Array<Errors>>([])
  const [formError, setFormError] = useState<string>()
  const [submitting, setSubmitting] = useState(false)

  // Which document types the company has an active template for. Only used as
  // a UX hint: when known, types without an active template are hidden from
  // the dropdown (the backend would reject them anyway). The backend remains
  // authoritative.
  const activeTemplateTypeIds = useMemo(() => {
    if (templates.status !== 'ready') return null
    const ids = new Set(
      templates.data.filter((template) => template.is_active).map((template) => template.document_type),
    )
    return ids.size > 0 ? ids : null
  }, [templates])

  const docTypeOptions = useMemo(() => {
    const all = documentTypes.status === 'ready' ? documentTypes.data : []
    if (activeTemplateTypeIds === null) return all
    return all.filter((type) => activeTemplateTypeIds.has(type.id))
  }, [documentTypes, activeTemplateTypeIds])

  const clientOptions = clients.status === 'ready' ? clients.data : []
  const currencyOptions = currencies.status === 'ready' ? currencies.data : []

  function addItem() {
    setItems((prev) => [...prev, emptyItemRow(newItemKey())])
  }

  function removeItem(index: number) {
    setItems((prev) => prev.filter((_, i) => i !== index))
  }

  function updateItem(index: number, field: keyof ItemRow, value: string) {
    setItems((prev) => prev.map((row, i) => (i === index ? { ...row, [field]: value } : row)))
  }

  function validate(): { fieldErrors: Errors; itemErrors: Array<Errors> } {
    const errors: Errors = {}
    if (!clientId) errors.client_id = 'A client is required.'
    if (!documentTypeId) errors.document_type_id = 'A document type is required.'
    if (!currencyId) errors.currency_id = 'A currency is required.'

    const lineErrors: Array<Errors> = items.map((row) => {
      const rowErrors: Errors = {}
      if (!row.description.trim()) rowErrors.description = 'Description is required.'
      if (!validNumber(row.quantity)) rowErrors.quantity = 'Quantity must be a number.'
      if (!validNumber(row.unit_price)) rowErrors.unit_price = 'Unit price must be a number.'
      if (!validNumber(row.vat_rate_percent)) {
        rowErrors.vat_rate_percent = 'VAT rate must be a number.'
      }
      if (row.discount_percent.trim() !== '' && !validNumber(row.discount_percent)) {
        rowErrors.discount_percent = 'Discount must be a number.'
      }
      return rowErrors
    })

    return { fieldErrors: errors, itemErrors: lineErrors }
  }

  function buildPayload(): CreateGeneratedDocumentInput {
    return {
      client_id: Number(clientId),
      document_type_id: Number(documentTypeId),
      currency_id: Number(currencyId),
      items: items.map((row) => ({
        description: row.description.trim(),
        quantity: Number(row.quantity),
        unit: row.unit.trim() ? row.unit.trim() : null,
        unit_price: Number(row.unit_price),
        discount_percent: row.discount_percent.trim() === '' ? 0 : Number(row.discount_percent),
        vat_rate_percent: Number(row.vat_rate_percent),
      })),
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (submitting) return

    const local = validate()
    setFieldErrors(local.fieldErrors)
    setItemErrors(local.itemErrors)
    setFormError(undefined)
    const hasErrors =
      Object.keys(local.fieldErrors).length > 0 ||
      local.itemErrors.some((row) => Object.keys(row).length > 0)
    if (hasErrors) return

    setSubmitting(true)
    try {
      const created = await createGeneratedDocument(buildPayload())
      navigate(`/documents/${created.id}`)
    } catch (error) {
      if (error instanceof ApiError) {
        const fieldErrors = topLevelFieldErrors(error)
        setFieldErrors(fieldErrors)
        setItemErrors(lineItemFieldErrors(error, items.length))
        setFormError(formMessageFor(error, fieldErrors))
      } else {
        setFormError('Document creation failed. Please try again.')
      }
    } finally {
      setSubmitting(false)
    }
  }

  const requiredDependencies = [
    { label: 'Clients', state: clients, onRetry: retryClients },
    { label: 'Document types', state: documentTypes, onRetry: retryDocumentTypes },
    { label: 'Currencies', state: currencies, onRetry: retryCurrencies },
  ] as const

  if (requiredDependencies.some((dep) => dep.state.status === 'loading')) {
    return (
      <PageContainer title="New document">
        <p
          data-testid="document-create-loading"
          className="animate-pulse text-sm text-slate-400"
        >
          Loading form data…
        </p>
      </PageContainer>
    )
  }

  if (requiredDependencies.some((dep) => dep.state.status === 'error')) {
    return (
      <PageContainer title="New document">
        <div className="space-y-3">
          {requiredDependencies.map((dep) =>
            dep.state.status === 'error' ? (
              <div
                key={dep.label}
                role="alert"
                className="rounded-md bg-red-50 px-4 py-3 text-sm text-red-700"
              >
                Couldn't load {dep.label.toLowerCase()}.
                <button
                  type="button"
                  onClick={dep.onRetry}
                  className="ml-3 font-medium text-slate-700 underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-slate-500"
                >
                  Retry
                </button>
              </div>
            ) : null,
          )}
          <p className="text-sm text-slate-600">
            <Link to="/documents" className="underline hover:text-slate-900">
              Back to documents
            </Link>
          </p>
        </div>
      </PageContainer>
    )
  }

  return (
    <PageContainer title="New document">
      <div className="max-w-3xl rounded-lg border border-slate-200 bg-white p-6">
        <form onSubmit={handleSubmit} className="space-y-4" noValidate>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Field label="Client" htmlFor="client_id" required error={fieldErrors.client_id}>
              <select
                id="client_id"
                name="client_id"
                value={clientId}
                onChange={(event) => setClientId(event.target.value)}
                className={FIELD_INPUT_CLASS}
                aria-invalid={Boolean(fieldErrors.client_id)}
                aria-describedby={fieldErrors.client_id ? 'client_id-error' : undefined}
              >
                <option value="">Select a client</option>
                {clientOptions.map((client) => (
                  <option key={client.id} value={String(client.id)}>
                    {client.display_name || `Client #${client.id}`}
                  </option>
                ))}
              </select>
            </Field>

            <Field
              label="Document type"
              htmlFor="document_type_id"
              required
              error={fieldErrors.document_type_id}
            >
              <select
                id="document_type_id"
                name="document_type_id"
                value={documentTypeId}
                onChange={(event) => setDocumentTypeId(event.target.value)}
                className={FIELD_INPUT_CLASS}
                aria-invalid={Boolean(fieldErrors.document_type_id)}
                aria-describedby={
                  fieldErrors.document_type_id ? 'document_type_id-error' : undefined
                }
              >
                <option value="">Select a document type</option>
                {docTypeOptions.map((type) => (
                  <option key={type.id} value={String(type.id)}>
                    {type.name}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Currency" htmlFor="currency_id" required error={fieldErrors.currency_id}>
              <select
                id="currency_id"
                name="currency_id"
                value={currencyId}
                onChange={(event) => setCurrencyId(event.target.value)}
                className={FIELD_INPUT_CLASS}
                aria-invalid={Boolean(fieldErrors.currency_id)}
                aria-describedby={fieldErrors.currency_id ? 'currency_id-error' : undefined}
              >
                <option value="">Select a currency</option>
                {currencyOptions.map((currency) => (
                  <option key={currency.id} value={String(currency.id)}>
                    {currency.code}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          <section aria-label="Line items" className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-semibold text-slate-700">Line items (optional)</h2>
              <Button variant="secondary" onClick={addItem}>
                Add line item
              </Button>
            </div>

            {items.length === 0 ? (
              <p className="text-sm text-slate-500">
                No line items yet. Totals are calculated by the server when line items are added.
              </p>
            ) : (
              <ul className="space-y-3">
                {items.map((row, index) => (
                  <LineItemCard
                    key={row.key}
                    index={index}
                    row={row}
                    errors={itemErrors[index] ?? {}}
                    onChange={updateItem}
                    onRemove={removeItem}
                  />
                ))}
              </ul>
            )}
          </section>

          {formError ? (
            <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
              {formError}
            </p>
          ) : null}

          <div className="flex items-center gap-3">
            <Button type="submit" loading={submitting} loadingLabel="Creating…">
              Create document
            </Button>
            <Link to="/documents" className="text-sm text-slate-600 underline hover:text-slate-900">
              Cancel
            </Link>
          </div>
        </form>
      </div>
    </PageContainer>
  )
}

interface LineItemCardProps {
  index: number
  row: ItemRow
  errors: Errors
  onChange: (index: number, field: keyof ItemRow, value: string) => void
  onRemove: (index: number) => void
}

function LineItemCard({ index, row, errors, onChange, onRemove }: LineItemCardProps) {
  const fields: ReadonlyArray<{
    key: keyof ItemRow
    required: boolean
    type?: 'number'
  }> = [
    { key: 'description', required: true },
    { key: 'quantity', required: true, type: 'number' },
    { key: 'unit', required: false },
    { key: 'unit_price', required: true, type: 'number' },
    { key: 'discount_percent', required: false, type: 'number' },
    { key: 'vat_rate_percent', required: true, type: 'number' },
  ]

  return (
    <li className="rounded-lg border border-slate-200 bg-slate-50 p-4">
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="text-sm font-medium text-slate-700">Line {index + 1}</p>
        <button
          type="button"
          onClick={() => onRemove(index)}
          className="text-sm text-red-600 underline hover:text-red-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-slate-500"
        >
          Remove
        </button>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {fields.map(({ key, required, type }) => {
          const htmlFor = `item-${index}-${key}`
          return (
            <Field
              key={key}
              label={ITEM_FIELD_LABELS[key]}
              htmlFor={htmlFor}
              required={required}
              error={errors[key]}
            >
              <input
                id={htmlFor}
                name={key}
                type={type === 'number' ? 'number' : 'text'}
                step={type === 'number' ? 'any' : undefined}
                value={row[key]}
                onChange={(event) => onChange(index, key, event.target.value)}
                className={FIELD_INPUT_CLASS}
                aria-invalid={Boolean(errors[key])}
                aria-describedby={errors[key] ? `${htmlFor}-error` : undefined}
              />
            </Field>
          )
        })}
      </div>
    </li>
  )
}