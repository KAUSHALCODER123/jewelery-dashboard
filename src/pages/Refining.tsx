import React, { useEffect, useMemo, useState } from 'react'
import { Icon } from '../lib/icons'
import {
  Autocomplete, Confirm, Empty, Field, Input, Loading, Segmented, Select,
  useAction, useAsync,
} from '../lib/ui'
import { num, refineryTotals } from '../lib/calc'
import { dmy, money, monthStartISO, todayISO, wt } from '../lib/format'

const blankLine = () => ({
  tag: '', item_id: null as number | null, item_name: '',
  qty: '', gross_wt: '', black_beads: '', stone_wt: '', net_wt: '',
  purity: '', rate_per_gm: '', gross_wastage: '',
})

const blankHead = () => ({
  id: null as number | null,
  prefix: 'MO', invoice_no: '', manual_no: '', invoice_date: todayISO(),
  direction: 'OUT', metal: 'Gold',
  party_id: null as number | null, party_name: '', remark: '', state: 'Maharashtra',
  is_credit: 1, gst_pct: 0, discount: 0, sub_tax: 0, paid_amount: 0,
})

const METALS = ['Gold', 'Silver', 'Platinum']

export default function Refining() {
  const [mode, setMode] = useState<'list' | 'edit'>('list')
  const [editId, setEditId] = useState<number | null>(null)

  if (mode === 'edit') {
    return <RefiningForm id={editId} onDone={() => { setMode('list'); setEditId(null) }} />
  }
  return <RefiningList onNew={() => { setEditId(null); setMode('edit') }}
    onOpen={(id) => { setEditId(id); setMode('edit') }} />
}

