// Responsiveness check for large user files (Phase 4): generates a ~50 MB GeoJSON and a 500k-row CSV,
// loads each through the Add layer dialog and measures main-thread long tasks / frame gaps while the
// worker parses, and again while the layer is built and drawn.
//   BASE_URL=http://localhost:5173 node e2e/large-files.mjs
import { chromium } from 'playwright-core'
import { existsSync, mkdirSync, statSync, createWriteStream } from 'node:fs'
import { once } from 'node:events'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const BASE = process.env.BASE_URL ?? 'http://localhost:5173'
const CANDIDATES = [
  process.env.CHROME_PATH,
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
].filter(Boolean)
const executablePath = CANDIDATES.find((p) => existsSync(p))
if (!executablePath) throw new Error('No Chrome/Chromium found. Set CHROME_PATH.')

const dir = join(tmpdir(), 'h3map-large')
mkdirSync(dir, { recursive: true })
const rnd = (a, b) => a + Math.random() * (b - a)

async function writeAll(path, produce) {
  const ws = createWriteStream(path)
  for (const chunk of produce()) if (!ws.write(chunk)) await once(ws, 'drain')
  ws.end()
  await once(ws, 'finish')
}

function* geojsonChunks(targetBytes) {
  yield '{"type":"FeatureCollection","features":[\n'
  let bytes = 0, n = 0
  while (bytes < targetBytes) {
    const lon = rnd(-5, 10), lat = rnd(42, 52), k = n % 10
    const geometry = k < 7 ? { type: 'Point', coordinates: [lon, lat] }
      : k === 7 ? { type: 'MultiPoint', coordinates: [[lon, lat], [lon + 0.01, lat + 0.01]] }
      : k === 8 ? { type: 'Polygon', coordinates: [[[lon, lat], [lon + 0.05, lat], [lon + 0.05, lat + 0.05], [lon, lat + 0.05], [lon, lat]]] }
      : { type: 'GeometryCollection', geometries: [{ type: 'Point', coordinates: [lon, lat] }, { type: 'LineString', coordinates: [[lon, lat], [lon + 0.03, lat + 0.02]] }] }
    const f = JSON.stringify({ type: 'Feature', properties: { id: n, name: `feature ${n}`, value: Math.round(rnd(0, 1000) * 100) / 100, category: 'abcd'[n % 4], note: `lorem ipsum dolor sit amet ${n}` }, geometry })
    yield (n ? ',\n' : '') + f
    bytes += f.length + 2
    n++
  }
  yield ']}\n'
}

function* csvChunks(rows) {
  yield 'id,name,latitude,longitude,value,category\n'
  for (let i = 0; i < rows; i++) {
    const bad = i % 5000 === 0
    yield `${i},place ${i},${bad ? 'n/a' : rnd(42, 52).toFixed(5)},${rnd(-5, 10).toFixed(5)},${(Math.random() * 100).toFixed(2)},${'xyz'[i % 3]}\n`
  }
}

const geoPath = join(dir, 'big.geojson')
const csvPath = join(dir, 'big.csv')
if (!existsSync(geoPath) || statSync(geoPath).size < 49e6) await writeAll(geoPath, () => geojsonChunks(50 * 1024 * 1024))
if (!existsSync(csvPath)) await writeAll(csvPath, () => csvChunks(500000))
console.log(`files: ${(statSync(geoPath).size / 1048576).toFixed(1)} MB GeoJSON, ${(statSync(csvPath).size / 1048576).toFixed(1)} MB CSV (${dir})`)

const browser = await chromium.launch({ executablePath, headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'] })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
await page.addInitScript(() => {
  window.__long = []
  new PerformanceObserver((list) => list.getEntries().forEach((e) => window.__long.push(Math.round(e.duration)))).observe({ type: 'longtask', buffered: true })
  window.__gap = 0
  let last = performance.now()
  const tick = (t) => {
    window.__gap = Math.max(window.__gap, t - last)
    last = t
    requestAnimationFrame(tick)
  }
  requestAnimationFrame(tick)
})
const mark = () => page.evaluate(() => { window.__long = []; window.__gap = 0 })
const stats = (label) => page.evaluate((l) => ({ label: l, longTasks: window.__long.length, longest: Math.max(0, ...window.__long), maxFrameGapMs: Math.round(window.__gap) }), label)
const results = []
const report = async (label, budgetMs) => {
  const s = await stats(label)
  results.push({ ...s, budgetMs })
  console.log(`${s.longest <= budgetMs ? 'OK  ' : 'SLOW'} ${label}: longest main-thread task ${s.longest} ms, ${s.longTasks} long task(s), max frame gap ${s.maxFrameGapMs} ms`)
}

await page.goto(BASE, { waitUntil: 'load' })
await page.getByTestId('status-zoom').waitFor()
await page.waitForTimeout(3000)

async function loadFile(tabName, path, columns) {
  await page.getByRole('button', { name: 'Add layer' }).first().click()
  await page.getByRole('tab', { name: tabName }).click()
  await mark()
  const t0 = Date.now()
  await page.locator('[role=dialog] input[type=file]').setInputFiles(path)
  if (columns) {
    await page.getByTestId('csv-columns').waitFor({ timeout: 120000 })
    await report(`${tabName}: read + tokenise in worker`, 200)
    await mark()
    await page.getByTestId('csv-load').click()
  }
  await page.getByTestId('parse-result').waitFor({ timeout: 180000 })
  console.log(`  ${tabName}: parsed in ${((Date.now() - t0) / 1000).toFixed(1)} s, ${await page.getByTestId('result-count').innerText()}`)
  await report(`${tabName}: parse + transfer of results`, 300)
}

// GeoJSON
await loadFile('GeoJSON', geoPath)
console.log('  warnings:', (await page.getByTestId('parse-warnings').allInnerTexts()).join(' | '))
await mark()
await page.getByTestId('add-to-map').click()
await page.waitForFunction(() => !!document.querySelector('[data-testid^=layer-row-]') && !document.querySelector('[role=dialog]'), null, { timeout: 60000 })
await page.waitForTimeout(6000)
// Budget note: profiling showed the JS work here is ~100 ms; the rest is WebGL shader linking
// (getProgramParameter) for the GeoJsonLayer sub-layers, which is slow on SwiftShader (software GL) and fast on a GPU.
await report('GeoJSON: building and drawing the layer on the main thread (incl. shader link on SwiftShader)', 5000)
await page.screenshot({ path: 'e2e/out/08-large-geojson.png', timeout: 120000 }).catch(() => console.log('  (screenshot skipped: software rendering too slow)'))

// CSV
await loadFile('CSV', csvPath, true)
console.log('  bad rows:', await page.getByTestId('bad-rows').locator('summary').innerText())
await mark()
await page.getByTestId('add-to-map').click()
await page.waitForFunction(() => !document.querySelector('[role=dialog]'), null, { timeout: 60000 })
await page.waitForTimeout(6000)
await report('CSV: building and drawing the layer on the main thread', 3000)
await page.screenshot({ path: 'e2e/out/09-large-csv.png', timeout: 120000 }).catch(() => console.log('  (screenshot skipped: software rendering too slow)'))

// the UI still answers
await mark()
const t = Date.now()
await page.getByLabel('Zoom in').click()
await page.waitForTimeout(800)
await report('zoom in with both large layers loaded', 500)
console.log(`  click-to-zoom handled; ${errors.length} page error(s) ${errors.slice(0, 2).join(' || ')}`)

await browser.close()
const slow = results.filter((r) => r.longest > r.budgetMs)
process.exit(errors.length || slow.length ? 1 : 0)
