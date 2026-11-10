# Development Setup

Works on Linux, macOS and Windows. The recommended Windows setup is **WSL2 Ubuntu** with the repository on the Linux filesystem.

## Requirements

- Node.js 20.19+ or 22.12+ (required by Vite 8; developed on Node 26) and npm 10+.
- A recent Chrome/Chromium for the end-to-end test (the unit tests do not need a browser).
- Internet access for the default basemap (CARTO public styles) unless you configure your own. Without it the app still runs: it falls back to a blank background and shows a notice.

## Run

```bash
cd h3-map
npm install
npm run dev          # http://localhost:5173
```

Other scripts:

| Command | Purpose |
|---|---|
| `npm run build` / `npm run preview` | production build / serve it |
| `npm run lint` | ESLint |
| `npm test` | Vitest unit and component tests (`npm run test:watch` to watch) |
| `npx vitest run src/layers` | run tests for one folder; add `-t "name"` to filter by test name |
| `npm run test:e2e` | Playwright-core browser smoke test against a running app |

End-to-end test:

```bash
npm run dev -- --port 5173 &        # or: npm run build && npm run preview
BASE_URL=http://localhost:5173 npm run test:e2e
# non-standard browser location:  CHROME_PATH=/usr/bin/chromium
```

Screenshots are written to `e2e/out/` (git-ignored). The test uses a software WebGL renderer (SwiftShader), so it works on machines without a GPU.

## Configuration

| Variable | Effect |
|---|---|
| `VITE_BASEMAP_LIGHT_STYLE`, `VITE_BASEMAP_DARK_STYLE` | MapLibre style URLs for the Light/Dark basemaps (e.g. a self-hosted tile server). Put them in `.env.local`. |
| `CHOKIDAR_USEPOLLING=true` | Poll for file changes (needed when the repo is on `/mnt/c` under WSL2). |

## WSL2 notes

1. Clone the repository **inside** the Linux filesystem (`~/projects/...`), not under `/mnt/c`: file watching and `npm install` are far faster and HMR works without polling.
2. Install Node via `nvm` or the NodeSource packages inside WSL, not the Windows Node.
3. The dev server listens on `localhost`; WSL2 forwards `localhost` ports to Windows automatically, so open `http://localhost:5173` in the Windows browser. Use `npm run dev -- --host` if you need to reach it from another machine.
4. If you must keep the repo on `/mnt/c`, run `CHOKIDAR_USEPOLLING=true npm run dev`.
5. For the e2e test inside WSL install a browser (`sudo apt install chromium` or Google Chrome) and set `CHROME_PATH`.
6. The code contains no OS-specific paths; imports are case-exact (checked), which matters on Linux.

## Project layout

```
src/
  app/        shell (Workspace), ErrorBoundary
  map/        MapView, DeckOverlay, basemaps, map actions, useDeckLayers (stores -> deck.gl bridge)
  layers/     registry, layer factory, buildDeckLayers, types/ (one file per layer type)
  data/       data-source registry (sources.js) and sample data generators (sample/)
  h3/         validated h3-js wrappers
  styling/    colour ramps and scales
  state/      Zustand stores
  ui/         panels and components
  lib/        pure helpers (geo, format, ids, search parsing)
e2e/          browser smoke test
docs/         design documents
```

## Adding a layer type

1. Create `src/layers/types/<name>.js` exporting a layer-type object (see the contract in `src/layers/registry.js`).
2. Register it in `src/layers/index.js`.
3. Add a case to `src/layers/layers.test.js`.

No change to the map or UI components is needed: the style panel is generated from the type's `controls`.
