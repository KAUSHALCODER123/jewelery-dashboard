import React, { useEffect, useMemo, useState } from 'react'
import { Icon } from '../lib/icons'
import { Empty, Field, Input, Loading, Modal, useAction } from '../lib/ui'
import { num } from '../lib/calc'
import { dmy, money, todayISO } from '../lib/format'
import { Pagination } from '../lib/inventory'

/**
 * Daily closing (T08): count the cash in the drawer against the Cash Book,
 * match card / UPI settlements to the day's bank receipts, then submit →
 * approve & lock. A locked day can be reopened with a reason.
 *
 * Expected cash is the Cash Book's closing for the day, so the close always
 * agrees with the cash book, day book and trial balance.
 */
const STATUS_BADGE: Record<string, string> = { DRAFT: 'badge-mute', SUBMITTED: 'badge-gold', LOCKED: 'badge-ok' }
const signed = (v: number) => `${v > 0 ? '+' : v < 0 ? '−' : ''}₹${money(Math.abs(v))}`
const tone = (v: number) => (v > 0.004 ? 'var(--ok)' : v < -0.004 ? 'var(--danger)' : undefined)

export default function DailyClosing(_: { go: (n: string, p?: any) => void }) {
  const run = useAction()
  const [date, setDate] = useState(todayISO())
  const [session, setSession] = useState<any>(null)
  const [booting, setBooting] = useState(true)
  const [busy, setBusy] = useState(false)
  const [history, setHistory] = useState(false)
  const [ask, setAsk] = useState<null | 'approve' | 'reopen'>(null)
  const [matching, setMatching] = useState(false)

  // Pick up today's close if one is already under way; never create one unasked.
  useEffect(() => {
    const d = todayISO()
    window.api.closing.list({ from: d, to: d, pageSize: 10 })
      .then((r: any) => r.rows?.[0] && window.api.closing.read({ id: r.rows[0].id }).then(setSession))
      .catch(() => {})
      .finally(() => setBooting(false))
  }, [])

  const act = async (fn: () => Promise<any>, ok?: string) => {
    setBusy(true)
    const res = await run(fn, ok)
    setBusy(false)
    if (res && typeof res === 'object' && 'business_date' in res) setSession(res)
    return res
  }

  const openDay = () => act(() => window.api.closing.open({ business_date: date }))
  const load = (id: number) => act(() => window.api.closing.read({ id }))

  if (booting) return <Loading rows={4} />

  return (
    <div className="content-narrow">
      <div className="toolbar" style={{ marginBottom: 16, alignItems: 'flex-end' }}>
        <Field label="Business Date">
          <Input type="date" value={date} max={todayISO()} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <button className="btn btn-primary" onClick={openDay} disabled={busy || !date}>
          <Icon.plus /> Open Close
        </button>
        <span className="spacer" />
        <button className="btn" onClick={() => setHistory(true)}><Icon.list /> All Closes</button>
      </div>

      {session
        ? <Session s={session} busy={busy} act={act} onAsk={setAsk} onMatch={() => setMatching(true)} />
        : <Empty icon={Icon.chart} title="No close open">Pick the day and press Open Close to count the cash.</Empty>}

      {history && (
        <History onClose={() => setHistory(false)} onPick={(id) => { setHistory(false); load(id) }} />
      )}

      {ask && session && (
        <NoteModal
          title={ask === 'approve' ? 'Approve & lock this day' : 'Reopen this day'}
          label={ask === 'approve' ? 'Approval note' : 'Reason for reopening'}
          hint={ask === 'approve'
            ? (Math.abs(num(session.variance)) >= 0.01 ? 'Required — explain the variance' : 'Optional')
            : 'Required — kept in the audit trail'}
          action={ask === 'approve' ? 'Approve & Lock' : 'Reopen'}
          onClose={() => setAsk(null)}
          onSave={async (text) => {
            const res = await act(() => ask === 'approve'
              ? window.api.closing.approve({ id: session.id, note: text })
              : window.api.closing.reopen({ id: session.id, reason: text }),
            ask === 'approve' ? 'Day locked' : 'Day reopened')
            if (res) setAsk(null)
          }} />
      )}

      {matching && session && (
        <MatchModal s={session} onClose={() => setMatching(false)}
          onSave={async (p) => {
            const res = await act(() => window.api.closing.match({ session_id: session.id, ...p }), 'Settlement matched')
            if (res) setMatching(false)
          }} />
      )}
    </div>
  )
}

