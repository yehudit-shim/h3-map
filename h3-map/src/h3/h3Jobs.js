// H3 worker logic (platform independent: used by h3.worker.js and, for tests / no-Worker environments,
// by the in-process fallback in h3Client.js).
//
// Messages in:
//   {type:'dataset', id, lons, lats, fields}                     cache a point set (typed arrays)
//   {type:'release', id}                                         drop a cached point set
//   {type:'aggregate', reqId, slot, dataset, resolution, aggregation, valueField, maxCells?}
//     maxCells: if the result would have more cells, the grid is coarsened (res-1, res-2, ...) until it fits,
//     and the result reports the resolution actually used (docs/H3_IMPLEMENTATION.md section 5)
//   {type:'cells', reqId, lons, lats, resolution}                bulk latLngToCell
// Messages out (second argument of emit = transfer list):
//   {type:'dataset-ready', id, count}
//   {type:'result', reqId, resolution, requested, ids, count, value, ms, cached}
//   {type:'cells-result', reqId, ids}
//   {type:'cancelled', reqId} | {type:'error', reqId, message}
//
// Aggregating is done in slices with a yield between them, so a newer request for the same `slot`
// (e.g. the user dragged the resolution slider) is noticed and the stale computation stops early.
// Per (dataset, resolution, field) the cell statistics are cached, so changing only the aggregation
// (count/sum/avg/...) or going back to a previous resolution does not touch the points again.
import { latLngToCell } from 'h3-js'
import { CellStats } from './aggregate.js'
import { assertResolution } from './h3Utils.js'

const SLICE = 40000
const CACHE_ENTRIES = 6

const yieldToEventLoop = () => new Promise((resolve) => setTimeout(resolve, 0))

export function createH3Jobs(emit, { slice = SLICE } = {}) {
  const datasets = new Map() // id -> {lons, lats, fields}
  const stats = new Map() // `${id}|${res}|${field}` -> CellStats (insertion order = LRU order)
  const latest = new Map() // slot -> reqId of the newest aggregate request

  const cacheKey = (id, res, field) => `${id}|${res}|${field ?? ''}`
  const remember = (key, value) => {
    stats.delete(key)
    stats.set(key, value)
    while (stats.size > CACHE_ENTRIES) stats.delete(stats.keys().next().value)
  }

  /**
   * Statistics at one resolution (cached). Resolves to null when a newer request for the slot superseded this one.
   * With `maxCells` it gives up as soon as the running cell count exceeds the cap (the count can only grow), returning
   * `{overflow: true, projected}` with an estimate of the final cell count instead of finishing a pass that is not needed.
   */
  async function statsAt(ds, id, resolution, valueField, slot, reqId, maxCells = Infinity) {
    const key = cacheKey(id, resolution, valueField)
    const hit = stats.get(key)
    if (hit) {
      remember(key, hit)
      return hit.size > maxCells ? { overflow: true, projected: hit.size } : { st: hit, cached: true }
    }
    const st = new CellStats(resolution)
    const values = valueField ? ds.fields[valueField] : null
    const n = ds.lons.length
    for (let start = 0; start < n; start += slice) {
      const end = Math.min(n, start + slice)
      for (let i = start; i < end; i++) st.add(ds.lons[i], ds.lats[i], values ? values[i] : undefined)
      await yieldToEventLoop()
      if (latest.get(slot) !== reqId) return null
      if (st.size > maxCells) return { overflow: true, projected: Math.ceil((st.size * n) / end) }
    }
    remember(key, st)
    return { st, cached: false }
  }

  async function aggregate(msg) {
    const { reqId, slot = 'default', dataset: id, aggregation = 'count', valueField, maxCells = Infinity } = msg
    latest.set(slot, reqId)
    const ds = datasets.get(id)
    if (!ds) throw new Error('The point data is no longer available. Reload the layer.')
    const requested = assertResolution(msg.resolution)
    if (valueField && !ds.fields[valueField]) throw new Error(`Field "${valueField}" is not a numeric field of this data`)
    const t0 = Date.now()
    let resolution = requested
    let out
    let allCached = true
    for (;;) {
      out = await statsAt(ds, id, resolution, valueField, slot, reqId, resolution === 0 ? Infinity : maxCells)
      if (!out) break
      if (!out.overflow) {
        allCached &&= out.cached
        break
      }
      allCached = false
      // each resolution step has at most 7x fewer cells: jump straight to a likely fit
      resolution = Math.max(0, resolution - Math.max(1, Math.ceil(Math.log(out.projected / maxCells) / Math.log(7))))
    }
    if (!out || latest.get(slot) !== reqId) {
      emit({ type: 'cancelled', reqId })
      return
    }
    const cols = out.st.columns(aggregation)
    emit({ type: 'result', reqId, resolution, requested, ids: cols.ids, count: cols.count, value: cols.value, ms: Date.now() - t0, cached: allCached }, [cols.count.buffer, cols.value.buffer])
  }

  return {
    async handle(msg) {
      try {
        switch (msg.type) {
          case 'dataset':
            datasets.set(msg.id, { lons: msg.lons, lats: msg.lats, fields: msg.fields })
            emit({ type: 'dataset-ready', id: msg.id, count: msg.lons.length })
            break
          case 'release':
            datasets.delete(msg.id)
            for (const k of [...stats.keys()]) if (k.startsWith(`${msg.id}|`)) stats.delete(k)
            break
          case 'aggregate':
            await aggregate(msg)
            break
          case 'cells': {
            const res = assertResolution(msg.resolution)
            const ids = new Array(msg.lons.length)
            for (let i = 0; i < ids.length; i++) {
              const lat = msg.lats[i]
              const lon = msg.lons[i]
              ids[i] = Number.isFinite(lon) && Number.isFinite(lat) && lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180 ? latLngToCell(lat, lon, res) : null
            }
            emit({ type: 'cells-result', reqId: msg.reqId, ids })
            break
          }
          default:
            throw new Error(`Unknown message "${msg.type}"`)
        }
      } catch (e) {
        emit({ type: 'error', reqId: msg.reqId, message: e instanceof Error ? e.message : String(e) })
      }
    },
  }
}
