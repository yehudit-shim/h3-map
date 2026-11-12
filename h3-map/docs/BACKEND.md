# Backend (Phase 6A)

FastAPI + psycopg3 (async pools) + PostGIS. The browser never talks to PostgreSQL; the backend owns credentials and builds
all SQL from structured requests. Routes follow `API_SPECIFICATION.md` under `/api/v1`.

## Setup (no Docker needed)

```
cd backend
python -m venv .venv   # Python 3.12 (h3 has no wheel for 3.15 yet)
.venv/Scripts/python -m pip install -e ".[dev]"      # or: uv pip install ...
```

No `.env` is required. On the first start the server generates its JWT secret and encryption key into `backend/data/`
(git-ignored; protect it like a `.env`) and prints a one-time **setup token** to its log. Open the app, click *Sign in*,
and the dialog shows the first-run setup: the PostgreSQL database the server uses for its own data (users, saved
connections; needs `CREATE SCHEMA`), plus the first administrator. The server runs the migrations, stores the database URL
encrypted in `backend/data/app_db.enc` and switches over without a restart. Environment variables (`H3MAP_*`, see
`.env.example`) still win over the generated values, so Docker / CI keep working the classic way.

Connections are declared in `backend/connections.yaml`; passwords come from the environment (`password_env`).
The default entry points at a local PostgreSQL database `anastasia` with the read-only role `gis_reader`.

Run: `.venv/Scripts/python -m uvicorn --factory app.main:app_factory --loop none --port 8000`
(`--loop none` matters on Windows: psycopg async needs the selector event loop, uvicorn defaults to the Proactor loop).

Log in: `POST /api/v1/auth/login {"username":"...","password":"..."}` -> `accessToken`; send `Authorization: Bearer ...`
(Swagger: *Authorize*, paste the token). Users live in `app.users` and are managed by admins through `GET/POST /users`,
`PATCH/DELETE /users/{id}` (role, active flag, password; passwords are PBKDF2 hashes and never returned). Login order:
optional env admin (only if `H3MAP_ADMIN_PASSWORD[_HASH]` is set; a recovery login that never touches the database),
then `app.users` accounts, then **PostgreSQL roles**, then LDAP (off unless `H3MAP_LDAP_ENABLED`). `/setup/*` are public
but only work while no application database is configured and need the setup token; after setup they answer 409.

**Sign in with a PostgreSQL role** (`auth/pg_auth.py`): the server connects to the application database with the
submitted name and password; if PostgreSQL accepts them the user is signed in (nothing is stored). The app role comes from
the PostgreSQL role: superuser or member of `h3map_admin` -> admin, member of `h3map_editor` -> editor, otherwise viewer
(`H3MAP_PG_ADMIN_ROLE`, `H3MAP_PG_EDITOR_ROLE`, `H3MAP_PG_DEFAULT_ROLE`, `H3MAP_PG_AUTH_ENABLED`). Manage access in SQL:
`CREATE ROLE alice LOGIN PASSWORD '...'; CREATE ROLE h3map_admin; GRANT h3map_admin TO alice;`. Any role that PostgreSQL lets
connect to that database can sign in (as viewer), so revoke `CONNECT` or use a dedicated database to restrict it. Data
access is unchanged: queries still use the connection's service account, not the signed-in role. PostgreSQL has no login
throttling of its own, so put a rate limit in front of `/auth/login` when exposing it. Data databases are added afterwards
from the UI (Database panel, "+"): they are stored encrypted in `app.connections`.
OpenAPI: `/api/v1/openapi.json`, UI at `/api/v1/docs`.

### LDAP login (optional)

Set `H3MAP_LDAP_ENABLED=true` plus `H3MAP_LDAP_URL` and `H3MAP_LDAP_BASE_DN` (see `.env.example` for the rest). The same
`POST /auth/login` is used: the server looks the user up with the service account (`H3MAP_LDAP_BIND_DN` /
`H3MAP_LDAP_BIND_PASSWORD`, anonymous if unset) using `H3MAP_LDAP_USER_FILTER` (default `(uid={username})`, Active
Directory: `(sAMAccountName={username})`), requires exactly one match, then binds as that entry with the typed password.

- Token `sub` is the **lower-cased username**, so per-connection grants must list lower-case usernames.
- Role: every LDAP user gets `H3MAP_LDAP_DEFAULT_ROLE` (default `viewer`); usernames in `H3MAP_LDAP_ADMIN_USERS` /
  `H3MAP_LDAP_EDITOR_USERS` (JSON lists, case-insensitive) are promoted. There is no group-to-role mapping yet.
- The optional env admin (`H3MAP_ADMIN_USERNAME`, only when a password is configured) is a recovery login: it is only ever
  checked locally, works when the directory is down, and an LDAP or database account with that name cannot sign in.
- `ldaps://` and `H3MAP_LDAP_START_TLS` always validate the certificate (`H3MAP_LDAP_CA_FILE` for a private CA).
- Wrong credentials give 401; an unreachable directory or a bad service account gives 503 `auth_unavailable`.
- DB access is unchanged: PostgreSQL is still reached with the connection's service account, not the user's LDAP identity.

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

## Connections, access and Arrow

- Env connections live in `connections.yaml` (read-only; optional `allowed_users: [sub, ...]`).
- User connections (admin only) need `H3MAP_APP_DATABASE_URL` (run `alembic upgrade head` there) and `H3MAP_ENCRYPTION_KEY`
  (a Fernet key: `python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"`).
  `POST/PATCH/DELETE /connections`; passwords are write-only. `GET/PUT /connections/{id}/grants` limits a connection to
  token subjects; an empty list means every authenticated user. Admins always have access.
- `GET .../features?format=arrow` (or `format` in the POST body) returns an Arrow IPC stream.

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
`H3MAP_ALLOW_PRIVATE_HOSTS`). A test fails if a route lacks an auth dependency (only `/health`, `/auth/login` and the locked `/setup/*` are public).
