import { useCallback, useEffect, useState } from 'react'

import {
  createAdminBackup,
  deleteAdminBackup,
  downloadAdminBackup,
  getAdminBackupCapabilities,
  listAdminBackups,
  verifyAdminBackup,
} from '../../api/adminBackups'
import { Button } from '../../components/ui/Button'
import { PageContainer } from '../../components/ui/PageContainer'
import { ApiError, HTTP_STATUS } from '../../types/api'
import type {
  AdminBackup,
  AdminBackupStatus,
  AdminBackupType,
  BackupCapabilities,
  BackupVerification,
  PaginatedAdminBackups,
} from '../../types/adminBackup'

const TYPE_LABELS: Record<AdminBackupType, string> = {
  database: 'Database',
  media: 'Media',
}

const STATUS_LABELS: Record<AdminBackupStatus, string> = {
  pending: 'Pending',
  running: 'Running',
  completed: 'Completed',
  failed: 'Failed',
}

const STATUS_CLASSES: Record<AdminBackupStatus, string> = {
  pending: 'bg-slate-100 text-slate-700',
  running: 'bg-sky-100 text-sky-800',
  completed: 'bg-emerald-100 text-emerald-800',
  failed: 'bg-red-100 text-red-700',
}

function formatBytes(bytes: number | null): string {
  if (bytes === null) return '—'
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let value = bytes
  let unitIndex = -1
  do {
    value /= 1024
    unitIndex += 1
  } while (value >= 1024 && unitIndex < units.length - 1)
  return `${value.toFixed(1)} ${units[unitIndex]}`
}

function formatTimestamp(iso: string | null): string {
  if (!iso) return '—'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return `${date.toISOString().slice(0, 10)} ${date.toISOString().slice(11, 16)} UTC`
}

function formatChecksum(checksum: string): string {
  if (!checksum) return '—'
  return `${checksum.slice(0, 12)}…${checksum.slice(-8)}`
}

function errorMessage(error: ApiError): string {
  if (error.status === HTTP_STATUS.FORBIDDEN) {
    return 'You do not have permission to manage backups.'
  }
  if (error.status === HTTP_STATUS.NOT_FOUND) {
    return 'The requested backup was not found.'
  }
  if (error.status === HTTP_STATUS.TOO_MANY_REQUESTS) {
    return error.retryAfterSeconds !== null
      ? `Too many requests. Please wait ${error.retryAfterSeconds} seconds and try again.`
      : 'Too many requests. Please wait a moment and try again.'
  }
  return error.message || "Couldn't load backups."
}

function actionErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === HTTP_STATUS.CONFLICT) {
      return 'A backup is already in progress. Wait for it to finish and try again.'
    }
    if (error.status === HTTP_STATUS.BAD_REQUEST) {
      return error.payload?.detail ?? 'This backup type is not available on the server.'
    }
    return error.message || 'The action could not be completed.'
  }
  return 'The action could not be completed.'
}

function CapabilityCard({
  capability,
  inFlight,
  onCreate,
}: {
  capability: BackupCapabilities
  inFlight: AdminBackupType | null
  onCreate: (backupType: AdminBackupType) => void
}) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <h2 className="text-sm font-semibold text-slate-700">
        Create a backup
      </h2>
      <p className="mt-1 text-xs text-slate-500">
        Backups are created on demand by this server. Database backups use the
        configured PostgreSQL <code>pg_dump</code>; media backups archive the
        application-managed files. A complete backup is one of each.
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <div>
          <Button
            onClick={() => onCreate('database')}
            loading={inFlight === 'database'}
            loadingLabel="Creating database backup…"
            disabled={!capability.database.available || inFlight !== null}
          >
            Create database backup
          </Button>
          {!capability.database.available ? (
            <p className="mt-1 text-xs text-red-600" data-testid="database-capability-reason">
              {capability.database.reason}
            </p>
          ) : null}
        </div>
        <div>
          <Button
            variant="secondary"
            onClick={() => onCreate('media')}
            loading={inFlight === 'media'}
            loadingLabel="Creating media backup…"
            disabled={!capability.media.available || inFlight !== null}
          >
            Create media backup
          </Button>
          {!capability.media.available ? (
            <p className="mt-1 text-xs text-red-600" data-testid="media-capability-reason">
              {capability.media.reason}
            </p>
          ) : null}
        </div>
      </div>
    </div>
  )
}

