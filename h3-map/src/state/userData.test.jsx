import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { getSource } from '../data/sources.js'
import { pruneUserSources } from '../data/userSources.js'
import { addParsedDataLayer, addWebLayer, reloadSourceFile } from '../ui/layerActions.js'
import AddLayerDialog from '../ui/AddLayerDialog.jsx'
import { useDataStore } from './dataStore.js'
import { STORAGE_KEY, useLayersStore } from './layersStore.js'
import { useUiStore } from './uiStore.js'

vi.mock('../map/mapActions.js', () => ({ zoomToBounds: vi.fn() }))

const data = { type: 'FeatureCollection', features: [{ type: 'Feature', properties: { v: 1 }, geometry: { type: 'Point', coordinates: [2, 48] } }] }
const result = { data, fields: [{ name: 'v', type: 'number' }], geometry: 'point', featureCount: 1, bounds: [2, 48, 2, 48] }

beforeEach(() => {
  useLayersStore.getState().setTree([])
  pruneUserSources([])
  useDataStore.setState({ entries: {} })
  useUiStore.setState({ addLayerDialog: null })
  localStorage.clear()
})

describe('user data in the layers store', () => {
  it('adds a file layer with the data in memory and persists only a reference', () => {
    const layer = addParsedDataLayer({ input: { format: 'geojson', origin: 'file', name: 'pts', fileName: 'pts.geojson' }, result, typeId: 'point', name: 'My points' })
    expect(useLayersStore.getState().layers[0]).toMatchObject({ name: 'My points', type: 'point' })
    expect(useDataStore.getState().entries[layer.sourceId]).toMatchObject({ status: 'ready', featureCount: 1, bounds: [2, 48, 2, 48] })
    const saved = localStorage.getItem(STORAGE_KEY)
    expect(saved).toBeTruthy()
    const state = JSON.parse(saved).state
    expect(state.sources).toHaveLength(1)
    expect(state.sources[0]).toMatchObject({ kind: 'file', fileName: 'pts.geojson' })
    expect(saved).not.toMatch(/"coordinates"/) // the data itself is never written to localStorage
  })

  it('removing the last layer of a source frees the source and its cached data', () => {
    const layer = addParsedDataLayer({ input: { format: 'geojson', origin: 'file', name: 'pts', fileName: 'pts.geojson' }, result, typeId: 'point' })
    const copy = useLayersStore.getState().duplicateNode(layer.id)
    useLayersStore.getState().removeNode(layer.id)
    expect(getSource(layer.sourceId)).toBeDefined() // the duplicate still uses it
    useLayersStore.getState().removeNode(copy.id)
    expect(getSource(layer.sourceId)).toBeUndefined()
    expect(useDataStore.getState().entries[layer.sourceId]).toBeUndefined()
  })

  it('adds web layers without a source, and the data store ignores them', () => {
    const layer = addWebLayer('xyz', { name: 'Tiles', style: { url: 'https://t.example/{z}/{x}/{y}.png', attribution: '© t', minZoom: 0, maxZoom: 18 }, opacity: 0.6 })
    expect(layer).toMatchObject({ sourceId: null, name: 'Tiles', opacity: 0.6 })
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)).state.sources).toEqual([])
  })

  it('a restored file source reports it needs the file, and reloading the file fixes it', async () => {
    const layer = addParsedDataLayer({ input: { format: 'geojson', origin: 'file', name: 'pts', fileName: 'pts.geojson' }, result, typeId: 'point' })
    const project = useLayersStore.getState().exportProject()
    pruneUserSources([]) // new session
    useDataStore.setState({ entries: {} })
    useLayersStore.getState().loadProject(project)
    await useDataStore.getState().load(layer.sourceId)
    expect(useDataStore.getState().entries[layer.sourceId]).toMatchObject({ status: 'error', needsFile: true })

    const file = new File([JSON.stringify(data)], 'pts.geojson')
    expect(await reloadSourceFile(layer.sourceId, file)).toBe(true)
    expect(useDataStore.getState().entries[layer.sourceId]).toMatchObject({ status: 'ready', featureCount: 1 })
  })
})

describe('AddLayerDialog', () => {
  it('has the four tabs and adds an XYZ layer from the web tab', () => {
    useUiStore.getState().openAddLayer({ tab: 'web' })
    render(<AddLayerDialog />)
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual(['Sample data', 'GeoJSON', 'CSV', 'XYZ / WMS'])
    fireEvent.change(screen.getByLabelText('Tile URL template'), { target: { value: 'https://t.example/tiles.png' } })
    fireEvent.click(screen.getByTestId('add-web-layer'))
    expect(screen.getByRole('alert')).toHaveTextContent('{z}') // invalid template: nothing added
    expect(useLayersStore.getState().layers).toHaveLength(0)
    fireEvent.change(screen.getByLabelText('Tile URL template'), { target: { value: 'https://t.example/{z}/{x}/{y}.png' } })
    fireEvent.change(screen.getByLabelText('Layer name (optional)'), { target: { value: 'Mine' } })
    fireEvent.click(screen.getByTestId('add-web-layer'))
    expect(useLayersStore.getState().layers[0]).toMatchObject({ type: 'xyz', name: 'Mine', sourceId: null })
    expect(useUiStore.getState().addLayerDialog).toBeNull()
  })

  it('loads a GeoJSON file through the parser and adds it', async () => {
    useUiStore.getState().openAddLayer({ tab: 'geojson' })
    const { container } = render(<AddLayerDialog />)
    const input = container.querySelector('input[type=file]')
    fireEvent.change(input, { target: { files: [new File([JSON.stringify(data)], 'pts.geojson')] } })
    await waitFor(() => expect(screen.getByTestId('parse-result')).toBeInTheDocument())
    expect(screen.getByTestId('result-count')).toHaveTextContent('1 features')
    fireEvent.click(screen.getByTestId('add-to-map'))
    expect(useLayersStore.getState().layers[0]).toMatchObject({ type: 'point', name: 'pts' })
  })

  it('shows an error for invalid files', async () => {
    useUiStore.getState().openAddLayer({ tab: 'geojson' })
    const { container } = render(<AddLayerDialog />)
    fireEvent.change(container.querySelector('input[type=file]'), { target: { files: [new File(['{nope'], 'bad.geojson')] } })
    await waitFor(() => expect(screen.getByTestId('parse-error')).toHaveTextContent(/not valid JSON/))
  })

  it('CSV: asks for columns when they cannot be detected', async () => {
    useUiStore.getState().openAddLayer({ tab: 'csv' })
    const { container } = render(<AddLayerDialog />)
    fireEvent.change(container.querySelector('input[type=file]'), { target: { files: [new File(['p,q\n48.1,2.1\n48.2,2.2\n'], 'pts.csv')] } })
    await waitFor(() => expect(screen.getByTestId('csv-undetected')).toBeInTheDocument())
    expect(screen.getByTestId('csv-load')).toBeDisabled()
    fireEvent.change(screen.getByLabelText('Latitude column'), { target: { value: 'p' } })
    fireEvent.change(screen.getByLabelText('Longitude column'), { target: { value: 'q' } })
    fireEvent.click(screen.getByTestId('csv-load'))
    await waitFor(() => expect(screen.getByTestId('result-count')).toHaveTextContent('2 features'))
  })
})
