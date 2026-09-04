import type { ButtonHTMLAttributes } from 'react'
import { buttonClasses } from './buttonClasses'
import type { ButtonVariant } from './buttonClasses'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  loading?: boolean
  loadingLabel?: string
}

export function Button({
  variant = 'primary',
  loading = false,
  loadingLabel,
  disabled,
  children,
  className,
  type = 'button',
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      className={buttonClasses(variant, className)}
      {...rest}
    >
      {loading ? loadingLabel ?? 'Loading…' : children}
    </button>
  )
}