function StatusBadge({ status }: { status: AdminBackupStatus }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_CLASSES[status]}`}
    >
      {STATUS_LABELS[status]}
    </span>
  )
}

function DeleteDialog({
  backup,
  deleting,
  error,
  onCancel,
  onConfirm,
}: {
  backup: AdminBackup
  deleting: boolean
  error: string | null
  onCancel: () => void
  onConfirm: () => void
}) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="delete-backup-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
    >
      <button
        type="button"
        aria-label="Close"
        className="absolute inset-0 bg-slate-900/40"
        onClick={onCancel}
        disabled={deleting}
      />
      <div className="relative w-full max-w-md rounded-lg bg-white p-6 shadow-xl">
        <h2
          id="delete-backup-title"
          className="text-base font-semibold text-slate-900"
        >
          Delete backup #{backup.id}?
        </h2>
        <p className="mt-2 text-sm text-slate-600">
          This permanently removes the backup artifact and its record. This
          cannot be undone.
        </p>
        <dl className="mt-4 grid gap-2 text-sm">
          <div className="flex justify-between gap-4">
            <dt className="text-slate-500">Identifier</dt>
            <dd className="font-medium text-slate-900">Backup #{backup.id}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-slate-500">Type</dt>
            <dd className="font-medium text-slate-900">
              {TYPE_LABELS[backup.backup_type]}
            </dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-slate-500">Created</dt>
            <dd className="font-medium text-slate-900">
              {formatTimestamp(backup.created_at)}
            </dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-slate-500">Size</dt>
            <dd className="font-medium text-slate-900">
              {formatBytes(backup.file_size)}
            </dd>
          </div>
        </dl>
        {error ? (
          <p role="alert" className="mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </p>
        ) : null}
        <div className="mt-6 flex justify-end gap-3">
          <Button variant="secondary" onClick={onCancel} disabled={deleting}>
            Cancel
          </Button>
          <Button variant="danger" loading={deleting} loadingLabel="Deleting…" onClick={onConfirm}>
            Yes, delete permanently
          </Button>
        </div>
      </div>
    </div>
  )
}

interface PageData {
  capability: BackupCapabilities
  list: PaginatedAdminBackups
}

/**
 * System Admin backups (`/admin/backups`).
 *
 * Backups contain the entire CRM dataset and are **system-level** — there is no
 * tenant/company selector and every capability is gated by the
 * `system.backups.manage` permission on the backend. The page renders only what
 * actually exists: real capability, real artifacts, and supported operations.
 * Restore and automated scheduling are not supported and are not shown.
 */
export function AdminBackupsPage() {
  const [data, setData] = useState<PageData | null>(null)
  const [failed, setFailed] = useState<ApiError | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const [creating, setCreating] = useState<AdminBackupType | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [verifyingId, setVerifyingId] = useState<number | null>(null)
  const [verifyResults, setVerifyResults] = useState<
    Record<number, BackupVerification>
  >({})
  const [deleteCandidate, setDeleteCandidate] = useState<AdminBackup | null>(
    null,
  )
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    Promise.all([getAdminBackupCapabilities(), listAdminBackups()])
      .then(([capability, list]) => {
        if (cancelled) return
        setData({ capability, list })
        setFailed(null)
      })
      .catch((caught: unknown) => {
        if (cancelled) return
        setFailed(
          caught instanceof ApiError
            ? caught
            : new ApiError({
                status: 0,
                payload: null,
                message: "Couldn't load backups.",
              }),
        )
      })
    return () => {
      cancelled = true
    }
  }, [reloadKey])

  const retry = () => {
    setFailed(null)
    setReloadKey((key) => key + 1)
  }

  const refresh = () => setReloadKey((key) => key + 1)

  const handleCreate = useCallback(
    async (backupType: AdminBackupType) => {
      setActionError(null)
      setCreating(backupType)
      try {
        const created = await createAdminBackup(backupType)
        if (created.status === 'failed') {
          setActionError(
            created.error_message ||
              'The backup failed. No backup artifact was created.',
          )
        }
        refresh()
      } catch (caught: unknown) {
        setActionError(actionErrorMessage(caught))
      } finally {
        setCreating(null)
      }
    },
    [],
  )

  const handleVerify = useCallback(
    async (backup: AdminBackup) => {
      setActionError(null)
      setVerifyingId(backup.id)
      try {
        const result = await verifyAdminBackup(backup.id)
        setVerifyResults((prev) => ({ ...prev, [backup.id]: result }))
      } catch (caught: unknown) {
        setActionError(actionErrorMessage(caught))
      } finally {
        setVerifyingId(null)
      }
    },
    [],
  )

  const handleDownload = useCallback(async (backup: AdminBackup) => {
    setActionError(null)
    try {
      const { blob, filename } = await downloadAdminBackup(backup)
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = filename
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      URL.revokeObjectURL(url)
    } catch (caught: unknown) {
      setActionError(actionErrorMessage(caught))
    }
  }, [])

  const confirmDelete = async () => {
    if (!deleteCandidate) return
    setDeleteError(null)
    setDeleting(true)
    try {
      await deleteAdminBackup(deleteCandidate.id)
      setDeleteCandidate(null)
      refresh()
    } catch (caught: unknown) {
      setDeleteError(actionErrorMessage(caught))
    } finally {
      setDeleting(false)
    }
  }

  const backups = data?.list.results ?? []

  return (
    <PageContainer title="Backups">
      <div className="space-y-4">
        <p className="text-sm text-slate-500">
          Backup management for the entire platform. Backups contain the full
          CRM dataset and are accessible only to System Administrators. Backups
          are created manually — there is no automated schedule and restore is
          not supported in this phase.
        </p>

        {actionError ? (
          <div
            role="alert"
            className="rounded-md bg-red-50 px-4 py-3 text-sm text-red-700"
          >
            {actionError}
          </div>
        ) : null}

        {failed ? (
          <div
            role="alert"
            className="rounded-md bg-red-50 px-4 py-3 text-sm text-red-700"
          >
            {errorMessage(failed)}
            <button
              type="button"
              onClick={retry}
              className="ml-3 font-medium underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-500"
            >
              Retry
            </button>
          </div>
        ) : null}

        {!data && !failed ? (
          <p
            role="status"
            data-testid="admin-backups-loading"
            className="animate-pulse text-sm text-slate-400"
          >
            Loading…
          </p>
        ) : null}

        {data ? (
          <>
            <CapabilityCard
              capability={data.capability}
              inFlight={creating}
              onCreate={(backupType) => {
                void handleCreate(backupType)
              }}
            />

            <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-slate-200 text-sm">
                  <caption className="sr-only">
                    Platform backups, newest first. Restore and automated
                    scheduling are not supported.
                  </caption>
                  <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                    <tr>
                      <th scope="col" className="px-4 py-2 font-medium">
                        Type
                      </th>
                      <th scope="col" className="px-4 py-2 font-medium">
                        Status
                      </th>
                      <th scope="col" className="px-4 py-2 font-medium">
                        Created
                      </th>
                      <th scope="col" className="px-4 py-2 font-medium">
                        Size
                      </th>
                      <th scope="col" className="px-4 py-2 font-medium">
                        Checksum
                      </th>
                      <th scope="col" className="px-4 py-2 font-medium">
                        Created by
                      </th>
                      <th scope="col" className="px-4 py-2 font-medium">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {backups.map((backup) => {
                      const verification = verifyResults[backup.id]
                      return (
                        <tr key={backup.id} className="hover:bg-slate-50">
                          <td className="whitespace-nowrap px-4 py-3 text-slate-700">
                            {TYPE_LABELS[backup.backup_type]}
                          </td>
                          <td className="whitespace-nowrap px-4 py-3">
                            <StatusBadge status={backup.status} />
                            {backup.status === 'failed' &&
                            backup.error_message ? (
                              <p className="mt-1 max-w-64 text-xs text-red-600">
                                {backup.error_message}
                              </p>
                            ) : null}
                          </td>
                          <td className="whitespace-nowrap px-4 py-3 text-slate-600">
                            {formatTimestamp(backup.created_at)}
                          </td>
                          <td className="whitespace-nowrap px-4 py-3 text-slate-600">
                            {formatBytes(backup.file_size)}
                          </td>
                          <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-slate-600">
                            {formatChecksum(backup.checksum_sha256)}
                          </td>
                          <td className="whitespace-nowrap px-4 py-3 text-slate-600">
                            {backup.created_by_name ?? '—'}
                          </td>
                          <td className="whitespace-nowrap px-4 py-3">
                            <div className="flex flex-wrap items-center gap-2">
                              {backup.status === 'completed' ? (
                                <button
                                  type="button"
                                  onClick={() => {
                                    void handleDownload(backup)
                                  }}
                                  className="text-sm text-slate-700 underline hover:text-slate-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-500"
                                >
                                  Download
                                </button>
                              ) : null}
                              <button
                                type="button"
                                disabled={verifyingId === backup.id}
                                onClick={() => {
                                  void handleVerify(backup)
                                }}
                                className="text-sm text-slate-700 underline hover:text-slate-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-500 disabled:cursor-wait disabled:opacity-50"
                              >
                                {verifyingId === backup.id ? 'Verifying…' : 'Verify'}
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  setDeleteError(null)
                                  setDeleteCandidate(backup)
                                }}
                                className="text-sm text-red-600 underline hover:text-red-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-500"
                              >
                                Delete
                              </button>
                            </div>
                            {verification ? (
                              <p className="mt-1 text-xs text-slate-600" data-testid={`verify-result-${backup.id}`}>
                                {verification.exists
                                  ? `File exists (${formatBytes(
                                      verification.size,
                                    )}) · checksum ${
                                      verification.checksum_matches
                                        ? 'matches'
                                        : 'does NOT match'
                                    }`
                                  : 'Artifact is missing on the server.'}
                              </p>
                            ) : null}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {backups.length === 0 ? (
              <div className="rounded-lg border border-dashed border-slate-300 px-4 py-10 text-center">
                <p className="text-sm text-slate-500" data-testid="admin-backups-empty">
                  No backups have been created yet.
                </p>
              </div>
            ) : null}
          </>
        ) : null}
      </div>

      {deleteCandidate ? (
        <DeleteDialog
          backup={deleteCandidate}
          deleting={deleting}
          error={deleteError}
          onCancel={() => setDeleteCandidate(null)}
          onConfirm={() => {
            void confirmDelete()
          }}
        />
      ) : null}
    </PageContainer>
  )
}