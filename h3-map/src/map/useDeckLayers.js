import { useCallback, useEffect, useMemo, useRef } from 'react'
import { buildDeckLayers, getLayerType } from '../layers/index.js'
import { buildH3OverlayLayers } from '../layers/h3Overlays.js'
import { propertyRows } from '../layers/common.js'
import { effectiveLayers } from '../layers/tree.js'
import { describeError, isAbort } from '../api/index.js'
import { getSource } from '../data/sources.js'
import { zoomToH3Resolution } from '../h3/h3Utils.js'
import { escapeHtml } from '../lib/format.js'
import { useDataStore } from '../state/dataStore.js'
import { useLayersStore } from '../state/layersStore.js'
import { useMapStore } from '../state/mapStore.js'
import { notify } from '../state/notifyStore.js'
import { useRuntimeStore } from '../state/runtimeStore.js'
import { useSelectionStore } from '../state/selectionStore.js'
import { useUiStore } from '../state/uiStore.js'
import { useComputed } from './useComputed.js'
import { useViewportSources } from './useViewportSources.js'

/** Tile / image load failures from raster layers: one toast per layer (de-duplicated by key). */
function reportLayerError(layerId, message) {
  notify(message, { kind: 'warn', key: `layer-error:${layerId}` })
}

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
  const overlays = useSelectionStore((s) => s.overlays)
  // Primitive selector: only re-renders when the auto H3 resolution actually changes (not every zoom frame).
  // Latitude matters: Web Mercator makes cells larger on screen towards the poles.
  const autoResolution = useMapStore((s) => zoomToH3Resolution(s.viewState.zoom, s.viewState.latitude))
  // Background work of layer types (H3 aggregation in a worker): layerId -> {id, value, pending, error}
  const computed = useComputed(drawn, entries, { autoResolution })
  // Database layers that follow the viewport (bbox features, H3 cells) request their data when the map stops moving.
  useViewportSources(drawn, { autoResolution })

  // Ensure data for every layer is requested (idempotent).
  useEffect(() => {
    const ensure = useDataStore.getState().ensure
    for (const l of configs) if (l.sourceId) ensure(l.sourceId) // web-map layers (XYZ, WMS) have no source
  }, [configs])

  const result = useMemo(
    () => buildDeckLayers(drawn, entries, { autoResolution, selection: selected, computed, reportError: reportLayerError }),
    [drawn, entries, autoResolution, selected, computed],
  )
  // Parent / children / k-ring outlines belong to the selection, not to the layer tree: drawn on top.
  const overlayLayers = useMemo(() => buildH3OverlayLayers(selected, overlays), [selected, overlays])
  const deckLayers = useMemo(() => [...result.layers, ...overlayLayers], [result.layers, overlayLayers])
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
      if (p && t?.info) info[l.id] = { ...t.info(p), loading: !!computed[l.id]?.pending }
    }
    useRuntimeStore.getState().setInfo(info)
    useRuntimeStore.getState().setPrepared(result.prepared)
  }, [configs, result.prepared, computed])

  // A failed background computation (e.g. the H3 worker) is reported once per layer.
  useEffect(() => {
    for (const [layerId, c] of Object.entries(computed)) {
      if (c.error) notify(`A layer could not be computed: ${c.error}`, { kind: 'error', key: `computed:${layerId}:${c.error}` })
    }
  }, [computed])

  // A selected H3 cell stops being valid when the layer's resolution changes: clear it.
  useEffect(() => {
    if (selected?.h3) {
      const p = result.prepared[selected.layerId]
      if (p?.resolution !== undefined && p.resolution !== selected.resolution) {
        // Cells of another resolution are different cells: keep nothing, and say so.
        const n = selected.cells?.length ?? 1
        useSelectionStore.getState().clear()
        notify(`${n === 1 ? 'The selected cell' : `${n} selected cells`} cleared: ${n === 1 ? 'it is' : 'they are'} not valid at H3 resolution ${p.resolution}.`, { kind: 'info', key: 'h3-selection-cleared' })
      }
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

  // deck.gl's click event does not expose the modifier keys, so remember them from the native pointerdown
  // that started the click (capture phase, before deck's own handlers).
  const shiftRef = useRef(false)
  useEffect(() => {
    const remember = (e) => {
      shiftRef.current = e.shiftKey
    }
    window.addEventListener('pointerdown', remember, true)
    return () => window.removeEventListener('pointerdown', remember, true)
  }, [])

  // Tiles only carry the columns chosen for the tile session: a click fetches the full feature by id.
  const featureRequest = useRef(null)
  const loadFullFeature = useCallback((config, source, id) => {
    featureRequest.current?.abort()
    const controller = new AbortController()
    featureRequest.current = controller
    const still = () => {
      const cur = useSelectionStore.getState().selected
      return !controller.signal.aborted && cur?.layerId === config.id && cur.detail?.featureId === id
    }
    source.fetchFeature(id, { signal: controller.signal }).then(
      (feature) => still() && useSelectionStore.getState().patchDetail({ loading: false, error: null, sections: [{ title: 'Attributes', rows: propertyRows(feature?.properties ?? {}, 200) }] }),
      (error) => !isAbort(error) && still() && useSelectionStore.getState().patchDetail({ loading: false, error: describeError(error) }),
    )
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
      let detail = type.describe(info.object, config, preparedRef.current[config.id])
      const source = getSource(config.sourceId)
      const fetchFull = detail.kind === 'tile-feature' && detail.featureId != null && !!source?.fetchFeature
      if (fetchFull) detail = { ...detail, loading: true }
      const sel = { layerId: config.id, detail, h3: detail.h3, resolution: detail.resolution, coordinate: info.coordinate, value: info.object.value, count: info.object.count }
      // Shift-click adds / removes H3 cells; a plain click replaces the selection.
      if (shiftRef.current && detail.h3) useSelectionStore.getState().toggleCell(sel)
      else select(sel)
      useLayersStore.getState().setActive(config.id)
      useUiStore.getState().setRightOpen(true)
      useUiStore.getState().setRightTab('inspector')
      if (fetchFull) loadFullFeature(config, source, detail.featureId)
    } catch (error) {
      notify(`Could not inspect feature: ${error.message}`, { kind: 'error' })
    }
  }, [loadFullFeature])

  return { layers: deckLayers, getTooltip, onClick }
}
