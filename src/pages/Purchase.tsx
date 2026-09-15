import React, { useEffect, useMemo, useState } from 'react'
import { Icon } from '../lib/icons'
import {
  Autocomplete, Check, Confirm, Empty, Field, Input, Loading, Modal, Segmented, Select,
  useAction, useAsync,
} from '../lib/ui'
import { Rate10Cell } from '../lib/grid'
import { num, purchaseTotals } from '../lib/calc'
import { dmy, money, monthStartISO, todayISO, wt } from '../lib/format'

const blankLine = () => ({
  // A loose item (mani, fuli) is priced by the gram at a flat rate and carries no
  // fine weight, so the line has to say which kind it is before the totals are
  // taken — see purchaseLine in lib/calc.
  direction: 'IN', item_id: null as number | null, is_loose: 0, item_name: '',
  qty: '', gross_wt: '', black_beads: '', stone_wt: '', net_wt: '',
  purity: '', rate: '', wastage_pct: '', hallmark_charges: '', huid: '',
})

const blankHead = () => ({
  id: null as number | null,
  prefix: 'MI', invoice_no: '', manual_no: '', invoice_date: todayISO(),
  party_id: null as number | null, party_name: '', remark: '', state: 'Maharashtra',
  metal: 'Gold', is_credit: 1, gst_not_required: 0,
  gst_pct: 3, discount: 0, return_amount: 0, sub_tax: 0, tcs_pct: 0, paid_amount: 0,
  // Settled in fine metal rather than rupees — grams at a per-gram rate.
  paid_fine_wt: 0, paid_fine_rate: 0,
})

const METALS = ['Gold', 'Silver', 'Platinum']

export default function Purchase({ go }: { go?: (name: string, params?: any) => void } = {}) {
  const [mode, setMode] = useState<'list' | 'edit'>('list')
  const [editId, setEditId] = useState<number | null>(null)

  if (mode === 'edit') {
    return <PurchaseForm id={editId} go={go} onDone={() => { setMode('list'); setEditId(null) }} />
  }
  return <PurchaseList onNew={() => { setEditId(null); setMode('edit') }}
    onOpen={(id) => { setEditId(id); setMode('edit') }} />
}

