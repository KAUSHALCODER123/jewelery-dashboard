import React, { useState } from 'react'
import { Icon } from '../lib/icons'
import { Empty, Field, Input, Loading, Segmented, Select, useAsync } from '../lib/ui'
import { ReportActions } from '../lib/grid'
import { dmy, money, todayISO, wt } from '../lib/format'
import { num } from '../lib/calc'

/**
 * MIS and Gold Scheme reports — the questions an owner asks that the daily
 * screens cannot answer.
 *
 * Everything here is read-only and derived on demand; nothing is cached, so a
 * figure can never be stale relative to the books it came from.
 */
export default function MisReports() {
  const [tab, setTab] = useState<'mis' | 'scheme'>('mis')
  return (
    <div>
      <div className="tabs">
        <button className="tab" aria-selected={tab === 'mis'} onClick={() => setTab('mis')}>
          MIS
        </button>
        <button className="tab" aria-selected={tab === 'scheme'} onClick={() => setTab('scheme')}>
          Gold Scheme Reports
        </button>
      </div>
      {tab === 'mis' ? <Mis /> : <SchemeReports />}
    </div>
  )
}

/** 1 April of whichever financial year the given date falls in. */
function fyStart(iso: string) {
  const d = new Date(iso)
  const y = d.getMonth() + 1 >= 4 ? d.getFullYear() : d.getFullYear() - 1
  return `${y}-04-01`
}

