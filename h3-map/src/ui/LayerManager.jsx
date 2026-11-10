import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle, ArrowDown, ArrowUp, ChevronDown, ChevronRight, ChevronsDownUp, ChevronsUpDown, Copy, Crosshair, Download, Eye, EyeOff,
  Folder, FolderOpen, FolderPlus, GripVertical, Info, Layers, MoreHorizontal, Pencil, Plus, RotateCcw, Save, SlidersHorizontal, Trash2, Upload,
} from 'lucide-react'
import { getLayerType } from '../layers/index.js'
import { countNodes, findNode, flattenLayers, isDescendant, isGroup, layerIdsOf } from '../layers/tree.js'
import { getSource } from '../data/sources.js'
import { cn } from '../lib/cn.js'
import { useDataStore } from '../state/dataStore.js'
import { useLayersStore } from '../state/layersStore.js'
import { notify } from '../state/notifyStore.js'
import { useRuntimeStore } from '../state/runtimeStore.js'
import { useUiStore } from '../state/uiStore.js'
import { IconButton } from './Button.jsx'
import { Slider } from './controls.jsx'
import { EmptyState, Spinner } from './feedback.jsx'
import { download, dropPosition, importLayersFile, nodeActions, nodeBounds, reloadSourceFile, zoomToNode } from './layerActions.js'
import { LayerTypeIcon } from './layerIcons.jsx'
import { Menu } from './Menu.jsx'

const DRAG_MIME = 'application/x-h3map-node'
const INDENT_PX = 14
const IMPORT_INPUT_ID = 'import-layers-input'

/** Shared manager state: drag-and-drop, inline rename and the context menu. */
const ManagerContext = createContext(null)
const useManager = () => useContext(ManagerContext)
const store = useLayersStore.getState

function RenameInput({ initial, onDone, label }) {
  const ref = useRef(null)
  useEffect(() => ref.current?.select(), [])
  const [value, setValue] = useState(initial)
  const commit = () => onDone(value)
  return (
    <input
      ref={ref}
      aria-label={label}
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={commit}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation()
        if (e.key === 'Enter') commit()
        if (e.key === 'Escape') onDone(initial)
      }}
      className="h-6 w-full rounded border border-accent bg-raised px-1.5 text-[13px] outline-none"
    />
  )
}

/** File sources restored from a saved project have no data: choose the file again. */
function ReloadFileButton({ sourceId }) {
  const inputRef = useRef(null)
  return (
    <>
      <button type="button" className="cursor-pointer underline" onClick={() => inputRef.current?.click()}>Reload file…</button>
      <input
        ref={inputRef}
        type="file"
        className="hidden"
        aria-label="Reload data file"
        onChange={(e) => {
          const file = e.target.files?.[0]
          e.target.value = ''
          if (file) reloadSourceFile(sourceId, file)
        }}
      />
    </>
  )
}

function OpacityRow({ node }) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-12 text-[11px] text-muted">Opacity</span>
      <Slider aria-label={`Opacity of ${node.name}`} value={node.opacity} min={0} max={1} step={0.05} onChange={(v) => store().setOpacity(node.id, v)} />
      <span className="w-8 text-right font-mono text-[11px] text-muted">{Math.round(node.opacity * 100)}%</span>
    </div>
  )
}

