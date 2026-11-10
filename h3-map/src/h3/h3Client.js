// Small async API over the H3 worker:
//
//   const ds = await h3Service.dataset(geojsonPoints, ['value'])      // points are copied to the worker once
//   const { resolution, cells } = await h3Service.aggregate(ds, { resolution: 8, aggregation: 'avg', valueField: 'value' }, { slot, signal })
//   const ids = await h3Service.cells(lons, lats, 9)                  // bulk latLngToCell
//
// Aggregating again at another resolution reuses the points cached in the worker (no re-parsing, no
// re-sending). Where Workers do not exist (tests) the same job code runs in-process.
import { columnsToCells } from './aggregate.js'
import { createH3Jobs } from './h3Jobs.js'
import { extractPointColumns } from './pointColumns.js'

const abortError = () => new DOMException('Aborted', 'AbortError')
export const isAbort = (e) => e?.name === 'AbortError'

export function createH3Service({ spawn = defaultSpawn } = {}) {
  let transport = null
  let nextReq = 1
  let nextDataset = 1
  const pending = new Map() // reqId (or `ds:id`) -> {resolve, reject}
  const datasetByData = new WeakMap() // data object -> Promise<{id, count, fields}>
  const registry = typeof FinalizationRegistry === 'function' ? new FinalizationRegistry((id) => transport?.post({ type: 'release', id })) : null

  const onMessage = (msg) => {
    const key = msg.type === 'dataset-ready' ? `ds:${msg.id}` : msg.reqId
    const p = pending.get(key)
    if (!p) return
    pending.delete(key)
    if (msg.type === 'error') p.reject(new Error(msg.message))
    else if (msg.type === 'cancelled') p.reject(abortError())
    else p.resolve(msg)
  }
  const ensure = () => (transport ??= spawn(onMessage))
  const request = (key, message, transfer) =>
    new Promise((resolve, reject) => {
      pending.set(key, { resolve, reject })
      ensure().post(message, transfer)
    })

  return {
    /**
     * Copy the points (and the listed numeric fields) of a FeatureCollection into the worker. Cached per
     * data object, so every H3 layer and every resolution of the same data shares one copy.
     */
    dataset(data, fieldNames = []) {
      const hit = datasetByData.get(data)
      if (hit && fieldNames.every((f) => hit.fields.includes(f))) return hit.promise
      const cols = extractPointColumns(data, fieldNames)
      const id = nextDataset++
      const promise = request(`ds:${id}`, { type: 'dataset', id, lons: cols.lons, lats: cols.lats, fields: cols.fields }, [cols.lons.buffer, cols.lats.buffer, ...Object.values(cols.fields).map((a) => a.buffer)]).then(() => ({ id, count: cols.count }))
      datasetByData.set(data, { promise, fields: Object.keys(cols.fields) })
      registry?.register(data, id)
      return promise
    },

    /**
     * Aggregate a registered dataset. A newer call with the same `slot` supersedes an older running one
     * (the older promise rejects with an AbortError). `signal` aborts this call.
     * `maxCells` coarsens the grid until the result fits; `resolution` is the one actually used, `requested` what was asked for.
     * @returns {Promise<{resolution:number, requested:number, cells:{h3:string,count:number,value:number}[], ms:number, cached:boolean}>}
     */
    async aggregate(dataset, { resolution, aggregation = 'count', valueField, maxCells }, { slot = 'default', signal } = {}) {
      if (signal?.aborted) throw abortError()
      const reqId = nextReq++
      const done = request(reqId, { type: 'aggregate', reqId, slot, dataset: dataset.id, resolution, aggregation, valueField, maxCells })
      const onAbort = () => {
        const p = pending.get(reqId)
        if (p) {
          pending.delete(reqId)
          p.reject(abortError())
        }
      }
      signal?.addEventListener('abort', onAbort, { once: true })
      try {
        const r = await done
        return { resolution: r.resolution, requested: r.requested, cells: columnsToCells(r), ms: r.ms, cached: r.cached }
      } finally {
        signal?.removeEventListener('abort', onAbort)
      }
    },

    /** Convenience: register + aggregate in one call. */
    async aggregateFeatures(data, fieldNames, params, opts) {
      const ds = await this.dataset(data, fieldNames)
      return this.aggregate(ds, params, opts)
    },

    /** Bulk latLngToCell over many points. `null` entries mark invalid coordinates. */
    async cells(lons, lats, resolution) {
      const reqId = nextReq++
      const r = await request(reqId, { type: 'cells', reqId, lons, lats, resolution })
      return r.ids
    },

    release(dataset) {
      transport?.post({ type: 'release', id: dataset.id })
    },

    terminate() {
      transport?.stop()
      transport = null
      for (const p of pending.values()) p.reject(abortError())
      pending.clear()
    },
  }
}

function defaultSpawn(onMessage) {
  if (typeof Worker === 'undefined') {
    const jobs = createH3Jobs((msg) => queueMicrotask(() => onMessage(msg)))
    return { post: (m) => void jobs.handle(m), stop() {} }
  }
  const worker = new Worker(new URL('./h3.worker.js', import.meta.url), { type: 'module' })
  worker.onmessage = (e) => onMessage(e.data)
  worker.onerror = (e) => console.error('H3 worker error', e.message)
  return { post: (m, transfer) => worker.postMessage(m, transfer ?? []), stop: () => worker.terminate() }
}

/** Shared service used by the app. */
export const h3Service = createH3Service()
