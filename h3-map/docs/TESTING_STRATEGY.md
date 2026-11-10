# Testing Strategy

## 1. Tooling

| Layer | Frontend | Backend |
|---|---|---|
| Unit | Vitest (Vite-native) | pytest |
| Component | Testing Library (React) + Vitest `jsdom`/browser mode | n/a |
| Integration | Vitest + MSW (mock API) | pytest + testcontainers (PostGIS image) |
| E2E | Playwright (Chromium with WebGL via SwiftShader/`--use-gl=angle`) | Playwright against Compose stack |
| Performance | Playwright traces + custom frame-time probes | k6 / locust, `EXPLAIN (ANALYZE, BUFFERS)` |
| Static | ESLint (existing), Prettier, (tsc if TS adopted) | ruff, mypy |
| Coverage | v8 coverage via Vitest; gate at 70% for `layers/`, `styling/`, `data/` modules | pytest-cov; gate 80% on services |

CI (GitHub Actions or equivalent): lint → unit → integration (services: postgis) → build → E2E → image build. Dependency/licence scan (`license-checker`, `pip-licenses`) and `npm audit` / `pip-audit`.

## 2. Unit tests

Frontend: color ramps and class breaks (equal interval, quantile, natural breaks; edge cases: constant column, nulls, single class), legend generation, filter-to-request serialisation, layer registry (register/unknown/duplicate), layer factory (config → deck props; `updateTriggers` include all style inputs), viewport → H3 resolution mapping, store reducers (reorder, duplicate, rename, remove), coordinate/scale formatting, config migration functions.
Backend: filter grammar parser (valid/invalid/depth limit), query builder output (assert on composed SQL structure and bound params, never string-contains user input), SRID/bbox helpers, pydantic models, encryption round-trip, tile coordinate math.

## 3. Component tests

Layer manager (drag reorder, toggle, opacity, rename, keyboard operability), styling panel (changing mode shows correct controls, emits correct config), DB browser tree (loading/empty/error states with MSW), feature inspector (attributes, H3 tab), toolbar and basemap selector, status bar updates. Accessibility checks with `jest-axe`/`axe-core`.

The deck.gl/MapLibre canvas is **not** unit tested in jsdom; map behaviour is covered in E2E. Layer factories are tested by inspecting the produced deck.gl `Layer` instances' props (`layer.props`).

## 4. GIS geometry validation

- Geometry type coverage: Point, MultiPoint, LineString, MultiLineString, Polygon, MultiPolygon, GeometryCollection, with holes, empty geometries, Z/M dimensions.
- Invalid geometries (self-intersections, unclosed rings): API behaviour is defined (reject on input; `ST_MakeValid` option for analysis).
- CRS: round-trip 4326 ↔ 3857 ↔ a local projection within tolerance; tables with SRID 0, mismatched SRIDs, and geography columns.
- Antimeridian and poles: features crossing ±180°, bbox with `minLon > maxLon`.
- Turf vs PostGIS parity for buffer area, intersection, union within tolerance (geodesic vs planar differences are documented, not "fixed").
- MVT: decode tiles in tests (`@mapbox/vector-tile`/`mapbox-vector-tile`) and assert feature counts, ids, properties, extents, clipped geometry validity.
- Property-based tests (Hypothesis / fast-check) for bbox queries: result set equals brute-force `ST_Intersects`.

## 5. H3 correctness

- Known vectors: `latLngToCell(37.7749, -122.4194, 9) = '89283082803ffff'` (checked against h3-js 4.5.0).
- Round trip `cellToLatLng` → `latLngToCell` returns the same cell for resolutions 0-15.
- Parent/child: `cellToParent(child)` equals the original for all children; child count `7^Δ` (hexagons) and pentagon exceptions.
- Pentagons (12 per resolution): rendering input, boundary vertex count 5, child counts, `isPentagon`.
- Cells crossing the antimeridian: boundaries, `cellsToMultiPolygon`.
- Invalid input: bad strings, wrong length, resolution > 15, integers > 2^53 (bigint conversion path) never silently corrupted.
- **Parity**: the same 10k random points aggregated with h3-py (backend), SQL (`h3-pg` when present), and h3-js (browser) give identical cell ids and counts.
- Discovery heuristic: fixtures of tables (bigint, text, `h3index`, mixed resolutions, near-miss columns like `hexcode`) → expected detection and confidence.
- Resolution selection: zoom→res mapping monotonic, bounded to 0-15, `max_cells` cap triggers coarsening and reports the resolution used.
- Aggregation semantics: sum vs avg parent roll-up on constructed data with known results.
- Rendering smoke test in E2E: `H3HexagonLayer` draws N cells (read via deck `pickObject`/`queryObjects` or a screenshot comparison).

