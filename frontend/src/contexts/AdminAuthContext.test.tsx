import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { AdminAuthProvider } from './AdminAuthContext'
import { useAdminAuth } from './admin-auth-context'
import { adminMe, jsonResponse } from '../test/adminFixtures'
import {
  getAdminAccessToken,
  setAdminAccessToken,
  setAdminRefreshToken,
} from '../utils/adminAuthStorage'
import { getAccessToken, setAccessToken, setRefreshToken } from '../utils/authStorage'

function AdminProbe() {
  const { status, admin, hasPermission, login, logout } = useAdminAuth()
  return (
    <div>
      <span data-testid="status">{status}</span>
      <span data-testid="admin">{admin?.email ?? ''}</span>
      <span data-testid="perm-companies">
        {hasPermission('system.companies.manage') ? 'yes' : 'no'}
      </span>
      <span data-testid="perm-audit">
        {hasPermission('system.audit.read') ? 'yes' : 'no'}
      </span>
      <button
        onClick={() => {
          void login('admin@grm.example', 'secret')
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
    <AdminAuthProvider>
      <AdminProbe />
    </AdminAuthProvider>,
  )
}

async function statusText() {
  return (await screen.findByTestId('status')).textContent ?? ''
}

describe('AdminAuthProvider', () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    localStorage.clear()
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('starts signed out when no admin token is stored', async () => {
    renderProbe()
    expect(await statusText()).toBe('unauthenticated')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('does not bootstrap from a company token', async () => {
    setAccessToken('company-access')
    setRefreshToken('company-refresh')

    renderProbe()

    expect(await statusText()).toBe('unauthenticated')
    // The admin provider never reads company storage, so no request is made.
    expect(fetchMock).not.toHaveBeenCalled()
    expect(getAccessToken()).toBe('company-access')
  })

  it('bootstraps the admin session from /me when an admin token exists', async () => {
    setAdminAccessToken('admin-token')
    fetchMock.mockResolvedValue(jsonResponse(200, adminMe()))

    renderProbe()

    expect(await statusText()).toBe('authenticated')
    expect(screen.getByTestId('admin').textContent).toBe('admin@grm.example')
    expect(screen.getByTestId('perm-companies').textContent).toBe('yes')
    expect(screen.getByTestId('perm-audit').textContent).toBe('yes')
  })

  it('does not grant permissions that /me omits', async () => {
    setAdminAccessToken('admin-token')
    fetchMock.mockResolvedValue(
      jsonResponse(200, adminMe({ permissions: ['system.companies.manage'] })),
    )

    renderProbe()
    await screen.findByTestId('status')

    expect(screen.getByTestId('perm-companies').textContent).toBe('yes')
    expect(screen.getByTestId('perm-audit').textContent).toBe('no')
  })

  it('recovers with an admin refresh when /me returns 401', async () => {
    setAdminAccessToken('expired')
    setAdminRefreshToken('refresh-1')
    fetchMock
      .mockResolvedValueOnce(jsonResponse(401, { detail: 'expired' }))
      .mockResolvedValueOnce(jsonResponse(200, { access: 'fresh' }))
      .mockResolvedValueOnce(jsonResponse(200, adminMe()))

    renderProbe()

    expect(await statusText()).toBe('authenticated')
    expect(getAdminAccessToken()).toBe('fresh')
  })

  it('clears the admin session when the refresh cannot recover', async () => {
    setAdminAccessToken('expired')
    setAdminRefreshToken('refresh-1')
    fetchMock
      .mockResolvedValueOnce(jsonResponse(401, { detail: 'expired' }))
      .mockResolvedValueOnce(jsonResponse(401, { detail: 'invalid refresh' }))

    renderProbe()

    expect(await statusText()).toBe('unauthenticated')
    expect(getAdminAccessToken()).toBeNull()
    expect(screen.getByTestId('admin').textContent).toBe('')
  })

  it('authenticates through the login action and loads /me', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(200, { access: 'a', refresh: 'r' }))
      .mockResolvedValue(jsonResponse(200, adminMe()))

    renderProbe()
    await userEvent.click(screen.getByRole('button', { name: 'login' }))

    expect(await statusText()).toBe('authenticated')
    expect(screen.getByTestId('admin').textContent).toBe('admin@grm.example')
  })

  it('logs out by clearing admin state and tokens only', async () => {
    setAccessToken('company-access')
    setAdminAccessToken('admin-token')
    fetchMock.mockResolvedValue(jsonResponse(200, adminMe()))

    renderProbe()
    await waitFor(() =>
      expect(screen.getByTestId('status').textContent).toBe('authenticated'),
    )

    await userEvent.click(screen.getByRole('button', { name: 'logout' }))

    expect(screen.getByTestId('status').textContent).toBe('unauthenticated')
    expect(screen.getByTestId('admin').textContent).toBe('')
    expect(getAdminAccessToken()).toBeNull()
    // Company session is untouched.
    expect(getAccessToken()).toBe('company-access')
  })
})
