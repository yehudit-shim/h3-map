# Database Schema

Two parts: (A) the **application metadata** schema (owned by this app, managed with Alembic), (B) **example data tables** the app is designed to consume.

## A. Application metadata (`app` schema, PostgreSQL)

```sql
CREATE SCHEMA IF NOT EXISTS app;
CREATE EXTENSION IF NOT EXISTS pgcrypto;   -- gen_random_uuid() (built in from PG 13 anyway)

CREATE TABLE app.users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email         text UNIQUE NOT NULL,
  display_name  text,
  external_sub  text UNIQUE,              -- OIDC subject
  password_hash text,                     -- only for built-in auth (argon2id)
  role          text NOT NULL DEFAULT 'viewer' CHECK (role IN ('viewer','editor','admin')),
  is_active     boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_login_at timestamptz
);

-- Data source metadata: connections to user PostGIS databases
CREATE TABLE app.connections (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name            text UNIQUE NOT NULL,
  host            text NOT NULL,
  port            integer NOT NULL DEFAULT 5432 CHECK (port BETWEEN 1 AND 65535),
  database        text NOT NULL,
  username        text NOT NULL,
  password_enc    bytea,                  -- ciphertext only; key held outside the DB
  key_version     smallint NOT NULL DEFAULT 1,
  sslmode         text NOT NULL DEFAULT 'require',
  read_only       boolean NOT NULL DEFAULT true,
  max_pool_size   smallint NOT NULL DEFAULT 5,
  statement_timeout_ms integer NOT NULL DEFAULT 30000,
  origin          text NOT NULL DEFAULT 'user' CHECK (origin IN ('env','user')),
  created_by      uuid REFERENCES app.users(id),
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE app.connection_grants (
  connection_id uuid REFERENCES app.connections(id) ON DELETE CASCADE,
  user_id       uuid REFERENCES app.users(id) ON DELETE CASCADE,
  PRIMARY KEY (connection_id, user_id)
);

-- Non-DB data sources (WMS, WMTS, XYZ, MVT URL, COG, uploaded file)
CREATE TABLE app.data_sources (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id    uuid REFERENCES app.users(id),
  kind        text NOT NULL CHECK (kind IN
              ('postgis','geojson','csv','geopackage','flatgeobuf','mvt','wms','wmts','xyz','cog','geotiff')),
  name        text NOT NULL,
  uri         text,                         -- URL or storage key (never contains secrets; use secret_ref)
  secret_ref  text,
  connection_id uuid REFERENCES app.connections(id) ON DELETE SET NULL,
  metadata    jsonb NOT NULL DEFAULT '{}',  -- {schema, table, geometryColumn, srid, extent, columns, h3:[…]}
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE app.projects (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id   uuid NOT NULL REFERENCES app.users(id),
  name       text NOT NULL,
  basemap_id text NOT NULL DEFAULT 'light',
  view_state jsonb NOT NULL DEFAULT '{"longitude":0,"latitude":20,"zoom":2,"pitch":0,"bearing":0}',
  is_shared  boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Layer configurations
CREATE TABLE app.layers (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  uuid REFERENCES app.projects(id) ON DELETE CASCADE,
  owner_id    uuid NOT NULL REFERENCES app.users(id),
  name        text NOT NULL,
  type        text NOT NULL,                     -- layer plugin id: vector, h3, heatmap, …
  schema_version integer NOT NULL DEFAULT 1,     -- config migrations
  data_source_id uuid REFERENCES app.data_sources(id) ON DELETE SET NULL,
  source_ref  jsonb NOT NULL,                    -- {connectionId, schema, table, geometryColumn, strategy, h3:{column,resolutionMode,…}}
  style       jsonb NOT NULL DEFAULT '{}',
  filters     jsonb NOT NULL DEFAULT '[]',
  visible     boolean NOT NULL DEFAULT true,
  opacity     real NOT NULL DEFAULT 1 CHECK (opacity BETWEEN 0 AND 1),
  z_order     integer NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON app.layers (project_id, z_order);
CREATE INDEX layers_style_gin ON app.layers USING gin (style jsonb_path_ops);

CREATE TABLE app.user_settings (
  user_id  uuid PRIMARY KEY REFERENCES app.users(id) ON DELETE CASCADE,
  settings jsonb NOT NULL DEFAULT '{}'   -- {theme, units, defaultBasemap, coordinateFormat, panelLayout}
);

CREATE TABLE app.tile_sessions (          -- optional; may live in Redis instead
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id uuid NOT NULL REFERENCES app.connections(id) ON DELETE CASCADE,
  definition jsonb NOT NULL,
  expires_at timestamptz NOT NULL
);

CREATE TABLE app.audit_log (
  id bigserial PRIMARY KEY, at timestamptz NOT NULL DEFAULT now(),
  user_id uuid, connection_id uuid, action text, detail jsonb, duration_ms integer, row_count integer
);
```

