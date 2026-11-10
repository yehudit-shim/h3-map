import { useEffect, useState } from 'react'
import { ChevronDown, ChevronRight, Database, Hexagon, KeyRound, Lock, Pencil, Plus, RefreshCw, Search, Shapes, Table2, Wifi } from 'lucide-react'
import { ApiError, describeError, testConnection } from '../../api/index.js'
import { cn } from '../../lib/cn.js'
import { formatNumber } from '../../lib/format.js'
import { useAuthStore } from '../../state/authStore.js'
import { useConnectionsStore } from '../../state/connectionsStore.js'
import { notify } from '../../state/notifyStore.js'
import { useUiStore } from '../../state/uiStore.js'
import { Button, IconButton } from '../Button.jsx'
import { Badge, EmptyState, Spinner } from '../feedback.jsx'
import { LoginForm } from './LoginDialog.jsx'

const key = (...p) => p.join('\u0000')

function ErrorLine({ error, onRetry }) {
  return (
    <div className="flex flex-wrap items-center gap-2 px-2 py-1.5 text-[12px] text-danger" role="alert">
      <span className="min-w-0 break-words">{error.message}</span>
      {error.retryable && onRetry && <button type="button" className="cursor-pointer underline" onClick={onRetry}>Retry</button>}
    </div>
  )
}

function Loading({ label }) {
  return <div className="flex items-center gap-2 px-2 py-1.5 text-[12px] text-muted"><Spinner size={12} label={label} /> {label}…</div>
}

function TableIcon({ table }) {
  if (table.hasH3 && !table.hasGeometry) return <Hexagon size={14} className="shrink-0 text-accent" aria-hidden="true" />
  if (table.hasGeometry) return <Shapes size={14} className="shrink-0 text-accent" aria-hidden="true" />
  return <Table2 size={14} className="shrink-0 text-muted" aria-hidden="true" />
}

function TableRow({ connectionId, table }) {
  const mappable = table.hasGeometry || table.hasH3
  const geom = table.geometryColumns?.[0]
  const target = { connectionId, schema: table.schema, table: table.name }
  const ui = useUiStore.getState()
  return (
    <li className="group/row flex items-center gap-1 rounded-md py-0.5 pl-1 pr-0.5 hover:bg-hover" data-testid={`db-table-${table.name}`}>
      <TableIcon table={table} />
      <button
        type="button"
        className="min-w-0 flex-1 cursor-pointer rounded text-left outline-none focus-visible:ring-1 focus-visible:ring-accent"
        onClick={() => ui.openTable(target)}
        aria-label={`Table details: ${table.schema}.${table.name}`}
      >
        <span className="block truncate text-[13px]">{table.name}</span>
        <span className="flex flex-wrap items-center gap-1 text-[10px] text-muted">
          {geom && <span>{geom.type} · {geom.srid}</span>}
          {table.hasH3 && <Badge tone="accent">H3</Badge>}
          {table.kind !== 'table' && <Badge>{table.kind}</Badge>}
          {table.estimatedRows != null && <span>~{formatNumber(table.estimatedRows)}</span>}
          {!mappable && <span>no geometry</span>}
        </span>
      </button>
      {mappable && <IconButton label={`Add ${table.name} to map`} icon={Plus} size={14} className="h-7 w-7 text-accent" onClick={() => ui.openAddToMap(target)} />}
    </li>
  )
}