function Session({ s, busy, act, onAsk, onMatch }: {
  s: any; busy: boolean; act: (fn: () => Promise<any>, ok?: string) => Promise<any>
  onAsk: (a: 'approve' | 'reopen') => void; onMatch: () => void
}) {
  const editable = s.status === 'DRAFT'
  const exp = s.expected || {}

  // The drawer count as typed, hydrated from what was last saved.
  const saved = useMemo(() => {
    const m: Record<string, string> = {}
    let other = ''
    for (const c of s.counts || []) {
      if (c.denomination == null) other = String(c.amount)
      else m[String(c.denomination)] = String(c.qty)
    }
    return { m, other }
  }, [s])
  const [qty, setQty] = useState<Record<string, string>>(saved.m)
  const [other, setOther] = useState(saved.other)
  useEffect(() => { setQty(saved.m); setOther(saved.other) }, [saved])

  const denoms: number[] = s.denominations || []
  const typedTotal = denoms.reduce((t, d) => t + d * Math.trunc(num(qty[d])), 0) + num(other)
  const dirty = denoms.some((d) => (qty[d] || '') !== (saved.m[d] || '')) || (other || '') !== (saved.other || '')
  const variance = typedTotal - num(exp.expected)

  const saveCount = () => act(() => window.api.closing.saveCounts({
    session_id: s.id,
    counts: denoms.map((d) => ({ denomination: d, qty: Math.trunc(num(qty[d])) })).filter((c) => c.qty > 0),
    other: num(other),
  }), 'Cash count saved')

  return (
    <>
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-head">
          <span className="card-title">Close for {dmy(s.business_date)}</span>
          <span className={`badge ${STATUS_BADGE[s.status] || 'badge-mute'}`} style={{ marginLeft: 8 }}>{s.status}</span>
          {s.revision > 1 && <span className="small muted" style={{ marginLeft: 8 }}>revision {s.revision}</span>}
          <span className="spacer" />
          <div className="row" style={{ gap: 8 }}>
            {editable && (
              <button className="btn btn-primary" disabled={busy || dirty || s.counted_cash == null || s.stale}
                title={dirty ? 'Save the count first' : s.counted_cash == null ? 'Count the cash first' : undefined}
                onClick={() => act(() => window.api.closing.submit({ id: s.id }), 'Close submitted for approval')}>
                <Icon.send /> Submit
              </button>
            )}
            {s.status === 'SUBMITTED' && (
              <button className="btn btn-primary" disabled={busy} onClick={() => onAsk('approve')}>
                <Icon.check /> Approve & Lock
              </button>
            )}
            {(s.status === 'SUBMITTED' || s.status === 'LOCKED') && (
              <button className="btn" disabled={busy} onClick={() => onAsk('reopen')}><Icon.back /> Reopen</button>
            )}
          </div>
        </div>
        <div className="card-body">
          {s.stale && (
            <div className="note" role="alert" style={{ marginBottom: 12 }}>
              Entries for this day changed after the cash was counted.
              {editable ? ' Check the figures and save the count again before submitting.' : ' Reopen the day and recount.'}
            </div>
          )}
          {s.reopen_reason && s.status === 'DRAFT' && (
            <p className="small muted" style={{ marginTop: 0 }}>Reopened: {s.reopen_reason}</p>
          )}
          <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(3, minmax(0,1fr))' }}>
            <div className="stat">
              <div className="stat-label">Expected Cash</div>
              <div className="stat-value num">₹{money(exp.expected)}</div>
              <div className="stat-meta">
                Opening ₹{money(exp.opening)} + in ₹{money(exp.cashIn)} − out ₹{money(exp.cashOut)}
              </div>
            </div>
            <div className="stat">
              <div className="stat-label">Counted Cash</div>
              <div className="stat-value num">₹{money(typedTotal)}</div>
              <div className="stat-meta">{dirty ? 'Not saved yet' : s.counted_cash == null ? 'Not counted' : 'Saved'}</div>
            </div>
            <div className="stat">
              <div className="stat-label">Variance</div>
              <div className="stat-value num" style={{ color: tone(variance) }}>{signed(variance)}</div>
              <div className="stat-meta">{Math.abs(variance) < 0.01 ? 'Drawer agrees with the cash book' : variance > 0 ? 'Excess in drawer' : 'Short in drawer'}</div>
            </div>
          </div>
        </div>
      </div>

      <div className="row" style={{ gap: 16, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <div className="card" style={{ flex: '1 1 340px' }}>
          <div className="card-head">
            <span className="card-title">Cash Count</span>
            <span className="spacer" />
            {editable && (
              <button className="btn btn-sm btn-primary" disabled={busy || (!dirty && !s.stale)} onClick={saveCount}>
                <Icon.save /> Save Count
              </button>
            )}
          </div>
          <div className="card-body flush">
            <table className="data">
              <thead><tr><th>Note / Coin</th><th className="r">Count</th><th className="r">Amount</th></tr></thead>
              <tbody>
                {denoms.map((d) => (
                  <tr key={d}>
                    <td className="mono strong">₹{d}</td>
                    <td className="r">
                      <Input className="right" inputMode="numeric" style={{ width: 90 }} disabled={!editable}
                        aria-label={`₹${d} count`} value={qty[d] || ''}
                        onChange={(e) => /^\d*$/.test(e.target.value) && setQty((q) => ({ ...q, [d]: e.target.value }))} />
                    </td>
                    <td className="r num">{money(d * Math.trunc(num(qty[d])))}</td>
                  </tr>
                ))}
                <tr>
                  <td>Other / loose cash</td>
                  <td className="r">
                    <Input className="right" inputMode="decimal" style={{ width: 90 }} disabled={!editable}
                      aria-label="Other cash" value={other}
                      onChange={(e) => /^\d*\.?\d{0,2}$/.test(e.target.value) && setOther(e.target.value)} />
                  </td>
                  <td className="r num">{money(num(other))}</td>
                </tr>
              </tbody>
              <tfoot>
                <tr><td><b>Total</b></td><td /><td className="r num"><b>₹{money(typedTotal)}</b></td></tr>
              </tfoot>
            </table>
          </div>
        </div>

        <div className="card" style={{ flex: '2 1 440px' }}>
          <div className="card-head"><span className="card-title">Cash Book for the day</span></div>
          <div className="card-body flush">
            <div className="table-wrap" style={{ maxHeight: 420 }}>
              <table className="data">
                <thead><tr><th>Particulars</th><th>Doc</th><th className="r">In</th><th className="r">Out</th><th className="r">Balance</th></tr></thead>
                <tbody>
                  <tr className="muted"><td colSpan={4}>Opening</td><td className="r num">{money(exp.opening)}</td></tr>
                  {(exp.entries || []).map((e: any, i: number) => (
                    <tr key={i}>
                      <td>{e.particulars}</td>
                      <td className="mono small">{e.doc_type} {e.doc_no}</td>
                      <td className="r num">{num(e.debit) ? money(e.debit) : ''}</td>
                      <td className="r num">{num(e.credit) ? money(e.credit) : ''}</td>
                      <td className="r num">{money(e.balance)}</td>
                    </tr>
                  ))}
                  {!(exp.entries || []).length && <tr><td colSpan={5} className="muted">No cash moved on this day.</td></tr>}
                </tbody>
                <tfoot>
                  <tr><td colSpan={2}><b>Closing</b></td>
                    <td className="r num">{money(exp.cashIn)}</td><td className="r num">{money(exp.cashOut)}</td>
                    <td className="r num"><b>{money(exp.expected)}</b></td></tr>
                </tfoot>
              </table>
            </div>
          </div>
        </div>
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <div className="card-head">
          <span className="card-title">Card / UPI / Bank receipts</span>
          <span className="spacer" />
          {(s.status === 'DRAFT' || s.status === 'SUBMITTED') && (s.non_cash || []).some((r: any) => r.amount - r.matched > 0.004) && (
            <button className="btn btn-sm" disabled={busy} onClick={onMatch}><Icon.link /> Match Settlement</button>
          )}
        </div>
        <div className="card-body flush">
          <table className="data">
            <thead><tr><th>Document</th><th>Account</th><th className="r">Received</th><th className="r">Settled</th><th className="r">Pending</th></tr></thead>
            <tbody>
              {(s.non_cash || []).map((r: any) => (
                <tr key={`${r.doc_type}:${r.doc_id}`}>
                  <td className="mono">{r.doc_type} {r.doc_no}</td>
                  <td>{r.account}</td>
                  <td className="r num">{money(r.amount)}</td>
                  <td className="r num">{money(r.matched)}</td>
                  <td className="r num" style={{ color: r.amount - r.matched > 0.004 ? 'var(--warn)' : undefined }}>{money(r.amount - r.matched)}</td>
                </tr>
              ))}
              {!(s.non_cash || []).length && <tr><td colSpan={5} className="muted">No bank, card or UPI receipts on this day.</td></tr>}
            </tbody>
          </table>
          {(s.matches || []).length > 0 && (
            <table className="data" style={{ marginTop: 12 }}>
              <thead><tr><th>Provider</th><th>Reference</th><th className="r">Settled net</th><th>Against</th><th className="r">Amount</th></tr></thead>
              <tbody>
                {s.matches.map((m: any) => (
                  <tr key={m.id}>
                    <td>{m.provider || '—'}</td>
                    <td className="mono">{m.provider_ref}</td>
                    <td className="r num">₹{money(m.net)}</td>
                    <td className="mono small">{m.source_type} #{m.source_id}</td>
                    <td className="r num">₹{money(m.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </>
  )
}

function NoteModal({ title, label, hint, action, onClose, onSave }: {
  title: string; label: string; hint: string; action: string
  onClose: () => void; onSave: (text: string) => void
}) {
  const [text, setText] = useState('')
  return (
    <Modal title={title} onClose={onClose}
      footer={<><span className="spacer" /><button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" onClick={() => onSave(text.trim())}>{action}</button></>}>
      <Field label={label} hint={hint}>
        <textarea className="textarea" autoFocus value={text} onChange={(e) => setText(e.target.value)} />
      </Field>
    </Modal>
  )
}

function MatchModal({ s, onClose, onSave }: {
  s: any; onClose: () => void; onSave: (p: any) => void
}) {
  const pending = (s.non_cash || []).filter((r: any) => r.amount - r.matched > 0.004)
  const [provider, setProvider] = useState('')
  const [ref, setRef] = useState('')
  const [fees, setFees] = useState('')
  const [alloc, setAlloc] = useState<Record<string, string>>({})
  const key = (r: any) => `${r.doc_type}:${r.doc_id}`
  const total = pending.reduce((t: number, r: any) => t + num(alloc[key(r)]), 0)
  const save = () => onSave({
    provider, settlement_ref: ref, fees: num(fees),
    allocations: pending.filter((r: any) => num(alloc[key(r)]) > 0)
      .map((r: any) => ({ source_type: r.doc_type, source_id: r.doc_id, amount: num(alloc[key(r)]) })),
  })
  return (
    <Modal title="Match a settlement" wide onClose={onClose}
      footer={<><span className="small muted">Allocated ₹{money(total)} · net ₹{money(total - num(fees))}</span>
        <span className="spacer" /><button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" disabled={!ref.trim() || total <= 0} onClick={save}><Icon.link /> Match</button></>}>
      <div className="form-grid cols-3">
        <Field label="Provider"><Input value={provider} placeholder="PhonePe, HDFC card…" onChange={(e) => setProvider(e.target.value)} /></Field>
        <Field label="Reference / UTR" required><Input className="mono" value={ref} onChange={(e) => setRef(e.target.value)} /></Field>
        <Field label="Fees deducted"><Input className="right" inputMode="decimal" value={fees} onChange={(e) => setFees(e.target.value)} /></Field>
      </div>
      <table className="data" style={{ marginTop: 12 }}>
        <thead><tr><th>Receipt</th><th className="r">Pending</th><th className="r">Settled by this</th><th /></tr></thead>
        <tbody>
          {pending.map((r: any) => {
            const left = Math.round((r.amount - r.matched) * 100) / 100
            return (
              <tr key={key(r)}>
                <td className="mono">{r.doc_type} {r.doc_no} <span className="muted small">· {r.account}</span></td>
                <td className="r num">{money(left)}</td>
                <td className="r"><Input className="right" inputMode="decimal" style={{ width: 120 }} value={alloc[key(r)] || ''}
                  onChange={(e) => setAlloc((a) => ({ ...a, [key(r)]: e.target.value }))} /></td>
                <td><button className="btn btn-sm btn-ghost" onClick={() => setAlloc((a) => ({ ...a, [key(r)]: String(left) }))}>All</button></td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </Modal>
  )
}

function History({ onClose, onPick }: { onClose: () => void; onPick: (id: number) => void }) {
  const [page, setPage] = useState(1)
  const [data, setData] = useState<any>(null)
  useEffect(() => {
    let alive = true
    window.api.closing.list({ page, pageSize: 20 }).then((d: any) => alive && setData(d)).catch(() => alive && setData({ rows: [] }))
    return () => { alive = false }
  }, [page])
  return (
    <Modal title="Daily closes" wide onClose={onClose}
      footer={<><span className="spacer" /><button className="btn" onClick={onClose}>Close</button></>}>
      {!data ? <Loading rows={4} /> : (
        <>
          <table className="data">
            <thead><tr><th>Date</th><th>Status</th><th className="r">Expected</th><th className="r">Counted</th><th className="r">Variance</th><th /></tr></thead>
            <tbody>
              {data.rows.map((r: any) => (
                <tr key={r.id}>
                  <td>{dmy(r.business_date)}</td>
                  <td><span className={`badge ${STATUS_BADGE[r.status] || 'badge-mute'}`}>{r.status}</span></td>
                  <td className="r num">₹{money(r.expected_cash)}</td>
                  <td className="r num">{r.counted_cash == null ? '—' : `₹${money(r.counted_cash)}`}</td>
                  <td className="r num" style={{ color: tone(num(r.variance)) }}>{r.variance == null ? '—' : signed(num(r.variance))}</td>
                  <td className="r"><button className="btn btn-sm" onClick={() => onPick(r.id)}>Open</button></td>
                </tr>
              ))}
              {!data.rows.length && <tr><td colSpan={6} className="muted">No closes yet.</td></tr>}
            </tbody>
          </table>
          <Pagination data={data} onPage={setPage} />
        </>
      )}
    </Modal>
  )
}
