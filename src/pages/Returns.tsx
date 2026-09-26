import React, { useEffect, useState } from 'react'
import { Icon } from '../lib/icons'
import {
  Autocomplete, Empty, Field, Input, Loading, Modal, Segmented, useAction, useAsync,
} from '../lib/ui'
import { dmy, money, monthStartISO, toCsv, todayISO, wt } from '../lib/format'
import { num } from '../lib/calc'

/**
 * Sales and purchase returns.
 *
 * A return is a new dated document, never an edit of the original bill — once a
 * bill is printed and reported, unwinding it by deletion falsifies history. The
 * original stays exactly as it was; the return reverses stock, money and metal on
 * the day the goods actually came back.
 */
export default function Returns({ saleId }: { saleId?: number } = {}) {
  const [kind, setKind] = useState<'SALE' | 'PURCHASE'>('SALE')
  const [from, setFrom] = useState(monthStartISO())
  const [to, setTo] = useState(todayISO())
  // Opened from a bill in the Sales Register: the return starts on that bill.
  const [editing, setEditing] = useState<any>(() => (saleId ? { kind: 'SALE', saleId } : null))
  const run = useAction()
  const isSale = kind === 'SALE'

  const list = useAsync(
    () => (isSale
      ? window.api.saleReturn.list({ from, to })
      : window.api.purchaseReturn.list({ from, to })),
    [kind, from, to]
  )
  const rows = list.data || []
  const total = rows.reduce((s: number, r: any) => s + num(r.total_amount), 0)

  const remove = async (id: number) => {
    await run(() => (isSale
      ? window.api.saleReturn.remove({ id })
      : window.api.purchaseReturn.remove({ id })), 'Return deleted')
    list.reload()
  }

  const exportCsv = async () => {
    const csv = toCsv(
      ['Return No', 'Date', 'Party', 'Against', 'Reason', 'Goods', 'GST', 'Total'],
      rows.map((r: any) => [
        r.return_no, r.return_date, r.party_name,
        isSale ? r.against_bill_no : r.against_invoice_no,
        r.reason, r.goods_amount, r.gst_amount, r.total_amount,
      ])
    )
    await window.api.file.saveText({
      content: csv, suggestedName: `${isSale ? 'sales' : 'purchase'}-returns.csv`,
    })
  }

  return (
    <div>
      <div className="toolbar">
        <Segmented value={kind} onChange={(v) => setKind(v as any)}
          options={[
            { value: 'SALE', label: 'Sales Returns' },
            { value: 'PURCHASE', label: 'Purchase Returns' },
          ]} />
        <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} style={{ width: 150 }} />
        <span className="muted">to</span>
        <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} style={{ width: 150 }} />
        <span className="spacer" />
        {rows.length > 0 && (
          <button className="btn btn-sm" onClick={exportCsv}><Icon.download /> Export</button>
        )}
        <button className="btn btn-primary" onClick={() => setEditing({ kind })}>
          <Icon.plus /> New {isSale ? 'Sales' : 'Purchase'} Return
        </button>
      </div>

      <div className="card">
        <div className="card-head">
          <span className="card-title">
            {isSale ? 'Goods Back from Customers' : 'Goods Back to Suppliers'}
          </span>
          <span className="badge badge-gold" style={{ marginLeft: 'auto' }}>₹{money(total)}</span>
        </div>
        <div className="card-body flush">
          {list.loading ? <Loading rows={4} /> : !rows.length ? (
            <Empty icon={Icon.back} title="No returns in this period">
              A return reverses stock, money and metal without touching the original bill.
            </Empty>
          ) : (
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th>Return No</th><th>Date</th><th>Party</th><th>Against</th><th>Reason</th>
                    <th className="r">Goods</th><th className="r">GST</th><th className="r">Total</th><th></th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r: any) => (
                    <tr key={r.id}>
                      <td className="mono strong">{r.return_no}</td>
                      <td>{dmy(r.return_date)}</td>
                      <td>{r.party_name || <span className="muted">—</span>}</td>
                      <td className="mono small">
                        {(isSale ? r.against_bill_no : r.against_invoice_no) || '—'}
                      </td>
                      <td className="small muted">{r.reason || '—'}</td>
                      <td className="r num">{money(r.goods_amount)}</td>
                      <td className="r num">{money(r.gst_amount)}</td>
                      <td className="r num strong">₹{money(r.total_amount)}</td>
                      <td className="r">
                        <button className="btn btn-ghost btn-icon btn-sm" aria-label="Delete"
                          onClick={() => remove(r.id)}><Icon.trash /></button>
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr><td colSpan={7}>Total</td><td className="r num">₹{money(total)}</td><td></td></tr>
                </tfoot>
              </table>
            </div>
          )}
        </div>
      </div>

      {editing && (
        <ReturnModal kind={editing.kind} saleId={editing.saleId} onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); list.reload() }} />
      )}
    </div>
  )
}

