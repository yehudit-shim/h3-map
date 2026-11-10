// Web Worker entry: all heavy parsing (JSON, CSV) happens here so the UI thread stays responsive.
import { createJob } from './jobs.js'

const job = createJob((msg) => self.postMessage(msg))
self.onmessage = (e) => {
  job.handle(e.data)
}
