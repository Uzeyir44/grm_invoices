import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'

import { getTemplate, listTemplates, updateTemplate } from '../../api/templates'
import { fetchDocumentTypes } from '../../api/referenceData'
import { Button } from '../../components/ui/Button'
import { Field } from '../../components/ui/Field'
import { PageContainer } from '../../components/ui/PageContainer'
import { FIELD_INPUT_CLASS } from '../../components/ui/formClasses'
import { ApiError, HTTP_STATUS } from '../../types/api'
import type { DocumentTemplate } from '../../types/documentTemplate'
import type { DocumentType } from '../../types/referenceData'

type Errors = Record<string, string>

function firstFieldErrors(error: ApiError): Errors {
  const result: Errors = {}
  for (const [key, messages] of Object.entries(error.fieldErrors)) {
    if (messages.length > 0) result[key] = messages[0]
  }
  return result
}

function formMessageFor(error: ApiError, fieldErrors: Errors): string | undefined {
  if (error.status === HTTP_STATUS.FORBIDDEN) {
    return 'You do not have permission to edit this template.'
  }
  if (error.status === HTTP_STATUS.NOT_FOUND) {
    return 'Template not found. It may have been deleted.'
  }
  if (error.status === HTTP_STATUS.TOO_MANY_REQUESTS) {
    return error.retryAfterSeconds !== null
      ? `Too many attempts. Please wait ${error.retryAfterSeconds} seconds and try again.`
      : 'Too many attempts. Please wait a moment and try again.'
  }
  if (Object.keys(fieldErrors).length === 0) {
    return error.message || 'Template update failed. Please try again.'
  }
  return error.fieldErrors.non_field_errors?.[0]
}

/**
 * Edit-template metadata form (`PATCH /api/document-templates/:id/`).
 *
 * Editable fields follow the backend `DocumentTemplateSerializer` with
 * `partial=True`: `name`, `document_type` (a foreign-key id selected from
 * the read-only reference-data catalog), and `is_active`. Everything else
 * (`company_id`, `document_type_code`, `file` / `file_name`, timestamps) is
 * read-only and shown as such — the company is never sent, the backend takes
 * it from the authenticated user. On success the app returns to the detail
 * page, which refetches the template from the backend (the source of truth)
 * and shows a confirmation notice.
 */
