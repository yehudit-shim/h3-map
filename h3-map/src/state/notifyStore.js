import { create } from 'zustand'
import { createId } from '../lib/ids.js'

/** Transient toast messages. Errors are surfaced here instead of being swallowed. */
export const useNotifyStore = create((set, get) => ({
  toasts: [],
  notify: (message, { kind = 'info', timeout = 6000, key } = {}) => {
    // de-duplicate repeated messages (e.g. a failing tile request)
    const existing = key ? get().toasts.find((t) => t.key === key) : undefined
    if (existing) return existing.id
    const id = createId('toast')
    set((s) => ({ toasts: [...s.toasts, { id, key, message, kind }] }))
    if (timeout) setTimeout(() => get().dismiss(id), timeout)
    return id
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}))

export const notify = (...args) => useNotifyStore.getState().notify(...args)
