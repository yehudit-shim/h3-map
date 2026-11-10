import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import ErrorBoundary from '../app/ErrorBoundary.jsx'
import { useDataStore } from '../state/dataStore.js'
import { useLayersStore } from '../state/layersStore.js'
import { useSelectionStore } from '../state/selectionStore.js'
import Inspector from './Inspector.jsx'
import LayerManager from './LayerManager.jsx'
import StylePanel from './StylePanel.jsx'
import { Segmented } from './controls.jsx'

vi.mock('../map/mapActions.js', () => ({ zoomToBounds: vi.fn() }))

describe('ErrorBoundary', () => {
  it('shows a recoverable error instead of crashing', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    let boom = true
    const Bomb = () => {
      if (boom) throw new Error('kaboom')
      return <div>fine</div>
    }
    render(<ErrorBoundary name="test"><Bomb /></ErrorBoundary>)
    expect(screen.getByRole('alert')).toHaveTextContent('kaboom')
    boom = false
    fireEvent.click(screen.getByText('Try again'))
    expect(screen.getByText('fine')).toBeInTheDocument()
  })
})

describe('LayerManager', () => {
  beforeEach(() => {
    useLayersStore.setState({ layers: [], activeId: null })
    useDataStore.setState({ entries: {} })
  })

  it('shows an empty state', () => {
    render(<LayerManager />)
    expect(screen.getByText('No layers yet')).toBeInTheDocument()
  })

  it('toggles visibility, reorders, renames and removes layers', () => {
    const s = useLayersStore.getState()
    s.addLayer('point', 'sample-pois', { name: 'Alpha' })
    const b = useLayersStore.getState().addLayer('line', 'sample-routes', { name: 'Beta' })
    render(<LayerManager />)
    expect(screen.getAllByRole('listitem').map((li) => li.textContent).join('|')).toMatch(/Beta.*Alpha/)

    fireEvent.click(screen.getByLabelText('Hide Beta'))
    expect(useLayersStore.getState().layers[0].visible).toBe(false)

    // Beta is active -> its tools are visible
    fireEvent.click(screen.getByLabelText('Move down (draw below)'))
    expect(useLayersStore.getState().layers[1].id).toBe(b.id)

    fireEvent.click(screen.getByLabelText('Rename layer'))
    const input = screen.getByLabelText('Layer name')
    fireEvent.change(input, { target: { value: 'Gamma' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(useLayersStore.getState().layers.find((l) => l.id === b.id).name).toBe('Gamma')

    fireEvent.click(screen.getByLabelText('Remove layer'))
    expect(useLayersStore.getState().layers.length).toBe(1)
  })

  it('shows a retry for layers whose data failed to load', () => {
    const l = useLayersStore.getState().addLayer('point', 'sample-pois')
    useDataStore.setState({ entries: { 'sample-pois': { status: 'error', error: 'Network down' } } })
    render(<LayerManager />)
    expect(screen.getByText(/Network down/)).toBeInTheDocument()
    expect(screen.getByText('Retry')).toBeInTheDocument()
    expect(l.id).toBeTruthy()
  })
})

describe('Inspector', () => {
  it('shows an empty state, then H3 details with the index and resolution', () => {
    useSelectionStore.setState({ selected: null })
    const { rerender } = render(<Inspector />)
    expect(screen.getByText('Nothing selected')).toBeInTheDocument()
    useSelectionStore.setState({
      selected: {
        layerId: 'x',
        coordinate: [2.33, 48.86],
        detail: { title: 'H3 cell · res 8', h3: '88186b2251fffff', resolution: 8, sections: [{ title: 'Cell', rows: [['H3 index', '88186b2251fffff'], ['Resolution', '8']] }] },
      },
    })
    rerender(<Inspector />)
    expect(screen.getByTestId('selected-h3-index')).toHaveTextContent('88186b2251fffff')
    expect(screen.getByTestId('row-Resolution')).toHaveTextContent('8')
  })
})

describe('StylePanel', () => {
  it('edits an H3 layer: resolution mode, fixed resolution and color ramp', () => {
    const l = useLayersStore.getState().addLayer('h3', 'sample-events')
    render(<StylePanel />)
    expect(screen.queryByLabelText('H3 resolution')).toBeNull() // hidden in auto mode
    fireEvent.click(screen.getByRole('radio', { name: 'Fixed' }))
    expect(useLayersStore.getState().layers.find((x) => x.id === l.id).style.resolutionMode).toBe('fixed')
    fireEvent.change(screen.getByLabelText('Color ramp'), { target: { value: 'magma' } })
    expect(useLayersStore.getState().layers.find((x) => x.id === l.id).style.ramp).toBe('magma')
  })
  it('shows an empty state without an active layer', () => {
    useLayersStore.setState({ layers: [], activeId: null })
    render(<StylePanel />)
    expect(screen.getByText('No layer selected')).toBeInTheDocument()
  })
})

describe('Segmented', () => {
  it('reports selection', () => {
    const onChange = vi.fn()
    render(<Segmented value="a" onChange={onChange} options={[{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }]} />)
    fireEvent.click(screen.getByRole('radio', { name: 'B' }))
    expect(onChange).toHaveBeenCalledWith('b')
  })
})
