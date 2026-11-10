# Map Layers

Layer types are plugins (see SYSTEM_ARCHITECTURE.md §3.2). Priority: **MVP** = first release, **R2** = next, **Later**.
deck.gl class names below were checked against the installed 9.4.1 packages (`@deck.gl/layers`, `geo-layers`, `aggregation-layers`).

## A. Base maps

| Id | Implementation | Priority |
|---|---|---|
| light / dark / streets | MapLibre style JSON (self-hosted vector tiles preferred) | MVP (light, dark, blank), R2 (streets) |
| satellite | MapLibre style with `raster` source (XYZ) | R2 |
| terrain | `raster-dem` source + hillshade; 3D terrain via `map.setTerrain` | R2 |
| topographic | raster XYZ or vector style with contours | Later |
| blank | style with `background` layer only | MVP |

Config: `config/basemaps.json` (or served by `GET /api/v1/config/basemaps`). Switching a basemap replaces the style; deck.gl layers persist because they live in the overlay.

## B. Standard GIS layers

### Vector geometry -> deck.gl

| Geometry | Layer | Notes |
|---|---|---|
| Point / MultiPoint | `ScatterplotLayer` (or `IconLayer`, `TextLayer` for labels) | `getRadius`, `radiusUnits`, `radiusMinPixels` |
| LineString / MultiLineString | `PathLayer` (or `GeoJsonLayer`) | `widthUnits: 'pixels'` for constant screen width |
| Polygon / MultiPolygon | `SolidPolygonLayer` / `PolygonLayer` / `GeoJsonLayer` | `extruded`, `getElevation` for 3D |
| GeometryCollection | `GeoJsonLayer` (handles mixed) | The server splits by type when loading from PostGIS (`ST_CollectionExtract`) so styling is per type |
| Mixed / unknown | `GeoJsonLayer` | default for files |

`GeoJsonLayer` is the default "vector" layer for small data and file uploads; for large tables the `MVTLayer` (itself a `GeoJsonLayer` sublayer renderer) is used.

### Data sources

| Source | Strategy | Priority |
|---|---|---|
| PostGIS table | backend `/features` (bbox, filter, paginate) or `/tiles` MVT | **MVP** |
| GeoJSON (file/URL) | client parse (loaders.gl), worker for large | **MVP** |
| CSV with lon/lat | papaparse -> points, column pickers | **MVP** |
| MVT (external URL) | `MVTLayer` | R2 |
| XYZ raster tiles | `TileLayer` + `BitmapLayer` | R2 |
| WMS | `WMSLayer` (present in geo-layers 9.4.1) | R2 |
| WMTS | `TileLayer` with URL template derived from capabilities | Later |
| FlatGeobuf | `flatgeobuf` streaming with bbox | Later |
| GeoPackage | server-side upload + conversion (pyogrio) to PostGIS or MVT; browser sql.js is an alternative | Later |
| GeoTIFF / COG | COG: client-side `geotiff.js` with a deck.gl wrapper (**separate package; verify before adopting**). Fallback: server-side tiles via Rasterio/titiler | Later (R3) |

## C. H3 layers

See H3_IMPLEMENTATION.md for details.

| Layer | deck.gl | Priority |
|---|---|---|
| H3 grid from table / API | `H3HexagonLayer` | **MVP** |
| H3 coloured by attribute | `H3HexagonLayer` + color scale | **MVP** |
| 3D H3 | `H3HexagonLayer` with `extruded`, `getElevation`, `elevationScale` | **MVP** |
| H3 aggregation from points | server (`h3-py` / SQL) or worker (`h3-js` `latLngToCell`) then H3HexagonLayer | **MVP** |
| H3 cluster outlines | `H3ClusterLayer` (merges adjacent cells into polygons) | R2 |
| H3 parent/child overlay | second `H3HexagonLayer` with outline-only style | R2 |
| H3 selection highlight | `H3HexagonLayer` with `highlightedObjectIndex` / `autoHighlight` and a separate selected-cells layer | MVP |

`H3HexagonLayer` props to use: `getHexagon`, `getFillColor`, `getElevation`, `extruded`, `filled`, `stroked`, `getLineColor`, `lineWidthMinPixels`, `highPrecision: 'auto'`, `coverage`, `pickable`, `updateTriggers`. Cells at mixed resolutions are supported (the layer handles it), but `highPrecision` may be required near pentagons or for high-res accuracy.

