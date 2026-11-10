import { useState } from 'react'
import { AlertTriangle, Check, Copy } from 'lucide-react'
import { copyText } from '../../lib/clipboard.js'
import { IconButton } from '../Button.jsx'

function Suggestion({ text }) {
  const [done, setDone] = useState(false)
  return (
    <div className="mt-1.5 flex items-start gap-1 rounded border border-line bg-raised p-1.5">
      <code className="min-w-0 flex-1 select-all break-all font-mono text-[11px] leading-snug" data-testid="warning-suggestion">{text}</code>
      <IconButton
        label="Copy statement"
        icon={done ? Check : Copy}
        size={13}
        className="h-6 w-6"
        onClick={async () => {
          if (await copyText(text)) {
            setDone(true)
            setTimeout(() => setDone(false), 1500)
          }
        }}
      />
    </div>
  )
}

/**
 * Profile warnings (docs/DATABASE_INTEGRATION.md section 3). The suggested `CREATE INDEX` is only shown: the app
 * never runs DDL on a user database, so the user copies it to run themselves.
 */
export default function ProfileWarnings({ warnings, compact = false }) {
  if (!warnings?.length) return null
  return (
    <ul className="space-y-2" aria-label="Table warnings" data-testid="profile-warnings">
      {warnings.map((w, i) => (
        <li key={`${w.code}-${w.column ?? i}`} className="rounded-md border border-warn/40 bg-warn/10 p-2">
          <div className="flex items-start gap-1.5 text-[12px] leading-snug">
            <AlertTriangle size={13} className="mt-0.5 shrink-0 text-warn" aria-hidden="true" />
            <span>{w.message}</span>
          </div>
          {w.suggestion && (compact ? <div className="mt-1 text-[11px] text-muted">A suggested fix is in the table details.</div> : (
            <>
              <div className="mt-1.5 text-[11px] text-muted">Run this on the database yourself (the app does not change your database):</div>
              <Suggestion text={w.suggestion} />
            </>
          ))}
        </li>
      ))}
    </ul>
  )
}
