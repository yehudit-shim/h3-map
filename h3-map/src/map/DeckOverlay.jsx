import { MapLibreOverlay } from '@deck.gl/maplibre'
import { useControl } from 'react-map-gl/maplibre'

/**
 * deck.gl rendered on top of the MapLibre map and camera-synced with it.
 * Uses @deck.gl/maplibre's MapLibreOverlay (not Mapbox). `interleaved: false` keeps deck.gl in its own
 * canvas above the basemap (decision AD-10); switch it on later if layers must sit under basemap labels.
 */
export default function DeckOverlay({ layers, getTooltip, onClick }) {
  const overlay = useControl(() => new MapLibreOverlay({ interleaved: false, layers, getTooltip, onClick }))
  overlay.setProps({ layers, getTooltip, onClick })
  return null
}
