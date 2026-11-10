import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { cn } from '../lib/cn.js'

/**
 * Floating action menu (context menu / kebab menu) at a viewport position.
 * items: { id, label, icon?, onSelect, disabled?, danger?, shortcut? } | { separator: true }
 * Closes on outside click, Escape, blur of the window or selection. Arrow keys move the focus.
 */
export function Menu({ x, y, items, onClose, label = 'Actions' }) {
  const ref = useRef(null)
  const [pos, setPos] = useState({ left: x, top: y })

  // Keep the menu inside the viewport.
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const r = el.getBoundingClientRect()
    const left = Math.max(4, Math.min(x, window.innerWidth - r.width - 4))
    const top = Math.max(4, Math.min(y, window.innerHeight - r.height - 4))
    setPos((p) => (p.left === left && p.top === top ? p : { left, top }))
  }, [x, y])

  useEffect(() => {
    ref.current?.querySelector('[role=menuitem]:not([disabled])')?.focus()
    const onDown = (e) => !ref.current?.contains(e.target) && onClose()
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
    }
    document.addEventListener('pointerdown', onDown, true)
    document.addEventListener('keydown', onKey, true)
    window.addEventListener('blur', onClose)
    window.addEventListener('resize', onClose)
    return () => {
      document.removeEventListener('pointerdown', onDown, true)
      document.removeEventListener('keydown', onKey, true)
      window.removeEventListener('blur', onClose)
      window.removeEventListener('resize', onClose)
    }
  }, [onClose])

  const onKeyDown = (e) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'Home' && e.key !== 'End') return
    e.preventDefault()
    const els = [...ref.current.querySelectorAll('[role=menuitem]:not([disabled])')]
    const i = els.indexOf(document.activeElement)
    const next = e.key === 'Home' ? 0 : e.key === 'End' ? els.length - 1 : (i + (e.key === 'ArrowDown' ? 1 : -1) + els.length) % els.length
    els[next]?.focus()
  }

  return (
    <div
      ref={ref}
      role="menu"
      aria-label={label}
      onKeyDown={onKeyDown}
      onContextMenu={(e) => e.preventDefault()}
      style={{ left: pos.left, top: pos.top }}
      className="fixed z-50 min-w-[200px] rounded-lg border border-line bg-panel p-1 shadow-float"
    >
      {items.map((it, i) =>
        it.separator ? (
          <div key={`sep-${i}`} role="separator" className="my-1 h-px bg-line" />
        ) : (
          <button
            key={it.id}
            type="button"
            role="menuitem"
            disabled={it.disabled}
            onClick={() => {
              onClose()
              it.onSelect()
            }}
            className={cn(
              'flex h-8 w-full cursor-pointer items-center gap-2.5 rounded-md px-2 text-left text-[13px] outline-none hover:bg-hover focus-visible:bg-hover disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent',
              it.danger && 'text-danger',
            )}
          >
            {it.icon && <it.icon size={14} strokeWidth={1.9} aria-hidden="true" className={cn('shrink-0', !it.danger && 'text-muted')} />}
            <span className="flex-1">{it.label}</span>
            {it.shortcut && <kbd className="font-mono text-[10px] text-muted">{it.shortcut}</kbd>}
          </button>
        ),
      )}
    </div>
  )
}
