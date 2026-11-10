# Backend (Phase 6A)

FastAPI + psycopg3 (async pools) + PostGIS. The browser never talks to PostgreSQL; the backend owns credentials and builds
all SQL from structured requests. Routes follow `API_SPECIFICATION.md` under `/api/v1`.

## Setup (no Docker needed)

```
cd backend
python -m venv .venv   # Python 3.12 (h3 has no wheel for 3.15 yet)
.venv/Scripts/python -m pip install -e ".[dev]"      # or: uv pip install ...
cp .env.example .env   # set H3MAP_JWT_SECRET, H3MAP_ADMIN_PASSWORD, ANASTASIA_DB_PASSWORD
```

Connections are declared in `backend/connections.yaml`; passwords come from the environment (`password_env`).
The default entry points at a local PostgreSQL database `anastasia` with the read-only role `gis_reader`.

Run: `.venv/Scripts/python -m uvicorn --factory app.main:app_factory --loop none --port 8000`
(`--loop none` matters on Windows: psycopg async needs the selector event loop, uvicorn defaults to the Proactor loop).

Log in: `POST /api/v1/auth/login {"username":"admin","password":"..."}` -> `accessToken`; send `Authorization: Bearer ...`.
OpenAPI: `/api/v1/openapi.json`, UI at `/api/v1/docs`.

## Tests

```
H3MAP_TEST_ADMIN_DSN=postgresql://user:password@localhost:5432/postgres  # superuser DSN of the local server
.venv/Scripts/python -m pytest          # coverage gate 80%
```
Tests create a scratch database `h3map_test` (fixtures in `scripts/seed/fixtures.py`) and drop it afterwards; roles
`h3map_test_reader` / `h3map_test_limited` are created. Tests that need the h3 extension skip if it is missing.
Large datasets for measurements are generated on demand: `python -m scripts.seed.seed_large create|drop`, then
`python -m scripts.perf.run` (writes `perf-results/latest.json`).
Frontend/backend parity check: `tests/fixtures/h3_parity_10k.json` (h3-py) is verified against h3-js by `tests/js/verify_h3js.mjs`.

## Layout

`app/main.py` factory, middleware, handlers · `app/config.py` settings (`H3MAP_*`) · `app/errors.py` error envelope ·
`app/auth/` JWT + `require_role` · `app/api/v1/` routers · `app/services/` connections, discovery, profile, filters,
query_builder, features, stats, tiles, h3_service · `app/db/app_models.py` + `alembic/` for the `app` schema.

## Security model

Identifiers are verified against the catalogue (`discovery.get_table`, `col_info`) and composed with `sql.Identifier`;
values are bound parameters; filters use a whitelist grammar (depth 6, 50 nodes). Sessions are forced read-only
(`default_transaction_read_only`, `statement_timeout`, `idle_in_transaction_session_timeout`, `lock_timeout`). Errors use
the envelope in API_SPECIFICATION §2 and never contain SQL, hosts or passwords; logs pass a redacting filter. Hosts are
checked for SSRF (link-local/metadata/unspecified/multicast always blocked; loopback/private allowed in dev via
`H3MAP_ALLOW_PRIVATE_HOSTS`). A test fails if a route lacks an auth dependency (only `/health` and `/auth/login` are public).
