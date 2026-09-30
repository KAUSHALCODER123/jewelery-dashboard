import React, { useState } from 'react'
import { Icon } from '../lib/icons'
import {
  Confirm, Empty, Field, Input, Modal, Select,
  useAction, useAsync, useDebounced,
} from '../lib/ui'
import { num } from '../lib/calc'
import { dmy, money, todayISO, wt } from '../lib/format'
import { Pagination } from '../lib/inventory'

/**
 * T10 — Customer repair register.
 * Customer articles are separate custody identity: never saleable shop stock.
 * A job moves RECEIVED → ASSESSED → ASSIGNED → IN_PROGRESS → READY → DELIVERED,
 * and can be cancelled at any open step. Nothing is ever deleted.
 */
const STATES = ['RECEIVED', 'ASSESSED', 'ASSIGNED', 'IN_PROGRESS', 'READY', 'DELIVERED', 'CANCELLED']
const NEXT: Record<string, string[]> = {
  RECEIVED: ['ASSESSED'], ASSESSED: ['ASSIGNED'], ASSIGNED: ['IN_PROGRESS'],
  IN_PROGRESS: ['READY'], READY: ['DELIVERED'], DELIVERED: [], CANCELLED: [],
}
const LABEL: Record<string, string> = {
  RECEIVED: 'Received', ASSESSED: 'Assessed', ASSIGNED: 'Assigned', IN_PROGRESS: 'In progress',
  READY: 'Ready', DELIVERED: 'Delivered', CANCELLED: 'Cancelled',
}
const isOpen = (s: string) => s !== 'DELIVERED' && s !== 'CANCELLED'
const badge = (s: string) => s === 'DELIVERED' ? 'badge-ok' : s === 'CANCELLED' ? 'badge-mute' : s === 'READY' ? 'badge-info' : 'badge-gold'

const BLANK = {
  id: null, status: 'RECEIVED', customer_id: '', customer_name: '', description: '', gross_wt: '', net_wt: '',
  stone_details: '', damage: '', requested_work: '', estimate: '', promised_date: '', karigar_id: '',
}