/** Drag source + drop target behaviour of one row. */
function useRowDnd(node) {
  const { dragId, setDragId, over, setOver } = useManager()
  const tree = useLayersStore((s) => s.tree)
  const canDrop = dragId && dragId !== node.id && !isDescendant(tree, dragId, node.id)
  const position = (e) => {
    const r = e.currentTarget.getBoundingClientRect()
    return dropPosition(e.clientY - r.top, r.height, { group: isGroup(node), expanded: node.expanded })
  }
  return {
    indicator: over?.id === node.id ? over.position : null,
    dragging: dragId === node.id,
    handlers: {
      draggable: true,
      onDragStart: (e) => {
        e.stopPropagation()
        e.dataTransfer?.setData(DRAG_MIME, node.id)
        if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move'
        setDragId(node.id)
      },
      onDragEnd: () => {
        setDragId(null)
        setOver(null)
      },
      onDragOver: (e) => {
        if (!canDrop) return
        e.preventDefault()
        e.stopPropagation()
        if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'
        const p = position(e)
        if (over?.id !== node.id || over.position !== p) setOver({ id: node.id, position: p })
      },
      onDrop: (e) => {
        if (!canDrop) return
        e.preventDefault()
        e.stopPropagation()
        const ok = store().moveNode(dragId, node.id, position(e))
        if (!ok) notify('That move is not possible (groups can be nested at most 6 levels deep).', { kind: 'warn', key: 'dnd' })
        setDragId(null)
        setOver(null)
      },
    },
  }
}

