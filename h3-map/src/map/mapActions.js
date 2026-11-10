// Imperative map actions callable from anywhere (toolbar, layer manager). The MapLibre instance is
// registered by <MapRegistrar/> via react-map-gl's useMap(), so UI code never imports map internals.
let mapRef = null

export function registerMap(map) {
  mapRef = map
}

/** Fit the camera to [minLon,minLat,maxLon,maxLat]. */
export function zoomToBounds(bounds, { padding } = {}) {
  if (!mapRef || !bounds) return
  const [w, s, e, n] = bounds
  const narrow = typeof window !== 'undefined' && window.innerWidth < 1024
  mapRef.fitBounds(
    [[w, s], [e, n]],
    { padding: padding ?? (narrow ? 40 : { top: 70, bottom: 50, left: 340, right: 340 }), maxZoom: 16, duration: 700 },
  )
}

export function zoomBy(delta) {
  mapRef?.easeTo({ zoom: mapRef.getZoom() + delta, duration: 250 })
}

export function resetNorth() {
  mapRef?.easeTo({ bearing: 0, pitch: 0, duration: 400 })
}

export function setPitch(pitch) {
  mapRef?.easeTo({ pitch, duration: 300 })
}

export function flyToView({ lon, lat, zoom }) {
  mapRef?.flyTo({ center: [lon, lat], zoom, duration: 900 })
}
