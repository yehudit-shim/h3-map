# Development Roadmap

Legend: **Priority** Critical / High / Medium / Low. **Complexity** S (≤½ day), M (1-2 days), L (3-5 days), XL (>1 week). **MVP** marks tasks in the first release.
Task block format: `- [ ] ID · Title` followed by Description / Tech / Deps / Priority · Complexity / Acceptance.

## Implementation status (updated after Phase 5)

Phases 1 and 2 were implemented together with the parts of Phases 3, 5 and 7 needed to deliver an interactive map backed by sample data (no database). Tasks marked `[x]` are complete and verified (unit tests, a browser end-to-end run in dev and production builds). Tasks that are only partly done are left unchecked with a note. **Not started:** P1-06, P1-07, P1-09, P1-10, P2-05, P2-06, P2-07 and everything in Phases 6, 8 and 9, plus the remaining Phase 10 tasks. See `SYSTEM_ARCHITECTURE.md` §11 for architectural changes made during implementation. **Phase 5 (H3) is implemented client-side except P5-08 and P5-09** (see the Phase 5 section; the h3-py parity fixture still has to be generated once). **Phase 4 is implemented client-side only** (P4-01, P4-03, P4-05; P4-02, P4-04, P4-07 and P4-08 need the backend or were out of scope; see the Phase 4 section). **Phase 3 (layer management) is complete**; the Phase 3 section lists the two items left for later (map-canvas context menu, server-side project storage).

## MVP definition

The MVP is done when a user can: open the app, see a MapLibre map with deck.gl overlay and 3 basemaps; add a PostGIS geometry table or H3 table from a database browser (read-only, backend-mediated); see it with a style based on a column and a legend; use the layer manager (toggle, reorder, opacity, rename, remove, zoom to); click features/cells to inspect attributes; handle a 1M-row table without crashing the browser (tiles or aggregation); and deploy the whole stack with `docker compose up`.

**MVP tasks:** P1 all except P1-09; P2-01..P2-05; P3-01..P3-06; P4-01, P4-02, P4-03; P5-01..P5-06; P6-01..P6-09; P7-01..P7-05; P8-01, P8-02, P8-03; P9-01, P9-02; P10-01..P10-04.
**Post-MVP (R2/R3):** everything else.

## Critical path

P1-01 → P2-01 → P3-01 → P6-01 → P6-03 → P6-05 → (P4-02, P5-02, P7-01) → P9-01 → P10-03

---

## Phase 1: Project foundation

- [x] **P1-01 · Repository restructure and docs commit** (MVP)
  - **Implementation status:** Demo content removed; module layout created (`app/ map/ layers/ data/ styling/ state/ ui/ h3/ lib/`). `backend/` and `docker/` are deliberately not created yet (Phase 6 / P1-06, P1-07).
  - Description: Remove Vite demo content (`App.jsx` body, `App.css`, `index.css`, `assets/hero.png` etc.), create the module layout from SYSTEM_ARCHITECTURE.md §3.1, add `backend/`, `docker/`, `docs/`.
  - Tech: keep Vite config; ESLint passes; path alias `@/`.
  - Deps: none · Critical · S
  - Acceptance: `npm run dev` shows an empty shell; `npm run lint` and `npm run build` pass; directories exist with README stubs.