## D. Analytical visualization layers

| Visualization | deck.gl layer | Data | Priority |
|---|---|---|---|
| Heatmap | `HeatmapLayer` (GPU, points + weight) | points | R2 |
| Point clustering | no built-in deck.gl cluster layer: use `supercluster` in a worker -> `ScatterplotLayer` + `TextLayer`; or server-side/H3 aggregation | points | R2 |
| Hexagon aggregation (non-H3) | `HexagonLayer` (labelled "Hex bin (generic)") | points | R2 |
| Grid aggregation | `GridLayer` (non-H3 square bins) / `ScreenGridLayer` | points | R2 |
| H3 choropleth | `H3HexagonLayer` | h3 + value | MVP |
| Polygon choropleth | `GeoJsonLayer`/`MVTLayer` with colour accessor | polygons + attr | MVP |
| 3D extruded polygons | `GeoJsonLayer` `extruded` or `SolidPolygonLayer` | polygons + height | MVP |
| 3D H3 | `H3HexagonLayer extruded` | | MVP |
| Scatterplot | `ScatterplotLayer` | points | MVP |
| Arcs | `ArcLayer` (or `GreatCircleLayer`) | origin/destination pairs | R2 |
| Flow visualization | `ArcLayer` / `LineLayer` with width by volume; optional H3 origin-destination aggregation | OD | R2 |
| Trips / movement | `TripsLayer` with animation clock | paths + timestamps | Later |
| Contours | `ContourLayer` | points | Later |
| Density maps | `HeatmapLayer` / H3 density (count per cell) | points | R2 |
| Columns | `ColumnLayer` | | Later |
| Terrain | `TerrainLayer` | | Later |

GPU aggregation layers aggregate in the browser, so they inherit the browser's data limit (about 1M points comfortably on a decent GPU). Beyond that, aggregate on the server.

## Per-layer configuration (common)

```jsonc
{
  "id": "uuid", "name": "Parcels", "type": "vector", "visible": true, "opacity": 0.8,
  "source": { "kind": "postgis", "connectionId": "…", "schema": "public", "table": "parcels",
              "geometryColumn": "geom", "srid": 4326, "strategy": "mvt" },
  "filters": [ { "column": "zone", "op": "in", "value": ["R1","R2"] } ],
  "style": {
    "fill":   { "mode": "graduated", "column": "pop", "ramp": "viridis", "classes": 7, "method": "quantile" },
    "stroke": { "color": [255,255,255,180], "width": 1, "widthUnits": "pixels" },
    "point":  { "radius": 5, "radiusMode": "fixed" },
    "extrusion": { "enabled": false, "column": null, "scale": 1 }
  },
  "interaction": { "pickable": true, "tooltipColumns": ["name","pop"] }
}
```

## Styling options by type

| Option | vector | H3 | heat | arcs |
|---|---|---|---|---|
| fill colour (single / categorical / graduated) | yes | yes | ramp | source/target colour |
| stroke colour / width | yes | yes | no | width |
| point size | yes | n/a | radiusPixels | n/a |
| extrusion height | polygons | yes | no | no |
| opacity | yes | yes | yes | yes |
| filters | yes | yes | yes | yes |

## Interaction behaviour

- Hover: `autoHighlight`, tooltip with configured columns.
- Click: selects the feature; inspector shows all attributes (fetched by id from the backend if tiles stripped them).
- Shift-click: multi-select. Selection is a set of `{layerId, featureId | h3}`.
- Picking for MVT: feature id must be stable, so tables need a primary key exposed as the MVT feature id (`ST_AsMVT(..., 'geom', 4096, NULL?)` with the id column argument).
- Context menu: zoom to feature, copy coordinates, copy H3 index, show parent/children.

## Development priority

1. MVP: vector (GeoJSON / PostGIS), CSV points, H3HexagonLayer, scatterplot, polygon choropleth, extruded polygons.
2. R2: MVT, XYZ/WMS, heatmap, clustering, generic hex/grid, arcs.
3. Later: trips, contours, FlatGeobuf, GeoPackage, COG, WMTS.
