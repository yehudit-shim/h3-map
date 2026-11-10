import { useEffect, useMemo } from 'react'
import { getLayerType } from '../layers/index.js'
import { getSource } from '../data/sources.js'
import { bboxKey } from '../lib/viewBbox.js'
import { useAuthStore } from '../state/authStore.js'
import { useDataStore } from '../state/dataStore.js'
import { useMapStore } from '../state/mapStore.js'

/** Wait this long after the camera stopped before asking the server again (a fling can emit several move ends). */
export const VIEW_DEBOUNCE_MS = 300

/** Identifies what a loaded result was requested for: a result for the same key is not requested again. */
export const viewKey = (v) => `${bboxKey(v.bbox)}|z${Math.floor(v.zoom ?? 0)}|r${v.resolution ?? ''}`

/**
 * Re-requests the data of viewport sources (PostGIS bbox and H3: `source.dynamic`) for the visible layers when the
 * map has stopped moving. The data store aborts the previous request and discards a response that arrives after a
 * newer one was started, so panning quickly never draws an old viewport over a new one.
 * @param {object[]} drawn effective layer configs (bottom first)
 * @param {{autoResolution:number}} ctx
 */
export function useViewportSources(drawn, ctx) {
  const settled = useMapStore((s) => s.settled)
  const signedIn = useAuthStore((s) => s.status === 'signed-in')
  const limits = useAuthStore((s) => s.config?.limits)

  // visible layers with a dynamic source: the topmost layer of a source decides its request parameters
  const wanted = useMemo(() => {
    const out = new Map()
    for (const config of drawn) {
      if (!config.visible || !config.sourceId) continue
      const source = getSource(config.sourceId)
      if (!source?.dynamic) continue
      const params = getLayerType(config.type)?.viewParams?.(config, ctx) ?? {}
      out.set(config.sourceId, { params, kind: source.dataKind ?? 'features' })
    }
    return out
  }, [drawn, ctx.autoResolution]) // eslint-disable-line react-hooks/exhaustive-deps

  // ids of wanted sources that have no entry yet (just added, or retried): a primitive, so the effect re-runs when it changes
  const missing = useDataStore((st) => [...wanted.keys()].filter((id) => !st.entries[id]).join(','))

  useEffect(() => {
    if (!settled || !wanted.size) return
    // A source without an entry is requested immediately; refreshes are debounced.
    const fresh = missing !== ''
    const timer = setTimeout(() => {
      const store = useDataStore.getState()
      for (const [id, { params, kind }] of wanted) {
        const entry = store.entries[id]
        if (entry?.status === 'error') continue // a failed first load waits for the user's Retry
        const request = {
          bbox: settled.bbox,
          zoom: settled.zoom,
          limit: kind === 'h3cells' ? limits?.maxH3Cells : limits?.maxFeatures,
          ...params,
        }
        const requestKey = viewKey(request)
        // already loaded or loading for this view
        if (entry && entry.requestKey === requestKey && !entry.viewError && !entry.needsAuth) continue
        store.loadView(id, { ...request, requestKey })
      }
    }, fresh ? 0 : VIEW_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [settled, wanted, signedIn, limits, missing])
}
