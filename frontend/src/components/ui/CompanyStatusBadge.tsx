import type { AdminCompany } from '../../types/adminCompany'

const STATUS_LABELS: Record<AdminCompany['status'], string> = {
  trial: 'Trial',
  active: 'Active',
  suspended: 'Suspended',
  cancelled: 'Cancelled',
}

const STATUS_CLASSES: Record<AdminCompany['status'], string> = {
  trial: 'bg-amber-100 text-amber-800',
  active: 'bg-emerald-100 text-emerald-800',
  suspended: 'bg-red-100 text-red-700',
  cancelled: 'bg-slate-200 text-slate-700',
}

/** Company lifecycle status badge; the label carries the meaning, not color alone. */
export function CompanyStatusBadge({ status }: { status: AdminCompany['status'] }) {
  return (
    <span
      data-testid="company-status"
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_CLASSES[status]}`}
    >
      {STATUS_LABELS[status]}
    </span>
  )
}
