import { useEffect, useMemo, useRef, useState } from 'react'
import { getSource } from '../data/sources.js'
import { getLayerType } from '../layers/index.js'

let resultCounter = 0
const isAbort = (e) => e?.name === 'AbortError'

/**
 * Runs the asynchronous work of layer types that declare `compute: { key(config, ctx), run(config, data, ctx, {signal}) }`
 * (the H3 type aggregates its points in a worker). Re-runs when `key` changes, aborts superseded runs,
 * and keeps the previous result until the new one is ready, so zooming never blanks the layer.
 *
 * @returns {Record<string, {id:number, key:string, value?:any, error?:string, pending:boolean}>} by layer id
 */
export function useComputed(drawn, entries, ctx) {
  const [results, setResults] = useState({})
  const running = useRef(new Map()) // layerId -> {key, controller}

  const wanted = useMemo(() => {
    const out = []
    for (const config of drawn) {
      if (!config.visible) continue
      const type = getLayerType(config.type)
      const entry = type?.sourceless ? { status: 'ready', data: null } : entries[config.sourceId]
      if (!type?.compute || entry?.status !== 'ready') continue
      out.push({ config, type, data: entry.data, key: type.compute.key(config, ctx), ctx: { ...ctx, source: getSource(config.sourceId) } })
    }
    return out
    // ctx is rebuilt by the caller on every render; only its resolution input matters here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drawn, entries, ctx.autoResolution])

  useEffect(() => {
    const live = new Set()
    for (const w of wanted) {
      const id = w.config.id
      live.add(id)
      const current = running.current.get(id)
      // same key and same data: already running or done
      if (current && current.key === w.key && current.data === w.data) continue
      current?.controller.abort()
      const controller = new AbortController()
      running.current.set(id, { key: w.key, data: w.data, controller })
      w.type.compute.run(w.config, w.data, w.ctx, { signal: controller.signal }).then(
        (value) => {
          if (controller.signal.aborted) return
          setResults((prev) => ({ ...prev, [id]: { id: ++resultCounter, key: w.key, value } }))
        },
        (error) => {
          if (controller.signal.aborted || isAbort(error)) return
          console.error(`Layer ${id}: background computation failed`, error)
          setResults((prev) => ({ ...prev, [id]: { id: ++resultCounter, key: w.key, error: error.message, value: prev[id]?.value } }))
        },
      )
    }
    for (const [id, run] of running.current) {
      if (!live.has(id)) {
        run.controller.abort()
        running.current.delete(id)
      }
    }
  }, [wanted])

  useEffect(
    () => () => {
      for (const run of running.current.values()) run.controller.abort()
      running.current.clear()
    },
    [],
  )

  return useMemo(() => {
    const out = {}
    for (const w of wanted) {
      const r = results[w.config.id]
      out[w.config.id] = { ...r, id: r?.id ?? 0, pending: r?.key !== w.key }
    }
    return out
  }, [wanted, results])
}
