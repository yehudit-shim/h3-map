import { useState } from 'react'
import { Save, Trash2, Wifi } from 'lucide-react'
import { createConnection, deleteConnection, describeError, testConnection, updateConnection } from '../../api/index.js'
import { useConnectionsStore } from '../../state/connectionsStore.js'
import { notify } from '../../state/notifyStore.js'
import { useUiStore } from '../../state/uiStore.js'
import { Button } from '../Button.jsx'
import Dialog from '../Dialog.jsx'
import { Spinner } from '../feedback.jsx'

const inputCls = 'h-8 w-full rounded-md border border-line bg-raised px-2 text-[13px] text-fg outline-none placeholder:text-muted focus-visible:border-accent'
const SSL = ['require', 'verify-full', 'verify-ca', 'prefer', 'allow', 'disable']

function Field({ id, label, children, hint }) {
  return (
    <div className="py-1">
      <label htmlFor={id} className="mb-1 block text-[12px] text-muted">{label}</label>
      {children}
      {hint && <p className="mt-0.5 text-[11px] text-muted">{hint}</p>}
    </div>
  )
}

function Form({ connection, onClose }) {
  const editing = !!connection
  const [v, setV] = useState({
    name: connection?.name ?? '', host: connection?.host ?? '', port: String(connection?.port ?? 5432), database: connection?.database ?? '',
    username: connection?.username ?? '', sslmode: connection?.sslmode ?? 'require',
  })
  // The password is write-only: it is never returned by the server, so editing starts empty ("unchanged").
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(null) // 'save' | 'test' | 'delete'
  const [error, setError] = useState(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const set = (k) => (e) => setV((s) => ({ ...s, [k]: e.target.value }))

  const body = () => ({ ...v, port: Number(v.port), ...(password ? { password } : {}) })
  const refresh = (id) => {
    const store = useConnectionsStore.getState()
    if (id) store.forgetConnection(id)
    return store.loadConnections(true)
  }

  const save = async (e) => {
    e.preventDefault()
    setBusy('save')
    setError(null)
    try {
      const saved = editing ? await updateConnection(connection.id, body()) : await createConnection({ ...body(), password })
      setPassword('')
      await refresh(saved.id)
      notify(`Connection "${saved.name}" saved.`, { kind: 'success' })
      onClose()
    } catch (err) {
      setError(describeError(err))
    } finally {
      setBusy(null)
    }
  }

  const test = async () => {
    setBusy('test')
    setError(null)
    try {
      const r = await testConnection(connection.id)
      notify(`Connected in ${r.latencyMs} ms${r.postgis ? ` · PostGIS ${r.postgis}` : ' · no PostGIS'}${r.h3Extension ? ' · h3' : ''}`, { kind: 'success' })
    } catch (err) {
      setError(describeError(err))
    } finally {
      setBusy(null)
    }
  }

  const remove = async () => {
    setBusy('delete')
    setError(null)
    try {
      await deleteConnection(connection.id)
      await refresh(connection.id)
      notify(`Connection "${connection.name}" deleted. Layers that used it show a reconnect notice.`, { kind: 'info' })
      onClose()
    } catch (err) {
      setError(describeError(err))
      setBusy(null)
    }
  }

  return (
    <form onSubmit={save} className="flex min-h-0 flex-1 flex-col" aria-label={editing ? 'Edit connection' : 'New connection'}>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        <Field id="cn-name" label="Name"><input id="cn-name" required className={inputCls} value={v.name} onChange={set('name')} /></Field>
        <div className="grid grid-cols-[1fr_90px] gap-2">
          <Field id="cn-host" label="Host"><input id="cn-host" required className={inputCls} value={v.host} onChange={set('host')} spellCheck={false} /></Field>
          <Field id="cn-port" label="Port"><input id="cn-port" required type="number" min="1" max="65535" className={inputCls} value={v.port} onChange={set('port')} /></Field>
        </div>
        <Field id="cn-db" label="Database"><input id="cn-db" required className={inputCls} value={v.database} onChange={set('database')} spellCheck={false} /></Field>
        <div className="grid grid-cols-2 gap-2">
          <Field id="cn-user" label="Username"><input id="cn-user" required className={inputCls} value={v.username} onChange={set('username')} autoComplete="off" spellCheck={false} /></Field>
          <Field id="cn-pass" label="Password">
            <input id="cn-pass" type="password" required={!editing} className={inputCls} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" placeholder={editing ? 'unchanged' : ''} />
          </Field>
        </div>
        <Field id="cn-ssl" label="SSL mode" hint="Use a read-only database role: the server also opens every session read-only.">
          <select id="cn-ssl" className={inputCls} value={v.sslmode} onChange={set('sslmode')}>{SSL.map((s) => <option key={s}>{s}</option>)}</select>
        </Field>
        {error && <p className="mt-2 text-[12px] text-danger" role="alert" data-testid="connection-error">{error}</p>}
      </div>
      <div className="flex flex-wrap items-center gap-2 border-t border-line px-4 py-3">
        {editing && !confirmDelete && <Button variant="ghost" className="text-danger" onClick={() => setConfirmDelete(true)} disabled={!!busy}><Trash2 size={14} aria-hidden="true" /> Delete</Button>}
        {editing && confirmDelete && (
          <span className="flex items-center gap-1.5 text-[12px]">Delete this connection? <Button variant="solid" className="bg-danger" size="sm" onClick={remove} disabled={!!busy}>{busy === 'delete' ? <Spinner label="Deleting" /> : null} Yes, delete</Button><Button size="sm" onClick={() => setConfirmDelete(false)}>No</Button></span>
        )}
        <span className="flex-1" />
        {editing && <Button variant="outline" onClick={test} disabled={!!busy}>{busy === 'test' ? <Spinner label="Testing" /> : <Wifi size={14} aria-hidden="true" />} Test</Button>}
        <Button type="submit" variant="solid" disabled={!!busy}>{busy === 'save' ? <Spinner label="Saving" /> : <Save size={14} aria-hidden="true" />} Save</Button>
      </div>
    </form>
  )
}

/** Add / edit / test / delete a user-defined connection (admin only; the server enforces it). Secrets are write-only. */
export default function ConnectionDialog() {
  const dialog = useUiStore((s) => s.connectionDialog)
  const close = useUiStore((s) => s.closeConnectionDialog)
  if (!dialog) return null
  return (
    <Dialog title={dialog.connection ? `Edit ${dialog.connection.name}` : 'New database connection'} titleId="conn-title" onClose={close} width={460} testId="connection-dialog">
      <Form connection={dialog.connection} onClose={close} />
    </Dialog>
  )
}
