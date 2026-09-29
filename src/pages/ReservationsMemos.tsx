import React, { useEffect, useMemo, useState } from 'react'
import { Icon } from '../lib/icons'
import {
  Button, Confirm, Empty, Field, Input, Loading, Modal, Select, Segmented,
  useAction, useAsync, useDebounced, useToast,
} from '../lib/ui'
import { num } from '../lib/calc'
import { dmy, money, todayISO, wt } from '../lib/format'
import { Pagination } from '../lib/inventory'

/**
 * T11 — Reservations and approval/memo stock.
 * Reuses stock_hold so two reservations can never lock the same piece.
 */
export default function ReservationsMemos() {
  const run = useAction()
  const { push } = useToast()

  // Reservations
  const [resStatus, setResStatus] = useState('ACTIVE')
  const [resPage, setResPage] = useState(1)
  const [resEditing, setResEditing] = useState<any>(null)
  const [resSearch, setResSearch] = useState('')
  const resQ = useDebounced(resSearch, 250)
  const reservations = useAsync(() => window.api.reservations.list({ status: resStatus === 'ALL' ? undefined : resStatus, search: resQ, page: resPage }), [resStatus, resQ, resPage])

  // Memos
  const [memoDir, setMemoDir] = useState<'IN' | 'OUT'>('OUT')
  const [memoStatus, setMemoStatus] = useState('ISSUED')
  const [memoPage, setMemoPage] = useState(1)
  const [memoEditing, setMemoEditing] = useState<any>(null)
  const memos = useAsync(() => window.api.memos.list({ direction: memoDir, status: memoStatus === 'ALL' ? undefined : memoStatus, page: memoPage }), [memoDir, memoStatus, memoPage])

  // Tag search for creating reservation/memo
  const [tagSearch, setTagSearch] = useState('')
  const tagResults = useAsync(() => window.api.tagStock.searchPaged({ q: tagSearch, page: 1, pageSize: 20 }), [tagSearch])
  const customers = useAsync(() => window.api.party.list({ type: 'CUSTOMER', search: '' }), [])

  const resRows = reservations.data?.rows || []
  const memoRows = memos.data?.rows || []

  const createReservation = async () => {
    if (!resEditing?.tag_id) return push('error', 'Select a tag')
    if (!resEditing.customer_id && !resEditing.customer_name?.trim()) return push('error', 'Customer required')
    const ok = await run(
      () => window.api.reservations.create({
        customer_id: resEditing.customer_id ? Number(resEditing.customer_id) : null,
        customer_name: resEditing.customer_name || '',
        tag_id: Number(resEditing.tag_id),
        expires_at: resEditing.expires_at || null,
        advance_id: resEditing.advance_id ? Number(resEditing.advance_id) : null,
        actor: 'user'
      }),
      'Reservation created'
    )
    if (ok !== undefined) { setResEditing(null); reservations.reload() }
  }

  const setReservation = async (id: number, status: string) => {
    const ok = await run(() => window.api.reservations.set({ id, status, actor: 'user' }), `Reservation ${status.toLowerCase()}`)
    if (ok !== undefined) reservations.reload()
  }

  const issueMemo = async () => {
    if (!memoEditing?.tag_id && memoDir === 'OUT') return push('error', 'Select a tag for outbound memo')
    if (!memoEditing?.counterparty?.trim()) return push('error', 'Counterparty required')
    const ok = await run(
      () => window.api.memos.issue({
        direction: memoDir, tag_id: memoEditing.tag_id ? Number(memoEditing.tag_id) : null,
        counterparty: memoEditing.counterparty, custodian: memoEditing.custodian,
        due_date: memoEditing.due_date || null, actor: 'user'
      }),
      'Memo issued'
    )
    if (ok !== undefined) { setMemoEditing(null); memos.reload() }
  }

  const closeMemo = async (id: number, outcome: string) => {
    if (!confirm(`Mark as ${outcome}?`)) return
    const ok = await run(() => window.api.memos.close({ id, outcome, actor: 'user' }), `Memo ${outcome.toLowerCase()}`)
    if (ok !== undefined) memos.reload()
  }

  return (
    <div className="content-narrow">
      {/* Reservations panel */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-head">
          <span className="card-title">Reservations</span>
          <button className="btn btn-primary btn-sm" onClick={() => setResEditing({ tag_id: '', customer_id: '', customer_name: '', expires_at: '', advance_id: '' })}>
            <Icon.plus /> Reserve
          </button>
        </div>
        <div className="card-body">
          <div className="toolbar" style={{ marginBottom: 12 }}>
            <Segmented value={resStatus} onChange={v => { setResStatus(v); setResPage(1) }}
              options={[{ value: 'ACTIVE', label: 'Active' }, { value: 'FULFILLED', label: 'Fulfilled' }, { value: 'RELEASED', label: 'Released' }, { value: 'EXPIRED', label: 'Expired' }, { value: 'ALL', label: 'All' }]} />
            <div className="search-box" style={{ maxWidth: 300 }}>
              <Icon.search />
              <input className="input" placeholder="Search customer, tag…" value={resSearch} onChange={e => { setResSearch(e.target.value); setResPage(1) }} />
            </div>
          </div>
          {!reservations.loading && !resRows.length ? (
            <Empty icon={Icon.bookmark} title="No reservations" />
          ) : (
            <>
              <div className="table-wrap">
                <table className="data">
                  <thead>
                    <tr><th>ID</th><th>Created</th><th>Tag</th><th>Customer</th>
                      <th>Status</th><th>Expires</th><th className="r">Advance</th><th></th></tr>
                  </thead>
                  <tbody>
                    {resRows.map((r: any) => (
                      <tr key={r.id}>
                        <td className="mono">#{r.id}</td>
                        <td>{dmy(r.created_at?.slice(0, 10))}</td>
                        <td className="mono strong">{r.tag}</td>
                        <td>{r.customer_name}</td>
                        <td><span className={`badge ${r.status === 'ACTIVE' ? 'badge-gold' : r.status === 'FULFILLED' ? 'badge-ok' : 'badge-mute'}`}>{r.status}</span></td>
                        <td>{r.expires_at ? dmy(r.expires_at.slice(0, 10)) : <span className="muted">—</span>}</td>
                        <td className="r">{r.advance_id ? `A#${r.advance_id}` : <span className="muted">—</span>}</td>
                        <td className="r">
                          {r.status === 'ACTIVE' && (
                            <>
                              <button className="btn btn-ghost btn-icon btn-sm" onClick={() => setReservation(r.id, 'FULFILLED')} title="Fulfilled"><Icon.check /></button>
                              <button className="btn btn-ghost btn-icon btn-sm" onClick={() => setReservation(r.id, 'RELEASED')} title="Released"><Icon.back /></button>
                            </>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Pagination data={reservations.data} onPage={setResPage} disabled={reservations.loading} />
            </>
          )}
        </div>
      </div>

      {/* Memos panel */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-head">
          <span className="card-title">Memo Stock (Approval / Supplier)</span>
          <button className="btn btn-primary btn-sm" onClick={() => setMemoEditing({ direction: memoDir, tag_id: '', counterparty: '', custodian: memoDir === 'OUT' ? 'customer' : 'supplier', due_date: '' })}>
            <Icon.plus /> New Memo
          </button>
        </div>
        <div className="card-body">
          <div className="toolbar" style={{ marginBottom: 12, gap: 12 }}>
            <Segmented value={memoDir} onChange={v => { setMemoDir(v); setMemoPage(1) }}
              options={[{ value: 'OUT', label: 'Outbound (Shop → Customer)' }, { value: 'IN', label: 'Inbound (Supplier → Shop)' }]} />
            <Segmented value={memoStatus} onChange={v => { setMemoStatus(v); setMemoPage(1) }}
              options={[{ value: 'ISSUED', label: 'Issued' }, { value: 'PARTIAL', label: 'Partial' }, { value: 'RETURNED', label: 'Returned' }, { value: 'SOLD', label: 'Sold' }, { value: 'ACQUIRED', label: 'Acquired' }, { value: 'ALL', label: 'All' }]} />
          </div>
          {!memos.loading && !memoRows.length ? (
            <Empty icon={Icon.tag} title="No memo docs" />
          ) : (
            <>
              <div className="table-wrap">
                <table className="data">
                  <thead>
                    <tr><th>ID</th><th>Dir</th><th>Created</th><th>Tag</th><th>Counterparty</th>
                      <th>Custodian</th><th>Status</th><th>Due</th><th></th></tr>
                  </thead>
                  <tbody>
                    {memoRows.map((m: any) => (
                      <tr key={m.id}>
                        <td className="mono">#{m.id}</td>
                        <td><span className="badge">{m.direction}</span></td>
                        <td>{dmy(m.created_at?.slice(0, 10))}</td>
                        <td className="mono">{m.tag || <span className="muted">—</span>}</td>
                        <td>{m.counterparty}</td>
                        <td>{m.custodian}</td>
                        <td><span className={`badge ${m.status === 'ISSUED' ? 'badge-gold' : m.status === 'PARTIAL' ? 'badge-warn' : m.status === 'RETURNED' || m.status === 'ACQUIRED' ? 'badge-ok' : 'badge-mute'}`}>{m.status}</span></td>
                        <td>{m.due_date ? dmy(m.due_date) : <span className="muted">—</span>}</td>
                        <td className="r">
                          {m.status === 'ISSUED' && memoDir === 'OUT' && (
                            <>
                              <button className="btn btn-ghost btn-icon btn-sm" onClick={() => closeMemo(m.id, 'RETURNED')} title="Returned"><Icon.back /></button>
                              <button className="btn btn-ghost btn-icon btn-sm" onClick={() => closeMemo(m.id, 'SOLD')} title="Sold to customer"><Icon.invoice /></button>
                            </>
                          )}
                          {m.status === 'ISSUED' && memoDir === 'IN' && (
                            <button className="btn btn-ghost btn-icon btn-sm" onClick={() => closeMemo(m.id, 'ACQUIRED')} title="Acquired as purchase"><Icon.cart /></button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Pagination data={memos.data} onPage={setMemoPage} disabled={memos.loading} />
            </>
          )}
        </div>
      </div>

      {/* New Reservation modal */}
      {resEditing && (
        <Modal title={resEditing.id ? 'Edit Reservation' : 'Reserve a Piece'} onClose={() => setResEditing(null)}
          footer={<><span className="spacer" /><button className="btn" onClick={() => setResEditing(null)}>Cancel</button><button className="btn btn-primary" onClick={createReservation}><Icon.save /> Reserve</button></>}>
          <div className="form-grid cols-2">
            <Field label="Tag" required>
              <div className="row" style={{ gap: 8 }}>
                <input className="input grow" placeholder="Scan or search tag…" value={tagSearch}
                  onChange={e => { setTagSearch(e.target.value); if (e.target.value) setResEditing({ ...resEditing, tag_id: '' }) }} />
                <button className="btn btn-sm" onClick={() => setTagSearch('')}>Clear</button>
              </div>
              {tagResults.data?.rows?.length && (
                <div className="table-wrap" style={{ maxHeight: 200 }}>
                  <table className="data"><thead><tr><th>Tag</th><th>Item</th><th className="r">Net Wt</th><th></th></tr></thead>
                  <tbody>
                    {tagResults.data.rows.map((t: any) => (
                      <tr key={t.id} onClick={() => setResEditing({ ...resEditing, tag_id: t.id })}>
                        <td className="mono strong">{t.tag}</td><td>{t.item_name}</td>
                        <td className="r num">{wt(t.net_wt)}</td><td><button className="btn btn-sm">Pick</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              )}
              {resEditing.tag_id && <span className="badge badge-ok">Selected: {tagResults.data?.rows?.find(t => t.id === resEditing.tag_id)?.tag}</span>}
            </Field>
            <Field label="Customer">
              <Select value={resEditing.customer_id || ''}
                onChange={v => { const p = (customers.data || []).find(x => String(x.id) === String(v)); setResEditing({ ...resEditing, customer_id: v, customer_name: p?.name || '' }) }}
                options={[{ value: '', label: 'Select…' }, ...(customers.data || []).map((c: any) => ({ value: String(c.id), label: c.name }))]} />
            </Field>
            <Field label="Or Walk-in Name">
              <Input value={resEditing.customer_name} onChange={e => setResEditing({ ...resEditing, customer_name: e.target.value })} />
            </Field>
            <Field label="Expires (optional)">
              <Input type="date" value={resEditing.expires_at} onChange={e => setResEditing({ ...resEditing, expires_at: e.target.value })} />
            </Field>
            <Field label="Linked Advance ID (optional)">
              <Input className="right" inputMode="numeric" value={resEditing.advance_id} onChange={e => setResEditing({ ...resEditing, advance_id: e.target.value })} />
            </Field>
          </div>
        </Modal>
      )}

      {/* New Memo modal */}
      {memoEditing && (
        <Modal title={`New ${memoDir === 'OUT' ? 'Outbound Approval' : 'Inbound Supplier'} Memo`} onClose={() => setMemoEditing(null)}
          footer={<><span className="spacer" /><button className="btn" onClick={() => setMemoEditing(null)}>Cancel</button><button className="btn btn-primary" onClick={issueMemo}><Icon.save /> Issue</button></>}>
          <div className="form-grid cols-2">
            {memoDir === 'OUT' && (
              <Field label="Tag" required>
                <div className="row" style={{ gap: 8 }}>
                  <input className="input grow" placeholder="Search tag…" value={tagSearch}
                    onChange={e => { setTagSearch(e.target.value); if (e.target.value) setMemoEditing({ ...memoEditing, tag_id: '' }) }} />
                </div>
                {tagResults.data?.rows?.length && (
                  <div className="table-wrap" style={{ maxHeight: 200 }}>
                    <table className="data"><thead><tr><th>Tag</th><th>Item</th><th className="r">Net Wt</th><th></th></tr></thead>
                    <tbody>
                      {tagResults.data.rows.map((t: any) => (
                        <tr key={t.id} onClick={() => setMemoEditing({ ...memoEditing, tag_id: t.id })}>
                          <td className="mono strong">{t.tag}</td><td>{t.item_name}</td>
                          <td className="r num">{wt(t.net_wt)}</td><td><button className="btn btn-sm">Pick</button></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  </div>
                )}
                {memoEditing.tag_id && <span className="badge badge-ok">Selected: {tagResults.data?.rows?.find(t => t.id === memoEditing.tag_id)?.tag}</span>}
              </Field>
            )}
            <Field label="Counterparty" required hint={memoDir === 'OUT' ? 'Customer name' : 'Supplier name'}>
              <Input value={memoEditing.counterparty} onChange={e => setMemoEditing({ ...memoEditing, counterparty: e.target.value })} />
            </Field>
            <Field label="Custodian">
              <Input value={memoEditing.custodian} onChange={e => setMemoEditing({ ...memoEditing, custodian: e.target.value })} />
            </Field>
            <Field label="Due Date (optional)">
              <Input type="date" value={memoEditing.due_date} onChange={e => setMemoEditing({ ...memoEditing, due_date: e.target.value })} />
            </Field>
          </div>
        </Modal>
      )}
    </div>
  )
}