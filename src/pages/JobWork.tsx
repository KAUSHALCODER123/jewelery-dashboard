import React, { useState } from 'react'
import { Icon } from '../lib/icons'
import {
  Autocomplete, Empty, Field, Input, Loading, Modal, Select, useAction, useAsync,
} from '../lib/ui'

const METALS = ['Gold', 'Silver', 'Platinum']
import { dmy, money, todayISO, wt } from '../lib/format'
import { num } from '../lib/calc'

/**
 * Karagir job work — docs/VIDEO-SPEC-2.md §10.
 *
 * What went out to the goldsmith, what came back, and what he still holds:
 *
 *     still with karagir = issued − received − wastage allowed
 *
 * That last figure is the whole point of the screen. It is the only number that
 * says a goldsmith is holding metal he has not accounted for, and in this trade
 * that reconciliation is the loss-prevention control.
 */
export default function JobWork() {
  const [karagir, setKaragir] = useState<any>(null)
  const [query, setQuery] = useState('')
  const [form, setForm] = useState<null | 'ISSUE' | 'RECEIVE'>(null)
  const run = useAction()

  // Must stay `async` — useAsync calls .then() on whatever comes back, so
  // returning a bare null when nothing is selected would blow up.
  const led = useAsync(
    async () => (karagir ? await window.api.karagir.ledger({ karagirId: karagir.id }) : null),
    [karagir]
  )
  const track = useAsync(() => window.api.reports.orderTracking({}), [])
  const d = led.data
  const t = d?.totals

  const del = async (kind: 'ISSUE' | 'RECEIVE', id: number) => {
    await run(() => (kind === 'ISSUE'
      ? window.api.karagir.removeIssue({ id })
      : window.api.karagir.removeReceive({ id })), 'Deleted')
    led.reload()
    track.reload()
  }

  const gram = <span style={{ fontSize: 13, color: 'var(--text-3)' }}> g</span>

  return (
    <div>
      <div className="toolbar">
        <div style={{ width: 320 }}>
          <Autocomplete value={query} placeholder="Search a karagir…"
            onText={(s) => { setQuery(s); setKaragir(null) }}
            onPick={(p: any) => { setQuery(p.name); setKaragir(p) }}
            fetch={(q) => window.api.party.list({ type: 'KARAGIR', search: q })}
            render={(p: any) => (
              <span><b>{p.name}</b><span className="muted"> · {p.mobile || p.area || ''}</span></span>
            )} />
        </div>
        <span className="spacer" />
        <button className="btn" disabled={!karagir} onClick={() => setForm('ISSUE')}>
          <Icon.upload /> Issue Material
        </button>
        <button className="btn btn-primary" disabled={!karagir} onClick={() => setForm('RECEIVE')}>
          <Icon.download /> Receive Order
        </button>
      </div>

      {karagir && t && (
        <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(5, minmax(0,1fr))' }}>
          <div className="stat">
            <div className="stat-label">Metal Issued</div>
            <div className="stat-value num">{wt(t.issued)}{gram}</div>
          </div>
          <div className="stat">
            <div className="stat-label">Received Back</div>
            <div className="stat-value num">{wt(t.received)}{gram}</div>
          </div>
          <div className="stat">
            <div className="stat-label">Wastage Allowed</div>
            <div className="stat-value num">{wt(t.wastage)}{gram}</div>
          </div>
          <div className="stat">
            <div className="stat-label">Still With Karagir</div>
            <div className="stat-value num"
              style={{ color: t.outstanding > 0.0005 ? 'var(--danger)' : undefined }}>
              {wt(t.outstanding)}{gram}
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 2 }}>
              issued − received − wastage
            </div>
          </div>
          <div className="stat">
            <div className="stat-label">Labour Pending</div>
            <div className="stat-value num">₹{money(t.pending)}</div>
          </div>
        </div>
      )}

      {!karagir ? (
        <div className="card"><div className="card-body">
          <Empty icon={Icon.users} title="Select a karagir">
            Pick a goldsmith to see what metal he is holding, what has come back, and what
            he is still to account for.
          </Empty>
        </div></div>
      ) : led.loading ? <Loading rows={5} /> : (
        <>
          <div className="card" style={{ marginBottom: 14 }}>
            <div className="card-head"><span className="card-title">Material Issued</span></div>
            <div className="card-body flush">
              {!d?.issues?.length ? <Empty icon={Icon.upload} title="Nothing issued yet" /> : (
                <div className="table-wrap">
                  <table className="data">
                    <thead>
                      <tr><th>Doc</th><th>Date</th><th>Item</th><th>Sub-order</th>
                        <th className="r">Gross</th><th className="r">Net</th>
                        <th className="r">Purity</th><th className="r">Fine Wt</th><th></th></tr>
                    </thead>
                    <tbody>
                      {d.issues.map((r: any) => (
                        <tr key={r.id}>
                          <td className="mono strong">{r.issue_no}</td>
                          <td>{dmy(r.issue_date)}</td>
                          <td>{r.item_name || '—'}</td>
                          <td className="mono small">{r.sub_order_no || '—'}</td>
                          <td className="r num">{wt(r.gross_wt)}</td>
                          <td className="r num">{wt(r.net_wt)}</td>
                          <td className="r num">{money(r.purity)}%</td>
                          <td className="r num strong">{wt(r.fine_wt)}</td>
                          <td className="r">
                            <button className="btn btn-ghost btn-icon btn-sm" aria-label="Delete"
                              onClick={() => del('ISSUE', r.id)}><Icon.trash /></button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>

          <div className="card" style={{ marginBottom: 14 }}>
            <div className="card-head"><span className="card-title">Orders Received</span></div>
            <div className="card-body flush">
              {!d?.receipts?.length ? <Empty icon={Icon.download} title="Nothing received yet" /> : (
                <div className="table-wrap">
                  <table className="data">
                    <thead>
                      <tr><th>Doc</th><th>Date</th><th>Item</th>
                        <th className="r">Fine Wt</th><th className="r">Wastage</th>
                        <th className="r">Labour</th><th className="r">TDS</th>
                        <th className="r">Paid</th><th className="r">Pending</th><th></th></tr>
                    </thead>
                    <tbody>
                      {d.receipts.map((r: any) => (
                        <tr key={r.id}>
                          <td className="mono strong">{r.receive_no}</td>
                          <td>{dmy(r.receive_date)}</td>
                          <td>{r.item_name || '—'}</td>
                          <td className="r num strong">{wt(r.fine_wt)}</td>
                          <td className="r num">{wt(r.wastage_wt)}</td>
                          <td className="r num">₹{money(r.labour_amount)}</td>
                          <td className="r num">₹{money(r.tds_amount)}</td>
                          <td className="r num">₹{money(r.paid_amount)}</td>
                          <td className="r num"
                            style={{ color: r.pending_amount > 0 ? 'var(--danger)' : undefined }}>
                            ₹{money(r.pending_amount)}
                          </td>
                          <td className="r">
                            <button className="btn btn-ghost btn-icon btn-sm" aria-label="Delete"
                              onClick={() => del('RECEIVE', r.id)}><Icon.trash /></button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </>
      )}

      <div className="card">
        <div className="card-head"><span className="card-title">Order Tracking</span></div>
        <div className="card-body flush">
          {!track.data?.length ? <Empty icon={Icon.order} title="No orders to track" /> : (
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr><th>Order</th><th>Customer</th><th>Karagir</th>
                    <th>Karagir Date</th><th>Delivery</th>
                    <th className="r">Days Left</th><th>Status</th>
                    <th className="r">Issued</th><th className="r">Received</th>
                    <th className="r">Outstanding</th></tr>
                </thead>
                <tbody>
                  {track.data.map((o: any) => (
                    <tr key={o.id} className={o.overdue ? 'row-bad' : ''}>
                      <td className="mono strong">{o.order_no}</td>
                      <td>{o.customer_name || o.party_name || '—'}</td>
                      <td>{o.karagir_name || '—'}</td>
                      <td style={{ color: o.karagir_overdue ? 'var(--danger)' : undefined }}>
                        {o.karagir_date ? dmy(o.karagir_date) : '—'}
                        {o.karagir_overdue && <span className="small"> ⚠</span>}
                      </td>
                      <td>{o.delivery_date ? dmy(o.delivery_date) : '—'}</td>
                      <td className="r num" style={{ color: o.overdue ? 'var(--danger)' : undefined }}>
                        {o.remaining_days == null ? '—'
                          : o.overdue ? `${Math.abs(o.remaining_days)} late` : o.remaining_days}
                      </td>
                      <td><span className="badge badge-mute">{o.status}</span></td>
                      <td className="r num">{wt(o.fine_issued)}</td>
                      <td className="r num">{wt(o.fine_received)}</td>
                      <td className="r num"
                        style={{ color: o.metal_outstanding > 0.0005 ? 'var(--danger)' : undefined }}>
                        {wt(o.metal_outstanding)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {form && karagir && (
        <JobWorkModal kind={form} karagir={karagir} onClose={() => setForm(null)}
          onSaved={() => { setForm(null); led.reload(); track.reload() }} />
      )}
    </div>
  )
}

function JobWorkModal({ kind, karagir, onClose, onSaved }: {
  kind: 'ISSUE' | 'RECEIVE'; karagir: any; onClose: () => void; onSaved: () => void
}) {
  const isIssue = kind === 'ISSUE'
  const [f, setF] = useState<any>({
    issue_date: todayISO(), receive_date: todayISO(),
    karagir_id: karagir.id, karagir_name: karagir.name,
    order_id: null, sub_order_no: '', item_name: '', metal: 'Gold',
    gross_wt: '', less_wt: '', stone_wt: '', diamond_wt: '', net_wt: '', purity: 91.6,
    wastage_pct: '', rate_per_gm: '', discount: '', tds_pct: '', paid_amount: '', remark: '',
  })
  const run = useAction()

  const net = num(f.net_wt) || Math.max(
    0, num(f.gross_wt) - num(f.less_wt) - num(f.stone_wt) - num(f.diamond_wt)
  )
  const fine = net * (num(f.purity) / 100)
  const wastage = isIssue ? 0 : fine * (num(f.wastage_pct) / 100)
  const labour = net * num(f.rate_per_gm)
  const taxable = labour - num(f.discount)
  const tds = taxable * (num(f.tds_pct) / 100)
  const payable = taxable - tds

  const save = async () => {
    if (!net) return run(async () => { throw new Error('Enter the weight') })
    const ok = await run(
      () => (isIssue ? window.api.karagir.issue(f) : window.api.karagir.receive(f)),
      isIssue ? 'Material issued' : 'Order received'
    )
    if (ok !== undefined) onSaved()
  }

  return (
    <Modal wide onClose={onClose}
      title={isIssue ? `Issue Material to ${karagir.name}` : `Receive Order from ${karagir.name}`}
      footer={<><span className="spacer" />
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" onClick={save}><Icon.save /> Save</button></>}>
      <p className="small muted" style={{ marginBottom: 12 }}>
        {isIssue
          ? 'The metal leaves the shop and goes onto this karagir’s account until he returns finished pieces.'
          : 'What comes back, plus the wastage you allow, is taken off his account. Anything left is metal he still owes you.'}
      </p>
      <div className="form-grid cols-3">
        <Field label="Date">
          <Input type="date" value={isIssue ? f.issue_date : f.receive_date}
            onChange={(e) => setF(isIssue
              ? { ...f, issue_date: e.target.value }
              : { ...f, receive_date: e.target.value })} />
        </Field>
        <Field label="Item">
          <Input value={f.item_name} onChange={(e) => setF({ ...f, item_name: e.target.value })} />
        </Field>
        <Field label="Metal">
          <Select value={f.metal} onChange={(v) => setF({ ...f, metal: v })}
            options={METALS.map((m) => ({ value: m, label: m }))} />
        </Field>
        <Field label="Sub-order no" hint="e.g. NO1/1 when one order is split between karagirs.">
          <Input value={f.sub_order_no}
            onChange={(e) => setF({ ...f, sub_order_no: e.target.value })} />
        </Field>

        <Field label="Gross Wt" required>
          <Input className="right" value={f.gross_wt}
            onChange={(e) => setF({ ...f, gross_wt: e.target.value, net_wt: '' })} />
        </Field>
        <Field label="Less">
          <Input className="right" value={f.less_wt}
            onChange={(e) => setF({ ...f, less_wt: e.target.value })} />
        </Field>
        <Field label="Purity %">
          <Input className="right" value={f.purity}
            onChange={(e) => setF({ ...f, purity: e.target.value })} />
        </Field>

        {!isIssue && (
          <>
            <Field label="Stone Wt">
              <Input className="right" value={f.stone_wt}
                onChange={(e) => setF({ ...f, stone_wt: e.target.value })} />
            </Field>
            <Field label="Diamond Wt">
              <Input className="right" value={f.diamond_wt}
                onChange={(e) => setF({ ...f, diamond_wt: e.target.value })} />
            </Field>
            <Field label="Wastage %" hint="Metal the karagir is allowed to lose.">
              <Input className="right" value={f.wastage_pct}
                onChange={(e) => setF({ ...f, wastage_pct: e.target.value })} />
            </Field>
            <Field label="Making rate /gm">
              <Input className="right" value={f.rate_per_gm}
                onChange={(e) => setF({ ...f, rate_per_gm: e.target.value })} />
            </Field>
            <Field label="TDS %">
              <Input className="right" value={f.tds_pct}
                onChange={(e) => setF({ ...f, tds_pct: e.target.value })} />
            </Field>
            <Field label="Paid now">
              <Input className="right" value={f.paid_amount}
                onChange={(e) => setF({ ...f, paid_amount: e.target.value })} />
            </Field>
          </>
        )}

        <Field label="Remark" className="span-3">
          <Input value={f.remark} onChange={(e) => setF({ ...f, remark: e.target.value })} />
        </Field>
      </div>

      <div className="row wrap" style={{ gap: 18, marginTop: 14, justifyContent: 'flex-end' }}>
        <span className="muted small">Net {wt(net)} g</span>
        <span className="strong">Fine {wt(fine)} g</span>
        {!isIssue && (
          <>
            <span className="muted small">Wastage {wt(wastage)} g</span>
            <span className="muted small">Labour ₹{money(labour)}</span>
            {tds > 0 && <span className="muted small">TDS ₹{money(tds)}</span>}
            <span className="strong">Payable ₹{money(payable)}</span>
          </>
        )}
      </div>
    </Modal>
  )
}
