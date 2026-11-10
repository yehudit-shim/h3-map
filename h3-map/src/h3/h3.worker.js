// Web Worker entry for bulk H3 work: point -> cell aggregation and batch latLngToCell.
import { createH3Jobs } from './h3Jobs.js'

const jobs = createH3Jobs((msg, transfer) => self.postMessage(msg, transfer ?? []))
self.onmessage = (e) => {
  jobs.handle(e.data)
}