function SchemaNode({ connectionId, schema, filter, geoOnly, startOpen }) {
  const [open, setOpen] = useState(startOpen)
  const k = key(connectionId, schema.name)
  const entry = useConnectionsStore((s) => s.tables[k])
  useEffect(() => {
    if (open) useConnectionsStore.getState().loadTables(connectionId, schema.name)
  }, [open, connectionId, schema.name])
  const q = filter.trim().toLowerCase()
  const tables = (entry?.items ?? []).filter((t) => (!geoOnly || t.hasGeometry || t.hasH3) && (!q || t.name.toLowerCase().includes(q)))
  return (
    <li>
      <button type="button" aria-expanded={open} onClick={() => setOpen((o) => !o)} className="flex w-full cursor-pointer items-center gap-1 rounded-md px-1 py-1 text-left text-[13px] hover:bg-hover">
        {open ? <ChevronDown size={14} aria-hidden="true" /> : <ChevronRight size={14} aria-hidden="true" />}
        <span className="min-w-0 flex-1 truncate font-medium">{schema.name}</span>
        <span className="text-[10px] text-muted">{schema.tableCount}</span>
      </button>
      {open && (
        <div className="ml-3 border-l border-line pl-1.5">
          {entry?.status === 'loading' && !entry.items.length && <Loading label="Loading tables" />}
          {entry?.status === 'error' && <ErrorLine error={entry.error} onRetry={() => useConnectionsStore.getState().loadTables(connectionId, schema.name, true)} />}
          {entry?.status === 'ready' && tables.length === 0 && (
            <div className="px-2 py-1.5 text-[12px] text-muted">{q || geoOnly ? 'No matching tables.' + (geoOnly && !q ? ' Turn off "Map data only" to see the rest.' : '') : 'No tables.'}</div>
          )}
          <ul>{tables.map((t) => <TableRow key={t.name} connectionId={connectionId} table={t} />)}</ul>
        </div>
      )}
    </li>
  )
}

function ConnectionNode({ connection, filter, geoOnly, startOpen }) {
  const [open, setOpen] = useState(startOpen)
  const [testing, setTesting] = useState(false)
  const entry = useConnectionsStore((s) => s.schemas[connection.id])
  const canManage = useAuthStore((s) => s.roles.includes('admin') && !!s.config?.featureFlags?.userConnections)
  useEffect(() => {
    if (open) useConnectionsStore.getState().loadSchemas(connection.id)
  }, [open, connection.id])
  const schemas = (entry?.items ?? []).filter((s) => s.tableCount > 0)

  const test = async () => {
    setTesting(true)
    try {
      const r = await testConnection(connection.id)
      notify(`${connection.name}: connected in ${r.latencyMs} ms${r.postgis ? ` · PostGIS ${r.postgis}` : ' · no PostGIS'}${r.h3Extension ? ' · h3' : ''}`, { kind: 'success' })
    } catch (e) {
      notify(`${connection.name}: ${e instanceof ApiError && e.forbidden ? 'testing needs the editor role' : describeError(e)}`, { kind: 'error' })
    } finally {
      setTesting(false)
    }
  }

  return (
    <li data-testid={`db-connection-${connection.id}`}>
      <div className="flex items-center gap-0.5">
        <button type="button" aria-expanded={open} onClick={() => setOpen((o) => !o)} className="flex min-w-0 flex-1 cursor-pointer items-center gap-1.5 rounded-md px-1 py-1.5 text-left hover:bg-hover">
          {open ? <ChevronDown size={14} aria-hidden="true" /> : <ChevronRight size={14} aria-hidden="true" />}
          <Database size={14} className="shrink-0 text-accent" aria-hidden="true" />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13px] font-medium">{connection.name}</span>
            <span className="block truncate font-mono text-[10px] text-muted">{connection.database}@{connection.host}</span>
          </span>
          {connection.source === 'env' && <Lock size={11} className="shrink-0 text-muted" aria-label="Defined by the server configuration (read-only)" />}
        </button>
        <IconButton label={`Test connection ${connection.name}`} icon={testing ? RefreshCw : Wifi} size={13} className={cn('h-7 w-7', testing && '[&_svg]:animate-spin')} disabled={testing} onClick={test} />
        {canManage && connection.source === 'user' && <IconButton label={`Edit connection ${connection.name}`} icon={Pencil} size={13} className="h-7 w-7" onClick={() => useUiStore.getState().openConnectionDialog(connection)} />}
      </div>
      {open && (
        <div className="ml-3 border-l border-line pl-1.5">
          {entry?.status === 'loading' && !entry.items.length && <Loading label="Loading schemas" />}
          {entry?.status === 'error' && <ErrorLine error={entry.error} onRetry={() => useConnectionsStore.getState().loadSchemas(connection.id, true)} />}
          {entry?.status === 'ready' && schemas.length === 0 && <div className="px-2 py-1.5 text-[12px] text-muted">No schemas with tables are visible to this role.</div>}
          <ul>
            {/* open `public`, or the first schema when there is none: the table list is one click below the connection */}
            {schemas.map((s, i) => <SchemaNode key={s.name} connectionId={connection.id} schema={s} filter={filter} geoOnly={geoOnly} startOpen={s.name === 'public' || (i === 0 && !schemas.some((x) => x.name === 'public'))} />)}
          </ul>
        </div>
      )}
    </li>
  )
}

