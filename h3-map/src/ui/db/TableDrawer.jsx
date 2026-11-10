import { useEffect, useState } from 'react'
import { ChevronLeft, ChevronRight, Plus, RefreshCw } from 'lucide-react'
import { describeError, getRows, isAbort } from '../../api/index.js'
import { planStrategies } from '../../data/pgPlan.js'
import { cn } from '../../lib/cn.js'
import { formatNumber } from '../../lib/format.js'
import { tableKey, useConnectionsStore } from '../../state/connectionsStore.js'
import { useUiStore } from '../../state/uiStore.js'
import { Button, IconButton } from '../Button.jsx'
import Dialog from '../Dialog.jsx'
import { Badge, EmptyState, Spinner } from '../feedback.jsx'
import ProfileWarnings from './ProfileWarnings.jsx'

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'columns', label: 'Columns' },
  { id: 'indexes', label: 'Indexes' },
  { id: 'preview', label: 'Preview' },
]
const PREVIEW_PAGE = 25

function Overview({ profile, target, onRefresh }) {
  const plan = planStrategies(profile)
  const rows = [
    ['Kind', profile.kind],
    ['Rows (estimated)', profile.estimatedRows == null ? 'unknown' : formatNumber(profile.estimatedRows)],
    ['Primary key', profile.primaryKey?.length ? profile.primaryKey.join(', ') : 'none'],
    ...(profile.geometry ?? []).map((g) => [`Geometry · ${g.column}`, `${g.type} · SRID ${g.srid}${g.storage === 'geography' ? ' · geography' : ''}`]),
    ...(profile.h3 ?? []).map((h) => [`H3 · ${h.column}`, `${h.storage} · res ${h.resolutions?.join(', ') || '?'} · confidence ${Math.round((h.confidence ?? 0) * 100)}%`]),
    ['Extent', profile.extent?.bbox ? `${profile.extent.bbox.map((v) => v.toFixed(4)).join(', ')}${profile.extent.estimated ? ' (estimated)' : ''}` : 'unknown'],
    ['Suggested strategy', plan.recommended ?? 'not mappable'],
  ]
  return (
    <div className="space-y-3 p-4">
      {profile.comment && <p className="text-[12px] leading-snug text-muted">{profile.comment}</p>}
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5">
        {rows.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-[12px] text-muted">{k}</dt>
            <dd className="min-w-0 break-words text-right font-mono text-[12px]">{v}</dd>
          </div>
        ))}
      </dl>
      <ProfileWarnings warnings={profile.warnings} />
      {profile.warnings?.length === 0 && <p className="text-[12px] text-ok">No problems found.</p>}
      <div className="flex gap-2 pt-1">
        <Button variant="solid" disabled={!plan.options.length} onClick={() => useUiStore.getState().openAddToMap(target)}><Plus size={14} aria-hidden="true" /> Add to map</Button>
        <Button variant="outline" onClick={onRefresh}><RefreshCw size={13} aria-hidden="true" /> Refresh</Button>
      </div>
    </div>
  )
}

