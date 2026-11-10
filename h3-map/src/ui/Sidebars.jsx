import { Database, Hexagon, Layers as LayersIcon, MousePointerClick, SlidersHorizontal } from 'lucide-react'
import { cn } from '../lib/cn.js'
import { useUiStore } from '../state/uiStore.js'
import ErrorBoundary from '../app/ErrorBoundary.jsx'
import DataPanel from './DataPanel.jsx'
import H3Panel from './H3Panel.jsx'
import Inspector from './Inspector.jsx'
import LayerManager from './LayerManager.jsx'
import StylePanel from './StylePanel.jsx'

function Tabs({ tabs, value, onChange, label }) {
  return (
    <div role="tablist" aria-label={label} className="flex shrink-0 border-b border-line bg-panel">
      {tabs.map((t) => {
        const Icon = t.icon
        const active = value === t.id
        return (
          <button
            key={t.id}
            role="tab"
            id={`tab-${t.id}`}
            aria-selected={active}
            aria-controls={`panel-${t.id}`}
            onClick={() => onChange(t.id)}
            className={cn('flex h-9 flex-1 cursor-pointer items-center justify-center gap-1.5 border-b-2 text-[12px] transition-colors', active ? 'border-accent text-fg' : 'border-transparent text-muted hover:text-fg')}
          >
            <Icon size={14} aria-hidden="true" /> {t.label}
          </button>
        )
      })}
    </div>
  )
}

const panelBase = 'absolute z-20 flex flex-col overflow-hidden border-line bg-panel shadow-float transition-transform duration-150 ease-out'

function PanelBody({ id, children, name }) {
  return (
    <div role="tabpanel" id={`panel-${id}`} aria-labelledby={`tab-${id}`} className="min-h-0 flex-1 overflow-y-auto">
      <ErrorBoundary name={name}>{children}</ErrorBoundary>
    </div>
  )
}

const LEFT_TABS = [
  { id: 'layers', label: 'Layers', icon: LayersIcon },
  { id: 'data', label: 'Data', icon: Database },
  { id: 'h3', label: 'H3', icon: Hexagon },
]
const RIGHT_TABS = [
  { id: 'inspector', label: 'Inspector', icon: MousePointerClick },
  { id: 'style', label: 'Style', icon: SlidersHorizontal },
]

export function LeftSidebar() {
  const open = useUiStore((s) => s.leftOpen)
  const tab = useUiStore((s) => s.leftTab)
  return (
    <aside
      aria-label="Layers and data"
      aria-hidden={!open}
      inert={!open}
      className={cn(panelBase, 'bottom-2 left-2 top-2 w-[min(320px,calc(100vw-1rem))] rounded-xl border', !open && '-translate-x-[110%]')}
    >
      <Tabs tabs={LEFT_TABS} value={tab} onChange={(t) => useUiStore.setState({ leftTab: t })} label="Left sidebar" />
      <PanelBody id={tab} name={tab}>
        {tab === 'layers' && <LayerManager />}
        {tab === 'data' && <DataPanel />}
        {tab === 'h3' && <H3Panel />}
      </PanelBody>
    </aside>
  )
}

export function RightSidebar() {
  const open = useUiStore((s) => s.rightOpen)
  const tab = useUiStore((s) => s.rightTab)
  return (
    <aside
      aria-label="Information panel"
      aria-hidden={!open}
      inert={!open}
      className={cn(panelBase, 'bottom-2 right-2 top-2 w-[min(320px,calc(100vw-1rem))] rounded-xl border', !open && 'translate-x-[110%]')}
    >
      <Tabs tabs={RIGHT_TABS} value={tab} onChange={(t) => useUiStore.getState().setRightTab(t)} label="Right panel" />
      <PanelBody id={tab} name={tab}>
        {tab === 'inspector' && <Inspector />}
        {tab === 'style' && <StylePanel />}
      </PanelBody>
    </aside>
  )
}
