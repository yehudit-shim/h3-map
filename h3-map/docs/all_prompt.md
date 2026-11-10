Poject: Open-Source GIS & H3 Geospatial Dashboard
Your role
Act as a Senior GIS Architect, Geospatial Software Engineer, and Full-Stack Developer.

Your task is to design a professional, modern, open-source geospatial mapping platform using React, deck.gl, MapLibre GL, H3, and PostgreSQL/PostGIS.

Before implementing anything, I want you to analyze the existing project and create a comprehensive technical specification and implementation roadmap.

Do not start implementing the application yet. First create the project documentation described below.

1. Project purpose
Build a powerful, reusable, interactive geospatial dashboard that combines traditional GIS capabilities with Uber H3 hexagonal spatial indexing.

The application should allow users to:

Display and explore geographic data.
Connect to PostgreSQL/PostGIS databases.
Browse database schemas and tables.
Load geographic tables directly onto the map.
Visualize points, lines, polygons, and raster datasets.
Display and analyze H3 hexagonal grids.
Perform spatial filtering and analysis.
Create custom map layers.
Configure visualization styles.
Inspect geographic features and their attributes.
Work with large geographic datasets efficiently.
The application should eventually become a complete geospatial analytics platform, not just a map viewer.

The application must be open source and avoid proprietary mapping dependencies.

2. Existing technology stack
The project has already been initialized using Vite and React.

Existing frontend dependencies include:

React
Vite
deck.gl
@deck.gl/core
@deck.gl/react
@deck.gl/geo-layers
@deck.gl/layers
MapLibre GL
react-map-gl
h3-js
Recommended additional technologies:

Frontend
React
JavaScript initially, with the option to migrate to TypeScript
Vite
Tailwind CSS
A modern component library
Redux Toolkit or Zustand for application state
Mapping and visualization
MapLibre GL JS
deck.gl
H3 JavaScript library
Turf.js for browser-side spatial operations
Backend
Evaluate and recommend:

Python
FastAPI
GeoPandas
h3-py
Shapely
Rasterio
GDAL where needed
Database
PostgreSQL
PostGIS
PostGIS spatial indexes
Support for H3 indexes stored as columns in database tables
Infrastructure
Docker
Docker Compose
Linux-compatible development and deployment
WSL2 Ubuntu development environment
All components should preferably have permissive open-source licenses.

3. Map functionality and layer architecture
Design a flexible layer system supporting the following categories.

A. Base map layers
Support configurable basemaps:

Light
Dark
Streets
Satellite
Terrain
Topographic
Blank map
Investigate open-source-compatible tile providers and the possibility of running our own tile server.

Keep basemap providers configurable.

B. Standard GIS layers
Support:

Vector layers
Point
MultiPoint
LineString
MultiLineString
Polygon
MultiPolygon
GeometryCollection
GIS data sources
PostgreSQL/PostGIS tables
GeoJSON
CSV with coordinates
GeoPackage
FlatGeobuf
Vector tiles (MVT)
WMS
WMTS
Raster layers
Cloud Optimized GeoTIFF (COG)
GeoTIFF
Raster tiles
XYZ raster tiles
Investigate which formats should be supported in the first release and which should be added later.

C. H3 layers
H3 must be a first-class capability, not just a generic hexagon visualization.

Support:

H3 hexagon grids.
H3 cells stored in PostgreSQL.
Visualization of existing H3 indexes.
H3 cells generated from point data.
H3 aggregation of geographic datasets.
H3 resolution selection from 0 to 15.
H3 cell boundaries.
H3 cell coloring based on database attributes.
H3 parent and child relationships.
H3 cell selection.
H3 cell inspection.
H3 resolution transitions.
H3 density visualization.
H3-based spatial statistics.
H3 grid filtering.
H3 cell export.
The user must be able to select a database table containing H3 indexes and display it directly.

Use deck.gl's H3HexagonLayer where appropriate.

Do not confuse deck.gl's generic HexagonLayer aggregation with actual Uber H3 indexing.

D. Analytical visualization layers
Support:

Heatmaps.
Point clustering.
Hexagon aggregation.
H3 choropleth.
Polygon choropleth.
3D extruded polygons.
3D H3 hexagons.
Scatterplots.
Arc layers.
Flow visualization.
Trips and movement visualization.
Contour layers.
Density maps.
Grid-based aggregation.
Investigate the appropriate deck.gl layer for each visualization.

E. GIS tools
Provide an extensible GIS toolbox:

Point selection.
Rectangle selection.
Polygon selection.
Draw points.
Draw lines.
Draw polygons.
Measure distance.
Measure area.
Coordinate inspection.
Feature identification.
Spatial filtering.
Buffer analysis.
Spatial intersection.
Spatial union.
Spatial clipping.
Nearest-neighbor analysis.
Clearly distinguish browser-side operations from operations that should run in PostGIS or Python.

4. PostgreSQL/PostGIS integration
Database connectivity is a core requirement.

The application must connect to PostgreSQL through a secure backend API. Never expose database credentials directly to the browser.

Design a database management interface that supports:

Adding database connections.
Managing connection configurations.
Listing databases.
Browsing schemas.
Browsing tables and views.
Discovering geometry columns.
Detecting geometry types.
Detecting coordinate reference systems (SRID).
Previewing table records.
Viewing table metadata.
Loading tables onto the map.
Selecting database columns for visualization.
Applying filters.
Querying geographic extents.
Pagination.
Spatial queries.
For every geographic table, the application should be able to discover:

Table name.
Schema name.
Geometry column.
Geometry type.
SRID.
Feature count.
Available attributes.
Spatial extent.
Available indexes.
Support both geometry-based tables and tables containing H3 indexes.

