import { Navigate, Route, Routes } from 'react-router-dom'

import { AppShell } from '../components/layout/AppShell'
import { AuthLayout } from '../components/layout/AuthLayout'
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
import { TemplatesIndexPage } from '../pages/templates/TemplatesIndexPage'
import { ProtectedRoute } from './ProtectedRoute'
import { RedirectIfAuthenticated } from './RedirectIfAuthenticated'

/**
 * Application route tree.
 *
 * * The application area is wrapped in {@link ProtectedRoute} and rendered
 *   through {@link AppShell}.
 * * `/login` is signed-out-only; authenticated users go straight to the
 *   dashboard.
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
          <Route path="documents" element={<DocumentsIndexPage />} />
          <Route path="documents/new" element={<DocumentCreatePage />} />
          <Route path="documents/:documentId" element={<DocumentDetailPage />} />
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