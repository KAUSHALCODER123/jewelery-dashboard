import React, { useState } from 'react'
import { Icon } from '../lib/icons'
import { Empty, Input, Loading, useAsync } from '../lib/ui'
import { drcr, money, todayISO, wt } from '../lib/format'
import { ReportActions } from '../lib/grid'

export default function DayBook() {
  const [from, setFrom] = useState(todayISO())
  const [to, setTo] = useState(todayISO())
  const rep = useAsync(() => window.api.reports.dayBook({ from, to }), [from, to])
  const d = rep.data

  /**
   * The day-end sheet, as one flat table. A shop prints this, counts the drawer
   * against it and files it — so it carries the trading summary, the metal
   * position in all three weights, every money account and the day's takings by
   * payment mode, in the order they are read on screen.
   */
  const report = () => {
    const rows: any[][] = [
      ['Sales', money(d.sales.cash), money(d.sales.credit)],
      ['Purchases', money(d.purchases.cash), money(d.purchases.credit)],
      ['Old Gold Purchase (URD)', '', money(d.sales.urd)],
      ['Old Gold Bills', money(d.urd_bills?.paid || 0), money(d.urd_bills?.credit || 0)],
      ['Voucher Receipts', money(d.receipts.RECEIPT || 0), ''],
      ['Voucher Payments', money(d.receipts.PAYMENT || 0), ''],
      ['', '', ''],
    ]
    const weights = (title: string, list: any[]) => {
      rows.push([title, 'Opening', 'Closing'])
      for (const m of list || []) {
        rows.push([`${m.metal} — Gross Wt`, wt(m.opening.gross_wt), wt(m.closing.gross_wt)])
        rows.push([`${m.metal} — Net Wt`, wt(m.opening.net_wt), wt(m.closing.net_wt)])
        rows.push([`${m.metal} — Final Wt`, wt(m.opening.fine_wt), wt(m.closing.fine_wt)])
      }
      rows.push(['', '', ''])
    }
    weights('Stock Details', d.metals)
    weights('URD Stock Details', d.urdMetals)
    if ((d.looseItems || []).length) {
      rows.push(['Loose Lot Details', 'Opening', 'Closing'])
      for (const l of d.looseItems) rows.push([l.name, wt(l.opening), wt(l.closing)])
      rows.push(['', '', ''])
    }
    rows.push(['Cash And Bank Accounts', 'Opening', 'Closing'])
    for (const a of d.accounts || []) rows.push([a.name, money(a.opening), money(a.closing)])
    rows.push(['', '', ''])
    rows.push(['Today Received Details', '', 'Amount'])
    for (const r of d.receivedBy || []) rows.push([r.mode, '', money(r.amount)])
    return {
      baseName: `day-book-${from}`,
      title: from === to ? `Day Book — ${from}` : `Day Book — ${from} to ${to}`,
      headers: ['Particulars', 'Opening / Cash', 'Closing / Credit'],
      rows,
    }
  }

  return (
    <div className="content-narrow">
      <div className="toolbar">
        <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} style={{ width: 150 }} />
        <span className="muted">to</span>
        <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} style={{ width: 150 }} />
        <button className="btn btn-sm" onClick={() => { setFrom(todayISO()); setTo(todayISO()) }}>Today</button>
        <span className="spacer" />
        {d && <ReportActions build={report} />}
      </div>

      {rep.loading || !d ? <Loading rows={6} /> : (
        <>
          <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(4, minmax(0,1fr))' }}>
            <Tile label="Sales" value={`₹${money(d.sales.cash + d.sales.credit)}`} meta={`${d.sales.n} bills`} />
            <Tile label="Purchases" value={`₹${money(d.purchases.cash + d.purchases.credit)}`} meta={`${d.purchases.n} bills`} />
            <Tile label="Receipts" value={`₹${money(d.receipts.RECEIPT || 0)}`} meta="Money in" />
            <Tile label="Payments" value={`₹${money(d.receipts.PAYMENT || 0)}`} meta="Money out" />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            <div className="card">
              <div className="card-head"><span className="card-title">Transactions</span></div>
              <div className="card-body flush">
                <table className="data">
                  <thead><tr><th>Head</th><th className="r">Cash</th><th className="r">Credit</th></tr></thead>
                  <tbody>
                    <tr><td>Total Sales</td><td className="r num">{money(d.sales.cash)}</td><td className="r num">{money(d.sales.credit)}</td></tr>
                    <tr><td>Total Purchase</td><td className="r num">{money(d.purchases.cash)}</td><td className="r num">{money(d.purchases.credit)}</td></tr>
                    <tr><td>Old Gold Purchase (URD)</td><td className="r num">—</td><td className="r num">{money(d.sales.urd)}</td></tr>
                    <tr><td>Old Gold Bills</td><td className="r num">{money(d.urd_bills?.paid || 0)}</td><td className="r num">{money(d.urd_bills?.credit || 0)}</td></tr>
                    <tr><td>Voucher Receipt</td><td className="r num">{money(d.receipts.RECEIPT || 0)}</td><td className="r num">—</td></tr>
                    <tr><td>Voucher Payment</td><td className="r num">{money(d.receipts.PAYMENT || 0)}</td><td className="r num">—</td></tr>
                  </tbody>
                </table>
              </div>
            </div>

            <div className="card">
              <div className="card-head">
                <span className="card-title">Cash And Bank Accounts</span>
              </div>
              <div className="card-body flush">
                <table className="data">
                  <thead><tr><th>Account</th><th className="r">Opening</th><th className="r">Closing</th></tr></thead>
                  <tbody>
                    {/* Three weight pairs per metal, not one fine figure: a shop
                        counting its trays counts GROSS, so the book has to show
                        the number that can actually be checked against a count. */}
                    <MetalBlock title="Stock Details" rows={d.metals} />
                    <MetalBlock title="URD Stock Details" rows={d.urdMetals} />

                    {/* Loose lots — mani, fuli — are grams but not metal, so they
                        cannot ride in the blocks above: those are per metal and
                        their key column is fine weight, which a bead has none of.
                        They get a strip of their own, per item, which is what a
                        shop counting its bead boxes can actually check. */}
                    {!!(d.looseItems || []).length && (
                      <>
                        <Head>Loose Lot Details</Head>
                        {d.looseItems.map((l: any) => (
                          <tr key={l.item_id}>
                            <td>{l.name}</td>
                            <td className="r num">{wt(l.opening)}</td>
                            <td className="r num strong">{wt(l.closing)}</td>
                          </tr>
                        ))}
                      </>
                    )}

                    <Head>Cash And Bank Accounts</Head>
                    {(d.accounts || []).map((a: any) => (
                      <tr key={a.id}>
                        <td>{a.name}</td>
                        <td className="r num">{fmtDrCr(a.opening)}</td>
                        <td className="r num strong">{fmtDrCr(a.closing)}</td>
                      </tr>
                    ))}

                    <Head>Today Received Details</Head>
                    {!(d.receivedBy || []).length ? (
                      <tr><td colSpan={3} className="muted small">Nothing received today.</td></tr>
                    ) : (
                      <>
                        {d.receivedBy.map((r: any) => (
                          <tr key={r.mode}>
                            <td>{r.mode}</td>
                            <td className="r num muted">—</td>
                            <td className="r num strong">{money(r.amount)}</td>
                          </tr>
                        ))}
                        <tr>
                          <td className="strong">Total Received</td>
                          <td></td>
                          <td className="r num strong gold">
                            {money(d.receivedBy.reduce((s: number, r: any) => s + r.amount, 0))}
                          </td>
                        </tr>
                      </>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

/** A full-width section heading inside the position table. */
function Head({ children }: { children: React.ReactNode }) {
  return (
    <tr>
      <td colSpan={3} className="strong" style={{ background: 'var(--surface-3)' }}>
        {children}
      </td>
    </tr>
  )
}

/**
 * One metal's opening and closing position, in all three weights.
 *
 * Gross is what is physically on the shelf, net is that less stones, and fine is
 * the pure metal in it. The original shows all three because a physical count
 * produces gross — a book that only reported fine could never be reconciled
 * against the tray it came from.
 */
function MetalBlock({ title, rows }: { title: string; rows: any[] }) {
  if (!rows?.length) {
    return (
      <>
        <Head>{title}</Head>
        <tr><td colSpan={3} className="muted small">No stock in this period.</td></tr>
      </>
    )
  }
  return (
    <>
      <Head>{title}</Head>
      {rows.map((m) => (
        <React.Fragment key={m.metal}>
          <tr>
            <td className="strong" colSpan={3} style={{ paddingBottom: 0 }}>{m.metal} :-</td>
          </tr>
          {([
            ['Gross Wt', 'gross_wt'],
            ['Net Wt', 'net_wt'],
            ['Final Wt', 'fine_wt'],
          ] as const).map(([label, key]) => (
            <tr key={key}>
              <td className="muted" style={{ paddingLeft: 22 }}>{label}</td>
              <td className="r num">{wt(m.opening[key])}</td>
              <td className={`r num ${key === 'fine_wt' ? 'strong' : ''}`}>{wt(m.closing[key])}</td>
            </tr>
          ))}
        </React.Fragment>
      ))}
    </>
  )
}

function fmtDrCr(v: number) {
  const b = drcr(v)
  return b.side ? `${b.text} ${b.side}` : '0.00'
}

function Tile({ label, value, meta }: { label: string; value: string; meta: string }) {
  return (
    <div className="stat">
      <div className="stat-label">{label}</div>
      <div className="stat-value num">{value}</div>
      <div className="stat-meta">{meta}</div>
    </div>
  )
}
