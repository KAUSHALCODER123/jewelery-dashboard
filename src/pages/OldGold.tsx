import React, { useEffect, useMemo, useState } from 'react'
import { Icon } from '../lib/icons'
import {
  Autocomplete, Confirm, Empty, Field, Input, Loading, Modal, Select, useAction, useAsync,
  useDebounced,
} from '../lib/ui'
import { dmy, money, monthStartISO, toCsv, todayISO, wt } from '../lib/format'
import { num, urdTotals } from '../lib/calc'
import { printUrdBill, pdfUrdBill } from '../lib/printing'
import { QuickCustomer } from './SalesInvoice'

const PAY_MODES = ['Cash', 'UPI', 'Card', 'NEFT', 'Cheque', 'Bank']

/**
 * Old gold bought on its own — the customer sells old jewellery and buys
 * nothing against it. Each bill books the metal into URD stock and pays the
 * customer out of cash or bank; anything not paid on the spot sits on their
 * khata as a credit until a receipt voucher or their next purchase clears it.
 */
export default function OldGold({ billId }: { billId?: number }) {
  const [from, setFrom] = useState(monthStartISO())
  const [to, setTo] = useState(todayISO())
  const [search, setSearch] = useState('')
  const q = useDebounced(search, 250)
  const [editing, setEditing] = useState<any>(null)
  const [confirmDel, setConfirmDel] = useState<any>(null)
  const run = useAction()

  const list = useAsync(() => window.api.urd.list({ from, to, search: q }), [from, to, q])

  // Arriving from the Old Gold Report with a bill to open.
  useEffect(() => { if (billId) setEditing({ id: billId }) }, [billId])
  const rows = list.data || []
  const sum = (k: string) => rows.reduce((s: number, r: any) => s + num(r[k]), 0)
  const fine = sum('fine_wt')
  const value = sum('total_amount')
  const paid = sum('amount_given')
  const owed = sum('net_balance')

  const remove = async (id: number) => {
    setConfirmDel(null)
    await run(() => window.api.urd.remove({ id }), 'Old gold bill deleted')
    list.reload()
  }

  const exportCsv = async () => {
    const csv = toCsv(
      ['Bill No', 'Date', 'Customer', 'Gross Wt', 'Net Wt', 'Fine Wt', 'Value', 'Paid', 'Balance', 'Paid By'],
      rows.map((r: any) => [
        r.bill_no, r.bill_date, r.party_name, r.gross_wt, r.net_wt, r.fine_wt,
        r.total_amount, r.amount_given, r.net_balance, r.payment_mode,
      ])
    )
    await window.api.file.saveText({ content: csv, suggestedName: 'old-gold-bills.csv' })
  }

  return (
    <div>
      <div className="toolbar">
        <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} style={{ width: 150 }} />
        <span className="muted">to</span>
        <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} style={{ width: 150 }} />
        <div className="search-box">
          <Icon.search />
          <input className="input" placeholder="Bill no or customer…" value={search}
            onChange={(e) => setSearch(e.target.value)} />
        </div>
        <span className="spacer" />
        {rows.length > 0 && (
          <button className="btn btn-sm" onClick={exportCsv}><Icon.download /> Export</button>
        )}
        <button className="btn btn-primary" onClick={() => setEditing({})}>
          <Icon.plus /> New Old Gold Bill
        </button>
      </div>

      <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(4, minmax(0,1fr))' }}>
        <div className="stat"><div className="stat-label">Bills</div><div className="stat-value num">{rows.length}</div></div>
        <div className="stat"><div className="stat-label">Fine Gold Taken In</div><div className="stat-value num">{wt(fine)} g</div></div>
        <div className="stat"><div className="stat-label">Paid to Customers</div><div className="stat-value num">₹{money(paid)}</div></div>
        <div className="stat"><div className="stat-label">Still Owed</div>
          <div className="stat-value num" style={{ color: owed > 0 ? 'var(--danger)' : undefined }}>₹{money(owed)}</div></div>
      </div>

      <div className="card">
        <div className="card-head">
          <span className="card-title">Old Gold Bought</span>
          <span className="badge badge-gold" style={{ marginLeft: 'auto' }}>₹{money(value)}</span>
        </div>
        <div className="card-body flush">
          {list.loading ? <Loading rows={4} /> : !rows.length ? (
            <Empty icon={Icon.refine} title="No old gold bills in this period"
              action={<button className="btn btn-primary btn-sm" onClick={() => setEditing({})}>Create one</button>}>
              Old gold taken in on a sale bill is not listed here — see the Old Gold Report for both.
            </Empty>
          ) : (
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th>Bill No</th><th>Date</th><th>Customer</th>
                    <th className="r">Gross Wt</th><th className="r">Fine Wt</th>
                    <th className="r">Value</th><th className="r">Paid</th><th className="r">Balance</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r: any) => (
                    <tr key={r.id} className="clickable" onClick={() => setEditing({ id: r.id })}>
                      <td className="mono strong">{r.bill_no}</td>
                      <td>{dmy(r.bill_date)}</td>
                      <td>{r.party_name || <span className="muted">Cash customer</span>}</td>
                      <td className="r num">{wt(r.gross_wt)}</td>
                      <td className="r num">{wt(r.fine_wt)}</td>
                      <td className="r num strong">₹{money(r.total_amount)}</td>
                      <td className="r num">{money(r.amount_given)}</td>
                      <td className="r num">{num(r.net_balance) > 0
                        ? <span className="danger strong">{money(r.net_balance)}</span>
                        : <span className="ok">Paid</span>}</td>
                      <td className="r" onClick={(e) => e.stopPropagation()}>
                        <button className="btn btn-ghost btn-icon btn-sm" title="Print"
                          onClick={() => printUrdBill(r.id)}><Icon.print /></button>
                        <button className="btn btn-ghost btn-icon btn-sm" title="Delete"
                          onClick={() => setConfirmDel(r)}><Icon.trash /></button>
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={3}>Total · {rows.length} bills</td>
                    <td className="r num">{wt(sum('gross_wt'))}</td>
                    <td className="r num">{wt(fine)}</td>
                    <td className="r num">₹{money(value)}</td>
                    <td className="r num">₹{money(paid)}</td>
                    <td className="r num">₹{money(owed)}</td>
                    <td></td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </div>
      </div>

      {editing && (
        <UrdBillModal id={editing.id} onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); list.reload() }} />
      )}
      {confirmDel && (
        <Confirm title={`Delete ${confirmDel.bill_no}?`}
          message="The old gold comes out of URD stock and the customer's khata and cash book are reversed. This cannot be undone."
          onConfirm={() => remove(confirmDel.id)} onCancel={() => setConfirmDel(null)} />
      )}
    </div>
  )
}

