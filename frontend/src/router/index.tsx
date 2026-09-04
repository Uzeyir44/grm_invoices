import { Navigate, Route, Routes } from 'react-router-dom'

import { AppShell } from '../components/layout/AppShell'
import { AuthLayout } from '../components/layout/AuthLayout'
import { AuthIndexPage } from '../pages/auth/AuthIndexPage'
import { ClientsIndexPage } from '../pages/clients/ClientsIndexPage'
import { DashboardIndexPage } from '../pages/dashboard/DashboardIndexPage'
import { DocumentsIndexPage } from '../pages/documents/DocumentsIndexPage'
import { NotFoundPage } from '../pages/NotFoundPage'
import { TemplatesIndexPage } from '../pages/templates/TemplatesIndexPage'

/**
 * Application route tree. Only foundation placeholders exist so far:
 * `/auth`, `/dashboard`, `/clients`, `/templates`, `/documents`.
 */
export function AppRouter() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<Navigate to="/dashboard" replace />} />
        <Route path="dashboard" element={<DashboardIndexPage />} />
        <Route path="clients" element={<ClientsIndexPage />} />
        <Route path="templates" element={<TemplatesIndexPage />} />
        <Route path="documents" element={<DocumentsIndexPage />} />
      </Route>
      <Route path="auth" element={<AuthLayout />}>
        <Route index element={<AuthIndexPage />} />
      </Route>
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  )
}