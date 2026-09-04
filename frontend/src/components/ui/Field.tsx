import type { ReactNode } from 'react'

interface FieldProps {
  label: string
  htmlFor: string
  required?: boolean
  error?: string
  children: ReactNode
}

/**
 * Label + control + optional inline error. Inputs render with
 * `aria-describedby` pointing at the error id when an error is present.
 */
export function Field({ label, htmlFor, required, error, children }: FieldProps) {
  return (
    <div className="space-y-1">
      <label htmlFor={htmlFor} className="block text-sm font-medium text-slate-700">
        {label}
        {required ? (
          <span className="ml-1 text-xs font-normal text-slate-500">(required)</span>
        ) : null}
      </label>
      {children}
      {error ? (
        <p id={`${htmlFor}-error`} className="text-sm text-red-600">
          {error}
        </p>
      ) : null}
    </div>
  )
}