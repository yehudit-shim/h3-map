import { useEffect, useMemo, useRef } from 'react'
import { Crosshair, Folder, SlidersHorizontal, X } from 'lucide-react'
import { getSource } from '../data/sources.js'
import { getLayerType } from '../layers/index.js'
import { effectiveLayers, findNode, flattenLayers, isGroup, layerIdsOf, pathOf } from '../layers/tree.js'
import { formatCoord, formatNumber } from '../lib/format.js'
import { useDataStore } from '../state/dataStore.js'
import { useLayersStore } from '../state/layersStore.js'
import { useRuntimeStore } from '../state/runtimeStore.js'
import { useUiStore } from '../state/uiStore.js'
import { Button, IconButton } from './Button.jsx'
import { Section } from './feedback.jsx'
import { nodeBounds, zoomToNode } from './layerActions.js'
import { LayerTypeIcon } from './layerIcons.jsx'

function Rows({ rows }) {
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
      {rows.filter(Boolean).map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-[12px] text-muted">{k}</dt>
          <dd className="min-w-0 break-words text-right font-mono text-[12px]" data-testid={`prop-${k}`}>{v}</dd>
        </div>
      ))}
    </dl>
  )
}

const pct = (v) => `${Math.round(v * 100)}%`

function ExtentSection({ bounds }) {
  if (!bounds) return <Section title="Extent"><div className="text-[12px] text-muted">Not available until the data has loaded.</div></Section>
  const [w, s, e, n] = bounds
  return (
    <Section title="Extent (EPSG:4326)">
      <Rows rows={[['West', formatCoord(w)], ['South', formatCoord(s)], ['East', formatCoord(e)], ['North', formatCoord(n)], ['Center', `${formatCoord((s + n) / 2)}, ${formatCoord((w + e) / 2)}`]]} />
    </Section>
  )
}

function LayerBody({ node, effective }) {
  const entry = useDataStore((s) => s.entries[node.sourceId])
  const info = useRuntimeStore((s) => s.info[node.id])
  const type = getLayerType(node.type)
  const source = getSource(node.sourceId)
  return (
    <>
      <Section title="General">
        <Rows
          rows={[
            ['Layer type', type?.label ?? node.type],
            ['Visible', effective?.visible ? 'Yes' : node.visible ? 'No (group hidden)' : 'No'],
            ['Opacity', effective && effective.opacity !== node.opacity ? `${pct(node.opacity)} (effective ${pct(effective.opacity)})` : pct(node.opacity)],
            ['Layer id', node.id],
          ]}
        />
        {type?.description && <p className="mt-2 text-[11px] leading-snug text-muted">{type.description}</p>}
      </Section>
      <Section title="Data source">
        <Rows
          rows={[
            ['Name', source?.name ?? node.sourceId],
            ['Kind', source?.kind ?? '–'],
            ['Geometry', source?.geometry ?? '–'],
            ['Status', entry?.status ?? 'not loaded'],
            entry?.featureCount != null && ['Features', formatNumber(entry.featureCount)],
            info?.resolution != null && ['H3 resolution', String(info.resolution)],
            info?.cellCount != null && ['H3 cells', formatNumber(info.cellCount)],
          ]}
        />
        {source?.description && <p className="mt-2 text-[11px] leading-snug text-muted">{source.description}</p>}
      </Section>
      {source?.fields?.length > 0 && (
        <Section title={`Attributes (${source.fields.length})`}>
          <table className="w-full text-[12px]">
            <thead><tr className="text-left text-[11px] text-muted"><th className="pb-1 font-normal">Field</th><th className="pb-1 text-right font-normal">Type</th></tr></thead>
            <tbody>
              {source.fields.map((f) => (
                <tr key={f.name} className="border-t border-line/60"><td className="py-0.5 font-mono">{f.name}</td><td className="py-0.5 text-right text-muted">{f.type}</td></tr>
              ))}
            </tbody>
          </table>
        </Section>
      )}
      <ExtentSection bounds={entry?.bounds ?? null} />
      <Section title="Style configuration">
        <pre className="max-h-48 overflow-auto rounded-md bg-raised p-2 font-mono text-[11px] leading-snug" data-testid="prop-style">{JSON.stringify(node.style, null, 2)}</pre>
      </Section>
    </>
  )
}

