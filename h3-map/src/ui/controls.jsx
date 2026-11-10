import { useId, useState } from 'react'
import { cn } from '../lib/cn.js'
import { rampGradientCss, RAMPS } from '../styling/colorRamps.js'

/** Label + control row used throughout the panels. */
export function Field({ label, hint, children, inline = false, htmlFor }) {
  return (
    <div className={cn('py-1.5', inline && 'flex items-center justify-between gap-3')}>
      <div className={cn('flex items-baseline justify-between', !inline && 'mb-1')}>
        <label htmlFor={htmlFor} className="text-[12px] text-muted">{label}</label>
        {hint && <span className="font-mono text-[11px] text-muted">{hint}</span>}
      </div>
      {children}
    </div>
  )
}

export function Select({ value, onChange, options, id, 'aria-label': ariaLabel, className }) {
  return (
    <select
      id={id}
      aria-label={ariaLabel}
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value)}
      className={cn('h-8 w-full rounded-md border border-line bg-raised px-2 text-[13px] text-fg outline-none focus-visible:border-accent', className)}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
    </select>
  )
}

export function Slider({ value, onChange, min, max, step = 1, id, 'aria-label': ariaLabel }) {
  return (
    <input
      id={id}
      aria-label={ariaLabel}
      type="range"
      min={min}
      max={max}
      step={step}
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
    />
  )
}

/** Text field that applies its value on blur / Enter (so a half-typed URL does not trigger requests). */
export function TextInput({ value, onCommit, placeholder, id, 'aria-label': ariaLabel, invalid }) {
  const [draft, setDraft] = useState(null)
  const commit = () => {
    if (draft !== null && draft !== (value ?? '')) onCommit(draft)
    setDraft(null)
  }
  return (
    <input
      id={id}
      aria-label={ariaLabel}
      type="text"
      spellCheck={false}
      autoComplete="off"
      placeholder={placeholder}
      aria-invalid={invalid || undefined}
      value={draft ?? value ?? ''}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit()
        if (e.key === 'Escape') setDraft(null)
      }}
      className={cn('h-8 w-full rounded-md border bg-raised px-2 text-[13px] text-fg outline-none placeholder:text-muted focus-visible:border-accent', invalid ? 'border-danger' : 'border-line')}
    />
  )
}

export function Switch({ checked, onChange, label, disabled }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn('relative h-5 w-9 shrink-0 cursor-pointer rounded-full border transition-colors disabled:cursor-not-allowed disabled:opacity-40', checked ? 'border-accent bg-accent' : 'border-line bg-raised')}
    >
      <span className={cn('absolute top-0.5 h-3.5 w-3.5 rounded-full transition-all', checked ? 'left-[18px] bg-accent-fg' : 'left-0.5 bg-muted')} />
    </button>
  )
}

export function Segmented({ value, onChange, options, 'aria-label': ariaLabel }) {
  return (
    <div role="radiogroup" aria-label={ariaLabel} className="flex rounded-md border border-line bg-raised p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn('h-7 flex-1 cursor-pointer rounded px-2 text-[12px] transition-colors', value === o.value ? 'bg-accent text-accent-fg font-medium' : 'text-muted hover:text-fg')}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function ColorInput({ value, onChange, label }) {
  const id = useId()
  return (
    <div className="flex items-center gap-2">
      <input
        id={id}
        aria-label={label}
        type="color"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-8 w-10 cursor-pointer rounded-md border border-line bg-raised p-0.5"
      />
      <span className="font-mono text-[12px] uppercase text-muted">{value}</span>
    </div>
  )
}

/** Ramp picker: a native select plus a live gradient preview. */
export function RampSelect({ value, onChange, reverse, id }) {
  return (
    <div className="space-y-1.5">
      <Select id={id} value={value} onChange={onChange} options={Object.keys(RAMPS).map((r) => ({ value: r, label: r }))} />
      <div className="h-2.5 rounded-sm" style={{ background: rampGradientCss(value, reverse) }} aria-hidden="true" />
    </div>
  )
}
