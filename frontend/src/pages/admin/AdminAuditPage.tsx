import { AdminSectionPlaceholder } from '../../components/ui/AdminSectionPlaceholder'

export function AdminAuditPage() {
  return (
    <AdminSectionPlaceholder
      title="Audit & Security"
      description="Review platform-wide audit and security events across companies."
      permission="system.audit.read"
    />
  )
}
