# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Current state

Phases 1-3, the client-side part of Phase 4 (GeoJSON/CSV files and URLs, XYZ and WMS layers) and the client-side part of Phase 5 (H3 worker, overlays, multi-select) of `docs/DEVELOPMENT_ROADMAP.md` are implemented: a working MapLibre + deck.gl workspace with a QGIS-style layer tree (groups, drag and drop, properties, save/load), eight layer types and a real H3 demo, running on bundled sample data. There is no backend, database, Docker setup or CI yet (Phase 6 and later). `docs/` is the source of truth for design. `docs/SYSTEM_ARCHITECTURE.md` §11 lists where the implementation deliberately differs from the original design. The roadmap marks which tasks are done.

The git root is the parent directory (`anastasia/`), not `h3-map/`.

## Commands

Run from `h3-map/`:

- `npm run dev` starts Vite on :5173. Use `--port N --strictPort` if 5173 is taken.
- `npm run build`, `npm run preview`, `npm run lint`
- `npm test` runs Vitest (jsdom). One file: `npx vitest run src/layers/layers.test.js`. One test: `npx vitest run -t "name"`.
- `npm run test:e2e` is a Playwright-core smoke test against a running app (`BASE_URL=http://localhost:5173`, `CHROME_PATH` if Chrome is not in a standard place). It needs WebGL, so it launches Chrome with SwiftShader flags.

## Architecture (the parts that span files)

Data flow: `LayerConfig` (plain JSON in `state/layersStore.js`) + loaded GeoJSON (`state/dataStore.js`, from the registry in `data/sources.js`) -> `layers/buildDeckLayers.js` -> deck.gl layers -> `map/DeckOverlay.jsx`. `map/useDeckLayers.js` is the only place the stores and the layer system meet. Do not import stores from `layers/` or sample data from layer types.

- **Layer types are plugins** (`layers/types/*.js`, registered in `layers/index.js`). Each supplies `defaults`, `controls` (schema from which `ui/StylePanel.jsx` generates the form), `prepareKey`/`prepare` (expensive derived data, memoised per layer by `prepareKey`), `createDeckLayers`, `describe` (tooltip and inspector), `legend`. A new type needs no change to the map or UI. If a style input affects prepared data it must be part of `prepareKey`, and inputs to deck accessors must be in `updateTriggers`.
- **Layer tree**: `layersStore.tree` (layers and nested groups; pure operations in `layers/tree.js`) is the source of truth. `layersStore.layers` is a derived flat list (top first) that the store's `commit()` always updates. Never `setState({ layers })` directly; use `setTree()`. Index 0 is the top. The map draws `effectiveLayers(tree)` (bottom first, group visibility ANDed and opacity multiplied). Use effective visibility, not `layer.visible`, for anything that shows what is drawn.
- **Persistence**: the tree is auto-saved to localStorage (`h3map.layers`). Saved data and imported files go through `layers/project.js` (`schemaVersion` migrations + validation). Bump `SCHEMA_VERSION` and add a migration when the config shape changes.
- **Layer actions** (context menu, "More" button) come from one list in `ui/layerActions.js`. Add actions there, not per layer type.
- **Data sources** are the seam for PostGIS: a source has `fields` and `load()` returning GeoJSON. Layer types only know GeoJSON plus field metadata.
- **User data (Phase 4)**: files/URLs are parsed in a Web Worker (`data/loaders/`: `jobs.js` is the logic, `client.js` the worker client, pure parsers beside it) and registered at runtime by `data/userSources.js`. File data is memory-only; projects (schema v2) save just source references. Layer types with `sourceless: true` (`xyz`, `wms`) have `sourceId: null` and keep their service in `style`; `ui/layerActions.js` has `addParsedDataLayer`, `addWebLayer`, `reloadSourceFile`. The Add layer dialog is `ui/AddLayerDialog.jsx`. WMS is deck.gl's `_WMSLayer`.
- **H3**: `layers/types/h3.js` renders with `H3HexagonLayer`; points are binned with h3-js v4 in a Web Worker (`h3/h3.worker.js` -> `h3Jobs.js` logic, `h3Client.js` async API; points are cached in the worker, so resolution changes never re-send them). This is done through a plugin extension: a layer type may declare `compute: {key(config, ctx), run(config, data, ctx, {signal})}`; `map/useComputed.js` runs it and passes the newest result to `prepare` as `ctx.computed[layerId]` (the previous result stays drawn meanwhile; `prepare` falls back to a synchronous path when `ctx.computed` is absent, for tests). Results are capped at `MAX_DRAW_CELLS` (250,000) by coarsening, and `prepared.resolution` is the resolution actually used. Resolution is "auto" (`zoomToH3Resolution(zoom, latitude)`, which picks the resolution whose cells are closest to 42 px wide and is only re-evaluated when the integer changes) or "fixed". `h3/h3Utils.js` has the validated wrappers (`parentCell`, `childCells`, `gridDiskCells`, `polygonCells`) with fan-out guards; never call h3-js `cellToChildren`/`gridDisk` directly on user input. `layers/types/hexagon.js` is deck.gl's generic binning and is NOT H3; keep the two distinct in names and UI.
- Selection (`state/selectionStore.js`) stores the `describe()` result captured at click time. For H3 it holds `cells` (Shift-click adds/removes; deck.gl's click event has no modifier keys, so `useDeckLayers` remembers `shiftKey` from a capture-phase `pointerdown`, and MapLibre `boxZoom` must stay off or it swallows Shift+click) and the parent/children/k-ring `overlays`, which belong to the selection and are drawn by `layers/h3Overlays.js`, not as layer-tree entries. The selection is cleared, with a notice, when the layer's resolution changes. The h3-py parity tests (`src/h3/parity.test.js`) are skipped until `python scripts/gen_h3_fixture.py` has produced `src/h3/fixtures/h3py-parity.json`.
- Design tokens are CSS variables in `src/styles/index.css`, exposed to Tailwind v4 as `bg-panel`, `text-muted`, `border-line`, etc. Use these, not raw colours. Dark/light is `data-theme` on `<html>`.

## Gotchas

- MapLibre 6 needs its worker registered explicitly (`map/maplibreSetup.js`, `setWorkerUrl` with a Vite `?url` import); without it the basemap fails with "Worker failed to load". Keep that import in `MapView.jsx`.
- Use the `@deck.gl/maplibre` `MapLibreOverlay` (not `MapboxOverlay`, which the umbrella `deck.gl` package does not export). Import map components from `react-map-gl/maplibre`.
- h3-js is v4 (`latLngToCell`, `cellToBoundary`, `polygonToCells`); v3 names do not exist. H3 indexes are hex strings; never send them as JSON numbers.
- deck.gl 9.4.1 has no GeoTIFF/COG layer.
- Tailwind classes such as `hidden md:flex` lose to a base `flex` class on the same element; use `max-md:hidden` style variants.
- Imports must match file name case exactly (Linux). `eslint` enforces react-hooks rules strictly (no ref writes during render).

## Rules from the design docs

- The browser never connects to PostgreSQL and never sends SQL; the FastAPI backend (not yet built) owns credentials and builds queries from structured filters.
- Dependencies point one way: `ui -> state -> layers -> data/styling`.
