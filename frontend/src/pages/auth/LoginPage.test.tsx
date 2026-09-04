import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AuthProvider } from '../../contexts/AuthContext'
import { LoginPage } from './LoginPage'

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

describe('LoginPage', () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    localStorage.clear()
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  function renderLogin() {
    return render(
      <AuthProvider>
        <MemoryRouter initialEntries={['/login']}>
          <LoginPage />
        </MemoryRouter>
      </AuthProvider>,
    )
  }

  async function fillAndSubmit(
    user: ReturnType<typeof userEvent.setup>,
    values: { companyId?: string; email?: string; password?: string } = {},
  ) {
    const { companyId = '10', email = 'alice@example.com', password = 'secret' } = values
    if (companyId !== '') {
      await user.type(screen.getByLabelText(/company id/i), companyId)
    }
    if (email !== '') {
      await user.type(screen.getByLabelText(/email/i), email)
    }
    if (password !== '') {
      await user.type(screen.getByLabelText(/password/i), password)
    }
    await user.click(screen.getByRole('button', { name: 'Sign in' }))
  }

  it('renders the company id, email, and password fields', () => {
    renderLogin()
    expect(screen.getByLabelText(/company id/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/email/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/password/i)).toBeInTheDocument()
  })

  it('submits the real backend fields (company_id, email, password) on success', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(200, { access: 'tok', refresh: 'ref' }))
      .mockResolvedValue(jsonResponse(200, ME))
    const user = userEvent.setup()
    renderLogin()

    await fillAndSubmit(user)

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/authentication/token/')
    expect(JSON.parse(String(init.body))).toEqual({
      company_id: 10,
      email: 'alice@example.com',
      password: 'secret',
    })
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('shows a generic, non-enumerating message for incorrect credentials', async () => {
    fetchMock.mockResolvedValue(jsonResponse(401, { detail: 'No active account found' }))
    const user = userEvent.setup()
    renderLogin()

    await fillAndSubmit(user)

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toMatch(/invalid credentials/i)
    expect(alert.textContent).not.toContain('alice@example.com')
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

  it('validates required fields before calling the API', async () => {
    const user = userEvent.setup()
    renderLogin()

    await fillAndSubmit(user, { companyId: '', email: '', password: '' })

    expect(screen.getByText('Company ID is required.')).toBeInTheDocument()
    expect(screen.getByText('Email is required.')).toBeInTheDocument()
    expect(screen.getByText('Password is required.')).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects a non-numeric company id before calling the API', async () => {
    const user = userEvent.setup()
    renderLogin()

    await fillAndSubmit(user, { companyId: 'abc' })

    expect(screen.getByText('Company ID must be a number.')).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()
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

    const button = screen.getByRole('button', { name: /signing in/i })
    expect(button).toBeDisabled()
    resolveRequest(jsonResponse(200, ME))
    await userEvent.click(button)
  })
})