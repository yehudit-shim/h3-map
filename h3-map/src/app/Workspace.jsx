import { useEffect, useSyncExternalStore } from 'react'
import { MapProvider } from 'react-map-gl/maplibre'
import MapView from '../map/MapView.jsx'
import MapRegistrar from '../map/MapRegistrar.jsx'
import { useMapStore } from '../state/mapStore.js'
import { useSelectionStore } from '../state/selectionStore.js'
import { useUiStore } from '../state/uiStore.js'
import LayerProperties from '../ui/LayerProperties.jsx'
import Legend from '../ui/Legend.jsx'
import MapControls from '../ui/MapControls.jsx'
import StatusBar from '../ui/StatusBar.jsx'
import Toolbar from '../ui/Toolbar.jsx'
import { LeftSidebar, RightSidebar } from '../ui/Sidebars.jsx'
import { Spinner, Toaster } from '../ui/feedback.jsx'
import ErrorBoundary from './ErrorBoundary.jsx'

const PANEL_INSET = 336 // panel width (320) + gutters
const WIDE_QUERY = '(min-width: 1024px)'
const subscribeWide = (cb) => {
  const mq = window.matchMedia(WIDE_QUERY)
  mq.addEventListener('change', cb)
  return () => mq.removeEventListener('change', cb)
}
const getWide = () => window.matchMedia(WIDE_QUERY).matches

/** App shell: toolbar / map with floating panels / status bar (docs/UI_UX_DESIGN.md §1). */
export default function Workspace() {
  const theme = useUiStore((s) => s.theme)
  const leftOpen = useUiStore((s) => s.leftOpen)
  const rightOpen = useUiStore((s) => s.rightOpen)
  const mapStatus = useMapStore((s) => s.mapStatus)

  useEffect(() => {
    document.documentElement.dataset.theme = theme
  }, [theme])

  // Keyboard: [ and ] toggle the sidebars, Escape clears the map selection (when not typing in a field)
  useEffect(() => {
    const onKey = (e) => {
      if (e.target instanceof HTMLElement && /^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName)) return
      const ui = useUiStore.getState()
      if (e.key === '[') ui.setLeftOpen(!ui.leftOpen)
      if (e.key === ']') ui.setRightOpen(!ui.rightOpen)
      if (e.key === 'Escape' && !e.defaultPrevented && !ui.propertiesId) useSelectionStore.getState().clear()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Below the desktop breakpoint two floating panels would overlap: keep only the left one open.
  const wide = useSyncExternalStore(subscribeWide, getWide, () => true)
  useEffect(() => {
    if (!wide && leftOpen && rightOpen) useUiStore.getState().setRightOpen(false)
  }, [wide, leftOpen, rightOpen])

  const leftInset = leftOpen && wide ? PANEL_INSET : 8
  const rightInset = rightOpen && wide ? PANEL_INSET : 8

  return (
    <MapProvider>
      <div className="flex h-full flex-col" style={{ '--left-inset': `${leftInset - 8}px`, '--right-inset': `${rightInset - 8}px` }}>
        <Toolbar />
        <main className="relative min-h-0 flex-1 overflow-hidden" aria-label="Map workspace">
          <ErrorBoundary name="map">
            <MapView />
            <MapRegistrar />
          </ErrorBoundary>
          {mapStatus === 'loading' && (
            <div className="pointer-events-none absolute left-1/2 top-4 z-10 flex -translate-x-1/2 items-center gap-2 rounded-full border border-line bg-panel px-3 py-1.5 text-[12px] shadow-float" role="status">
              <Spinner /> Loading map…
            </div>
          )}
          <LeftSidebar />
          <RightSidebar />
          <div className="absolute bottom-8 z-10 transition-[left] duration-150" style={{ left: leftInset }}>
            <Legend />
          </div>
          <div className="absolute top-3 z-10 transition-[right] duration-150" style={{ right: rightInset }}>
            <MapControls />
          </div>
          <Toaster />
        </main>
        <LayerProperties />
        <StatusBar />
      </div>
    </MapProvider>
  )
}