function PurchaseList({ onNew, onOpen }: { onNew: () => void; onOpen: (id: number) => void }) {
  const [from, setFrom] = useState(monthStartISO())
  const [to, setTo] = useState(todayISO())
  const list = useAsync(() => window.api.purchase.list({ from, to }), [from, to])
  const rows = list.data || []
  const total = rows.reduce((s: number, r: any) => s + num(r.bill_amount), 0)
  const sumW = (k: string) => rows.reduce((s: number, r: any) => s + num(r[k]), 0)

  return (
    <div>
      <div className="toolbar">
        <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} style={{ width: 150 }} />
        <span className="muted">to</span>
        <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} style={{ width: 150 }} />
        <span className="spacer" />
        <button className="btn btn-primary" onClick={onNew}><Icon.plus /> New Purchase</button>
      </div>

      <div className="card">
        <div className="card-head">
          <span className="card-title">Purchase Register</span>
          <span className="badge badge-gold" style={{ marginLeft: 'auto' }}>₹{money(total)}</span>
        </div>
        <div className="card-body flush">
          {list.loading ? <Loading /> : !rows.length ? (
            <Empty icon={Icon.cart} title="No purchases in this period"
              action={<button className="btn btn-primary btn-sm" onClick={onNew}>Record a purchase</button>}>
              Material bought from suppliers, with wastage and fine-weight tracking.
            </Empty>
          ) : (
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr><th>Invoice</th><th>Date</th><th>Supplier</th><th>Mode</th>
                    <th className="r">Gross</th><th className="r">Net</th><th className="r">Fine</th>
                    <th>Labels</th>
                    <th className="r">Bill Amt</th><th className="r">Balance</th></tr>
                </thead>
                <tbody>
                  {rows.map((r: any) => (
                    <tr key={r.id} className="clickable" onClick={() => onOpen(r.id)}>
                      <td className="mono strong">{r.invoice_no}</td>
                      <td>{dmy(r.invoice_date)}</td>
                      <td>{r.party_name || '—'}<span className="muted small"> · {r.metal}</span></td>
                      <td><span className={`badge ${r.is_credit ? 'badge-warn' : 'badge-ok'}`}>
                        {r.is_credit ? 'Credit' : 'Cash'}</span></td>
                      <td className="r num">{wt(r.in_gross_wt)}</td>
                      <td className="r num">{wt(r.in_net_wt)}</td>
                      <td className="r num gold">{wt(r.in_fine_wt)}</td>
                      <td><TallyBadge t={r.tally} /></td>
                      <td className="r num strong">₹{money(r.bill_amount)}</td>
                      <td className="r num">{num(r.net_balance) > 0
                        ? <span className="danger">{money(r.net_balance)}</span>
                        : <span className="ok">Settled</span>}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={4} className="strong">Total</td>
                    <td className="r num strong">{wt(sumW('in_gross_wt'))}</td>
                    <td className="r num strong">{wt(sumW('in_net_wt'))}</td>
                    <td className="r num strong gold">{wt(sumW('in_fine_wt'))}</td>
                    <td></td>
                    <td className="r num strong">₹{money(total)}</td>
                    <td></td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

/**
 * Purchase ↔ labels. Green when every gram bought has been tagged, amber while
 * some is still loose, red if more was tagged than was ever bought.
 */
function TallyBadge({ t }: { t: any }) {
  if (!t || t.status === 'NONE') return <span className="badge badge-mute">—</span>
  if (t.status === 'TALLIED') return <span className="badge badge-ok">Tallied · {t.tagged_pieces} pcs</span>
  if (t.status === 'PENDING') {
    return <span className="badge badge-warn">{wt(t.pending_net)} g to label</span>
  }
  return <span className="badge badge-danger">Over by {wt(Math.abs(t.pending_net))} g</span>
}

function PurchaseForm({ id, onDone, go }: {
  id: number | null; onDone: () => void; go?: (name: string, params?: any) => void
}) {
  const run = useAction()
  const [head, setHead] = useState<any>(blankHead())
  const [lines, setLines] = useState<any[]>([blankLine()])
  const [supplierQuery, setSupplierQuery] = useState('')
  const [busy, setBusy] = useState(false)
  const [confirmDel, setConfirmDel] = useState(false)
  const [dir, setDir] = useState<'IN' | 'OUT'>('IN')
  const [newSupp, setNewSupp] = useState<any>(null)
  const items = useAsync(() => window.api.item.list(), [])
  // The tally only exists once the invoice is saved: what came in against the
  // pieces that were labelled out of it.
  const tally = useAsync(() => (id ? window.api.purchase.tally({ id }) : Promise.resolve(null)), [id])

  const pickSupplier = (p: any) => {
    setSupplierQuery(p.name)
    setHead((h: any) => ({ ...h, party_id: p.id, party_name: p.name, state: p.state || h.state }))
  }

  useEffect(() => {
    let alive = true
    if (id) {
      window.api.purchase.read({ id }).then((p: any) => {
        if (!alive || !p) return
        setHead({ ...blankHead(), ...p })
        setLines(p.items?.length ? p.items : [blankLine()])
        setSupplierQuery(p.party_name || '')
      })
    } else {
      window.api.series.peek({ docType: 'PURCHASE', prefix: 'MI' })
        .then((n) => alive && setHead((h: any) => ({ ...h, invoice_no: n })))
    }
    return () => { alive = false }
  }, [id])

  const computed = useMemo(() => purchaseTotals(head, lines), [head, lines])
  const t = computed.totals

  /** Rows are edited per direction, so map the visible index back to the full list. */
  const visible = computed.items
    .map((r: any, idx: number) => ({ ...r, __i: idx }))
    .filter((r: any) => (r.direction || 'IN') === dir)

  const setLine = (i: number, patch: any) => {
    setLines((rs) => {
      const next = rs.map((r, ix) => (ix === i ? { ...r, ...patch } : r))
      // Keep exactly one trailing blank row on the direction being edited.
      const tail = next.filter((r) => (r.direction || 'IN') === dir)
      const last = tail[tail.length - 1]
      if (!last || last.item_name || num(last.gross_wt) > 0) {
        next.push({ ...blankLine(), direction: dir })
      }
      return next
    })
  }

  // Make sure the tab being viewed always has a row to type into.
  useEffect(() => {
    setLines((rs) =>
      rs.some((r) => (r.direction || 'IN') === dir)
        ? rs
        : [...rs, { ...blankLine(), direction: dir }]
    )
  }, [dir])

  const save = async () => {
    setBusy(true)
    const res = await run(async () => {
      const filled = lines.filter((r) => r.item_name && num(r.gross_wt) > 0)
      if (!filled.length) throw new Error('Add at least one line')
      if (!head.party_id) throw new Error('Select a supplier')
      return window.api.purchase.save({ head, items: filled })
    }, 'Purchase saved')
    setBusy(false)
    if (res) onDone()
  }

  const remove = async () => {
    setConfirmDel(false)
    const ok = await run(() => window.api.purchase.remove({ id: head.id }), 'Purchase deleted')
    if (ok !== undefined) onDone()
  }

  return (
    <div>
      <div className="toolbar">
        <button className="btn btn-ghost" onClick={onDone}><Icon.back /> Back</button>
        <span className="page-title">{head.id ? `Edit ${head.invoice_no}` : 'New Purchase'}</span>
      </div>

      <div className="card" style={{ marginBottom: 14 }}>
        <div className="card-body">
          <div className="form-grid cols-4">
            <Field label="Supplier" required className="span-2">
              <div className="row" style={{ gap: 6 }}>
                <Autocomplete className="grow" value={supplierQuery} placeholder="Search supplier…"
                  onText={(s) => { setSupplierQuery(s); setHead({ ...head, party_name: s, party_id: null }) }}
                  onPick={pickSupplier}
                  fetch={(q) => window.api.party.list({ type: 'SUPPLIER', search: q })}
                  render={(p: any) => <span><b>{p.name}</b>{p.city ? <span className="muted"> · {p.city}</span> : null}</span>} />
                {/* Same escape hatch the billing screen gives the counter: a
                    supplier nobody has entered yet should not send you off to
                    Masters and lose the invoice you are half-way through. */}
                <button className="btn btn-icon" title="New supplier"
                  onClick={() => setNewSupp({ name: supplierQuery, mobile: '', city: '', gstin: '', address: '' })}>
                  <Icon.plus />
                </button>
              </div>
            </Field>
            <Field label="Invoice No"><Input readOnly className="mono" value={head.invoice_no} /></Field>
            <Field label="Invoice Date">
              <Input type="date" value={head.invoice_date}
                onChange={(e) => setHead({ ...head, invoice_date: e.target.value })} />
            </Field>
            <Field label="Manual No">
              <Input value={head.manual_no} onChange={(e) => setHead({ ...head, manual_no: e.target.value })} />
            </Field>
            <Field label="Metal">
              <Select value={head.metal} onChange={(v) => setHead({ ...head, metal: v })}
                options={METALS.map((m) => ({ value: m, label: m }))} />
            </Field>
            <Field label="Payment">
              <Segmented value={head.is_credit ? 'credit' : 'cash'}
                onChange={(v) => setHead({ ...head, is_credit: v === 'credit' ? 1 : 0 })}
                options={[{ value: 'cash', label: 'Cash' }, { value: 'credit', label: 'Credit' }]} />
            </Field>
            <Field label="Remark" className="span-2">
              <Input value={head.remark} onChange={(e) => setHead({ ...head, remark: e.target.value })} />
            </Field>
          </div>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 14 }}>
        <div className="card-head">
          <Segmented value={dir} onChange={(v) => setDir(v as 'IN' | 'OUT')}
            options={[
              { value: 'IN', label: 'Material In' },
              { value: 'OUT', label: 'Material Out' },
            ]} />
          {t.is_exchange && <span className="badge badge-gold">Metal exchange</span>}
          <span className="hint" style={{ marginLeft: 'auto' }}>
            {dir === 'IN'
              ? 'Goods received from the supplier'
              : 'Metal handed back to the supplier — deducted from the bill'}
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
                  <th style={{ width: 74, textAlign: 'right' }}>Black B.</th>
                  <th style={{ width: 74, textAlign: 'right' }}>Stone Wt</th>
                  <th style={{ width: 80, textAlign: 'right' }}>Net Wt</th>
                  <th style={{ width: 66, textAlign: 'right' }}>Purity</th>
                  <th style={{ width: 72, textAlign: 'right' }}>Wastage%</th>
                  <th style={{ width: 88, textAlign: 'right' }}>Fine+Wst</th>
                  {/* Bullion is quoted per ten grams, so that is what gets typed.
                      The stored rate stays per gram — see Rate10Cell. */}
                  <th style={{ width: 92, textAlign: 'right' }}>Rate/10Gm</th>
                  <th style={{ width: 100, textAlign: 'right' }}>Amount</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((r: any) => {
                  const i = r.__i
                  return (
                  <tr key={i}>
                    <td className="cell-del"
                      onClick={() => setLines((rs) => {
                        const next = rs.filter((_, ix) => ix !== i)
                        return next.length ? next : [blankLine()]
                      })}>
                      <Icon.close width={13} height={13} />
                    </td>
                    <td>
                      <input list="purchase-items" value={r.item_name} placeholder="Item name…"
                        onChange={(e) => {
                          const name = e.target.value
                          const match = (items.data || []).find((x: any) => x.name === name)
                          const loose = match?.stock_mode === 'LOOSE_WT'
                          setLine(i, {
                            item_name: name,
                            item_id: match?.id ?? null,
                            is_loose: loose ? 1 : 0,
                            // Beads have no touch. Seeding the group's purity
                            // onto one would price it off a metal basis and put
                            // its grams on the supplier's gold khata.
                            purity: loose ? 0 : (match?.group_purity ?? r.purity),
                          })
                          // Seed the wastage from the Wastage Master, but never
                          // over a figure already agreed with the supplier.
                          if (match?.id && !loose && !num(r.wastage_pct)) {
                            window.api.rateMaster.resolve({ itemId: match.id }).then((m: any) => {
                              if (num(m?.wastage_pct) > 0) setLine(i, { wastage_pct: m.wastage_pct })
                            })
                          }
                        }} />
                    </td>
                    <N v={r.qty} on={(v) => setLine(i, { qty: v })} />
                    <N v={r.gross_wt} on={(v) => setLine(i, { gross_wt: v, net_wt: '' })} />
                    <N v={r.black_beads} on={(v) => setLine(i, { black_beads: v, net_wt: '' })} />
                    <N v={r.stone_wt} on={(v) => setLine(i, { stone_wt: v, net_wt: '' })} />
                    <N v={r.net_wt} on={(v) => setLine(i, { net_wt: v })} />
                    <N v={r.purity} on={(v) => setLine(i, { purity: v })} />
                    <N v={r.wastage_pct} on={(v) => setLine(i, { wastage_pct: v })} />
                    <td><input className="right" readOnly value={r.fine_plus_wastage ? wt(r.fine_plus_wastage) : ''} /></td>
                    <Rate10Cell v={r.rate} on={(v) => setLine(i, { rate: v })} />
                    <td><input className="right" readOnly style={{ fontWeight: 600 }}
                      value={r.amount ? money(r.amount) : ''} /></td>
                  </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {/* the video's "Balance Wgt" settlement strip */}
          <div className="row wrap" style={{ gap: 22, padding: '12px 16px', borderTop: '1px solid var(--line-soft)' }}>
            <W label="In — Gross" v={t.in_gross_wt} />
            <W label="In — Net" v={t.in_net_wt} />
            <W label="In — Fine" v={t.in_fine_wt} gold />
            {t.is_exchange && <>
              <span style={{ width: 1, alignSelf: 'stretch', background: 'var(--line)' }} />
              <W label="Out — Gross" v={t.out_gross_wt} />
              <W label="Out — Net" v={t.out_net_wt} />
              <W label="Out — Fine" v={t.out_fine_wt} gold />
              <span style={{ width: 1, alignSelf: 'stretch', background: 'var(--line)' }} />
              <W label="Balance Fine" v={t.balance_fine_wt} bold />
            </>}
          </div>
          <datalist id="purchase-items">
            {(items.data || []).map((i: any) => <option key={i.id} value={i.name} />)}
          </datalist>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 360px', gap: 14, alignItems: 'start' }}>
        <div className="card">
          <div className="card-head"><span className="card-title">Adjustments</span></div>
          <div className="card-body">
            <div className="form-grid cols-3">
              <Field label="Discount (₹)"><Input className="right" value={head.discount || ''}
                onChange={(e) => setHead({ ...head, discount: e.target.value })} /></Field>
              <Field label="Material Returned (₹)" hint="From the Material Out lines">
                <Input className="right" readOnly value={money(t.return_amount)} />
              </Field>
              <Field label="Sub Tax (₹)"><Input className="right" value={head.sub_tax || ''}
                onChange={(e) => setHead({ ...head, sub_tax: e.target.value })} /></Field>
              <Field label="GST %"><Input className="right" value={head.gst_pct} disabled={!!head.gst_not_required}
                onChange={(e) => setHead({ ...head, gst_pct: e.target.value })} /></Field>
              <Field label="TCS %"><Input className="right" value={head.tcs_pct || ''}
                onChange={(e) => setHead({ ...head, tcs_pct: e.target.value })} /></Field>
              <Field label="Paid Amount (₹)"><Input className="right" value={head.paid_amount || ''}
                onChange={(e) => setHead({ ...head, paid_amount: e.target.value })} /></Field>
              {/* Settling in metal instead of money: the supplier is handed
                  fine grams at an agreed rate, and that value comes off the
                  balance the way cash does. The grams go OUT of the loose pool
                  and onto the supplier's gold khata. */}
              <Field label="Paid in Fine (g)" hint="Fine metal handed to the supplier">
                <Input className="right" inputMode="decimal" value={head.paid_fine_wt || ''}
                  onChange={(e) => setHead({ ...head, paid_fine_wt: e.target.value })} />
              </Field>
              <Field label="Fine Rate (₹/10 g)">
                <Input className="right" inputMode="decimal"
                  value={num(head.paid_fine_rate) ? String(Math.round(num(head.paid_fine_rate) * 1000) / 100) : ''}
                  onChange={(e) => setHead({ ...head, paid_fine_rate: num(e.target.value) / 10 })} />
              </Field>
              <Field label="Fine Value (₹)">
                <Input className="right" readOnly value={t.paid_fine_amount ? money(t.paid_fine_amount) : ''} />
              </Field>
              <div className="span-3">
                <Check label="GST not required" checked={!!head.gst_not_required}
                  onChange={(b) => setHead({ ...head, gst_not_required: b ? 1 : 0 })} />
              </div>
            </div>
          </div>
        </div>

        <div className="card">
          <div className="card-head"><span className="card-title">Summary</span></div>
          <div className="card-body">
            <div className="totals">
              <div className="total-row"><span className="k">Purchase Amount</span><span className="v num">{money(t.purchase_amount)}</span></div>
              {t.discount > 0 && <div className="total-row"><span className="k">Discount</span><span className="v num">− {money(t.discount)}</span></div>}
              {t.return_amount > 0 && (
                <div className="total-row"><span className="k">
                  {t.is_exchange ? 'Material returned' : 'Return'}
                </span><span className="v num">− {money(t.return_amount)}</span></div>
              )}
              {t.gst_amount > 0 && <div className="total-row"><span className="k">GST @ {t.gst_pct}%</span><span className="v num">{money(t.gst_amount)}</span></div>}
              <div className="total-row grand"><span className="k">Bill Amount</span><span className="v num">₹{money(t.bill_amount)}</span></div>
              {t.paid_amount > 0 && <div className="total-row credit"><span className="k">Paid</span><span className="v num">− {money(t.paid_amount)}</span></div>}
              {t.paid_fine_amount > 0 && (
                <div className="total-row credit"><span className="k">Paid in fine ({wt(t.paid_fine_wt)} g)</span>
                  <span className="v num">− {money(t.paid_fine_amount)}</span></div>
              )}
              <div className="total-row grand debit"><span className="k">Balance</span><span className="v num">₹{money(t.net_balance)}</span></div>
            </div>
            <div className="divider" />
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <span className="small muted">Fine weight in</span>
              <span className="small strong num gold">{wt(t.total_fine_wt)} g</span>
            </div>
            {t.paid_fine_wt > 0 && <>
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <span className="small muted">Paid in fine</span>
                <span className="small num">− {wt(t.paid_fine_wt)} g</span>
              </div>
              <div className="total-row grand debit">
                <span className="k">{t.fine_due_wt < 0 ? 'Fine due from supplier' : 'Balance Fine'}</span>
                <span className="v num">{wt(Math.abs(t.fine_due_wt))} g</span>
              </div>
            </>}
          </div>
        </div>
      </div>

      {head.id && (
        <div className="card" style={{ marginTop: 14 }}>
          <div className="card-head">
            <span className="card-title">Labels Tally</span>
            {tally.data && <TallyBadge t={tally.data} />}
            <span className="hint" style={{ marginLeft: 'auto' }}>
              Net weight bought on this invoice against the tagged pieces made from it
            </span>
          </div>
          <div className="card-body">
            {tally.loading || !tally.data ? <Loading /> : (
              <>
                <div className="row wrap" style={{ gap: 22, marginBottom: 12 }}>
                  <W label="Bought — Gross" v={tally.data.bought_gross} />
                  <W label="Bought — Net" v={tally.data.bought_net} />
                  <span style={{ width: 1, alignSelf: 'stretch', background: 'var(--line)' }} />
                  <W label={`Labelled — ${tally.data.tagged_pieces} pcs`} v={tally.data.tagged_net} gold />
                  <span style={{ width: 1, alignSelf: 'stretch', background: 'var(--line)' }} />
                  <W label={tally.data.pending_net >= 0 ? 'Still to label (net)' : 'Over the purchase (net)'}
                    v={Math.abs(tally.data.pending_net)} bold />
                  <span className="spacer" />
                  {tally.data.status !== 'NONE' && go && (
                    <button className="btn btn-primary" style={{ alignSelf: 'center' }}
                      onClick={() => go('tags', { purchaseId: head.id })}>
                      <Icon.tag /> Make labels from this purchase
                    </button>
                  )}
                </div>
                {tally.data.status === 'NONE' ? (
                  <p className="small muted" style={{ margin: 0 }}>
                    Nothing on this invoice needs a label — loose weight-wise items are sold by the gram.
                  </p>
                ) : tally.data.tags?.length ? (
                  <div className="table-wrap" style={{ maxHeight: 220 }}>
                    <table className="data">
                      <thead><tr><th>Tag</th><th>Item</th><th className="r">Gross</th>
                        <th className="r">Net</th><th className="r">Purity</th><th className="r">Fine</th>
                        <th>Status</th><th>Date</th></tr></thead>
                      <tbody>
                        {tally.data.tags.map((x: any) => (
                          <tr key={x.id}>
                            <td className="mono strong">{x.tag}</td>
                            <td>{x.item_name}</td>
                            <td className="r num">{wt(x.gross_wt)}</td>
                            <td className="r num">{wt(x.net_wt)}</td>
                            <td className="r num">{x.purity}</td>
                            <td className="r num gold">{wt(x.final_wt)}</td>
                            <td><span className={`badge ${x.status === 'IN_STOCK' ? 'badge-ok' : 'badge-mute'}`}>
                              {x.status === 'IN_STOCK' ? 'In stock' : x.status.toLowerCase()}</span></td>
                            <td>{dmy(x.entry_date)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="small muted" style={{ margin: 0 }}>
                    No labels made from this purchase yet. The metal is still in the loose pool —
                    it can be sold by weight as it is, or tagged from Tag &amp; Barcode → From loose metal.
                  </p>
                )}
              </>
            )}
          </div>
        </div>
      )}

      <div className="sticky-actions">
        <span className="spacer" />
        {head.id && <button className="btn btn-danger" onClick={() => setConfirmDel(true)}><Icon.trash /> Delete</button>}
        <button className="btn" onClick={onDone}>Cancel</button>
        <button className="btn btn-primary" onClick={save} disabled={busy}>
          {busy ? <span className="spinner" /> : <Icon.save />} Save Purchase
        </button>
      </div>

      {confirmDel && (
        <Confirm title="Delete this purchase?" message="Stock and ledger postings will be reversed."
          onConfirm={remove} onCancel={() => setConfirmDel(false)} />
      )}

      {newSupp && (
        <QuickSupplier draft={newSupp} onClose={() => setNewSupp(null)}
          onSaved={async (id) => {
            setNewSupp(null)
            pickSupplier(await window.api.party.read({ id }))
          }} />
      )}
    </div>
  )
}

/** Minimal inline supplier create, so an invoice never stalls on a missing master. */
function QuickSupplier({ draft, onClose, onSaved }: {
  draft: any; onClose: () => void; onSaved: (id: number) => void
}) {
  const [f, setF] = useState(draft)
  const run = useAction()
  const save = async () => {
    if (!f.name.trim()) return run(async () => { throw new Error('Name is required') })
    const id = await run(
      () => window.api.party.save({
        party_type: 'SUPPLIER', name: f.name, mobile: f.mobile, whatsapp: f.mobile,
        city: f.city, gstin: f.gstin, address: f.address, state: 'Maharashtra',
        opening_balance: 0, opening_dr_cr: 'Cr', metals: [],
      }),
      'Supplier created'
    )
    if (id) onSaved(Number(id))
  }
  return (
    <Modal title="New Supplier" onClose={onClose}
      footer={<><span className="spacer" /><button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" onClick={save}><Icon.save /> Save &amp; use</button></>}>
      <div className="form-grid cols-2">
        <Field label="Name" required className="span-2">
          <Input autoFocus value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
        </Field>
        <Field label="Mobile"><Input value={f.mobile} inputMode="numeric"
          onChange={(e) => setF({ ...f, mobile: e.target.value })} /></Field>
        <Field label="City"><Input value={f.city}
          onChange={(e) => setF({ ...f, city: e.target.value })} /></Field>
        <Field label="GSTIN" className="span-2"><Input className="mono" value={f.gstin}
          onChange={(e) => setF({ ...f, gstin: e.target.value.toUpperCase() })} /></Field>
        <Field label="Address" className="span-2"><Input value={f.address}
          onChange={(e) => setF({ ...f, address: e.target.value })} /></Field>
      </div>
    </Modal>
  )
}

function W({ label, v, gold, bold }: { label: string; v: any; gold?: boolean; bold?: boolean }) {
  return (
    <div>
      <div className="small muted">{label}</div>
      <div className={`num ${gold ? 'gold strong' : ''} ${bold ? 'strong' : ''}`}
        style={{ fontSize: bold ? 16 : 14 }}>{wt(v)} g</div>
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
