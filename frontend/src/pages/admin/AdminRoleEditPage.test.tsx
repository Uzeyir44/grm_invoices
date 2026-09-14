import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { AdminAuthProvider } from '../../contexts/AdminAuthContext'
import { adminMe, adminRoleDetail, jsonResponse } from '../../test/adminFixtures'
import { setAdminAccessToken } from '../../utils/adminAuthStorage'
import { AdminRoleEditPage } from './AdminRoleEditPage'

function renderPage() {
  return render(
    <AdminAuthProvider>
      <MemoryRouter initialEntries={['/admin/roles/3/edit']}>
        <Routes>
          <Route path="/admin/roles/:roleId/edit" element={<AdminRoleEditPage />} />
          <Route path="/admin/roles/:roleId" element={<div>role-detail-page</div>} />
        </Routes>
      </MemoryRouter>
    </AdminAuthProvider>,
  )
}

describe('AdminRoleEditPage', () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    localStorage.clear()
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
    setAdminAccessToken('admin-token')
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  function stub(role = adminRoleDetail()) {
    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.includes('/authentication/me/')) {
        return Promise.resolve(jsonResponse(200, adminMe()))
      }
      if ((init?.method ?? 'GET') === 'PATCH') {
        const body = JSON.parse(String((init as RequestInit).body))
        return Promise.resolve(jsonResponse(200, adminRoleDetail({ ...body })))
      }
      return Promise.resolve(jsonResponse(200, role))
    })
  }

  it('pre-fills the role name', async () => {
    stub(adminRoleDetail({ name: 'Manager A' }))
    renderPage()
    expect(await screen.findByLabelText(/role name/i)).toHaveValue('Manager A')
    // Scope/company are not editable controls.
    expect(screen.queryByLabelText(/scope/i)).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/^company$/i)).not.toBeInTheDocument()
  })

  it('validates the name before PATCHing', async () => {
    stub()
    const user = userEvent.setup()
    renderPage()
    await screen.findByLabelText(/role name/i)

    await user.clear(screen.getByLabelText(/role name/i))
    await user.click(screen.getByRole('button', { name: /save changes/i }))

    expect(screen.getByText('A role name is required.')).toBeInTheDocument()
    const patches = fetchMock.mock.calls.filter(
      ([, init]) => (init as RequestInit | undefined)?.method === 'PATCH',
    )
    expect(patches).toHaveLength(0)
  })

  it('saves through PATCH and returns to the detail page', async () => {
    stub()
    const user = userEvent.setup()
    renderPage()
    const name = await screen.findByLabelText(/role name/i)

    await user.clear(name)
    await user.type(name, 'Senior Manager')
    await user.click(screen.getByRole('button', { name: /save changes/i }))

    const patch = fetchMock.mock.calls.find(
      ([url, init]) =>
        String(url).endsWith('/admin/roles/3/') &&
        (init as RequestInit | undefined)?.method === 'PATCH',
    ) as [string, RequestInit]
    expect(patch).toBeDefined()
    expect(JSON.parse(String(patch[1].body))).toEqual({ name: 'Senior Manager' })
    expect(await screen.findByText('role-detail-page')).toBeInTheDocument()
  })

  it('does not allow editing a system role', async () => {
    stub(adminRoleDetail({ name: 'System Admin', scope: 'system', company_id: null, company_name: null }))
    renderPage()
    expect(
      await screen.findByText(/system roles are protected/i),
    ).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /save changes/i })).not.toBeInTheDocument()
  })
})
