import { Navigate, Route, Routes } from 'react-router-dom'

import { AdminShell } from '../components/layout/AdminShell'
import { AppShell } from '../components/layout/AppShell'
import { AuthLayout } from '../components/layout/AuthLayout'
import { AdminAuditPage } from '../pages/admin/AdminAuditPage'
import { AdminBackupsPage } from '../pages/admin/AdminBackupsPage'
import { AdminCompaniesPage } from '../pages/admin/AdminCompaniesPage'
import { AdminCompanyCreatePage } from '../pages/admin/AdminCompanyCreatePage'
import { AdminCompanyDetailPage } from '../pages/admin/AdminCompanyDetailPage'
import { AdminCompanyEditPage } from '../pages/admin/AdminCompanyEditPage'
import { AdminDashboardPage } from '../pages/admin/AdminDashboardPage'
import { AdminLoginPage } from '../pages/admin/AdminLoginPage'
import { AdminPermissionsPage } from '../pages/admin/AdminPermissionsPage'
import { AdminReferenceDataPage } from '../pages/admin/AdminReferenceDataPage'
import { AdminRoleCreatePage } from '../pages/admin/AdminRoleCreatePage'
import { AdminRoleDetailPage } from '../pages/admin/AdminRoleDetailPage'
import { AdminRoleEditPage } from '../pages/admin/AdminRoleEditPage'
import { AdminRolesPage } from '../pages/admin/AdminRolesPage'
import { AdminSettingsPage } from '../pages/admin/AdminSettingsPage'
import { AdminUserDetailPage } from '../pages/admin/AdminUserDetailPage'
import { AdminUserEditPage } from '../pages/admin/AdminUserEditPage'
import { AdminUserCreatePage } from '../pages/admin/AdminUserCreatePage'
import { AdminUsersPage } from '../pages/admin/AdminUsersPage'
import { AuditLogsIndexPage } from '../pages/auditLogs/AuditLogsIndexPage'
import { LoginPage } from '../pages/auth/LoginPage'
import { ClientCreatePage } from '../pages/clients/ClientCreatePage'
import { ClientDetailPage } from '../pages/clients/ClientDetailPage'
import { ClientEditPage } from '../pages/clients/ClientEditPage'
import { ClientsIndexPage } from '../pages/clients/ClientsIndexPage'
import { DashboardIndexPage } from '../pages/dashboard/DashboardIndexPage'
import { DocumentCreatePage } from '../pages/documents/DocumentCreatePage'
import { DocumentDetailPage } from '../pages/documents/DocumentDetailPage'
import { DocumentsIndexPage } from '../pages/documents/DocumentsIndexPage'
import { NotFoundPage } from '../pages/NotFoundPage'
import { TemplateCreatePage } from '../pages/templates/TemplateCreatePage'
import { TemplateDetailPage } from '../pages/templates/TemplateDetailPage'
import { TemplateEditPage } from '../pages/templates/TemplateEditPage'
import { TemplateVersionDetailPage } from '../pages/templates/TemplateVersionDetailPage'
import { TemplatesIndexPage } from '../pages/templates/TemplatesIndexPage'
import { AdminRoute } from './AdminRoute'
import { ProtectedRoute } from './ProtectedRoute'
import { RedirectIfAdminAuthenticated } from './RedirectIfAdminAuthenticated'
import { RedirectIfAuthenticated } from './RedirectIfAuthenticated'

/**
 * Application route tree — two independent surfaces:
 *
 * * The company CRM: wrapped in {@link ProtectedRoute} and rendered through
 *   {@link AppShell}; `/login` is signed-out-only.
 * * The System Admin panel: `/admin/login` is signed-out-only and `/admin/*` is
 *   wrapped in {@link AdminRoute} and rendered through {@link AdminShell}. The
 *   two surfaces use separate auth contexts and token storage.
 */
export function AppRouter() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<Navigate to="/dashboard" replace />} />
        <Route element={<ProtectedRoute />}>
          <Route path="dashboard" element={<DashboardIndexPage />} />
          <Route path="clients" element={<ClientsIndexPage />} />
          <Route path="clients/new" element={<ClientCreatePage />} />
          <Route path="clients/:clientId" element={<ClientDetailPage />} />
          <Route path="clients/:clientId/edit" element={<ClientEditPage />} />
          <Route path="templates" element={<TemplatesIndexPage />} />
          <Route path="templates/new" element={<TemplateCreatePage />} />
          <Route path="templates/:templateId" element={<TemplateDetailPage />} />
          <Route path="templates/:templateId/edit" element={<TemplateEditPage />} />
          <Route
            path="templates/:templateId/versions/:versionId"
            element={<TemplateVersionDetailPage />}
          />
          <Route path="documents" element={<DocumentsIndexPage />} />
          <Route path="documents/new" element={<DocumentCreatePage />} />
          <Route path="documents/:documentId" element={<DocumentDetailPage />} />
          <Route path="audit-logs" element={<AuditLogsIndexPage />} />
        </Route>
      </Route>

      {/* System Admin surface */}
      <Route path="admin/login" element={<AuthLayout />}>
        <Route
          index
          element={
            <RedirectIfAdminAuthenticated>
              <AdminLoginPage />
            </RedirectIfAdminAuthenticated>
          }
        />
      </Route>
      <Route path="admin" element={<AdminRoute />}>
        <Route element={<AdminShell />}>
          <Route index element={<Navigate to="/admin/dashboard" replace />} />
          <Route path="dashboard" element={<AdminDashboardPage />} />
          <Route path="companies" element={<AdminCompaniesPage />} />
          <Route path="companies/new" element={<AdminCompanyCreatePage />} />
          <Route
            path="companies/:companyId"
            element={<AdminCompanyDetailPage />}
          />
          <Route
            path="companies/:companyId/edit"
            element={<AdminCompanyEditPage />}
          />
          <Route path="users" element={<AdminUsersPage />} />
          <Route path="users/new" element={<AdminUserCreatePage />} />
          <Route path="users/:userId" element={<AdminUserDetailPage />} />
          <Route path="users/:userId/edit" element={<AdminUserEditPage />} />
          <Route path="roles" element={<AdminRolesPage />} />
          <Route path="roles/new" element={<AdminRoleCreatePage />} />
          <Route path="roles/:roleId" element={<AdminRoleDetailPage />} />
          <Route path="roles/:roleId/edit" element={<AdminRoleEditPage />} />
          <Route path="permissions" element={<AdminPermissionsPage />} />
          <Route path="reference-data" element={<AdminReferenceDataPage />} />
          <Route path="audit" element={<AdminAuditPage />} />
          <Route path="backups" element={<AdminBackupsPage />} />
          <Route path="settings" element={<AdminSettingsPage />} />
        </Route>
      </Route>

      <Route path="login" element={<AuthLayout />}>
        <Route
          index
          element={
            <RedirectIfAuthenticated>
              <LoginPage />
            </RedirectIfAuthenticated>
          }
        />
      </Route>
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  )
}