Investigate how to support large tables without loading every record into the browser.

Evaluate:

Server-side filtering.
Bounding-box queries.
Vector tiles.
GeoJSON responses.
PostGIS spatial indexes.
Pagination and aggregation.
5. Layer management interface
Design a professional layer manager.

Users should be able to:

Add layers.
Remove layers.
Rename layers.
Toggle visibility.
Reorder layers.
Change opacity.
Configure colors.
Configure line width.
Configure point size.
Configure fill color.
Configure extrusion height.
Select data columns for styling.
Configure filters.
Zoom to layer extent.
View layer metadata.
Duplicate layers.
Save layer configurations.
Each layer should have its own configuration and visualization settings.

Support multiple layers simultaneously.

6. Map interaction and user experience
Design a modern GIS-style interface.

The interface should include:

Main map
Full-screen interactive map.
Smooth zoom and navigation.
Pitch and rotation.
Layer rendering.
Feature selection.
Tooltips.
Context menus.
Left sidebar
Layer manager.
Data sources.
Database browser.
H3 controls.
GIS tools.
Right sidebar
Selected feature details.
Attribute information.
Layer styling.
Visualization configuration.
H3 cell information.
Top toolbar
Basemap selector.
Search.
Add data.
Add layer.
Drawing tools.
Measurement tools.
Export.
Settings.
Bottom status bar
Current coordinates.
Zoom level.
Map scale.
Active CRS.
Selected feature count.
The interface should be clean, modern, responsive, and visually polished.

Take inspiration from professional GIS applications such as QGIS, Kepler.gl, CARTO, and modern geospatial analytics platforms.

Avoid creating an interface that looks like a generic admin dashboard.

7. Data visualization and styling
Provide a flexible styling engine.

Users should be able to style geographic features using:

Single color.
Categorical values.
Numerical values.
Graduated colors.
Color ramps.
Size-based styling.
Height-based styling.
Transparency.
Custom legends.
Allow users to select a database attribute and visualize it on the map.

For example:

A PostGIS table contains:

h3_index
population
income
area
category
The user should be able to select population and color the H3 cells based on population values.

Include legends and visualization controls.

8. Performance and scalability
The architecture must support large geospatial datasets.

Investigate:

GPU-accelerated visualization with deck.gl.
Spatial indexing in PostGIS.
Server-side aggregation.
Viewport-based data loading.
Vector tile delivery.
Data caching.
Lazy loading.
Web Workers.
Efficient H3 rendering.
Memory management.
Do not load millions of records into the browser unnecessarily.

Explain the recommended architecture for datasets containing:

10,000 features.
100,000 features.
1 million features.
10 million or more features.
9. Security
Design secure database connectivity.

Include:

Backend-only database credentials.
Environment variables.
Read-only database connections where appropriate.
SQL injection protection.
Query validation.
Authentication and authorization architecture.
Secure API endpoints.
Input validation.
CORS configuration.
10. Documentation deliverables
Create a documentation directory:

docs/

Produce the following Markdown documents:

1. PROJECT_OVERVIEW.md
Explain:

Project purpose.
Main objectives.
Intended users.
Main capabilities.
Expected final product.
2. SYSTEM_ARCHITECTURE.md
Explain:

Frontend architecture.
Backend architecture.
Mapping architecture.
Database architecture.
Data flow.
Communication between components.
Technology choices.
Include Mermaid architecture diagrams.

3. MAP_LAYERS.md
Document:

All supported layer types.
Their intended purposes.
deck.gl layer implementations.
Data requirements.
Styling options.
Interaction behavior.
Development priority.
4. H3_IMPLEMENTATION.md
Document:

H3 architecture.
H3 database schema.
H3 resolution management.
H3HexagonLayer implementation.
H3 aggregation.
H3 querying.
H3 interaction.
Performance considerations.
5. DATABASE_INTEGRATION.md
Document:

PostgreSQL/PostGIS connectivity.
Database discovery.
Schema and table browsing.
Geometry discovery.
H3 column discovery.
Query architecture.
API endpoints.
Security.
6. UI_UX_DESIGN.md
Document:

Main application layout.
Sidebar structure.
Toolbar.
Layer manager.
Feature inspector.
Database browser.
H3 controls.
Design system.
Interaction flows.
Include Mermaid diagrams or ASCII wireframes where useful.

7. DEVELOPMENT_ROADMAP.md
Create a comprehensive implementation task list.

Organize tasks into phases:

Phase 1: Project foundation.

Phase 2: Map engine and basemaps.

Phase 3: Layer management.

Phase 4: Standard GIS layers.

Phase 5: H3 integration.

Phase 6: PostgreSQL/PostGIS integration.

Phase 7: Styling and visualization.

Phase 8: GIS tools.

Phase 9: Performance optimization.

Phase 10: Testing and deployment.

For every task include:

Unique task ID.
Description.
Technical requirements.
Dependencies.
Priority (Critical, High, Medium, Low).
Estimated complexity.
Acceptance criteria.
Use Markdown checkboxes so tasks can be tracked.

Identify MVP requirements separately from future enhancements.

8. API_SPECIFICATION.md
Document the planned backend API, including:

Endpoints.
HTTP methods.
Request parameters.
Response formats.
Error handling.
Database operations.
Spatial query operations.
H3 operations.
9. DATABASE_SCHEMA.md
Propose the database structure and examples for:

GIS geometry tables.
H3 tables.
Layer configurations.
Data source metadata.
User settings.
10. TESTING_STRATEGY.md
Define:

Unit testing.
Component testing.
GIS geometry validation.
H3 correctness tests.
API tests.
Database integration tests.
Performance tests.
End-to-end testing.
11. Important architectural requirements
Make these decisions explicit in your documentation:

