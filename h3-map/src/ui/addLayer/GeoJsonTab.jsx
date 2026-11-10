import FileOrUrlTab from './FileOrUrlTab.jsx'

export default function GeoJsonTab({ initialFile, onDone }) {
  return (
    <FileOrUrlTab
      format="geojson"
      accept=".geojson,.json,application/geo+json,application/json"
      hint=".geojson or .json · points, lines, polygons, Multi* and GeometryCollection · EPSG:4326"
      initialFile={initialFile}
      onDone={onDone}
    />
  )
}
