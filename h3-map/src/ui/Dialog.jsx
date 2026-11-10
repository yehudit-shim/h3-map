import { useEffect, useRef } from 'react'
import { X } from 'lucide-react'
import { cn } from '../lib/cn.js'
import { IconButton } from './Button.jsx'

/**
 * Modal shell shared by the database dialogs: backdrop click and Escape close it, focus moves into it and returns to
 * the opener, and it is labelled for screen readers. `side` makes a right-hand sheet (the table drawer).
 */
export default function Dialog({ title, titleId, onClose, children, side = false, width = 520, testId }) {
  const closeRef = useRef(null)
  useEffect(() => {
    const opener = document.activeElement
    closeRef.current?.focus()
    return () => opener instanceof HTMLElement && opener.isConnected && opener.focus()
  }, [])
  return (
    <div
      className={cn('fixed inset-0 z-50 flex bg-black/45', side ? 'justify-end' : 'items-center justify-center p-4')}
      onPointerDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        data-testid={testId}
        style={{ width: `min(${width}px, 100%)` }}
        className={cn('flex flex-col overflow-hidden border-line bg-panel shadow-float', side ? 'h-full border-l' : 'max-h-[90vh] rounded-xl border')}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.stopPropagation()
            onClose()
          }
        }}
      >
        <div className="flex items-center gap-2.5 border-b border-line px-4 py-3">
          <h2 id={titleId} className="min-w-0 flex-1 truncate text-[14px] font-semibold">{title}</h2>
          <IconButton ref={closeRef} label="Close" icon={X} size={15} className="h-7 w-7" onClick={onClose} />
        </div>
        {children}
      </div>
    </div>
  )
}
