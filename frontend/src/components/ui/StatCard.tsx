interface StatCardProps {
  label: string
  /** Displayed when there is data (>0). */
  value?: number
  loading?: boolean
  error?: string
  /** Shown instead of a "0" value when the dataset is legitimately empty. */
  empty?: string
  onRetry?: () => void
}

/**
 * A small labelled statistic card with loading / empty / error states.
 * Used by the dashboard; deliberately no animation beyond Tailwind's subtle
 * pulse while loading.
 */
export function StatCard({
  label,
  value,
  loading,
  error,
  empty,
  onRetry,
}: StatCardProps) {
  const testId = `stat-${label.toLowerCase()}`
  return (
    <div
      data-testid={testId}
      className="rounded-lg border border-slate-200 bg-white p-4"
    >
      <p className="text-sm font-medium text-slate-500">{label}</p>
      <div className="mt-2">
        {loading ? (
          <p
            data-testid={`${testId}-loading`}
            className="animate-pulse text-sm text-slate-400"
          >
            Loading…
          </p>
        ) : error ? (
          <p data-testid={`${testId}-error`} className="text-sm text-red-700">
            {error}
            {onRetry && (
              <button
                type="button"
                onClick={onRetry}
                className="ml-2 font-medium text-slate-700 underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-slate-500"
              >
                Retry
              </button>
            )}
          </p>
        ) : value !== undefined && value > 0 ? (
          <p
            data-testid={`${testId}-value`}
            className="text-2xl font-semibold text-slate-900"
          >
            {value}
          </p>
        ) : (
          <p data-testid={`${testId}-empty`} className="text-sm text-slate-500">
            {empty}
          </p>
        )}
      </div>
    </div>
  )
}