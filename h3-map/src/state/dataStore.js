import { create } from 'zustand'
import { getSource } from '../data/sources.js'
import { boundsOf, isLonLatBounds } from '../lib/geo.js'

const safeBounds = (b) => (isLonLatBounds(b) ? b : null)

/**
 * Loaded data per source id: { status: 'loading'|'ready'|'error', data, bounds, featureCount, error, needsFile, report }.
 * Loading is idempotent and cached; retry() re-runs a failed load. `provide()` stores data that was
 * already parsed elsewhere (user files and URLs parsed in the worker), with its import report.
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
      put({ status: 'ready', data, bounds: safeBounds(boundsOf(data)), featureCount: data.features.length })
    } catch (e) {
      put({ status: 'error', error: e instanceof Error ? e.message : String(e), needsFile: e?.code === 'needs-file' })
    }
  },
  /** Store already parsed data for a source (replaces any previous entry). */
  provide: (sourceId, data, { bounds, report, warnings } = {}) =>
    set((s) => ({
      entries: {
        ...s.entries,
        [sourceId]: {
          status: 'ready',
          data,
          bounds: safeBounds(bounds ?? boundsOf(data)),
          featureCount: data.features.length,
          report,
          warnings,
        },
      },
    })),
  /** Drop cached data (the sources were removed). */
  forget: (ids) =>
    set((s) => {
      if (!ids.some((id) => id in s.entries)) return s
      const entries = { ...s.entries }
      for (const id of ids) delete entries[id]
      return { entries }
    }),
}))
