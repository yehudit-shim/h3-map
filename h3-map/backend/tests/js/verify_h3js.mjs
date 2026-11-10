// Checks the committed h3-py fixture against the frontend library (h3-js v4).
// Run: node tests/js/verify_h3js.mjs   (uses h3-map/node_modules)
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { latLngToCell } = require('../../../node_modules/h3-js')
const fixture = JSON.parse(readFileSync(fileURLToPath(new URL('../fixtures/h3_parity_10k.json', import.meta.url)), 'utf8'))

let bad = 0
fixture.points.forEach(([lon, lat], i) => {
  if (latLngToCell(lat, lon, fixture.resolution) !== fixture.cells[i]) bad++
})
console.log(JSON.stringify({ points: fixture.points.length, mismatches: bad }))
process.exit(bad === 0 ? 0 : 1)
