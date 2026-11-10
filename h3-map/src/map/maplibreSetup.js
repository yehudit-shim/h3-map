// maplibre-gl 6 locates its web worker relative to its own module URL. Once Vite pre-bundles (dev) or
// chunks (build) the library that URL is wrong ("Worker failed to load"), so the worker file is
// emitted as an asset and registered explicitly. Import this module before creating any <Map>.
import { setWorkerUrl } from 'maplibre-gl'
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url'

setWorkerUrl(new URL(workerUrl, window.location.href).href)
