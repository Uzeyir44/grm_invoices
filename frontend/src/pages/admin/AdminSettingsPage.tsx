import { AdminSectionPlaceholder } from '../../components/ui/AdminSectionPlaceholder'

export function AdminSettingsPage() {
  return (
    <AdminSectionPlaceholder
      title="Settings"
      description="Manage limited platform-level settings."
      permission="system.settings.manage"
    />
  )
}
