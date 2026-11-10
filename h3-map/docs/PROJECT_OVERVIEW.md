# Project Overview

## 1. Repository baseline (audited 2026-11-09)

| Item | Finding |
|---|---|
| Location | `deck.gl/h3-map/` (git root is the parent `anastasia/` directory; single commit `baseline`) |
| Scaffold | Unmodified Vite + React template. `src/App.jsx` is the default "Get started" counter page; no map code exists |
| Language | JavaScript (JSX), ESM, ESLint 10 flat config with react-hooks + react-refresh |
| Runtime | Node 26.13, npm 11.20 |
| Backend / DB / Docker | None. No `docs/`, `backend/`, tests, or CI |

### Installed dependencies (verified in `node_modules`)

| Package | Installed | License | Notes |
|---|---|---|---|
| react / react-dom | 19.3.1 | MIT | |
| vite | 8.3.7 | MIT | with `@vitejs/plugin-react` 6.x |
| deck.gl (umbrella) | 9.4.1 | MIT | re-exports core, layers, geo-layers, aggregation-layers, extensions, react, mapbox, maplibre, widgets, carto, google-maps, arcgis |
| @deck.gl/core, react, layers, geo-layers | 9.4.1 | MIT | listed explicitly in package.json |
| h3-js | 4.5.0 | Apache-2.0 | deck.gl geo-layers requires `^4.4.0`, compatible |
| maplibre-gl | 6.17.0 | BSD-3-Clause | |
| react-map-gl | 8.1.3 | MIT | use the `react-map-gl/maplibre` subpath; peer range `maplibre-gl >=1.13` is satisfied |

### Findings relevant to the design

1. `@deck.gl/aggregation-layers` (HeatmapLayer, ContourLayer, ScreenGridLayer, GridLayer, HexagonLayer), `@deck.gl/extensions`, and `@deck.gl/maplibre` (`MapboxOverlay`) are present as transitive dependencies of the `deck.gl` umbrella package. Application code should import from `deck.gl`, or add the sub-packages explicitly if the umbrella is dropped. Mixing both styles produces duplicate-module warnings.
2. `@deck.gl/geo-layers` ships: `H3HexagonLayer`, `H3ClusterLayer`, `MVTLayer`, `TileLayer`, `TerrainLayer`, `TripsLayer`, `WMSLayer`, `GreatCircleLayer`, `S2Layer`, `QuadkeyLayer`, `GeohashLayer`, `Tile3DLayer`, `A5Layer`. It does **not** ship a GeoTIFF/COG layer; COG support needs an additional package (see MAP_LAYERS.md, section on rasters). Do not assume one exists.
3. There is no `@deck.gl/geo-layers` dependency conflict: it uses `h3-js ^4.4`, and the project uses 4.5.
4. The project does not use TypeScript. `@types/react` is installed but unused.
5. Versions of `vite` 8, `maplibre-gl` 6, `eslint` 10 are newer than much published documentation. Verify breaking changes against release notes when implementing Phase 1 and Phase 2 (see open questions in DEVELOPMENT_ROADMAP.md).
6. Not installed and needed: state management, Tailwind, component library, Turf, test tooling, any backend.

## 2. Purpose

A reusable, open-source, browser-based geospatial analytics platform that combines classic GIS capabilities (layers, attribute inspection, spatial tools, PostGIS connectivity) with **first-class Uber H3** support. The product is meant to grow from a map viewer into an analytics platform. Closest references: QGIS (layer model, tools), Kepler.gl (fast visual layer config), CARTO (database-backed layers).

## 3. Main objectives

1. Connect safely to PostgreSQL/PostGIS and browse schemas, tables, and views.
2. Put any geometry table or H3 table on the map in a few clicks.
3. Render large data efficiently: the browser never receives more data than it can display.
4. Treat H3 as a native data type: detect H3 columns, render via `H3HexagonLayer`, aggregate, change resolution, inspect parents and children.
5. Provide a styling engine (single, categorical, graduated, size, height) with legends.
6. Provide an extensible GIS toolbox, with an explicit split between browser-side and server-side operations.
7. Remain 100% open source, with no Mapbox or other proprietary mapping dependency.

## 4. Intended users

| User | Needs |
|---|---|
| GIS analyst | Inspect PostGIS tables, style layers, run buffer/intersect/clip, export results |
| Data scientist / analyst | H3 aggregation of point data, choropleths by attribute, density maps |
| Data engineer | Verify ingestion results, check SRIDs, indexes, extents |
| Developer | Embed or extend the platform with new layer types and data providers |
| Admin | Manage database connections and access |

## 5. Main capabilities (target product)

- Basemap switching (light, dark, streets, satellite, terrain, topo, blank), provider-configurable.
- Vector, raster, tile-service, and file-based data sources.
- H3 grids, aggregation, resolution control 0-15, parent/child navigation, selection, export.
- Analytical layers: heatmap, clustering, hex aggregation, choropleth, 3D extrusion, arcs, trips, contours.
- Layer manager with per-layer config, ordering, saving.
- Feature inspector, tooltips, coordinate display, measurement.
- Database browser with geometry/SRID/extent/index discovery.
- Server-side filtering, tiling, and aggregation for large data.

## 6. Expected final product

A Docker Compose deployable stack: React SPA, FastAPI geospatial API, PostgreSQL/PostGIS (plus optional Martin/pg_tileserv and a basemap tile server). Runs on Linux and on WSL2 for development. Layer configurations are saved per user. See SYSTEM_ARCHITECTURE.md.

## 7. Document map

| Document | Content |
|---|---|
| SYSTEM_ARCHITECTURE.md | Components, data flow, decisions, licenses |
| MAP_LAYERS.md | Layer catalogue and deck.gl mapping |
| H3_IMPLEMENTATION.md | H3 design |
| DATABASE_INTEGRATION.md | PostGIS connectivity and discovery |
| UI_UX_DESIGN.md | Layout and design system |
| DEVELOPMENT_ROADMAP.md | Phased tasks, MVP |
| API_SPECIFICATION.md | REST API |
| DATABASE_SCHEMA.md | App metadata schema and data table examples |
| TESTING_STRATEGY.md | Test plan |