## 6. API tests

Contract tests generated from the OpenAPI schema (Schemathesis) plus handwritten tests per router: auth/role matrix (viewer/editor/admin, grants), validation errors (422 shapes), pagination and `truncated`, error envelope, content negotiation, rate limit, CORS preflight, tile endpoint status codes (200/204/404), request cancellation.
Security tests: SQL injection attempts in table/column/filter/value (e.g. `"; DROP TABLE`, quote/identifier tricks, Unicode), identifier not in catalogue → 404/422, oversize geometry/payload, timeouts, no credentials/DSN in any response or log (assert by scanning logs in tests), writes impossible (attempt through every endpoint with a read-only role).

## 7. Database integration tests

Spin up `postgis/postgis` (and an image with `h3-pg` for the extension path) in testcontainers, seed fixtures (points/lines/polygons in several SRIDs, mixed geometry column, a view, a materialised view, a partitioned table, an H3 table in three storage forms, a table without index/PK). Verify: discovery output (types, SRID, extent, indexes, PK, warnings), `reltuples` handling for un-analysed tables, bbox query correctness *and* index use (`EXPLAIN` asserts `Index Scan`/`Bitmap` on the GiST index for bbox queries), MVT output, aggregation, spatial analysis results, pool behaviour (exhaustion, reconnect after DB restart), permission-limited role sees only allowed schemas.
Alembic migrations: upgrade from empty and downgrade/upgrade cycle.

## 8. Performance tests

Seed datasets: 10k, 100k, 1M, 10M features (points and polygons) and H3 tables of 100k / 1M / 10M cells.

| Test | Target (initial, refine after baseline) |
|---|---|
| Bbox query p95 @100k, 1M, 10M rows (indexed) | < 300 ms / < 500 ms / < 1 s for a city-sized bbox |
| MVT tile p95 | < 200 ms warm, < 800 ms cold at 1M-10M |
| H3 aggregate p95 per viewport | < 500 ms with rollups |
| Browser: render 10k / 100k features, 250k H3 cells | ≥ 30 fps during pan/zoom on a reference laptop GPU; no main-thread task > 100 ms during load |
| Memory | JS heap < 500 MB after loading and panning for 5 min (no leak: repeated add/remove layer 50×) |
| Style change on 100k features | < 200 ms to next frame |
| Backend concurrency | 50 concurrent tile requests without pool starvation |

Regression: store results as CI artefacts and compare against the last main-branch baseline (alert on > 20% regression). Include `EXPLAIN` plans for key queries in the report.

## 9. End-to-end tests (Playwright)

Run against Compose (frontend, backend, PostGIS with seed data, offline basemap style with a local tile fixture so tests are network-independent).
Scenarios: load app → map visible; switch basemap; connect to DB → browse → add polygon table → style by attribute → legend visible; add H3 table → colour by `population` → hover tooltip value correct; change H3 resolution; select cells and export CSV (content verified); draw polygon → spatial filter → count changes; measure distance matches a known value; reorder/hide/remove layers; save and reload a project; error states (DB down). Visual regression on the legend, UI panels (not the WebGL canvas, or with tolerant thresholds). Cross-browser: Chromium required, Firefox/WebKit best effort.

## 10. Test data and environments

`tests/fixtures/` holds small GeoJSON/CSV/H3 samples; `scripts/seed/` generates large synthetic data deterministically (seeded RNG). WSL2 and Linux CI use identical Compose files. Secrets for tests are throwaway and never reused.
