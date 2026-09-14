import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { AdminAuthProvider } from '../../contexts/AdminAuthContext'
import { adminMe, jsonResponse } from '../../test/adminFixtures'
import { AdminLoginPage } from './AdminLoginPage'

function renderLogin() {
  return render(
    <AdminAuthProvider>
      <MemoryRouter initialEntries={['/admin/login']}>
        <Routes>
          <Route path="/admin/login" element={<AdminLoginPage />} />
          <Route path="/admin/dashboard" element={<div>admin-dashboard</div>} />
        </Routes>
      </MemoryRouter>
    </AdminAuthProvider>,
  )
}

async function fillAndSubmit(
  user: ReturnType<typeof userEvent.setup>,
  values: { email?: string; password?: string } = {},
) {
  const { email = 'admin@grm.example', password = 'secret' } = values
  if (email !== '') {
    await user.type(screen.getByLabelText(/email/i), email)
  }
  if (password !== '') {
    await user.type(screen.getByLabelText(/password/i), password)
  }
  await user.click(screen.getByRole('button', { name: 'Sign in' }))
}

describe('AdminLoginPage', () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    localStorage.clear()
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('renders email and password fields, with no company field', () => {
    renderLogin()
    expect(screen.getByLabelText(/email/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/password/i)).toBeInTheDocument()
    // Admin login never asks for a company id (the backend resolves it).
    expect(screen.queryByLabelText(/company/i)).not.toBeInTheDocument()
  })

  it('submits the admin login credentials and lands on the dashboard', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(200, { access: 'a', refresh: 'r' }))
      .mockResolvedValueOnce(jsonResponse(200, adminMe()))
    const user = userEvent.setup()
    renderLogin()

    await fillAndSubmit(user)

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/admin/authentication/token/')
    expect(JSON.parse(String(init.body))).toEqual({
      email: 'admin@grm.example',
      password: 'secret',
    })
    expect(await screen.findByText('admin-dashboard')).toBeInTheDocument()
  })

  it('validates required fields before calling the API', async () => {
    const user = userEvent.setup()
    renderLogin()

    await fillAndSubmit(user, { email: '', password: '' })

    expect(screen.getByText('Email is required.')).toBeInTheDocument()
    expect(screen.getByText('Password is required.')).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('shows a generic, non-enumerating message for incorrect credentials', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(401, { detail: 'No active account found' }),
    )
    const user = userEvent.setup()
    renderLogin()

    await fillAndSubmit(user)

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toMatch(/invalid credentials/i)
    expect(alert.textContent).not.toContain('admin@grm.example')
    expect(screen.queryByText('admin-dashboard')).not.toBeInTheDocument()
  })

  it('maps a 403 (not a System Admin) to a safe message', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(200, { access: 'a', refresh: 'r' }))
      .mockResolvedValueOnce(jsonResponse(403, { detail: 'Forbidden.' }))
    const user = userEvent.setup()
    renderLogin()

    await fillAndSubmit(user)

    expect(
      await screen.findByText(/not authorized as a system admin/i),
    ).toBeInTheDocument()
  })

  it('shows a throttle message with a wait hint on 429', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(429, { detail: 'Request was throttled.' }, { 'Retry-After': '7' }),
    )
    const user = userEvent.setup()
    renderLogin()

    await fillAndSubmit(user)

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toMatch(/too many attempts/i)
    expect(alert.textContent).toContain('7')
  })

  it('shows backend validation field errors', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(400, { email: ['This field is required.'] }),
    )
    const user = userEvent.setup()
    renderLogin()

    await fillAndSubmit(user)

    expect(await screen.findByText('This field is required.')).toBeInTheDocument()
  })

  it('disables the submit button and shows a loading label while submitting', async () => {
    let resolveRequest: (value: Response) => void = () => {}
    fetchMock.mockReturnValue(
      new Promise<Response>((resolve) => {
        resolveRequest = resolve
      }),
    )
    const user = userEvent.setup()
    renderLogin()

    await fillAndSubmit(user)

    expect(screen.getByRole('button', { name: /signing in/i })).toBeDisabled()
    resolveRequest(jsonResponse(200, adminMe()))
  })
})
