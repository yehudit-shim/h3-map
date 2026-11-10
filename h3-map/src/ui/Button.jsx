import { cn } from '../lib/cn.js'

const VARIANTS = {
  ghost: 'text-muted hover:bg-hover hover:text-fg',
  solid: 'bg-accent text-accent-fg hover:brightness-110 font-medium',
  outline: 'border border-line text-fg hover:bg-hover',
}

export function Button({ variant = 'ghost', size = 'md', active, className, type = 'button', ...props }) {
  return (
    <button
      type={type}
      className={cn(
        'inline-flex items-center justify-center gap-1.5 rounded-md transition-colors disabled:opacity-40 disabled:pointer-events-none cursor-pointer select-none',
        size === 'sm' ? 'h-7 px-2 text-[12px]' : 'h-8 px-3 text-[13px]',
        VARIANTS[variant],
        active && 'bg-hover text-accent',
        className,
      )}
      {...props}
    />
  )
}

/** Icon-only button. `label` is mandatory: it provides the accessible name and tooltip. */
export function IconButton({ label, icon: Icon, size = 16, active, className, variant = 'ghost', ...props }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={active === undefined ? undefined : active}
      className={cn(
        'inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md transition-colors cursor-pointer disabled:opacity-35 disabled:pointer-events-none',
        VARIANTS[variant],
        active && 'bg-hover text-accent',
        className,
      )}
      {...props}
    >
      <Icon size={size} strokeWidth={1.9} aria-hidden="true" />
    </button>
  )
}
