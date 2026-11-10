# Implementation Summary

A record of what was done in this project: the documentation phase, then the implementation of Phase 1 (foundation) and Phase 2 (map engine). Written 2026-11-09.

## 1. Starting point

The repository was an unmodified Vite + React template (a counter page). The map libraries were installed but unused, and there was no backend, no tests and no `docs/` folder.

Installed and verified before any design work:

| Package | Version |
|---|---|
| react / react-dom | 19.3.1 |
| vite | 8.3.7 |
| deck.gl (and its sub-packages) | 9.4.1 |
| maplibre-gl | 6.17.0 |
| react-map-gl | 8.1.3 |
| h3-js | 4.5.0 |

Findings that shaped the design:
- deck.gl 9.4.1 has no GeoTIFF/COG layer, so raster support needs a separate package or server-side tiling.
- The aggregation layers (heatmap, hexagon) and `MapboxOverlay` are only transitive dependencies of the `deck.gl` package.
- h3-js is v4, so the v3 function names do not exist.

## 2. Step 1: Documentation (10 files in `docs/`)

| File | Content |
|---|---|
| `PROJECT_OVERVIEW.md` | Repository audit, objectives, users, capabilities |
| `SYSTEM_ARCHITECTURE.md` | Architecture decisions (AD-1 to AD-12), diagrams, data flow, size-based loading strategy (10k to 10M features), licences, risks |
| `MAP_LAYERS.md` | Layer catalogue mapped to deck.gl classes, with priorities |
| `H3_IMPLEMENTATION.md` | H3 design: storage, discovery, resolution management, aggregation, performance |
| `DATABASE_INTEGRATION.md` | PostGIS connectivity, discovery queries, query builder, vector tiles, security |
| `UI_UX_DESIGN.md` | Layout, panels, design system, interaction flows |
| `DEVELOPMENT_ROADMAP.md` | About 70 tasks in 10 phases, with MVP scope and open questions |
| `API_SPECIFICATION.md` | Planned REST API |
| `DATABASE_SCHEMA.md` | App metadata schema and example geometry and H3 tables |
| `TESTING_STRATEGY.md` | Test plan |

Two errors I made in these drafts were found and fixed after checking against the installed h3-js: a wrong zoom-to-resolution table, and a placeholder SQL example.

## 3. Step 2: Phase 1, project foundation

- **Structure:** the Vite demo was removed and replaced by a layered layout (`app`, `map`, `layers`, `data`, `h3`, `styling`, `state`, `ui`, `lib`). Dependencies point one way: `ui → state → layers → data/styling`.
- **Design system:** Tailwind CSS v4 with CSS-variable tokens (`bg-panel`, `text-muted`, `border-line`, and so on). It has dark and light themes and a restrained palette with one accent colour.
- **Reusable components:** buttons, icon buttons, selects, sliders, switches, segmented controls, colour input, ramp picker, toasts, empty states, badges and sections.
- **State (Zustand):**
  - `layersStore`: the layer list
  - `dataStore`: loaded data per source, with retry
  - `mapStore`: camera and cursor
  - `selectionStore`: the selected feature or cell
  - `runtimeStore`: derived facts such as the effective H3 resolution
  - `uiStore`: theme, basemap, panels (theme and basemap persisted)
  - `notifyStore`: toasts
- **Errors and loading:** an error boundary around the whole app, the map and each panel. Data-load errors show a retry link in the layer row. Failed layers are isolated and reported once as a toast. There are loading indicators for the map and for layers.
- **Tooling:** Vitest and Testing Library, an end-to-end script, `docs/DEVELOPMENT_SETUP.md`, and Linux/WSL2 notes.

## 4. Step 3: Phase 2, map engine

### How it fits together

```
LayerConfig (plain JSON, in layersStore) ─┐
Data source load() → GeoJSON ─────────────┼→ layerType.prepare()   (cached per layer)
Auto H3 resolution (from zoom) ───────────┘        │
                                                   └→ layerType.createDeckLayers() → deck.gl layers
                                                              │
     map/useDeckLayers.js (the only bridge between stores and layers) → DeckOverlay → MapLibre
```

- **Layer types are plugins.** Each file in `layers/types/` supplies defaults, a control schema, data preparation, deck.gl layer creation, tooltip/inspector content and a legend. The style panel is generated from the control schema, so adding a type needs no change to the map or the UI. A unit test proves this.
- **Data sources are separate from layers.** `data/sources.js` is a registry. Layers consume only GeoJSON plus field metadata, so a PostGIS table can later be added as another source without touching layer code.
- **Sample data** is deterministic: 20,000 clustered events, 300 POIs, 14 routes, 29 districts (including a MultiPolygon) and a mixed collection. All of it is around Paris.

### The eight layer types

