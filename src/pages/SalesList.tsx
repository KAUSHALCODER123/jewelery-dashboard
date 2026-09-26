import React, { useState } from 'react'
import { Icon } from '../lib/icons'
import { Empty, Input, Loading, useAsync, useDebounced } from '../lib/ui'
import { dmy, money, monthStartISO, toCsv, todayISO } from '../lib/format'
import { buildInvoice, billMessage, printInvoice } from '../lib/printing'

export default function SalesList({ go }: { go: (n: string, p?: any) => void }) {
  const [from, setFrom] = useState(monthStartISO())
  const [to, setTo] = useState(todayISO())
  const [search, setSearch] = useState('')
  const q = useDebounced(search, 250)

  const list = useAsync(() => window.api.sale.list({ from, to, search: q }), [from, to, q])

  const rows = list.data || []
  const total = rows.reduce((s: number, r: any) => s + (Number(r.total_amount) || 0), 0)
  const due = rows.reduce((s: number, r: any) => s + (Number(r.net_balance) || 0), 0)

  const print = async (id: number) => { await printInvoice(id) }

  const whatsapp = async (id: number) => {
    const b = await buildInvoice(id)
    if (!b) return
    const mobile = b.data.sale.mobile || b.data.party?.whatsapp || b.data.party?.mobile
    await window.api.send.whatsapp({ mobile, text: billMessage(b.data) })
  }

  const exportCsv = async () => {
    const csv = toCsv(
      ['Bill No', 'Date', 'Customer', 'Mode', 'Bill Amount', 'GST', 'Old Gold', 'Total', 'Received', 'Balance'],
      rows.map((r: any) => [
        r.prefix + r.bill_no, r.bill_date, r.party_name, r.is_credit ? 'Credit' : 'Cash',
        r.bill_amount, r.gst_amount, r.urd_amount, r.total_amount, r.amount_received, r.net_balance,
      ])
    )
    await window.api.file.saveText({ content: csv, suggestedName: 'sales-register.csv' })
  }

  return (
    <div>
      <div className="toolbar">
        <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} style={{ width: 150 }} />
        <span className="muted">to</span>
        <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} style={{ width: 150 }} />
        <div className="search-box">
          <Icon.search />
          <input className="input" placeholder="Bill no, customer or mobile…" value={search}
            onChange={(e) => setSearch(e.target.value)} />
        </div>
        <span className="spacer" />
        <button className="btn btn-sm" onClick={exportCsv}><Icon.download /> Export</button>
        <button className="btn btn-primary" onClick={() => go('sales.new')}><Icon.plus /> New Bill</button>
      </div>

      <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(3, minmax(0,1fr))' }}>
        <div className="stat"><div className="stat-label">Bills</div><div className="stat-value num">{rows.length}</div></div>
        <div className="stat"><div className="stat-label">Total Sales</div><div className="stat-value num">₹{money(total)}</div></div>
        <div className="stat"><div className="stat-label">Outstanding</div>
          <div className="stat-value num" style={{ color: due > 0 ? 'var(--danger)' : undefined }}>₹{money(due)}</div></div>
      </div>

      <div className="card">
        <div className="card-body flush">
          {list.loading ? <Loading /> : !rows.length ? (
            <Empty icon={Icon.invoice} title="No bills in this period"
              action={<button className="btn btn-primary btn-sm" onClick={() => go('sales.new')}>Create a bill</button>} />
          ) : (
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th>Bill No</th><th>Date</th><th>Customer</th><th>Mode</th>
                    <th className="r">Bill Amt</th><th className="r">GST</th><th className="r">Old Gold</th>
                    <th className="r">Total</th><th className="r">Balance</th><th></th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r: any) => (
                    <tr key={r.id} className="clickable" onClick={() => go('sales.new', { id: r.id })}>
                      <td className="mono strong">{r.bill_no}</td>
                      <td>{dmy(r.bill_date)}</td>
                      <td>{r.party_name || <span className="muted">Counter</span>}</td>
                      <td><span className={`badge ${r.is_credit ? 'badge-warn' : 'badge-ok'}`}>
                        {r.is_credit ? 'Credit' : 'Cash'}</span></td>
                      <td className="r num">{money(r.bill_amount)}</td>
                      <td className="r num">{money(r.gst_amount)}</td>
                      <td className="r num">{r.urd_amount ? money(r.urd_amount) : '—'}</td>
                      <td className="r num strong">₹{money(r.total_amount)}</td>
                      <td className="r num">{Number(r.net_balance) > 0
                        ? <span className="danger strong">{money(r.net_balance)}</span>
                        : <span className="ok">Settled</span>}</td>
                      <td className="r" onClick={(e) => e.stopPropagation()}>
                        <button className="btn btn-ghost btn-icon btn-sm" title="Print" onClick={() => print(r.id)}>
                          <Icon.print />
                        </button>
                        <button className="btn btn-ghost btn-icon btn-sm" title="Send on WhatsApp"
                          onClick={() => whatsapp(r.id)}><Icon.whatsapp /></button>
                        <button className="btn btn-ghost btn-icon btn-sm" title="Return goods from this bill"
                          onClick={() => go('returns', { saleId: r.id })}><Icon.back /></button>
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={7}>Total · {rows.length} bills</td>
                    <td className="r num">₹{money(total)}</td>
                    <td className="r num">₹{money(due)}</td>
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
