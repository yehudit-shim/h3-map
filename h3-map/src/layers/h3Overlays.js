// Parent / children / k-ring overlays of the selected H3 cells. They are owned by the selection (see
// state/selectionStore.js), drawn on top of every layer and never appear in the layer tree.
import { H3HexagonLayer } from '@deck.gl/geo-layers'
import { getResolution } from 'h3-js'
import { H3LimitError, MAX_CHILD_DELTA, MAX_K, childCells, gridDiskCells, parentCell } from '../h3/h3Utils.js'

/** Total cells an overlay may contain over the whole selection. */
export const MAX_OVERLAY_CELLS = 20000

const COLORS = {
  parent: [255, 176, 32, 255],
  children: [34, 211, 238, 255],
  kring: [236, 72, 153, 255],
}

/**
 * The cells of each enabled overlay for a selection, computed with the validated h3Utils wrappers.
 * An overlay that is refused (too many cells, resolution out of range) is reported in `problems` instead of drawn.
 * @param {string[]} cells selected cell ids (all of one resolution)
 * @param {{parent:boolean, children:boolean, kring:boolean, childDelta:number, k:number}} overlays
 * @returns {{parent: string[], children: string[], kring: string[], problems: {parent?:string, children?:string, kring?:string}}}
 */
export function overlayCells(cells, overlays) {
  const out = { parent: [], children: [], kring: [], problems: {} }
  const guard = (name, fn) => {
    try {
      const set = new Set()
      for (const c of cells) {
        for (const id of fn(c)) set.add(id)
        if (set.size > MAX_OVERLAY_CELLS) throw new H3LimitError(`Too many cells (limit ${MAX_OVERLAY_CELLS.toLocaleString('en-US')}). Select fewer cells.`)
      }
      out[name] = [...set]
    } catch (e) {
      out.problems[name] = e.message
    }
  }
  if (!cells.length) return out
  if (overlays.parent) guard('parent', (c) => [parentCell(c)])
  if (overlays.children) {
    // childCells refuses a difference above MAX_CHILD_DELTA and any fan-out above its cell cap
    guard('children', (c) => childCells(c, getResolution(c) + Math.round(overlays.childDelta)))
  }
  if (overlays.kring) guard('kring', (c) => gridDiskCells(c, Math.round(overlays.k)))
  return out
}

/** deck.gl layers for the overlays of a selection (empty when there is none). */
export function buildH3OverlayLayers(selected, overlays) {
  if (!selected?.cells?.length || !(overlays.parent || overlays.children || overlays.kring)) return []
  const found = overlayCells(selected.cells.map((c) => c.h3), overlays)
  const layer = (name, filled, width) =>
    found[name].length
      ? new H3HexagonLayer({
          id: `h3-overlay::${name}`,
          data: found[name],
          getHexagon: (d) => d,
          filled,
          stroked: true,
          extruded: false,
          getFillColor: [...COLORS[name].slice(0, 3), 40],
          getLineColor: COLORS[name],
          lineWidthMinPixels: width,
          highPrecision: 'auto',
          pickable: false,
        })
      : null
  // parent and k-ring below, children on top; each is a separate layer so they can be told apart by colour
  return [layer('kring', true, 2), layer('parent', false, 3), layer('children', false, 2)].filter(Boolean)
}

export { COLORS as OVERLAY_COLORS, MAX_CHILD_DELTA, MAX_K }
