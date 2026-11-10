import { useCallback, useEffect, useRef, useState } from 'react'
import { AttributionControl, Map } from 'react-map-gl/maplibre'
import 'maplibre-gl/dist/maplibre-gl.css'
import './maplibreSetup.js'
import { notify } from '../state/notifyStore.js'
import { useMapStore } from '../state/mapStore.js'
import { useUiStore } from '../state/uiStore.js'
import { getBasemap } from './basemaps.js'
import DeckOverlay from './DeckOverlay.jsx'
import { useDeckLayers } from './useDeckLayers.js'

/**
 * Full-screen MapLibre map with the deck.gl overlay. Contains no application UI: panels, controls
 * and the status bar are siblings that talk to the map through stores and `useMap()`.
 */
export default function MapView() {
  const viewState = useMapStore((s) => s.viewState)
  const setViewState = useMapStore((s) => s.setViewState)
  const setCursor = useMapStore((s) => s.setCursor)
  const setMapStatus = useMapStore((s) => s.setMapStatus)
  const basemapId = useUiStore((s) => s.basemapId)
  const { layers, getTooltip, onClick } = useDeckLayers()

  // If the basemap style cannot be fetched (offline, blocked), fall back to Blank for this session
  // without overwriting the user's saved preference.
  const [fallback, setFallback] = useState(null) // basemap id that failed
  const basemap = getBasemap(fallback === basemapId ? 'blank' : basemapId)

  const raf = useRef(0)
  const onMouseMove = useCallback(
    (e) => {
      const { lng, lat } = e.lngLat
      cancelAnimationFrame(raf.current)
      raf.current = requestAnimationFrame(() => setCursor({ lon: lng, lat }))
    },
    [setCursor],
  )
  useEffect(() => () => cancelAnimationFrame(raf.current), [])

  const onError = useCallback(
    (e) => {
      const map = e.target
      const message = e.error?.message ?? 'Unknown map error'
      if (!e.sourceId && !map.isStyleLoaded() && basemapId !== 'blank') {
        setFallback(basemapId)
        notify(`Basemap "${getBasemap(basemapId).label}" could not be loaded (${message}). Showing a blank background instead.`, { kind: 'error', key: 'basemap-style' })
      } else if (e.sourceId) {
        notify('Some basemap tiles failed to load. Check your network connection.', { kind: 'warn', key: 'basemap-tiles' })
      } else {
        console.warn('Map error:', e.error ?? e)
      }
    },
    [basemapId],
  )

  return (
    <Map
      id="main"
      {...viewState}
      onMove={(e) => setViewState(e.viewState)}
      onMouseMove={onMouseMove}
      onMouseOut={() => setCursor(null)}
      onLoad={() => setMapStatus('ready')}
      onError={onError}
      mapStyle={basemap.style}
      minZoom={1}
      maxPitch={70}
      attributionControl={false}
      style={{ position: 'absolute', inset: 0 }}
    >
      <AttributionControl compact position="bottom-right" />
      <DeckOverlay layers={layers} getTooltip={getTooltip} onClick={onClick} />
    </Map>
  )
}
