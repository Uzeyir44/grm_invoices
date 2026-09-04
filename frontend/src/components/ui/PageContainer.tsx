import type { ReactNode } from 'react'

interface PageContainerProps {
  title: string
  children?: ReactNode
}

/**
 * Minimal page container establishing the shared page layout. This is a
 * technical foundation, not the final CRM design.
 */
export function PageContainer({ title, children }: PageContainerProps) {
  return (
    <section className="space-y-4" aria-labelledby={`page-${title}`}>
      <h1 id={`page-${title}`} className="text-xl font-semibold text-slate-900">
        {title}
      </h1>
      <div className="text-slate-600">{children}</div>
    </section>
  )
}