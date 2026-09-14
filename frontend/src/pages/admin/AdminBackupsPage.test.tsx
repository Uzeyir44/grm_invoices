import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { AdminAuthProvider } from '../../contexts/AdminAuthContext'
import { AdminBackupsPage } from './AdminBackupsPage'
import {
  adminBackup,
  adminBackupCapabilities,
  adminMe,
  jsonResponse,
} from '../../test/adminFixtures'
import { setAdminAccessToken } from '../../utils/adminAuthStorage'
import type { AdminBackup } from '../../types/adminBackup'

function renderPage() {
  return render(
    <AdminAuthProvider>
      <MemoryRouter initialEntries={['/admin/backups']}>
        <AdminBackupsPage />
      </MemoryRouter>
    </AdminAuthProvider>,
  )
}

function envelope(results: AdminBackup[], overrides: Record<string, unknown> = {}) {
  return jsonResponse(200, {
    count: results.length,
    next: null,
    previous: null,
    results,
    ...overrides,
  })
}

function emptyResponse(): Response {
  return new Response(null, { status: 204 })
}

describe('AdminBackupsPage', () => {
  const fetchMock = vi.fn()
  let backups: AdminBackup[]
  let listFailures = 0

  beforeEach(() => {
    localStorage.clear()
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
    setAdminAccessToken('admin-token')
    backups = []
    listFailures = 0
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  /** Generic backend stub handling /me/, capability, and the backups API. */
  function stub(
    handler: (
      url: string,
      init: RequestInit,
    ) => Response | Promise<Response> = () => envelope(backups),
  ) {
    fetchMock.mockImplementation(
      (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input)
        if (url.includes('/authentication/me/')) {
          return Promise.resolve(jsonResponse(200, adminMe()))
        }
        if (url.includes('/admin/backups/capability/')) {
          return Promise.resolve(
            jsonResponse(200, adminBackupCapabilities()),
          )
        }
        if (url.includes('/admin/backups/')) {
          return Promise.resolve(handler(url, init ?? {}))
        }
        return Promise.resolve(jsonResponse(404, { detail: 'not found' }))
      },
    )
  }

  it('shows a loading state', () => {
    fetchMock.mockReturnValue(new Promise<Response>(() => {}))
    renderPage()
    expect(screen.getByTestId('admin-backups-loading')).toBeInTheDocument()
  })

  it('shows the real empty state', async () => {
    stub()
    renderPage()
    expect(
      await screen.findByText('No backups have been created yet.'),
    ).toBeInTheDocument()
    expect(screen.getByTestId('admin-backups-empty')).toBeInTheDocument()
  })

  it('renders real backup data', async () => {
    backups = [adminBackup()]
    stub()
    renderPage()

    expect(await screen.findByText('Database')).toBeInTheDocument()
    expect(screen.getByText('Completed')).toBeInTheDocument()
    expect(screen.getByText('4.0 KB')).toBeInTheDocument()
    expect(screen.getByText('Ada Admin')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Download' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Verify' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Delete' })).toBeInTheDocument()
  })

  it('renders a failed backup without a download action', async () => {
    backups = [
      adminBackup({
        status: 'failed',
        file_size: null,
        error_message: 'The database backup process failed.',
        checksum_sha256: '',
      }),
    ]
    stub()
    renderPage()

    expect(await screen.findByText('Failed')).toBeInTheDocument()
    expect(
      screen.getByText('The database backup process failed.'),
    ).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Download' })).not.toBeInTheDocument()
  })

  it('shows an error state and retries', async () => {
    listFailures = 1
    stub(() => {
      if (listFailures > 0) {
        listFailures -= 1
        throw new Error('boom')
      }
      return envelope(backups)
    })
    const user = userEvent.setup()
    renderPage()

    expect(await screen.findByRole('alert')).toHaveTextContent(
      "Couldn't load backups.",
    )
    await user.click(screen.getByRole('button', { name: /retry/i }))
    expect(
      await screen.findByText('No backups have been created yet.'),
    ).toBeInTheDocument()
  })

  it('creates a database backup through the backend', async () => {
    const created = adminBackup({ id: 9 })
    const user = userEvent.setup()
    stub((url, init) => {
      if (init.method === 'POST' && url === '/api/admin/backups/') {
        backups = [created]
        return jsonResponse(201, created)
      }
      return envelope(backups)
    })
    renderPage()
    await screen.findByText('No backups have been created yet.')

    await user.click(screen.getByRole('button', { name: 'Create database backup' }))

    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some(([url, init]) => {
          const u = String(url)
          const i = init as RequestInit
          return (
            u === '/api/admin/backups/' &&
            i.method === 'POST' &&
            JSON.parse(String(i.body)).backup_type === 'database'
          )
        }),
      ).toBe(true)
    })
    expect(await screen.findByText('Completed')).toBeInTheDocument()
    expect(screen.getByText('Ada Admin')).toBeInTheDocument()
  })

  it('shows an in-flight state while creating and disables both buttons', async () => {
    const user = userEvent.setup()
    stub((url, init) => {
      if (init.method === 'POST' && url === '/api/admin/backups/') {
        return new Promise<Response>(() => {})
      }
      return envelope(backups)
    })
    renderPage()
    await screen.findByText('No backups have been created yet.')

    await user.click(screen.getByRole('button', { name: 'Create database backup' }))

    expect(
      screen.getByRole('button', { name: 'Creating database backup…' }),
    ).toBeDisabled()
    expect(
      screen.getByRole('button', { name: 'Create media backup' }),
    ).toBeDisabled()
  })

  it('shows a backend error when creation is rejected', async () => {
    const user = userEvent.setup()
    stub((_url, init) => {
      if (init.method === 'POST') {
        return jsonResponse(400, {
          detail: 'pg_dump is not configured on this server.',
        })
      }
      return envelope(backups)
    })
    renderPage()
    await screen.findByText('No backups have been created yet.')

    await user.click(screen.getByRole('button', { name: 'Create database backup' }))

    expect(
      await screen.findByText('pg_dump is not configured on this server.'),
    ).toBeInTheDocument()
  })

  it('surfaces a failed backup record as an action message, not a fake success', async () => {
    const user = userEvent.setup()
    stub((url, init) => {
      if (init.method === 'POST' && url === '/api/admin/backups/') {
        backups = [
          adminBackup({ status: 'failed', error_message: 'The backup failed.' }),
        ]
        return jsonResponse(201, backups[0])
      }
      return envelope(backups)
    })
    renderPage()
    await screen.findByText('No backups have been created yet.')

    await user.click(screen.getByRole('button', { name: 'Create database backup' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The backup failed.',
    )
  })

  it('disables creation and shows the reason when capability is unavailable', async () => {
    fetchMock.mockImplementation((input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/authentication/me/')) {
        return Promise.resolve(jsonResponse(200, adminMe()))
      }
      if (url.includes('/admin/backups/capability/')) {
        return Promise.resolve(
          jsonResponse(200, adminBackupCapabilities({
            database: {
              available: false,
              reason: 'pg_dump is not configured on this server.',
            },
          })),
        )
      }
      return Promise.resolve(envelope(backups))
    })
    renderPage()

    const createButton = await screen.findByRole('button', {
      name: 'Create database backup',
    })
    expect(createButton).toBeDisabled()
    expect(
      screen.getByTestId('database-capability-reason'),
    ).toHaveTextContent('pg_dump is not configured')
    // The media button stays available.
    expect(
      screen.getByRole('button', { name: 'Create media backup' }),
    ).not.toBeDisabled()
  })

  it('verifies a backup and shows the integrity result', async () => {
    backups = [adminBackup()]
    const user = userEvent.setup()
    stub((url) => {
      if (url.includes('/verify/')) {
        return jsonResponse(200, {
          exists: true,
          size: 4096,
          checksum_matches: true,
        })
      }
      return envelope(backups)
    })
    renderPage()
    await screen.findByText('Completed')

    await user.click(screen.getByRole('button', { name: 'Verify' }))

    expect(
      await screen.findByTestId('verify-result-7'),
    ).toHaveTextContent('checksum matches')
  })

  it('shows a mismatch verification result', async () => {
    backups = [adminBackup()]
    const user = userEvent.setup()
    stub((url) => {
      if (url.includes('/verify/')) {
        return jsonResponse(200, {
          exists: true,
          size: 4096,
          checksum_matches: false,
        })
      }
      return envelope(backups)
    })
    renderPage()
    await screen.findByText('Completed')

    await user.click(screen.getByRole('button', { name: 'Verify' }))

    expect(
      await screen.findByTestId('verify-result-7'),
    ).toHaveTextContent('checksum does NOT match')
  })

  it('downloads through the authenticated endpoint', async () => {
    backups = [adminBackup()]
    const createObjectURL = vi.fn(() => 'blob:mock')
    const revokeObjectURL = vi.fn()
    Object.assign(URL, { createObjectURL, revokeObjectURL })
    const user = userEvent.setup()
    stub((url) => {
      if (url.includes('/download/')) {
        return Promise.resolve(
          new Response(new Blob(['dump-bytes']), { status: 200 }),
        )
      }
      return envelope(backups)
    })
    renderPage()
    await screen.findByText('Completed')

    await user.click(screen.getByRole('button', { name: 'Download' }))

    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some(([url]) =>
          String(url).includes('/admin/backups/7/download/'),
        ),
      ).toBe(true)
    })
    expect(createObjectURL).toHaveBeenCalled()
    expect(revokeObjectURL).toHaveBeenCalled()
  })

  it('requires explicit confirmation before deleting', async () => {
    backups = [adminBackup({ id: 7, file_size: 2048 })]
    const user = userEvent.setup()
    stub((_url, init) => {
      if (init.method === 'DELETE') {
        backups = []
        return emptyResponse()
      }
      return envelope(backups)
    })
    renderPage()
    await screen.findByText('Completed')

    await user.click(screen.getByRole('button', { name: 'Delete' }))

    const dialog = await screen.findByRole('dialog')
    expect(dialog).toHaveTextContent('Delete backup #7?')
    expect(dialog).toHaveTextContent('2.0 KB')
    expect(dialog).toHaveTextContent('cannot be undone')
    // One-click deletion is not allowed: the DELETE has not happened yet.
    expect(
      fetchMock.mock.calls.some(
        ([, init]) => (init as RequestInit).method === 'DELETE',
      ),
    ).toBe(false)

    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByText('Completed')).toBeInTheDocument()
  })

  it('deletes only after confirmation', async () => {
    backups = [adminBackup()]
    const user = userEvent.setup()
    stub((_url, init) => {
      if (init.method === 'DELETE') {
        backups = []
        return emptyResponse()
      }
      return envelope(backups)
    })
    renderPage()
    await screen.findByText('Completed')

    await user.click(screen.getByRole('button', { name: 'Delete' }))
    await screen.findByRole('dialog')
    await user.click(
      screen.getByRole('button', { name: 'Yes, delete permanently' }),
    )

    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some(([url, init]) => {
          const i = init as RequestInit
          return (
            String(url).endsWith('/admin/backups/7/') && i.method === 'DELETE'
          )
        }),
      ).toBe(true)
    })
    expect(
      await screen.findByText('No backups have been created yet.'),
    ).toBeInTheDocument()
  })

  it('shows an unauthorized message when access is denied', async () => {
    fetchMock.mockImplementation((input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/authentication/me/')) {
        return Promise.resolve(jsonResponse(200, adminMe()))
      }
      return Promise.resolve(jsonResponse(403, { detail: 'Forbidden.' }))
    })
    renderPage()
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'You do not have permission to manage backups.',
    )
  })

  it('never renders a tenant/company selector', async () => {
    backups = [adminBackup()]
    stub()
    renderPage()
    await screen.findByText('Completed')
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/company/i)).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/tenant/i)).not.toBeInTheDocument()
  })

  it('never renders restore/schedule controls or secrets', async () => {
    backups = [
      adminBackup({
        checksum_sha256:
          '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08',
        file_name: 'grm-backup-database-20260914-080000-a1b2c3d4.dump',
      }),
    ]
    stub()
    renderPage()
    await screen.findByText('Completed')

    for (const name of [/restore/i, /schedule/i, /scheduled/i]) {
      expect(screen.queryByRole('button', { name })).not.toBeInTheDocument()
    }
    // No secrets or absolute paths are rendered.
    expect(screen.queryByText(/super-secret/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/C:\\Users/i)).not.toBeInTheDocument()
    // The checksum is truncated, never the full value.
    expect(
      screen.queryByText(
        '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08',
      ),
    ).not.toBeInTheDocument()
  })
})