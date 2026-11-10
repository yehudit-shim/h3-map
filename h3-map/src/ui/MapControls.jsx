import { Compass, Minus, Plus, Rotate3d } from 'lucide-react'
import { useMapStore } from '../state/mapStore.js'
import { resetNorth, setPitch, zoomBy } from '../map/mapActions.js'
import { IconButton } from './Button.jsx'

/** Zoom, rotation (compass), and pitch controls (floating over the map). */
export default function MapControls() {
  const bearing = useMapStore((s) => s.viewState.bearing)
  const pitch = useMapStore((s) => s.viewState.pitch)
  return (
    <div className="flex flex-col gap-1 rounded-lg border border-line bg-panel/95 p-1 shadow-float backdrop-blur" role="group" aria-label="Map navigation">
      <IconButton label="Zoom in" icon={Plus} onClick={() => zoomBy(1)} />
      <IconButton label="Zoom out" icon={Minus} onClick={() => zoomBy(-1)} />
      <div className="mx-1 h-px bg-line" />
      <button
        type="button"
        aria-label={`Reset north (bearing ${Math.round(bearing)}°)`}
        title="Reset bearing and pitch"
        onClick={resetNorth}
        className="inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-md text-muted hover:bg-hover hover:text-fg"
      >
        <Compass size={17} strokeWidth={1.9} style={{ transform: `rotate(${-bearing}deg)` }} aria-hidden="true" />
      </button>
      <IconButton label={pitch > 5 ? 'Switch to 2D (pitch 0°)' : 'Tilt to 3D (pitch 60°)'} icon={Rotate3d} active={pitch > 5} onClick={() => setPitch(pitch > 5 ? 0 : 60)} />
    </div>
  )
}
