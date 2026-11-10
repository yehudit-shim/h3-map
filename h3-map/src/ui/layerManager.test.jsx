// Phase 3: layer tree UI (groups, drag and drop, keyboard, menus, properties, import) and styling.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { findNode } from '../layers/tree.js'
import { zoomToBounds } from '../map/mapActions.js'
import { useDataStore } from '../state/dataStore.js'
import { useLayersStore } from '../state/layersStore.js'
import { useUiStore } from '../state/uiStore.js'
import LayerManager from './LayerManager.jsx'
import LayerProperties from './LayerProperties.jsx'
import StylePanel from './StylePanel.jsx'
import { dropPosition } from './layerActions.js'

vi.mock('../map/mapActions.js', () => ({ zoomToBounds: vi.fn() }))

const s = () => useLayersStore.getState()
const styleOf = (id) => s().layers.find((l) => l.id === id).style

beforeEach(() => {
  s().setTree([])
  useDataStore.setState({ entries: {} })
  useUiStore.setState({ propertiesId: null })
})

describe('LayerManager: groups', () => {
  it('creates a group from a Ctrl+click multi-selection, collapses it and hides it', () => {
    s().addLayer('point', 'sample-pois', { name: 'Alpha' })
    s().addLayer('line', 'sample-routes', { name: 'Beta' })
    s().addLayer('polygon', 'sample-districts', { name: 'Gamma' })
    render(<LayerManager />)
    fireEvent.click(screen.getByText('Alpha'))
    fireEvent.click(screen.getByText('Beta'), { ctrlKey: true })
    fireEvent.click(screen.getByLabelText('Group 2 selected'))
    const group = s().tree[1]
    expect(group.kind).toBe('group')
    expect(group.children.map((c) => c.name)).toEqual(['Beta', 'Alpha'])

    fireEvent.click(screen.getByLabelText('Collapse New group'))
    expect(screen.queryByText('Alpha')).toBeNull()
    fireEvent.click(screen.getByLabelText('Expand New group'))
    fireEvent.click(screen.getByLabelText('Hide New group'))
    expect(findNode(s().tree, group.id).visible).toBe(false)
    // The child keeps its own flag; its eye shows the inherited state.
    expect(screen.getByLabelText('Hide Alpha')).toHaveAttribute('title', 'Hidden because a parent group is hidden')
  })

  it('creates an empty group and renames it inline', () => {
    render(<LayerManager />)
    fireEvent.click(screen.getByLabelText('New group'))
    fireEvent.click(screen.getByLabelText('Rename group'))
    const input = screen.getByLabelText('Group name')
    fireEvent.change(input, { target: { value: 'Basemaps' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(s().tree[0].name).toBe('Basemaps')
    expect(screen.getByText('Empty group. Drag layers here.')).toBeInTheDocument()
  })
})

describe('LayerManager: ordering', () => {
  const row = (id) => screen.getByTestId(new RegExp(`-row-${id}$`)).firstChild
  const dataTransfer = { setData: () => {}, effectAllowed: '', dropEffect: '' }

  it('reorders and nests by drag and drop', () => {
    const a = s().addLayer('point', 'sample-pois', { name: 'Alpha' })
    s().addLayer('line', 'sample-routes', { name: 'Beta' })
    const g = s().createGroup([], 'Folder')
    render(<LayerManager />)
    // jsdom rows have no height: dropping on a group means "inside", on a layer "before".
    fireEvent.dragStart(row(a.id), { dataTransfer })
    fireEvent.dragOver(row(g.id), { dataTransfer })
    fireEvent.drop(row(g.id), { dataTransfer })
    expect(findNode(s().tree, g.id).children.map((c) => c.name)).toEqual(['Alpha'])

    fireEvent.dragStart(row(g.id), { dataTransfer })
    fireEvent.drop(row(a.id), { dataTransfer }) // into its own subtree: refused
    expect(findNode(s().tree, g.id).children).toHaveLength(1)
    fireEvent.dragEnd(row(g.id))

    fireEvent.dragStart(row(a.id), { dataTransfer })
    fireEvent.drop(screen.getByText('Drop here to move to the bottom'), { dataTransfer })
    expect(s().tree.map((n) => n.name)).toEqual(['Folder', 'Beta', 'Alpha'])
  })

  it('computes drop positions from the pointer offset', () => {
    expect(dropPosition(2, 30)).toBe('before')
    expect(dropPosition(28, 30)).toBe('after')
    expect(dropPosition(2, 30, { group: true })).toBe('before')
    expect(dropPosition(15, 30, { group: true })).toBe('inside')
    expect(dropPosition(28, 30, { group: true, expanded: false })).toBe('after')
    expect(dropPosition(28, 30, { group: true, expanded: true })).toBe('inside')
  })

  it('has a keyboard fallback for ordering and nesting', () => {
    s().addLayer('point', 'sample-pois', { name: 'Alpha' })
    const g = s().createGroup([], 'Folder')
    render(<LayerManager />)
    const btn = (name) => screen.getByText(name).closest('button')
    fireEvent.keyDown(btn('Folder'), { key: 'ArrowDown', altKey: true })
    expect(s().tree.map((n) => n.name)).toEqual(['Alpha', 'Folder'])
    fireEvent.keyDown(btn('Alpha'), { key: 'ArrowDown', altKey: true })
    fireEvent.keyDown(btn('Alpha'), { key: 'ArrowRight', altKey: true })
    expect(findNode(s().tree, g.id).children.map((c) => c.name)).toEqual(['Alpha'])
    fireEvent.keyDown(btn('Alpha'), { key: 'ArrowLeft', altKey: true })
    expect(s().tree.map((n) => n.name)).toEqual(['Folder', 'Alpha'])
    fireEvent.keyDown(btn('Alpha'), { key: 'F2' })
    expect(screen.getByLabelText('Layer name')).toBeInTheDocument()
  })
})

describe('LayerManager: actions', () => {
  it('offers layer actions in a right-click menu', () => {
    s().addLayer('point', 'sample-pois', { name: 'Alpha' })
    render(<LayerManager />)
    fireEvent.contextMenu(screen.getByText('Alpha'))
    expect(screen.getByRole('menu', { name: 'Layer actions' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Duplicate' }))
    expect(s().layers.map((l) => l.name)).toEqual(['Alpha copy', 'Alpha'])
    expect(screen.queryByRole('menu')).toBeNull()

    fireEvent.contextMenu(screen.getByText('Alpha'))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Properties…' }))
    expect(useUiStore.getState().propertiesId).toBe(s().layers[1].id)

    fireEvent.contextMenu(screen.getByText('Alpha'))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Remove layer' }))
    expect(s().layers.map((l) => l.name)).toEqual(['Alpha copy'])
  })

  it('zooms to a group using the union of its layer extents', () => {
    const a = s().addLayer('point', 'sample-pois', { name: 'Alpha' })
    const b = s().addLayer('line', 'sample-routes', { name: 'Beta' })
    const g = s().createGroup([a.id, b.id], 'Both')
    useDataStore.setState({
      entries: { 'sample-pois': { status: 'ready', bounds: [2, 48, 3, 49] }, 'sample-routes': { status: 'ready', bounds: [1, 47.5, 2.5, 48.5] } },
    })
    s().setActive(g.id)
    render(<LayerManager />)
    fireEvent.click(screen.getByLabelText('Zoom to group'))
    expect(zoomToBounds).toHaveBeenLastCalledWith([1, 47.5, 3, 49])
  })

  it('imports a saved layer file through the Save menu', async () => {
    const project = {
      format: 'h3map.project',
      schemaVersion: 1,
      layers: [{ kind: 'layer', id: 'imp', name: 'Imported', type: 'line', sourceId: 'sample-routes', visible: true, opacity: 1, style: {} }],
    }
    const file = new File([JSON.stringify(project)], 'layers.json', { type: 'application/json' })
    render(<LayerManager />)
    fireEvent.click(screen.getByLabelText('Save and load layers'))
    expect(screen.getByRole('menuitem', { name: 'Export layers to file' })).toBeDisabled() // nothing to export yet
    fireEvent.change(screen.getByTestId('import-layers-input'), { target: { files: [file] } })
    expect(await screen.findByText('Imported')).toBeInTheDocument()
    expect(s().layers[0].style.width).toBe(3) // defaults filled in
  })
})

describe('LayerProperties', () => {
  it('shows layer metadata: source, fields, extent and style', () => {
    const l = s().addLayer('point', 'sample-pois', { name: 'Alpha' })
    useDataStore.setState({ entries: { 'sample-pois': { status: 'ready', featureCount: 300, bounds: [2.2, 48.8, 2.4, 48.9] } } })
    useUiStore.getState().openProperties(l.id)
    render(<LayerProperties />)
    expect(screen.getByRole('dialog', { name: 'Alpha' })).toBeInTheDocument()
    expect(screen.getByTestId('prop-Features')).toHaveTextContent('300')
    expect(screen.getByTestId('prop-West')).toHaveTextContent('2.2')
    expect(screen.getByText('rating')).toBeInTheDocument()
    expect(screen.getByTestId('prop-style')).toHaveTextContent('"radius"')
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    expect(useUiStore.getState().propertiesId).toBeNull()
  })

  it('summarises a group', () => {
    const a = s().addLayer('point', 'sample-pois', { name: 'Alpha' })
    const g = s().createGroup([a.id], 'Folder')
    useUiStore.getState().openProperties(g.id)
    render(<LayerProperties />)
    expect(screen.getByRole('dialog', { name: 'Folder' })).toBeInTheDocument()
    expect(screen.getByTestId('prop-Layers')).toHaveTextContent('1')
  })
})

describe('StylePanel: attribute styling, sizes and extrusion', () => {
  it('shows ramp and classification controls when coloring by a numeric attribute', () => {
    const l = s().addLayer('point', 'sample-pois')
    render(<StylePanel />)
    expect(screen.queryByLabelText('Color ramp')).toBeNull()
    fireEvent.change(screen.getByLabelText('Color by'), { target: { value: 'rating' } })
    expect(styleOf(l.id).colorBy).toBe('rating')
    expect(screen.getByLabelText('Color ramp')).toBeInTheDocument()
    expect(screen.getByLabelText('Classification')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Point size: radius (px)'), { target: { value: '11' } })
    expect(styleOf(l.id).radius).toBe(11)
  })

  it('edits line color and width', () => {
    const l = s().addLayer('line', 'sample-routes')
    render(<StylePanel />)
    fireEvent.change(screen.getByLabelText('Line width (px)'), { target: { value: '6' } })
    expect(styleOf(l.id).width).toBe(6)
  })

  it('edits polygon extrusion', () => {
    const l = s().addLayer('polygon', 'sample-districts')
    render(<StylePanel />)
    expect(screen.queryByLabelText('Max height (m)')).toBeNull()
    fireEvent.click(screen.getByRole('switch', { name: '3D extrusion' }))
    expect(styleOf(l.id).extruded).toBe(true)
    expect(screen.getByLabelText('Max height (m)')).toBeInTheDocument()
  })
})