Use MapLibre instead of Mapbox.
Use deck.gl for high-performance geographic visualization.
Use actual Uber H3 indexes and H3HexagonLayer for H3 functionality.
Use PostgreSQL/PostGIS as the primary spatial database.
Use Python/FastAPI for geospatial backend processing.
Keep database access exclusively on the backend.
Separate the map engine, layer system, data providers, and UI components.
Make layer types extensible so new GIS and visualization layers can be added without rewriting the map.
Design for Linux deployment and WSL2 development.
Prefer open-source dependencies and document their licenses.
If the current project structure conflicts with these requirements, document the proposed changes rather than making them immediately.

12. How I want you to work
Before writing the documentation:

Inspect the existing repository.
Inspect package.json and installed dependencies.
Understand the current project structure.
Identify what already exists.
Identify missing dependencies.
Identify potential compatibility issues.
Research appropriate deck.gl and MapLibre implementations where necessary.
Do not assume that a package or feature exists without checking.

Do not implement the application yet.

Do not install additional packages unless absolutely necessary for documentation.

Create all ten Markdown documents in the docs/ directory.

Make the documentation technically detailed enough that another developer or AI coding agent could implement the application without having to redesign its architecture.

At the end, provide:

A summary of the proposed architecture.
A list of important technical decisions.
The recommended MVP scope.
The complete prioritized implementation checklist.
Any unresolved architectural questions.
The exact first implementation task to start with.
The final result should be a professional engineering specification and an actionable development plan for a full-featured open-source GIS and H3 geospatial dashboard.












We are now moving from documentation to implementation.

Use the 10 documentation files in the docs/ directory as the source of truth for this project.

Before starting, review:

docs/PROJECT_OVERVIEW.md
docs/SYSTEM_ARCHITECTURE.md
docs/MAP_LAYERS.md
docs/DEVELOPMENT_ROADMAP.md
docs/UI_UX_DESIGN.md
Your task: Implement Phase 1 and Phase 2
Phase 1: Project foundation
Inspect the current repository and dependencies.
Establish the frontend application architecture.
Create a clean, scalable folder structure.
Configure the application layout and routing if required.
Establish a consistent UI design system.
Create reusable components.
Configure application state management.
Add proper error handling and loading states.
Ensure the application runs correctly in Linux/WSL2.
Phase 2: Map engine

Implement the actual interactive mapping application.

Requirements:

Use MapLibre GL JS as the map engine.
Use deck.gl for geographic visualization.
Do not use Mapbox or proprietary mapping SDKs.
Implement a responsive full-screen map.
Support light and dark basemaps.
Add zoom, rotation, pitch and navigation controls.
Add a map toolbar.
Add a left sidebar.
Add a right-side information panel.
Add a bottom status bar showing coordinates, zoom and CRS.
Support multiple visualization layers.
Implement a basic layer manager.
Initial map layers

Create an extensible layer architecture with support for:

PointLayer
LineLayer
PolygonLayer
ScatterplotLayer
HeatmapLayer
HexagonLayer
H3HexagonLayer
GeoJSONLayer

Use appropriate deck.gl layer implementations.

For the initial release, create sample data so we can test the map without a database.

H3 functionality

Implement a basic H3 demonstration:

Generate H3 indexes using h3-js.
Display actual H3 hexagons.
Add a resolution selector.
Allow users to click hexagons.
Display the selected H3 index and resolution.
Allow hexagon colors to be based on sample numerical data.

Do not confuse generic deck.gl HexagonLayer aggregation with actual H3 indexing.

Design requirements

Create a professional GIS interface inspired by QGIS, CARTO and Kepler.gl.

The interface should be:

Modern and visually polished.
Clean and intuitive.
Suitable for professional GIS users.
Responsive.
Consistent in spacing, typography, colors and icons.

Avoid a generic admin-dashboard appearance.

Engineering requirements
Keep components modular.
Separate map rendering from UI components.
Separate layer definitions from data sources.
Use reusable hooks and utilities.
Avoid hardcoded sample data inside visualization components.
Keep the architecture ready for PostgreSQL/PostGIS integration.
Do not introduce unnecessary dependencies.
Keep all implementation compatible with Linux.
Important workflow
Check the roadmap and mark completed tasks.
Implement Phase 1.
Test Phase 1.
Implement Phase 2.
Test Phase 2.
Fix all errors before finishing.
Update DEVELOPMENT_ROADMAP.md with completed tasks.
Document any architectural changes.

Do not start PostgreSQL integration or advanced GIS analysis yet.

At the end, provide:

Files created and modified.
Dependencies installed.
Features implemented.
Tests performed and their results.
Any remaining issues.
Instructions to run the application locally.

The application must actually run. Do not provide mock implementations or placeholder buttons for functionality claimed to be complete.







We have completed Phase 1 and Phase 2.

Now implement Phase 3: Advanced Layer Management.

Use the project documentation and DEVELOPMENT_ROADMAP.md as the source of truth.

Build a professional, reusable GIS layer management system.

Requirements:

Add, remove, duplicate and rename layers.
Toggle layer visibility.
Reorder layers through drag and drop.
Support layer groups and nested layers.
Configure opacity.
Configure fill and line colors.
Configure line width and point size.
Configure polygon extrusion.
Zoom to layer extent.
Display layer metadata.
Configure attribute-based styling.
Support layer selection and inspection.
Maintain independent configuration for every layer.
Save and restore layer configurations.
Support multiple active layers simultaneously.

Architecture:

Separate layer definitions from rendering.
Create a reusable layer registry.
Separate layer configuration from layer data.
Keep MapLibre and deck.gl rendering independent from UI components.
Use centralized application state.
Make the architecture extensible for future GIS and H3 layers.
Avoid hardcoded layer-specific UI logic.

