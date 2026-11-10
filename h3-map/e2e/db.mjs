// Runs only the database scenario (e2e/db-scenario.mjs) against the stack from `node e2e/stack.mjs up`.
//   node e2e/db.mjs        (npm run test:e2e:db)
// smoke.mjs runs the same scenario after its other checks when E2E_DB=1.
import { chromium } from 'playwright-core'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { runDatabaseScenario } from './db-scenario.mjs'

const stackFile = new URL('./out/stack.json', import.meta.url)
const BASE = process.env.BASE_URL ?? (existsSync(stackFile) ? JSON.parse(readFileSync(stackFile, 'utf8')).baseUrl : 'http://localhost:5173')
const CANDIDATES = [process.env.CHROME_PATH, '/usr/bin/google-chrome', '/usr/bin/chromium', 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].filter(Boolean)
const executablePath = CANDIDATES.find((p) => existsSync(p))
if (!executablePath) throw new Error('No Chrome/Chromium found. Set CHROME_PATH.')
mkdirSync('e2e/out', { recursive: true })

const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`)
}
const browser = await chromium.launch({ executablePath, headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'] })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
const errors = []
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
page.on('console', (m) => m.type() === 'error' && errors.push(`console: ${m.text()}`))
let code = 0
try {
  await page.goto(BASE, { waitUntil: 'load' })
  await page.evaluate(() => localStorage.removeItem('h3map.layers'))
  await page.reload({ waitUntil: 'load' })
  await page.getByTestId('status-zoom').waitFor()
  await page.waitForFunction(() => document.querySelectorAll('canvas').length >= 2, null, { timeout: 30000 })
  await runDatabaseScenario({ page, check, base: BASE })
} catch (e) {
  console.log(`FAIL  scenario aborted: ${e.message}`)
  await page.screenshot({ path: 'e2e/out/db-failure.png' }).catch(() => {})
  code = 1
}
const fatal = errors.filter((e) => !/Failed to load resource|net::ERR|WebGL|GPU stall|swiftshader|status of 50[24]/i.test(e))
check('no uncaught page errors', fatal.length === 0, fatal.slice(0, 3).join(' || '))
await browser.close()
const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
process.exit(code || (failed.length ? 1 : 0))
