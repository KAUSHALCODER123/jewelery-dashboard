import React, { useState } from 'react'
import { Icon } from '../lib/icons'
import { ReportActions } from '../lib/grid'
import { Input, Loading, Segmented, useAsync } from '../lib/ui'
import { dmy, money, todayISO } from '../lib/format'

function fyStart(iso: string) {
  const d = new Date(iso)
  const y = d.getMonth() + 1 >= 4 ? d.getFullYear() : d.getFullYear() - 1
  return `${y}-04-01`
}

type Tab = 'gstr1' | 'gstr2' | 'gstr3b' | 'hsn' | 'tcstds'

export default function GstReports() {
  const [tab, setTab] = useState<Tab>('gstr1')
  const today = todayISO()
  const [from, setFrom] = useState(fyStart(today))
  const [to, setTo] = useState(today)

  return (
    <div className="content-narrow">
      <div className="toolbar" style={{ paddingBottom: 0, border: 0 }}>
        <Segmented value={tab} onChange={(v) => setTab(v as Tab)}
          options={[
            { value: 'gstr1', label: 'GSTR-1 (Sales)' },
            { value: 'gstr2', label: 'GSTR-2 (Purchases)' },
            { value: 'gstr3b', label: 'GSTR-3B' },
            { value: 'hsn', label: 'HSN Summary' },
            { value: 'tcstds', label: 'TCS / TDS' },
          ]} />
      </div>
      <div className="toolbar">
        <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} style={{ width: 150 }} />
        <span className="muted">to</span>
        <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} style={{ width: 150 }} />
        <button className="btn btn-sm" onClick={() => { setFrom(fyStart(today)); setTo(today) }}>This FY</button>
        <span className="spacer" />
      </div>

      {tab === 'gstr1' && <Return key="out" direction="OUT" from={from} to={to} />}
      {tab === 'gstr2' && <Return key="in" direction="IN" from={from} to={to} />}
      {tab === 'gstr3b' && <Summary3B from={from} to={to} />}
      {tab === 'hsn' && <Hsn from={from} to={to} />}
      {tab === 'tcstds' && <TcsTds from={from} to={to} />}
    </div>
  )
}

function Tile({ label, value, meta }: { label: string; value: string; meta?: string }) {
  return (
    <div className="stat">
      <div className="stat-label">{label}</div>
      <div className="stat-value num">{value}</div>
      {meta && <div className="stat-meta">{meta}</div>}
    </div>
  )
}

/* ─────────────────── GSTR-1 / GSTR-2 (outward / inward) ─────────────────── */

