import { create } from 'zustand'
import { ApiError, describeError, isAbort } from '../api/index.js'
import { getSource } from '../data/sources.js'
import { boundsOf, isLonLatBounds } from '../lib/geo.js'

const safeBounds = (b) => (isLonLatBounds(b) ? b : null)

// Viewport requests in flight, per source. A new request aborts the previous one, and a response whose sequence
// number is no longer the latest is discarded even if the abort came too late to stop it.
const inflight = new Map() // sourceId -> {seq, controller}
let seq = 0

function summarize(source, data) {
  if (source.summarize) return source.summarize(data)
  return { count: data?.features?.length ?? null, unit: 'features', truncated: false }
}

/** Fields of the entry that describe a failure, so the layer row can offer the right action. */
function failure(e) {
  const needsAuth = e?.code === 'needs-auth' || (e instanceof ApiError && e.unauthenticated)
  // The saved reference points at a connection or table this server does not (or no longer) grant: reconnect.
  const needsReconnect = e instanceof ApiError && (e.notFound || e.forbidden)
  return {
    status: 'error',
    error: needsReconnect ? `This layer's database connection or table is not available (${describeError(e)}). Reconnect it from the Database tab, or remove the layer.` : describeError(e),
    needsFile: e?.code === 'needs-file',
    needsAuth,
    needsReconnect,
    retryable: !(e instanceof ApiError) || e.retryable,
  }
}

/**
 * Loaded data per source id:
 *   { status: 'loading'|'ready'|'error', data, bounds, featureCount, unit, truncated, notice, error, needsFile,
 *     needsAuth, needsReconnect, refreshing, viewError, report }
 * Loading is idempotent and cached; retry() re-runs a failed load. `provide()` stores data that was already parsed
 * elsewhere (user files and URLs parsed in the worker). Sources with `dynamic: true` (PostGIS bbox and H3) are
 * loaded per viewport through `loadView()`; the previous result stays drawn while the next one is requested.
 */
export const useDataStore = create((set, get) => {
  const put = (sourceId, entry) => set((s) => ({ entries: { ...s.entries, [sourceId]: entry } }))
  const patch = (sourceId, fields) => set((s) => (s.entries[sourceId] ? { entries: { ...s.entries, [sourceId]: { ...s.entries[sourceId], ...fields } } } : s))

  /** Run source.load(args) with abort + stale-response protection. */
  async function run(sourceId, args) {
    const source = getSource(sourceId)
    if (!source) return put(sourceId, { status: 'error', error: `Unknown data source "${sourceId}"` })
    inflight.get(sourceId)?.controller.abort()
    const controller = new AbortController()
    const mine = ++seq
    inflight.set(sourceId, { seq: mine, controller })
    const previous = get().entries[sourceId]
    const keep = previous?.status === 'ready'
    if (keep) patch(sourceId, { refreshing: true, requestKey: args?.requestKey, viewError: null })
    else put(sourceId, { status: 'loading', requestKey: args?.requestKey })
    try {
      const data = await source.load({ ...args, signal: controller.signal })
      if (inflight.get(sourceId)?.seq !== mine) return // superseded while the response was on its way
      const sum = summarize(source, data)
      put(sourceId, {
        status: 'ready',
        data,
        // Database sources know their extent from the profile; derive it from the data only for plain GeoJSON.
        bounds: source.bounds ? safeBounds(source.bounds) : (source.dataKind ?? 'features') === 'features' ? safeBounds(boundsOf(data)) : null,
        featureCount: sum.count,
        unit: sum.unit,
        truncated: !!sum.truncated,
        notice: sum.notice ?? null,
        requestKey: args?.requestKey,
      })
    } catch (e) {
      if (isAbort(e) || inflight.get(sourceId)?.seq !== mine) return
      // A failed refresh keeps what is drawn; only a first load turns the layer into an error.
      if (keep) patch(sourceId, { refreshing: false, viewError: describeError(e), needsAuth: failure(e).needsAuth })
      else put(sourceId, failure(e))
    } finally {
      if (inflight.get(sourceId)?.seq === mine) inflight.delete(sourceId)
    }
  }

  return {
    entries: {},
    ensure: (sourceId) => {
      if (get().entries[sourceId]) return // loading, ready, or failed (use retry)
      // Viewport sources are requested by map/useViewportSources.js once the map has a viewport.
      if (getSource(sourceId)?.dynamic) return
      get().load(sourceId)
    },
    retry: (sourceId) => {
      if (getSource(sourceId)?.dynamic) {
        // forget the failure; the viewport hook requests it again for the current view
        set((s) => {
          const entries = { ...s.entries }
          delete entries[sourceId]
          return { entries }
        })
        return
      }
      return get().load(sourceId)
    },
    /** Retry every layer that was waiting for a sign-in (called after login). */
    retryWaitingForAuth: () => {
      for (const [id, e] of Object.entries(get().entries)) if (e.needsAuth) get().retry(id)
    },
    /** Sign-out / expired token: database layers keep their place in the tree but lose their data and wait for a new sign-in. */
    markSignedOut: () => {
      for (const id of Object.keys(get().entries)) {
        if (getSource(id)?.kind !== 'postgis') continue
        inflight.get(id)?.controller.abort()
        inflight.delete(id)
        put(id, { status: 'error', error: 'Sign in to load this database layer.', needsAuth: true, retryable: true })
      }
    },
    load: (sourceId, args) => run(sourceId, args),
    /** Request a viewport: `view = {bbox, zoom, resolution, limit}`. */
    loadView: (sourceId, view) => run(sourceId, view),
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
            unit: 'features',
            report,
            warnings,
          },
        },
      })),
    /** Drop cached data (the sources were removed) and cancel their requests. */
    forget: (ids) => {
      for (const id of ids) {
        inflight.get(id)?.controller.abort()
        inflight.delete(id)
      }
      set((s) => {
        if (!ids.some((id) => id in s.entries)) return s
        const entries = { ...s.entries }
        for (const id of ids) delete entries[id]
        return { entries }
      })
    },
  }
})

/** Test helper: forget in-flight requests. */
export function _resetInflight() {
  for (const r of inflight.values()) r.controller.abort()
  inflight.clear()
}
