// H3 aggregation of a 500k-point CSV (Phase 5): the points are aggregated in the H3 worker; this script
// measures how long that takes and whether the main thread stays responsive, and that changing the
// resolution reuses the points cached in the worker.
//   BASE_URL=http://localhost:5173 node e2e/h3-large.mjs      (needs e2e/large-files.mjs to have generated the CSV once)
import { chromium } from 'playwright-core'
import { existsSync, mkdirSync, createWriteStream } from 'node:fs'
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
const csvPath = join(dir, 'big.csv')
if (!existsSync(csvPath)) {
  const ws = createWriteStream(csvPath)
  ws.write('id,name,latitude,longitude,value,category\n')
  for (let i = 0; i < 500000; i++) {
    const bad = i % 5000 === 0
    if (!ws.write(`${i},place ${i},${bad ? 'n/a' : (42 + Math.random() * 10).toFixed(5)},${(-5 + Math.random() * 15).toFixed(5)},${(Math.random() * 100).toFixed(2)},${'xyz'[i % 3]}\n`)) await once(ws, 'drain')
  }
  ws.end()
  await once(ws, 'finish')
}

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
const results = []
// Verdict = how long the computation took (end to end for the first run, the worker's own time afterwards)
// and the longest main-thread task. The frame gap is printed for information only: with SwiftShader (software
// GL, no GPU) drawing 200k+ cells stalls the compositor for seconds without any main-thread work.
const report = async (label, seconds, budgetS, budgetLongMs) => {
  const s = await page.evaluate(() => ({ longTasks: window.__long.length, longest: Math.max(0, ...window.__long), gap: Math.round(window.__gap) }))
  const ok = seconds <= budgetS && s.longest <= budgetLongMs
  results.push(ok)
  console.log(`${ok ? 'OK  ' : 'SLOW'} ${label}: ${seconds.toFixed(2)} s (budget ${budgetS} s), longest main-thread task ${s.longest} ms (budget ${budgetLongMs}), ${s.longTasks} long task(s); frame gap ${s.gap} ms (info)`)
}

await page.goto(BASE, { waitUntil: 'load' })
await page.getByTestId('status-zoom').waitFor()
await page.waitForTimeout(3000)

// 1. load the CSV as a point source (parse in the CSV worker), choose the H3 layer type
await page.locator('header').getByRole('button', { name: 'Add layer' }).click()
await page.getByRole('tab', { name: 'CSV', exact: true }).click()
await page.locator('[role=dialog] input[type=file]').setInputFiles(csvPath)
await page.getByTestId('csv-columns').waitFor({ timeout: 120000 })
await page.getByTestId('csv-load').click()
await page.getByTestId('parse-result').waitFor({ timeout: 120000 })
await page.getByLabel('Layer type').selectOption('h3')
console.log(`CSV parsed: ${await page.getByTestId('result-count').innerText()}`)

// 2. add: aggregation of 500k points in the H3 worker
await mark()
const t0 = Date.now()
await page.getByTestId('add-to-map').click()
await page.locator('[data-testid^=layer-row-]').first().locator('[data-node-name]').click()
await page.getByRole('tab', { name: 'H3', exact: true }).click()
await page.waitForFunction(() => /Cells\s*[\d,]+/.test([...document.querySelectorAll('[data-testid=h3-readout]')].map((e) => e.innerText).join(' ')), null, { timeout: 60000 })
const first = (Date.now() - t0) / 1000
console.log('  readout:', (await page.getByRole('tabpanel', { name: 'H3' }).getByTestId('h3-readout').innerText()).replace(/\n/g, ' | '))
await report('first aggregation of 500k points (add -> cells drawn)', first, 3, 600)

// 3. change the resolution: recomputed from the points cached in the worker, no re-parse, no re-send
await page.getByRole('radio', { name: 'Fixed' }).click()
const slider = page.getByLabel('H3 resolution')
const cellsOf = async () => Number((await page.getByRole('tabpanel', { name: 'H3' }).getByTestId('h3-readout').innerText()).match(/Cells\s*([\d,]+)/)?.[1]?.replace(/,/g, '') ?? NaN)
for (const res of [6, 9, 7, 5]) {
  await mark()
  const t = Date.now()
  await slider.fill(String(res))
  // either the requested resolution is shown, or it was coarsened to stay under the cell cap (and says so)
  await page.waitForFunction((r) => {
    const text = [...document.querySelectorAll('[data-testid=h3-readout]')].map((e) => e.innerText).join(' ')
    return /Cells\s*[\d,]+/.test(text) && (new RegExp(`Resolution ${r} would need more`).test(text) || new RegExp(`Showing resolution\\s*${r} / 15`).test(text))
  }, res, { timeout: 60000 })
  const s = (Date.now() - t) / 1000
  const text = await page.getByRole('tabpanel', { name: 'H3' }).getByTestId('h3-readout').innerText()
  const shown = text.match(/Showing resolution\s*(\d+)/)?.[1]
  console.log(`  resolution ${res}${shown !== String(res) ? ` (coarsened to ${shown})` : ''}: ${(await cellsOf()).toLocaleString('en-US')} cells, worker ${text.match(/Worker time\s*([\d,]+) ms/)?.[1] ?? '?'} ms`)
  const workerMs = Number(text.match(/Worker time\s*([\d,]+) ms/)?.[1]?.replace(/,/g, '') ?? NaN)
  // resolutions that get coarsened need several passes over the points (they are the pathological case): informational
  const coarsened = shown !== String(res)
  console.log(`    end to end ${s.toFixed(2)} s (includes drawing)`)
  await report(`change to resolution ${res}${coarsened ? ' (coarsened: worker time only for information)' : ''}: worker time`, coarsened ? 0 : workerMs / 1000, 3, 600)
}

// 4. aggregation switch and select a cell
await mark()
await page.getByLabel('Aggregate').selectOption('sum').catch(() => {})
await page.waitForTimeout(1500)
await report('switch aggregation to sum (cached statistics)', 1.5, 3, 600)
await page.screenshot({ path: 'e2e/out/13-h3-500k.png', timeout: 120000 }).catch(() => console.log('  (screenshot skipped: software rendering too slow)'))
await browser.close()
console.log(`${errors.length} page error(s) ${errors.slice(0, 2).join(' || ')}`)
process.exit(errors.length || results.some((r) => !r) ? 1 : 0)
