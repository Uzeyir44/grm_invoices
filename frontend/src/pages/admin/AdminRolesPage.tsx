import { AdminSectionPlaceholder } from '../../components/ui/AdminSectionPlaceholder'

export function AdminRolesPage() {
  return (
    <AdminSectionPlaceholder
      title="Roles & Permissions"
      description="Manage global role templates, company roles, and role assignments."
      permission="system.roles.manage"
    />
  )
}