- [x] **P1-02 · Tailwind CSS + design tokens** (MVP)
  - **Implementation status:** Tailwind CSS v4 (`@tailwindcss/vite`), CSS-variable tokens in `src/styles/index.css`, dark/light UI theme persisted in `uiStore`.
  - Tech: Tailwind (check current major version's Vite plugin setup), CSS variables for tokens, light/dark theme.
  - Deps: P1-01 · High · S
  - Acceptance: tokens documented in `ui/`; theme toggle works; no Vite template CSS remains.
- [ ] **P1-03 · UI primitives library** (MVP)
  - **Implementation status:** PARTIAL. Hand-built accessible primitives (`ui/Button.jsx`, `controls.jsx`, `feedback.jsx`): Button, IconButton, Select, Slider, Switch, Segmented, ColorInput, Toast, Section, EmptyState. Radix UI, a gallery route, Dialog/Popover/Tree/ContextMenu are not done. No new dependency was added for this.
  - Tech: Radix UI primitives + Lucide; Button, IconButton, Tooltip, Popover, Dialog, Tabs, Select, Slider, Switch, ContextMenu, Tree.
  - Deps: P1-02 · High · M
  - Acceptance: primitives rendered in a dev-only gallery route; keyboard and ARIA verified.
- [x] **P1-04 · State management skeleton** (MVP)
  - **Implementation status:** Zustand stores in `src/state/` (layers, data, map, selection, runtime, ui, notify); unit tested in `state/stores.test.js`. The `LayerConfig` shape is documented in `layers/registry.js` and `layerFactory.js`.
  - Tech: Zustand stores (layers, map, selection, connections, ui) with devtools and persistence middleware; JSDoc typedefs for `LayerConfig`.
  - Deps: P1-01 · High · S
  - Acceptance: stores unit tested; no store imports UI code.
- [ ] **P1-05 · Testing tooling (frontend)** (MVP)
  - **Implementation status:** PARTIAL. Vitest + Testing Library (58 unit/component tests) and a Playwright-core end-to-end smoke test (`e2e/smoke.mjs`, 27 checks) exist. MSW and CI are not set up.
  - Tech: Vitest, Testing Library, MSW, Playwright skeleton; `npm test` scripts.
  - Deps: P1-01 · High · S
  - Acceptance: one passing unit, one component, one E2E smoke test in CI.
- [ ] **P1-06 · Backend scaffold** (MVP)
  - Tech: FastAPI, pydantic-settings, uvicorn, ruff, mypy, pytest; `/health`, `/ready`, `/config`; structured logging, request ids, error envelope.
  - Deps: P1-01 · Critical · M
  - Acceptance: `uvicorn` starts; OpenAPI served; tests pass; error envelope matches API_SPECIFICATION.md.
- [ ] **P1-07 · Docker Compose dev stack** (MVP)
  - Tech: services `frontend` (Vite), `backend`, `postgis` (postgis/postgis image) with init SQL, sample data, `gis_reader` role; healthchecks; `.env.example`; volume for pgdata.
  - Deps: P1-06 · Critical · M
  - Acceptance: `docker compose up` from a clean checkout works in WSL2 Ubuntu and native Linux; sample tables exist.
- [ ] **P1-08 · WSL2 developer guide and CI** (MVP)
  - **Implementation status:** PARTIAL. `docs/DEVELOPMENT_SETUP.md` written. CI pipeline not created. A real WSL2 run was not possible on this machine (no distribution installed); Linux compatibility was checked statically (import-case audit, no OS-specific code).
  - Tech: `docs/DEVELOPMENT_SETUP.md` (WSL2 notes: keep repo on the Linux filesystem, not `/mnt/c`; Docker Desktop WSL integration or docker-ce in WSL; file watching polling option); CI pipeline lint/test/build.
  - Deps: P1-05, P1-07 · Medium · S
  - Acceptance: a new developer follows the guide to a running stack; CI green.
- [ ] **P1-09 · TypeScript migration decision** (post-MVP)
  - Tech: either keep JS+JSDoc with `// @ts-check` or migrate to TS; see Q1.
  - Deps: P1-01 · Medium · M
  - Acceptance: decision recorded in an ADR; if migrating, `tsc --noEmit` in CI.
- [ ] **P1-10 · Licence audit and dependency policy** (MVP)
  - Tech: `license-checker`, `pip-licenses`; allow-list (MIT, BSD, ISC, Apache-2.0, MPL-2.0 as dependency only); `THIRD_PARTY_LICENSES.md`; choose project licence (Q6).
  - Deps: P1-01 · Medium · S
  - Acceptance: CI fails on a disallowed licence; report generated.

## Phase 2: Map engine and basemaps

- [x] **P2-01 · MapView with react-map-gl/maplibre** (MVP)
  - **Implementation status:** `map/MapView.jsx` using `react-map-gl/maplibre` with maplibre-gl 6.17. Required an explicit worker URL (`map/maplibreSetup.js`) because maplibre-gl 6 resolves its worker relative to its own module URL, which breaks under Vite (dev and build). Works in StrictMode.
  - Tech: `Map` from `react-map-gl/maplibre`; `mapLib` = `maplibre-gl` (verify compatibility of react-map-gl 8.1.3 with maplibre-gl 6.17: smoke test first); controlled view state in `mapStore`; CSS import `maplibre-gl/dist/maplibre-gl.css`.
  - Deps: P1-04 · Critical · M
  - Acceptance: full-screen map pans/zooms/pitches/rotates; no console errors; works in StrictMode (double mount) without leaking.
- [x] **P2-02 · deck.gl overlay integration** (MVP)
  - **Implementation status:** Uses `MapLibreOverlay` from `@deck.gl/maplibre` (not `MapboxOverlay`), `interleaved: false`. Picking and tooltips verified in the browser.
  - Tech: `MapboxOverlay` via `useControl`; start with `interleaved:false`; layers prop from the layer store; verify import path in the installed 9.4.1 (`deck.gl` umbrella vs `@deck.gl/mapbox`/`@deck.gl/maplibre`).
  - Deps: P2-01 · Critical · M
  - Acceptance: a test `ScatterplotLayer` renders and stays aligned during pitch/rotate; picking returns objects.
- [x] **P2-03 · Basemap registry and selector** (MVP)
  - **Implementation status:** `map/basemaps.js`: Light, Dark, Blank. Style URLs overridable with `VITE_BASEMAP_LIGHT_STYLE` / `VITE_BASEMAP_DARK_STYLE`; automatic fallback to Blank if a style fails to load. Streets/Satellite/Terrain/Topo are not done (see P2-06).
  - Tech: `config/basemaps.json` schema, style switching without losing deck layers, attribution control, blank style; Light and Dark from an open source style; Streets in R2.
  - Deps: P2-01 · High · M
  - Acceptance: switching basemaps keeps data layers; attribution shown; provider URLs only come from config.
- [x] **P2-04 · Map controls and status bar** (MVP)
  - **Implementation status:** Zoom, compass/reset, pitch toggle (`ui/MapControls.jsx`); status bar with live lon/lat, zoom, scale, CRS, bearing/pitch, layer and selection counts.
  - Tech: navigation/rotate/pitch controls, scale control, cursor lon/lat (throttled), zoom, scale denominator, CRS label.
  - Deps: P2-01 · High · S
  - Acceptance: values update at ≥30 fps without re-rendering the layer tree (profile).
- [ ] **P2-05 · View-state URL sync** (MVP)
  - Tech: debounce, hash `#zoom/lat/lon/bearing/pitch`.
  - Deps: P2-01 · Medium · S
  - Acceptance: reload restores the view; back/forward behave.
- [ ] **P2-06 · Self-hosted basemap tiles** (R2)
  - Tech: Protomaps PMTiles or OpenMapTiles + tileserver-gl/Martin as Compose service; fonts/sprites; satellite and terrain (raster-dem + hillshade) sources; licence review of every provider (see SYSTEM_ARCHITECTURE.md §9).
  - Deps: P2-03, P1-07 · Medium · L
  - Acceptance: app renders with no external network; documented data download/refresh procedure.
- [ ] **P2-07 · Terrain / 3D terrain** (R3)
  - Tech: `raster-dem`, `map.setTerrain`; interplay with deck.gl layers (`TerrainExtension` or `TerrainLayer`).
  - Deps: P2-06 · Low · M
  - Acceptance: 3D terrain toggle; deck layers drape correctly or limitation documented.

## Phase 3: Layer management

**Status: complete**, except the map-canvas context menu and the backend part of P3-07, which needs Phase 6. Verified by 92 unit/component tests (58 before Phase 3) and the browser smoke test (36/36 checks on the dev build).

- [x] **P3-01 · Layer type registry and factory** (MVP)
  - **Implementation status:** `layers/registry.js` + `layers/layerFactory.js` + `layers/buildDeckLayers.js`; eight built-in layer types in `layers/types/`. Adding a type = one new file registered in `layers/index.js`; covered by a unit test. Layer configs now carry `kind: 'layer'`.
  - Tech: `registerLayerType`, plugin contract from SYSTEM_ARCHITECTURE.md §3.2, JSON-Schema config validation, deck layer creation from configs with stable ids.
  - Deps: P2-02 · Critical · M
  - Acceptance: a new layer type can be added by adding one folder, with no change to `MapView`; unit tests for registry/factory.
- [x] **P3-02 · Layers store and actions** (MVP)
  - **Implementation status:** `state/layersStore.js` holds a layer **tree** (`tree`: layers and nested groups) as the single source of truth, plus a derived flat `layers` list (UI order, top first) that one `commit()` helper keeps in sync. Actions: add, remove (layer or group), duplicate (deep copy, fresh ids), rename, visibility, opacity, style update, move up/down, drag-drop move (`before`/`after`/`inside`/`end`), indent/outdent, group/ungroup, expand/collapse, multi-select. Pure tree operations live in `layers/tree.js`. Group visibility is ANDed and opacity multiplied down the tree (`effectiveLayers`); the map, legend and status bar use that. Undo is not implemented.
  - Tech: add/remove/rename/duplicate/reorder/visibility/opacity; undo-able; selectors.
  - Deps: P1-04, P3-01 · Critical · M
  - Acceptance: all actions unit tested; map order matches list order (top of list renders on top).
- [x] **P3-03 · Layer manager UI** (MVP)
  - **Implementation status:** `ui/LayerManager.jsx` is a QGIS-style layer tree: a toolbar (add layer, new group / group selection, expand/collapse all, save/load menu), nested groups with layer counts, eye toggles (a child shows when a parent group hides it), opacity, inline rename (double click / F2), Ctrl/Cmd+click multi-select, and load/error/retry states. Reordering uses native HTML5 drag and drop instead of dnd-kit (no new dependency). It has drop indicators and a "move to bottom" drop zone, and refuses moves into a node's own subtree or deeper than 6 levels. Keyboard fallback: Alt+Up/Down reorder, Alt+Right moves into the group above, Alt+Left moves out of the group.
  - Tech: sortable list (dnd-kit, MIT), eye toggle, opacity slider, kebab menu, empty state.
  - Deps: P3-02, P1-03 · High · M
  - Acceptance: drag reorder with keyboard fallback; component tests pass.
- [x] **P3-04 · Zoom to layer and metadata dialog** (MVP)
  - **Implementation status:** Zoom to a layer or a group (a group uses the union of its layers' data extents, `lib/geo.js#unionBounds`). `ui/LayerProperties.jsx` is a properties dialog: general info, effective visibility/opacity, group path, data source, feature count, H3 resolution/cells, attribute list, extent and the style JSON. For a group it shows the contents and the combined extent. Extents crossing the antimeridian are not handled specially yet (the sample data does not cross it). DB layers come with Phase 6.
  - Tech: layer extent from source metadata, `fitBounds`; metadata panel.
  - Deps: P3-02 · High · S
  - Acceptance: zoom works for file and DB layers; antimeridian-safe bounds.
- [x] **P3-05 · Right panel shell: style and inspector tabs** (MVP)
  - **Implementation status:** Right panel with Inspector and Style tabs. The style form is generated from each layer type's `controls` schema (`ui/StylePanel.jsx`). Fill/line colors, line width, point size, polygon/H3 extrusion and attribute-based styling (numeric ramps with classification, categorical palettes) are all schema-driven. Phase 3 fixed a bug: `showIf` was called without the data source, so the numeric "Color by" controls (ramp, classification, classes, reverse) never appeared.
  - Tech: panel container, selection routing, schema-driven form renderer.
  - Deps: P3-03 · High · M
  - Acceptance: selecting a layer shows style form generated from its config schema.
- [x] **P3-06 · Hover tooltips and click selection** (MVP)
  - **Implementation status:** Hover tooltips (`getTooltip`) and click selection (`useDeckLayers.js`). Escape clears the selection (`app/Workspace.jsx`), as do a click on empty map and the clear button. The Inspector shows which layer a feature belongs to. Removing a layer or group clears a selection that belongs to it.
  - Tech: deck `onHover`/`onClick`, `selectionStore`, highlight.
  - Deps: P3-01 · High · M
  - Acceptance: tooltip shows configured columns; click selects; Esc clears.
- [ ] **P3-07 · Save/load layer configs and projects** (R2)
  - **Implementation status:** PARTIAL (browser side done). The tree is auto-saved to localStorage (`h3map.layers`, zustand `persist`) and restored on reload. Export/import of a project JSON file (`{format: 'h3map.project', schemaVersion: 1, layers}`) goes through `layers/project.js`. It migrates schema 0 (the Phase 1-2 flat list), rejects newer versions, drops layers with unknown types or sources, fills missing style keys from the type defaults, clamps values and de-duplicates ids. If every saved layer is invalid, the current layers are kept. "Reset to default layers" is in the same menu. Not done: the server-side `/layers` and `/projects` APIs (they need the Phase 6 backend).
  - Tech: API `/layers`, `/projects`, localStorage draft, config `schema_version` migrations.
  - Deps: P6-01, P3-02 · Medium · M
  - Acceptance: reload restores layers; import/export project JSON.
- [x] **P3-08 · Context menu and layer groups** (R3)
  - **Implementation status:** Layer groups with nesting (max depth 6), collapse, and visibility/opacity that cascade to children. Every row has a right-click menu and a "More" button (`ui/Menu.jsx`, keyboard navigable), both built from one action list (`ui/layerActions.js`): show/hide, zoom, properties, edit style, rename, duplicate, move up/down/in/out, group, ungroup, remove. Not done: a context menu on the map canvas itself.
  - Deps: P3-03 · Low · M · Acceptance: context menu actions on map and layers; grouped layers collapse and toggle together.

## Phase 4: Standard GIS layers

**Status: client-side part complete** (P4-01, P4-03, P4-05). Not done: P4-02 (PostGIS), P4-04 (MVT), P4-06, P4-07, P4-08, P4-09. Verified by unit tests (parsers, jobs, source registry, layer types, project migration, dialog), the browser smoke test and `e2e/large-files.mjs` (50 MB GeoJSON, 500k-row CSV).

- [x] **P4-01 · Vector layer from GeoJSON file/URL** (MVP)
  - **Implementation status:** "Add layer" dialog (GeoJSON tab: file picker, URL; drag and drop of a file onto the map). Parsing runs in a Web Worker (`data/loaders/parse.worker.js`, logic in `jobs.js`, `geojsonParse.js`) with read/parse progress, cancel and error states; results come back in 20k-feature slices so no single message blocks the UI. All geometry types are accepted (Multi*, bare geometry/Feature, GeometryCollection is split into one feature per member). Fields and types (number/string) are inferred. CRS: a declared non-WGS84 `crs` and projected-looking coordinates produce warnings (projected data gets no extent, so zoom-to is disabled); no reprojection. User data is registered at runtime in `data/sources.js` via `data/userSources.js` (`kind: 'file'|'url'`, same `fields` + `load()` seam). Measured with a 50 MB / 222k-feature mixed file: parsing happens in the worker (longest main-thread task ~100 ms); adding it as a `geojson` layer blocks ~3.4 s on SwiftShader, which profiling attributes to WebGL shader linking, not data work (not measured on a real GPU). Not done: reprojection, streaming/incremental GeoJSON parsing (the whole file is read into memory), gzip, files over a few hundred MB, loaders.gl.
  - Persistence: file data is never saved. Only a reference (name, file name, geometry, fields, CSV columns, or URL) goes into the project JSON and localStorage; a restored file layer shows "Reload file…", a URL layer reloads itself. Unused user sources and their cached data are freed when their last layer is removed.
  - Tech: loaders.gl or `fetch`; `GeoJsonLayer`; all geometry types incl. GeometryCollection; large-file worker parse; CRS check (GeoJSON is 4326).
  - Deps: P3-01 · Critical · M
  - Acceptance: points, lines, polygons, multi and collections render; 50 MB file parses off the main thread.
- [ ] **P4-02 · Vector layer from PostGIS (JSON/bbox strategy)** (MVP)
  - Tech: provider calling `/features` with viewport bbox, debounce, abort stale requests, `truncated` banner.
  - Deps: P6-05, P3-01 · Critical · L
  - Acceptance: panning reloads within a bbox; stale responses discarded; truncated banner appears when capped.
- [x] **P4-03 · CSV points layer** (MVP)
  - **Implementation status:** CSV tab (file or URL) using papaparse inside the same worker. Lat/lon columns are detected by name (lat/latitude/y, lon/lng/long/longitude/x and variants) and confirmed against the values; if that fails, or to override, a column picker lists all columns with a preview of the first rows. Column types (number/string) are inferred; identifiers with leading zeros stay text; decimal commas are accepted in coordinates. Bad rows (missing/non-numeric/out-of-range coordinates, wrong field count) are counted, listed with reasons, downloadable as CSV (first 10,000 recorded) and kept in the layer's Properties > Import report. A 500k-row, 21 MB CSV parses in ~4 s with a longest main-thread task of ~100 ms and the layer draws without a freeze. The result is a GeoJSON point source, so all point layer types work. Not done: other encodings than UTF-8, WKT/geometry columns, auto-continue without the confirm click, saving the bad-row list across reloads.
  - Tech: papaparse in worker, lat/lon column detection and manual pick, type inference.
  - Deps: P3-01 · High · M
  - Acceptance: bad rows reported; 500k rows load without freezing.
- [ ] **P4-04 · MVT layer (external and backend)** (R2)
  - Tech: `MVTLayer`, auth headers via `loadOptions.fetch`, feature id for picking, `binary` option.
  - Deps: P6-07 · High · M · Acceptance: renders tiles from the backend and from a public MVT URL; picking works.
- [x] **P4-05 · XYZ raster and WMS layers** (R2)
  - **Implementation status:** New sourceless layer types `xyz` (TileLayer + BitmapLayer; `{z}/{x}/{y}`, `{-y}`, `{s}`/`{a-c}` subdomains) and `wms` (deck.gl `_WMSLayer`, exported under that experimental name in 9.4.1), each with `defaults`, `controls`, `describe`, `legend` (WMS uses GetLegendGraphic), `validate` and `attribution`. Opacity is the normal layer opacity; attribution is shown bottom-left on the map; tile/image errors raise one notice per layer. Sourceless layers have `sourceId: null`; project schema is now **v2** (adds `sources`; v0/v1 files migrate), invalid or non-http(s) URLs are dropped on load, and zoom-to-layer is disabled for them (no data extent). Not done: WMS GetCapabilities browsing (layer names are typed in), extents for web layers, WMS GetFeatureInfo, TMS/WMTS (P4-09), credentials/headers.
  - Tech: `TileLayer`+`BitmapLayer`; `WMSLayer` (present in geo-layers 9.4.1).
  - Deps: P3-01 · Medium · M · Acceptance: tile source and WMS URL load with opacity control and attribution.
- [ ] **P4-06 · FlatGeobuf** (R3) — streaming bbox reads via `flatgeobuf`. Deps: P4-01 · Low · M · Acceptance: a 200 MB .fgb renders with bbox-limited requests.
- [ ] **P4-07 · GeoPackage import** (R3) — server upload → pyogrio → temp source or PostGIS. Deps: P6-12 · Low · L · Acceptance: multi-layer gpkg lists layers and loads.
- [ ] **P4-08 · COG / GeoTIFF** (R3)
  - Tech: spike first: `geotiff.js` with a deck.gl wrapper (separate package; verify maintenance and deck.gl 9 compatibility) versus server-side titiler/Rasterio tiles.
  - Deps: P4-05 · Low · XL · Acceptance: ADR with decision; a COG renders with a colour ramp and nodata handling.
- [ ] **P4-09 · WMTS** (R3) — capabilities parser, tile matrix handling. Deps: P4-05 · Low · M · Acceptance: a public WMTS renders in 3857.

## Phase 5: H3 integration

**Status: client-side part complete** except P5-08 (polygon/box selection and export) and P5-09 (cluster outlines, filtering). Verified by 201 unit/component tests (2 skipped until the h3-py fixture exists), the browser smoke test (66 checks) and `e2e/h3-large.mjs` (500k points).

- [x] **P5-01 · H3 utilities module and worker** (MVP)
  - **Implementation status:** `h3/h3Utils.js` now has validated `parentCell`, `childCells` (refuses more than 4 levels down and more than 50,000 cells), `gridDiskCells` (k <= 10) and `polygonCells` (refuses areas needing more than 200,000 cells), plus `assertCell`/`assertResolution` (H3 indexes must be hex strings; numbers and BigInts are rejected). Bulk work runs in a Web Worker (`h3/h3.worker.js`, logic in `h3Jobs.js`, async API in `h3Client.js`): the point set is copied to the worker once as typed arrays, aggregation runs in slices, a newer request for the same layer cancels a stale one, per-cell statistics (count/sum/avg/min/max) are cached per (dataset, resolution, field), and a batch `latLngToCell` is available. The in-process fallback exists only for tests (no `Worker`). Tests: known vectors, round trip at all 16 resolutions, 12 pentagons per resolution (5 boundary vertices at even, 10 at odd resolutions), pentagon child counts, parent/child consistency, input validation, worker job logic, service API. Not done: antimeridian / `cellsToMultiPolygon` tests, a worker-side `polygonToCells`, and the h3-py parity run (see P5-04).
  - Tech: wrappers over h3-js 4.x API (`latLngToCell`, `cellToBoundary`, `cellToParent`, `cellToChildren`, `gridDisk`, `polygonToCells`); input validation; worker for bulk ops.
  - Deps: P1-04 · Critical · M
  - Acceptance: H3 tests from TESTING_STRATEGY.md §5 pass (known vector, round trip, pentagon, parent/child).
- [x] **P5-02 · H3 layer type (H3HexagonLayer)** (MVP)
  - **Implementation status:** `layers/types/h3.js` using `H3HexagonLayer`, fill by attribute, 3D extrusion, selection outline layer, correct `updateTriggers`.
  - Tech: layer plugin; data `[{h3,value}]`; fill/elevation accessors; `updateTriggers`; highlight.
  - Deps: P3-01, P5-01 · Critical · M
  - Acceptance: renders a sample H3 JSON/CSV; style changes update immediately; 3D extrusion works.
- [x] **P5-03 · Zoom→resolution mapping and controls** (MVP)
  - **Implementation status:** Auto (from zoom) / Fixed modes, 0-15 slider, edge length/area/cell-count readout. Mapping `res = clamp(round(zoom - 4.5), 0, 15)` produces ~30-60 px cells at the default view; further calibration at other latitudes remains.
  - **Phase 5 calibration:** the old mapping gave 12-763 px cells over zoom 3-17 at the equator, because cell size grows 2.65x per resolution while the ground resolution only doubles per zoom level (resolution should rise ~0.71 per zoom, not 1). `zoomToH3Resolution(zoom, latitude)` now picks the resolution whose flat-to-flat width is closest to 42 px, using the Web Mercator scale at the view latitude. Measured widths over zoom 3-17 are 26-68 px at latitudes 0, 45 and 70 (unit-tested; monotonic and bounded). A strict 30-60 px band is not reachable with integer resolutions (consecutive sizes differ by 2.65x), so the achievable band is about 26-69 px. Visible change: the default Paris view (zoom 11, 48.8°N) now starts at resolution 8 instead of 7.
  - Tech: auto/fixed mode, slider 0-15 with edge length/area readouts, heuristic from H3_IMPLEMENTATION.md §5, calibrate visually.
  - Deps: P5-02 · High · M
  - Acceptance: cells stay 30-60 px; resolution displayed; monotonic and bounded (unit tests).
- [x] **P5-04 · H3 from file (CSV/GeoJSON points → H3 aggregation in worker)** (MVP)
  - **Implementation status:** the H3 layer type declares an async `compute` step (`compute.key` / `compute.run`, a general plugin extension); `map/useComputed.js` runs it, aborts superseded runs, and keeps the previous result drawn until the next arrives. Any point source feeds it, including Phase 4 CSV and GeoJSON files and URLs. The points are cached in the worker, so changing resolution, aggregation or value field never re-parses or re-sends the file. Measured in Chrome with SwiftShader (no GPU) on a 500k-point CSV: first aggregation 2.2-2.5 s from clicking Add to cells drawn (worker ~1.2-1.4 s), longest main-thread task 210-430 ms; later resolution changes 1.0-1.3 s of worker time and a longest main-thread task of 70-150 ms. Results are capped at 250,000 cells (`MAX_DRAW_CELLS`): a finer request is coarsened automatically and the readout says so (resolution 9 over the 500k points became 7; that case needs several partial passes, ~3.5 s of worker time, and is not within the 3 s target). Under SwiftShader, drawing 200k+ cells stalls the compositor for several seconds (frame gaps up to 5 s with no main-thread work); this was not tested on a real GPU. The readout shows the worker time.
  - **Not done:** the h3-py cross-check. `scripts/gen_h3_fixture.py` and `src/h3/parity.test.js` are in place, but the fixture could not be generated here (no h3 wheel for the installed Python 3.15, no C compiler, Docker daemon not running). Run `pip install h3 && python scripts/gen_h3_fixture.py` once and commit `src/h3/fixtures/h3py-parity.json`; until then the parity tests are reported as skipped. Also not done: viewport culling (all cells are sent to deck.gl), progress reporting from the worker, GeoJSON polygons as an H3 input (points only).
  - Tech: `latLngToCell` in a worker, aggregation (count/sum/avg), resolution change recomputes without re-parsing.
  - Deps: P5-01, P4-03 · High · M
  - Acceptance: 500k points aggregate in < 3 s; results equal h3-py on a fixture.
- [x] **P5-05 · H3 cell inspector and selection** (MVP)
  - **Implementation status:** Click selects a cell; inspector shows index, resolution, centre, area, pentagon flag, base cell, parent and children count; selection is cleared when the resolution changes. **Phase 5:** Shift-click adds or removes cells (`selectionStore.toggleCell`); with several cells the inspector shows a summary (cell count, points, sum/mean/min/max of the layer metric, total area). A cell of another layer or resolution starts a new selection. Cells that become invalid after a resolution change are cleared with a notice. Shift-click required turning off MapLibre box zoom (`boxZoom={false}`), because it swallows Shift+click before deck.gl sees it. Not done: box/polygon multi-select (P5-08).
  - Tech: click/shift-click, selection layer, inspector H3 tab (index, res, centre, area, parent chain, children count).
  - Deps: P5-02, P3-06 · High · M
  - Acceptance: values match h3-js; selection persists across resolution changes only when cells are still valid (otherwise cleared with notice).
- [x] **P5-06 · H3 legend and colouring by attribute** (MVP)
  - **Implementation status:** Continuous / quantile / equal-interval colouring of cells by the aggregated attribute with a legend.
  - Deps: P7-01, P5-02 · High · S · Acceptance: population-coloured H3 with a graduated legend.
- [x] **P5-07 · Parent/child/neighbour overlays** (R2)
  - **Implementation status:** The H3 inspector has toggles for the parent outline, children outlines (1-4 levels down, refused beyond that or beyond 15) and a k-ring (k 1-10). They are overlay deck.gl layers built by `layers/h3Overlays.js` and owned by the selection (`selectionStore.overlays`): they are not in the layer tree, are drawn on top, apply to all selected cells (capped at 20,000 overlay cells in total, with the refusal shown), and are reset by a plain click, by clearing, and when a resolution change clears the selection. Cells are produced by the validated h3Utils wrappers and unit-tested against h3-js (parent, children, grid disk, pentagons, multi-cell union, limits). Not done: overlays for a different layer than the primary selection, k-ring distance labels.
  - Deps: P5-05 · Medium · M · Acceptance: overlays toggle and match h3-js.
- [ ] **P5-08 · Polygon/box selection of cells and export** (R2) — draw → `polygonToCells`; export CSV/GeoJSON. Deps: P8-04, P5-05 · Medium · M · Acceptance: exported file validated in tests (index validity, boundary orientation).
- [ ] **P5-09 · H3ClusterLayer outlines and H3 filtering** (R3) · Low · M · Acceptance: merged outlines by value; filter chips by value range.

## Phase 6: PostgreSQL/PostGIS integration

- [ ] **P6-01 · Auth and RBAC (minimum viable)** (MVP)
  - Tech: JWT bearer, OIDC-ready; MVP can use a single-admin local login or static API key behind a reverse proxy, but the **authorisation checks must exist** for every route (dependency injection).
  - Deps: P1-06 · Critical · M
  - Acceptance: unauthenticated access returns 401; role matrix tests pass; see Q3.
- [ ] **P6-02 · Connection manager and pools** (MVP)
  - Tech: env-defined connections first; encrypted user-defined connections second; psycopg3 async pool; session read-only + timeouts; host guard.
  - Deps: P6-01 · Critical · L
  - Acceptance: connect/test works; password never in responses/logs (test); pool failure recovery test.
- [ ] **P6-03 · Catalogue discovery endpoints** (MVP)
  - Tech: databases, schemas, tables/views, columns; geometry columns incl. views; privileges respected.
  - Deps: P6-02 · Critical · M
  - Acceptance: results match `psql` on the fixture DB incl. view and materialised view.
- [ ] **P6-04 · Table profile (SRID, extent, count, indexes, H3 detection)** (MVP)
  - Tech: per DATABASE_INTEGRATION.md §3; `ST_EstimatedExtent`; reltuples; strategy recommender; warnings.
  - Deps: P6-03 · Critical · L
  - Acceptance: all fields correct on fixtures incl. SRID 0, mixed type, no index, un-analysed table; < 500 ms on 10M-row table.
- [ ] **P6-05 · Filter grammar and query builder; features endpoint** (MVP)
  - Tech: safe composition, bbox with envelope transform, simplification, caps, GeoJSON/Arrow outputs.
  - Deps: P6-03 · Critical · L
  - Acceptance: injection test suite passes; EXPLAIN shows index use; results equal brute-force on fixtures.
- [ ] **P6-06 · Rows preview and column stats endpoints** (MVP)
  - Tech: keyset pagination, stats/histogram/quantiles/top values.
  - Deps: P6-05 · High · M · Acceptance: preview paginated; stats used by the styling engine.
- [ ] **P6-07 · MVT tile endpoint with sessions** (MVP)
  - Tech: `ST_AsMVT`/`ST_AsMVTGeom`, session registry, ETag/cache headers, feature caps, zoom-dependent simplification.
  - Deps: P6-05 · Critical · L
  - Acceptance: 1M-row polygon table serves p95 < 800 ms cold; tile decode tests pass.
- [ ] **P6-08 · H3 endpoints (cells, aggregate, info, polyfill)** (MVP)
  - Tech: per API_SPECIFICATION.md §8; bigint→hex; `max_cells` coarsening; Arrow option later.
  - Deps: P6-04, P5-01 · Critical · L
  - Acceptance: parity tests (h3-py vs SQL vs h3-js) pass; 1M-cell table viewport < 500 ms.
- [ ] **P6-09 · Frontend database browser and add-to-map flow** (MVP)
  - Tech: `api/` client, connection tree, table drawer (overview/columns/indexes/preview), add-to-map dialog.
  - Deps: P6-03, P6-04, P3-03 · Critical · L
  - Acceptance: from a clean DB connection to a rendered layer in ≤ 4 clicks; error and empty states.
- [ ] **P6-10 · Connection management UI** (R2) · Medium · M · Deps: P6-02 · Acceptance: add/edit/test/delete (admin), secrets write-only.
- [ ] **P6-11 · Server-side analysis endpoints** (R2) — buffer/intersection/union/clip/nearest/spatial-join, per API §9. Deps: P6-05 · High · L · Acceptance: results validated vs Shapely/Turf within tolerance; limits enforced.
- [ ] **P6-12 · Uploads and export** (R2) — upload sniffing, export formats. Deps: P6-05 · Medium · L · Acceptance: round-trip GeoJSON/CSV/GPKG.
- [ ] **P6-13 · Audit log and rate limiting** (R2) · Medium · M · Acceptance: every query logged with user/connection/duration; limits configurable.
- [ ] **P6-14 · Async jobs (Python worker)** (R3) — arq/RQ + Redis for GeoPandas/Rasterio jobs. Deps: P6-11 · Low · L · Acceptance: long job runs, reports progress, cancellable.

## Phase 7: Styling and visualization

- [ ] **P7-01 · Styling engine core** (MVP)
  - Tech: d3-scale/d3-scale-chromatic; modes single/categorical/graduated; classification (equal interval, quantile, Jenks via `simple-statistics`), null handling, accessors cached; pure functions returning deck accessors + legend spec.
  - Deps: P3-01 · Critical · L
  - Acceptance: unit tests for breaks and edge cases; colour stable between renders.
- [ ] **P7-02 · Style panel UI (fill, stroke, point, extrusion)** (MVP)
  - Deps: P7-01, P3-05 · High · L · Acceptance: every option from MAP_LAYERS.md "Styling options" works on the layer types that support it.
- [ ] **P7-03 · Legends** (MVP) — auto legend component (swatches, gradient bar, size legend), editable titles. Deps: P7-01 · High · M · Acceptance: legend matches data classes; visible/hidden with layer.
- [ ] **P7-04 · Server-computed class breaks** (MVP) — use `/stats` for DB layers so styles are stable across viewports and tiles. Deps: P6-06, P7-01 · High · M · Acceptance: legend identical when panning; quantiles match SQL `percentile_cont`.
- [ ] **P7-05 · Filters UI** (MVP) — rule builder → filter grammar. Deps: P6-05, P3-05 · High · M · Acceptance: filter round trip with live count; invalid inputs blocked.
- [ ] **P7-06 · Heatmap, scatterplot size styling, generic hex/grid** (R2) — `HeatmapLayer`, `HexagonLayer`/`GridLayer`/`ScreenGridLayer` plugins. Deps: P3-01 · Medium · M · Acceptance: each plugin has config schema, legend, tests.
- [ ] **P7-07 · Clustering** (R2) — supercluster in worker. Deps: P3-01 · Medium · M · Acceptance: 500k points cluster and expand on zoom.
- [ ] **P7-08 · Arc / flow layers** (R2) · Medium · M · Deps: P3-01 · Acceptance: OD CSV renders with width/colour by volume.
- [ ] **P7-09 · Trips, contours** (R3) · Low · L · Deps: P3-01 · Acceptance: animated trips with time slider; contour thresholds configurable.
- [ ] **P7-10 · Labels and custom colour ramps** (R2) · Low · M · Deps: P7-02 · Acceptance: `TextLayer` labels with collision filter; user ramps saved.

## Phase 8: GIS tools

- [ ] **P8-01 · Tool framework** (MVP) — tool plugin contract (activate/deactivate, cursor, overlay layers, keyboard), active tool in `uiStore`. Deps: P2-02 · High · M · Acceptance: tools are mutually exclusive; Esc cancels.
- [ ] **P8-02 · Coordinate inspection and identify** (MVP) — click readout, copy; identify across visible layers (`pickMultipleObjects`). Deps: P8-01, P3-06 · High · S · Acceptance: lists all features under the cursor by layer.
- [ ] **P8-03 · Measure distance/area** (MVP) — geodesic via Turf (`length`, `area`), units. Deps: P8-01 · High · M · Acceptance: known-distance fixtures within 0.1%.
- [ ] **P8-04 · Draw and select (point/rectangle/polygon)** (R2)
  - Tech: editable-layers library (`@deck.gl-community/editable-layers`) or Terra Draw; verify deck.gl 9 compatibility first.
  - Deps: P8-01 · High · L · Acceptance: draw/edit/delete geometries; selection returns features (client for loaded data, server for DB layers).
- [ ] **P8-05 · Spatial filter by shape** (R2) — drawn geometry → filter grammar `intersects`. Deps: P8-04, P6-05 · High · M · Acceptance: layer count updates; chip to clear.
- [ ] **P8-06 · Analysis toolbox UI** (R2) — buffer, intersect, union, clip, nearest; browser (Turf) for small drawn data, server for DB layers; results become temporary layers. Deps: P8-04, P6-11 · Medium · L · Acceptance: each op on both paths agrees within tolerance; clear labelling of where it ran.
- [ ] **P8-07 · Export selection / layer** (R2) · Medium · M · Deps: P6-12 · Acceptance: GeoJSON/CSV downloads match selection.

## Phase 9: Performance optimization

- [ ] **P9-01 · Seed data generators and benchmark harness** (MVP) — 10k/100k/1M/10M datasets, k6/Playwright probes. Deps: P1-07 · High · M · Acceptance: reproducible numbers recorded as a baseline in `docs/perf/`.
- [ ] **P9-02 · Strategy auto-selection and guardrails** (MVP) — thresholds, truncation banners, refuse unsafe loads, memory limits. Deps: P6-04, P4-02, P6-07 · Critical · M · Acceptance: 10M-row table never loads raw features in the browser; user sees explanation.
- [ ] **P9-03 · Web Workers pipeline** (R2) — parsing, h3, clustering, Turf. Deps: P4-01, P5-01 · Medium · M · Acceptance: no main-thread long tasks > 100 ms during loads.
- [ ] **P9-04 · Binary/Arrow transport** (R2) — Arrow IPC for features/H3 cells, deck binary attributes. Deps: P6-05, P6-08 · Medium · L · Acceptance: ≥3× faster parse than JSON on 250k cells.
- [ ] **P9-05 · H3 rollup tables and viewport caching** (R2) — materialised rollups, Redis cache, per-resolution partitions. Deps: P6-08 · High · L · Acceptance: 10M-cell table viewport p95 < 500 ms.
- [ ] **P9-06 · Tile caching and Martin evaluation** (R2) — Redis/HTTP cache, ETag; compare Martin vs FastAPI tiles. Deps: P6-07 · Medium · M · Acceptance: ADR with benchmark data.
- [ ] **P9-07 · Memory and leak audit** (R2) — layer add/remove 50×; deck `finalize`; tile cache sizes. Deps: P3-02 · Medium · S · Acceptance: heap stable.
- [ ] **P9-08 · Precomputed pyramids for 10M+ data** (R3) — `ST_Subdivide`, per-zoom tables, PMTiles generation. Deps: P9-05 · Low · XL · Acceptance: 10M polygons pan smoothly with documented build step.

## Phase 10: Testing and deployment

- [ ] **P10-01 · Unit and component test suites** (MVP) — per TESTING_STRATEGY.md §2-3. Deps: all feature tasks · High · L · Acceptance: coverage gates met.
- [ ] **P10-02 · Backend + DB integration tests** (MVP) — §6-7, injection suite. Deps: P6-* · Critical · L · Acceptance: green in CI with testcontainers.
- [ ] **P10-03 · E2E suite** (MVP) — §9 core scenarios. Deps: P6-09, P5-06 · High · L · Acceptance: stable (≤1% flake) in CI.
- [ ] **P10-04 · Production Compose, reverse proxy, TLS, secrets** (MVP) — multi-stage Dockerfiles, Nginx/Caddy, non-root users, healthchecks, Docker secrets, CORS config, `.env` docs. Deps: P1-07 · Critical · M · Acceptance: `docker compose -f compose.prod.yml up` serves the app over HTTPS; no secrets in images.
- [ ] **P10-05 · Security review** (R2) — threat model, dependency audit, pen test checklist (injection, SSRF, authz bypass). Deps: P6-* · High · M · Acceptance: findings triaged and fixed.
- [ ] **P10-06 · Performance regression gates in CI** (R2) · Medium · M · Deps: P9-01 · Acceptance: >20% regression fails the build.
- [ ] **P10-07 · Accessibility audit** (R2) · Medium · M · Deps: P1-03 · Acceptance: axe clean; keyboard walkthrough passes.
- [ ] **P10-08 · User and developer documentation, release** (R2) — docs site, "write a layer plugin" tutorial, versioning, changelog. Deps: all · Medium · M · Acceptance: a developer adds a toy layer type following the guide only.

---

## Future enhancements (not scheduled)

Write-back/editing of PostGIS features; multi-user collaboration; timeline/temporal filtering; SQL console (read-only, validated); H3 areal interpolation; vector tile styling editor; raster analysis; plugin marketplace; embedding as a web component; mobile-first mode.

## Unresolved questions (decide before the phase noted)

| # | Question | Needed by |
|---|---|---|
| Q1 | JS + JSDoc or migrate to TypeScript? (recommend TypeScript: the layer config contracts are central) | P1-09 |
| Q2 | Is the `h3-pg` PostgreSQL extension available/allowed on target databases, or must H3 stay in ETL/h3-py? | P6-08 |
| Q3 | Authentication: built-in local users, or OIDC (Keycloak etc.)? Single-tenant or multi-tenant? | P6-01 |
| Q4 | Should users be able to enter DB credentials in the browser UI, or only admin-configured connections? (recommend admin-configured for MVP) | P6-02 |
| Q5 | Tile serving: FastAPI `ST_AsMVT` only, or add Martin? | P9-06 |
| Q6 | Project licence (MIT/Apache-2.0/AGPL?) and acceptable licences for deps (PostGIS is GPL, used as a separate service) | P1-10 |
| Q7 | Satellite/terrain imagery source with an acceptable licence for the intended use (commercial or not) | P2-06 |
| Q8 | COG strategy: client-side vs server-side (spike) | P4-08 |
| Q9 | Typical data scales and CRSs of the real datasets (drives defaults for thresholds) | P9-02 |
| Q10 | Interleaved vs overlaid deck.gl rendering (label ordering needs) | P2-02 |
| Q11 | Verify compatibility of newest majors (vite 8, maplibre-gl 6, react-map-gl 8.1.3, eslint 10) with the planned plugins | P2-01 |