function Columns({ profile }) {
  return (
    <table className="w-full text-left text-[12px]" aria-label="Columns">
      <thead className="sticky top-0 bg-panel text-muted"><tr><th className="px-3 py-1.5 font-medium">Name</th><th className="py-1.5 font-medium">Type</th><th className="px-3 py-1.5 text-right font-medium">Null</th></tr></thead>
      <tbody>
        {profile.columns.map((c) => (
          <tr key={c.name} className="border-t border-line">
            <td className="px-3 py-1.5 font-mono">{c.name}{c.isPrimaryKey && <Badge tone="accent" className="ml-1.5">PK</Badge>}</td>
            <td className="py-1.5 font-mono text-muted">{c.type}</td>
            <td className="px-3 py-1.5 text-right text-muted">{c.nullable ? 'yes' : 'no'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function Indexes({ profile }) {
  if (!profile.indexes?.length) return <EmptyState title="No indexes">Queries on this table scan all rows.</EmptyState>
  return (
    <ul className="divide-y divide-line" aria-label="Indexes">
      {profile.indexes.map((i) => (
        <li key={i.name} className="px-4 py-2">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="font-mono text-[12px]">{i.name}</span>
            <Badge>{i.method}</Badge>
            {i.spatial && <Badge tone="accent">spatial</Badge>}
            {i.primary && <Badge>primary</Badge>}
            {i.unique && !i.primary && <Badge>unique</Badge>}
          </div>
          <div className="mt-0.5 font-mono text-[11px] text-muted">{i.columns.join(', ')}</div>
        </li>
      ))}
    </ul>
  )
}

/** Paginated rows. `OFFSET` paging with a small page: the backend caps the offset and answers with an error beyond it. */
function Preview({ target }) {
  const [page, setPage] = useState(0)
  const [attempt, setAttempt] = useState(0) // bumped by Retry
  const [result, setResult] = useState({ key: null, data: null, error: null })
  const { connectionId, schema, table } = target
  const key = `${page}:${attempt}`

  useEffect(() => {
    const controller = new AbortController()
    getRows(connectionId, schema, table, { limit: PREVIEW_PAGE, offset: page * PREVIEW_PAGE, signal: controller.signal }).then(
      (data) => setResult({ key, data, error: null }),
      (e) => !isAbort(e) && setResult((prev) => ({ key, data: prev.data, error: describeError(e) })),
    )
    return () => controller.abort()
  }, [connectionId, schema, table, page, attempt, key])

  const loading = result.key !== key
  const { data } = result
  const error = loading ? null : result.error
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-auto" aria-busy={loading}>
        {error && (
          <div className="p-4" role="alert">
            <p className="text-[13px] text-danger">{error}</p>
            <Button className="mt-2" variant="outline" onClick={() => setAttempt((n) => n + 1)}><RefreshCw size={13} aria-hidden="true" /> Retry</Button>
          </div>
        )}
        {loading && !data && <div className="flex items-center gap-2 p-4 text-[13px] text-muted"><Spinner label="Loading rows" /> Loading rows…</div>}
        {data && !error && data.rows.length === 0 && <EmptyState title="No rows">This table is empty.</EmptyState>}
        {data && !error && data.rows.length > 0 && (
          <table className={cn('w-full text-left text-[12px]', loading && 'opacity-50')} aria-label="Row preview">
            <thead className="sticky top-0 bg-panel text-muted">
              <tr>{data.columns.map((c) => <th key={c.name} className="whitespace-nowrap px-2.5 py-1.5 font-medium">{c.name}</th>)}</tr>
            </thead>
            <tbody>
              {data.rows.map((r, i) => (
                <tr key={i} className="border-t border-line">
                  {r.map((v, j) => <td key={j} className="max-w-[180px] truncate whitespace-nowrap px-2.5 py-1 font-mono" title={v == null ? '' : String(v)}>{v == null ? <span className="text-muted">null</span> : String(v)}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <div className="flex items-center justify-between border-t border-line px-3 py-2 text-[12px] text-muted">
        <span>Rows {page * PREVIEW_PAGE + 1}–{page * PREVIEW_PAGE + (data?.rows.length ?? 0)}</span>
        <span className="flex items-center gap-1">
          <IconButton label="Previous page" icon={ChevronLeft} size={14} className="h-7 w-7" disabled={page === 0 || loading} onClick={() => setPage((p) => p - 1)} />
          <IconButton label="Next page" icon={ChevronRight} size={14} className="h-7 w-7" disabled={!data?.page?.hasMore || loading} onClick={() => setPage((p) => p + 1)} />
        </span>
      </div>
    </div>
  )
}

/** Table detail drawer: overview, columns, indexes, preview (docs/UI_UX_DESIGN.md section 5). */
export default function TableDrawer() {
  const target = useUiStore((s) => s.tableDrawer)
  if (!target) return null
  return <DrawerBody key={tableKey(target.connectionId, target.schema, target.table)} target={target} />
}

function DrawerBody({ target }) {
  const close = useUiStore((s) => s.closeTable)
  const [tab, setTab] = useState('overview')
  const key = tableKey(target.connectionId, target.schema, target.table)
  const entry = useConnectionsStore((s) => s.profiles[key])
  useEffect(() => {
    useConnectionsStore.getState().loadProfile(target.connectionId, target.schema, target.table)
  }, [target])
  const profile = entry?.status === 'ready' ? entry.data : null
  const refresh = () => useConnectionsStore.getState().loadProfile(target.connectionId, target.schema, target.table, true)

  return (
    <Dialog side title={`${target.schema}.${target.table}`} titleId="drawer-title" onClose={close} width={460} testId="table-drawer">
      <div role="tablist" aria-label="Table details" className="flex gap-0.5 border-b border-line px-3 pt-1.5">
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            id={`drawer-tab-${t.id}`}
            aria-selected={tab === t.id}
            aria-controls="drawer-panel"
            onClick={() => setTab(t.id)}
            className={cn('cursor-pointer border-b-2 px-3 py-1.5 text-[12px] transition-colors', tab === t.id ? 'border-accent font-medium text-fg' : 'border-transparent text-muted hover:text-fg')}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div id="drawer-panel" role="tabpanel" aria-labelledby={`drawer-tab-${tab}`} className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        {tab === 'preview' ? (
          <Preview target={target} />
        ) : profile ? (
          <>
            {tab === 'overview' && <Overview profile={profile} target={target} onRefresh={refresh} />}
            {tab === 'columns' && <Columns profile={profile} />}
            {tab === 'indexes' && <Indexes profile={profile} />}
          </>
        ) : entry?.status === 'error' ? (
          <div className="p-4" role="alert">
            <p className="text-[13px] text-danger">Could not read the table: {entry.error.message}</p>
            {entry.error.retryable && <Button className="mt-2" variant="outline" onClick={refresh}><RefreshCw size={13} aria-hidden="true" /> Retry</Button>}
          </div>
        ) : (
          <div className="flex items-center gap-2 p-6 text-[13px] text-muted"><Spinner label="Reading table profile" /> Reading the table profile…</div>
        )}
      </div>
    </Dialog>
  )
}
