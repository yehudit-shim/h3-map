import { formatCoord, formatScale } from '../lib/format.js'
import { effectiveLayers } from '../layers/tree.js'
import { useLayersStore } from '../state/layersStore.js'
import { useMapStore } from '../state/mapStore.js'
import { useSelectionStore } from '../state/selectionStore.js'

function Item({ label, children, testId, className = '' }) {
  return (
    <div className={`flex items-baseline gap-1.5 whitespace-nowrap ${className}`} data-testid={testId}>
      <span className="text-muted">{label}</span>
      <span className="font-mono text-fg">{children}</span>
    </div>
  )
}

/** Bottom status bar: coordinates, zoom, scale, CRS, selection (docs/UI_UX_DESIGN.md §1). */
export default function StatusBar() {
  const cursor = useMapStore((s) => s.cursor)
  const zoom = useMapStore((s) => s.viewState.zoom)
  const lat = useMapStore((s) => s.viewState.latitude)
  const pitch = useMapStore((s) => s.viewState.pitch)
  const bearing = useMapStore((s) => s.viewState.bearing)
  const selected = useSelectionStore((s) => (s.selected ? (s.selected.cells?.length ?? 1) : 0))
  const layerCount = useLayersStore((s) => effectiveLayers(s.tree).filter((l) => l.visible).length)
  return (
    <footer className="z-20 flex h-7 shrink-0 items-center gap-4 overflow-hidden border-t border-line bg-panel px-3 text-[11px]" role="status" aria-label="Map status">
      <Item label="Lon, Lat" testId="status-coords" className="min-w-[110px] sm:min-w-[170px]">
        {cursor ? `${formatCoord(cursor.lon)}, ${formatCoord(cursor.lat)}` : '–'}
      </Item>
      <Item label="Zoom" testId="status-zoom">{zoom.toFixed(2)}</Item>
      <Item label="Scale" testId="status-scale" className="max-sm:hidden">{formatScale(lat, zoom)}</Item>
      <Item label="CRS" testId="status-crs">EPSG:4326</Item>
      <Item label="View" className="max-md:hidden">{Math.round(bearing)}° / {Math.round(pitch)}°</Item>
      <div className="ml-auto flex items-center gap-4">
        <Item label="Layers" testId="status-layers" className="max-sm:hidden">{layerCount}</Item>
        <Item label="Selected" testId="status-selected">{selected}</Item>
      </div>
    </footer>
  )
}
