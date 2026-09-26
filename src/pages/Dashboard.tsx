import React from 'react'
import { Icon } from '../lib/icons'
import { CountUp, Empty, Loading, useAsync } from '../lib/ui'
import { dmy, money, wt } from '../lib/format'

export default function Dashboard({ go }: { go: (n: string, p?: any) => void }) {
  const { data, loading } = useAsync(() => window.api.reports.dashboard(), [])

  if (loading) return <Loading rows={6} />
  if (!data) return <Empty title="Nothing to show yet" />

  const tiles = [
    {
      label: 'Today’s Sales', to: 'sales', icon: Icon.invoice,
      value: <>₹<CountUp value={data.todaySales.v} format={(n) => money(n)} /></>,
      meta: `${data.todaySales.n} bill${data.todaySales.n === 1 ? '' : 's'}`,
    },
    {
      label: 'This Month', to: 'sales', icon: Icon.chart,
      value: <>₹<CountUp value={data.monthSales.v} format={(n) => money(n)} /></>,
      meta: `${data.monthSales.n} bills`,
    },
    {
      label: 'Stock in Hand', to: 'stock', icon: Icon.stock,
      value: <><CountUp value={data.stock.fine} format={(n) => wt(n)} /> <span style={{ fontSize: 14, color: 'var(--text-3)' }}>g fine</span></>,
      meta: `${data.stock.pieces} pieces · ${wt(data.stock.gross)} g gross`,
    },
    {
      label: 'Receivable', to: 'outstanding', icon: Icon.users,
      value: <>₹<CountUp value={data.receivable} format={(n) => money(n)} /></>,
      meta: `${data.customers} customers`,
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

      <div className="row wrap" style={{ gap: 10, marginBottom: 18 }}>
        <button className="btn btn-primary" onClick={() => go('sales.new')}>
          <Icon.plus /> New Sales Invoice
        </button>
        <button className="btn" onClick={() => go('tags')}><Icon.tag /> Add Stock</button>
        <button className="btn" onClick={() => go('customers', { new: true })}><Icon.users /> New Customer</button>
        <button className="btn" onClick={() => go('receipts')}><Icon.receipt /> Receive Payment</button>
      </div>

      <div className="card">
        <div className="card-head">
          <span className="card-title">Recent Bills</span>
          <button className="btn btn-ghost btn-sm" style={{ marginLeft: 'auto' }} onClick={() => go('sales')}>
            View all
          </button>
        </div>
        <div className="card-body flush">
          {data.recent.length === 0 ? (
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
                  {data.recent.map((r: any) => (
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
