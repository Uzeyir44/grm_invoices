import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AuthProvider } from './AuthContext'
import { useAuth } from './auth-context'
import { getAccessToken, setAccessToken, setRefreshToken } from '../utils/authStorage'

function jsonResponse(status: number, body: unknown, headers?: Record<string, string>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
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

function AuthProbe() {
  const { status, user, companyName, hasPermission, login, logout } = useAuth()
  return (
    <div>
      <span data-testid="status">{status}</span>
      <span data-testid="user">{user?.email ?? ''}</span>
      <span data-testid="company">{companyName ?? ''}</span>
      <span data-testid="perm-clients">{hasPermission('clients.read') ? 'yes' : 'no'}</span>
      <span data-testid="perm-templates">
        {hasPermission('templates.read') ? 'yes' : 'no'}
      </span>
      <button
        onClick={() => {
          void login(10, 'alice@example.com', 'secret')
        }}
      >
        login
      </button>
      <button onClick={logout}>logout</button>
    </div>
  )
}

function renderProbe() {
  return render(
    <AuthProvider>
      <AuthProbe />
    </AuthProvider>,
  )
}

async function statusText() {
  return (await screen.findByTestId('status')).textContent ?? ''
}

describe('AuthProvider', () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    localStorage.clear()
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('starts signed out when no token is stored', async () => {
    renderProbe()
    expect(await statusText()).toBe('unauthenticated')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('loads the current user and company from /me when a token exists', async () => {
    setAccessToken('token-1')
    fetchMock.mockResolvedValue(jsonResponse(200, ME))

    renderProbe()

    expect(await statusText()).toBe('authenticated')
    expect(screen.getByTestId('user').textContent).toBe('alice@example.com')
    expect(screen.getByTestId('company').textContent).toBe('Acme Co')
  })

  it('exposes permissions returned by /me and grants nothing when absent', async () => {
    setAccessToken('token-1')
    fetchMock.mockResolvedValue(jsonResponse(200, ME))

    renderProbe()
    await screen.findByTestId('status')
    // The backend /me currently returns no permissions, so nothing is granted.
    expect(screen.getByTestId('perm-clients').textContent).toBe('no')
    expect(screen.getByTestId('perm-templates').textContent).toBe('no')
  })

  it('populates permissions when /me provides them', async () => {
    setAccessToken('token-1')
    fetchMock.mockResolvedValue(jsonResponse(200, { ...ME, permissions: ['clients.read'] }))

    renderProbe()
    await screen.findByTestId('status')
    expect(screen.getByTestId('perm-clients').textContent).toBe('yes')
    expect(screen.getByTestId('perm-templates').textContent).toBe('no')
  })

  it('recovers with a refresh when /me returns 401', async () => {
    setAccessToken('expired')
    setRefreshToken('refresh-1')
    fetchMock
      .mockResolvedValueOnce(jsonResponse(401, { detail: 'expired' }))
      .mockResolvedValueOnce(jsonResponse(200, { access: 'fresh' }))
      .mockResolvedValue(jsonResponse(200, ME))

    renderProbe()

    expect(await statusText()).toBe('authenticated')
    expect(getAccessToken()).toBe('fresh')
    expect(screen.getByTestId('user').textContent).toBe('alice@example.com')
  })

  it('clears auth state and tokens when refresh fails', async () => {
    setAccessToken('expired')
    setRefreshToken('refresh-1')
    fetchMock
      .mockResolvedValueOnce(jsonResponse(401, { detail: 'expired' }))
      .mockResolvedValue(jsonResponse(401, { detail: 'Token is invalid or expired' }))

    renderProbe()

    expect(await statusText()).toBe('unauthenticated')
    expect(getAccessToken()).toBeNull()
    expect(screen.getByTestId('user').textContent).toBe('')
  })

  it('authenticates through the login action and loads /me', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(200, { access: 'tok', refresh: 'ref' }))
      .mockResolvedValue(jsonResponse(200, ME))

    renderProbe()
    await userEvent.click(screen.getByRole('button', { name: 'login' }))

    expect(await statusText()).toBe('authenticated')
    expect(screen.getByTestId('user').textContent).toBe('alice@example.com')
    expect(screen.getByTestId('company').textContent).toBe('Acme Co')
  })

  it('logs out by clearing state and tokens', async () => {
    setAccessToken('token-1')
    fetchMock.mockResolvedValue(jsonResponse(200, ME))

    renderProbe()
    await statusText()
    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('authenticated'))

    await userEvent.click(screen.getByRole('button', { name: 'logout' }))

    expect(screen.getByTestId('status').textContent).toBe('unauthenticated')
    expect(screen.getByTestId('user').textContent).toBe('')
    expect(getAccessToken()).toBeNull()
  })
})