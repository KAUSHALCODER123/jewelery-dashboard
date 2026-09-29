import React, { useEffect, useMemo, useState } from 'react'
import { Icon } from '../lib/icons'
import {
  Autocomplete, Confirm, Empty, Field, Input, Loading, Segmented, Select,
  useAction, useAsync,
} from '../lib/ui'
import JobWork from './JobWork'
import { num, orderTotals } from '../lib/calc'
import { dmy, money, monthStartISO, todayISO, wt } from '../lib/format'

const STATUSES = [
  { value: 'BOOKED', label: 'Booked', cls: 'badge-info' },
  { value: 'ISSUED', label: 'Issued to Karagir', cls: 'badge-warn' },
  { value: 'RECEIVED', label: 'Received', cls: 'badge-gold' },
  { value: 'DELIVERED', label: 'Delivered', cls: 'badge-ok' },
  { value: 'CANCELLED', label: 'Cancelled', cls: 'badge-mute' },
]
const statusMeta = (s: string) => STATUSES.find((x) => x.value === s) ?? STATUSES[0]

const blankLine = () => ({
  tag: '', item_id: null as number | null, item_name: '',
  qty: '', gross_wt: '', black_beads: '', stone_wt: '', net_wt: '',
  purity: '', mkg_per_gm: '', hallmark_charges: '', rate_per_gm: '',
})

const blankHead = () => ({
  id: null as number | null,
  prefix: 'NO', order_no: '', order_date: todayISO(), delivery_date: '', karagir_date: '',
  party_id: null as number | null, party_name: '',
  karagir_id: null as number | null, remark: '',
  status: 'BOOKED', discount: 0, advance_amount: 0,
})

const blankUrd = () => ({
  item_name: 'Old Gold', gross_wt: '', net_wt: '', purity: '', rate: '',
})

export default function Orders({ go }: { go: (n: string, p?: any) => void }) {
  const [mode, setMode] = useState<'list' | 'edit'>('list')
  const [editId, setEditId] = useState<number | null>(null)
  const [tab, setTab] = useState<'orders' | 'jobwork'>('orders')

  if (mode === 'edit') {
    return <OrderForm id={editId} go={go} onDone={() => { setMode('list'); setEditId(null) }} />
  }
  return (
    <div>
      <div className="toolbar" style={{ paddingBottom: 0, border: 0 }}>
        <Segmented value={tab} onChange={(v) => setTab(v as any)}
          options={[
            { value: 'orders', label: 'Orders' },
            { value: 'jobwork', label: 'Karagir Job Work' },
          ]} />
      </div>
      {tab === 'orders' ? (
        <OrderList onNew={() => { setEditId(null); setMode('edit') }}
          onOpen={(id) => { setEditId(id); setMode('edit') }} />
      ) : <JobWork />}
    </div>
  )
}

