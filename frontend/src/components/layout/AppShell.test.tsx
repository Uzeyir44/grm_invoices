import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AuthProvider } from '../../contexts/AuthContext'
import { AppShell } from './AppShell'
import { getAccessToken, getRefreshToken, setAccessToken } from '../../utils/authStorage'

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

const ME = {
  id: 1,
  email: 'alice@example.com',
  first_name: 'Alice',
  last_name: 'User',
  is_active: true,
  mfa_enabled: false,
  company_id: 10,
  company_name: 'Acme Co',
}

const fetchMock = vi.fn()

function renderShell(userOverrides: Record<string, unknown> = {}) {
  fetchMock.mockReset()
  fetchMock.mockResolvedValue(jsonResponse(200, { ...ME, ...userOverrides }))
  return render(
    <AuthProvider>
      <MemoryRouter initialEntries={['/dashboard']}>
        <Routes>
          <Route element={<AppShell />}>
            <Route path="/dashboard" element={<div>dashboard-content</div>} />
            <Route path="/clients" element={<div>clients-content</div>} />
          </Route>
        </Routes>
      </MemoryRouter>
    </AuthProvider>,
  )
}

describe('AppShell', () => {
  beforeEach(() => {
    localStorage.clear()
    fetchMock.mockReset()
    fetchMock.mockResolvedValue(jsonResponse(200, ME))
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('renders company, user name, and email from the authenticated state', async () => {
    setAccessToken('token-1')
    renderShell()
    expect(await screen.findByText('Acme Co')).toBeInTheDocument()
    expect(screen.getByText('Alice User')).toBeInTheDocument()
    expect(screen.getByText('alice@example.com')).toBeInTheDocument()
  })

  it('renders navigation entries as router links', async () => {
    setAccessToken('token-1')
    renderShell()
    await screen.findByText('Acme Co')
    const clients = screen.getByRole('link', { name: /clients/i })
    expect(clients).toHaveAttribute('href', '/clients')
    expect(screen.getByRole('link', { name: /templates/i })).toHaveAttribute(
      'href',
      '/templates',
    )
    expect(screen.getByRole('link', { name: /documents/i })).toHaveAttribute(
      'href',
      '/documents',
    )
  })

  it('indicates the active route on navigation', async () => {
    setAccessToken('token-1')
    renderShell()
    await screen.findByText('Acme Co')
    expect(screen.getByRole('link', { name: /dashboard/i })).toHaveAttribute(
      'aria-current',
      'page',
    )
    expect(screen.getByRole('link', { name: /clients/i })).not.toHaveAttribute(
      'aria-current',
      'page',
    )
  })

  it('logs out via the auth context and clears tokens', async () => {
    setAccessToken('token-1')
    renderShell()
    await screen.findByText('Acme Co')

    await userEvent.click(screen.getByRole('button', { name: /sign out/i }))

    expect(getAccessToken()).toBeNull()
    expect(getRefreshToken()).toBeNull()
  })

  it('does not crash when optional user/company values are missing', async () => {
    setAccessToken('token-1')
    renderShell({ first_name: '', last_name: '', company_name: null })
    // Only the email is available; the missing company name is not rendered.
    expect(await screen.findByText('alice@example.com')).toBeInTheDocument()
    expect(screen.queryByText('Acme Co')).not.toBeInTheDocument()
  })
})