import { useEffect, useRef, useState } from 'react'
import { cellToLatLng, getResolution } from 'h3-js'
import { Check, Database, Hexagon, Layers as LayersIcon, Map as MapIcon, Moon, PanelLeft, PanelRight, Search, Sun } from 'lucide-react'
import { BASEMAPS } from '../map/basemaps.js'
import { flyToView } from '../map/mapActions.js'
import { parseSearch } from '../lib/searchParse.js'
import { cn } from '../lib/cn.js'
import { notify } from '../state/notifyStore.js'
import { useUiStore } from '../state/uiStore.js'
import { Button, IconButton } from './Button.jsx'

function BasemapMenu() {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  const basemapId = useUiStore((s) => s.basemapId)
  const current = BASEMAPS.find((b) => b.id === basemapId) ?? BASEMAPS[0]
  useEffect(() => {
    if (!open) return
    const onDown = (e) => !ref.current?.contains(e.target) && setOpen(false)
    const onKey = (e) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('pointerdown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])
  return (
    <div ref={ref} className="relative">
      <Button variant="outline" onClick={() => setOpen((o) => !o)} aria-haspopup="menu" aria-expanded={open} aria-label={`Basemap: ${current.label}`}>
        <MapIcon size={15} aria-hidden="true" /> <span className="max-sm:hidden">{current.label}</span>
      </Button>
      {open && (
        <div role="menu" aria-label="Basemaps" className="absolute left-0 top-10 z-40 w-56 rounded-lg border border-line bg-panel p-1.5 shadow-float">
          {BASEMAPS.map((b) => (
            <button
              key={b.id}
              role="menuitemradio"
              aria-checked={b.id === basemapId}
              onClick={() => {
                useUiStore.getState().setBasemap(b.id)
                setOpen(false)
              }}
              className="flex w-full cursor-pointer items-center gap-2.5 rounded-md p-1.5 text-left hover:bg-hover"
            >
              <span className="h-8 w-10 shrink-0 rounded border border-line" style={{ background: `linear-gradient(135deg, ${b.swatch[0]} 50%, ${b.swatch[1]} 50%)` }} />
              <span className="min-w-0 flex-1">
                <span className="block text-[13px]">{b.label}</span>
                <span className="block truncate text-[10px] text-muted">{b.provider}</span>
              </span>
              {b.id === basemapId && <Check size={14} className="text-accent" aria-hidden="true" />}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function SearchBox() {
  const [value, setValue] = useState('')
  const submit = (e) => {
    e.preventDefault()
    const q = parseSearch(value)
    if (!q) {
      notify('Enter coordinates as “lat, lon” (e.g. 48.8606, 2.3376) or a valid H3 index.', { kind: 'warn', key: 'search' })
      return
    }
    if (q.kind === 'coords') flyToView({ lat: q.lat, lon: q.lon, zoom: 14 })
    else {
      const [lat, lon] = cellToLatLng(q.h3)
      flyToView({ lat, lon, zoom: Math.min(18, getResolution(q.h3) + 5.5) })
    }
  }
  return (
    <form onSubmit={submit} role="search" className="relative min-w-[110px] flex-1 sm:max-w-sm">
      <Search size={14} className="pointer-events-none absolute left-2.5 top-2.5 text-muted" aria-hidden="true" />
      <input
        aria-label="Go to coordinates or H3 index"
        placeholder="Go to  lat, lon  or  H3 index"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        className="h-8 w-full rounded-md border border-line bg-raised pl-8 pr-2 text-[13px] outline-none placeholder:text-muted focus-visible:border-accent"
      />
    </form>
  )
}

export default function Toolbar() {
  const theme = useUiStore((s) => s.theme)
  const leftOpen = useUiStore((s) => s.leftOpen)
  const rightOpen = useUiStore((s) => s.rightOpen)
  const ui = useUiStore.getState
  return (
    <header className="z-30 flex h-12 shrink-0 items-center gap-2 border-b border-line bg-panel px-2">
      <IconButton label={leftOpen ? 'Hide left sidebar' : 'Show left sidebar'} icon={PanelLeft} active={leftOpen} onClick={() => ui().setLeftOpen(!leftOpen)} />
      <div className="flex items-center gap-2 pr-1" aria-label="H3 Map">
        <Hexagon size={20} className="text-accent" strokeWidth={2.2} aria-hidden="true" />
        <span className="text-[14px] font-semibold tracking-tight max-md:hidden">H3 Map</span>
      </div>
      <div className="mx-1 h-5 w-px bg-line max-sm:hidden" />
      <SearchBox />
      <BasemapMenu />
      <Button variant="outline" className="max-md:hidden" onClick={() => ui().openLeftTab('data')}>
        <Database size={14} aria-hidden="true" /> Add data
      </Button>
      <div className="ml-auto flex items-center gap-1">
        <IconButton label="Open layers" icon={LayersIcon} className="max-md:hidden" onClick={() => ui().openLeftTab('layers')} />
        <IconButton label={theme === 'dark' ? 'Switch to light interface' : 'Switch to dark interface'} icon={theme === 'dark' ? Sun : Moon} onClick={() => ui().setTheme(theme === 'dark' ? 'light' : 'dark')} />
        <IconButton label={rightOpen ? 'Hide right panel' : 'Show right panel'} icon={PanelRight} active={rightOpen} className={cn(rightOpen && 'text-accent')} onClick={() => ui().setRightOpen(!rightOpen)} />
      </div>
    </header>
  )
}
