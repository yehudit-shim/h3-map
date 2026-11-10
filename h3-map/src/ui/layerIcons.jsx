import { Flame, Hexagon, MapPin, Spline, Shapes, Braces, ScatterChart, Grid3x3 } from 'lucide-react'

const ICONS = {
  point: MapPin,
  line: Spline,
  polygon: Shapes,
  scatter: ScatterChart,
  heatmap: Flame,
  hexbin: Grid3x3,
  h3: Hexagon,
  geojson: Braces,
}

export function LayerTypeIcon({ icon, size = 15, className }) {
  const Icon = ICONS[icon] ?? Shapes
  return <Icon size={size} strokeWidth={1.8} className={className} aria-hidden="true" />
}
