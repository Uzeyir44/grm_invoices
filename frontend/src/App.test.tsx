import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import { AuthProvider } from './contexts/AuthContext'
import { setAccessToken } from './utils/authStorage'

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

function renderAt(path: string) {
  return render(
    <AuthProvider>
      <MemoryRouter initialEntries={[path]}>
        <App />
      </MemoryRouter>
    </AuthProvider>,
  )
}

describe('App', () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    localStorage.clear()
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('redirects an unauthenticated user from a protected route to login', async () => {
    renderAt('/dashboard')
    expect(await screen.findByRole('heading', { name: /sign in/i })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: /dashboard/i })).not.toBeInTheDocument()
  })

  it('grants an authenticated user access to the dashboard shell', async () => {
    setAccessToken('token-1')
    fetchMock.mockResolvedValue(jsonResponse(200, ME))

    renderAt('/dashboard')

    expect(
      await screen.findByRole('navigation', { name: /main navigation/i }),
    ).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /dashboard/i })).toBeInTheDocument()
  })

  it('redirects an authenticated user away from /login to the dashboard', async () => {
    setAccessToken('token-1')
    fetchMock.mockResolvedValue(jsonResponse(200, ME))

    renderAt('/login')

    expect(await screen.findByRole('heading', { name: /dashboard/i })).toBeInTheDocument()
  })

  it('shows a loading state instead of redirecting while auth initializes', async () => {
    setAccessToken('token-1')
    fetchMock.mockReturnValue(new Promise<Response>(() => {}))

    renderAt('/dashboard')

    expect(screen.getByRole('status')).toHaveTextContent('Loading…')
    expect(screen.queryByRole('heading', { name: /sign in/i })).not.toBeInTheDocument()
  })

  it('lets an authenticated user navigate between protected sections', async () => {
    setAccessToken('token-1')
    fetchMock.mockResolvedValue(jsonResponse(200, ME))
    const user = userEvent.setup()
    renderAt('/dashboard')

    await screen.findByRole('heading', { name: /dashboard/i })
    await user.click(screen.getByRole('link', { name: /clients/i }))
    expect(await screen.findByRole('heading', { name: /clients/i })).toBeInTheDocument()
  })

  it('renders a not-found page for unknown routes', async () => {
    renderAt('/definitely-not-a-route')
    expect(await screen.findByRole('heading', { name: /not found/i })).toBeInTheDocument()
  })
})