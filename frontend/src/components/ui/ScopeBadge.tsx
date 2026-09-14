import type { RbacScope } from '../../types/adminPermission'

const SCOPE_LABELS: Record<RbacScope, string> = {
  tenant: 'Tenant',
  system: 'System',
}

const SCOPE_CLASSES: Record<RbacScope, string> = {
  tenant: 'bg-sky-100 text-sky-800',
  system: 'bg-purple-100 text-purple-800',
}

/**
 * Badge for an RBAC scope. The label carries the meaning (not color alone);
 * `system` scopes are the protected platform domain.
 */
export function ScopeBadge({ scope }: { scope: RbacScope }) {
  return (
    <span
      data-testid="scope-badge"
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${SCOPE_CLASSES[scope]}`}
    >
      {SCOPE_LABELS[scope]}
    </span>
  )
}
