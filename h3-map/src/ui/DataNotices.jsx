import { AlertTriangle, Info, KeyRound } from 'lucide-react'
import { effectiveLayers } from '../layers/tree.js'
import { useDataStore } from '../state/dataStore.js'
import { useLayersStore } from '../state/layersStore.js'
import { useUiStore } from '../state/uiStore.js'
import { noticesFor } from './notices.js'
import { Button } from './Button.jsx'
import { switchLayerToTiles } from './layerActions.js'

/** Banners over the map (top centre, below the toolbar). */
export default function DataNotices() {
  const tree = useLayersStore((s) => s.tree)
  const entries = useDataStore((s) => s.entries)
  const notices = noticesFor(effectiveLayers(tree), entries)
  if (!notices.length) return null
  return (
    <div className="pointer-events-none absolute left-1/2 top-3 z-10 flex w-[min(92vw,560px)] -translate-x-1/2 flex-col gap-1.5" data-testid="data-notices">
      {notices.map((n) => {
        const Icon = n.tone === 'warn' ? AlertTriangle : Info
        return (
          <div key={n.id} role="status" data-testid={`notice-${n.kind}`} className="pointer-events-auto flex items-start gap-2 rounded-lg border border-line bg-panel p-2.5 text-[12px] shadow-float">
            <Icon size={15} className={n.tone === 'warn' ? 'mt-0.5 shrink-0 text-warn' : 'mt-0.5 shrink-0 text-accent'} aria-hidden="true" />
            <span className="min-w-0 flex-1 leading-snug">{n.text}</span>
            {n.tiles && <Button size="sm" variant="solid" className="shrink-0" onClick={() => switchLayerToTiles(n.layerId)}>Use vector tiles</Button>}
            {n.kind === 'view-error' && <Button size="sm" variant="outline" className="shrink-0" onClick={() => useDataStore.getState().retry(n.sourceId)}>Retry</Button>}
          </div>
        )
      })}
    </div>
  )
}

/** Shown inside the layer row when a database layer cannot load because of the session or connection. */
export function ReconnectActions({ entry, sourceId }) {
  if (entry?.needsAuth) {
    return (
      <Button size="sm" variant="solid" className="mt-1" onClick={() => useUiStore.getState().openLogin()} data-testid="reconnect-signin">
        <KeyRound size={12} aria-hidden="true" /> Sign in to reconnect
      </Button>
    )
  }
  if (entry?.needsReconnect) {
    return (
      <Button size="sm" variant="outline" className="mt-1" onClick={() => useUiStore.getState().openLeftTab('database')} data-testid="reconnect-browse">
        Open the Database tab
      </Button>
    )
  }
  return <button type="button" className="cursor-pointer underline" onClick={() => useDataStore.getState().retry(sourceId)}>Retry</button>
}
