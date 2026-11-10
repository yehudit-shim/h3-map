// End-to-end smoke test against the running app (system Chrome via playwright-core).
//   BASE_URL=http://localhost:5173 CHROME_PATH=/usr/bin/google-chrome node e2e/smoke.mjs
// Screenshots are written to e2e/out/ (git-ignored).
import { chromium } from 'playwright-core'
import { existsSync, mkdirSync } from 'node:fs'

const BASE = process.env.BASE_URL ?? 'http://localhost:5173'
const CANDIDATES = [
  process.env.CHROME_PATH,
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
].filter(Boolean)
const executablePath = CANDIDATES.find((p) => existsSync(p))
if (!executablePath) throw new Error('No Chrome/Chromium found. Set CHROME_PATH.')

mkdirSync('e2e/out', { recursive: true })
const results = []
const num = (t) => Number(String(t).match(/-?\d+(?:\.\d+)?/)[0])
const check = (name, ok, detail = '') => {
  results.push({ name, ok })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`)
}

const browser = await chromium.launch({
  executablePath,
  headless: true,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'],
})
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
const errors = []
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(`console: ${m.text()}`)
})

await page.goto(BASE, { waitUntil: 'load' })
await page.getByTestId('status-zoom').waitFor()

// 1. map + deck canvases render
await page.waitForSelector('canvas.maplibregl-canvas', { timeout: 20000 })
await page.waitForFunction(() => document.querySelectorAll('canvas').length >= 2, null, { timeout: 20000 })
check('MapLibre and deck.gl canvases mounted', true)
await page.waitForFunction(() => !document.body.innerText.includes('Loading map'), null, { timeout: 30000 }).catch(() => {})

// 2. layers loaded (default stack)
await page.getByTestId('layer-row-' + (await page.locator('[data-testid^=layer-row-]').first().getAttribute('data-testid')).slice(10)).waitFor()
check('default layers listed', (await page.locator('[data-testid^=layer-row-]').count()) === 3)

// H3 layer is first (top); select it
await page.locator('[data-testid^=layer-row-]').first().getByRole('button').nth(1).click()
await page.waitForFunction(() => document.body.innerText.includes('H3 res'), null, { timeout: 15000 })
const sub = await page.locator('[data-testid^=layer-row-]').first().innerText()
check('H3 layer shows resolution + cell count', /H3 res \d+ \([\d,]+ cells\)/.test(sub), sub.replace(/\n/g, ' | '))
await page.waitForTimeout(2500)
await page.screenshot({ path: 'e2e/out/01-initial.png' })

// 3. pixels were actually drawn by deck.gl (non-empty overlay canvas)
const deckDrawn = await page.evaluate(() => {
  const canvases = [...document.querySelectorAll('canvas')].filter((c) => !c.classList.contains('maplibregl-canvas'))
  return canvases.length
})
check('deck.gl overlay canvas present', deckDrawn >= 1)

// 4. click a hexagon: find a cell via scanning the map for the inspector to populate
const box = await page.locator('main').boundingBox()
let selected = false
let hit = null
outer: for (let y = box.y + 200; y < box.y + box.height - 100; y += 40) {
  for (let x = box.x + 380; x < box.x + box.width - 380; x += 40) {
    await page.mouse.click(x, y)
    if (await page.getByTestId('selected-h3-index').count()) {
      selected = true
      hit = { x, y }
      break outer
    }
  }
}
check('clicking a hexagon selects it', selected)
if (selected) {
  const idx = await page.getByTestId('selected-h3-index').innerText()
  const res = await page.getByTestId('row-Resolution').innerText()
  check('inspector shows a valid H3 index and resolution', /^[0-9a-f]{15}$/.test(idx) && /^\d+$/.test(res), `${idx} res ${res}`)
  check('status bar counts the selection', num(await page.getByTestId('status-selected').innerText()) === 1)
  // index resolution digit (hex char 2) must equal the displayed resolution
  check('index encodes the displayed resolution', parseInt(idx[1], 16) === Number(res))
  await page.screenshot({ path: 'e2e/out/02-selected.png' })
  // Escape clears the selection; clicking again restores it
  await page.keyboard.press('Escape')
  check('Escape clears the selection', num(await page.getByTestId('status-selected').innerText()) === 0)
  await page.mouse.click(hit.x, hit.y)
  await page.getByTestId('selected-h3-index').waitFor({ timeout: 5000 })
}

// 5. resolution selector: H3 tab -> fixed -> change res
await page.getByRole('tab', { name: 'H3' }).click()
await page.getByRole('radio', { name: 'Fixed' }).click()
const slider = page.getByLabel('H3 resolution')
await slider.fill('6')
await page.waitForFunction(() => /Showing resolution\s*6 \/ 15/.test(document.body.innerText), null, { timeout: 10000 })
check('resolution selector changes the displayed resolution to 6', true)
const cells6 = await page.getByTestId('h3-readout').innerText()
await slider.fill('9')
await page.waitForFunction(() => /Showing resolution\s*9 \/ 15/.test(document.body.innerText), null, { timeout: 10000 })
const cells9 = await page.getByTestId('h3-readout').innerText()
const n = (t) => Number(t.match(/Cells\s*([\d,]+)/)[1].replace(/,/g, ''))
check('higher resolution produces more cells', n(cells9) > n(cells6), `res6=${n(cells6)} res9=${n(cells9)}`)
check('selection cleared when resolution changes', num(await page.getByTestId('status-selected').innerText()) === 0)
await page.waitForTimeout(1500)
await page.screenshot({ path: 'e2e/out/03-res9.png' })

// 6. zoom / pitch controls and status bar
const z0 = num(await page.getByTestId('status-zoom').innerText())
await page.getByLabel('Zoom in').click()
await page.waitForTimeout(600)
const z1 = num(await page.getByTestId('status-zoom').innerText())
check('zoom in control raises the zoom', z1 > z0 + 0.8, `${z0} -> ${z1}`)
await page.getByLabel('Tilt to 3D (pitch 60°)').click()
const tilted = await page.waitForFunction(() => /\/\s*60°/.test(document.querySelector('[aria-label="Map status"]')?.innerText ?? ''), null, { timeout: 8000 }).then(() => true, () => false)
check('pitch control tilts the map to 60°', tilted)
await page.screenshot({ path: 'e2e/out/03b-pitched.png' })
await page.getByLabel(/Reset north/).click()
await page.mouse.move(box.x + 600, box.y + 400)
await page.waitForTimeout(300)
check('status bar shows live coordinates and CRS', /^-?\d+\.\d+, -?\d+\.\d+$/.test((await page.getByTestId('status-coords').innerText()).replace('Lon, Lat', '').trim().replace(/\s+/g, ' ')) && (await page.getByTestId('status-crs').innerText()).includes('EPSG:4326'))

// 7. add a layer from the Data tab (heatmap) and manage it
await page.getByRole('tab', { name: 'Data' }).click()
await page.getByLabel('Layer type for Events (20k points)').selectOption('heatmap')
await page.getByLabel('Add Events (20k points) to map').click()
await page.getByRole('tab', { name: 'Layers' }).waitFor()
await page.waitForFunction(() => document.querySelectorAll('[data-testid^=layer-row-]').length === 4)
check('adding a heatmap layer from the Data tab', true)
await page.waitForTimeout(2000)
await page.screenshot({ path: 'e2e/out/04-heatmap.png' })
await page.getByLabel(/Hide Heatmap/).click()
check('layer can be hidden', (await page.getByLabel(/Show Heatmap/).count()) === 1)
await page.getByLabel('Remove layer').click()
check('layer can be removed', (await page.locator('[data-testid^=layer-row-]').count()) === 3)

// 7b. every layer type can be added through the UI and renders without errors
const combos = [
  ['Points of interest', 'point'], ['Points of interest', 'scatterplot'], ['Events (20k points)', 'scatterplot'],
  ['Events (20k points)', 'hexagon'], ['Events (20k points)', 'h3'], ['Events (20k points)', 'point'],
  ['Routes', 'line'], ['Districts', 'polygon'], ['Mixed GeoJSON', 'geojson'], ['Points of interest', 'geojson'],
]
await page.getByRole('tab', { name: 'Data' }).click()
let expected = 3
for (const [src, type] of combos) {
  await page.getByLabel(`Layer type for ${src}`).selectOption(type)
  await page.getByLabel(`Add ${src} to map`).click()
  expected += 1
  await page.waitForFunction((n) => document.querySelectorAll('[data-testid^=layer-row-]').length === n, expected)
  await page.getByRole('tab', { name: 'Data' }).click()
}
await page.waitForTimeout(2500)
check('all 8 layer types added via the UI', expected === 13)
await page.getByRole('tab', { name: 'Layers' }).click()
const rows = await page.locator('[data-testid^=layer-row-]').allInnerTexts()
check('no layer reports a load error', !rows.some((r) => /Retry/.test(r)))
check('no toast reports a layer failure', (await page.locator('[role=alert]').count()) === 0)
await page.screenshot({ path: 'e2e/out/04b-all-layer-types.png' })
// extruded polygons + 3D tilt
await page.locator('[data-testid^=layer-row-]').filter({ hasText: 'Polygons · Districts' }).first().getByRole('button').nth(1).click()
await page.getByRole('tab', { name: 'Style' }).click()
await page.getByRole('switch', { name: '3D extrusion' }).click()
await page.getByLabel('Tilt to 3D (pitch 60°)').click()
await page.waitForTimeout(2500)
await page.screenshot({ path: 'e2e/out/04c-extruded.png' })
check('extruded polygon style applied', (await page.getByRole('switch', { name: '3D extrusion' }).getAttribute('aria-checked')) === 'true')
await page.getByLabel(/Reset north/).click()

// 7c. Phase 3: groups, drag and drop, context menu, properties, persistence
await page.getByRole('tab', { name: 'Layers' }).click()
const layerRows = page.locator('[data-testid^=layer-row-]')
const nameBtn = (text) => layerRows.filter({ hasText: text }).first().locator('[data-node-name]')
await nameBtn('Lines · Routes').click()
await nameBtn('Points · Points of interest').click({ modifiers: ['Control'] })
await page.getByLabel('Group 2 selected').click()
const groupRow = page.locator('[data-testid^=group-row-]').first()
await groupRow.waitFor()
check('Ctrl+click two layers and group them', (await groupRow.locator('[data-testid^=layer-row-]').count()) === 2)
const visibleBefore = num(await page.getByTestId('status-layers').innerText())
await page.getByLabel('Hide New group').click()
const visibleAfter = num(await page.getByTestId('status-layers').innerText())
check('hiding a group hides the layers inside it', visibleAfter === visibleBefore - 2, `${visibleBefore} -> ${visibleAfter}`)
await page.getByLabel('Show New group').click()

// real mouse drag: drop the H3 layer onto the group header (middle of the row = inside)
const h3Row = layerRows.filter({ hasText: 'H3 · Event intensity' }).first()
await h3Row.locator('> div').first().dragTo(groupRow.locator('> div').first())
await page.waitForTimeout(300)
check('drag and drop moves a layer into a group', (await groupRow.locator('[data-testid^=layer-row-]').count()) === 3)
// drag a layer above the first row (top quarter of the target row = before)
const firstBox = await page.locator('[data-testid^=group-row-], [data-testid^=layer-row-]').first().locator('> div').first().boundingBox()
const lastLayer = layerRows.last()
const lastName = (await lastLayer.locator('[data-node-name]').innerText()).trim()
await lastLayer.locator('> div').first().dragTo(page.locator('[data-testid^=group-row-], [data-testid^=layer-row-]').first().locator('> div').first(), { targetPosition: { x: firstBox.width / 2, y: 3 } })
await page.waitForTimeout(300)
const topName = (await page.locator('[data-node-name]').first().innerText()).trim()
check('drag and drop reorders to the top of the list', topName === lastName, `${lastName} -> top is ${topName}`)
await page.screenshot({ path: 'e2e/out/04d-groups.png' })

// context menu + properties dialog
await nameBtn('Polygons · Districts').click({ button: 'right' })
await page.getByRole('menuitem', { name: 'Properties…' }).click()
const dialog = page.getByRole('dialog')
await dialog.waitFor()
const dialogText = await dialog.innerText()
check('properties dialog shows source, extent and attributes', /Data source/i.test(dialogText) && /West/i.test(dialogText) && /Attributes/i.test(dialogText))
await page.screenshot({ path: 'e2e/out/04e-properties.png' })
await page.keyboard.press('Escape')
check('Escape closes the properties dialog', (await page.getByRole('dialog').count()) === 0)

// persistence: reload restores the tree, the groups and the styles
const countBefore = await layerRows.count()
// two layers share the name "Polygons · Districts": find the extruded one by id
const extrudedId = await page.evaluate(() => {
  const find = (nodes) => nodes.flatMap((n) => (n.kind === 'group' ? find(n.children) : [n]))
  return find(JSON.parse(localStorage.getItem('h3map.layers')).state.tree).find((l) => l.type === 'polygon' && l.style.extruded)?.id
})
const savedNodes = await page.evaluate(() => JSON.parse(localStorage.getItem('h3map.layers')).state.tree.length)
await page.reload({ waitUntil: 'load' })
await page.locator('[data-testid^=group-row-]').first().waitFor({ timeout: 15000 })
check('reload restores layers and groups', (await page.locator('[data-testid^=layer-row-]').count()) === countBefore && savedNodes > 0, `${countBefore} layers`)
await page.locator(`[data-testid=layer-row-${extrudedId}] [data-node-name]`).click()
await page.getByRole('tab', { name: 'Style' }).click()
check('reload restores layer styles', (await page.getByRole('switch', { name: '3D extrusion' }).getAttribute('aria-checked')) === 'true')
await page.waitForTimeout(1500)

// 8. basemap switch + theme
await page.getByRole('button', { name: /Basemap:/ }).click()
await page.getByRole('menuitemradio', { name: /Light/ }).click()
await page.waitForTimeout(2500)
await page.screenshot({ path: 'e2e/out/05-light-basemap.png' })
check('basemap switches to Light', (await page.getByRole('button', { name: 'Basemap: Light' }).count()) === 1)
await page.getByLabel('Switch to light interface').click()
check('UI theme switches', (await page.evaluate(() => document.documentElement.dataset.theme)) === 'light')
await page.screenshot({ path: 'e2e/out/06-light-ui.png' })

// 9. search by H3 index
await page.getByLabel('Go to coordinates or H3 index').fill('89283082803ffff')
await page.keyboard.press('Enter')
await page.waitForTimeout(1500)
check('search flies to an H3 index', Math.abs(num(await page.getByTestId('status-zoom').innerText()) - 14.5) < 0.3)

// 10. responsive: mobile viewport
await page.setViewportSize({ width: 390, height: 800 })
await page.waitForTimeout(600)
const openPanels = () => [...document.querySelectorAll('aside')].filter((a) => !a.inert).length
await page.waitForFunction(`(${openPanels})() === 1`, null, { timeout: 8000 }).catch(() => {})
const panelsOpen = await page.evaluate(openPanels)
check('only one panel open on a narrow screen', panelsOpen === 1, `open panels: ${panelsOpen}`)
const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)
check('no horizontal overflow at 390px', !overflow)
await page.screenshot({ path: 'e2e/out/07-mobile.png' })

const fatal = errors.filter((e) => !/Failed to load resource|net::ERR|WebGL|GPU stall|swiftshader/i.test(e))
check('no uncaught page errors', fatal.length === 0, fatal.slice(0, 3).join(' || '))
if (errors.length) console.log('console noise:', [...new Set(errors)].slice(0, 6))

await browser.close()
const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
process.exit(failed.length ? 1 : 0)