| Layer | deck.gl implementation |
|---|---|
| Points (PointLayer) | `ScatterplotLayer` |
| Lines (LineLayer) | `PathLayer` |
| Polygons (PolygonLayer) | `PolygonLayer`, with choropleth and 3D extrusion |
| Scatterplot | `ScatterplotLayer`, with size and colour by attribute |
| Heatmap | `HeatmapLayer` |
| Hex bin (generic) (HexagonLayer) | `HexagonLayer`, labelled "not H3" in the UI |
| H3 grid (H3HexagonLayer) | `H3HexagonLayer` with real h3-js indexes |
| GeoJSON (GeoJSONLayer) | `GeoJsonLayer` |

### H3 demonstration
- Points are binned with `latLngToCell` into real H3 cells, and aggregated by count, average, sum, minimum or maximum of a field.
- Resolution can be Auto (follows zoom) or Fixed, from 0 to 15, with a readout of edge length, area and cell count.
- Cells are coloured by the aggregated value, with continuous, quantile or equal-interval classes and a legend. They can be extruded in 3D.
- Clicking a cell outlines it and shows its index, resolution, centre, area, pentagon flag, base cell, parent and children count in the Inspector. Changing the resolution clears the selection.

### Interface
- Top toolbar: sidebar toggles, search (`lat, lon` or an H3 index), basemap menu, Add data, theme toggle.
- Left sidebar: Layers, Data and H3 tabs.
- Right panel: Inspector and Style tabs.
- Floating legend and zoom/compass/pitch controls.
- Bottom status bar: lon/lat, zoom, scale, `EPSG:4326`, rotation/pitch, layer count and selection count.

## 5. Problems found while testing, and fixes

| Problem | Cause | Fix |
|---|---|---|
| Basemap silently fell back to blank, with the console error "Worker failed to load" | maplibre-gl 6 finds its worker relative to its own file, which breaks under Vite (dev and build) | `map/maplibreSetup.js` registers the worker explicitly. Verified in dev and in the production build. |
| Both side panels overlapped after shrinking the window | The one-panel-at-a-time rule only ran on toggles | The layout now reacts to the media query |
| `hidden md:flex`-style classes had no effect | A base `flex`/`inline-flex` class on the same element won | Switched to `max-md:hidden` variants |
| Lint errors | An unused assignment, a ref write during render, `process` undefined in the Vite config | All fixed; lint is clean |

Several end-to-end failures were bugs in my test, not in the app (test ids that wrapped both label and value, and animation waits too short for a software renderer). The test was corrected.

## 6. Verification results

| Check | Result |
|---|---|
| `npm run lint` | clean |
| `npm test` | 58 tests pass in 7 files |
| `npm run build` | succeeds |
| Browser smoke test, dev server | 27/27 checks pass |
| Browser smoke test, production build | 27/27 checks pass |
| Import-case audit (Linux safety) | all relative imports match file name case |

The smoke test uses the system Chrome with a software WebGL renderer and covers rendering, H3 click selection, the resolution selector, navigation controls, all eight layer types, extrusion, basemap and theme switching, search, and the mobile layout.

**Not verified:** running on WSL2 itself (no distribution is installed on this machine). Linux compatibility was checked statically only.

## 7. Deviations from the design docs

All are listed in `SYSTEM_ARCHITECTURE.md` §11. The main ones:
- `MapLibreOverlay` from `@deck.gl/maplibre` is used instead of `MapboxOverlay`, which the `deck.gl` package does not export.
- UI primitives are hand-written (no Radix yet). Layer reordering uses up/down buttons instead of drag and drop.
- The "LineLayer" is built on `PathLayer`, because deck.gl's `LineLayer` only draws two-point segments.
- There is no router, because there is only one screen.
- H3 aggregation runs on the main thread (fine for 20k points; a worker is planned).
- Default basemaps are CARTO's public styles, overridable with `VITE_BASEMAP_LIGHT_STYLE` and `VITE_BASEMAP_DARK_STYLE`.

## 8. Dependencies

Runtime dependencies added: `zustand`, `lucide-react`, `@deck.gl/maplibre`, `@deck.gl/aggregation-layers`.

Dev dependencies added: `tailwindcss`, `@tailwindcss/vite`, `vitest`, `jsdom`, `@testing-library/react`, `@testing-library/jest-dom`, `playwright-core`.

## 9. What is not done yet

- Backend, PostgreSQL/PostGIS integration, Docker and CI (Phase 6 onwards)
- Streets, Satellite and Terrain basemaps, and self-hosted tiles (P2-06)
- URL view sync (P2-05)
- Loading user GeoJSON or CSV files (P4-01)
- A Web Worker for H3 aggregation (P5-01)
- Multi-select of H3 cells
- GIS tools: draw, measure, analysis (Phase 8)
- Drag-and-drop layer ordering, Radix-based dialogs and popovers (P1-03, P3-03)

The roadmap (`DEVELOPMENT_ROADMAP.md`) has 15 tasks checked, with an implementation-status note under each task I touched.

## 10. Running it

```bash
cd h3-map
npm install
npm run dev          # http://localhost:5173
npm test             # unit and component tests
npm run test:e2e     # browser smoke test (needs a running app and Chrome)
```

See `DEVELOPMENT_SETUP.md` for WSL2 notes and configuration.
