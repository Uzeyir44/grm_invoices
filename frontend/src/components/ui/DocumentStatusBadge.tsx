import type { GeneratedDocumentStatus } from '../../types/generatedDocument'

const STATUS_LABELS: Record<GeneratedDocumentStatus, string> = {
  draft: 'Draft',
  generated: 'Generated',
  sent: 'Sent',
  void: 'Void',
}

const STATUS_CLASSES: Record<GeneratedDocumentStatus, string> = {
  draft: 'bg-slate-100 text-slate-700',
  generated: 'bg-emerald-100 text-emerald-800',
  sent: 'bg-sky-100 text-sky-800',
  void: 'bg-red-100 text-red-700',
}

/**
 * Badge showing a generated document's status. The status is communicated by
 * its text label as well as its colors, so it is not color-only.
 */
export function DocumentStatusBadge({ status }: { status: GeneratedDocumentStatus }) {
  return (
    <span
      data-testid="document-status"
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_CLASSES[status]}`}
    >
      {STATUS_LABELS[status]}
    </span>
  )
}