function SignedOut() {
  const expired = useAuthStore((s) => s.expired)
  return (
    <div className="p-4" data-testid="db-signed-out">
      <div className="mb-3 flex items-center gap-2 text-[13px] font-medium"><KeyRound size={15} className="text-accent" aria-hidden="true" /> Sign in to browse databases</div>
      <p className="mb-3 text-[12px] leading-snug text-muted">
        {expired ? 'Your session ended. ' : ''}Sign in to the map server to list its database connections. Your password is sent to the server only and is not stored in the browser.
      </p>
      <LoginForm autoFocus={false} />
    </div>
  )
}

/** Database browser: connections > schemas > tables, with a filter and a "map data only" toggle. */
export default function DatabasePanel() {
  const status = useAuthStore((s) => s.status)
  const canManage = useAuthStore((s) => s.roles.includes('admin') && !!s.config?.featureFlags?.userConnections)
  const conns = useConnectionsStore((s) => s.connections)
  const [filter, setFilter] = useState('')
  const [geoOnly, setGeoOnly] = useState(true)
  const signedIn = status === 'signed-in'
  useEffect(() => {
    if (signedIn) useConnectionsStore.getState().loadConnections()
  }, [signedIn])

  if (!signedIn) return <SignedOut />
  return (
    <div data-testid="db-panel">
      <div className="space-y-2 border-b border-line px-3 py-2.5">
        <div className="flex items-center gap-1.5">
          <div className="relative min-w-0 flex-1">
            <Search size={13} className="pointer-events-none absolute left-2 top-2.5 text-muted" aria-hidden="true" />
            <input aria-label="Filter tables" placeholder="Filter tables" value={filter} onChange={(e) => setFilter(e.target.value)} className="h-8 w-full rounded-md border border-line bg-raised pl-7 pr-2 text-[13px] outline-none placeholder:text-muted focus-visible:border-accent" />
          </div>
          <IconButton label="Refresh connections" icon={RefreshCw} size={14} className="h-8 w-8" onClick={() => { useConnectionsStore.getState().reset(); useConnectionsStore.getState().loadConnections(true) }} />
          {canManage && <IconButton label="Add connection" icon={Plus} size={15} className="h-8 w-8" onClick={() => useUiStore.getState().openConnectionDialog()} />}
        </div>
        <label className="flex cursor-pointer items-center gap-2 text-[12px] text-muted">
          <input type="checkbox" checked={geoOnly} onChange={(e) => setGeoOnly(e.target.checked)} /> Map data only (geometry or H3)
        </label>
      </div>
      <div className="p-2">
        {conns.status === 'loading' && !conns.items.length && <Loading label="Loading connections" />}
        {conns.status === 'error' && <ErrorLine error={{ message: conns.error?.message ?? conns.error, retryable: true }} onRetry={() => useConnectionsStore.getState().loadConnections(true)} />}
        {conns.status === 'ready' && conns.items.length === 0 && (
          <EmptyState icon={Database} title="No database connections">
            {canManage ? 'Add a connection with the + button.' : 'Ask an administrator to add a connection or grant you access.'}
          </EmptyState>
        )}
        <ul>
          {conns.items.map((c) => <ConnectionNode key={c.id} connection={c} filter={filter} geoOnly={geoOnly} startOpen={conns.items.length === 1} />)}
        </ul>
      </div>
      <p className="px-3 pb-3 text-[11px] leading-snug text-muted">
        Sample data stays available without signing in. <Button variant="ghost" size="sm" className="h-auto p-0 align-baseline text-accent underline" onClick={() => useUiStore.getState().openLeftTab('data')}>Back to sample data</Button>
      </p>
    </div>
  )
}