function NodeRow({ node, depth, index, count, parentVisible }) {
  const group = isGroup(node)
  const { renamingId, setRenamingId, openMenu } = useManager()
  const active = useLayersStore((s) => s.activeId === node.id)
  const selected = useLayersStore((s) => s.selectedIds.includes(node.id))
  const multi = useLayersStore((s) => s.selectedIds.length > 1)
  const entry = useDataStore((s) => (group ? undefined : s.entries[node.sourceId]))
  const info = useRuntimeStore((s) => s.info[node.id])
  const { indicator, dragging, handlers } = useRowDnd(node)
  const renaming = renamingId === node.id
  const type = group ? null : getLayerType(node.type)
  const source = group ? null : getSource(node.sourceId)
  const failed = entry?.status === 'error'
  const visible = parentVisible && node.visible
  const noun = group ? 'group' : 'layer'
  const layerCount = group ? layerIdsOf(node).length : 0
  const canZoom = useDataStore((s) => !!nodeBounds(node, s.entries))

  const onNameClick = (e) => {
    if (e.ctrlKey || e.metaKey) store().toggleSelected(node.id)
    else store().setActive(node.id)
  }
  const onNameKey = (e) => {
    const s = store()
    if (e.altKey && e.key === 'ArrowUp') s.moveLayer(node.id, -1)
    else if (e.altKey && e.key === 'ArrowDown') s.moveLayer(node.id, 1)
    else if (e.altKey && e.key === 'ArrowRight') s.indent(node.id)
    else if (e.altKey && e.key === 'ArrowLeft') s.outdent(node.id)
    else if (e.key === 'F2') setRenamingId(node.id)
    else if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) {
      const r = e.currentTarget.getBoundingClientRect()
      openMenu(node, r.left + 24, r.bottom)
    } else return
    e.preventDefault()
    // Moving re-renders the row elsewhere: keep keyboard focus on it.
    const id = node.id
    requestAnimationFrame(() => document.querySelector(`[data-node-name="${id}"]`)?.focus())
  }

  return (
    <li data-testid={`${group ? 'group' : 'layer'}-row-${node.id}`} aria-label={group ? `Group ${node.name}` : undefined}>
      <div
        {...handlers}
        draggable={!renaming}
        onContextMenu={(e) => {
          e.preventDefault()
          if (!selected) store().setActive(node.id)
          openMenu(node, e.clientX, e.clientY)
        }}
        style={{ paddingLeft: 4 + depth * INDENT_PX }}
        className={cn(
          'group/row relative rounded-md border py-1 pr-1.5 transition-colors',
          active ? 'border-accent/60 bg-hover' : selected ? 'border-accent/30 bg-hover/70' : 'border-transparent hover:bg-hover/60',
          dragging && 'opacity-40',
          indicator === 'inside' && 'border-accent bg-accent/10',
        )}
      >
        {indicator === 'before' && <div className="pointer-events-none absolute -top-px left-1 right-1 h-0.5 rounded bg-accent" aria-hidden="true" />}
        {indicator === 'after' && <div className="pointer-events-none absolute -bottom-px left-1 right-1 h-0.5 rounded bg-accent" aria-hidden="true" />}
        <div className="flex items-center gap-1">
          <GripVertical size={13} className="shrink-0 cursor-grab text-muted/50 group-hover/row:text-muted" aria-hidden="true" />
          <IconButton
            label={node.visible ? `Hide ${node.name}` : `Show ${node.name}`}
            icon={node.visible ? Eye : EyeOff}
            className={cn('h-7 w-7', node.visible && !parentVisible && 'opacity-50')}
            title={node.visible && !parentVisible ? 'Hidden because a parent group is hidden' : undefined}
            onClick={() => store().toggleVisible(node.id)}
          />
          {group && (
            <IconButton
              label={node.expanded ? `Collapse ${node.name}` : `Expand ${node.name}`}
              icon={node.expanded ? ChevronDown : ChevronRight}
              size={14}
              className="-ml-1 h-7 w-5"
              aria-expanded={node.expanded}
              onClick={() => store().toggleExpanded(node.id)}
            />
          )}
          <button
            type="button"
            data-node-name={node.id}
            className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 rounded text-left outline-none focus-visible:ring-1 focus-visible:ring-accent"
            onClick={onNameClick}
            onKeyDown={onNameKey}
            aria-current={active}
            aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown Alt+ArrowLeft Alt+ArrowRight F2"
          >
            {group ? (
              (node.expanded ? <FolderOpen size={15} strokeWidth={1.8} aria-hidden="true" className={cn('shrink-0', visible ? 'text-warn' : 'text-muted')} /> : <Folder size={15} strokeWidth={1.8} aria-hidden="true" className={cn('shrink-0', visible ? 'text-warn' : 'text-muted')} />)
            ) : (
              <LayerTypeIcon icon={type?.icon} className={cn('shrink-0', visible ? 'text-accent' : 'text-muted')} />
            )}
            {renaming ? (
              <RenameInput
                label={group ? 'Group name' : 'Layer name'}
                initial={node.name}
                onDone={(v) => {
                  store().renameNode(node.id, v)
                  setRenamingId(null)
                }}
              />
            ) : (
              <span className={cn('truncate text-[13px]', group && 'font-medium', !visible && 'text-muted')} onDoubleClick={() => setRenamingId(node.id)}>{node.name}</span>
            )}
            {group && !renaming && <span className="shrink-0 rounded bg-raised px-1 font-mono text-[10px] text-muted" aria-label={`${layerCount} layers`}>{layerCount}</span>}
          </button>
          {entry?.status === 'loading' && <Spinner label={`Loading ${node.name}`} />}
          {failed && <AlertTriangle size={14} className="shrink-0 text-danger" aria-label="Failed to load" />}
          <IconButton
            label={`More actions for ${node.name}`}
            icon={MoreHorizontal}
            size={14}
            className={cn('h-6 w-6', !active && 'opacity-0 group-hover/row:opacity-100 focus-visible:opacity-100')}
            aria-haspopup="menu"
            onClick={(e) => {
              const r = e.currentTarget.getBoundingClientRect()
              openMenu(node, r.left, r.bottom + 2)
            }}
          />
        </div>

        {active && !multi && (
          <div className="mt-1.5 space-y-1.5 pb-0.5 pl-[50px]">
            <div className="text-[11px] text-muted">
              {group ? (
                `Group · ${layerCount} layer${layerCount === 1 ? '' : 's'}`
              ) : (
                <>
                  {type?.label} · {source?.name ?? node.sourceId ?? 'web service'}
                  {entry?.featureCount != null && ` · ${entry.featureCount.toLocaleString('en-US')} features`}
                  {info?.resolution != null && ` · H3 res ${info.resolution} (${info.cellCount.toLocaleString('en-US')} cells)`}
                </>
              )}
            </div>
            {failed && (
              <div className="text-[12px] text-danger">
                {entry.error}{' '}
                {entry.needsFile ? <ReloadFileButton sourceId={node.sourceId} /> : <button type="button" className="cursor-pointer underline" onClick={() => useDataStore.getState().retry(node.sourceId)}>Retry</button>}
              </div>
            )}
            <OpacityRow node={node} />
            <div className="-ml-1.5 flex flex-wrap items-center gap-0.5">
              <IconButton label="Move up (draw above)" icon={ArrowUp} size={14} className="h-7 w-7" disabled={index === 0} onClick={() => store().moveLayer(node.id, -1)} />
              <IconButton label="Move down (draw below)" icon={ArrowDown} size={14} className="h-7 w-7" disabled={index === count - 1} onClick={() => store().moveLayer(node.id, 1)} />
              <IconButton label={`Zoom to ${noun}`} icon={Crosshair} size={14} className="h-7 w-7" disabled={!canZoom} onClick={() => zoomToNode(node)} />
              <IconButton label={`Rename ${noun}`} icon={Pencil} size={14} className="h-7 w-7" onClick={() => setRenamingId(node.id)} />
              <IconButton label={`Duplicate ${noun}`} icon={Copy} size={14} className="h-7 w-7" onClick={() => store().duplicateNode(node.id)} />
              <IconButton label={`${group ? 'Group' : 'Layer'} properties`} icon={Info} size={14} className="h-7 w-7" onClick={() => useUiStore.getState().openProperties(node.id)} />
              {!group && <IconButton label="Edit style" icon={SlidersHorizontal} size={14} className="h-7 w-7" onClick={() => useUiStore.getState().openStyle()} />}
              <IconButton label={`Remove ${noun}`} icon={Trash2} size={14} className="ml-auto h-7 w-7 hover:text-danger" onClick={() => store().removeNode(node.id)} />
            </div>
          </div>
        )}
      </div>

      {group && node.expanded && (
        node.children.length ? (
          <NodeList nodes={node.children} depth={depth + 1} parentVisible={visible} />
        ) : (
          <div className="py-1 text-[11px] italic text-muted" style={{ paddingLeft: 4 + (depth + 1) * INDENT_PX + 36 }}>Empty group. Drag layers here.</div>
        )
      )}
    </li>
  )
}

