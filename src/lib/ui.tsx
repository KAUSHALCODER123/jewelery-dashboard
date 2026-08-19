import React, {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
} from 'react'
import { Icon } from './icons'

/* ───────────────────────────── Toasts ───────────────────────────── */

type Toast = { id: number; kind: 'ok' | 'error' | 'info'; text: string; out?: boolean }
const ToastCtx = createContext<{
  push: (kind: Toast['kind'], text: string) => void
}>({ push: () => {} })

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const seq = useRef(0)

  const push = useCallback((kind: Toast['kind'], text: string) => {
    const id = ++seq.current
    setToasts((t) => [...t, { id, kind, text }])
    setTimeout(() => setToasts((t) => t.map((x) => (x.id === id ? { ...x, out: true } : x))), 3200)
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3450)
  }, [])

  const value = useMemo(() => ({ push }), [push])
  return (
    <ToastCtx.Provider value={value}>
      {children}
      <div className="toasts">
        {toasts.map((t) => {
          const I = t.kind === 'ok' ? Icon.check : t.kind === 'error' ? Icon.alert : Icon.info
          return (
            <div key={t.id} className={`toast toast-${t.kind} ${t.out ? 'out' : ''}`} role="status">
              <I />
              <span>{t.text}</span>
            </div>
          )
        })}
      </div>
    </ToastCtx.Provider>
  )
}

export const useToast = () => useContext(ToastCtx)

/** Wrap an async action: shows an error toast instead of an unhandled rejection. */
export function useAction() {
  const { push } = useToast()
  return useCallback(
    async <T,>(fn: () => Promise<T>, okMsg?: string): Promise<T | undefined> => {
      try {
        const r = await fn()
        if (okMsg) push('ok', okMsg)
        return r
      } catch (e: any) {
        push('error', e?.message || 'Something went wrong')
        return undefined
      }
    },
    [push]
  )
}

/* ───────────────────────────── Data loading ───────────────────────────── */

export function useAsync<T>(fn: () => Promise<T>, deps: any[] = [], initial?: T) {
  const [data, setData] = useState<T | undefined>(initial)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [nonce, setNonce] = useState(0)
  const alive = useRef(true)

  useEffect(() => {
    alive.current = true
    setLoading(true)
    fn()
      .then((d) => { if (alive.current) { setData(d); setError(null) } })
      .catch((e) => { if (alive.current) setError(e?.message || String(e)) })
      .finally(() => { if (alive.current) setLoading(false) })
    return () => { alive.current = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, nonce])

  return { data, loading, error, reload: () => setNonce((n) => n + 1), setData }
}

/** Debounce a fast-changing value (search boxes). */
export function useDebounced<T>(value: T, ms = 250) {
  const [v, setV] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return v
}

/* ───────────────────────────── Form primitives ───────────────────────────── */

export function Field({
  label, required, hint, error, children, className = '',
}: {
  label?: string; required?: boolean; hint?: string; error?: string
  children: React.ReactNode; className?: string
}) {
  return (
    <div className={`field ${className}`}>
      {label && (
        <label className="label">
          {label} {required && <span className="req">*</span>}
        </label>
      )}
      {children}
      {error ? <span className="err">{error}</span> : hint ? <span className="hint">{hint}</span> : null}
    </div>
  )
}

export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`input ${props.className || ''}`} />
}

/** Numeric input that keeps the raw text while focused so typing "1." works. */
export function NumInput({
  value, onValue, decimals = 2, className = '', ...rest
}: {
  value: any; onValue: (n: number) => void; decimals?: number
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'>) {
  const [draft, setDraft] = useState<string | null>(null)
  const shown =
    draft ?? (value === 0 || value == null || value === '' ? '' : String(value))
  return (
    <input
      {...rest}
      className={`input right ${className}`}
      inputMode="decimal"
      value={shown}
      onChange={(e) => {
        const t = e.target.value
        if (t !== '' && !/^-?\d*\.?\d*$/.test(t)) return
        setDraft(t)
        onValue(t === '' || t === '-' || t === '.' ? 0 : Number(t))
      }}
      onFocus={(e) => { setDraft(shown); e.target.select() }}
      onBlur={(e) => {
        setDraft(null)
        rest.onBlur?.(e)
      }}
    />
  )
}

export function Select({
  value, onChange, options, placeholder, className = '', ...rest
}: {
  value: any
  onChange: (v: string) => void
  options: { value: any; label: string }[]
  placeholder?: string
} & Omit<React.SelectHTMLAttributes<HTMLSelectElement>, 'value' | 'onChange'>) {
  return (
    <select
      {...rest}
      className={`select ${className}`}
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value)}
    >
      {placeholder && <option value="">{placeholder}</option>}
      {options.map((o) => (
        <option key={String(o.value)} value={o.value}>{o.label}</option>
      ))}
    </select>
  )
}

export function Check({
  checked, onChange, label,
}: { checked: boolean; onChange: (b: boolean) => void; label: string }) {
  return (
    <label className="check">
      <input type="checkbox" checked={!!checked} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  )
}

