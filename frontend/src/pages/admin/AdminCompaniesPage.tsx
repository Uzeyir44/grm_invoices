import { AdminSectionPlaceholder } from '../../components/ui/AdminSectionPlaceholder'

export function AdminCompaniesPage() {
  return (
    <AdminSectionPlaceholder
      title="Companies"
      description="Create, review, and manage tenant companies across the platform."
      permission="system.companies.manage"
    />
  )
}
