import { useState } from 'react'
import { CheckCircle2, Rocket, Wifi } from 'lucide-react'
import { describeError, runSetup, testSetupDatabase } from '../../api/index.js'
import { useAuthStore } from '../../state/authStore.js'
import { useUiStore } from '../../state/uiStore.js'
import { Button } from '../Button.jsx'
import { Spinner } from '../feedback.jsx'

const inputCls = 'h-8 w-full rounded-md border border-line bg-raised px-2 text-[13px] text-fg outline-none placeholder:text-muted focus-visible:border-accent'
const SSL = ['prefer', 'require', 'verify-full', 'verify-ca', 'allow', 'disable']

function Field({ id, label, hint, children }) {
  return (
    <div className="py-1">
      <label htmlFor={id} className="mb-1 block text-[12px] text-muted">{label}</label>
      {children}
      {hint && <p className="mt-0.5 text-[11px] text-muted">{hint}</p>}
    </div>
  )
}

/**
 * First-run setup: where the server keeps its users and saved connections (an application database) and the first
 * administrator. Shown instead of the sign-in form while the server reports `needsSetup`. All secrets stay in this
 * component's state and are cleared once sent.
 */
export default function SetupForm({ onDone }) {
  const [token, setToken] = useState('')
  const [db, setDb] = useState({ host: 'localhost', port: '5432', database: '', username: '', sslmode: 'prefer' })
  const [dbPassword, setDbPassword] = useState('')
  const [admin, setAdmin] = useState({ username: 'admin' })
  const [adminPassword, setAdminPassword] = useState('')
  const [busy, setBusy] = useState(null) // 'test' | 'setup'
  const [error, setError] = useState(null)
  const [tested, setTested] = useState(false)
  const setD = (k) => (e) => { setTested(false); setDb((s) => ({ ...s, [k]: e.target.value })) }

  const database = () => ({ ...db, port: Number(db.port), password: dbPassword })

  const test = async () => {
    setBusy('test')
    setError(null)
    try {
      await testSetupDatabase({ setupToken: token.trim(), database: database() })
      setTested(true)
    } catch (err) {
      setTested(false)
      setError(describeError(err))
    } finally {
      setBusy(null)
    }
  }

  const submit = async (e) => {
    e.preventDefault()
    setBusy('setup')
    setError(null)
    try {
      await runSetup({ setupToken: token.trim(), database: database(), admin: { username: admin.username.trim(), password: adminPassword } })
      const pw = adminPassword
      setDbPassword('')
      setAdminPassword('')
      setToken('')
      if (await useAuthStore.getState().login(admin.username.trim(), pw)) {
        useUiStore.getState().openLeftTab('database')
        onDone?.()
      }
    } catch (err) {
      setError(describeError(err))
    } finally {
      setBusy(null)
    }
  }

  return (
    <form onSubmit={submit} className="space-y-1" aria-label="First-run setup" data-testid="setup-form">
      <p className="mb-2 text-[12px] leading-snug text-muted">
        This server has no users yet. Tell it which PostgreSQL database to use for its own data (users and saved connections),
        and create the first administrator. Database connections for your maps are added afterwards from the Database panel.
      </p>
      <Field id="su-token" label="Setup token" hint="Printed in the server log when the backend starts.">
        <input id="su-token" required className={inputCls} value={token} onChange={(e) => setToken(e.target.value)} autoComplete="off" spellCheck={false} />
      </Field>
      <div className="grid grid-cols-[1fr_80px] gap-2">
        <Field id="su-host" label="Database host"><input id="su-host" required className={inputCls} value={db.host} onChange={setD('host')} spellCheck={false} /></Field>
        <Field id="su-port" label="Port"><input id="su-port" required type="number" min="1" max="65535" className={inputCls} value={db.port} onChange={setD('port')} /></Field>
      </div>
      <Field id="su-db" label="Database name"><input id="su-db" required className={inputCls} value={db.database} onChange={setD('database')} spellCheck={false} /></Field>
      <div className="grid grid-cols-2 gap-2">
        <Field id="su-dbuser" label="Database user"><input id="su-dbuser" required className={inputCls} value={db.username} onChange={setD('username')} autoComplete="off" spellCheck={false} /></Field>
        <Field id="su-dbpass" label="Database password">
          <input id="su-dbpass" type="password" className={inputCls} value={dbPassword} onChange={(e) => { setTested(false); setDbPassword(e.target.value) }} autoComplete="new-password" />
        </Field>
      </div>
      <Field id="su-ssl" label="SSL mode" hint="The user needs permission to create the schema 'app' in this database.">
        <select id="su-ssl" className={inputCls} value={db.sslmode} onChange={setD('sslmode')}>{SSL.map((s) => <option key={s}>{s}</option>)}</select>
      </Field>
      <div className="grid grid-cols-2 gap-2 border-t border-line pt-2">
        <Field id="su-admin" label="Admin username"><input id="su-admin" required className={inputCls} value={admin.username} onChange={(e) => setAdmin({ username: e.target.value })} autoComplete="username" spellCheck={false} /></Field>
        <Field id="su-adminpass" label="Admin password" hint="At least 8 characters.">
          <input id="su-adminpass" type="password" required minLength={8} className={inputCls} value={adminPassword} onChange={(e) => setAdminPassword(e.target.value)} autoComplete="new-password" />
        </Field>
      </div>
      {error && <p className="text-[12px] text-danger" role="alert" data-testid="setup-error">{error}</p>}
      {tested && !error && <p className="flex items-center gap-1 text-[12px] text-success" role="status"><CheckCircle2 size={13} aria-hidden="true" /> Database reachable.</p>}
      <div className="flex items-center gap-2 pt-2">
        <Button variant="outline" onClick={test} disabled={!!busy || !token || !db.database || !db.username}>
          {busy === 'test' ? <Spinner label="Testing" /> : <Wifi size={14} aria-hidden="true" />} Test database
        </Button>
        <span className="flex-1" />
        <Button type="submit" variant="solid" disabled={!!busy}>
          {busy === 'setup' ? <Spinner label="Setting up" /> : <Rocket size={14} aria-hidden="true" />} Set up and sign in
        </Button>
      </div>
    </form>
  )
}
