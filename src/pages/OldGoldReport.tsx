import React, { useState } from 'react'
import { Icon } from '../lib/icons'
import { Empty, Input, Loading, Segmented, useAsync, useDebounced } from '../lib/ui'
import { ReportActions } from '../lib/grid'
import { dmy, money, monthStartISO, todayISO, wt } from '../lib/format'

/** 1 April of whichever financial year the given date falls in. */
function fyStart(iso: string) {
  const d = new Date(iso)
  const y = d.getMonth() + 1 >= 4 ? d.getFullYear() : d.getFullYear() - 1
  return `${y}-04-01`
}

const SOURCE_LABEL: Record<string, string> = { SALE: 'On sale bill', URD: 'Old gold bill' }

/**
 * Old Gold report — every gram of old gold the shop took in over a period,
 * whether exchanged on a sale bill or bought outright on an old gold bill,
 * with what was paid for it and what it works out to per fine gram. The
 * strip at the top also shows how much URD gold is still in the safe.
 */
export default function OldGoldReport({ go }: { go: (n: string, p?: any) => void }) {
  const today = todayISO()
  const [from, setFrom] = useState(monthStartISO())
  const [to, setTo] = useState(today)
  const [search, setSearch] = useState('')
  const [source, setSource] = useState<'ALL' | 'SALE' | 'URD'>('ALL')
  const q = useDebounced(search, 250)

  const rep = useAsync(() => window.api.reports.oldGold({ from, to, search: q }), [from, to, q])
  const d = rep.data
  const rows: any[] = (d?.rows || []).filter((r: any) => source === 'ALL' || r.source === source)
  const tot = !d ? null : source === 'ALL' ? d.totals : d.bySource[source]

  const report = () => ({
    baseName: `old-gold-${from}-to-${to}`,
    title: 'Old Gold Report',
    meta: `${dmy(from)} to ${dmy(to)}${source !== 'ALL' ? ` · ${SOURCE_LABEL[source]}` : ''}`,
    headers: ['Date', 'Bill', 'Source', 'Customer', 'Item', 'Gross Wt', 'Net Wt', 'Purity', 'Fine Wt', 'Rate/g', 'Amount'],
    rows: [
      ...rows.map((r) => [
        dmy(r.date), r.doc_no, SOURCE_LABEL[r.source], r.party_name || 'Cash customer',
        [r.name, r.description].filter(Boolean).join(' — '),
        wt(r.gross_wt), wt(r.net_wt), money(r.purity), wt(r.final_wt), money(r.rate), money(r.amount),
      ]),
      ...(tot ? [['', '', '', `Total · ${tot.bills} bills`, `${tot.lines} lines`,
        wt(tot.gross_wt), wt(tot.net_wt), '', wt(tot.fine_wt), money(tot.avg_rate), money(tot.amount)]] : []),
    ],
  })

  const open = (r: any) => {
    if (r.source === 'SALE' && r.sale_id) go('sales.new', { id: r.sale_id })
    else if (r.urd_bill_id) go('oldgold', { id: r.urd_bill_id })
  }

  return (
    <div>
      <div className="toolbar">
        <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} style={{ width: 150 }} />
        <span className="muted">to</span>
        <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} style={{ width: 150 }} />
        <button className="btn btn-sm" onClick={() => { setFrom(monthStartISO()); setTo(today) }}>This month</button>
        <button className="btn btn-sm" onClick={() => { setFrom(fyStart(today)); setTo(today) }}>This FY</button>
        <Segmented value={source} onChange={(v) => setSource(v as any)}
          options={[
            { value: 'ALL', label: 'All' },
            { value: 'SALE', label: 'On sale bills' },
            { value: 'URD', label: 'Old gold bills' },
          ]} />
        <div className="search-box">
          <Icon.search />
          <input className="input" placeholder="Bill no or customer…" value={search}
            onChange={(e) => setSearch(e.target.value)} />
        </div>
        <span className="spacer" />
        {d && <ReportActions build={report} />}
      </div>

      {rep.loading || !d || !tot ? <Loading rows={6} /> : (
        <>
          <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(5, minmax(0,1fr))' }}>
            <div className="stat">
              <div className="stat-label">Old Gold Taken In</div>
              <div className="stat-value num">{wt(tot.fine_wt)} g</div>
              <div className="stat-meta">fine · {wt(tot.gross_wt)} g gross · {tot.bills} bills</div>
            </div>
            <div className="stat">
              <div className="stat-label">Old Gold Total (paid)</div>
              <div className="stat-value num">₹{money(tot.amount)}</div>
              <div className="stat-meta">avg ₹{money(tot.avg_rate)} per fine gram</div>
            </div>
            <div className="stat">
              <div className="stat-label">On Sale Bills</div>
              <div className="stat-value num">{wt(d.bySource.SALE.fine_wt)} g</div>
              <div className="stat-meta">₹{money(d.bySource.SALE.amount)} · {d.bySource.SALE.bills} bills</div>
            </div>
            <div className="stat">
              <div className="stat-label">On Old Gold Bills</div>
              <div className="stat-value num">{wt(d.bySource.URD.fine_wt)} g</div>
              <div className="stat-meta">₹{money(d.bySource.URD.amount)} · {d.bySource.URD.bills} bills</div>
            </div>
            <div className="stat">
              <div className="stat-label">URD Gold in Safe Now</div>
              <div className="stat-value num" style={{ color: 'var(--gold-ink)' }}>{wt(d.stock.fine_on_hand)} g</div>
              <div className="stat-meta">fine · {wt(d.stock.gross_on_hand)} g gross · all time</div>
            </div>
          </div>

          <div className="card" style={{ marginBottom: 14 }}>
            <div className="card-head">
              <span className="card-title">Old Gold Received</span>
              <span className="muted small" style={{ marginLeft: 8 }}>{dmy(from)} – {dmy(to)}</span>
              <span className="badge badge-gold" style={{ marginLeft: 'auto' }}>{wt(tot.fine_wt)} g · ₹{money(tot.amount)}</span>
            </div>
            <div className="card-body flush">
              {!rows.length ? (
                <Empty icon={Icon.refine} title="No old gold taken in this period">
                  Old gold comes in on a sale bill (Add old gold) or on an Old Gold Purchase bill of its own.
                </Empty>
              ) : (
                <div className="table-wrap">
                  <table className="data">
                    <thead>
                      <tr>
                        <th>Date</th><th>Bill</th><th>Source</th><th>Customer</th><th>Item</th>
                        <th className="r">Gross</th><th className="r">Net</th><th className="r">Purity</th>
                        <th className="r">Fine</th><th className="r">Rate/g</th><th className="r">Amount</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((r) => (
                        <tr key={r.id} className="clickable" onClick={() => open(r)}>
                          <td>{dmy(r.date)}</td>
                          <td className="mono strong">{r.doc_no}</td>
                          <td><span className={`badge ${r.source === 'URD' ? 'badge-gold' : 'badge-info'}`}>
                            {SOURCE_LABEL[r.source]}</span></td>
                          <td>{r.party_name || <span className="muted">Cash customer</span>}</td>
                          <td>{r.name}{r.description ? <span className="muted small"> · {r.description}</span> : null}</td>
                          <td className="r num">{wt(r.gross_wt)}</td>
                          <td className="r num">{wt(r.net_wt)}</td>
                          <td className="r num">{money(r.purity)}</td>
                          <td className="r num strong">{wt(r.final_wt)}</td>
                          <td className="r num">{money(r.rate)}</td>
                          <td className="r num strong">₹{money(r.amount)}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr>
                        <td colSpan={4}>Total · {tot.bills} bills</td>
                        <td>{tot.lines} lines</td>
                        <td className="r num">{wt(tot.gross_wt)}</td>
                        <td className="r num">{wt(tot.net_wt)}</td>
                        <td></td>
                        <td className="r num">{wt(tot.fine_wt)}</td>
                        <td className="r num">{money(tot.avg_rate)}</td>
                        <td className="r num">₹{money(tot.amount)}</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}
            </div>
          </div>

          {d.byMonth.length > 1 && (
            <div className="card">
              <div className="card-head"><span className="card-title">Month by Month</span></div>
              <div className="card-body flush">
                <table className="data">
                  <thead>
                    <tr><th>Month</th><th className="r">Bills</th><th className="r">Gross Wt</th>
                      <th className="r">Fine Wt</th><th className="r">Avg Rate/g</th><th className="r">Amount</th></tr>
                  </thead>
                  <tbody>
                    {d.byMonth.map((m: any) => (
                      <tr key={m.month}>
                        <td className="strong">{m.month}</td>
                        <td className="r num">{m.bills}</td>
                        <td className="r num">{wt(m.gross_wt)}</td>
                        <td className="r num">{wt(m.fine_wt)}</td>
                        <td className="r num">{money(m.avg_rate)}</td>
                        <td className="r num strong">₹{money(m.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
