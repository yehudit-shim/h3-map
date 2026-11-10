// Brings the database e2e stack up and down:  node e2e/stack.mjs up [--foreground] | down | db-stop | db-start | large
//   up        throwaway PostGIS (docker compose) + fixture schema + FastAPI backend (:8010) + Vite dev server (:5199)
//   down      stops all of it and deletes the container
//   --foreground  keep this process (and so the servers) alive until Ctrl+C, then clean up (for CI and for shells that
//             kill background children when a command ends)
//   db-stop / db-start   simulate a database outage while the backend keeps running
//   large     seed the 1M-row tables (backend/scripts/seed/seed_large.py, a few minutes) into database h3map_perf
// State (ports, the generated admin password, process ids) is written to e2e/out/stack.json, which is git-ignored.
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = join(ROOT, 'e2e', 'out')
const STATE = join(OUT, 'stack.json')
const COMPOSE = ['compose', '-f', join(ROOT, 'e2e', 'docker-compose.yml')]
const PG_PASSWORD = process.env.E2E_PG_ADMIN_PASSWORD ?? 'e2e-throwaway'
const READER_PASSWORD = 'reader_pw' // created by backend/scripts/seed/fixtures.py
const API_PORT = Number(process.env.E2E_API_PORT ?? 8010)
const WEB_PORT = Number(process.env.E2E_WEB_PORT ?? 5199)
const isWin = process.platform === 'win32'
const py = join(ROOT, 'backend', '.venv', isWin ? 'Scripts/python.exe' : 'bin/python')

const run = (cmd, args, opts = {}) => {
  const r = spawnSync(cmd, args, { stdio: 'inherit', ...opts })
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(' ')} failed (${r.status})`)
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const state = () => (existsSync(STATE) ? JSON.parse(readFileSync(STATE, 'utf8')) : null)

async function waitFor(url, label, ms = 60000) {
  const t0 = Date.now()
  while (Date.now() - t0 < ms) {
    try {
      if ((await fetch(url)).status < 500) return
    } catch {
      // not up yet
    }
    await sleep(500)
  }
  throw new Error(`${label} did not become ready (${url})`)
}

function launch(cmd, args, { cwd, env, log }) {
  const fd = openSync(join(OUT, log), 'w')
  const child = spawn(cmd, args, { cwd, env: { ...process.env, ...env }, detached: true, stdio: ['ignore', fd, fd], shell: cmd.endsWith('.cmd') })
  child.unref()
  return child.pid
}

function kill(pid) {
  if (!pid) return
  try {
    if (isWin) spawnSync('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore' })
    else process.kill(-pid)
  } catch {
    // already gone
  }
}

async function up() {
  mkdirSync(OUT, { recursive: true })
  if (!existsSync(py)) throw new Error(`Backend venv not found at ${py}. See docs/BACKEND.md.`)
  const env = { E2E_PG_ADMIN_PASSWORD: PG_PASSWORD }
  run('docker', [...COMPOSE, 'up', '-d', '--wait'], { env: { ...process.env, ...env } })
  run('docker', ['exec', 'h3map-e2e-postgis', 'psql', '-U', 'postgres', '-c', 'DROP DATABASE IF EXISTS h3map_e2e WITH (FORCE)', '-c', 'CREATE DATABASE h3map_e2e'])
  run(py, ['-m', 'scripts.seed.fixtures', `postgresql://postgres:${PG_PASSWORD}@localhost:55432/h3map_e2e`], { cwd: join(ROOT, 'backend') })

  const adminPassword = randomBytes(12).toString('hex')
  const backendEnv = {
    H3MAP_JWT_SECRET: randomBytes(32).toString('hex'),
    H3MAP_ADMIN_PASSWORD: adminPassword,
    H3MAP_CONNECTIONS_FILE: join(ROOT, 'e2e', 'connections.e2e.yaml'),
    H3MAP_CORS_ORIGINS: JSON.stringify([`http://localhost:${WEB_PORT}`]),
    E2E_READER_PASSWORD: READER_PASSWORD,
    E2E_PG_ADMIN_PASSWORD: PG_PASSWORD,
  }
  const api = launch(py, ['-m', 'uvicorn', '--factory', 'app.main:app_factory', '--loop', 'none', '--port', String(API_PORT)], { cwd: join(ROOT, 'backend'), env: backendEnv, log: 'backend.log' })
  await waitFor(`http://localhost:${API_PORT}/api/v1/health`, 'backend')
  const npx = isWin ? 'npx.cmd' : 'npx'
  const web = launch(npx, ['vite', '--port', String(WEB_PORT), '--strictPort'], { cwd: ROOT, env: { VITE_API_PROXY: `http://localhost:${API_PORT}` }, log: 'vite.log', })
  await waitFor(`http://localhost:${WEB_PORT}/`, 'dev server')
  writeFileSync(STATE, JSON.stringify({ baseUrl: `http://localhost:${WEB_PORT}`, apiPort: API_PORT, user: 'admin', password: adminPassword, pids: { api, web } }, null, 2))
  console.log(`stack ready: app http://localhost:${WEB_PORT}, API :${API_PORT}\nrun: E2E_DB=1 npm run test:e2e   (credentials are read from e2e/out/stack.json)`)
}

function down() {
  const s = state()
  if (s) for (const pid of Object.values(s.pids ?? {})) kill(pid)
  spawnSync('docker', [...COMPOSE, 'down', '-v'], { stdio: 'inherit', env: { ...process.env, E2E_PG_ADMIN_PASSWORD: PG_PASSWORD } })
  rmSync(STATE, { force: true })
}

const cmd = process.argv[2]
const compose = (...a) => run('docker', [...COMPOSE, ...a], { env: { ...process.env, E2E_PG_ADMIN_PASSWORD: PG_PASSWORD } })
if (cmd === 'up') {
  await up()
  if (process.argv.includes('--foreground')) {
    const stop = () => {
      down()
      process.exit(0)
    }
    process.on('SIGINT', stop)
    process.on('SIGTERM', stop)
    await new Promise(() => {})
  }
}
else if (cmd === 'down') down()
else if (cmd === 'db-stop') compose('stop', 'postgis')
else if (cmd === 'db-start') compose('start', 'postgis')
else if (cmd === 'large') run(py, ['-m', 'scripts.seed.seed_large', 'create'], { cwd: join(ROOT, 'backend'), env: { ...process.env, H3MAP_TEST_ADMIN_DSN: `postgresql://postgres:${PG_PASSWORD}@localhost:55432/postgres` } })
else {
  console.error('usage: node e2e/stack.mjs up | down | db-stop | db-start | large')
  process.exit(2)
}
