import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import App from './App'

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  )
}

describe('App', () => {
  it('renders the application shell and the dashboard page', () => {
    renderAt('/dashboard')
    expect(screen.getByRole('navigation', { name: /main navigation/i })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /dashboard/i })).toBeInTheDocument()
  })

  it('renders the auth section', () => {
    renderAt('/auth')
    expect(screen.getByRole('heading', { name: /authentication/i })).toBeInTheDocument()
  })

  it('renders placeholder pages for each CRM section', () => {
    for (const [path, name] of [
      ['/clients', /clients/i],
      ['/templates', /templates/i],
      ['/documents', /documents/i],
    ] as const) {
      renderAt(path)
      expect(screen.getByRole('heading', { name })).toBeInTheDocument()
    }
  })

  it('redirects the root path to the dashboard', async () => {
    renderAt('/')
    expect(await screen.findByRole('heading', { name: /dashboard/i })).toBeInTheDocument()
  })

  it('navigates between sections via the navigation links', async () => {
    const user = userEvent.setup()
    renderAt('/dashboard')
    await user.click(screen.getByRole('link', { name: /clients/i }))
    expect(await screen.findByRole('heading', { name: /clients/i })).toBeInTheDocument()
  })

  it('renders a not-found page for unknown routes', () => {
    renderAt('/definitely-not-a-route')
    expect(screen.getByRole('heading', { name: /not found/i })).toBeInTheDocument()
  })
})