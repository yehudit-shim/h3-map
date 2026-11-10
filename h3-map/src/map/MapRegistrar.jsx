import { useEffect } from 'react'
import { useMap } from 'react-map-gl/maplibre'
import { registerMap } from './mapActions.js'

/** Registers the MapLibre instance for imperative actions. Must render inside <MapProvider>. */
export default function MapRegistrar() {
  const { main } = useMap()
  useEffect(() => {
    registerMap(main ?? null)
    return () => registerMap(null)
  }, [main])
  return null
}
