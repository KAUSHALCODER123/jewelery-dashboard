import React, { useEffect, useState } from 'react'
import { Icon } from '../lib/icons'
import { CountUp, Empty, Loading, useAsync } from '../lib/ui'
import { dmy, money, wt } from '../lib/format'

/**
 * T09 — Owner's daily dashboard: corrected tagged stock by metal,
 * loose pools separate, today's money breakdown, alerts with real routes.
 */
export default function DashboardV2({ go }: { go: (n: string, p?: any) => void }) {
  const [d, setD] = useState<any>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let alive = true
    window.api.reports.dashboardV2().then((res: any) => {
      if (alive) { setD(res); setLoading(false) }
    }).catch(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [])

  if (loading) return <Loading rows={6} />
  if (!d) return <Empty title="Nothing to show yet" />

  const tiles = [
    {
      label: 'Today\'s Sales', to: 'sales', icon: Icon.invoice,
      value: <>₹<CountUp value={d.todaySales.v} format={(n) => money(n)} /></>,
      meta: `${d.todaySales.n} bill${d.todaySales.n === 1 ? '' : 's'}`,
    },
    {
      label: 'This Month', to: 'sales', icon: Icon.chart,
      value: <>₹<CountUp value={d.monthSales.v} format={(n) => money(n)} /></>,
      meta: `${d.monthSales.n} bills`,
    },
    {
      label: 'Collections (Cash)', to: 'receipts', icon: Icon.receipt,
      value: <>₹<CountUp value={d.cashSales.v} format={(n) => money(n)} /></>,
      meta: 'Cash + card on bills',
    },
    {
      label: 'Receipts', to: 'receipts', icon: Icon.receipt,
      value: <>₹<CountUp value={d.collections?.v || 0} format={(n) => money(n)} /></>,
      meta: `${d.collections?.n || 0} vouchers`,
    },
    {
      label: 'Refunds', to: 'returns', icon: Icon.back,
      value: <>₹<CountUp value={d.refunds?.v || 0} format={(n) => money(n)} /></>,
      meta: `${d.refunds?.n || 0} returns`,
    },
    {
      label: 'Receivable', to: 'outstanding', icon: Icon.users,
      value: <>₹<CountUp value={d.receivable} format={(n) => money(n)} /></>,
      meta: `${d.customers} customers`,
    },
  ]

  return (
    <div className="content-narrow">
      <div className="stat-grid">
        {tiles.map((t, i) => {
          const I = t.icon
          return (
            <div className="stat clickable" key={t.label} style={{ animationDelay: `${i * 45}ms`, cursor: 'pointer' }}
              role="button" title="Open the full report" onClick={() => go(t.to)}>
              <div className="stat-label"><I width={14} height={14} /> {t.label}</div>
              <div className="stat-value num">{t.value}</div>
              <div className="stat-meta">{t.meta}</div>
            </div>
          )
        })}
      </div>

      {/* Stock by Metal — never a mixed-metal fine-weight headline */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-head">
          <span className="card-title">Stock in Hand</span>
          <button className="btn btn-ghost btn-sm" style={{ marginLeft: 'auto' }} onClick={() => go('stock')}>
            View full report
          </button>
        </div>
        <div className="card-body">
          {d.stockByMetal?.length ? (
            <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(180, 1fr))' }}>
              {d.stockByMetal.map((m: any, i: number) => (
                <div className="stat" key={m.metal} style={{ animationDelay: `${i * 45}ms` }}>
                  <div className="stat-label"><Icon.stock width={14} height={14} /> {m.metal}</div>
                  <div className="stat-value num">
                    <CountUp value={m.fine} format={(n) => wt(n)} /> <span style={{ fontSize: 13, color: 'var(--text-3)' }}>g fine</span>
                  </div>
                  <div className="stat-meta">
                    {m.pieces} pcs · {wt(m.gross)} g gross · {wt(m.net)} g net
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="stat">
              <div className="stat-label"><Icon.stock width={14} height={14} /> Stock</div>
              <div className="stat-value num"><CountUp value={d.stock?.fine || 0} format={(n) => wt(n)} /> <span style={{ fontSize: 13, color: 'var(--text-3)' }}>g fine</span></div>
              <div className="stat-meta">{d.stock?.pieces || 0} pieces · {wt(d.stock?.gross || 0)} g gross</div>
            </div>
          )}
          {d.loose && (d.loose.net || d.loose.fine) && (
            <div className="row wrap" style={{ gap: 12, marginTop: 16 }}>
              <div className="stat">
                <div className="stat-label"><Icon.stock width={14} height={14} /> Loose (mani/fuli)</div>
                <div className="stat-value num">{wt(d.loose.net)} g net · {wt(d.loose.fine)} g fine</div>
                <div className="stat-meta">Not metal — excluded from fine totals</div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Today's Money breakdown */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-head">
          <span className="card-title">Today's Money ({d.business_date})</span>
        </div>
        <div className="card-body">
          <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(160, 1fr))' }}>
            <div className="stat">
              <div className="stat-label">Invoiced Sales</div>
              <div className="stat-value num">₹{money(d.todaySales?.v || 0)}</div>
              <div className="stat-meta">{d.todaySales?.n || 0} bills</div>
            </div>
            <div className="stat">
              <div className="stat-label">Collections</div>
              <div className="stat-value num">₹{money(d.collections?.v || 0)}</div>
              <div className="stat-meta">{d.collections?.n || 0} receipts</div>
            </div>
            <div className="stat">
              <div className="stat-label">Refunds</div>
              <div className="stat-value num" style={{ color: 'var(--danger)' }}>− ₹{money(d.refunds?.v || 0)}</div>
              <div className="stat-meta">{d.refunds?.n || 0} returns</div>
            </div>
            <div className="stat">
              <div className="stat-label">Cash on Bills</div>
              <div className="stat-value num">₹{money(d.cashSales?.v || 0)}</div>
              <div className="stat-meta">Cash + split cash legs</div>
            </div>
            <div className="stat">
              <div className="stat-label">Unsettled Digital</div>
              <div className="stat-value num" style={{ color: 'var(--warn)' }}>
                ₹{money(Math.max(0, (d.collections?.v || 0) - (d.cashSales?.v || 0)))}
              </div>
              <div className="stat-meta">UPI/Card pending settlement</div>
            </div>
          </div>
        </div>
      </div>

      {/* Alerts queue — each carries a real route + filters */}
      {(d.alerts?.length || []).filter(a => a.count > 0).length > 0 && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="card-head">
            <span className="card-title">Attention Queue</span>
          </div>
          <div className="card-body">
            <div className="row wrap" style={{ gap: 8 }}>
              {d.alerts.filter((a: any) => a.count > 0).map((a: any) => (
                <button key={a.key} className="btn" style={{ flex: '1 1 180px' }}
                  onClick={() => go(a.route, a.params)}>
                  <span className="badge badge-gold">{a.count}</span>
                  {' '}
                  {a.key === 'orders_overdue' && 'Overdue Orders'}
                  {a.key === 'parked_bills' && 'Parked Bills'}
                  {a.key === 'approvals_open' && 'Open Approvals'}
                  {a.key === 'repairs_open' && 'Open Repairs'}
                  {a.key === 'hallmark_away' && 'Hallmarking Away'}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Quick actions */}
      <div className="row wrap" style={{ gap: 10, marginBottom: 18 }}>
        <button className="btn btn-primary" onClick={() => go('sales.new')}>
          <Icon.plus /> New Sales Invoice
        </button>
        <button className="btn" onClick={() => go('tags')}>
          <Icon.tag /> Add Stock
        </button>
        <button className="btn" onClick={() => go('customers', { new: true })}>
          <Icon.users /> New Customer
        </button>
        <button className="btn" onClick={() => go('receipts')}>
          <Icon.receipt /> Receive Payment
        </button>
        <button className="btn" onClick={() => go('stockcheck')}>
          <Icon.check /> Stock Count
        </button>
        <button className="btn" onClick={() => go('closing')}>
          <Icon.chart /> Daily Closing
        </button>
      </div>

      {/* Recent Bills */}
      <div className="card">
        <div className="card-head">
          <span className="card-title">Recent Bills</span>
          <button className="btn btn-ghost btn-sm" style={{ marginLeft: 'auto' }} onClick={() => go('sales')}>
            View all
          </button>
        </div>
        <div className="card-body flush">
          {d.recent?.length === 0 ? (
            <Empty icon={Icon.invoice} title="No bills yet"
              action={<button className="btn btn-primary btn-sm" onClick={() => go('sales.new')}>Create the first bill</button>}>
              Sales you create will appear here.
            </Empty>
          ) : (
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th>Bill No</th><th>Date</th><th>Customer</th><th className="r">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {d.recent.map((r: any) => (
                    <tr key={r.id} className="clickable" onClick={() => go('sales.new', { id: r.id })}>
                      <td className="mono">{r.bill_no}</td>
                      <td>{dmy(r.bill_date)}</td>
                      <td>{r.party_name || <span className="muted">Counter</span>}</td>
                      <td className="r num">₹{money(r.total_amount)}</td>
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