export function Segmented({
  value, onChange, options,
}: { value: string; onChange: (v: string) => void; options: { value: string; label: string }[] }) {
  return (
    <div className="radio-row" role="group">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={value === o.value}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

/* ───────────────────────────── Autocomplete ───────────────────────────── */

export function Autocomplete<T>({
  value, onText, onPick, fetch, render, placeholder, className = '', inputRef, onKeyDown,
}: {
  value: string
  onText: (s: string) => void
  onPick: (item: T) => void
  fetch: (q: string) => Promise<T[]>
  render: (item: T) => React.ReactNode
  placeholder?: string
  className?: string
  inputRef?: React.RefObject<HTMLInputElement>
  onKeyDown?: (e: React.KeyboardEvent) => void
}) {
  const [items, setItems] = useState<T[]>([])
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const q = useDebounced(value, 180)
  const box = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let alive = true
    if (!open) return
    fetch(q).then((r) => { if (alive) { setItems(r); setActive(0) } }).catch(() => {})
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, open])

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [])

  return (
    <div className={`ac ${className}`} ref={box}>
      <input
        ref={inputRef}
        className="input"
        value={value}
        placeholder={placeholder}
        onChange={(e) => { onText(e.target.value); setOpen(true) }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (open && items.length) {
            if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(a + 1, items.length - 1)); return }
            if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); return }
            if (e.key === 'Enter') { e.preventDefault(); onPick(items[active]); setOpen(false); return }
          }
          if (e.key === 'Escape') { setOpen(false); return }
          onKeyDown?.(e)
        }}
      />
      {open && (
        <div className="ac-list">
          {items.length === 0 ? (
            <div className="ac-empty">{value ? 'No match' : 'Start typing…'}</div>
          ) : (
            items.map((it, i) => (
              <button
                key={i}
                type="button"
                className="ac-item"
                data-active={i === active}
                onMouseEnter={() => setActive(i)}
                onClick={() => { onPick(it); setOpen(false) }}
              >
                {render(it)}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  )
}

/* ───────────────────────────── Modal ───────────────────────────── */

export function Modal({
  title, onClose, children, footer, wide,
}: {
  title: string; onClose: () => void; children: React.ReactNode
  footer?: React.ReactNode; wide?: boolean
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className={`modal ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-head">
          <span className="modal-title">{title}</span>
          <button className="btn btn-ghost btn-icon btn-sm" style={{ marginLeft: 'auto' }} onClick={onClose} aria-label="Close">
            <Icon.close />
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  )
}

export function Confirm({
  title, message, confirmLabel = 'Delete', onConfirm, onCancel, danger = true,
}: {
  title: string; message: string; confirmLabel?: string
  onConfirm: () => void; onCancel: () => void; danger?: boolean
}) {
  return (
    <Modal
      title={title}
      onClose={onCancel}
      footer={
        <>
          <span className="spacer" />
          <button className="btn" onClick={onCancel}>Cancel</button>
          <button className={danger ? 'btn btn-danger' : 'btn btn-primary'} onClick={onConfirm}>
            {confirmLabel}
          </button>
        </>
      }
    >
      <p style={{ color: 'var(--text-2)' }}>{message}</p>
    </Modal>
  )
}

/* ───────────────────────────── States ───────────────────────────── */

export function Empty({
  icon: I = Icon.info, title, children, action,
}: { icon?: any; title: string; children?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="empty">
      <I />
      <div className="empty-title">{title}</div>
      {children && <p>{children}</p>}
      {action && <div style={{ marginTop: 8 }}>{action}</div>}
    </div>
  )
}

export function Loading({ rows = 5 }: { rows?: number }) {
  return (
    <div style={{ padding: 16, display: 'grid', gap: 8 }}>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="skeleton" style={{ height: 34, opacity: 1 - i * 0.13 }} />
      ))}
    </div>
  )
}

/** Number that animates to its new value — used on dashboard tiles. */
export function CountUp({ value, format }: { value: number; format: (n: number) => string }) {
  const [shown, setShown] = useState(0)
  const from = useRef(0)
  useEffect(() => {
    const a = from.current
    const b = Number(value) || 0
    if (a === b) { setShown(b); return }

    const dur = 550
    let raf = 0
    // Take the start from the first frame's own timestamp. Using performance.now()
    // here can sit *after* the next rAF timestamp, which makes progress negative —
    // the cubic easing then overshoots below zero and the tile shows a negative number.
    let startTs: number | null = null
    // If frames are throttled (offscreen window, background tab), land on the
    // final value rather than freezing part-way.
    const settle = setTimeout(() => {
      cancelAnimationFrame(raf)
      from.current = b
      setShown(b)
    }, dur + 400)

    const tick = (t: number) => {
      if (startTs === null) startTs = t
      const p = Math.min(1, Math.max(0, (t - startTs) / dur))
      const eased = 1 - Math.pow(1 - p, 3)
      setShown(a + (b - a) * eased)
      if (p < 1) raf = requestAnimationFrame(tick)
      else { from.current = b; clearTimeout(settle) }
    }
    raf = requestAnimationFrame(tick)

    return () => { cancelAnimationFrame(raf); clearTimeout(settle) }
  }, [value])
  return <>{format(shown)}</>
}
