// Phase 6B UI: sign-in, the database browser, add-to-map, the table drawer, notices and "reconnect" states.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { clearToken } from '../../api/index.js'
import { prunePgSources, pgSourceRef } from '../../data/pgSources.js'
import { getSource } from '../../data/sources.js'
import { buildSourceInput } from '../../data/pgPlan.js'
import { createPgSource } from '../../data/pgSources.js'
import '../../layers/index.js'
import { useAuthStore } from '../../state/authStore.js'
import { useConnectionsStore } from '../../state/connectionsStore.js'
import { useDataStore } from '../../state/dataStore.js'
import { useLayersStore } from '../../state/layersStore.js'
import { useUiStore } from '../../state/uiStore.js'
import { API, PROFILES, TOKEN, startMockApi } from '../../test/mockApi.js'
import DataNotices from '../DataNotices.jsx'
import LayerManager from '../LayerManager.jsx'
import AddToMapDialog from './AddToMapDialog.jsx'
import DatabasePanel from './DatabasePanel.jsx'
import LoginDialog from './LoginDialog.jsx'
import TableDrawer from './TableDrawer.jsx'

const mock = startMockApi()
beforeAll(() => mock.listen())
afterAll(() => mock.close())

const layers = () => useLayersStore.getState().layers
const signIn = () => useAuthStore.getState().login('admin', 'right')

beforeEach(() => {
  useLayersStore.getState().setTree([])
  useDataStore.setState({ entries: {} })
  useConnectionsStore.getState().reset()
  useAuthStore.setState({ status: 'signed-out', user: null, roles: [], config: null, error: null, expired: false })
  useUiStore.setState({ loginOpen: false, tableDrawer: null, addToMap: null, connectionDialog: null, leftTab: 'layers' })
})
afterEach(() => {
  prunePgSources([])
  mock.server.resetHandlers()
  mock.reset()
  Object.keys(mock.flags).forEach((k) => delete mock.flags[k])
  clearToken()
})

describe('sign-in', () => {
  it('signs in through the form, opens the Database tab and keeps the token out of every store and storage', async () => {
    useUiStore.getState().openLogin()
    render(<LoginDialog />)
    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'admin' } })
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'right' } })
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))
    await waitFor(() => expect(useAuthStore.getState().status).toBe('signed-in'))
    expect(useUiStore.getState().leftTab).toBe('database')
    expect(useAuthStore.getState().roles).toEqual(['admin'])
    expect(screen.queryByTestId('login-dialog')).toBeNull() // closed; the password field held it only until it was sent
    const everything = JSON.stringify([useAuthStore.getState(), useConnectionsStore.getState(), useDataStore.getState().entries])
    expect(everything).not.toContain(TOKEN)
    expect(JSON.stringify({ ...localStorage })).not.toContain(TOKEN)
    expect(JSON.stringify({ ...sessionStorage })).not.toContain(TOKEN)
  })

  it('shows the server message for a wrong password and stays signed out', async () => {
    useUiStore.getState().openLogin()
    render(<LoginDialog />)
    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'admin' } })
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'nope' } })
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))
    expect(await screen.findByTestId('login-error')).toHaveTextContent('Invalid username or password.')
    expect(useAuthStore.getState().status).toBe('signed-out')
  })

  it('the Database tab asks for a sign-in first', () => {
    render(<DatabasePanel />)
    expect(screen.getByTestId('db-signed-out')).toBeInTheDocument()
    expect(mock.calls).toHaveLength(0)
  })
})

