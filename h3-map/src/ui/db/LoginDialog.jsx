import { useEffect, useState } from 'react'
import { LogIn } from 'lucide-react'
import { getSetupStatus } from '../../api/index.js'
import { useAuthStore } from '../../state/authStore.js'
import { useUiStore } from '../../state/uiStore.js'
import { Button } from '../Button.jsx'
import Dialog from '../Dialog.jsx'
import { Spinner } from '../feedback.jsx'
import SetupForm from './SetupForm.jsx'

const inputCls = 'h-9 w-full rounded-md border border-line bg-raised px-2.5 text-[13px] text-fg outline-none placeholder:text-muted focus-visible:border-accent'

/** Sign-in form. The password only lives in this component's state and is cleared as soon as it is sent. */
export function LoginForm({ onDone, autoFocus = true }) {
  const status = useAuthStore((s) => s.status)
  const error = useAuthStore((s) => s.error)
  const expired = useAuthStore((s) => s.expired)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const busy = status === 'signing-in'

  const submit = async (e) => {
    e.preventDefault()
    if (busy || !username || !password) return
    const pw = password
    setPassword('')
    const ok = await useAuthStore.getState().login(username.trim(), pw)
    if (ok) {
      useUiStore.getState().openLeftTab('database')
      onDone?.()
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3" aria-label="Sign in" data-testid="login-form">
      {expired && !error && <p className="rounded-md border border-line bg-raised px-2.5 py-2 text-[12px] text-warn" role="status">Your session expired. Sign in again to continue.</p>}
      <div>
        <label htmlFor="login-user" className="mb-1 block text-[12px] text-muted">Username</label>
        <input id="login-user" className={inputCls} autoComplete="username" autoFocus={autoFocus} value={username} onChange={(e) => setUsername(e.target.value)} spellCheck={false} />
      </div>
      <div>
        <label htmlFor="login-pass" className="mb-1 block text-[12px] text-muted">Password</label>
        <input id="login-pass" type="password" className={inputCls} autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
      </div>
      {error && <p className="text-[12px] text-danger" role="alert" data-testid="login-error">{error}</p>}
      <Button type="submit" variant="solid" className="w-full" disabled={busy || !username || !password}>
        {busy ? <Spinner label="Signing in" /> : <LogIn size={14} aria-hidden="true" />} Sign in
      </Button>
    </form>
  )
}

/** Sign-in, or the first-run setup form while the server reports that nobody can sign in yet. */
function DialogBody({ onDone }) {
  const [needsSetup, setNeedsSetup] = useState(null) // null while the server is being asked
  useEffect(() => {
    const ctl = new AbortController()
    getSetupStatus({ signal: ctl.signal }).then((r) => setNeedsSetup(!!r.needsSetup), () => setNeedsSetup(false))
    return () => ctl.abort()
  }, [])
  if (needsSetup === null) return <div className="flex justify-center p-6"><Spinner label="Contacting the server" /></div>
  if (needsSetup) return <div className="p-4"><SetupForm onDone={onDone} /></div>
  return (
    <div className="p-4">
      <p className="mb-3 text-[12px] leading-snug text-muted">The browser never connects to PostgreSQL. You sign in to the map server, which holds the database credentials.</p>
      <LoginForm onDone={onDone} />
    </div>
  )
}

export default function LoginDialog() {
  const open = useUiStore((s) => s.loginOpen)
  const close = useUiStore((s) => s.closeLogin)
  if (!open) return null
  return (
    <Dialog title="Sign in to the database server" titleId="login-title" onClose={close} width={440} testId="login-dialog">
      <DialogBody onDone={close} />
    </Dialog>
  )
}