export function TemplateEditPage() {
  const { templateId } = useParams()
  const id = Number(templateId)
  const navigate = useNavigate()

  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string>()
  const [notFound, setNotFound] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)

  const [name, setName] = useState('')
  const [documentTypeId, setDocumentTypeId] = useState('')
  const [isActive, setIsActive] = useState(true)

  const [documentTypes, setDocumentTypes] = useState<DocumentType[] | null>(null)
  const [typesError, setTypesError] = useState(false)

  // The company's existing (non-deleted) templates, used only to disable
  // document types already owned by a *different* template. The current
  // template's own type stays selectable. Non-blocking: the backend/database
  // remain authoritative.
  const [templates, setTemplates] = useState<DocumentTemplate[] | null>(null)

  // Read-only metadata shown alongside the form (never submitted).
  const [readOnly, setReadOnly] = useState({
    documentTypeCode: '',
    fileName: null as string | null,
    createdAt: '',
    updatedAt: '',
  })

  const [fieldErrors, setFieldErrors] = useState<Errors>({})
  const [formError, setFormError] = useState<string>()
  const [submitting, setSubmitting] = useState(false)
  const mountedRef = useRef(true)
  // Latest route id, so a late submit outcome never navigates away from or
  // writes errors onto a different template's form. Synced in an effect
  // declared before the loading effects below.
  const idRef = useRef(id)

  // The route moved to a different template: drop the previous template's
  // form state immediately so stale values are never shown for the new one.
  // (Render-phase adjustment for the new `id`; the effects below refetch,
  // and their cancellation guards discard late responses.)
  const [idKey, setIdKey] = useState(id)
  if (idKey !== id) {
    setIdKey(id)
    setLoading(true)
    setLoadError(undefined)
    setNotFound(false)
    setTypesError(false)
    setFieldErrors({})
    setFormError(undefined)
    setSubmitting(false)
  }

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  useEffect(() => {
    idRef.current = id
  })

  useEffect(() => {
    if (Number.isNaN(id)) return
    // A stale in-flight response must never overwrite newer template state
    // when navigating rapidly between edit routes.
    let cancelled = false
    void getTemplate(id)
      .then((data) => {
        if (cancelled) return
        setName(data.name)
        setDocumentTypeId(String(data.document_type))
        setIsActive(data.is_active)
        setReadOnly({
          documentTypeCode: data.document_type_code,
          fileName: data.file_name,
          createdAt: data.created_at,
          updatedAt: data.updated_at,
        })
        setNotFound(false)
        setLoadError(undefined)
      })
      .catch((error: unknown) => {
        if (cancelled) return
        if (error instanceof ApiError && error.status === HTTP_STATUS.NOT_FOUND) {
          setNotFound(true)
        } else if (error instanceof ApiError && error.status === HTTP_STATUS.FORBIDDEN) {
          setLoadError('You do not have permission to edit this template.')
        } else {
          setLoadError("Couldn't load the template.")
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [id, reloadKey])

  useEffect(() => {
    if (Number.isNaN(id)) return
    let cancelled = false
    void fetchDocumentTypes()
      .then((data) => {
        if (cancelled) return
        setDocumentTypes(data)
        setTypesError(false)
      })
      .catch(() => {
        if (cancelled) return
        setTypesError(true)
      })
    return () => {
      cancelled = true
    }
  }, [id, reloadKey])

  useEffect(() => {
    if (Number.isNaN(id)) return
    let cancelled = false
    void listTemplates()
      .then((data) => {
        if (cancelled) return
        setTemplates(Array.isArray(data) ? data : [])
      })
      .catch(() => {
        // Non-blocking UX hint only; the backend remains authoritative.
      })
    return () => {
      cancelled = true
    }
  }, [id, reloadKey])

  // Document types already owned by another template of this company. The
  // current template is excluded so its own type remains selectable.
  const takenByOtherTemplates = useMemo(() => {
    const ids = new Set<number>()
    for (const template of templates ?? []) {
      if (template.id !== id) ids.add(template.document_type)
    }
    return ids
  }, [templates, id])

  function retryLoad() {
    setLoading(true)
    setLoadError(undefined)
    setNotFound(false)
    setTypesError(false)
    setReloadKey((key) => key + 1)
  }

  function validate(): Errors {
    const errors: Errors = {}
    if (!name.trim()) errors.name = 'Template name is required.'
    if (!documentTypeId) errors.document_type = 'A document type is required.'
    else if (takenByOtherTemplates.has(Number(documentTypeId))) {
      errors.document_type = 'A template already exists for this document type.'
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

    setSubmitting(true)
    const requestTemplateId = id
    try {
      await updateTemplate(requestTemplateId, {
        name: name.trim(),
        document_type: Number(documentTypeId),
        is_active: isActive,
      })
      if (!mountedRef.current || idRef.current !== requestTemplateId) return
      navigate(`/templates/${requestTemplateId}`, { state: { templateUpdated: true } })
    } catch (error) {
      if (!mountedRef.current || idRef.current !== requestTemplateId) return
      if (error instanceof ApiError) {
        const errors = firstFieldErrors(error)
        setFieldErrors(errors)
        setFormError(formMessageFor(error, errors))
      } else {
        setFormError('Template update failed. Please try again.')
      }
    } finally {
      if (mountedRef.current && idRef.current === requestTemplateId) setSubmitting(false)
    }
  }

  if (Number.isNaN(id)) {
    return (
      <PageContainer title="Edit template">
        <p className="text-sm text-slate-600">Template not found.</p>
        <Link to="/templates" className="text-sm text-slate-600 underline hover:text-slate-900">
          Back to templates
        </Link>
      </PageContainer>
    )
  }

  if (notFound) {
    return (
      <PageContainer title="Edit template">
        <p className="text-sm text-slate-600">Template not found.</p>
        <Link to="/templates" className="text-sm text-slate-600 underline hover:text-slate-900">
          Back to templates
        </Link>
      </PageContainer>
    )
  }

  if (loadError && !loading) {
    return (
      <PageContainer title="Edit template">
        <div role="alert" className="rounded-md bg-red-50 px-4 py-3 text-sm text-red-700">
          {loadError}
        </div>
        <Button variant="secondary" onClick={retryLoad}>
          Retry
        </Button>
      </PageContainer>
    )
  }

  if (loading || documentTypes === null) {
    if (!loading && typesError) {
      return (
        <PageContainer title="Edit template">
          <div role="alert" className="rounded-md bg-red-50 px-4 py-3 text-sm text-red-700">
            Couldn't load document types.
          </div>
          <Button variant="secondary" onClick={retryLoad}>
            Retry
          </Button>
          <p className="text-sm text-slate-600">
            <Link to={`/templates/${id}`} className="underline hover:text-slate-900">
              Back to template
            </Link>
          </p>
        </PageContainer>
      )
    }
    return (
      <PageContainer title="Edit template">
        <p data-testid="template-edit-loading" className="animate-pulse text-sm text-slate-400">
          Loading…
        </p>
      </PageContainer>
    )
  }

  return (
    <PageContainer title={`Edit template #${id}`}>
      <div className="max-w-2xl space-y-4">
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
          <h2 className="text-sm font-semibold text-slate-700">Read-only information</h2>
          <dl className="mt-2 grid gap-x-8 gap-y-2 text-sm sm:grid-cols-2">
            <div className="min-w-0">
              <dt className="text-slate-500">Template ID</dt>
              <dd className="break-words text-slate-900">{id}</dd>
            </div>
            <div className="min-w-0">
              <dt className="text-slate-500">Current document type</dt>
              <dd className="break-words text-slate-900">{readOnly.documentTypeCode || '—'}</dd>
            </div>
            <div className="min-w-0">
              <dt className="text-slate-500">Current file</dt>
              <dd className="break-words text-slate-900">
                {readOnly.fileName ? readOnly.fileName.split('/').pop() : 'No file uploaded'}
              </dd>
            </div>
            <div className="min-w-0">
              <dt className="text-slate-500">File uploads</dt>
              <dd className="text-slate-900">Managed on the detail page, not here.</dd>
            </div>
          </dl>
        </div>

        <div className="rounded-lg border border-slate-200 bg-white p-6">
          <form onSubmit={handleSubmit} className="space-y-4" noValidate>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Template name" htmlFor="name" required error={fieldErrors.name}>
                <input
                  id="name"
                  name="name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  className={FIELD_INPUT_CLASS}
                  aria-invalid={Boolean(fieldErrors.name)}
                  aria-describedby={fieldErrors.name ? 'name-error' : undefined}
                />
              </Field>
              <Field
                label="Document type"
                htmlFor="document_type"
                required
                error={fieldErrors.document_type}
              >
                <select
                  id="document_type"
                  name="document_type"
                  value={documentTypeId}
                  onChange={(event) => setDocumentTypeId(event.target.value)}
                  className={FIELD_INPUT_CLASS}
                  aria-invalid={Boolean(fieldErrors.document_type)}
                  aria-describedby={fieldErrors.document_type ? 'document_type-error' : undefined}
                >
                  <option value="">Select a document type</option>
                  {documentTypes.map((type) => {
                    const taken = takenByOtherTemplates.has(type.id)
                    return (
                      <option key={type.id} value={String(type.id)} disabled={taken}>
                        {type.name}
                        {taken ? ' (already has a template)' : ''}
                      </option>
                    )
                  })}
                </select>
              </Field>
            </div>

            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                name="is_active"
                checked={isActive}
                onChange={(event) => setIsActive(event.target.checked)}
                className="h-4 w-4 rounded border-slate-300 text-slate-900 focus:outline-none"
              />
              Active
            </label>

            {typesError ? (
              <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
                Couldn't refresh the document-type catalog. You can still save with the
                currently selected type.
              </p>
            ) : null}

            {formError ? (
              <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
                {formError}
              </p>
            ) : null}

            <div className="flex items-center gap-3">
              <Button type="submit" loading={submitting} loadingLabel="Saving…">
                Save changes
              </Button>
              <Link
                to={`/templates/${id}`}
                className="text-sm text-slate-600 underline hover:text-slate-900"
              >
                Cancel
              </Link>
            </div>
          </form>
        </div>
      </div>
    </PageContainer>
  )
}