function NodeList({ nodes, depth, parentVisible, ...rest }) {
  return (
    <ul className={cn(depth === 0 && 'space-y-0.5')} {...rest}>
      {nodes.map((n, i) => (
        <NodeRow key={n.id} node={n} depth={depth} index={i} count={nodes.length} parentVisible={parentVisible} />
      ))}
    </ul>
  )
}

function ManagerToolbar({ openProjectMenu }) {
  const tree = useLayersStore((s) => s.tree)
  const selectedCount = useLayersStore((s) => s.selectedIds.length)
  const hasGroups = useMemo(() => countNodes(tree) > flattenLayers(tree).length, [tree])
  return (
    <div className="flex items-center gap-0.5 border-b border-line px-2 py-1">
      <IconButton label="Add layer" icon={Plus} size={15} className="h-7 w-7" onClick={() => useUiStore.getState().openAddLayer({ tab: 'sample' })} />
      <IconButton
        label={selectedCount > 1 ? `Group ${selectedCount} selected` : selectedCount === 1 ? 'Add selected to new group' : 'New group'}
        icon={FolderPlus}
        size={15}
        className="h-7 w-7"
        onClick={() => store().createGroup()}
      />
      {hasGroups && (
        <>
          <IconButton label="Expand all groups" icon={ChevronsUpDown} size={15} className="h-7 w-7" onClick={() => store().setAllExpanded(true)} />
          <IconButton label="Collapse all groups" icon={ChevronsDownUp} size={15} className="h-7 w-7" onClick={() => store().setAllExpanded(false)} />
        </>
      )}
      <IconButton
        label="Save and load layers"
        icon={Save}
        size={15}
        className="ml-auto h-7 w-7"
        aria-haspopup="menu"
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect()
          openProjectMenu(r.right - 220, r.bottom + 2)
        }}
      />
    </div>
  )
}