function RefiningList({ onNew, onOpen }: { onNew: () => void; onOpen: (id: number) => void }) {
  const [from, setFrom] = useState(monthStartISO())
  const [to, setTo] = useState(todayISO())
  const [direction, setDirection] = useState('ALL')
  const list = useAsync(() => window.api.refinery.list({ from, to, direction }), [from, to, direction])
  const rows = list.data || []

  const sent = rows.filter((r: any) => r.direction === 'OUT')
  const recd = rows.filter((r: any) => r.direction === 'IN')

  return (
    <div>
      <div className="toolbar">
        <Segmented value={direction} onChange={setDirection}
          options={[
            { value: 'ALL', label: 'All' },
            { value: 'OUT', label: 'Sent Out' },
            { value: 'IN', label: 'Received' },
          ]} />
        <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} style={{ width: 150 }} />
        <span className="muted">to</span>
        <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} style={{ width: 150 }} />
        <span className="spacer" />
        <button className="btn btn-primary" onClick={onNew}><Icon.plus /> New Refining Entry</button>
      </div>

      <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(3, minmax(0,1fr))' }}>
        <div className="stat">
          <div className="stat-label">Entries</div>
          <div className="stat-value num">{rows.length}</div>
        </div>
        <div className="stat">
          <div className="stat-label">Fine Sent Out</div>
          <div className="stat-value num">
            {wt(sent.reduce((s: number, r: any) => s + fineOf(r), 0))}
            <span style={{ fontSize: 13, color: 'var(--text-3)' }}> g</span>
          </div>
        </div>
        <div className="stat">
          <div className="stat-label">Fine Received</div>
          <div className="stat-value num gold">
            {wt(recd.reduce((s: number, r: any) => s + fineOf(r), 0))}
            <span style={{ fontSize: 13, color: 'var(--text-3)' }}> g</span>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-body flush">
          {list.loading ? <Loading /> : !rows.length ? (
            <Empty icon={Icon.refine} title="No refining entries"
              action={<button className="btn btn-primary btn-sm" onClick={onNew}>Record one</button>}>
              Send scrap or old gold out to a refiner, then book the pure metal back in.
            </Empty>
          ) : (
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr><th>Invoice</th><th>Date</th><th>Refinery</th><th>Direction</th>
                    <th className="r">Fine Wt</th>
                    <th className="r">Charges</th><th className="r">Paid</th><th className="r">Balance</th></tr>
                </thead>
                <tbody>
                  {rows.map((r: any) => (
                    <tr key={r.id} className="clickable" onClick={() => onOpen(r.id)}>
                      <td className="mono strong">{r.invoice_no}</td>
                      <td>{dmy(r.invoice_date)}</td>
                      <td>{r.party_name || '—'}</td>
                      <td>
                        <span className={`badge ${r.direction === 'OUT' ? 'badge-warn' : 'badge-ok'}`}>
                          {r.direction === 'OUT' ? 'Sent out' : 'Received'}
                        </span>
                      </td>
                      <td className="r num strong gold">{wt(r.total_fine_wt)}</td>
                      <td className="r num">{money(r.bill_amount)}</td>
                      <td className="r num">{money(r.paid_amount)}</td>
                      <td className="r num">{num(r.net_balance) > 0
                        ? <span className="danger strong">{money(r.net_balance)}</span>
                        : <span className="ok">Settled</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

/** The list query totals each entry's line fine weights for us. */
const fineOf = (r: any) => num(r.total_fine_wt)

function RefiningForm({ id, onDone }: { id: number | null; onDone: () => void }) {
  const run = useAction()
  const [head, setHead] = useState<any>(blankHead())
  const [lines, setLines] = useState<any[]>([blankLine()])
  const [partyQuery, setPartyQuery] = useState('')
  const [busy, setBusy] = useState(false)
  const [confirmDel, setConfirmDel] = useState(false)

  useEffect(() => {
    let alive = true
    if (id) {
      window.api.refinery.read({ id }).then((r: any) => {
        if (!alive || !r) return
        setHead({ ...blankHead(), ...r })
        setLines(r.items?.length ? r.items : [blankLine()])
        setPartyQuery(r.party_name || '')
      })
    } else {
      window.api.series.peek({ docType: 'REFINERY', prefix: 'MO' })
        .then((n) => alive && setHead((h: any) => ({ ...h, invoice_no: n })))
    }
    return () => { alive = false }
  }, [id])

  const computed = useMemo(() => refineryTotals(head, lines), [head, lines])
  const t = computed.totals
  const isOut = head.direction === 'OUT'

  const setLine = (i: number, patch: any) => {
    setLines((rs) => {
      const next = rs.map((r, ix) => (ix === i ? { ...r, ...patch } : r))
      const last = next[next.length - 1]
      if (last && (last.item_name || num(last.gross_wt) > 0)) next.push(blankLine())
      return next
    })
  }

  const save = async () => {
    setBusy(true)
    const res = await run(async () => {
      const filled = lines.filter((r) => r.item_name && num(r.gross_wt) > 0)
      if (!filled.length) throw new Error('Add at least one line')
      if (!head.party_id) throw new Error('Select a refinery')
      return window.api.refinery.save({ head, items: filled })
    }, isOut ? 'Metal sent for refining' : 'Refined metal received')
    setBusy(false)
    if (res) onDone()
  }

  const remove = async () => {
    setConfirmDel(false)
    const ok = await run(() => window.api.refinery.remove({ id: head.id }), 'Entry deleted')
    if (ok !== undefined) onDone()
  }

  return (
    <div>
      <div className="toolbar">
        <button className="btn btn-ghost" onClick={onDone}><Icon.back /> Back</button>
        <span className="page-title">
          {head.id ? `Edit ${head.invoice_no}` : 'New Refining Entry'}
        </span>
      </div>

      <div className="card" style={{ marginBottom: 14 }}>
        <div className="card-body">
          <div className="form-grid cols-4">
            <Field label="Direction" required
              hint={isOut ? 'Metal leaves your stock' : 'Pure metal comes back in'}>
              <Segmented value={head.direction}
                onChange={(v) => setHead({ ...head, direction: v })}
                options={[{ value: 'OUT', label: 'Send Out' }, { value: 'IN', label: 'Receive' }]} />
            </Field>
            <Field label="Metal">
              <Select value={head.metal} onChange={(v) => setHead({ ...head, metal: v })}
                options={METALS.map((m) => ({ value: m, label: m }))} />
            </Field>
            <Field label="Refinery" required className="span-2">
              <Autocomplete value={partyQuery} placeholder="Search refinery…"
                onText={(s) => { setPartyQuery(s); setHead({ ...head, party_name: s, party_id: null }) }}
                onPick={(p: any) => {
                  setPartyQuery(p.name)
                  setHead({ ...head, party_id: p.id, party_name: p.name, state: p.state || head.state })
                }}
                fetch={(q) => window.api.party.list({ type: 'ALL', search: q })}
                render={(p: any) => <span><b>{p.name}</b><span className="muted"> · {p.party_type}</span></span>} />
            </Field>
            <Field label="Invoice No"><Input readOnly className="mono" value={head.invoice_no} /></Field>
            <Field label="Date">
              <Input type="date" value={head.invoice_date}
                onChange={(e) => setHead({ ...head, invoice_date: e.target.value })} />
            </Field>
            <Field label="Manual No">
              <Input value={head.manual_no} onChange={(e) => setHead({ ...head, manual_no: e.target.value })} />
            </Field>
            <Field label="Remark" className="span-2">
              <Input value={head.remark} onChange={(e) => setHead({ ...head, remark: e.target.value })} />
            </Field>
          </div>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 14 }}>
        <div className="card-head">
          <span className="card-title">{isOut ? 'Material Sent Out' : 'Material Received'}</span>
          <span className="hint" style={{ marginLeft: 'auto' }}>
            Fine = Net × Purity% · Amount = Fine × Rate/Gm
          </span>
        </div>
        <div className="card-body flush">
          <div className="table-wrap" style={{ maxHeight: 320 }}>
            <table className="grid-edit">
              <thead>
                <tr>
                  <th style={{ width: 28 }}></th>
                  <th style={{ width: 96 }}>Tag</th>
                  <th style={{ minWidth: 160 }}>Item</th>
                  <th style={{ width: 54, textAlign: 'right' }}>Qty</th>
                  <th style={{ width: 80, textAlign: 'right' }}>Gross Wt</th>
                  <th style={{ width: 72, textAlign: 'right' }}>Black B.</th>
                  <th style={{ width: 74, textAlign: 'right' }}>Stone Wt</th>
                  <th style={{ width: 80, textAlign: 'right' }}>Net Wt</th>
                  <th style={{ width: 66, textAlign: 'right' }}>Purity</th>
                  <th style={{ width: 82, textAlign: 'right' }}>Fine Wt</th>
                  <th style={{ width: 80, textAlign: 'right' }}>Rate/Gm</th>
                  <th style={{ width: 78, textAlign: 'right' }}>Wastage</th>
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
                    <td>
                      <input className="mono" value={r.tag} placeholder="scan"
                        onChange={(e) => setLine(i, { tag: e.target.value })}
                        onKeyDown={async (e) => {
                          if (e.key !== 'Enter') return
                          const f = await window.api.tagStock.findByTag({ tag: (e.target as HTMLInputElement).value })
                          if (f && f.status === 'IN_STOCK') {
                            setLine(i, {
                              tag: f.tag, item_id: f.item_id, item_name: f.item_name,
                              gross_wt: f.gross_wt, stone_wt: f.stone_wt, net_wt: f.net_wt,
                              purity: f.purity,
                            })
                          }
                        }} />
                    </td>
                    <td><input value={r.item_name} placeholder="Item name…"
                      onChange={(e) => setLine(i, { item_name: e.target.value })} /></td>
                    <N v={r.qty} on={(v) => setLine(i, { qty: v })} />
                    <N v={r.gross_wt} on={(v) => setLine(i, { gross_wt: v, net_wt: '' })} />
                    <N v={r.black_beads} on={(v) => setLine(i, { black_beads: v, net_wt: '' })} />
                    <N v={r.stone_wt} on={(v) => setLine(i, { stone_wt: v, net_wt: '' })} />
                    <N v={r.net_wt} on={(v) => setLine(i, { net_wt: v })} />
                    <N v={r.purity} on={(v) => setLine(i, { purity: v })} />
                    <td><input className="right" readOnly value={r.fine_wt ? wt(r.fine_wt) : ''} /></td>
                    <N v={r.rate_per_gm} on={(v) => setLine(i, { rate_per_gm: v })} />
                    <N v={r.gross_wastage} on={(v) => setLine(i, { gross_wastage: v })} />
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
          <div className="card-head"><span className="card-title">Charges</span></div>
          <div className="card-body">
            <div className="form-grid cols-3">
              <Field label="Discount (₹)"><Input className="right" value={head.discount || ''}
                onChange={(e) => setHead({ ...head, discount: e.target.value })} /></Field>
              <Field label="GST %"><Input className="right" value={head.gst_pct || ''}
                onChange={(e) => setHead({ ...head, gst_pct: e.target.value })} /></Field>
              <Field label="Sub Tax (₹)"><Input className="right" value={head.sub_tax || ''}
                onChange={(e) => setHead({ ...head, sub_tax: e.target.value })} /></Field>
              <Field label="Paid Amount (₹)"><Input className="right" value={head.paid_amount || ''}
                onChange={(e) => setHead({ ...head, paid_amount: e.target.value })} /></Field>
            </div>
          </div>
        </div>

        <div className="card">
          <div className="card-head"><span className="card-title">Summary</span></div>
          <div className="card-body">
            <div className="totals">
              <div className="total-row"><span className="k">Metal Value</span><span className="v num">{money(t.goods_amount)}</span></div>
              {t.discount > 0 && <div className="total-row"><span className="k">Discount</span><span className="v num">− {money(t.discount)}</span></div>}
              {t.gst_amount > 0 && <div className="total-row"><span className="k">GST @ {t.gst_pct}%</span><span className="v num">{money(t.gst_amount)}</span></div>}
              <div className="total-row grand"><span className="k">Bill Amount</span><span className="v num">₹{money(t.bill_amount)}</span></div>
              {t.paid_amount > 0 && <div className="total-row credit"><span className="k">Paid</span><span className="v num">− {money(t.paid_amount)}</span></div>}
              <div className="total-row grand debit"><span className="k">Balance</span><span className="v num">₹{money(t.net_balance)}</span></div>
            </div>
            <div className="divider" />
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <span className="small muted">Fine weight {isOut ? 'out' : 'in'}</span>
              <span className="small strong num gold">{wt(t.total_fine_wt)} g</span>
            </div>
            {t.total_wastage > 0 && (
              <div className="row" style={{ justifyContent: 'space-between', marginTop: 4 }}>
                <span className="small muted">Wastage</span>
                <span className="small strong num">{wt(t.total_wastage)} g</span>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="sticky-actions">
        {isOut && lines.some((l) => l.tag) && (
          <span className="badge badge-warn">Tagged pieces will be marked melted</span>
        )}
        <span className="spacer" />
        {head.id && <button className="btn btn-danger" onClick={() => setConfirmDel(true)}><Icon.trash /> Delete</button>}
        <button className="btn" onClick={onDone}>Cancel</button>
        <button className="btn btn-primary" onClick={save} disabled={busy}>
          {busy ? <span className="spinner" /> : <Icon.save />} Save Entry
        </button>
      </div>

      {confirmDel && (
        <Confirm title="Delete this refining entry?"
          message="Metal movements will be reversed and any melted tags returned to stock."
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