describe('database browser and add-to-map', () => {
  it('goes from a signed-in clean connection to a layer in at most 4 clicks, with the recommended strategy preselected', async () => {
    await signIn()
    render(<><DatabasePanel /><AddToMapDialog /></>)
    let clicks = 0
    const click = (el) => {
      clicks += 1
      fireEvent.click(el)
    }
    // the single connection and its only schema are open already: the tree shows the tables
    expect(await screen.findByTestId('db-table-parcels')).toBeInTheDocument()
    click(screen.getByLabelText('Add parcels to map')) // 1
    const dialog = await screen.findByTestId('add-table-dialog')
    const mvt = await within(dialog).findByRole('radio', { name: /Vector tiles/ })
    expect(mvt).toBeChecked() // parcels: 1.25M rows -> the server recommends mvt
    expect(within(dialog).getByText('Recommended')).toBeInTheDocument()
    click(screen.getByTestId('confirm-add-to-map')) // 2

    expect(clicks).toBeLessThanOrEqual(4)
    expect(layers()).toHaveLength(1)
    expect(layers()[0]).toMatchObject({ type: 'mvt', name: 'public.parcels' })
    expect(getSource(layers()[0].sourceId)).toMatchObject({ kind: 'postgis', strategy: 'mvt', connectionId: 'anastasia' })
    expect(screen.queryByTestId('add-table-dialog')).toBeNull()
    expect(useUiStore.getState().leftTab).toBe('layers')
  })

  it.each([
    ['poi', 'json', 'point'],
    ['events', 'bbox', 'point'],
    ['big_points', 'h3aggregate', 'h3cells'],
    ['h3_pop', 'h3cells', 'h3cells'],
  ])('%s preselects %s and adds a %s layer', async (table, strategy, type) => {
    await signIn()
    render(<><DatabasePanel /><AddToMapDialog /></>)
    fireEvent.click(await screen.findByLabelText(`Add ${table} to map`))
    const dialog = await screen.findByTestId('add-table-dialog')
    await waitFor(() => expect(within(dialog).getAllByRole('radio').find((r) => r.checked)?.value).toBe(strategy))
    fireEvent.click(screen.getByTestId('confirm-add-to-map'))
    expect(layers()[0].type).toBe(type)
    expect(getSource(layers()[0].sourceId).strategy).toBe(strategy)
  })

  it('lets the user override the strategy and choose attribute columns', async () => {
    await signIn()
    render(<><DatabasePanel /><AddToMapDialog /></>)
    fireEvent.click(await screen.findByLabelText('Add parcels to map'))
    const dialog = await screen.findByTestId('add-table-dialog')
    fireEvent.click(await within(dialog).findByRole('radio', { name: /GeoJSON, current view/ }))
    fireEvent.click(within(dialog).getByRole('checkbox', { name: /pop/ })) // untick a default column
    fireEvent.click(screen.getByTestId('confirm-add-to-map'))
    const source = getSource(layers()[0].sourceId)
    expect(source.strategy).toBe('bbox')
    expect(source.columns).not.toContain('pop')
    expect(layers()[0].type).toBe('polygon')
  })

  it('hides non-spatial tables by default and offers no add button for them', async () => {
    await signIn()
    render(<DatabasePanel />)
    await screen.findByTestId('db-table-poi')
    expect(screen.queryByTestId('db-table-lookup')).toBeNull()
    fireEvent.click(screen.getByLabelText(/Map data only/))
    expect(await screen.findByTestId('db-table-lookup')).toBeInTheDocument()
    expect(screen.queryByLabelText('Add lookup to map')).toBeNull()
    fireEvent.change(screen.getByLabelText('Filter tables'), { target: { value: 'parc' } })
    expect(screen.queryByTestId('db-table-poi')).toBeNull()
    expect(screen.getByTestId('db-table-parcels')).toBeInTheDocument()
  })

  it('explains that a table without geometry or H3 cannot be drawn', async () => {
    await signIn()
    useUiStore.getState().openAddToMap({ connectionId: 'anastasia', schema: 'public', table: 'lookup' })
    render(<AddToMapDialog />)
    expect(await screen.findByTestId('not-mappable')).toHaveTextContent(/no geometry column and no H3 column/)
  })
})

describe('table drawer', () => {
  it('shows profile warnings with the suggested CREATE INDEX text', async () => {
    await signIn()
    useUiStore.getState().openTable({ connectionId: 'anastasia', schema: 'public', table: 'unindexed' })
    render(<TableDrawer />)
    const warnings = await screen.findByTestId('profile-warnings')
    expect(within(warnings).getByText(/No spatial index on geom/)).toBeInTheDocument()
    expect(screen.getByTestId('warning-suggestion')).toHaveTextContent('CREATE INDEX "unindexed_geom_gix" ON "public"."unindexed" USING gist ("geom");')
  })

  it('lists columns and indexes, and pages through the preview', async () => {
    await signIn()
    useUiStore.getState().openTable({ connectionId: 'anastasia', schema: 'public', table: 'parcels' })
    render(<TableDrawer />)
    await screen.findByText('Reading the table profile…').catch(() => null)
    fireEvent.click(await screen.findByRole('tab', { name: 'Columns' }))
    expect(await screen.findByText('pop')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('tab', { name: 'Indexes' }))
    expect(await screen.findByText('parcels_gix')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('tab', { name: 'Preview' }))
    expect(await screen.findByText('row 1')).toBeInTheDocument()
    fireEvent.click(screen.getByLabelText('Next page'))
    expect(await screen.findByText('row 26')).toBeInTheDocument()
    expect(mock.calls.filter((c) => c.path.endsWith('/rows')).map((c) => c.search.get('offset'))).toEqual([null, '25'])
    expect(screen.getByLabelText('Previous page')).toBeEnabled()
  })
})

describe('loading, empty and error states', () => {
  it('shows an inline error with Retry when the tables cannot be listed, and recovers', async () => {
    mock.flags.failTables = true
    await signIn()
    render(<DatabasePanel />)
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(/Internal error/)
    mock.flags.failTables = false
    fireEvent.click(within(alert).getByText('Retry'))
    expect(await screen.findByTestId('db-table-poi')).toBeInTheDocument()
  })

  it('shows the database-down state in the add dialog, with Retry', async () => {
    await signIn()
    mock.flags.dbDown = true
    useUiStore.getState().openAddToMap({ connectionId: 'anastasia', schema: 'public', table: 'poi' })
    render(<AddToMapDialog />)
    expect(await screen.findByRole('alert')).toHaveTextContent(/not reachable/i)
    mock.flags.dbDown = false
    fireEvent.click(screen.getByRole('button', { name: /Retry/ }))
    expect(await screen.findByTestId('confirm-add-to-map')).toBeInTheDocument()
  })

  it('shows an empty state when the server has no connections for this user', async () => {
    mock.server.use(http.get(`${API}/connections`, () => HttpResponse.json([])))
    await signIn()
    render(<DatabasePanel />)
    expect(await screen.findByText('No database connections')).toBeInTheDocument()
  })

  it('shows a loading state while the catalogue is read', async () => {
    await signIn()
    render(<DatabasePanel />)
    expect(screen.getByRole('status', { name: 'Loading connections' })).toBeInTheDocument()
    await screen.findByTestId('db-table-poi')
  })
})

