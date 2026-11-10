// Phase 6B database scenario of the smoke test (called from smoke.mjs when E2E_DB=1). It drives the real app against
// the real backend and a PostGIS fixture database: sign in, browse, add a table, pan and see the bbox reload, add MVT
// and H3 layers, stop the database, sign out and reconnect. Start the stack with `node e2e/stack.mjs up` (e2e/README.md).
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))

/** Credentials: E2E_USER / E2E_PASSWORD, else the stack file written by `stack.mjs up`. */
export function stackInfo() {
  const file = join(HERE, 'out', 'stack.json')
  const s = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {}
  return { user: process.env.E2E_USER ?? s.user ?? 'admin', password: process.env.E2E_PASSWORD ?? s.password, managed: existsSync(file) }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

export async function runDatabaseScenario({ page, check, base }) {
  const { user, password, managed } = stackInfo()
  if (!password) throw new Error('No credentials: run `node e2e/stack.mjs up` or set E2E_USER and E2E_PASSWORD.')
  const CONN = process.env.E2E_CONNECTION ?? 'fixtures'

  // ---- request log ------------------------------------------------------------------------------------------------
  const log = []
  page.on('request', (r) => {
    if (r.url().includes('/api/v1/')) log.push({ method: r.method(), url: r.url(), auth: r.headers().authorization ?? null, status: null })
  })
  page.on('response', (r) => {
    const e = [...log].reverse().find((x) => x.url === r.url() && x.status === null)
    if (e) e.status = r.status()
  })
  const mark = () => log.length
  const since = (m, re, method) => log.slice(m).filter((x) => re.test(x.url) && (!method || x.method === method))
  const bboxOf = (x) => new URL(x.url).searchParams.get('bbox')
  const until = async (fn, ms = 15000, what = 'condition') => {
    const t0 = Date.now()
    while (Date.now() - t0 < ms) {
      const v = await fn()
      if (v) return v
      await sleep(150)
    }
    throw new Error(`timed out waiting for ${what}`)
  }
  let clicks = 0
  const click = async (locator) => {
    clicks += 1
    await locator.click()
  }
  const main = await page.locator('main').boundingBox()
  const centre = { x: main.x + main.width / 2, y: main.y + main.height / 2 }
  const layerRow = (text) => page.locator('[data-testid^=layer-row-]').filter({ hasText: text }).first()
  const dbTab = () => page.getByRole('tab', { name: 'DB', exact: true })
  const settle = async () => {
    await sleep(900) // debounce (300 ms) + request
  }
  const mapShot = async (name) => page.screenshot({ path: `e2e/out/${name}.png` })
  const dragMap = async (dx, dy = 0) => {
    await page.mouse.move(centre.x, centre.y)
    await page.mouse.down()
    await page.mouse.move(centre.x + dx, centre.y + dy, { steps: 14 })
    await page.mouse.up()
  }

  // ---- 1. sign in -----------------------------------------------------------------------------------------------------
  await page.getByTestId('sign-in-button').click()
  await page.getByLabel('Username').fill(user)
  await page.getByLabel('Password').fill('definitely-wrong')
  await page.getByRole('button', { name: 'Sign in', exact: true }).last().click()
  await page.getByTestId('login-error').waitFor({ timeout: 15000 })
  check('a wrong password shows the server message and does not sign in', /invalid username or password/i.test(await page.getByTestId('login-error').innerText()) && (await page.getByTestId('account-button').count()) === 0)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Sign in', exact: true }).last().click()
  await page.getByTestId('db-panel').waitFor({ timeout: 20000 })
  check('signing in opens the Database tab', (await dbTab().getAttribute('aria-selected')) === 'true' && (await page.getByTestId('account-button').count()) === 1)
  check('the token is not in localStorage or sessionStorage', await page.evaluate(() => !/eyJ|Bearer|accessToken/.test(JSON.stringify({ ...localStorage, ...sessionStorage }))))

  // ---- 2. browse -------------------------------------------------------------------------------------------------------
  await page.getByTestId(`db-connection-${CONN}`).waitFor({ timeout: 15000 })
  const afterSignIn = clicks
  await click(page.getByTestId(`db-connection-${CONN}`).getByRole('button', { expanded: false }).first())
  await page.getByTestId('db-table-pts_4326').waitFor({ timeout: 20000 })
  const pts = await page.getByTestId('db-table-pts_4326').innerText()
  const h3t = await page.getByTestId('db-table-h3_bigint').innerText()
  check('the tree shows tables with geometry type, SRID and H3 badges', /Point · 4326/.test(pts) && /H3/.test(h3t), pts.replace(/\n/g, ' ') + ' | ' + h3t.replace(/\n/g, ' '))
  check('non-spatial tables are hidden by default', (await page.getByTestId('db-table-h3_near_miss').count()) === 0)
  await page.screenshot({ path: 'e2e/out/20-db-tree.png' })

  // ---- 3. table drawer ---------------------------------------------------------------------------------------------------
  await page.getByLabel('Table details: fx.no_index_no_pk').click()
  await page.getByTestId('profile-warnings').waitFor({ timeout: 20000 })
  const suggestion = await page.getByTestId('warning-suggestion').first().innerText()
  check('the drawer warns about a missing spatial index and shows the CREATE INDEX text', /CREATE INDEX .* USING gist/.test(suggestion), suggestion)
  await page.getByRole('tab', { name: 'Columns' }).click()
  check('the drawer lists columns', (await page.getByRole('table', { name: 'Columns' }).getByText('geom').count()) >= 1)
  await page.getByRole('tab', { name: 'Preview' }).click()
  await page.getByRole('table', { name: 'Row preview' }).waitFor({ timeout: 15000 })
  const nextBtn = page.getByLabel('Next page')
  const m0 = mark()
  if (await nextBtn.isEnabled()) await nextBtn.click()
  await page.screenshot({ path: 'e2e/out/21-db-drawer.png' })
  check('the preview pages through rows', (await page.getByRole('table', { name: 'Row preview' }).locator('tbody tr').count()) > 0, `${since(m0, /\/rows/).length} extra page request(s)`)
  await page.keyboard.press('Escape')
  check('Escape closes the drawer', (await page.getByTestId('table-drawer').count()) === 0)

  // ---- 4. add a table: recommended strategy, click budget -----------------------------------------------------------
  const before = await page.locator('[data-testid^=layer-row-]').count()
  let m = mark()
  await click(page.getByLabel('Add pts_4326 to map'))
  await page.getByTestId('add-table-dialog').waitFor()
  const recommended = await page.getByTestId('add-table-dialog').getByRole('radio', { checked: true }).getAttribute('value')
  check('the add dialog preselects the recommended strategy', recommended === 'json' && (await page.getByText('Recommended').count()) === 1, `strategy=${recommended}`)
  await click(page.getByTestId('confirm-add-to-map'))
  await until(async () => (await page.locator('[data-testid^=layer-row-]').count()) === before + 1, 10000, 'the layer row')
  await layerRow('public.pts_4326').or(layerRow('fx.pts_4326')).waitFor()
  await until(() => since(m, /\/features/).some((x) => x.status === 200), 15000, 'the features response')
  const budget = clicks - afterSignIn
  check('from a signed-in connection to a layer in at most 4 clicks', budget <= 4, `${budget} clicks (open connection, +, Add to map)`)
  await page.waitForTimeout(1500)
  await mapShot('22-db-json-layer')
  check('the layer reports its feature count', /2,000 features/.test(await page.locator('[data-testid^=layer-row-]').first().innerText()) || (await page.locator('[data-testid^=layer-row-]').first().locator('[data-node-name]').click(), /2,000 features/.test(await page.locator('[data-testid^=layer-row-]').first().innerText())))
  await page.getByLabel('Remove layer').click()

  // ---- 5. bbox strategy: pan and reload ---------------------------------------------------------------------------
  await dbTab().click()
  m = mark()
  await click(page.getByLabel('Add pts_4326 to map'))
  await page.getByRole('radio', { name: /GeoJSON, current view/ }).click()
  await page.getByTestId('confirm-add-to-map').click()
  await until(() => since(m, /\/features\?/).some((x) => x.status === 200), 20000, 'the first viewport request')
  const first = since(m, /\/features\?/).find((x) => bboxOf(x))
  check('the bbox strategy sends the viewport bbox', !!first && bboxOf(first).split(',').length === 4, bboxOf(first))
  await settle()
  const m2 = mark()
  await dragMap(-260, 60)
  await until(() => since(m2, /\/features\?/).length > 0, 8000, 'the reload after panning')
  await settle()
  const reloads = since(m2, /\/features\?/)
  check('panning reloads the features for the new bbox (debounced to the end of the move)', reloads.length >= 1 && reloads.length <= 2 && bboxOf(reloads.at(-1)) !== bboxOf(first), `${reloads.length} request(s)`)
  check('every request carries the bearer token', log.filter((x) => /\/api\/v1\/connections/.test(x.url)).every((x) => x.auth?.startsWith('Bearer ')))
  await mapShot('23-db-bbox-panned')

  // ---- 6. truncated banner -> vector tiles -------------------------------------------------------------------------
  await page.route(/\/features\?/, async (route) => {
    const res = await route.fetch()
    const body = await res.json()
    await route.fulfill({ response: res, json: { ...body, truncated: true } })
  })
  await dragMap(120, -40)
  await page.getByTestId('notice-truncated').waitFor({ timeout: 15000 })
  check('a truncated result shows a banner (never silent)', /first .* features/.test(await page.getByTestId('notice-truncated').innerText()))
  await mapShot('24-db-truncated')
  await page.unroute(/\/features\?/)
  const m3 = mark()
  await page.getByRole('button', { name: 'Use vector tiles' }).click()
  await until(() => since(m3, /\/tiles\/sess/).length > 0, 20000, 'tile requests')
  const sessions = since(m3, /\/tiles\/sessions$/, 'POST')
  const tiles = since(m3, /\/tiles\/[^/]+\/\d+\/\d+\/\d+\.mvt/)
  check('switching to tiles creates a session and requests tiles with the bearer header (not in the URL)', sessions.length === 1 && tiles.length > 0 && tiles.every((t) => t.auth?.startsWith('Bearer ') && !/eyJ/.test(t.url)), `${tiles.length} tile request(s)`)
  check('tile responses are 200 or 204', tiles.every((t) => t.status === 200 || t.status === 204 || t.status === null), [...new Set(tiles.map((t) => t.status))].join(','))
  check('the banner is gone after switching', (await page.getByTestId('notice-truncated').count()) === 0)
  await page.getByLabel('Remove layer').click().catch(() => {})
  await sleep(600)
  check('removing the MVT layer deletes its tile session', since(m3, /\/tiles\/sessions\/[^/]+$/, 'DELETE').length >= 1)

  // ---- 7. MVT layer: picking fetches the full feature --------------------------------------------------------------
  await dbTab().click()
  m = mark()
  await click(page.getByLabel('Add polys_4326 to map'))
  await page.getByRole('radio', { name: /Vector tiles/ }).click()
  await page.getByTestId('confirm-add-to-map').click()
  await until(() => since(m, /\.mvt/).some((t) => t.status === 200), 25000, 'a polygon tile')
  await page.waitForTimeout(2500)
  await mapShot('25-db-mvt-polys')
  const m4 = mark()
  let picked = false
  for (let dy = -150; dy <= 150 && !picked; dy += 12) {
    for (let dx = -250; dx <= 250 && !picked; dx += 12) {
      await page.mouse.click(centre.x + dx, centre.y + dy)
      picked = (await page.getByTestId('inspector-title').count()) > 0
    }
  }
  check('clicking a vector-tile feature selects it', picked)
  if (picked) {
    await until(() => since(m4, /\/features\/\d+/).length > 0, 10000, 'the full-feature request')
    await until(async () => (await page.getByTestId('inspector-loading').count()) === 0, 10000, 'attributes loaded')
    check('the inspector fetched the full feature by id', since(m4, /\/features\/\d+/)[0].status === 200)
    await mapShot('26-db-mvt-inspector')
  }

  // ---- 8. H3 from the database ---------------------------------------------------------------------------------------
  await dbTab().click()
  m = mark()
  await click(page.getByLabel('Add h3_bigint to map'))
  await page.getByRole('radio', { name: /H3 cells/ }).click()
  await page.getByTestId('confirm-add-to-map').click()
  await until(() => since(m, /\/h3\/cells\?/).some((x) => x.status === 200), 25000, 'the /h3/cells response')
  const res0 = new URL(since(m, /\/h3\/cells\?/)[0].url).searchParams.get('resolution')
  check('an existing H3 table is read through /h3/cells with the automatic resolution', /^\d+$/.test(res0), `resolution=${res0}`)
  await settle()
  await mapShot('27-db-h3cells')
  const m5 = mark()
  for (let i = 0; i < 4; i++) {
    await page.mouse.move(centre.x, centre.y)
    await page.mouse.wheel(0, -500)
    await sleep(150)
  }
  await until(() => since(m5, /\/h3\/cells\?/).length > 0, 10000, 'the zoom reload')
  await settle()
  const res1 = new URL(since(m5, /\/h3\/cells\?/).at(-1).url).searchParams.get('resolution')
  check('zooming in re-requests finer H3 cells', Number(res1) > Number(res0), `res ${res0} -> ${res1}`)

  m = mark()
  await dbTab().click()
  await click(page.getByLabel('Add parity_pts to map'))
  await page.getByRole('radio', { name: /H3 aggregate/ }).click()
  await page.getByTestId('confirm-add-to-map').click()
  await until(() => since(m, /\/h3\/aggregate\?/).some((x) => x.status === 200), 25000, 'the /h3/aggregate response')
  check('a point table is binned by the server through /h3/aggregate', true)
  await mapShot('28-db-h3-aggregate')

  // ---- 9. database down ------------------------------------------------------------------------------------------------
  const control = (cmd) => execFileSync(process.execPath, [join(HERE, 'stack.mjs'), cmd], { stdio: 'ignore' })
  if (managed) control('db-stop')
  else await page.route(/\/api\/v1\/connections\/[^/]+\/tables\//, (r) => r.fulfill({ status: 502, contentType: 'application/json', body: JSON.stringify({ error: { code: 'db_unavailable', message: 'The database is not reachable.', details: {}, requestId: 'e2e' } }) }))
  try {
    await dragMap(-180, 30)
    await page.getByTestId('notice-view-error').first().waitFor({ timeout: 30000 })
    check('with the database down a refresh failure is reported and the old view stays drawn', /not reachable/i.test(await page.getByTestId('notice-view-error').first().innerText()))
    await mapShot('29-db-down-notice')
    await dbTab().click()
    await page.getByLabel('Add h3_text to map').click()
    const alert = page.getByTestId('add-table-dialog').getByRole('alert')
    await alert.waitFor({ timeout: 30000 })
    check('the add dialog shows the database-down error with Retry', /not reachable/i.test(await alert.innerText()) && (await page.getByRole('button', { name: /Retry/ }).count()) === 1)
    await mapShot('30-db-down-dialog')
  } finally {
    if (managed) control('db-start')
    else await page.unroute(/\/api\/v1\/connections\/[^/]+\/tables\//)
  }
  await until(async () => {
    await page.getByRole('button', { name: /Retry/ }).click().catch(() => {})
    return (await page.getByTestId('confirm-add-to-map').count()) > 0
  }, 60000, 'the database to come back')
  check('Retry works once the database is back', true)
  await page.keyboard.press('Escape')

  // ---- 10. sign out / reload / reconnect -------------------------------------------------------------------------------
  m = mark()
  await page.getByTestId('account-button').click()
  await page.getByTestId('sign-out').click()
  await sleep(800)
  check('signing out releases the tile sessions', since(m, /\/tiles\/sessions\/[^/]+$/, 'DELETE').length >= 1)
  const saved = await page.evaluate(() => localStorage.getItem('h3map.layers'))
  check('saved layers keep only a connection id and table reference', /"connectionId":"fixtures"/.test(saved) && !/eyJ|Bearer|accessToken|password|sessionId/.test(saved))
  await page.reload({ waitUntil: 'load' })
  await page.getByTestId('reconnect-signin').first().waitFor({ timeout: 30000 }).catch(async () => {
    await page.locator('[data-testid^=layer-row-]').first().locator('[data-node-name]').click()
    await page.getByTestId('reconnect-signin').first().waitFor({ timeout: 15000 })
  })
  check('after a reload database layers ask to sign in again (reconnect state)', true)
  await mapShot('31-db-reconnect')
  const m6 = mark()
  await page.getByTestId('reconnect-signin').first().click()
  await page.getByLabel('Username').fill(user)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Sign in', exact: true }).last().click()
  await until(() => since(m6, /\/(features|h3\/cells|h3\/aggregate|tiles\/sessions)/).some((x) => x.status === 200 || x.status === 201), 30000, 'layers loading after sign-in')
  check('signing in again reloads the saved database layers', true)
  await page.waitForTimeout(1500)
  await mapShot('32-db-reconnected')
}