Implement the layer manager UI with a professional GIS design inspired by QGIS and modern geospatial platforms.

Testing:

Test adding and removing layers.
Test visibility and ordering.
Test layer styling.
Test multiple simultaneous layers.
Test configuration persistence.
Ensure no regressions in Phase 1–2.

Update DEVELOPMENT_ROADMAP.md and document all completed work.

Do not begin Phase 4 or later.





❯ give me a prompt to pashe 4

  Searched for 1 pattern, read 1 file, ran 1 shell command
Loaded h3-map\CLAUDE.md

Paste this to start Phase 4. It covers the tasks that don't need the backend: P4-01, P4-03 and P4-05. P4-02 and P4-04 depend on the Phase 6 backend, and P4-07 and P4-08 depend on Phase 6 or later work.

Implement Phase 4 (Standard GIS layers) from h3-map/docs/DEVELOPMENT_ROADMAP.md, client-side only. Read CLAUDE.md, the Phase 4 section of the roadmap, and docs/SYSTEM_ARCHITECTURE.md first. Work on a new branch, phase-4-gis-layers, off the current branch.

Scope (there is no backend yet, so skip P4-02, P4-04, P4-07 and P4-08):
1. P4-01 Vector layer from a GeoJSON file or URL
   - Add a user-provided GeoJSON file (file picker and drag-drop onto the map) and URL as data sources. Register them in data/sources.js and keep the source seam: a source has `fields` and `load()` returning GeoJSON.
   - Parse in a Web Worker, so a 50 MB file does not block the main thread. Show progress and error states.
   - Support all geometry types, including Multi* and GeometryCollection. Infer fields and types from the properties. Check the CRS (GeoJSON is EPSG:4326) and warn on projected coordinates.
2. P4-03 CSV points layer
   - Use papaparse in a worker. Detect the lat/lon columns automatically, with a manual column picker if detection fails. Infer column types.
   - Report bad rows (count plus a downloadable or visible list). 500k rows must load without freezing the UI.
   - The result is a GeoJSON points source, so the existing layer types and styling work unchanged.
3. P4-05 XYZ raster and WMS layers

- Add unit tests for the parsers (GeoJSON geometry types, CSV column detection, bad rows), the new layer types, and the project.js migration/validation. Run `npm test` and `npm run lint`, and make both pass.
- Extend e2e/smoke.mjs to load a small GeoJSON and a CSV, and add an XYZ layer. Run `npm run test:e2e` against `npm run dev`.
- Run the app and check it in the browser: load a large generated GeoJSON (about 50 MB) and a 500k-row CSV, and confirm the UI stays responsive.

When done, update DEVELOPMENT_ROADMAP.md (mark the finished tasks with "Implementation status" notes in the same style as Phase 3 and say what is not done) and CLAUDE.md. Then commit with a "Phase 4: ..." message. Do not push.

If you want a different scope, such as only P4-01, tell me and I'll trim it.

✻ Brewed for 17s · done 11:53 AM

❯ what we build the backend?

  Searched for 1 pattern
Interrupted · What should Claude do instead?

❯ when we build the backend?