function OrderList({ onNew, onOpen }: { onNew: () => void; onOpen: (id: number) => void }) {
  const [from, setFrom] = useState(monthStartISO())
  const [to, setTo] = useState(todayISO())
  const [status, setStatus] = useState('ALL')
  const list = useAsync(() => window.api.order.list({ from, to, status }), [from, to, status])
  const rows = list.data || []
  const pending = rows.reduce((s: number, r: any) => s + num(r.balance_amount), 0)

  return (
    <div>
      <div className="toolbar">
        <Select value={status} onChange={setStatus}
          options={[{ value: 'ALL', label: 'All statuses' },
            ...STATUSES.map((s) => ({ value: s.value, label: s.label }))]} />
        <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} style={{ width: 150 }} />
        <span className="muted">to</span>
        <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} style={{ width: 150 }} />
        <span className="spacer" />
        <button className="btn btn-primary" onClick={onNew}><Icon.plus /> New Order</button>
      </div>

      <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(3, minmax(0,1fr))' }}>
        <div className="stat"><div className="stat-label">Orders</div><div className="stat-value num">{rows.length}</div></div>
        <div className="stat"><div className="stat-label">Order Value</div>
          <div className="stat-value num">₹{money(rows.reduce((s: number, r: any) => s + num(r.total_amount), 0))}</div></div>
        <div className="stat"><div className="stat-label">Pending Balance</div>
          <div className="stat-value num" style={{ color: pending > 0 ? 'var(--danger)' : undefined }}>₹{money(pending)}</div></div>
      </div>

      <div className="card">
        <div className="card-body flush">
          {list.loading ? <Loading /> : !rows.length ? (
            <Empty icon={Icon.order} title="No orders in this period"
              action={<button className="btn btn-primary btn-sm" onClick={onNew}>Book an order</button>}>
              Take a customer order, issue it to a karagir, then convert it to a bill on delivery.
            </Empty>
          ) : (
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr><th>Order No</th><th>Date</th><th>Delivery</th><th>Customer</th><th>Karagir</th>
                    <th>Status</th><th className="r">Total</th><th className="r">Advance</th><th className="r">Balance</th></tr>
                </thead>
                <tbody>
                  {rows.map((r: any) => {
                    const m = statusMeta(r.status)
                    const overdue = r.delivery_date && r.delivery_date < todayISO() &&
                      !['DELIVERED', 'CANCELLED'].includes(r.status)
                    return (
                      <tr key={r.id} className="clickable" onClick={() => onOpen(r.id)}>
                        <td className="mono strong">{r.order_no}</td>
                        <td>{dmy(r.order_date)}</td>
                        <td>{r.delivery_date
                          ? <span className={overdue ? 'danger strong' : ''}>{dmy(r.delivery_date)}</span>
                          : <span className="muted">—</span>}</td>
                        <td>{r.party_name || '—'}</td>
                        <td>{r.karagir_name || <span className="muted">Unassigned</span>}</td>
                        <td><span className={`badge ${m.cls}`}>{m.label}</span></td>
                        <td className="r num strong">₹{money(r.total_amount)}</td>
                        <td className="r num">{money(r.advance_amount)}</td>
                        <td className="r num">{num(r.balance_amount) > 0
                          ? <span className="danger">{money(r.balance_amount)}</span>
                          : <span className="ok">Settled</span>}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function OrderForm({ id, go, onDone }: {
  id: number | null; go: (n: string, p?: any) => void; onDone: () => void
}) {
  const run = useAction()
  const [head, setHead] = useState<any>(blankHead())
  const [lines, setLines] = useState<any[]>([blankLine()])
  const [urds, setUrds] = useState<any[]>([blankUrd()])
  const [custQuery, setCustQuery] = useState('')
  const [karagirQuery, setKaragirQuery] = useState('')
  const [busy, setBusy] = useState(false)
  const [confirmDel, setConfirmDel] = useState(false)

  useEffect(() => {
    let alive = true
    if (id) {
      window.api.order.read({ id }).then(async (o: any) => {
        if (!alive || !o) return
        setHead({ ...blankHead(), ...o })
        setLines(o.items?.length ? o.items : [blankLine()])
        setUrds(o.urds?.length ? o.urds : [blankUrd()])
        setCustQuery(o.party_name || '')
        if (o.karagir_id) {
          const k = await window.api.party.read({ id: o.karagir_id })
          if (alive && k) setKaragirQuery(k.name)
        }
      })
    } else {
      window.api.series.peek({ docType: 'ORDER', prefix: 'NO' })
        .then((n) => alive && setHead((h: any) => ({ ...h, order_no: n })))
    }
    return () => { alive = false }
  }, [id])

  const computed = useMemo(() => orderTotals(head, lines, urds), [head, lines, urds])
  const t = computed.totals

  const setLine = (i: number, patch: any) => {
    setLines((rs) => {
      const next = rs.map((r, ix) => (ix === i ? { ...r, ...patch } : r))
      const last = next[next.length - 1]
      if (last && (last.item_name || num(last.gross_wt) > 0)) next.push(blankLine())
      return next
    })
  }

  const setUrd = (i: number, patch: any) => {
    setUrds((rs) => {
      const next = rs.map((r, ix) => (ix === i ? { ...r, ...patch } : r))
      const last = next[next.length - 1]
      if (last && num(last.gross_wt) > 0) next.push(blankUrd())
      return next
    })
  }

  const save = async () => {
    setBusy(true)
    const res = await run(async () => {
      const filled = lines.filter((r) => r.item_name && num(r.gross_wt) > 0)
      if (!filled.length) throw new Error('Add at least one item to the order')
      if (!head.party_id) throw new Error('Select a customer')
      const filledUrds = urds.filter((r) => num(r.gross_wt) > 0)
      return window.api.order.save({ head, items: filled, urds: filledUrds })
    }, 'Order saved')
    setBusy(false)
    if (res) onDone()
  }

  const advance = async (status: string) => {
    await run(() => window.api.order.setStatus({ id: head.id, status }), 'Status updated')
    setHead({ ...head, status })
  }

  const convert = async () => {
    const res = await run(() => window.api.order.toInvoice({ id: head.id }), 'Invoice created')
    if (res) go('sales.new', { id: res.id })
  }

  const remove = async () => {
    setConfirmDel(false)
    const ok = await run(() => window.api.order.remove({ id: head.id }), 'Order deleted')
    if (ok !== undefined) onDone()
  }

  const m = statusMeta(head.status)

  return (
    <div>
      <div className="toolbar">
        <button className="btn btn-ghost" onClick={onDone}><Icon.back /> Back</button>
        <span className="page-title">{head.id ? `Order ${head.order_no}` : 'New Order'}</span>
        {head.id && <span className={`badge ${m.cls}`}>{m.label}</span>}
      </div>

      <div className="card" style={{ marginBottom: 14 }}>
        <div className="card-body">
          <div className="form-grid cols-4">
            <Field label="Customer" required className="span-2">
              <Autocomplete value={custQuery} placeholder="Search customer…"
                onText={(s) => { setCustQuery(s); setHead({ ...head, party_name: s, party_id: null }) }}
                onPick={(p: any) => { setCustQuery(p.name); setHead({ ...head, party_id: p.id, party_name: p.name }) }}
                fetch={(q) => window.api.party.list({ type: 'CUSTOMER', search: q })}
                render={(p: any) => <span><b>{p.name}</b>{p.mobile ? <span className="muted"> · {p.mobile}</span> : null}</span>} />
            </Field>
            <Field label="Karagir" hint="Who will make it">
              <Autocomplete value={karagirQuery} placeholder="Assign later…"
                onText={(s) => { setKaragirQuery(s); setHead({ ...head, karagir_id: null }) }}
                onPick={(p: any) => { setKaragirQuery(p.name); setHead({ ...head, karagir_id: p.id }) }}
                fetch={(q) => window.api.party.list({ type: 'ALL', search: q })}
                render={(p: any) => <span><b>{p.name}</b><span className="muted"> · {p.party_type}</span></span>} />
            </Field>
            <Field label="Order No"><Input readOnly className="mono" value={head.order_no} /></Field>
            <Field label="Order Date">
              <Input type="date" value={head.order_date}
                onChange={(e) => setHead({ ...head, order_date: e.target.value })} />
            </Field>
            <Field label="Delivery Date" hint="Promised to the customer">
              <Input type="date" value={head.delivery_date || ''}
                onChange={(e) => setHead({ ...head, delivery_date: e.target.value })} />
            </Field>
            <Field label="Karagir Date" hint="Deadline for the karagir">
              <Input type="date" value={head.karagir_date || ''}
                onChange={(e) => setHead({ ...head, karagir_date: e.target.value })} />
            </Field>
            <Field label="Remark" className="span-2">
              <Input value={head.remark} onChange={(e) => setHead({ ...head, remark: e.target.value })} />
            </Field>
          </div>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 14 }}>
        <div className="card-head">
          <span className="card-title">Order Items</span>
          <span className="hint" style={{ marginLeft: 'auto' }}>
            Estimated weights and rates — adjust on receipt from the karagir
          </span>
        </div>
        <div className="card-body flush">
          <div className="table-wrap" style={{ maxHeight: 320 }}>
            <table className="grid-edit">
              <thead>
                <tr>
                  <th style={{ width: 28 }}></th>
                  <th style={{ minWidth: 170 }}>Item</th>
                  <th style={{ width: 54, textAlign: 'right' }}>Qty</th>
                  <th style={{ width: 80, textAlign: 'right' }}>Gross Wt</th>
                  <th style={{ width: 74, textAlign: 'right' }}>Stone Wt</th>
                  <th style={{ width: 80, textAlign: 'right' }}>Net Wt</th>
                  <th style={{ width: 66, textAlign: 'right' }}>Purity</th>
                  <th style={{ width: 80, textAlign: 'right' }}>Fine Wt</th>
                  <th style={{ width: 80, textAlign: 'right' }}>Rate/Gm</th>
                  <th style={{ width: 74, textAlign: 'right' }}>Mkg/Gm</th>
                  <th style={{ width: 86, textAlign: 'right' }}>Mkg Amt</th>
                  <th style={{ width: 100, textAlign: 'right' }}>Amount</th>
                </tr>
              </thead>
              <tbody>
                {computed.items.map((r: any, i: number) => (
                  <tr key={i}>
                    <td className="cell-del"
                      onClick={() => setLines((rs) => (rs.length > 1 ? rs.filter((_, ix) => ix !== i) : [blankLine()]))}>
                      <Icon.close width={13} height={13} />
                    </td>
                    <td><input value={r.item_name} placeholder="Item name…"
                      onChange={(e) => setLine(i, { item_name: e.target.value })} /></td>
                    <N v={r.qty} on={(v) => setLine(i, { qty: v })} />
                    <N v={r.gross_wt} on={(v) => setLine(i, { gross_wt: v, net_wt: '' })} />
                    <N v={r.stone_wt} on={(v) => setLine(i, { stone_wt: v, net_wt: '' })} />
                    <N v={r.net_wt} on={(v) => setLine(i, { net_wt: v })} />
                    <N v={r.purity} on={(v) => setLine(i, { purity: v })} />
                    <td><input className="right" readOnly value={r.fine_wt ? wt(r.fine_wt) : ''} /></td>
                    <N v={r.rate_per_gm} on={(v) => setLine(i, { rate_per_gm: v })} />
                    <N v={r.mkg_per_gm} on={(v) => setLine(i, { mkg_per_gm: v })} />
                    <td><input className="right" readOnly value={r.mkg_amount ? money(r.mkg_amount) : ''} /></td>
                    <td><input className="right" readOnly style={{ fontWeight: 600 }}
                      value={r.item_total ? money(r.item_total) : ''} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 14 }}>
        <div className="card-head">
          <span className="card-title">Old Gold at Booking</span>
          <span className="hint" style={{ marginLeft: 'auto' }}>
            Metal the customer hands in now — reduces the balance and posts to their gold khata
          </span>
        </div>
        <div className="card-body flush">
          <div className="table-wrap">
            <table className="grid-edit">
              <thead>
                <tr>
                  <th style={{ width: 28 }}></th>
                  <th style={{ minWidth: 170 }}>Description</th>
                  <th style={{ width: 90, textAlign: 'right' }}>Gross Wt</th>
                  <th style={{ width: 90, textAlign: 'right' }}>Net Wt</th>
                  <th style={{ width: 74, textAlign: 'right' }}>Purity</th>
                  <th style={{ width: 90, textAlign: 'right' }}>Fine Wt</th>
                  <th style={{ width: 90, textAlign: 'right' }}>Rate/Gm</th>
                  <th style={{ width: 110, textAlign: 'right' }}>Amount</th>
                </tr>
              </thead>
              <tbody>
                {computed.urds.map((r: any, i: number) => (
                  <tr key={i}>
                    <td className="cell-del"
                      onClick={() => setUrds((rs) => (rs.length > 1 ? rs.filter((_, ix) => ix !== i) : [blankUrd()]))}>
                      <Icon.close width={13} height={13} />
                    </td>
                    <td><input value={r.item_name} placeholder="Old Gold"
                      onChange={(e) => setUrd(i, { item_name: e.target.value })} /></td>
                    <N v={r.gross_wt} on={(v) => setUrd(i, { gross_wt: v, net_wt: v })} />
                    <N v={r.net_wt} on={(v) => setUrd(i, { net_wt: v })} />
                    <N v={r.purity} on={(v) => setUrd(i, { purity: v })} />
                    <td><input className="right" readOnly value={r.final_wt ? wt(r.final_wt) : ''} /></td>
                    <N v={r.rate} on={(v) => setUrd(i, { rate: v })} />
                    <td><input className="right" readOnly style={{ fontWeight: 600 }}
                      value={r.amount ? money(r.amount) : ''} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 360px', gap: 14, alignItems: 'start' }}>
        <div className="card">
          <div className="card-head"><span className="card-title">Advance &amp; Progress</span></div>
          <div className="card-body">
            <div className="form-grid cols-2" style={{ marginBottom: 14 }}>
              <Field label="Advance Received (₹)" hint="Posted to the customer's account">
                <Input className="right" inputMode="decimal" value={head.advance_amount || ''}
                  onChange={(e) => setHead({ ...head, advance_amount: e.target.value })} />
              </Field>
              <Field label="Discount (₹)">
                <Input className="right" inputMode="decimal" value={head.discount || ''}
                  onChange={(e) => setHead({ ...head, discount: e.target.value })} />
              </Field>
            </div>

            {head.id && (
              <>
                <div className="section-title">Move this order along</div>
                <div className="row wrap" style={{ gap: 8 }}>
                  {head.status === 'BOOKED' && (
                    <button className="btn" onClick={() => advance('ISSUED')}>Issue to Karagir</button>
                  )}
                  {head.status === 'ISSUED' && (
                    <button className="btn" onClick={() => advance('RECEIVED')}>Mark Received</button>
                  )}
                  {head.status === 'RECEIVED' && (
                    <button className="btn btn-primary" onClick={convert}>
                      <Icon.invoice /> Convert to Sales Bill
                    </button>
                  )}
                  {head.status === 'DELIVERED' && (
                    <span className="small muted">This order has been invoiced.</span>
                  )}
                  {!['DELIVERED', 'CANCELLED'].includes(head.status) && (
                    <button className="btn btn-danger" onClick={() => advance('CANCELLED')}>Cancel Order</button>
                  )}
                </div>
              </>
            )}
          </div>
        </div>

        <div className="card">
          <div className="card-head"><span className="card-title">Order Summary</span></div>
          <div className="card-body">
            <div className="totals">
              <div className="total-row"><span className="k">Goods Amount</span><span className="v num">{money(t.goods_amount)}</span></div>
              <div className="total-row"><span className="k">Making Amount</span><span className="v num">{money(t.making_amount)}</span></div>
              {t.hallmark_amount > 0 && <div className="total-row"><span className="k">Hallmark</span><span className="v num">{money(t.hallmark_amount)}</span></div>}
              {t.discount > 0 && <div className="total-row"><span className="k">Discount</span><span className="v num">− {money(t.discount)}</span></div>}
              <div className="total-row grand"><span className="k">Total</span><span className="v num">₹{money(t.total_amount)}</span></div>
              {t.urd_amount > 0 && <div className="total-row credit"><span className="k">Old Gold</span><span className="v num">− {money(t.urd_amount)}</span></div>}
              {t.advance_amount > 0 && <div className="total-row credit"><span className="k">Advance</span><span className="v num">− {money(t.advance_amount)}</span></div>}
              <div className="total-row grand debit"><span className="k">Balance</span><span className="v num">₹{money(t.balance_amount)}</span></div>
            </div>
            <div className="divider" />
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <span className="small muted">Estimated fine weight</span>
              <span className="small strong num gold">{wt(t.total_fine_wt)} g</span>
            </div>
          </div>
        </div>
      </div>

      <div className="sticky-actions">
        <span className="spacer" />
        {head.id && <button className="btn btn-danger" onClick={() => setConfirmDel(true)}><Icon.trash /> Delete</button>}
        <button className="btn" onClick={onDone}>Cancel</button>
        <button className="btn btn-primary" onClick={save} disabled={busy}>
          {busy ? <span className="spinner" /> : <Icon.save />} Save Order
        </button>
      </div>

      {confirmDel && (
        <Confirm title="Delete this order?" message="The advance posting will be reversed."
          onConfirm={remove} onCancel={() => setConfirmDel(false)} />
      )}
    </div>
  )
}

function N({ v, on }: { v: any; on: (v: string) => void }) {
  return (
    <td>
      <input className="right" inputMode="decimal" value={v ?? ''}
        onChange={(e) => { const t = e.target.value; if (t === '' || /^\d*\.?\d*$/.test(t)) on(t) }}
        onFocus={(e) => e.target.select()} />
    </td>
  )
}
