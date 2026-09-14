import { AdminSectionPlaceholder } from '../../components/ui/AdminSectionPlaceholder'

export function AdminBackupsPage() {
  return (
    <AdminSectionPlaceholder
      title="Backups"
      description="Manage platform database and file backups."
      permission="system.backups.manage"
    />
  )
}
