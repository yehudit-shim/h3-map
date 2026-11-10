# End-to-end tests

- `npm run test:e2e` — browser smoke test on sample data (needs a running app: `BASE_URL`).
- Database scenario (sign in, browse, add table, pan/bbox reload, MVT, H3, database down, reconnect): needs the stack.

```
npm run e2e:stack -- up --foreground     # throwaway PostGIS (docker compose, :55432) + fixtures + backend (:8010) + Vite (:5199)
npm run test:e2e:db                      # only the database scenario   (or: E2E_DB=1 npm run test:e2e)
npm run e2e:stack -- down
```

Requirements: Docker, the backend venv (`docs/BACKEND.md`), Chrome. `E2E_POSTGIS_IMAGE` selects the image (default `postgis/postgis:17-3.5`).
Credentials are generated per run into `e2e/out/stack.json` (git-ignored). `npm run e2e:stack -- large` seeds the 1M-row tables
(database `h3map_perf`, connection `perf`) for a manual MVT check. Status: the scenario has not been run yet.
