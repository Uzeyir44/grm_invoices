import { AdminSectionPlaceholder } from '../../components/ui/AdminSectionPlaceholder'

export function AdminUsersPage() {
  return (
    <AdminSectionPlaceholder
      title="Users"
      description="Manage company users and their role assignments across tenants."
      permission="system.users.manage"
    />
  )
}