export default function Repairs(_: { go: (n: string, p?: any) => void }) {
  const run = useAction()
  const [status, setStatus] = useState('OPEN')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [editing, setEditing] = useState<any>(null)
  const [moving, setMoving] = useState<any>(null)
  const q = useDebounced(search, 250)

  const list = useAsync(() => window.api.repairs.list({
    status: status === 'ALL' ? undefined : status, search: q, page,
  }), [status, q, page])
  // The pick lists are only needed once a form is open.
  const needParties = !!(editing || moving)
  const customers = useAsync(() => needParties ? window.api.party.list({ type: 'CUSTOMER' }) : Promise.resolve([]), [needParties])
  const karigars = useAsync(() => needParties ? window.api.party.list({ type: 'KARAGIR' }) : Promise.resolve([]), [needParties])

  const rows: any[] = list.data?.rows || []
  const today = todayISO()

  const open = async (r: any) => {
    const full = await run(() => window.api.repairs.read({ id: r.id }))
    if (full) setEditing({ ...full, promised_date: full.promised_date || '', karigar_id: full.karigar_id || '', customer_id: full.customer_id || '' })
  }

  const save = async () => {
    const payload = {
      ...editing,
      customer_id: editing.customer_id ? Number(editing.customer_id) : null,
      karigar_id: editing.karigar_id ? Number(editing.karigar_id) : null,
      gross_wt: num(editing.gross_wt), net_wt: num(editing.net_wt), estimate: num(editing.estimate),
      promised_date: editing.promised_date || null,
    }
    const ok = await run(
      () => editing.id ? window.api.repairs.update(payload) : window.api.repairs.create(payload),
      editing.id ? 'Repair updated' : 'Repair job created'
    )
    if (ok) { setEditing(null); list.reload() }
  }

  const move = async () => {
    const ok = await run(
      () => window.api.repairs.transition({
        id: moving.job.id, to: moving.to, note: moving.note,
        karigar_id: moving.karigar_id ? Number(moving.karigar_id) : undefined,
      }),
      `Repair #${moving.job.id} → ${LABEL[moving.to]}`
    )
    if (ok) { setMoving(null); setEditing(null); list.reload() }
  }

  const startMove = (job: any, to: string) => setMoving({ job, to, note: '', karigar_id: job.karigar_id ? String(job.karigar_id) : '' })
  const set = (patch: any) => setEditing({ ...editing, ...patch })
  const locked = editing?.id && !isOpen(editing.status)

  return (
    <div className="content-narrow">
      <div className="toolbar">
        <div className="search-box" style={{ flex: 1 }}>
          <Icon.search />
          <input className="input" placeholder="Search by job no., customer or article…" value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1) }} />
        </div>
        <Select value={status} onChange={v => { setStatus(v); setPage(1) }} style={{ width: 170 }}
          options={[{ value: 'OPEN', label: 'Open jobs' }, { value: 'ALL', label: 'All jobs' },
            ...STATES.map(s => ({ value: s, label: LABEL[s] }))]} />
        <button className="btn btn-primary" onClick={() => setEditing({ ...BLANK })}><Icon.plus /> New Repair</button>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-body flush">
          {list.error && <div className="note" role="alert">{list.error} <button className="btn" onClick={list.reload}>Retry</button></div>}
          <Pagination data={list.data} onPage={setPage} disabled={list.loading} />
          {!list.loading && !rows.length ? (
            <Empty icon={Icon.wrench} title={q ? 'No repairs match' : 'No repair jobs'}
              action={<button className="btn btn-primary btn-sm" onClick={() => setEditing({ ...BLANK })}>Take in a repair</button>} />
          ) : (
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th>Job</th><th>Received</th><th>Customer</th><th>Article</th><th>Status</th>
                    <th className="r">Estimate</th><th>Promised</th><th>Karigar</th><th className="r">Wt (g)</th><th></th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const late = isOpen(r.status) && r.promised_date && r.promised_date < today
                    return (
                      <tr key={r.id} onDoubleClick={() => open(r)}>
                        <td className="mono">#{r.id}</td>
                        <td>{dmy(r.created_at?.slice(0, 10))}</td>
                        <td>{r.customer_label}</td>
                        <td style={{ maxWidth: 220 }}>{r.description}</td>
                        <td><span className={`badge ${badge(r.status)}`}>{LABEL[r.status] || r.status}</span></td>
                        <td className="r num">{money(r.estimate)}</td>
                        <td style={late ? { color: 'var(--danger)' } : undefined}>{r.promised_date ? dmy(r.promised_date) : <span className="muted">—</span>}{late && ' · late'}</td>
                        <td>{r.karigar_name || <span className="muted">—</span>}</td>
                        <td className="r num">{wt(r.net_wt || r.gross_wt)}</td>
                        <td className="r" style={{ whiteSpace: 'nowrap' }}>
                          {NEXT[r.status]?.map(to => (
                            <button key={to} className="btn btn-sm" onClick={() => startMove(r, to)}>{LABEL[to]}</button>
                          ))}
                          <button className="btn btn-ghost btn-icon btn-sm" title="Open" aria-label="Open" onClick={() => open(r)}><Icon.edit /></button>
                          {isOpen(r.status) && (
                            <button className="btn btn-ghost btn-icon btn-sm" title="Cancel job" aria-label="Cancel job" onClick={() => startMove(r, 'CANCELLED')}><Icon.close /></button>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {editing && (
        <Modal wide title={editing.id ? `Repair #${editing.id} — ${LABEL[editing.status]}` : 'New Repair'} onClose={() => setEditing(null)}
          footer={<>
            {editing.id && isOpen(editing.status) && NEXT[editing.status].map(to => (
              <button key={to} className="btn" onClick={() => startMove(editing, to)}>Mark {LABEL[to]}</button>
            ))}
            <span className="spacer" />
            <button className="btn" onClick={() => setEditing(null)}>{locked ? 'Close' : 'Cancel'}</button>
            {!locked && <button className="btn btn-primary" onClick={save}><Icon.save /> Save</button>}
          </>}>
          <div className="form-grid cols-2">
            <Field label="Customer" hint="Pick a saved customer, or type a walk-in name beside">
              <Select value={String(editing.customer_id || '')} disabled={locked}
                onChange={(v) => {
                  const p = (customers.data || []).find((x: any) => String(x.id) === v)
                  set({ customer_id: v, customer_name: p?.name || editing.customer_name })
                }}
                options={[{ value: '', label: 'Walk-in' }, ...(customers.data || []).map((c: any) => ({ value: String(c.id), label: c.name }))]} />
            </Field>
            <Field label="Customer Name" required>
              <Input value={editing.customer_name} readOnly={locked} onChange={e => set({ customer_name: e.target.value })} />
            </Field>
            <Field label="Article" className="span-2" hint="What was brought in — e.g. gold chain with pendant">
              <Input value={editing.description} readOnly={locked} onChange={e => set({ description: e.target.value })} />
            </Field>
            <Field label="Gross Wt (g)">
              <Input className="right" inputMode="decimal" value={editing.gross_wt} readOnly={locked} onChange={e => set({ gross_wt: e.target.value })} />
            </Field>
            <Field label="Net Wt (g)">
              <Input className="right" inputMode="decimal" value={editing.net_wt} readOnly={locked} onChange={e => set({ net_wt: e.target.value })} />
            </Field>
            <Field label="Stone Details">
              <Input value={editing.stone_details} readOnly={locked} onChange={e => set({ stone_details: e.target.value })} />
            </Field>
            <Field label="Estimate (₹)">
              <Input className="right" inputMode="decimal" value={editing.estimate} readOnly={locked} onChange={e => set({ estimate: e.target.value })} />
            </Field>
            <Field label="Damage / Condition" className="span-2">
              <Input value={editing.damage} readOnly={locked} onChange={e => set({ damage: e.target.value })} />
            </Field>
            <Field label="Work Requested" className="span-2">
              <Input value={editing.requested_work} readOnly={locked} onChange={e => set({ requested_work: e.target.value })} />
            </Field>
            <Field label="Promised Date">
              <Input type="date" value={editing.promised_date} readOnly={locked} onChange={e => set({ promised_date: e.target.value })} />
            </Field>
            <Field label="Karigar">
              <Select value={String(editing.karigar_id || '')} disabled={locked}
                onChange={v => set({ karigar_id: v })}
                options={[{ value: '', label: '—' }, ...(karigars.data || []).map((k: any) => ({ value: String(k.id), label: k.name }))]} />
            </Field>
          </div>

          {/* Attachments are listed only: the app has no file store for them yet,
              so it does not offer an upload that would keep nothing. */}
          {editing.attachments?.length > 0 && (
            <>
              <div className="divider" style={{ margin: '16px 0' }} />
              <div className="card-title" style={{ marginBottom: 8 }}>Attachments</div>
              <div className="row wrap" style={{ gap: 8 }}>
                {editing.attachments.map((a: any) => (
                  <span key={a.id} className="badge badge-gold">{a.file_name} ({Math.round((a.size || 0) / 1024)} KB)</span>
                ))}
              </div>
            </>
          )}

          {editing.events?.length > 0 && (
            <>
              <div className="divider" style={{ margin: '16px 0' }} />
              <div className="card-title" style={{ marginBottom: 8 }}>History</div>
              <table className="data">
                <thead><tr><th>When</th><th>Step</th><th>By</th><th>Note</th></tr></thead>
                <tbody>
                  {editing.events.map((e: any) => (
                    <tr key={e.id}>
                      <td>{dmy(e.created_at?.slice(0, 10))} {e.created_at?.slice(11, 16)}</td>
                      <td>{e.from_state ? `${LABEL[e.from_state] || e.from_state} → ` : ''}{LABEL[e.to_state] || e.to_state}</td>
                      <td>{e.actor || <span className="muted">—</span>}</td>
                      <td>{e.note}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </Modal>
      )}

      {moving && moving.to === 'CANCELLED' && (
        <Confirm title={`Cancel repair #${moving.job.id}?`} confirmLabel="Cancel job"
          message={`The job for ${moving.job.customer_label || moving.job.customer_name} is closed as cancelled. It stays in the register.`}
          onConfirm={move} onCancel={() => setMoving(null)} />
      )}

      {moving && moving.to !== 'CANCELLED' && (
        <Modal title={`Repair #${moving.job.id} → ${LABEL[moving.to]}`} onClose={() => setMoving(null)}
          footer={<><span className="spacer" /><button className="btn" onClick={() => setMoving(null)}>Cancel</button>
            <button className="btn btn-primary" onClick={move} disabled={moving.to === 'ASSIGNED' && !moving.karigar_id}>Mark {LABEL[moving.to]}</button></>}>
          <div className="form-grid">
            {moving.to === 'ASSIGNED' && (
              <Field label="Karigar" required>
                <Select value={moving.karigar_id} onChange={v => setMoving({ ...moving, karigar_id: v })}
                  options={[{ value: '', label: 'Choose…' }, ...(karigars.data || []).map((k: any) => ({ value: String(k.id), label: k.name }))]} />
              </Field>
            )}
            <Field label="Note" hint="Optional — kept in the job's history">
              <Input autoFocus value={moving.note} onChange={e => setMoving({ ...moving, note: e.target.value })} />
            </Field>
          </div>
        </Modal>
      )}
    </div>
  )
}
