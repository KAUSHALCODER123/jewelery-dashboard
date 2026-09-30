import React, { useState } from 'react'
import { Icon } from '../lib/icons'
import {
  Autocomplete, Confirm, Empty, Field, Input, Modal, Segmented,
  useAction, useAsync, useDebounced,
} from '../lib/ui'
import { dmy, todayISO, wt } from '../lib/format'
import { Pagination } from '../lib/inventory'

/**
 * T11 — Reservations and approval/memo stock.
 * Both put a hold on the piece, so it cannot be billed, sent out on memo or
 * reserved twice until the reservation or memo is closed.
 */

type Tag = { id: number; tag: string; item_name: string; net_wt: number }
type Party = { id: number; name: string; mobile?: string }

const fetchTags = async (q: string): Promise<Tag[]> =>
  q.trim() ? (await window.api.tagStock.searchPaged({ q, page: 1, pageSize: 20 })).rows || [] : []
const fetchCustomers = (q: string): Promise<Party[]> =>
  window.api.party.list({ type: 'CUSTOMER', search: q }).then((r: Party[]) => r.slice(0, 20))

/** Scan or type a tag; the pick is kept as the whole row so its label never goes stale. */
function TagPicker({ value, onPick }: { value: Tag | null; onPick: (t: Tag | null) => void }) {
  const [text, setText] = useState('')
  if (value) {
    return (
      <div className="row" style={{ gap: 8 }}>
        <span className="badge badge-gold mono">{value.tag}</span>
        <span className="small">{value.item_name} · {wt(value.net_wt)} g</span>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => onPick(null)}>Change</button>
      </div>
    )
  }
  return (
    <Autocomplete<Tag> value={text} onText={setText} placeholder="Scan or type tag, HUID or item…"
      fetch={fetchTags} onPick={(t) => { onPick(t); setText('') }}
      render={(t) => <><span className="mono strong">{t.tag}</span> <span className="muted">{t.item_name} · {wt(t.net_wt)} g</span></>} />
  )
}

const RES_BADGE: Record<string, string> = { ACTIVE: 'badge-gold', FULFILLED: 'badge-ok' }
const MEMO_BADGE: Record<string, string> = { ISSUED: 'badge-gold', RETURNED: 'badge-ok', ACQUIRED: 'badge-ok', SOLD: 'badge-info' }