describe('layer notices', () => {
  const addBbox = () => {
    const src = createPgSource(buildSourceInput({ connectionId: 'anastasia', profile: PROFILES.events, strategy: 'bbox', columns: ['pop'] }))
    const layer = useLayersStore.getState().addLayer('point', src.id, { name: 'Events' })
    return { src, layer }
  }

  it('a truncated result shows a banner that offers vector tiles, and switching replaces the layer source', () => {
    const { src, layer } = addBbox()
    useDataStore.setState({ entries: { [src.id]: { status: 'ready', data: { features: [] }, featureCount: 10000, unit: 'features', truncated: true } } })
    render(<DataNotices />)
    const banner = screen.getByTestId('notice-truncated')
    expect(banner).toHaveTextContent(/first 10,000 features/)
    fireEvent.click(within(banner).getByRole('button', { name: 'Use vector tiles' }))
    const now = layers().find((l) => l.id === layer.id)
    expect(now.type).toBe('mvt')
    expect(getSource(now.sourceId)).toMatchObject({ strategy: 'mvt', table: 'events' })
    expect(getSource(src.id)).toBeUndefined() // the old source is released
  })

  it('shows nothing for a complete result', () => {
    const { src } = addBbox()
    useDataStore.setState({ entries: { [src.id]: { status: 'ready', data: { features: [] }, featureCount: 3, truncated: false } } })
    render(<DataNotices />)
    expect(screen.queryByTestId('data-notices')).toBeNull()
  })

  it('tells the user when the server returned a coarser H3 resolution', () => {
    const src = createPgSource(buildSourceInput({ connectionId: 'anastasia', profile: PROFILES.h3_pop, strategy: 'h3cells' }))
    useLayersStore.getState().addLayer('h3cells', src.id, { name: 'Population' })
    useDataStore.setState({ entries: { [src.id]: { status: 'ready', data: { cells: [], resolution: 6, requested: 8 }, featureCount: 0, unit: 'cells', notice: 'Showing H3 resolution 6 instead of 8: the server returned a coarser grid to stay within its cell limit. Zoom in for finer cells.' } } })
    render(<DataNotices />)
    expect(screen.getByTestId('notice-notice')).toHaveTextContent(/resolution 6 instead of 8/)
  })
})

describe('reconnect', () => {
  it('a layer restored without a session asks to sign in, then loads after signing in', async () => {
    const src = createPgSource(buildSourceInput({ connectionId: 'anastasia', profile: PROFILES.poi, strategy: 'json', columns: ['pop'] }))
    useLayersStore.getState().addLayer('point', src.id, { name: 'POI' })
    await useDataStore.getState().load(src.id) // not signed in
    render(<LayerManager />)
    expect(await screen.findByText(/Sign in to load this database layer/)).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('reconnect-signin'))
    expect(useUiStore.getState().loginOpen).toBe(true)

    await signIn() // retries the layers that were waiting for it
    await waitFor(() => expect(useDataStore.getState().entries[src.id]).toMatchObject({ status: 'ready', featureCount: 3 }))
  })

  it('a missing connection or table shows a clear reconnect message with a way to the browser', async () => {
    await signIn()
    const src = createPgSource({ ...buildSourceInput({ connectionId: 'deleted-conn', profile: PROFILES.poi, strategy: 'json' }) })
    mock.server.use(http.get(/\/features$/, () => HttpResponse.json({ error: { code: 'not_found', message: 'Connection not found.', details: {}, requestId: 'r' } }, { status: 404 })))
    useLayersStore.getState().addLayer('point', src.id, { name: 'POI' })
    await useDataStore.getState().load(src.id)
    render(<LayerManager />)
    expect(await screen.findByText(/connection or table is not available/i)).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('reconnect-browse'))
    expect(useUiStore.getState().leftTab).toBe('database')
  })

  it('saved projects keep only the connection id and table reference', () => {
    const src = createPgSource(buildSourceInput({ connectionId: 'anastasia', profile: PROFILES.poi, strategy: 'json', columns: ['pop'] }))
    useLayersStore.getState().addLayer('point', src.id)
    const exported = JSON.stringify(useLayersStore.getState().exportProject())
    expect(exported).toContain('"connectionId":"anastasia"')
    expect(exported).not.toMatch(/test-token|Bearer|password/i)
    expect(Object.keys(pgSourceRef(src))).not.toContain('token')
  })
})