function Return({ direction, from, to }: { direction: 'OUT' | 'IN'; from: string; to: string }) {
  const rep = useAsync(() => window.api.reports.gstReturn({ direction, from, to }), [direction, from, to])
  const d = rep.data
  if (rep.loading || !d) return <Loading rows={8} />

  const outward = direction === 'OUT'
  const report = () => ({
    baseName: `${outward ? 'gstr1' : 'gstr2'}-${to}`, title: 'GSTR — Return',
    headers: ['Date', 'Document', 'Party', 'GSTIN', 'Place of supply', 'Taxable', 'CGST', 'SGST', 'IGST', 'Total'],
    rows: [
        ...d.rows.map((r: any) => [dmy(r.date), r.doc_no, r.party_name, r.gstin || '', r.place_of_supply,
          r.taxable, r.cgst, r.sgst, r.igst, r.total]),
        ['', '', 'Total', '', '', d.totals.taxable, d.totals.cgst, d.totals.sgst, d.totals.igst, d.totals.total],
      ],
  })

  return (
    <>
      <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(3, minmax(0,1fr))' }}>
        <Tile label={outward ? 'B2B (registered)' : 'From registered'} value={`₹${money(d.b2b.taxable)}`} meta={`${d.b2b.count} bills · tax ₹${money(d.b2b.gst)}`} />
        <Tile label={outward ? 'B2C (counter)' : 'From unregistered'} value={`₹${money(d.b2c.taxable)}`} meta={`${d.b2c.count} bills · tax ₹${money(d.b2c.gst)}`} />
        <Tile label="Total tax" value={`₹${money(d.totals.gst)}`} meta={`taxable ₹${money(d.totals.taxable)}`} />
      </div>
      <div className="card">
        <div className="card-head">
          <span className="card-title">{outward ? 'GSTR-1 — Outward supplies' : 'GSTR-2 — Inward supplies'}</span>
          <span className="spacer" />
          <ReportActions build={report} />
        </div>
        <div className="card-body flush">
          <table className="data">
            <thead>
              <tr><th>Date</th><th>Document</th><th>Party</th><th>Place</th>
                <th className="r">Taxable</th><th className="r">CGST</th><th className="r">SGST</th>
                <th className="r">IGST</th><th className="r">Total</th></tr>
            </thead>
            <tbody>
              {d.rows.map((r: any, i: number) => (
                <tr key={i}>
                  <td>{dmy(r.date)}</td>
                  <td className="mono">{r.doc_no}</td>
                  <td>{r.party_name || <span className="muted">Counter</span>}
                    <span className="badge badge-mute" style={{ marginLeft: 6 }}>{r.segment}</span></td>
                  <td>{r.place_of_supply}</td>
                  <td className="r num">{money(r.taxable)}</td>
                  <td className="r num">{r.cgst ? money(r.cgst) : '—'}</td>
                  <td className="r num">{r.sgst ? money(r.sgst) : '—'}</td>
                  <td className="r num">{r.igst ? money(r.igst) : '—'}</td>
                  <td className="r num strong">{money(r.total)}</td>
                </tr>
              ))}
              {d.rows.length === 0 && (
                <tr><td colSpan={9} className="muted" style={{ textAlign: 'center', padding: 16 }}>No taxable supplies in this period</td></tr>
              )}
            </tbody>
            <tfoot>
              <tr className="strong" style={{ borderTop: '2px solid var(--border)' }}>
                <td colSpan={4}>Total</td>
                <td className="r num">{money(d.totals.taxable)}</td>
                <td className="r num">{money(d.totals.cgst)}</td>
                <td className="r num">{money(d.totals.sgst)}</td>
                <td className="r num">{money(d.totals.igst)}</td>
                <td className="r num">{money(d.totals.total)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    </>
  )
}

/* ───────────────────────────── GSTR-3B ───────────────────────────── */

function Summary3B({ from, to }: { from: string; to: string }) {
  const rep = useAsync(() => window.api.reports.gstSummary({ from, to }), [from, to])
  const d = rep.data
  if (rep.loading || !d) return <Loading rows={6} />

  return (
    <>
      <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(2, minmax(0,1fr))' }}>
        <Tile label="Output tax (on sales)" value={`₹${money(d.output_tax)}`} />
        <Tile label="Input tax credit (on buys)" value={`₹${money(d.input_tax)}`} />
        <Tile label="Net GST payable" value={`₹${money(d.net_payable)}`}
          meta={d.credit_carried > 0 ? `credit carried forward ₹${money(d.credit_carried)}` : 'to deposit this period'} />
        <Tile label="TCS + TDS withheld" value={`₹${money(d.tcs_collected + d.tds_deducted)}`}
          meta={`TCS ₹${money(d.tcs_collected)} · TDS ₹${money(d.tds_deducted)}`} />
      </div>
      <div className="card">
        <div className="card-head"><span className="card-title">GSTR-3B — monthly summary</span></div>
        <div className="card-body flush">
          <table className="data">
            <tbody>
              <tr><td>Output tax on outward supplies</td><td className="r num">{money(d.output_tax)}</td></tr>
              <tr><td>Less: input tax credit on inward supplies</td><td className="r num">− {money(d.input_tax)}</td></tr>
              <tr className="strong" style={{ borderTop: '2px solid var(--border)' }}>
                <td>{d.net_payable > 0 ? 'Net tax payable in cash' : 'Credit carried forward'}</td>
                <td className="r num">{money(d.net_payable > 0 ? d.net_payable : d.credit_carried)}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div className="card-foot muted" style={{ padding: '8px 14px', fontSize: 12 }}>
          These match the GST line in the Accounting Books. TCS and TDS are shown separately —
          they are collected/withheld on behalf of the department, not your own tax.
        </div>
      </div>
    </>
  )
}

/* ───────────────────────────── HSN summary ───────────────────────────── */

function Hsn({ from, to }: { from: string; to: string }) {
  const rep = useAsync(() => window.api.reports.hsnSummary({ from, to }), [from, to])
  const d = rep.data
  if (rep.loading || !d) return <Loading rows={6} />

  const report = () => ({
    baseName: `hsn-summary-${to}`, title: 'HSN Summary',
    headers: ['HSN', 'Lines', 'Qty', 'Taxable', 'Tax'],
    rows: [...d.rows.map((r: any) => [r.hsn, r.lines, r.qty, r.taxable, r.tax]),
        ['Total', '', '', d.totals.taxable, d.totals.tax]],
  })

  return (
    <div className="card">
      <div className="card-head">
        <span className="card-title">HSN-wise summary (sales)</span>
        <span className="spacer" />
        <ReportActions build={report} />
      </div>
      <div className="card-body flush">
        <table className="data">
          <thead>
            <tr><th>HSN</th><th className="r">Lines</th><th className="r">Qty</th>
              <th className="r">Taxable</th><th className="r">Tax</th></tr>
          </thead>
          <tbody>
            {d.rows.map((r: any, i: number) => (
              <tr key={i}>
                <td className="mono">{r.hsn}</td>
                <td className="r num">{r.lines}</td>
                <td className="r num">{r.qty || '—'}</td>
                <td className="r num">{money(r.taxable)}</td>
                <td className="r num">{money(r.tax)}</td>
              </tr>
            ))}
            {d.rows.length === 0 && (
              <tr><td colSpan={5} className="muted" style={{ textAlign: 'center', padding: 16 }}>No sales in this period</td></tr>
            )}
          </tbody>
          <tfoot>
            <tr className="strong" style={{ borderTop: '2px solid var(--border)' }}>
              <td colSpan={3}>Total</td>
              <td className="r num">{money(d.totals.taxable)}</td>
              <td className="r num">{money(d.totals.tax)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  )
}

/* ───────────────────────────── TCS / TDS ───────────────────────────── */

function TcsTds({ from, to }: { from: string; to: string }) {
  const rep = useAsync(() => window.api.reports.tcsTds({ from, to }), [from, to])
  const d = rep.data
  if (rep.loading || !d) return <Loading rows={6} />

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
      <WithholdTable title="TCS collected on sales" rows={d.tcs} total={d.tcsTotal} />
      <WithholdTable title="TDS deducted from karagir labour" rows={d.tds} total={d.tdsTotal} />
    </div>
  )
}

function WithholdTable({ title, rows, total }: { title: string; rows: any[]; total: number }) {
  return (
    <div className="card">
      <div className="card-head"><span className="card-title">{title}</span></div>
      <div className="card-body flush">
        <table className="data">
          <thead>
            <tr><th>Date</th><th>Document</th><th>Party</th><th className="r">%</th><th className="r">Amount</th></tr>
          </thead>
          <tbody>
            {rows.map((r: any, i: number) => (
              <tr key={i}>
                <td>{dmy(r.date)}</td>
                <td className="mono">{r.doc_no}</td>
                <td>{r.party_name || '—'}</td>
                <td className="r num">{r.tcs_pct ?? r.tds_pct}</td>
                <td className="r num">{money(r.amount)}</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr><td colSpan={5} className="muted" style={{ textAlign: 'center', padding: 16 }}>Nothing withheld</td></tr>
            )}
          </tbody>
          {rows.length > 0 && (
            <tfoot>
              <tr className="strong" style={{ borderTop: '2px solid var(--border)' }}>
                <td colSpan={4}>Total</td><td className="r num">{money(total)}</td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  )
}