Example `style` JSON: see MAP_LAYERS.md ("Per-layer configuration"). Example `source_ref` for an H3 layer:

```json
{ "kind":"postgis","connectionId":"6d6f…","schema":"public","table":"h3_population",
  "h3":{"column":"h3_index","storage":"bigint","resolutionMode":"auto","fixedResolution":8,
        "valueColumn":"population","agg":"sum"} }
```

## B. Example data tables

### B.1 Geometry tables

```sql
CREATE EXTENSION IF NOT EXISTS postgis;

CREATE TABLE public.poi (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name text, category text, rating real,
  geom geometry(Point, 4326) NOT NULL
);
CREATE INDEX poi_geom_gix ON poi USING gist (geom);
-- very large, insertion-ordered point data:
-- CREATE INDEX poi_geom_brin ON poi USING brin (geom);   -- needs spatial clustering, or use spgist

CREATE TABLE public.roads (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name text, class text, geom geometry(MultiLineString, 4326) NOT NULL
);
CREATE INDEX roads_geom_gix ON roads USING gist (geom);

CREATE TABLE public.parcels (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  zone text, pop integer, height_m real,
  geom geometry(MultiPolygon, 4326) NOT NULL
);
CREATE INDEX parcels_geom_gix ON parcels USING gist (geom);
CLUSTER parcels USING parcels_geom_gix;      -- physical locality improves bbox reads
ANALYZE parcels;                             -- required for ST_EstimatedExtent and planning
```

Recommendations for imported data: keep a **single-type constrained geometry column**, a **primary key**, a **GiST index**, `ANALYZE` after load, store in 4326 unless there is a reason not to (MVT generation transforms to 3857; if tiles are the main access path consider storing a 3857 copy to avoid per-tile transforms), use `ST_Subdivide` for huge polygons used in intersection tests.

### B.2 H3 tables

```sql
-- (a) pure H3 table (no extension needed)
CREATE TABLE public.h3_population (
  h3_index   bigint   NOT NULL,
  resolution smallint NOT NULL,
  population integer, income numeric, area double precision, category text,
  PRIMARY KEY (resolution, h3_index)
);

-- (b) text-index variant (directly consumable by h3-js)
CREATE TABLE public.h3_sales (
  h3_index text PRIMARY KEY CHECK (h3_index ~ '^[0-9a-f]{15}$'),
  resolution smallint NOT NULL,          -- populated by ETL (h3-py) or h3_get_resolution() with h3-pg
  revenue numeric
);

-- (c) geometry table enriched with H3 columns (multiple resolutions)
ALTER TABLE public.poi ADD COLUMN h3_7 bigint, ADD COLUMN h3_9 bigint;
CREATE INDEX poi_h3_9 ON poi (h3_9);

-- (d) rollups
CREATE MATERIALIZED VIEW public.poi_h3_8 AS
SELECT h3_cell_to_parent(h3_9::h3index, 8)::bigint AS h3_index, count(*) AS n, avg(rating) AS rating
FROM public.poi GROUP BY 1;
CREATE UNIQUE INDEX ON public.poi_h3_8 (h3_index);
```

Examples (c) and (d) require `h3-pg` (`CREATE EXTENSION h3;`) for the SQL functions; the equivalent without the extension is an ETL step with h3-py.

### B.3 Sample data for development

`docker/postgis/init/` will hold: `01-extensions.sql`, `02-sample-poi.sql` (a few thousand points generated with `generate_series` + `ST_Point(random…)`), `03-sample-h3.sql` (generated from Python at build time), and the `gis_reader` role. A seeding script generates 10k/100k/1M/10M point datasets for performance tests (TESTING_STRATEGY.md).

## C. Migrations and conventions

- Alembic for `app` schema; migrations run on container start (`alembic upgrade head`).
- UUID primary keys, `timestamptz`, JSONB for config with `schema_version` and migration functions in the backend.
- Soft secrets never stored in JSONB; use `secret_ref`.
