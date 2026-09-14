import { useCallback, useEffect, useState } from 'react'

import { listAdminExchangeRates } from '../../../api/adminReferenceData'
import type { AdminExchangeRate } from '../../../types/adminReferenceData'

/**
 * Read-only exchange-rate feed. Exchange rates are a shared market feed (the
 * rate actually used is snapshotted onto a document version at generation
 * time), so there are deliberately no mutation controls here.
 */
export function ExchangeRatesSection() {
  const [rows, setRows] = useState<AdminExchangeRate[] | null>(null)
  const [error, setError] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    let cancelled = false
    void listAdminExchangeRates()
      .then((data) => {
        if (cancelled) return
        setRows(Array.isArray(data) ? data : [])
        setError(false)
      })
      .catch(() => {
        if (cancelled) return
        setError(true)
      })
    return () => {
      cancelled = true
    }
  }, [reloadKey])

  const retry = useCallback(() => setReloadKey((key) => key + 1), [])

  return (
    <section aria-label="Exchange Rates" className="space-y-4">
      <div>
        <h2 className="text-base font-semibold text-slate-900">Exchange Rates</h2>
        <p className="text-sm text-slate-500">
          Shared market feed (read-only). The rate used on a document is
          snapshotted when the document is generated.
        </p>
      </div>

      {error ? (
        <div role="alert" className="rounded-md bg-red-50 px-4 py-3 text-sm text-red-700">
          Couldn't load exchange rates.
          <button
            type="button"
            onClick={retry}
            className="ml-3 font-medium underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-500"
          >
            Retry
          </button>
        </div>
      ) : null}

      {rows === null && !error ? (
        <p role="status" className="animate-pulse text-sm text-slate-400">
          Loading…
        </p>
      ) : null}

      {rows !== null && rows.length === 0 && !error ? (
        <p className="text-sm text-slate-500">No exchange rates.</p>
      ) : null}

      {rows !== null && rows.length > 0 && !error ? (
        <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th scope="col" className="px-4 py-2 font-medium">From currency</th>
                  <th scope="col" className="px-4 py-2 font-medium">To currency</th>
                  <th scope="col" className="px-4 py-2 font-medium">Rate</th>
                  <th scope="col" className="px-4 py-2 font-medium">Effective at</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((row) => (
                  <tr key={row.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3 text-slate-600">{row.from_currency_id}</td>
                    <td className="px-4 py-3 text-slate-600">{row.to_currency_id}</td>
                    <td className="px-4 py-3 text-slate-600">{row.rate}</td>
                    <td className="px-4 py-3 text-slate-600">{row.effective_at}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
    </section>
  )
}