const blankLine = () => ({
  tag: '', tag_stock_id: null as number | null, item_id: null as number | null,
  item_name: '', qty: '', gross_wt: '', stone_wt: '', net_wt: '', purity: '',
  rate_per_gm: '', mkg_per_gm: '',
})

function ReturnModal({ kind, saleId, onClose, onSaved }: {
  kind: 'SALE' | 'PURCHASE'; saleId?: number; onClose: () => void; onSaved: () => void
}) {
  const isSale = kind === 'SALE'
  const [f, setF] = useState<any>({
    return_date: todayISO(), party_id: null, party_name: '',
    against_sale_id: null, against_bill_no: '', against_purchase_id: null,
    against_invoice_no: '', reason: '', gst_pct: 3, refund_amount: '', received_amount: '',
  })
  const [lines, setLines] = useState<any[]>([blankLine()])
  const run = useAction()

  const setLine = (i: number, patch: any) =>
    setLines((rs) => {
      const next = rs.map((r, ix) => (ix === i ? { ...r, ...patch } : r))
      const last = next[next.length - 1]
      if (last && (last.item_name || num(last.gross_wt) > 0)) next.push(blankLine())
      return next
    })

  /** Pull the lines straight off the original bill so nothing is retyped. */
  const pullBill = async (bill: any) => {
    const s = isSale
      ? await window.api.sale.read({ id: bill.id })
      : await window.api.purchase.read({ id: bill.id })
    if (!s) return
    setF((x: any) => ({
      ...x,
      party_id: s.party_id, party_name: s.party_name,
      gst_pct: s.gst_pct ?? 3,
      ...(isSale
        ? { against_sale_id: s.id, against_bill_no: s.bill_no }
        : { against_purchase_id: s.id, against_invoice_no: s.invoice_no }),
    }))
    setLines([
      ...(s.items || []).map((l: any) => ({
        tag: l.tag || '', tag_stock_id: l.tag_stock_id ?? null, item_id: l.item_id ?? null,
        item_name: l.item_name, qty: l.qty, gross_wt: l.gross_wt, stone_wt: l.stone_wt,
        net_wt: l.net_wt, purity: l.purity,
        rate_per_gm: l.rate_per_gm ?? l.rate ?? 0, mkg_per_gm: l.mkg_per_gm ?? 0,
      })),
      blankLine(),
    ])
  }

  useEffect(() => {
    if (saleId && isSale) pullBill({ id: saleId })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saleId])

  const filled = lines.filter((l) => num(l.gross_wt) > 0 || num(l.qty) > 0)
  const goods = filled.reduce((s, l) => s + num(l.net_wt || l.gross_wt) * num(l.rate_per_gm), 0)
  const making = isSale
    ? filled.reduce((s, l) => s + num(l.net_wt || l.gross_wt) * num(l.mkg_per_gm), 0)
    : 0
  const billAmt = goods + making
  const gst = billAmt * (num(f.gst_pct) / 100)
  const totalAmt = billAmt + gst

  const save = async () => {
    if (!f.party_id) return run(async () => { throw new Error('Select a party') })
    if (!filled.length) return run(async () => { throw new Error('Add at least one line') })
    const payload = { head: f, items: filled }
    const ok = await run(() => (isSale
      ? window.api.saleReturn.save(payload)
      : window.api.purchaseReturn.save(payload)), 'Return saved')
    if (ok !== undefined) onSaved()
  }

  return (
    <Modal wide title={isSale ? 'New Sales Return' : 'New Purchase Return'} onClose={onClose}
      footer={<><span className="spacer" /><button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" onClick={save}><Icon.save /> Save Return</button></>}>
      <p className="small muted" style={{ marginBottom: 12 }}>
        The original bill is not changed. This creates a separate document dated when the
        goods came back, and reverses stock, money and metal from that day.
      </p>

      <div className="form-grid cols-3">
        <Field label={isSale ? 'Against bill (optional)' : 'Against invoice (optional)'}
          className="span-2" hint="Pick the original to pull its lines in — or leave blank and enter them by hand.">
          <Autocomplete value={isSale ? f.against_bill_no : f.against_invoice_no}
            placeholder="Search bill number or party…"
            onText={(t) => setF(isSale ? { ...f, against_bill_no: t } : { ...f, against_invoice_no: t })}
            onPick={pullBill}
            fetch={(q) => (isSale
              ? window.api.sale.list({ search: q })
              : window.api.purchase.list({ search: q }))}
            render={(b: any) => (
              <span><b>{b.bill_no || b.invoice_no}</b>
                <span className="muted"> · {b.party_name} · ₹{money(b.total_amount ?? b.bill_amount)}</span>
              </span>
            )} />
        </Field>
        <Field label="Return date">
          <Input type="date" value={f.return_date}
            onChange={(e) => setF({ ...f, return_date: e.target.value })} />
        </Field>

        <Field label="Party" required className="span-2">
          <Autocomplete value={f.party_name} placeholder="Customer or supplier…"
            onText={(t) => setF({ ...f, party_name: t, party_id: null })}
            onPick={(p: any) => setF({ ...f, party_id: p.id, party_name: p.name })}
            fetch={(q) => window.api.party.list({
              type: isSale ? 'CUSTOMER' : 'SUPPLIER', search: q,
            })}
            render={(p: any) => <span><b>{p.name}</b><span className="muted"> · {p.mobile || p.area || ''}</span></span>} />
        </Field>
        <Field label="Reason">
          <Input value={f.reason} placeholder="Wrong size, short purity…"
            onChange={(e) => setF({ ...f, reason: e.target.value })} />
        </Field>
      </div>

      <div className="table-wrap" style={{ marginTop: 12 }}>
        <table className="grid-edit">
          <thead>
            <tr>
              <th style={{ width: 28 }}></th>
              <th style={{ minWidth: 140 }}>Item</th>
              <th style={{ width: 78, textAlign: 'right' }}>Gross Wt</th>
              <th style={{ width: 78, textAlign: 'right' }}>Stone</th>
              <th style={{ width: 78, textAlign: 'right' }}>Net Wt</th>
              <th style={{ width: 72, textAlign: 'right' }}>Purity %</th>
              <th style={{ width: 88, textAlign: 'right' }}>Rate/Gm</th>
              {isSale && <th style={{ width: 82, textAlign: 'right' }}>Mkg/Gm</th>}
              <th style={{ width: 100, textAlign: 'right' }}>Amount</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l, i) => {
              const net = num(l.net_wt) || Math.max(0, num(l.gross_wt) - num(l.stone_wt))
              const amt = net * num(l.rate_per_gm) + (isSale ? net * num(l.mkg_per_gm) : 0)
              return (
                <tr key={i}>
                  <td className="cell-del"
                    onClick={() => setLines((rs) => rs.length > 1 ? rs.filter((_, ix) => ix !== i) : rs)}>
                    <Icon.close width={13} height={13} />
                  </td>
                  <td><input value={l.item_name}
                    onChange={(e) => setLine(i, { item_name: e.target.value })} /></td>
                  <td><input className="right" value={l.gross_wt}
                    onChange={(e) => setLine(i, { gross_wt: e.target.value, net_wt: e.target.value })} /></td>
                  <td><input className="right" value={l.stone_wt}
                    onChange={(e) => setLine(i, { stone_wt: e.target.value })} /></td>
                  <td><input className="right" value={l.net_wt}
                    onChange={(e) => setLine(i, { net_wt: e.target.value })} /></td>
                  <td><input className="right" value={l.purity}
                    onChange={(e) => setLine(i, { purity: e.target.value })} /></td>
                  <td><input className="right" value={l.rate_per_gm}
                    onChange={(e) => setLine(i, { rate_per_gm: e.target.value })} /></td>
                  {isSale && (
                    <td><input className="right" value={l.mkg_per_gm}
                      onChange={(e) => setLine(i, { mkg_per_gm: e.target.value })} /></td>
                  )}
                  <td><input className="right" readOnly style={{ fontWeight: 600 }}
                    value={amt ? money(amt) : ''} /></td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <div className="row wrap" style={{ gap: 16, marginTop: 14, alignItems: 'flex-end' }}>
        <Field label="GST %">
          <Input className="right" style={{ width: 80 }} value={f.gst_pct}
            onChange={(e) => setF({ ...f, gst_pct: e.target.value })} />
        </Field>
        <Field label={isSale ? 'Refund now' : 'Cash taken back'}
          hint="Leave blank to adjust against the khata instead.">
          <Input className="right" style={{ width: 120 }}
            value={isSale ? f.refund_amount : f.received_amount}
            onChange={(e) => setF(isSale
              ? { ...f, refund_amount: e.target.value }
              : { ...f, received_amount: e.target.value })} />
        </Field>
        <span className="spacer" style={{ marginLeft: 'auto' }} />
        <div className="right">
          <div className="small muted">Goods ₹{money(goods)}{isSale && making > 0 ? ` · Making ₹${money(making)}` : ''}</div>
          <div className="small muted">GST ₹{money(gst)}</div>
          <div className="strong" style={{ fontSize: 16 }}>
            {isSale ? 'Credit to customer' : 'Debit to supplier'} ₹{money(totalAmt)}
          </div>
        </div>
      </div>
    </Modal>
  )
}
