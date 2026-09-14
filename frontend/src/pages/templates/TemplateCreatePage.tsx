import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'

import { createTemplate, listTemplates } from '../../api/templates'
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
    return 'You do not have permission to create templates.'
  }
  if (error.status === HTTP_STATUS.TOO_MANY_REQUESTS) {
    return error.retryAfterSeconds !== null
      ? `Too many attempts. Please wait ${error.retryAfterSeconds} seconds and try again.`
      : 'Too many attempts. Please wait a moment and try again.'
  }
  if (Object.keys(fieldErrors).length === 0) {
    return error.message || 'Template creation failed. Please try again.'
  }
  return error.fieldErrors.non_field_errors?.[0]
}

/**
 * Create-template form (`POST /api/document-templates/`). Fields follow the
 * backend `DocumentTemplateSerializer`: required `name` and `document_type`
 * (a foreign-key id selected from the read-only reference-data catalog) plus
 * the optional `is_active` flag. The backend does not require a file at
 * creation time, so none is collected here. The company is never sent — the
 * backend takes it from the authenticated user.
 */
export function TemplateCreatePage() {
  const navigate = useNavigate()
  const [name, setName] = useState('')
  const [documentTypeId, setDocumentTypeId] = useState('')
  const [isActive, setIsActive] = useState(true)

  const [documentTypes, setDocumentTypes] = useState<DocumentType[] | null>(null)
  const [typesLoading, setTypesLoading] = useState(true)
  const [typesError, setTypesError] = useState(false)
  const [typesReloadKey, setTypesReloadKey] = useState(0)

  // The company's existing (non-deleted) templates. Used only as a UX hint to
  // disable document types that already have a template — the backend/database
  // remain authoritative. A failure here is non-blocking: the form still
  // submits and the backend rejects a duplicate with a clear message.
  const [templates, setTemplates] = useState<DocumentTemplate[] | null>(null)

  const [fieldErrors, setFieldErrors] = useState<Errors>({})
  const [formError, setFormError] = useState<string>()
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
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
      .finally(() => {
        if (cancelled) return
        setTypesLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [typesReloadKey])

  useEffect(() => {
    let cancelled = false
    void listTemplates()
      .then((data) => {
        if (cancelled) return
        setTemplates(Array.isArray(data) ? data : [])
      })
      .catch(() => {
        // Leave `templates` as-is (null) so no option is disabled and the
        // backend remains the authority on duplicates.
      })
    return () => {
      cancelled = true
    }
  }, [typesReloadKey])

  // Document types that already have a template for this company. All listed
  // templates are non-deleted (the backend list excludes soft-deleted rows),
  // matching the DB invariant "one non-deleted template per document type".
  const takenDocumentTypeIds = useMemo(() => {
    const ids = new Set<number>()
    for (const template of templates ?? []) {
      ids.add(template.document_type)
    }
    return ids
  }, [templates])

  const retryTypes = useCallback(() => {
    setTypesLoading(true)
    setTypesError(false)
    setTypesReloadKey((key) => key + 1)
  }, [])

  function validate(): Errors {
    const errors: Errors = {}
    if (!name.trim()) errors.name = 'Template name is required.'
    if (!documentTypeId) errors.document_type = 'A document type is required.'
    else if (takenDocumentTypeIds.has(Number(documentTypeId))) {
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
    try {
      const created = await createTemplate({
        name: name.trim(),
        document_type: Number(documentTypeId),
        is_active: isActive,
      })
      navigate(`/templates/${created.id}`)
    } catch (error) {
      if (error instanceof ApiError) {
        const errors = firstFieldErrors(error)
        setFieldErrors(errors)
        setFormError(formMessageFor(error, errors))
      } else {
        setFormError('Template creation failed. Please try again.')
      }
    } finally {
      setSubmitting(false)
    }
  }

  if (typesLoading) {
    return (
      <PageContainer title="New template">
        <p data-testid="template-create-loading" className="animate-pulse text-sm text-slate-400">
          Loading document types…
        </p>
      </PageContainer>
    )
  }

  if (typesError || documentTypes === null) {
    return (
      <PageContainer title="New template">
        <div role="alert" className="rounded-md bg-red-50 px-4 py-3 text-sm text-red-700">
          Couldn't load document types.
        </div>
        <Button variant="secondary" onClick={retryTypes}>
          Retry
        </Button>
        <p className="text-sm text-slate-600">
          <Link to="/templates" className="underline hover:text-slate-900">
            Back to templates
          </Link>
        </p>
      </PageContainer>
    )
  }

  return (
    <PageContainer title="New template">
      <div className="max-w-2xl rounded-lg border border-slate-200 bg-white p-6">
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
                  const taken = takenDocumentTypeIds.has(type.id)
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

          {formError ? (
            <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
              {formError}
            </p>
          ) : null}

          <div className="flex items-center gap-3">
            <Button type="submit" loading={submitting} loadingLabel="Creating…">
              Create template
            </Button>
            <Link to="/templates" className="text-sm text-slate-600 underline hover:text-slate-900">
              Cancel
            </Link>
          </div>
        </form>
      </div>
    </PageContainer>
  )
}