function Mis() {
  const [days, setDays] = useState('90')
  const [view, setView] = useState('nonMoving')
  // Profit is a question about a period — "how did this year go?" — so the
  // window opens on the current financial year, the same one the Profit & Loss
  // account uses. The stock and customer views ignore it: a piece sitting
  // unsold, or a customer gone quiet, is a fact about today, not about a year.
  const today = todayISO()
  const [from, setFrom] = useState(fyStart(today))
  const [to, setTo] = useState(today)
  const rep = useAsync(
    () => window.api.reports.mis({ from, to, days: num(days) || 90 }),
    [from, to, days]
  )
  const d = rep.data
  const dated = view === 'purityProfit' || view === 'itemProfit'
    || view === 'topItems' || view === 'topAreas'

  const VIEWS: Record<string, { label: string; note: string }> = {
    nonMoving: { label: 'Non-Moving Items', note: 'In stock and untouched since the cutoff' },
    dormant: { label: 'Quiet Customers', note: 'Bought before, but not since the cutoff' },
    topItems: { label: 'Top Selling Items', note: 'By value billed' },
    topAreas: { label: 'Top Areas', note: 'By value billed' },
    purityProfit: { label: 'Purity Profit', note: 'Revenue against cost, per purity' },
    itemProfit: { label: 'Item-wise Profit', note: 'Every sold piece — bought for, sold for' },
  }

  const exportData = () => {
    const H: Record<string, string[]> = {
      nonMoving: ['Tag', 'Item', 'Group', 'Tagged On', 'Age (days)', 'Gross Wt', 'Fine Wt', 'Cost/Gm', 'Value at Cost'],
      dormant: ['Customer', 'Mobile', 'Last Bill', 'Quiet (days)', 'Bills', 'Lifetime Value'],
      topItems: ['Item', 'Lines', 'Net Wt', 'Amount'],
      topAreas: ['Area', 'Bills', 'Amount'],
      purityProfit: ['Purity', 'Pieces', 'Revenue', 'Cost', 'Profit', 'Margin %'],
      itemProfit: ['Bill', 'Date', 'Customer', 'Tag', 'Item', 'Purity', 'Fine Wt',
        'Cost/Gm', 'Cost', 'Sold For', 'Profit', 'Margin %', 'Days Held'],
    }
    const R: Record<string, any[][]> = {
      nonMoving: (d?.nonMoving || []).map((r: any) => [r.tag, r.item_name, r.group_name, r.entry_date, r.age_days, r.gross_wt, r.final_wt, r.purchase_rate, r.cost_value]),
      dormant: (d?.dormant || []).map((r: any) => [r.name, r.mobile, r.last_bill, r.quiet_days, r.bills, r.lifetime]),
      topItems: (d?.topItems || []).map((r: any) => [r.item_name, r.lines, r.net_wt, r.amount]),
      topAreas: (d?.topAreas || []).map((r: any) => [r.area, r.bills, r.amount]),
      purityProfit: (d?.purityProfit || []).map((r: any) => [r.purity, r.pieces, r.revenue, r.cost, r.profit, r.margin_pct]),
      itemProfit: (d?.itemProfit || []).map((r: any) => [r.bill_no, dmy(r.bill_date), r.party_name,
        r.tag, r.item_name, r.purity, r.fine_wt, r.cost_rate, r.cost, r.revenue,
        r.profit, r.margin_pct, r.days_held]),
    }
    return {
      baseName: `mis-${view}`, title: VIEWS[view].label,
      meta: dated ? `${from} to ${to}` : `Cutoff ${d?.range?.cutoff ?? ''} · ${days} days`,
      headers: H[view], rows: R[view],
    }
  }

  if (rep.loading || !d) return <Loading rows={6} />
  const rows: any[] = (d as any)[view] || []

  return (
    <div>
      <div className="toolbar">
        <Select value={view} onChange={setView}
          options={Object.entries(VIEWS).map(([k, v]) => ({ value: k, label: v.label }))} />
        {dated ? (
          <>
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)}
              style={{ width: 150 }} />
            <span className="muted">to</span>
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)}
              style={{ width: 150 }} />
            <button className="btn btn-sm"
              onClick={() => { setFrom(fyStart(today)); setTo(today) }}>This FY</button>
            <button className="btn btn-sm"
              onClick={() => {
                const y = Number(fyStart(today).slice(0, 4))
                setFrom(`${y - 1}-04-01`); setTo(`${y}-03-31`)
              }}>
              Last FY
            </button>
          </>
        ) : (
          <Field label="">
            <div className="row" style={{ gap: 6, alignItems: 'center' }}>
              <span className="small muted">Quiet after</span>
              <Input className="right" style={{ width: 70 }} value={days}
                onChange={(e) => setDays(e.target.value)} />
              <span className="small muted">days</span>
            </div>
          </Field>
        )}
        <span className="spacer" />
        <ReportActions build={exportData} />
      </div>

      <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(4, minmax(0,1fr))' }}>
        <div className="stat"><div className="stat-label">Non-Moving Pieces</div>
          <div className="stat-value num">{d.nonMoving.length}</div>
          <div className="stat-meta">₹{money(d.nonMovingValue)} tied up at cost</div></div>
        <div className="stat"><div className="stat-label">Quiet Customers</div>
          <div className="stat-value num">{d.dormant.length}</div>
          <div className="stat-meta">No bill since {dmy(d.range.cutoff)}</div></div>
        <div className="stat"><div className="stat-label">Profit at Cost</div>
          <div className="stat-value num gold">
            ₹{money(d.purityProfit.reduce((s: number, r: any) => s + num(r.profit), 0))}
          </div>
          <div className="stat-meta">{dmy(from)} — {dmy(to)} · pieces with a cost recorded</div></div>
        <div className="stat"><div className="stat-label">Excluded from Margin</div>
          <div className="stat-value num">{d.uncostedSold}</div>
          <div className="stat-meta">Sold with no cost recorded</div></div>
      </div>

      {d.uncostedSold > 0 && (
        <div className="note" style={{ marginBottom: 12 }}>
          {d.uncostedSold} sold {d.uncostedSold === 1 ? 'piece has' : 'pieces have'} no
          <b> Cost/Gm</b> recorded, so {d.uncostedSold === 1 ? 'it is' : 'they are'} left out of
          the profit figures entirely rather than counted as costing nothing. Fill the cost in on
          the Stock Report to bring {d.uncostedSold === 1 ? 'it' : 'them'} into the margin.
        </div>
      )}

      <div className="card">
        <div className="card-head">
          <span className="card-title">{VIEWS[view].label}</span>
          <span className="hint" style={{ marginLeft: 'auto' }}>
            {VIEWS[view].note}{dated ? ` · ${dmy(from)} to ${dmy(to)}` : ''}
          </span>
        </div>
        <div className="card-body flush">
          {!rows.length ? (
            <Empty icon={Icon.report} title="Nothing to show">
              Either there is no data in this window, or there is nothing to worry about.
            </Empty>
          ) : (
            <div className="table-wrap">
              <table className="data">
                <thead><tr>{exportData().headers.map((h) => (
                  <th key={h} className={/Wt|Amount|Value|Cost|Profit|%|days|Days|Sold For|Bills|Lines|Pieces|Age/.test(h) ? 'r' : ''}>{h}</th>
                ))}</tr></thead>
                <tbody>
                  {exportData().rows.map((r, i) => (
                    <tr key={i}>
                      {r.map((c, j) => (
                        <td key={j} className={typeof c === 'number' ? 'r num' : ''}>
                          {typeof c === 'number' ? money(c) : (c ?? '—')}
                        </td>
                      ))}
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

function SchemeReports() {
  const [kind, setKind] = useState('allocated')
  const rep = useAsync(() => window.api.reports.schemeReport({ kind }), [kind])
  const rows: any[] = rep.data?.rows || []

  const COLS: Record<string, { headers: string[]; row: (r: any) => any[] }> = {
    master: {
      headers: ['Code', 'Scheme', 'Type', 'Period', 'Paying', 'Total', 'Per Period', 'Benefit', 'Members'],
      row: (r) => [r.code, r.name, r.scheme_type, r.period_unit, r.paying_periods, r.total_periods,
        r.scheme_type === 'Weight Wise' ? `${r.monthly_weight} g` : r.monthly_amount,
        r.scheme_type === 'On Weight' || r.scheme_type === 'Weight Wise'
          ? `${r.bonus_weight} g`
          : r.scheme_type === 'On Making' ? `${r.making_disc_pct}% making` : r.maturity_bonus,
        r.members],
    },
    allocated: {
      headers: ['G.S. No', 'Member', 'Scheme', 'Type', 'Start', 'Maturity', 'Paid', 'Due', 'Paid ₹', 'Accrued g', 'Balance ₹', 'Balance g', 'Status'],
      row: (r) => [r.gs_no, r.party_name, r.scheme_name, r.scheme_type, r.start_date, r.maturity_date,
        r.paid_count, r.pending_count, r.paid_amount, r.paid_weight, r.balance_amount, r.balance_weight,
        r.closed ? 'Closed' : r.matured ? 'Matured' : 'Running'],
    },
    pending: {
      headers: ['G.S. No', 'Member', 'Mobile', 'Scheme', 'Due Date', 'Amount', 'Weight'],
      row: (r) => [r.gs_no, r.party_name, r.mobile, r.scheme_name, r.due_date, r.amount, r.weight],
    },
    received: {
      headers: ['Receipt', 'G.S. No', 'Member', 'Received', 'Mode', 'Amount', 'Rate', 'Weight'],
      row: (r) => [r.receipt_no, r.gs_no, r.party_name, r.received_date, r.payment_type, r.amount, r.rate, r.weight],
    },
    sales: {
      headers: ['Bill No', 'Date', 'Customer', 'G.S. No', 'Type', 'Bill Total', 'Scheme Used', 'Grams', 'Returned'],
      row: (r) => [r.bill_no, r.bill_date, r.party_name, r.gs_no, r.scheme_type, r.total_amount, r.gss_amount, r.gss_weight, r.gss_return],
    },
  }
  const spec = COLS[kind]

  return (
    <div>
      <div className="toolbar">
        <Segmented value={kind} onChange={setKind}
          options={[
            { value: 'master', label: 'Scheme Master' },
            { value: 'allocated', label: 'Allocated' },
            { value: 'pending', label: 'Pending' },
            { value: 'received', label: 'Received' },
            { value: 'sales', label: 'Scheme Sales' },
          ]} />
        <span className="spacer" />
        <ReportActions build={() => ({
          baseName: `scheme-${kind}`, title: `Gold Scheme — ${kind}`,
          headers: spec.headers, rows: rows.map(spec.row),
        })} />
      </div>

      <div className="card">
        <div className="card-body flush">
          {rep.loading ? <Loading rows={4} /> : !rows.length ? (
            <Empty icon={Icon.receipt} title="Nothing to show">
              Enrol members under Gold Scheme and their instalments will appear here.
            </Empty>
          ) : (
            <div className="table-wrap">
              <table className="data">
                <thead><tr>{spec.headers.map((h) => (
                  <th key={h} className={/₹|g$|Amount|Weight|Rate|Total|Used|Grams|Returned|Paid|Due|Members|Paying/.test(h) ? 'r' : ''}>{h}</th>
                ))}</tr></thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={i}>
                      {spec.row(r).map((c, j) => (
                        <td key={j} className={typeof c === 'number' ? 'r num' : ''}>
                          {typeof c === 'number'
                            ? (spec.headers[j].includes('g') && !spec.headers[j].includes('₹')
                                ? wt(c) : money(c))
                            : (c || '—')}
                        </td>
                      ))}
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
