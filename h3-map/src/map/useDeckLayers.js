import { useCallback, useEffect, useMemo, useRef } from 'react'
import { buildDeckLayers, getLayerType } from '../layers/index.js'
import { effectiveLayers } from '../layers/tree.js'
import { zoomToH3Resolution } from '../h3/h3Utils.js'
import { escapeHtml } from '../lib/format.js'
import { useDataStore } from '../state/dataStore.js'
import { useLayersStore } from '../state/layersStore.js'
import { useMapStore } from '../state/mapStore.js'
import { notify } from '../state/notifyStore.js'
import { useRuntimeStore } from '../state/runtimeStore.js'
import { useSelectionStore } from '../state/selectionStore.js'
import { useUiStore } from '../state/uiStore.js'

/**
 * Bridges application state to deck.gl: loads the data every layer needs, builds deck layers from
 * layer configs, and provides picking handlers. This is the only place the stores and the layer
 * system meet; map components just receive `{layers, getTooltip, onClick}`.
 */
export function useDeckLayers() {
  const tree = useLayersStore((s) => s.tree)
  const configs = useLayersStore((s) => s.layers)
  // Bottom first, with group visibility and opacity folded into every layer.
  const drawn = useMemo(() => effectiveLayers(tree), [tree])
  const entries = useDataStore((s) => s.entries)
  const selected = useSelectionStore((s) => s.selected)
  // Primitive selector: only re-renders when the auto H3 resolution actually changes (not every zoom frame).
  const autoResolution = useMapStore((s) => zoomToH3Resolution(s.viewState.zoom))

  // Ensure data for every layer is requested (idempotent).
  useEffect(() => {
    const ensure = useDataStore.getState().ensure
    for (const l of configs) ensure(l.sourceId)
  }, [configs])

  const result = useMemo(
    () => buildDeckLayers(drawn, entries, { autoResolution, selection: selected }),
    [drawn, entries, autoResolution, selected],
  )
  // Event handlers read the latest prepared data through a ref that is updated in an effect.
  const preparedRef = useRef(result.prepared)
  useEffect(() => {
    preparedRef.current = result.prepared
  }, [result.prepared])

  // Surface layer failures once per layer instead of failing silently or crashing the map.
  const reported = useRef(new Set())
  useEffect(() => {
    for (const { layerId, error } of result.errors) {
      const sig = `${layerId}:${error.message}`
      if (reported.current.has(sig)) continue
      reported.current.add(sig)
      console.error(`Layer ${layerId} failed to render`, error)
      notify(`A layer failed to render: ${error.message}`, { kind: 'error', key: sig })
    }
  }, [result.errors])

  // Publish per-layer runtime facts (effective H3 resolution, cell count) for the panels.
  useEffect(() => {
    const info = {}
    for (const l of configs) {
      const p = result.prepared[l.id]
      const t = getLayerType(l.type)
      if (p && t?.info) info[l.id] = t.info(p)
    }
    useRuntimeStore.getState().setInfo(info)
    useRuntimeStore.getState().setPrepared(result.prepared)
  }, [configs, result.prepared])

  // A selected H3 cell stops being valid when the layer's resolution changes: clear it.
  useEffect(() => {
    if (selected?.h3) {
      const p = result.prepared[selected.layerId]
      if (p?.resolution !== undefined && p.resolution !== selected.resolution) useSelectionStore.getState().clear()
    }
  }, [selected, result.prepared])

  const getTooltip = useCallback(({ object, layer }) => {
    if (!object || !layer) return null
    const config = useLayersStore.getState().layers.find((l) => l.id === layer.id)
    const type = config && getLayerType(config.type)
    if (!type?.describe) return null
    try {
      const d = type.describe(object, config, preparedRef.current[config.id])
      const rows = (d.sections[0]?.rows ?? []).slice(0, 4)
      const body = rows.map(([k, v]) => `<div style="display:flex;gap:10px;justify-content:space-between"><span style="color:var(--muted)">${escapeHtml(k)}</span><span style="font-family:var(--font-mono)">${escapeHtml(v)}</span></div>`).join('')
      return { html: `<div style="font-weight:600;margin-bottom:3px">${escapeHtml(d.title)}</div>${body}`, className: 'deck-tooltip', style: {} }
    } catch {
      return null
    }
  }, [])

  const onClick = useCallback((info) => {
    const { select, clear } = useSelectionStore.getState()
    const config = info.layer && useLayersStore.getState().layers.find((l) => l.id === info.layer.id)
    if (!info.object || !config) {
      clear()
      return
    }
    const type = getLayerType(config.type)
    try {
      const detail = type.describe(info.object, config, preparedRef.current[config.id])
      select({ layerId: config.id, detail, h3: detail.h3, resolution: detail.resolution, coordinate: info.coordinate })
      useLayersStore.getState().setActive(config.id)
      useUiStore.getState().setRightOpen(true)
      useUiStore.getState().setRightTab('inspector')
    } catch (error) {
      notify(`Could not inspect feature: ${error.message}`, { kind: 'error' })
    }
  }, [])

  return { layers: result.layers, getTooltip, onClick }
}
