import { AlertTriangle, CheckCircle2, Info, Loader2, X } from 'lucide-react'
import { cn } from '../lib/cn.js'
import { useNotifyStore } from '../state/notifyStore.js'
import { IconButton } from './Button.jsx'

export function Spinner({ size = 14, className, label = 'Loading' }) {
  return <Loader2 size={size} className={cn('animate-spin text-accent', className)} role="status" aria-label={label} />
}

export function EmptyState({ icon: Icon, title, children }) {
  return (
    <div className="flex flex-col items-center gap-2 px-6 py-10 text-center">
      {Icon && <Icon size={28} className="text-muted" strokeWidth={1.4} aria-hidden="true" />}
      <div className="text-[13px] font-medium">{title}</div>
      {children && <div className="text-[12px] text-muted">{children}</div>}
    </div>
  )
}

export function Badge({ children, tone = 'neutral', className }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded px-1.5 py-px text-[10px] font-medium uppercase tracking-wide',
        tone === 'accent' ? 'bg-accent/15 text-accent' : 'bg-raised text-muted',
        className,
      )}
    >
      {children}
    </span>
  )
}

const TOAST_ICON = { info: Info, warn: AlertTriangle, error: AlertTriangle, success: CheckCircle2 }
const TOAST_TONE = { info: 'text-accent', warn: 'text-warn', error: 'text-danger', success: 'text-ok' }

export function Toaster() {
  const toasts = useNotifyStore((s) => s.toasts)
  const dismiss = useNotifyStore((s) => s.dismiss)
  return (
    <div className="pointer-events-none absolute bottom-10 left-1/2 z-50 flex w-[min(92vw,420px)] -translate-x-1/2 flex-col gap-2" aria-live="polite">
      {toasts.map((t) => {
        const Icon = TOAST_ICON[t.kind] ?? Info
        return (
          <div key={t.id} role={t.kind === 'error' ? 'alert' : 'status'} className="pointer-events-auto flex items-start gap-2 rounded-lg border border-line bg-panel p-3 shadow-float">
            <Icon size={16} className={cn('mt-0.5 shrink-0', TOAST_TONE[t.kind])} aria-hidden="true" />
            <div className="min-w-0 flex-1 text-[12px] leading-snug">{t.message}</div>
            <IconButton label="Dismiss" icon={X} size={14} className="-m-1 h-6 w-6" onClick={() => dismiss(t.id)} />
          </div>
        )
      })}
    </div>
  )
}

/** Panel section with a title row */
export function Section({ title, action, children, className }) {
  return (
    <section className={cn('border-b border-line px-3 py-3', className)}>
      {(title || action) && (
        <div className="mb-1.5 flex items-center justify-between">
          <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted">{title}</h3>
          {action}
        </div>
      )}
      {children}
    </section>
  )
}
