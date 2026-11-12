# H3 Map: open-source GIS and H3 geospatial dashboard

A browser GIS workspace built on React, MapLibre GL JS, deck.gl and h3-js, with an optional FastAPI + PostGIS backend.

## Features

- QGIS-style layer tree: groups, drag and drop, per-layer properties, save/load of projects
- Eight layer types, including GeoJSON/CSV files and URLs, XYZ and WMS services
- Uber H3: points are binned in a Web Worker, with auto or fixed resolution, and a selection with parent / children / k-ring overlays
- PostGIS database layers (Phase 6): database browser, bbox-loaded features, MVT vector tiles and server-side H3 aggregation
- Admin-defined connections (`connections.yaml`) and encrypted user-defined connections with per-connection grants
- Runs on bundled sample data when no backend is available

The browser never connects to PostgreSQL and never sends SQL. The backend owns the credentials and builds queries from structured filters.

## Quick start (frontend only)

```bash
npm install
npm run dev     # http://localhost:5173
npm test        # unit and component tests (Vitest)
npm run lint
```

## With the database backend

Requires Python 3.12 and a PostGIS database. Run from `backend/`:

```bash
python -m venv .venv
.venv/Scripts/python -m pip install -e ".[dev]"     # see docs/BACKEND.md
cp .env.example .env                                # then fill in the values
.venv/Scripts/python -m uvicorn --factory app.main:app_factory --loop none --port 8000
```

`--loop none` is required on Windows. Then run `npm run dev`. Vite proxies `/api` to `VITE_API_PROXY` (default `http://localhost:8000`).

Sign in with `H3MAP_ADMIN_USERNAME` / `H3MAP_ADMIN_PASSWORD` from `backend/.env`.

| Variable | Purpose |
| --- | --- |
| `H3MAP_JWT_SECRET` | signs login tokens |
| `H3MAP_ADMIN_USERNAME`, `H3MAP_ADMIN_PASSWORD` | the single admin account (or `H3MAP_ADMIN_PASSWORD_HASH`) |
| `H3MAP_CONNECTIONS_FILE` | admin-defined connections (default `connections.yaml`) |
| `ANASTASIA_DB_PASSWORD` | password for the `gis_reader` user used by the `anastasia` connection (`password_env` in `connections.yaml`) |
| `H3MAP_APP_DATABASE_URL`, `H3MAP_ENCRYPTION_KEY` | both needed to enable user-defined connections; also run `alembic upgrade head` |

Admin-defined connections are read-only in the UI. Never put passwords in `connections.yaml`; reference an environment variable with `password_env`.

Backend tests (create and drop a scratch database `h3map_test`):

```bash
H3MAP_TEST_ADMIN_DSN=<superuser dsn> .venv/Scripts/python -m pytest
```

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Vite dev server on :5173 |
| `npm run build` / `npm run preview` | production build / preview |
| `npm test` | Vitest |
| `npm run test:e2e` | Playwright smoke test against a running app (needs WebGL) |
| `npm run e2e:stack` / `npm run test:e2e:db` | throwaway PostGIS stack and database scenario (written, not yet run) |

## Project layout

```
src/
  api/        fetch client, typed errors, in-memory session
  data/       data sources, file/URL loaders, PostGIS sources
  layers/     layer type plugins (layers/types/*), tree, project save/load
  state/      zustand stores
  map/        MapLibre + deck.gl integration
  h3/         H3 worker and helpers
  ui/         panels, dialogs, toolbar
backend/      FastAPI + PostGIS service (app/, alembic/, scripts/, tests/)
docs/         design documents
e2e/          end-to-end scenarios
```

Dependencies point one way: `ui -> state -> layers -> data/styling`.

## Documentation

- Setup and WSL2 notes: [docs/DEVELOPMENT_SETUP.md](docs/DEVELOPMENT_SETUP.md)
- Backend: [docs/BACKEND.md](docs/BACKEND.md) and [docs/API_SPECIFICATION.md](docs/API_SPECIFICATION.md)
- Database integration: [docs/DATABASE_INTEGRATION.md](docs/DATABASE_INTEGRATION.md)
- Architecture and deviations from the original design: [docs/SYSTEM_ARCHITECTURE.md](docs/SYSTEM_ARCHITECTURE.md)
- Roadmap: [docs/DEVELOPMENT_ROADMAP.md](docs/DEVELOPMENT_ROADMAP.md)
- Contributor and AI-agent guidance: [CLAUDE.md](CLAUDE.md)

Open-source stack only: no Mapbox or proprietary map SDK. Default basemaps are CARTO's public styles over OpenStreetMap data.
