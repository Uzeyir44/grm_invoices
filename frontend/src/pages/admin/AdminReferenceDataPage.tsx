import { AdminSectionPlaceholder } from '../../components/ui/AdminSectionPlaceholder'

export function AdminReferenceDataPage() {
  return (
    <AdminSectionPlaceholder
      title="Reference Data"
      description="Manage the shared catalogs (currencies, document types, banks, and more)."
      permission="system.reference.manage"
    />
  )
}
