import { getSource } from '../data/sources.js'
import { formatNumber } from '../lib/format.js'

/**
 * Notices about what the map is NOT showing in full, for visible database layers:
 *   - truncated: the server cut the result at its limit (offers vector tiles, docs/UI_UX_DESIGN.md section 11)
 *   - a coarser H3 resolution than requested
 *   - a failed refresh (the previous view stays drawn)
 * Nothing is truncated silently.
 */
export function noticesFor(layers, entries) {
  const out = []
  for (const l of layers) {
    if (!l.visible || !l.sourceId) continue
    const source = getSource(l.sourceId)
    const e = entries[l.sourceId]
    if (source?.kind !== 'postgis' || e?.status !== 'ready') continue
    if (e.truncated) {
      const unit = e.unit ?? 'features'
      out.push({
        id: `${l.id}:truncated`, layerId: l.id, tone: 'warn', kind: 'truncated',
        text: `${l.name}: showing the first ${formatNumber(e.featureCount)} ${unit} of this view. More exist: zoom in${source.strategy === 'bbox' || source.strategy === 'json' ? ', or switch to vector tiles' : ''}.`,
        tiles: source.strategy === 'bbox' || source.strategy === 'json',
      })
    }
    if (e.notice) out.push({ id: `${l.id}:notice`, layerId: l.id, tone: 'info', kind: 'notice', text: `${l.name}: ${e.notice}` })
    if (e.viewError) out.push({ id: `${l.id}:view`, layerId: l.id, tone: 'warn', kind: 'view-error', text: `${l.name}: could not refresh this view (${e.viewError}). The previous data is still shown.`, sourceId: l.sourceId })
  }
  return out
}
