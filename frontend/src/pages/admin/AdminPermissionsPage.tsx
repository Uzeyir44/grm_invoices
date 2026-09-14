import { AdminSectionPlaceholder } from '../../components/ui/AdminSectionPlaceholder'

export function AdminPermissionsPage() {
  return (
    <AdminSectionPlaceholder
      title="Permission Catalog"
      description="Review the fixed tenant and system permission catalog."
      permission="system.roles.manage"
    />
  )
}
