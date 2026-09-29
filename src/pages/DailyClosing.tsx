import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Icon } from '../lib/icons'
import {
  Check, Confirm, Empty, Field, Input, Loading, Modal, Select,
  useAction, useAsync, useDebounced, useToast,
} from '../lib/ui'
import { num } from '../lib/calc'
import { dmy, money, todayISO, wt } from '../lib/format'
import { Pagination } from '../lib/inventory'

/**
 * Daily closing with manual payment settlement matching (T08).
 * Maps all authoritative movements, prevents double-counting,
 * supports draft → submitted → locked workflow.
 */
export default function DailyClosing({ go }: { go: (n: string, p?: any) => void }) {
  const run = useAction()
  const { push } = useToast()

  const [sessions, setSessions] = useState<any[]>([])
  const [sessionsPage, setSessionsPage] = useState(1)
  const [sessionsTotal, setSessionsTotal] = useState(0)
  const [sessionsLoading, setSessionsLoading] = useState(false)
  const [session, setSession] = useState<any>(null)
  const [counts, setCounts] = useState<Record<string, number>>({})
  const [explicitAmount, setExplicitAmount] = useState('')
  const [sessionsOpen, setSessionsOpen] = useState(false)
  const [newDate, setNewDate] = useState(todayISO())
  const newDateRef = useRef<HTMLInputElement>(null)

  const loadSessions = async (page = 1) => {
    setSessionsLoading(true)
    try {
      const res = await window.api.closing.list({ page, pageSize: 20 })
      setSessions(res.rows || [])
      setSessionsTotal(res.total || 0)
      setSessionsPage(page)
    } finally { setSessionsLoading(false) }
  }

  useEffect(() => { loadSessions(1) }, [])

  const openSession = async (business_date: string, branch?: string) => {
    const res = await window.api.closing.open({ business_date, branch, actor: 'user' })
    if (res) { setSession(res); push('ok', 'Closing session opened') }
  }

  const loadSession = async (id: number) => {
    const res = await window.api.closing.read({ id })
    if (res) { setSession(res) }
  }

  const saveCount = async (denom: string | null, qty: number, amount?: number) => {
    if (!session) return
    const res = await window.api.closing.saveCount({ session_id: session.id, denomination: denom ? Number(denom) : null, qty, amount: amount ?? 0, actor: 'user' })
    if (res) { setSession(res) }
  }

  const matchSettlement = async () => {
    if (!session) return
    const provider = prompt('Provider (e.g. PhonePe, HDFC Bank):')
    if (!provider) return
    const ref = prompt('Provider reference / UTR:')
    if (!ref) return
    const amount = parseFloat(prompt('Net settlement amount:') || '0')
    if (!amount) return
    const sourceType = prompt('Source type (sale/voucher/urd):')
    if (!sourceType) return
    const sourceId = parseInt(prompt('Source ID:') || '0', 10)
    if (!sourceId) return

    const res = await window.api.closing.match({
      session_id: session.id, settlement_ref: ref, provider,
      allocations: [{ source_type: sourceType, source_id: sourceId, amount }],
      actor: 'user'
    })
    if (res) { loadSession(session.id); push('ok', 'Settlement matched') }
  }

  const submit = async () => {
    if (!session) return
    const res = await window.api.closing.submit({ id: session.id, actor: 'user' })
    if (res) { setSession(res); push('ok', 'Closing submitted for approval') }
  }

  const approve = async () => {
    if (!session) return
    const note = prompt('Approval note:') || ''
    const res = await window.api.closing.approve({ id: session.id, actor: 'user', note })
    if (res) { setSession(res); push('ok', 'Closing locked') }
  }

  const reopen = async () => {
    if (!session) return
    const reason = prompt('Reason for reopening:')
    if (!reason) return
    const res = await window.api.closing.reopen({ id: session.id, actor: 'user', reason })
    if (res) { setSession(res); push('ok', 'Closing reopened') }
  }

  const denominations = [2000, 500, 200, 100, 50, 20, 10, 5, 2, 1, 0.5]
  const countedTotal = useMemo(() =>
    Object.entries(counts).reduce((s, [d, q]) => s + Number(d) * q, 0), [counts])

  const expected = session?.expected
  const variance = expected ? countedTotal - expected.expected : 0

  return (
    <div className="content-narrow">
      <div className="toolbar" style={{ marginBottom: 16 }}>
        <div className="form-grid cols-3" style={{ gap: 12 }}>
          <Field label="Business Date" required>
            <Input type="date" ref={newDateRef} value={newDate} onChange={(e) => setNewDate(e.target.value)} />
          </Field>
          <Field label="Branch">
            <Input value={''} placeholder="Company-wide" readOnly />
          </Field>
          <button className="btn btn-primary" onClick={() => openSession(newDateRef.current?.value || newDate)}>
            <Icon.plus /> Open / Load Closing
          </button>
        </div>
        <button className="btn btn-sm" onClick={() => { loadSessions(1); setSessionsOpen(true) }}>
          <Icon.list /> All Sessions
        </button>
      </div>

      {session && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="card-head">
            <span className="card-title">Closing: {dmy(session.business_date)} · {session.status}</span>
            <div className="row" style={{ gap: 8 }}>
              {session.status === 'DRAFT' && (
                <>
                  <button className="btn btn-primary" onClick={submit}>Submit for Approval</button>
                  <button className="btn" onClick={matchSettlement}><Icon.link /> Match Settlement</button>
                </>
              )}
              {session.status === 'SUBMITTED' && (
                <button className="btn btn-primary" onClick={approve}>Approve & Lock</button>
              )}
              {session.status === 'LOCKED' && (
                <button className="btn" onClick={reopen}><Icon.back /> Reopen</button>
              )}
            </div>
          </div>
          <div className="card-body">
            <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(4, minmax(0,1fr))' }}>
              <div className="stat">
                <div className="stat-label">Expected Cash</div>
                <div className="stat-value num">₹{money(expected?.expected || 0)}</div>
                <div className="stat-meta">Opening: ₹{money(expected?.opening || 0)} + In: ₹{money((expected?.cashIn || 0) + (expected?.cashSales || 0))} − Out: ₹{money(expected?.cashOut || 0)}</div>
              </div>
              <div className="stat">
                <div className="stat-label">Counted Cash</div>
                <div className="stat-value num">₹{money(countedTotal)}</div>
                <div className="stat-meta">Denomination breakdown below</div>
              </div>
              <div className="stat">
                <div className="stat-label">Variance</div>
                <div className="stat-value num" style={{ color: variance > 0 ? 'var(--ok)' : variance < 0 ? 'var(--danger)' : undefined }}>
                  {variance >= 0 ? '+' : ''}₹{money(variance)}
                </div>
                <div className="stat-meta">Explain before locking</div>
              </div>
              <div className="stat">
                <div className="stat-label">Receivable</div>
                <div className="stat-value num">₹{money(session?.receivable || 0)}</div>
                <div className="stat-meta">From ledger balances</div>
              </div>
            </div>

            <div className="card" style={{ marginTop: 16 }}>
              <div className="card-head"><span className="card-title">Cash Count</span></div>
              <div className="card-body flush">
                <div className="table-wrap">
                  <table className="data">
                    <thead>
                      <tr><th>Denom</th><th className="r">Qty</th><th className="r">Amount</th><th></th></tr>
                    </thead>
                    <tbody>
                      {denominations.map((d) => (
                        <tr key={d}>
                          <td className="mono strong">₹{d}</td>
                          <td className="r">
                            <Input className="right" inputMode="decimal" style={{ width: 80 }}
                              value={counts[d] || ''}
                              onChange={(e) => { const v = parseInt(e.target.value) || 0; setCounts(c => ({ ...c, [d]: v })) }}
                              onBlur={() => saveCount(String(d), counts[d] || 0)} />
                          </td>
                          <td className="r num">{money((counts[d] || 0) * d)}</td>
                          <td></td>
                        </tr>
                      ))}
                      <tr>
                        <td>Explicit amount</td>
                        <td className="r">
                          <Input className="right" inputMode="decimal" style={{ width: 100 }}
                            value={explicitAmount}
                            onChange={(e) => { setExplicitAmount(e.target.value); saveCount(null, 1, parseFloat(e.target.value) || 0) }} />
                        </td>
                        <td className="r num">{money(parseFloat(explicitAmount) || 0)}</td>
                        <td></td>
                      </tr>
                      <tr className="sep">
                        <td><b>Total</b></td>
                        <td className="r"><b>{Object.values(counts).reduce((s, q) => s + q, 0)}</b></td>
                        <td className="r num"><b>₹{money(countedTotal)}</b></td>
                        <td></td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            {session.matches?.length && (
              <div className="card" style={{ marginTop: 16 }}>
                <div className="card-head"><span className="card-title">Settlement Matches</span></div>
                <div className="card-body flush">
                  <div className="table-wrap">
                    <table className="data">
                      <thead>
                        <tr><th>Provider</th><th>Ref</th><th className="r">Net</th><th>Source</th><th className="r">Amount</th></tr>
                      </thead>
                      <tbody>
                        {session.matches.map((m: any) => (
                          <tr key={m.id}>
                            <td>{m.provider}</td>
                            <td className="mono">{m.provider_ref}</td>
                            <td className="r num">₹{money(m.net)}</td>
                            <td>{m.source_type}:{m.source_id}</td>
                            <td className="r num">₹{money(m.amount)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {!session && (
        <Empty icon={Icon.chart} title="No closing session open">
          Select a business date and open a closing session to begin.
        </Empty>
      )}

      {/* Sessions modal */}
      {sessionsOpen && (
        <Modal title="Closing Sessions" onClose={() => setSessionsOpen(false)}
          footer={<button className="btn" onClick={() => setSessionsOpen(false)}>Close</button>}>
          <div className="card">
            <div className="card-body flush">
              <div className="table-wrap">
                <table className="data">
                  <thead>
                    <tr><th>Date</th><th>Branch</th><th>Status</th><th className="r">Expected</th><th className="r">Counted</th><th className="r">Variance</th><th></th></tr>
                  </thead>
                  <tbody>
                    {sessions.map((s: any) => (
                      <tr key={s.id}>
                        <td>{dmy(s.business_date)}</td>
                        <td>{s.branch || '—'}</td>
                        <td><span className={`badge ${s.status === 'LOCKED' ? 'badge-ok' : s.status === 'SUBMITTED' ? 'badge-gold' : 'badge-mute'}`}>{s.status}</span></td>
                        <td className="r">₹{money(s.expected_cash)}</td>
                        <td className="r">₹{money(s.counted_cash || 0)}</td>
                        <td className="r" style={{ color: (s.variance || 0) > 0 ? 'var(--ok)' : (s.variance || 0) < 0 ? 'var(--danger)' : undefined }}>
                          {(s.variance || 0) >= 0 ? '+' : ''}₹{money(s.variance || 0)}
                        </td>
                        <td className="r">
                          <button className="btn btn-sm" onClick={() => { loadSession(s.id); setSessionsOpen(false) }}>Load</button>
                        </td>
                      </tr>
                    ))}
                    {!sessions.length && <tr><td colSpan={7} className="muted">No sessions</td></tr>}
                  </tbody>
                </table>
              </div>
              <Pagination data={{page: sessionsPage, pageSize: 20, total: sessionsTotal}}
                onPage={loadSessions} disabled={sessionsLoading} />
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}