/** QGIS-style layer tree: groups, drag and drop, multi-select, context menu, auto-saved. */
export default function LayerManager() {
  const tree = useLayersStore((s) => s.tree)
  const layerCount = useLayersStore((s) => s.layers.length)
  const [dragId, setDragId] = useState(null)
  const [over, setOver] = useState(null)
  const [renamingId, setRenamingId] = useState(null)
  const [menu, setMenu] = useState(null) // { kind: 'node', id, x, y } | { kind: 'project', x, y }

  const openMenu = useCallback((node, x, y) => setMenu({ kind: 'node', id: node.id, x, y }), [])
  const closeMenu = useCallback(() => setMenu(null), [])
  const ctx = useMemo(() => ({ dragId, setDragId, over, setOver, renamingId, setRenamingId, openMenu }), [dragId, over, renamingId, openMenu])

  const menuItems = () => {
    if (menu?.kind === 'project') {
      return [
        {
          id: 'export',
          label: 'Export layers to file',
          icon: Download,
          disabled: !tree.length,
          onSelect: () => download(`h3map-layers-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(store().exportProject(), null, 2)),
        },
        { id: 'import', label: 'Import layers from file…', icon: Upload, onSelect: () => document.getElementById(IMPORT_INPUT_ID)?.click() },
        { separator: true },
        {
          id: 'reset',
          label: 'Reset to default layers',
          icon: RotateCcw,
          danger: true,
          onSelect: () => {
            if (window.confirm('Replace all layers with the default sample layers? Export first if you want to keep them.')) store().resetLayers()
          },
        },
      ]
    }
    const target = menu && findNode(store().tree, menu.id)
    return target ? nodeActions(target, { rename: () => setRenamingId(target.id) }) : []
  }

  return (
    <ManagerContext.Provider value={ctx}>
      <div className="flex min-h-full flex-col">
        <ManagerToolbar openProjectMenu={(x, y) => setMenu({ kind: 'project', x, y })} />
        {tree.length ? (
          <div className="flex-1 p-2">
            <NodeList nodes={tree} depth={0} parentVisible aria-label="Layers (top of list is drawn on top)" />
            {dragId && (
              <div
                className={cn('mt-1 rounded-md border border-dashed px-2 py-2 text-center text-[11px] text-muted', over?.id === '__end' ? 'border-accent text-accent' : 'border-line')}
                onDragOver={(e) => {
                  e.preventDefault()
                  if (over?.id !== '__end') setOver({ id: '__end', position: 'end' })
                }}
                onDrop={(e) => {
                  e.preventDefault()
                  store().moveNode(dragId, null, 'end')
                  setDragId(null)
                  setOver(null)
                }}
              >
                Drop here to move to the bottom
              </div>
            )}
          </div>
        ) : (
          <EmptyState icon={Layers} title="No layers yet">Open the Data tab and add a layer from a sample dataset, or import a saved layer file.</EmptyState>
        )}
        <div className="border-t border-line px-3 py-1.5 text-[10px] leading-snug text-muted">
          {layerCount} layer{layerCount === 1 ? '' : 's'} · saved in this browser
          <span className="max-md:hidden"> · drag to reorder · Ctrl+click to multi-select · right-click for actions</span>
        </div>
      </div>
      <input
        id={IMPORT_INPUT_ID}
        type="file"
        accept=".json,application/json"
        className="hidden"
        aria-label="Import layers file"
        data-testid="import-layers-input"
        onChange={(e) => {
          const file = e.target.files?.[0]
          e.target.value = ''
          if (file) importLayersFile(file)
        }}
      />
      {menu && <Menu x={menu.x} y={menu.y} items={menuItems()} onClose={closeMenu} label={menu.kind === 'project' ? 'Save and load layers' : 'Layer actions'} />}
    </ManagerContext.Provider>
  )
}