function GroupBody({ node, effective }) {
  const entries = useDataStore((s) => s.entries)
  const layers = flattenLayers(node.children)
  const groups = useMemo(() => {
    let n = 0
    const visit = (list) => list.forEach((c) => isGroup(c) && (n++, visit(c.children)))
    visit(node.children)
    return n
  }, [node])
  const visibleCount = effective.filter((l) => l.visible).length
  return (
    <>
      <Section title="General">
        <Rows rows={[['Layers', String(layers.length)], ['Sub-groups', String(groups)], ['Visible layers', String(visibleCount)], ['Opacity', pct(node.opacity)], ['Group id', node.id]]} />
      </Section>
      <Section title="Contents">
        <ul className="space-y-1">
          {layers.map((l) => (
            <li key={l.id} className="flex items-center gap-2 text-[12px]">
              <LayerTypeIcon icon={getLayerType(l.type)?.icon} size={13} className="text-muted" />
              <span className="truncate">{l.name}</span>
            </li>
          ))}
          {!layers.length && <li className="text-[12px] text-muted">Empty group</li>}
        </ul>
      </Section>
      <ExtentSection bounds={nodeBounds(node, entries)} />
    </>
  )
}

/** Modal with a layer's or group's metadata (QGIS "Layer Properties > Information"). */
export default function LayerProperties() {
  const id = useUiStore((s) => s.propertiesId)
  const tree = useLayersStore((s) => s.tree)
  const node = id ? findNode(tree, id) : null
  const close = useUiStore((s) => s.closeProperties)
  const closeRef = useRef(null)
  const hasBounds = useDataStore((s) => !!(node && nodeBounds(node, s.entries)))

  useEffect(() => {
    if (id && !node) close() // removed while open
  }, [id, node, close])
  useEffect(() => {
    if (node) closeRef.current?.focus()
  }, [node])

  const effective = useMemo(() => {
    if (!node) return null
    const ids = new Set(layerIdsOf(node))
    return effectiveLayers(tree).filter((l) => ids.has(l.id))
  }, [tree, node])

  if (!node) return null
  const group = isGroup(node)
  const path = pathOf(tree, node.id)
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4" onPointerDown={(e) => e.target === e.currentTarget && close()}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="layer-properties-title"
        className="flex max-h-[85vh] w-[min(460px,100%)] flex-col overflow-hidden rounded-xl border border-line bg-panel shadow-float"
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.stopPropagation()
            close()
          }
        }}
      >
        <div className="flex items-start gap-2.5 border-b border-line px-4 py-3">
          {group ? <Folder size={18} className="mt-0.5 text-warn" aria-hidden="true" /> : <LayerTypeIcon icon={getLayerType(node.type)?.icon} size={18} className="mt-0.5 text-accent" />}
          <div className="min-w-0 flex-1">
            <h2 id="layer-properties-title" className="truncate text-[14px] font-semibold">{node.name}</h2>
            <div className="truncate text-[11px] text-muted">
              {group ? 'Group' : 'Layer'} properties{path.length ? ` · in ${path.map((g) => g.name).join(' › ')}` : ''}
            </div>
          </div>
          <IconButton ref={closeRef} label="Close properties" icon={X} size={15} className="h-7 w-7" onClick={close} />
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto" data-testid="layer-properties">
          {group ? <GroupBody node={node} effective={effective} /> : <LayerBody node={node} effective={effective[0]} />}
        </div>
        <div className="flex items-center gap-2 border-t border-line px-4 py-2.5">
          <Button variant="outline" size="sm" disabled={!hasBounds} onClick={() => zoomToNode(node)}><Crosshair size={13} aria-hidden="true" /> Zoom to {group ? 'group' : 'layer'}</Button>
          {!group && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                useLayersStore.getState().setActive(node.id)
                useUiStore.getState().openStyle()
                close()
              }}
            >
              <SlidersHorizontal size={13} aria-hidden="true" /> Edit style
            </Button>
          )}
          <Button variant="solid" size="sm" className="ml-auto" onClick={close}>Close</Button>
        </div>
      </div>
    </div>
  )
}
