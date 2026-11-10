// Client side of the parse jobs (jobs.js). Runs the job in a Web Worker so parsing a large file never
// blocks the UI; falls back to the main thread only where Workers do not exist (tests).
import { createJob } from './jobs.js'

export class ParseCancelled extends Error {
  constructor() {
    super('Cancelled')
    this.name = 'ParseCancelled'
  }
}

/** Absolute http(s) URL or a readable error message. */
export function checkUrl(value) {
  let url
  try {
    url = new URL(String(value).trim(), typeof location === 'undefined' ? undefined : location.href)
  } catch {
    return { error: 'Enter a valid URL.' }
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return { error: 'Only http(s) URLs are supported.' }
  return { url: url.href }
}

function spawn(onMessage) {
  if (typeof Worker === 'undefined') {
    const job = createJob(onMessage)
    return { post: (m) => void job.handle(m), stop() {} }
  }
  const worker = new Worker(new URL('./parse.worker.js', import.meta.url), { type: 'module' })
  worker.onmessage = (e) => onMessage(e.data)
  worker.onerror = (e) => onMessage({ type: 'error', message: e.message || 'The parser crashed' })
  return { post: (m) => worker.postMessage(m), stop: () => worker.terminate() }
}

/**
 * Start a parse job.
 * @param {{format:'geojson'|'csv', source:{file?:File,url?:string,text?:string}, csv?:{latCol:string,lonCol:string}}} request
 *   For CSV without `csv` columns the job pauses after reading the header: `onInspect` receives
 *   {columns, types, detected, sample, rowCount} and the caller continues with `build(lat, lon)`.
 * @param {{onProgress?: (p:{phase:string,loaded?:number,total?:number})=>void, onInspect?: (i:object)=>void}} [hooks]
 * @returns {{promise: Promise<{data:object, fields:object[], geometry:string, bounds:number[]|null, featureCount:number, warnings:string[], report?:object, csv?:object}>, build:(lat:string,lon:string)=>void, cancel:()=>void}}
 */
export function runParse(request, { onProgress, onInspect } = {}) {
  const features = []
  let ctl
  let settle
  const promise = new Promise((resolve, reject) => {
    settle = { resolve, reject }
  })
  const finish = (fn) => {
    ctl.stop()
    fn()
  }
  const onMessage = (msg) => {
    switch (msg.type) {
      case 'progress':
        onProgress?.(msg)
        break
      case 'csv-inspect':
        onInspect?.(msg)
        break
      case 'chunk':
        for (let i = 0; i < msg.features.length; i++) features.push(msg.features[i])
        break
      case 'done':
        finish(() => settle.resolve({ ...msg.meta, data: { type: 'FeatureCollection', features } }))
        break
      case 'error':
        finish(() => settle.reject(new Error(msg.message)))
        break
    }
  }
  ctl = spawn(onMessage)
  ctl.post({ type: 'start', ...request })
  return {
    promise,
    build: (lat, lon) => ctl.post({ type: 'csv-build', lat, lon }),
    cancel: () => finish(() => settle.reject(new ParseCancelled())),
  }
}