The roadmap puts the backend in Phase 6 (PostgreSQL/PostGIS integration). That is two phases from now, after Phase 4
(standard GIS layers) and Phase 5 (H3 integ

Phase 6 is a FastAPI backend, roughly in this order:
- P6-01 auth and RBAC
- P6-02 connection manager and pools
- P6-03 / P6-04 catalogue discovery and table profile
- P6-05 filter grammar, query builder and the /features endpoint
- P6-06 rows preview and column stats
- P6-07 MVT tile endpoint
- P6-08 H3 endpoints
- P6-09 frontend database browser

Why not earlier: Phases 4 and 5 are mostly frontend and have client-side parts you can finish without a backend. I scoped the Phase 4 prompt to those parts.

Phase 4 tasks that wait for Phase 6:
- P4-02 PostGIS vector layer, which needs P6-05
- P4-04 MVT layer, which needs P6-07
- P4-07 GeoPackage import, which needs P6-12

If you'd rather build the backend sooner, Its Phase 6 right after Phase 3. You'd thendo P4-02 and P4-04 after it. The cost is that the frontend-only work in Phases 4 and 5 gets delayed. Which order do you want?

✻ Brewed for 4s · done 11:56 AM

❯ and whats is pashe 5 prompt?

  Read 1 file

Paste this to start Phase 5. It assumes Phase 4 is done, because P5-04 needs the CSV loader from P4-03. I left out P5-08, which depends on the draw tools in Phase 8, and P5-09, which is low priority.

Implement the remaining Phase 5 (H3 integration) tasks from h3-map/docs/DEVELOPMENT_ROADMAP.md, client-side only. Read CLAUDE.md, the Phase 5 section of the roadmap, docs/H3_IMPLEMENTATION.md and the H3 section of
docs/TESTING_STRATEGY.md first. Work on a ne Phase 4 branch.

Scope:
1. P5-01 H3 utilities module and worker (fi
   - Add the missing wrappers in h3/h3Utils.js: cellToParent, cellToChildren (guard against huge fan-out), gridDisk and polygonToCells. Validate inputs.
   - Move bulk operations (latLngToCell ovento a Web Worker, exposed through a smallasync API. Keep main-thread fallbacks only where tests need them.
   - Add the H3 tests from TESTING_STRATEGYtrip, pentagon cells, parent/childconsistency.
2. P5-04 H3 from file (CSV/GeoJSON points -r)
   - Aggregate points to cells in the worker with count, sum and avg of a chosen field. Support a point-source layer feeding the H3 layer type (reuse the Phase 4 CSV and GeoJSON sources).
   - Cache the parsed points in the worker.ompute the aggregation without re-parsingthe file.
   - Targets: 500k points aggregate in under 3 s with the UI responsive. Cross-check results against h3-py on a small fixture (generate the fixture once with h3-py and commit the JSON, no Python needed at test time).
3. P5-07 Parent/child/neighbour overlays
   - From the H3 inspector add toggles for ren outlines (refuse when the resolutiondifference is more than 4) and a k-ring (k selectable, capped).
   - Draw them as overlay deck.gl layers owentries in the layer tree. Clear them whenthe selection or resolution changes. The cells must match h3-js output in tests.
4. Finish the P5-03 leftover: calibrate theseveral latitudes (0, 45, 70). Adjust it ifcells leave the 30-60 px range, and keep the unit tests for monotonic and bounded output.
5. Multi-select of H3 cells (shift-click) in the selection store and inspector. Show an aggregate summary when more
than one cell is selected. Keep the rule thotice when they become invalid after aresolution change.

Constraints:
- Follow CLAUDE.md: dependencies point one way (ui -> state -> layers -> data/styling), the H3 layer stays distinct from layers/types/hexagon.js, H3 indexes are always hex strings, use h3-js v4 names, put inputs to deck accessors in
updateTriggers and anything affecting prepae layer config shape changes, bumpSCHEMA_VERSION in layers/project.js and add a migration.
- No new dependencies unless justified.
- Do not touch Phase 6 or later work.

Verification (do all of it):
- `npm test` and `npm run lint` pass, with .
- Extend e2e/smoke.mjs: load a CSV, aggregate it to H3, change the resolution, select cells and toggle overlays. Run `npm run test:e2e` against `npm run dev`.
- Check in the browser: a 500k-point file ae UI stays responsive while the worker runs.


  Searched for 1 pattern, read 1 file

Phase 6 is large, so I split it into two prompts: 6A builds the backend, 6B builds the frontend and finishes the rest. Paste 6A first.

Prompt 6A: backend

Implement the backend half of Phase 6 (PostgreSQL/PostGIS integration) from h3-map/docs/DEVELOPMENT_ROADMAP.md. Read these first: CLAUDE.md, the Phase 6 section of the roadmap, docs/API_SPECIFICATION.md, docs/DATABASE_INTEGRATION.md, docs/DATABASE_SCHEMA.md, docs/SYSTEM_ARCHITECTURE.md, docs/DEVELOPMENT_SETUP.md, docs/TESTING_STRATEGY.md and docs/H3_IMPLEMENTATION.md. Work on a new branch, phase-6a-backend, off the Phase 5 branch.

Scope, in this order (commit after each task):
1. Scaffolding (P1-06 leftovers if any): a FastAPI project in h3-map/backend/ with pyproject, config from env (pydantic-settings), structured logging that never logs secrets, and a docker-compose.yml with PostGIS (with the h3 extension if it is practical) plus the backend. Add a fixture database script with the tables the acceptance criteria need: points, lines and polygons, a view, a materialised view, an SRID 0 table, a mixed-geometry-type
table, a table with no spatial index, an unwith an H3 index column.
2. P6-01 Auth and RBAC (minimum viable): a JWT bearer with a single-admin local login. Every route gets its authorisation through dependency injection, even if the MVP has only roles admin and viewer. Tests: unauthenticated
-> 401, plus a role matrix test.ults must match psql on the fixture DB.
5. P6-04 Table profile: SRID, ST_EstimatedExtent, reltuples count, indexes, H3 column detection, a strategy recommender (JSON vs MVT vs H3) and warnings. Cover the SRID 0, mixed type, no index and un-analysed fixtures. It must take under 500 ms on a large table (generate a 10M-row table once to check this and report the number).
6. P6-05 Filter grammar, query builder and /features: build SQL only from a structured filter grammar with allow-listed identifiers (quoted with psycopg.sql), never string-built from client input. Support bbox with envelope transform, simplification, caps with a `truncated` flag, and GeoJSON output. Tests: an injection test suite, EXPLAIN shows index use, results equal a brute-force comparison on the fixtures.
7. P6-06 Rows preview (keyset pagination) and column stats (stats, histogram, quantiles, top values).
8. P6-07 MVT tile endpoint: ST_AsMVT/ST_AsMVTGeom, a session registry, ETag/cache headers, feature caps, and zoom-dependent simplification. Tile decode tests. Target p95 under 800 ms cold on a 1M-row polygon table; measure it and report the number.
9. P6-08 H3 endpoints: cells, aggregate, info and polyfill per API_SPECIFICATION.md §8. Convert bigint to hex strings, apply `max_cells` coarsening. Parity tests between h3-py, SQL and the frontend h3-js (a committed fixture is fine for the h3-js side).

Hard rules (from CLAUDE.md and the docs):
- The browser never connects to PostgreSQL and never sends SQL. The backend owns the credentials.
- Never concatenate client input into SQL. Use allow-lists and psycopg.sql.Identifier/Literal or bound parameters.
- Do not touch the frontend in this prompt.
- Follow the error format, pagination and vN.md. If you must deviate from the spec,write it down in SYSTEM_ARCHITECTURE.md §11.

Verification: backend tests run with pytestixture DB, and ruff plus a type check (mypyor pyright, whichever the docs choose) pass. Report the measured performance numbers and any acceptance criterion you could not meet. Update DEVELOPMENT_ROADMAP.md with "Implementation status" notes, add backend commands to CLAUDE.md, and commit as "Phase 6A: ...". Do not push.

Prompt 6B: frontend and the rest

Use this after 6A is done:

Implement the frontend half of Phase 6 and the Phase 4 tasks that were waiting for the backend. Read CLAUDE.md, the Phase 6 section of the roadmap, docs/API_SPECIFICATION.md, docs/DATABASE_INTEGRATION.md and docs/UI_UX_DESIGN.md first. Work on a new branch, phase-6b-frontend, off phase-6a-backend.

Scope:
1. api/ client in the frontend: a typed fetch wrapper with auth token handling, error mapping, AbortController support and a login screen.
2. P6-09 Database browser and add-to-map flow: connection tree, a table drawer (overview, columns, indexes, previewwith pagination) and an add-to-map dialog ttegy. From a clean connection to a renderedlayer in at most 4 clicks. Handle error and empty states.
3. P4-02 PostGIS vector layer (bbox strategy): a data source whose `load()` calls /features with the viewport bbox.Debounce, abort stale requests, discard staed` banner. Keep to the seam in CLAUDE.md:layer types only see GeoJSON plus field metadata.
4. P4-04 MVT layer: MVTLayer with auth headers via loadOptions.fetch, feature ids for picking, and the session-basetiles from the backend plus a public MVT UR
5. P5 server side: an H3 layer data source that calls the H3 aggregate endpoint for a viewport, with the existing resolution auto mode, and falls back to the client-side aggregation for small files.                               6. P3-07 finish: server-side save/load of l6A added the endpoints. If not, say so andskip it.                                                                                                           7. P6-10 Connection management UI (admin onme allows.
                                                                                                                   Rules: follow CLAUDE.md (the layer plugin sioning in layers/project.js with aSCHEMA_VERSION bump and a migration for the new source types, one-way dependencies, design tokens). Never store tokens or secrets in the project export or the localStorage layer tree.                                            
Verification: npm test and npm run lint pass with new tests (api client, stale-request handling, the add-to-map flow). Extend e2e/smoke.mjs against the docker-compose stack: log in, browse the fixture DB, add a table to the map, pan and see the bbox reload, add an MVT layer. Check it in the browser. Update the roadmap and CLAUDE.md and commit as "Phase 6B: ...". Do not push.                                                                                   
I haven't read the other docs in detail. The prompts rely on them for the exact API shapes, so the agent reads themitself. If you want, I can check them first
                                                                                                                     Worked for 22s · done 12:32 PM

❯ chek the files in @h3-map/docs\                                                                                    Listed directory h3-map\docs\

  Read 5 files, ran 1 shell command

I read API_SPECIFICATION, DATABASE_INTEGRATION, DEVELOPMENT_SETUP, SYSTEM_ARCHITECTURE and TESTING_STRATEGY. I did not read DATABASE_SCHEMA, H3_IMPLEMENTATIONIEW, MAP_LAYERS, IMPLEMENTATION_SUMMARY orTHE_PLAN_PROMPT. The prompts tell the agent to read those itself.                                                  
What I found that changes the prompts                                                                              
- Two tile URL shapes in the docs. DATABASE_INTEGRATION §4 shows /connections/{c}/tiles/{schema}/{table}/{z}/{x}/{y}.mvt. API_SPECIFICATION §7 uses sessions: POST                  /connections/{id}/tiles/sessions, then GE{y}.mvt. The same §4 text also says layerconfigs are registered as sessions. I follow the API spec, which wins.
- Test setup differs from my first draft. TESTING_STRATEGY says pytest with testcontainers (a postgis/postgis image  plus an h3-pg image for the extension patpose for tests. The fixture list is alsolarger than I had: a partitioned table, an H3 table in three storage forms, and permission-limited roles.
- Backend layout is already specified in SYSTEM_ARCHITECTURE §4 (app/api/v1, services/, db/, schemas/). It uses      Alembic and an app metadata schema.
- Rules that were not in my first draft:
  - Pydantic with extra='forbid' and bounds on every parameter.                                                      - Query cancellation when the client abor
  - The error envelope format.
  - A security test that scans logs for credentials.                                                                 - Writes must be impossible through every
- The MVP connection plan is env-defined connections, not user-entered credentials (DATABASE_INTEGRATION §2).
- SYSTEM_ARCHITECTURE §11 is where deviations from the docs get recorded.                                          - Frontend tests use MSW, which isn't insta

Implement the backend half of Phase 6 (PostgreSQL/PostGIS integration) from h3-map/docs/DEVELOPMENT_ROADMAP.md. Read these first, fully: CLAUDE.md, the Phase 6 roadmap section, docs/API_SPECIFICATION.md (the source of truth for routes, errors and validation), docs/DATABASE_INTEGRATION.md, docs/DATABASE_SCHEMA.md, docs/SYSTEM_ARCHITECTURE.md (§4 backend layout, §7 scale strategy), docs/TESTING_STRATEGY.md (§4-§7), docs/H3_IMPLEMENTATION.md. Work on a new branch, phase-6a-backend, off the Phase 5 branch.

Where docs disagree, follow API_SPECIFICATION.md (for example tiles use sessions: POST /connections/{id}/tiles/sessions, then GET /tiles/{sessionId}/{z}/{x}/{y}.mvt). Record any deviation in SYSTEM_ARCHITECTURE.md §11.

Build in h3-map/backend/ using the layout in SYSTEM_ARCHITECTURE §4 (app/main.py, config.py, auth/, api/v1/, services/, db/, schemas/). Stack: FastAPI, Pydantic v2 (extra='forbid', bounds on every numeric parameter), psycopg3 async pools, SQLAlchemy + Alembic for the `app` metadata schema only. Add docker-compose.yml (postgis, backend), a .env.example, and a README section in docs/DEVELOPMENT_SETUP.md.

Tasks, in order (commit after each; keep the tests green at every step):
0. Test harness: pytest + testcontainers with a postgis/postgis image. Deterministic fixtures in tests/fixtures and scripts/seed: points/lines/polygons in SRID 4326, 3857 and a local projection, SRID 0, a mixed-geometry column, a geography column, a view, a materialised view, a partitioned table, a table with no spatial index and no PK, an    un-analysed table, a permission-limited roltorage forms (bigint, text, h3index when the extension image is available). Plus large seeded datasets (100k, 1M rows) that are generated on demand, not committed.                                                                                                         1. P6-01 Auth/RBAC: JWT bearer, a single-ad/editor/admin, authorisation via dependencyinjection on every route (use a test that walks all routes and fails if one lacks an auth dependency, except /health). Tests: 401 without a token, role matrix, connection grants.
2. P6-02 Connections: env-defined connections first (connections.yaml/env, secrets from env). On connect: read-only, statement_timeout, idle_in_transaction_session_timeout, lock_timeout (DATABASE_INTEGRATION §2). One lazy pool per connection, host guard (SSRF), POST /connections/{id}/test. Tests: passwords never in any response or log (scan captured logs), pool recovery after the DB restarts. Encrypted user-defined connections only if everything else is done.
3. P6-03 Catalogue: databases, schemas, tables/views/matviews/partitioned/foreign, columns, geometry columns (geometry_columns plus the pg_attribute fallback for views). Privileges respected. Results must equal psql output othe fixtures.
4. P6-04 Profile: SRID, ST_EstimatedExtent with fallback, reltuples (handle -1), PK, indexes with a spatial-index flag, H3 candidate detection (H3_IMPLEMENTATION §4), recommendedStrategy (json/bbox/mvt/aggregate by               SYSTEM_ARCHITECTURE §7), and warnings (no ipes, stale stats). Measure the latency on a10M-row table and report it (target < 500 ms).                                                                     5. P6-05 Query builder and /features (+ POSres/{id}): the filter grammar fromDATABASE_INTEGRATION §4 with depth and node limits, identifiers verified against the catalogue and composed with   psycopg.sql.Identifier, values bound. BBox  never the column. Caps with truncated=true, simplification by zoom on the output, GeoJSON output (Arrow optional). Cancel the query when the client disconnects. Tests: an injection suite (quotes, "; DROP TABLE", unicode, identifier tricks), EXPLAIN asserts index use, property-based bbox vs brute-force ST_possible through every endpoint with aread-only role.
6. P6-06 /rows (keyset pagination, limit <= 1000), /stats (min/max/mean/stddev/quantiles/histogram/distinct/topValues), /extent.
7. P6-07 MVT: tile sessions, ST_AsMVT/ST_AsMVTGeom, 204 for empty tiles, Cache-Control and ETag, per-tile featurp, zoom-dependent simplification, TileJSOe tiles in tests and assert counts, ids,properties and geometry validity. Measure cold p95 on a 1M-row polygon table (target < 800 ms) and 50 concurrentle requests without pool starvation.
8. P6-08 H3: /h3/cells, /h3/aggregate, /h3/resolutions, /h3/polyfill, /h3/cells/info, /h3/cells/children (delta . Bigint to hex strings, maxCells coarsenon actually used. Parity test: the same 10kseeded points through h3-py, SQL (when h3-pg is available) and the frontend h3-js (commit the expected cell ids as a fixture).                                                                                                       
Hard rules:
- The browser never connects to PostgreSQL or sends SQL. No raw SQL from clients anywhere. Error responses use tvelope in API_SPECIFICATION §2 and never tials.
- Do not touch the frontend in this prompt.
- Out of scope: analysis endpoints, uploads/export, saved layers/projects endpoints, rate limiting, audit log, abs (they are R2 and R3).

Verification: pytest (with coverage, gate 80% on services), ruff and mypy pass. Run the Schemathesis contract teainst the OpenAPI schema if it installs c performance number and every acceptancecriterion you could not meet. Update the roadmap with "Implementation status" notes, add backend commands to CLAUDE.md, and commit as "Phase 6A: ...". Do not push.                                                          
Prompt 6B: frontend (revised)
                                                                                                                plement the frontend half of Phase 6 pluse waiting for the backend. Read CLAUDE.md,the Phase 6 roadmap section, docs/API_SPECIFICATION.md, docs/DATABASE_INTEGRATION.md (§3, §4), docs/SYSTEM_ARCHITECTURE.md (§3, §6, §7, §11), docs/UI_UX_DESIGN.md and docs/H3_IMPLEMENTATION.md first. Work on a new branch, phase-6b-frontend, off phase-6a-backend.

Scope:
1. api/ client: a fetch wrapper for /api/v1 with the bearer token, mapping of the error envelope to typed errorsortController support, and a login screenadata only, never secrets). Dev proxy for/api in vite.config.js. Add MSW for integration tests.
2. P6-09 Database browser and add-to-map: connection tree (connections > schemas > tables, with geometry/H3 badgble drawer (overview, columns, indexes, ple warnings including the suggested CREATEINDEX text), and an add-to-map dialog that preselects the recommendedStrategy. From a clean connection to a rendered layer in at most 4 clicks. Loading, empty and error states everywhere.                                           P4-02 PostGIS vector layer (bbox strateg) calls /features with the viewport bbox,debounced on move end, with stale requests aborted and stale responses discarded. A `truncated` banner offers the MVT strategy. Layer types still only see GeoJSON plus field metadata, per CLAUDE.md.                             P4-04 MVT layer: MVTLayer fed by POST ..arer token via loadOptions.fetch.headers,feature id picking, a click that fetches the full feature from GET .../features/{id}, and a public MVT URL as a second source. Delete the session when the layer is removed.                                                     H3 from the database: an H3 data source 3 table) or /h3/aggregate (point table) forthe viewport, using the existing auto resolution, and showing a notice when the server returned a coarser resolution than requested.                                                                                                  P6-10 Connection management UI is optionctions are all the backend supports, skip it and say so.
                                                                                                                les:
- Follow CLAUDE.md: layer plugins, setTree() only, one-way dependencies (api/ is used by data sources, never by layers/), design tokens, accessible UI. A new source kind changes the config shape, so bump SCHEMA_VERSION in layers/project.js with a migration and tests.
- Tokens and secrets must never reach localStorage, the project export or logs. Saved projects keep only a connection id and table reference; if the connection is missing on import, the layer shows a clear "reconnect" state.
- Do not touch backend code except to report bugs you find.

Verification: npm test and npm run lint pass, with new tests for the api client (MSW), stale-request handling, the add-to-map flow and the project migration. Extend e2e/smoke.mjs to run against the compose stack: log in, browse the fixture DB, add a table, pan and see the bbox reload, add an MVT layer, add an H3 layer, then check the DB-down error state. Verify in the browser with a 1M-row table (MVT) and report the frame rate qualitatively. Update the roadmap (including P4-02, P4-04, P6-09 and any P3-07 server-side part that is now possible) and CLAUDE.md, and commit as "Phase 6B: ...". Do not push.

✻ Worked for 38s · done 12:35 PM
                                                                                                                  cap: You're building the h3-map GIS app pwritten revised Phase 6 prompts, 6A(backend) and 6B (frontend), after reading the docs. Next, paste 6A into a fresh session on a new branch. (disable recaps in /config)                                                                                              
❯ phase 6 is connect to the db?
                                                                                                                  s, mostly. Phase 6 connects the app to a but not directly from the browser.

- Backend (6A): A new FastAPI server connects to the database. It holds the credentials, lists schemas and tables, and runs queries read-only. The queries are built from structured requests (table, columns, filters, bbox) and never from SQL sent by the browser. It also serves GeoJSON, vector tiles and H3 cells.
- Frontend (6B): The browser talks only to that API. You pick a connection, browse its tables and click "add to map". The table then shows up as a layer

Phase 6 also adds login and roles, a table profile (row count, extent, indexes, SRID, warnings) and the logic that picks how to load each table: GeoJSON, tiles or H3, depending on its size.                                      
The app currently runs only on bundled sample data and user-loaded files. Phase 6 is where real database tables become layers.

To try it, you need a PostGIS database, eitcker one from the prompt. The firstconnections come from environment settings, not from a form in the UI.





The Phase 6B frontend is built and committed on phase-6b-frontend (458b488), but it has only been tested with a mocked backend. npm run lint and npm test pass (283 passed, 2 skipped). I did not run the browser checks against the real stack: e2e/db-scenario.mjs is written and was never run, and there was no 1M-row check, so I have no frame-rate observation to report.

No compose stack existed in the repo, so I added a throwaway one (e2e/docker-compose.yml, e2e/stack.mjs, e2e/README.md). It starts its own PostGIS on port 55432, seeds fixtures, and starts the backend and Vite. I brought it up once and confirmed the real API worked through the dev proxy, then stopped when you said to skip the test. You can start the stack again and run the scenario with npm run e2e:stack -- up --foreground and npm run test:e2e:db.

What was built

- API client: src/api/ wraps /api/v1 with the bearer token, typed errors from the error envelope, and AbortController support. The token lives in memory only, so a reload means signing in again. There is a login dialog and an account menu, connectionsStore holds metadata only, and the dev proxy for /api is in vite.config.js.
- Database browser (P6-09):
  - UI: a new "DB" tab with a connection > schema > table tree and geometry/H3 badges, a table drawer, and an add-to-map dialog.
  - Add-to-map: it preselects recommendedStrategy, and from a signed-in connection to a layer takes 3 clicks (open the connection, click +, then Add to map).
  - Drawer: it has overview, columns, indexes and a paginated preview, and shows the suggested CREATE INDEX text for tables without a spatial index.
  - States: loading, empty and error states throughout.
- PostGIS bbox layer (P4-02): the viewport is requested after the map stops moving. Stale requests are aborted and stale responses discarded. A truncated result shows a banner offering vector tiles.
- MVT layer (P4-04): the bearer token goes in headers, never the URL. Clicking a feature fetches the full feature by id. A public MVT URL works as a second source ("MVT URL" tab), and the tile session is deleted when the layer is removed or you sign out.
- H3 from the database: a new h3cells layer type reads /h3/cells or /h3/aggregate using the existing auto resolution. It shows a notice when the server returns a coarser resolution than requested.
- Connection management UI (P6-10): the backend does support user connections, so I built it rather than skipping. Add, edit, test and delete are there for admins; the password is write-only. There is no UI for per-connection grants.
- Projects: SCHEMA_VERSION is now 3 with a migration. Saved layers keep only an allow-listed reference (connection id, table, strategy, columns). If the session or connection is missing, the layer shows "Sign in to reconnect" or "Open the Database tab".

Things you should know

- P3-07: the server-side part is still not possible, because the backend has no /layers or /projects endpoints.
- Backend bug (not touched): the CORS allow_methods list omits PATCH and PUT. The connection edit and grants calls only work same-origin, which is why the dev proxy matters.
- Lint config: I made ESLint ignore backend/, because the local Python venv's bundled JS files were failing npm run lint.
- MVT picking: I did not check in a browser that picking by feature id works with deck's default binary MVT. The roadmap entry says so.
- Roadmap and CLAUDE.md: both are updated, and I marked P4-02, P4-04, P6-09 and P6-10 done with a note that the e2e and large-table checks were not run.

✻ Cooked for 1m 28s · done 5:01 PM