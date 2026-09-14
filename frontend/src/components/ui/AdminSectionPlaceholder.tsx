import { useAdminAuth } from '../../contexts/admin-auth-context'
import { PageContainer } from './PageContainer'

interface AdminSectionPlaceholderProps {
  title: string
  description: string
  /** System permission required to use the section; omit for permission-free pages. */
  permission?: string
}

/**
 * Placeholder for an Admin section whose functionality lands in a later phase.
 *
 * It performs a frontend-only permission check for UX: when the Admin lacks the
 * section's system permission it shows a safe "no access" notice instead of the
 * placeholder. This is not security — the backend `IsSystemAdmin` +
 * `SystemPermissionRequired` boundary remains authoritative.
 */
export function AdminSectionPlaceholder({
  title,
  description,
  permission,
}: AdminSectionPlaceholderProps) {
  const { hasPermission } = useAdminAuth()
  const allowed = permission === undefined || hasPermission(permission)

  return (
    <PageContainer title={title}>
      {allowed ? (
        <div className="space-y-2">
          <p>{description}</p>
          <p className="text-sm text-slate-500">
            This section is available in the Admin Panel; its functionality
            will be implemented in a later phase.
          </p>
        </div>
      ) : (
        <p
          role="alert"
          className="rounded-md bg-amber-50 px-4 py-3 text-sm text-amber-800"
        >
          Your System Admin account does not have the{' '}
          <code className="font-mono">{permission}</code> permission required
          for this section.
        </p>
      )}
    </PageContainer>
  )
}