export default function ReservationsMemos() {
  const run = useAction()

  /* ── Reservations ── */
  const [resStatus, setResStatus] = useState('ACTIVE')
  const [resPage, setResPage] = useState(1)
  const [resSearch, setResSearch] = useState('')
  const resQ = useDebounced(resSearch, 250)
  const reservations = useAsync(
    () => window.api.reservations.list({ status: resStatus === 'ALL' ? undefined : resStatus, search: resQ, page: resPage }),
    [resStatus, resQ, resPage])
  const [resNew, setResNew] = useState<{ tag: Tag | null; customer: Party | null; name: string; expires_at: string } | null>(null)

  /* ── Memos ── */
  const [memoDir, setMemoDir] = useState<'IN' | 'OUT'>('OUT')
  const [memoStatus, setMemoStatus] = useState('ISSUED')
  const [memoPage, setMemoPage] = useState(1)
  const [memoSearch, setMemoSearch] = useState('')
  const memoQ = useDebounced(memoSearch, 250)
  const memos = useAsync(
    () => window.api.memos.list({ direction: memoDir, status: memoStatus === 'ALL' ? undefined : memoStatus, search: memoQ, page: memoPage }),
    [memoDir, memoStatus, memoQ, memoPage])
  const [memoNew, setMemoNew] = useState<{ tag: Tag | null; counterparty: string; custodian: string; due_date: string } | null>(null)

  /* A pending state change waiting for the user to confirm it. */
  const [ask, setAsk] = useState<{ title: string; message: string; label: string; danger: boolean; go: () => Promise<unknown> } | null>(null)

  const resRows = reservations.data?.rows || []
  const memoRows = memos.data?.rows || []

  const createReservation = async () => {
    if (!resNew) return
    const ok = await run(() => window.api.reservations.create({
      tag_id: resNew.tag?.id,
      customer_id: resNew.customer?.id ?? null,
      customer_name: resNew.customer?.name || resNew.name,
      expires_at: resNew.expires_at || null,
    }), 'Piece reserved')
    if (ok !== undefined) { setResNew(null); reservations.reload() }
  }

  const setReservation = (r: any, status: 'FULFILLED' | 'RELEASED') => setAsk({
    title: status === 'FULFILLED' ? 'Customer is buying it?' : 'Release reservation?',
    message: status === 'FULFILLED'
      ? `${r.tag} comes off hold so it can be billed to ${r.customer_name}.`
      : `${r.tag} goes back on the counter and can be sold to anyone.`,
    label: status === 'FULFILLED' ? 'Fulfil' : 'Release', danger: status === 'RELEASED',
    go: async () => {
      const ok = await run(() => window.api.reservations.set({ id: r.id, status }), status === 'FULFILLED' ? 'Reservation fulfilled — ready to bill' : 'Reservation released')
      if (ok !== undefined) reservations.reload()
    },
  })

  const issueMemo = async () => {
    if (!memoNew) return
    const ok = await run(() => window.api.memos.issue({
      direction: memoDir, tag_id: memoNew.tag?.id ?? null,
      counterparty: memoNew.counterparty, custodian: memoNew.custodian, due_date: memoNew.due_date || null,
    }), 'Memo issued')
    if (ok !== undefined) { setMemoNew(null); memos.reload() }
  }

  const MEMO_TEXT: Record<string, string> = {
    RETURNED: 'Returned', SOLD: 'Sold — bill it', ACQUIRED: 'Acquired as purchase',
  }
  const closeMemo = (m: any, outcome: string) => setAsk({
    title: `Close memo #${m.id}?`,
    message: outcome === 'SOLD' ? `${m.tag} comes off hold so it can be billed to ${m.counterparty}.`
      : outcome === 'RETURNED' && m.direction === 'OUT' ? `${m.tag} is back in the shop and on sale again.`
      : outcome === 'ACQUIRED' ? 'Record the goods through Purchase and tagging; this only closes the memo.'
      : 'The supplier goods have been returned.',
    label: MEMO_TEXT[outcome], danger: false,
    go: async () => {
      const ok = await run(() => window.api.memos.close({ id: m.id, outcome }), `Memo ${MEMO_TEXT[outcome].toLowerCase()}`)
      if (ok !== undefined) memos.reload()
    },
  })

  return (
    <div className="content-narrow">
      {/* ── Reservations ── */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-head">
          <span className="card-title">Reservations</span>
          <span className="spacer" />
          <button className="btn btn-primary btn-sm" onClick={() => setResNew({ tag: null, customer: null, name: '', expires_at: '' })}>
            <Icon.plus /> Reserve a Piece
          </button>
        </div>
        <div className="card-body">
          <div className="toolbar" style={{ marginBottom: 12 }}>
            <Segmented value={resStatus} onChange={v => { setResStatus(v); setResPage(1) }}
              options={[{ value: 'ACTIVE', label: 'Active' }, { value: 'FULFILLED', label: 'Fulfilled' }, { value: 'RELEASED', label: 'Released' }, { value: 'EXPIRED', label: 'Expired' }, { value: 'ALL', label: 'All' }]} />
            <div className="search-box" style={{ maxWidth: 300 }}>
              <Icon.search />
              <input className="input" placeholder="Search customer, tag, item…" value={resSearch}
                onChange={e => { setResSearch(e.target.value); setResPage(1) }} />
            </div>
          </div>
          {reservations.error && <div className="danger small" role="alert" style={{ marginBottom: 8 }}>{reservations.error} <button className="btn btn-sm" onClick={reservations.reload}>Retry</button></div>}
          {!reservations.loading && !resRows.length ? (
            <Empty icon={Icon.bookmark} title="No reservations" />
          ) : (
            <>
              <div className="table-wrap">
                <table className="data">
                  <thead>
                    <tr><th>No</th><th>Date</th><th>Tag</th><th>Item</th><th className="r">Net Wt</th><th>Customer</th>
                      <th>Status</th><th>Hold until</th><th></th></tr>
                  </thead>
                  <tbody>
                    {resRows.map((r: any) => (
                      <tr key={r.id}>
                        <td className="mono">#{r.id}</td>
                        <td>{dmy(r.created_at?.slice(0, 10))}</td>
                        <td className="mono strong">{r.tag}</td>
                        <td>{r.item_name}</td>
                        <td className="r num">{wt(r.net_wt)}</td>
                        <td>{r.customer_name}</td>
                        <td><span className={`badge ${RES_BADGE[r.status] || 'badge-mute'}`}>{r.status}</span></td>
                        <td>{r.expires_at ? dmy(r.expires_at.slice(0, 10)) : <span className="muted">No expiry</span>}</td>
                        <td className="r" style={{ whiteSpace: 'nowrap' }}>
                          {r.status === 'ACTIVE' && (
                            <>
                              <button className="btn btn-sm" onClick={() => setReservation(r, 'FULFILLED')}><Icon.check /> Fulfil</button>{' '}
                              <button className="btn btn-ghost btn-sm" onClick={() => setReservation(r, 'RELEASED')}>Release</button>
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

      {/* ── Memos ── */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-head">
          <span className="card-title">Memo Stock (Approval / Supplier)</span>
          <span className="spacer" />
          <button className="btn btn-primary btn-sm" onClick={() => setMemoNew({ tag: null, counterparty: '', custodian: memoDir === 'OUT' ? 'customer' : 'shop', due_date: '' })}>
            <Icon.plus /> New {memoDir === 'OUT' ? 'Approval' : 'Supplier'} Memo
          </button>
        </div>
        <div className="card-body">
          <div className="toolbar" style={{ marginBottom: 12, gap: 12, flexWrap: 'wrap' }}>
            <Segmented value={memoDir} onChange={v => { setMemoDir(v as 'IN' | 'OUT'); setMemoPage(1) }}
              options={[{ value: 'OUT', label: 'Out on approval' }, { value: 'IN', label: 'In from supplier' }]} />
            <Segmented value={memoStatus} onChange={v => { setMemoStatus(v); setMemoPage(1) }}
              options={[{ value: 'ISSUED', label: 'Open' }, { value: 'RETURNED', label: 'Returned' },
                memoDir === 'OUT' ? { value: 'SOLD', label: 'Sold' } : { value: 'ACQUIRED', label: 'Acquired' },
                { value: 'ALL', label: 'All' }]} />
            <div className="search-box" style={{ maxWidth: 260 }}>
              <Icon.search />
              <input className="input" placeholder="Search party, tag, item…" value={memoSearch}
                onChange={e => { setMemoSearch(e.target.value); setMemoPage(1) }} />
            </div>
          </div>
          {memos.error && <div className="danger small" role="alert" style={{ marginBottom: 8 }}>{memos.error} <button className="btn btn-sm" onClick={memos.reload}>Retry</button></div>}
          {!memos.loading && !memoRows.length ? (
            <Empty icon={Icon.tag} title="No memos" />
          ) : (
            <>
              <div className="table-wrap">
                <table className="data">
                  <thead>
                    <tr><th>No</th><th>Date</th>{memoDir === 'OUT' && <><th>Tag</th><th>Item</th></>}
                      <th>{memoDir === 'OUT' ? 'With' : 'Supplier'}</th><th>Custodian</th><th>Status</th><th>Due</th><th></th></tr>
                  </thead>
                  <tbody>
                    {memoRows.map((m: any) => (
                      <tr key={m.id}>
                        <td className="mono">#{m.id}</td>
                        <td>{dmy(m.created_at?.slice(0, 10))}</td>
                        {memoDir === 'OUT' && <><td className="mono strong">{m.tag}</td><td>{m.item_name}</td></>}
                        <td>{m.counterparty}</td>
                        <td>{m.custodian}</td>
                        <td><span className={`badge ${MEMO_BADGE[m.status] || 'badge-mute'}`}>{m.status === 'ISSUED' ? 'OPEN' : m.status}</span></td>
                        <td>{m.due_date ? <span className={m.overdue ? 'danger strong' : ''}>{dmy(m.due_date)}{m.overdue ? ' · overdue' : ''}</span> : <span className="muted">—</span>}</td>
                        <td className="r" style={{ whiteSpace: 'nowrap' }}>
                          {m.status === 'ISSUED' && (m.direction === 'OUT' ? (
                            <>
                              <button className="btn btn-sm" onClick={() => closeMemo(m, 'RETURNED')}>Returned</button>{' '}
                              <button className="btn btn-sm" onClick={() => closeMemo(m, 'SOLD')}><Icon.invoice /> Sold</button>
                            </>
                          ) : (
                            <>
                              <button className="btn btn-sm" onClick={() => closeMemo(m, 'RETURNED')}>Returned</button>{' '}
                              <button className="btn btn-sm" onClick={() => closeMemo(m, 'ACQUIRED')}><Icon.cart /> Acquired</button>
                            </>
                          ))}
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

      {resNew && (
        <Modal title="Reserve a Piece" onClose={() => setResNew(null)}
          footer={<><span className="spacer" /><button className="btn" onClick={() => setResNew(null)}>Cancel</button>
            <button className="btn btn-primary" disabled={!resNew.tag || !(resNew.customer || resNew.name.trim())} onClick={createReservation}><Icon.save /> Reserve</button></>}>
          <div className="form-grid cols-2">
            <Field label="Tag" required className="span-2">
              <TagPicker value={resNew.tag} onPick={tag => setResNew({ ...resNew, tag })} />
            </Field>
            <Field label="Customer" required hint="Pick a saved customer, or type a walk-in name">
              {resNew.customer ? (
                <div className="row" style={{ gap: 8 }}>
                  <span className="strong">{resNew.customer.name}</span>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => setResNew({ ...resNew, customer: null })}>Change</button>
                </div>
              ) : (
                <Autocomplete<Party> value={resNew.name} onText={name => setResNew({ ...resNew, name })}
                  placeholder="Customer name or mobile…" fetch={fetchCustomers}
                  onPick={customer => setResNew({ ...resNew, customer, name: '' })}
                  render={p => <>{p.name} <span className="muted">{p.mobile}</span></>} />
              )}
            </Field>
            <Field label="Hold until" hint="Leave blank to hold until released">
              <Input type="date" min={todayISO()} value={resNew.expires_at} onChange={e => setResNew({ ...resNew, expires_at: e.target.value })} />
            </Field>
          </div>
        </Modal>
      )}

      {memoNew && (
        <Modal title={memoDir === 'OUT' ? 'Send a Piece on Approval' : 'Supplier Goods on Memo'} onClose={() => setMemoNew(null)}
          footer={<><span className="spacer" /><button className="btn" onClick={() => setMemoNew(null)}>Cancel</button>
            <button className="btn btn-primary" disabled={(memoDir === 'OUT' && !memoNew.tag) || !memoNew.counterparty.trim()} onClick={issueMemo}><Icon.save /> Issue</button></>}>
          <div className="form-grid cols-2">
            {memoDir === 'OUT' && (
              <Field label="Tag" required className="span-2">
                <TagPicker value={memoNew.tag} onPick={tag => setMemoNew({ ...memoNew, tag })} />
              </Field>
            )}
            <Field label={memoDir === 'OUT' ? 'Taken by' : 'Supplier'} required>
              <Input value={memoNew.counterparty} onChange={e => setMemoNew({ ...memoNew, counterparty: e.target.value })} />
            </Field>
            <Field label="Custodian" hint={memoDir === 'OUT' ? 'Who holds the piece' : 'Who in the shop holds the goods'}>
              <Input value={memoNew.custodian} onChange={e => setMemoNew({ ...memoNew, custodian: e.target.value })} />
            </Field>
            <Field label="Due back">
              <Input type="date" min={todayISO()} value={memoNew.due_date} onChange={e => setMemoNew({ ...memoNew, due_date: e.target.value })} />
            </Field>
          </div>
        </Modal>
      )}

      {ask && (
        <Confirm title={ask.title} message={ask.message} confirmLabel={ask.label} danger={ask.danger}
          onCancel={() => setAsk(null)} onConfirm={() => { const go = ask.go; setAsk(null); go() }} />
      )}
    </div>
  )
}
