# H3 Map: open-source GIS and H3 geospatial dashboard

React + MapLibre GL JS + deck.gl + h3-js. Phases 1-2 of the roadmap are implemented: a full-screen interactive map with a layer manager, eight layer types, a real Uber H3 demonstration and bundled sample data (no database needed yet).

```bash
npm install
npm run dev     # http://localhost:5173
npm test        # unit and component tests
npm run lint
```

- Setup, WSL2 notes and the e2e test: [docs/DEVELOPMENT_SETUP.md](docs/DEVELOPMENT_SETUP.md)
- Design and roadmap: [docs/](docs/) (start with `PROJECT_OVERVIEW.md` and `DEVELOPMENT_ROADMAP.md`)

Open-source stack only: no Mapbox or proprietary map SDK. Default basemaps are CARTO's public styles over OpenStreetMap data; see `docs/SYSTEM_ARCHITECTURE.md` §9 and §11.
