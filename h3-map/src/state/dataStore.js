import { create } from 'zustand'
import { getSource } from '../data/sources.js'
import { boundsOf } from '../lib/geo.js'

/**
 * Loaded data per source id: { status: 'loading'|'ready'|'error', data, bounds, featureCount, error }.
 * Loading is idempotent and cached; retry() re-runs a failed load.
 */
export const useDataStore = create((set, get) => ({
  entries: {},
  ensure: (sourceId) => {
    if (get().entries[sourceId]) return // loading, ready, or failed (use retry)
    get().load(sourceId)
  },
  retry: (sourceId) => get().load(sourceId),
  load: async (sourceId) => {
    const source = getSource(sourceId)
    const put = (entry) => set((s) => ({ entries: { ...s.entries, [sourceId]: entry } }))
    if (!source) return put({ status: 'error', error: `Unknown data source "${sourceId}"` })
    put({ status: 'loading' })
    try {
      const data = await source.load()
      put({ status: 'ready', data, bounds: boundsOf(data), featureCount: data.features.length })
    } catch (e) {
      put({ status: 'error', error: e instanceof Error ? e.message : String(e) })
    }
  },
}))
