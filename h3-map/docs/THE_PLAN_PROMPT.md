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