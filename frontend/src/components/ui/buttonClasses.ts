export type ButtonVariant = 'primary' | 'secondary' | 'danger'

const VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-slate-900 text-white hover:bg-slate-800',
  secondary: 'border border-slate-300 bg-white text-slate-700 hover:bg-slate-50',
  danger: 'bg-red-600 text-white hover:bg-red-500',
}

const BASE_CLASSES =
  'inline-flex items-center justify-center rounded-md px-4 py-2 text-sm font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-slate-500 disabled:cursor-not-allowed disabled:opacity-60'

/** Shared class builder so semantic `<Link>`s can render like buttons. */
export function buttonClasses(variant: ButtonVariant = 'primary', extra = ''): string {
  return `${BASE_CLASSES} ${VARIANTS[variant]} ${extra}`.trim()
}