const blankLine = () => ({
  name: 'Old Gold', description: '', gross_wt: '', net_wt: '', purity: '', rate: '',
})

const blankHead = () => ({
  id: null as number | null, prefix: 'O', bill_no: '', manual_no: '',
  bill_date: todayISO(), party_id: null as number | null, party_name: '',
  address: '', mobile: '', by_hand: '', state: 'Maharashtra',
  payment_mode: 'Cash', discount: '', other_amount: '', amount_given: '', narration: '',
})

function UrdBillModal({ id, onClose, onSaved }: {
  id?: number; onClose: () => void; onSaved: () => void
}) {
  const run = useAction()
  const [head, setHead] = useState<any>(blankHead())
  const [lines, setLines] = useState<any[]>([blankLine()])
  const [custQuery, setCustQuery] = useState('')
  const [custBalance, setCustBalance] = useState<number | null>(null)
  const [newCust, setNewCust] = useState<any>(null)
  const [busy, setBusy] = useState(false)

  const nextNo = useAsync(
    () => (id ? Promise.resolve('') : window.api.series.peek({ docType: 'URD', prefix: 'O' })), [id]
  )

  // Open an existing bill with its lines, or start blank.
  const loaded = useAsync(async () => {
    if (!id) return null
    const b = await window.api.urd.read({ id })
    if (!b) return null
    setHead({
      ...blankHead(), ...b,
      discount: b.discount || '', other_amount: b.other_amount || '',
      amount_given: b.amount_given,
    })
    setLines([...(b.urds || []).map((u: any) => ({
      name: u.name, description: u.description, gross_wt: u.gross_wt, net_wt: u.net_wt,
      purity: u.purity, rate: u.rate,
    })), blankLine()])
    setCustQuery(b.party_name || '')
    if (b.party_id) {
      window.api.party.balance({ id: b.party_id }).then((r) => setCustBalance(r.balance))
    }
    return b
  }, [id])

  const setLine = (i: number, patch: any) =>
    setLines((rs) => {
      const next = rs.map((r, ix) => (ix === i ? { ...r, ...patch } : r))
      const last = next[next.length - 1]
      if (last && (num(last.gross_wt) > 0 || num(last.net_wt) > 0)) next.push(blankLine())
      return next
    })

  const computed = useMemo(() => urdTotals(head, lines), [head, lines])
  const t = computed.totals
  const preview = useMemo(() => lines.map((l) => {
    const c = urdTotals({}, [l])
    return c.urds[0] || { ...l, final_wt: 0, amount: 0 }
  }), [lines])

  const pickCustomer = async (p: any) => {
    setHead((h: any) => ({
      ...h, party_id: p.id, party_name: p.name,
      address: p.address || '', mobile: p.mobile || p.whatsapp || '', state: p.state || h.state,
    }))
    setCustQuery(p.name)
    const b = await window.api.party.balance({ id: p.id })
    setCustBalance(b.balance)
  }

  const save = async (andPrint = false) => {
    if (busy) return
    setBusy(true)
    try {
      const payload = {
        head: { ...head, party_name: head.party_id ? head.party_name : custQuery },
        urds: lines,
      }
      const res = await run(() => window.api.urd.save(payload), 'Old gold bill saved')
      if (!res) return
      if (andPrint) await printUrdBill(res.id)
      onSaved()
    } finally {
      setBusy(false)
    }
  }

  const title = id
    ? `Old Gold Bill ${head.bill_no || ''}`
    : `New Old Gold Bill${nextNo.data ? ` · ${nextNo.data}` : ''}`

  return (
    <Modal wide title={title} onClose={onClose}
      footer={<>
        {id && <button className="btn" onClick={() => pdfUrdBill(id)}><Icon.download /> PDF</button>}
        <span className="spacer" />
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn" disabled={busy} onClick={() => save(true)}><Icon.print /> Save &amp; Print</button>
        <button className="btn btn-primary" disabled={busy} onClick={() => save(false)}><Icon.save /> Save</button>
      </>}>
      {id && loaded.loading ? <Loading rows={6} /> : (
        <>
          <div className="form-grid cols-4">
            <Field label="Customer" className="span-2"
              hint={head.party_id
                ? (custBalance != null
                  ? `Khata: ₹${money(Math.abs(custBalance))} ${custBalance >= 0 ? 'Dr' : 'Cr'}`
                  : undefined)
                : 'Leave blank for a walk-in paid in full'}>
              <div className="row" style={{ gap: 6 }}>
                <Autocomplete className="grow" value={custQuery} placeholder="Type a name to search…"
                  onText={(s) => {
                    setCustQuery(s)
                    setHead((h: any) => ({ ...h, party_name: s, party_id: null }))
                    setCustBalance(null)
                  }}
                  onPick={pickCustomer}
                  fetch={(q) => window.api.party.list({ type: 'CUSTOMER', search: q })}
                  render={(p: any) => (
                    <span><b>{p.name}</b>
                      {p.mobile ? <span className="muted"> · {p.mobile}</span> : null}
                      {p.area ? <span className="muted"> · {p.area}</span> : null}
                    </span>
                  )} />
                <button className="btn btn-icon" title="New customer"
                  onClick={() => setNewCust({ name: custQuery, mobile: '', area: '', address: '' })}>
                  <Icon.plus />
                </button>
              </div>
            </Field>
            <Field label="Bill date">
              <Input type="date" value={head.bill_date}
                onChange={(e) => setHead({ ...head, bill_date: e.target.value })} />
            </Field>
            <Field label="Paid by">
              <Select value={head.payment_mode} onChange={(v) => setHead({ ...head, payment_mode: v })}
                options={PAY_MODES.map((m) => ({ value: m, label: m }))} />
            </Field>
            <Field label="Mobile">
              <Input value={head.mobile} inputMode="numeric"
                onChange={(e) => setHead({ ...head, mobile: e.target.value })} />
            </Field>
            <Field label="By hand" hint="Who brought it, if not the customer">
              <Input value={head.by_hand} onChange={(e) => setHead({ ...head, by_hand: e.target.value })} />
            </Field>
            <Field label="Manual no.">
              <Input value={head.manual_no} onChange={(e) => setHead({ ...head, manual_no: e.target.value })} />
            </Field>
            <Field label="Narration">
              <Input value={head.narration} placeholder="Broken chain, melted…"
                onChange={(e) => setHead({ ...head, narration: e.target.value })} />
            </Field>
          </div>

          <div className="table-wrap" style={{ marginTop: 12 }}>
            <table className="grid-edit">
              <thead>
                <tr>
                  <th style={{ width: 28 }}></th>
                  <th style={{ width: 130 }}>Name</th>
                  <th style={{ minWidth: 150 }}>Description</th>
                  <th style={{ width: 84, textAlign: 'right' }}>Gross Wt</th>
                  <th style={{ width: 84, textAlign: 'right' }}>Net Wt</th>
                  <th style={{ width: 76, textAlign: 'right' }}>Purity %</th>
                  <th style={{ width: 84, textAlign: 'right' }}>Fine Wt</th>
                  <th style={{ width: 88, textAlign: 'right' }}>Rate/g</th>
                  <th style={{ width: 104, textAlign: 'right' }}>Amount</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((l, i) => (
                  <tr key={i}>
                    <td className="cell-del"
                      onClick={() => setLines((rs) => rs.length > 1 ? rs.filter((_, ix) => ix !== i) : rs)}>
                      <Icon.close width={13} height={13} />
                    </td>
                    <td><input value={l.name} onChange={(e) => setLine(i, { name: e.target.value })} /></td>
                    <td><input value={l.description}
                      onChange={(e) => setLine(i, { description: e.target.value })} /></td>
                    <NumCell v={l.gross_wt} on={(v) => setLine(i, { gross_wt: v, net_wt: v })} />
                    <NumCell v={l.net_wt} on={(v) => setLine(i, { net_wt: v })} />
                    <NumCell v={l.purity} on={(v) => setLine(i, { purity: v })} />
                    <td><input className="right" readOnly
                      value={preview[i]?.final_wt ? wt(preview[i].final_wt) : ''} /></td>
                    <NumCell v={l.rate} on={(v) => setLine(i, { rate: v })} />
                    <td><input className="right" readOnly style={{ fontWeight: 600 }}
                      value={preview[i]?.amount ? money(preview[i].amount) : ''} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="row wrap" style={{ gap: 16, marginTop: 14, alignItems: 'flex-start' }}>
            <Field label="Deduction" hint="Melting loss, stones, etc.">
              <Input className="right" style={{ width: 110 }} value={head.discount}
                onChange={(e) => setHead({ ...head, discount: e.target.value })} />
            </Field>
            <Field label="Other amount">
              <Input className="right" style={{ width: 110 }} value={head.other_amount}
                onChange={(e) => setHead({ ...head, other_amount: e.target.value })} />
            </Field>
            <Field label="Paid now" hint="Blank = paid in full">
              <Input className="right" style={{ width: 130 }} value={head.amount_given}
                placeholder={money(t.total_amount)}
                onChange={(e) => setHead({ ...head, amount_given: e.target.value })} />
            </Field>
            <span className="spacer" style={{ marginLeft: 'auto' }} />
            <div style={{ minWidth: 260 }}>
              <div className="total-row"><span className="k">Fine gold</span><span className="v num">{wt(t.total_fine_wt)} g</span></div>
              <div className="total-row"><span className="k">Old gold value</span><span className="v num">₹{money(t.purchase_amount)}</span></div>
              {t.discount > 0 && <div className="total-row debit"><span className="k">Less deduction</span><span className="v num">− {money(t.discount)}</span></div>}
              {t.other_amount !== 0 && <div className="total-row"><span className="k">Other</span><span className="v num">{money(t.other_amount)}</span></div>}
              <div className="total-row grand"><span className="k">Payable to customer</span><span className="v num">₹{money(t.total_amount)}</span></div>
              <div className="total-row"><span className="k">Paid now</span><span className="v num">{money(t.amount_given)}</span></div>
              <div className={`total-row ${t.net_balance > 0 ? 'debit' : ''}`}>
                <span className="k">Balance on khata</span><span className="v num">₹{money(t.net_balance)}</span>
              </div>
            </div>
          </div>
        </>
      )}

      {newCust && (
        <QuickCustomer draft={newCust} onClose={() => setNewCust(null)}
          onSaved={(pid, name) => {
            setNewCust(null)
            setHead((h: any) => ({ ...h, party_id: pid, party_name: name }))
            setCustQuery(name)
            setCustBalance(0)
          }} />
      )}
    </Modal>
  )
}

function NumCell({ v, on }: { v: any; on: (v: string) => void }) {
  return (
    <td>
      <input className="right" inputMode="decimal" value={v ?? ''}
        onChange={(e) => {
          const t = e.target.value
          if (t !== '' && !/^\d*\.?\d*$/.test(t)) return
          on(t)
        }}
        onFocus={(e) => e.target.select()} />
    </td>
  )
}
