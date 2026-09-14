import { PageContainer } from '../../components/ui/PageContainer'
import { useAdminAuth } from '../../contexts/admin-auth-context'

interface AdminSectionSummary {
  label: string
  description: string
  permission: string
}

/**
 * The real manageable sections and the system permission each requires.
 * Rendered permission-aware; Dashboard itself needs no management permission.
 */
const ADMIN_SECTIONS: readonly AdminSectionSummary[] = [
  {
    label: 'Companies',
    description: 'Create and manage tenant companies.',
    permission: 'system.companies.manage',
  },
  {
    label: 'Users',
    description: 'Manage company users and role assignments.',
    permission: 'system.users.manage',
  },
  {
    label: 'Roles & Permissions',
    description: 'Manage role templates, company roles, and permissions.',
    permission: 'system.roles.manage',
  },
  {
    label: 'Reference Data',
    description: 'Manage the shared catalogs.',
    permission: 'system.reference.manage',
  },
  {
    label: 'Audit & Security',
    description: 'Review platform-wide audit and security events.',
    permission: 'system.audit.read',
  },
  {
    label: 'Backups',
    description: 'Manage platform database and file backups.',
    permission: 'system.backups.manage',
  },
  {
    label: 'Settings',
    description: 'Manage limited platform settings.',
    permission: 'system.settings.manage',
  },
]

/**
 * System Admin landing page. It shows only data that is actually available
 * from the Admin `/me` response — no fabricated statistics or charts.
 */
export function AdminDashboardPage() {
  const { admin, hasPermission } = useAdminAuth()

  const displayName =
    [admin?.first_name, admin?.last_name]
      .filter((part) => part && part.trim())
      .join(' ') ||
    admin?.email ||
    'System Administrator'

  const availableSections = ADMIN_SECTIONS.filter((section) =>
    hasPermission(section.permission),
  )

  return (
    <PageContainer title="Admin dashboard">
      <div className="space-y-6">
        <p>
          Welcome,{' '}
          <span className="font-medium text-slate-900">{displayName}</span>.
        </p>

        <dl className="grid gap-4 sm:grid-cols-3">
          <div className="rounded-lg border border-slate-200 bg-white p-4">
            <dt className="text-xs uppercase tracking-wide text-slate-500">
              Platform company
            </dt>
            <dd className="mt-1 text-sm text-slate-900">
              {admin?.company_name ?? '—'}
            </dd>
          </div>
          <div className="rounded-lg border border-slate-200 bg-white p-4">
            <dt className="text-xs uppercase tracking-wide text-slate-500">
              Authorization scope
            </dt>
            <dd className="mt-1 text-sm text-slate-900">{admin?.scope ?? '—'}</dd>
          </div>
          <div className="rounded-lg border border-slate-200 bg-white p-4">
            <dt className="text-xs uppercase tracking-wide text-slate-500">
              System permissions
            </dt>
            <dd className="mt-1 text-sm text-slate-900">
              {admin ? admin.permissions.length : 0}
            </dd>
          </div>
        </dl>

        <section aria-label="Available admin sections" className="space-y-2">
          <h2 className="text-sm font-semibold text-slate-700">
            Available sections
          </h2>
          {availableSections.length === 0 ? (
            <p className="text-sm text-slate-500">
              No platform management permissions are assigned to your account.
            </p>
          ) : (
            <ul className="grid gap-3 sm:grid-cols-2">
              {availableSections.map((section) => (
                <li
                  key={section.label}
                  className="rounded-lg border border-slate-200 bg-white p-4"
                >
                  <p className="text-sm font-medium text-slate-900">
                    {section.label}
                  </p>
                  <p className="mt-1 text-sm text-slate-600">
                    {section.description}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </PageContainer>
  )
}
