import React, { useEffect, useState } from 'react'
import { Icon } from '../lib/icons'
import { Empty, Loading, useAsync, useDebounced } from '../lib/ui'
import { dmy, money, wt } from '../lib/format'
import { Pagination } from '../lib/inventory'

/**
 * T13 — Customer summary workspace.
 * One screen: purchases/returns, money dues, metal balances, advances, schemes, orders, repairs, reservations.
 */
export default function CustomerSummary({ partyId, go }: { partyId: number; go: (n: string, p?: any) => void }) {
  const [page, setPage] = useState(1)
  const summary = useAsync(() => window.api.customer.summary({ party_id: partyId, page, pageSize: 50 }), [partyId, page])

  const d = summary.data
  const timeline = d?.timeline || []

  const moneyBal = d?.moneyBalance ?? 0
  const metals = d?.metalBalances || []

  return (
    <div className="content-narrow">
      <div className="toolbar" style={{ marginBottom: 16 }}>
        <div style={{ flex: 1 }}>
          {d?.party && (
            <>
              <div className="row" style={{ gap: 12, alignItems: 'center', marginBottom: 8 }}>
                <span className="strong" style={{ fontSize: 20 }}>{d.party.name}</span>
                {d.party.mobile && <span className="muted">{d.party.mobile}</span>}
                {d.party.area && <span className="muted">{d.party.area}</span>}
              </div>
              <div className="small muted">{d.party.address}</div>
            </>
          )}
        </div>
        <div className="row" style={{ gap: 8 }}>
          <button className="btn" onClick={() => go('ledger', { partyId })}><Icon.ledger /> Ledger</button>
          <button className="btn" onClick={() => go('sales.new', { partyId })}><Icon.invoice /> New Sale</button>
          <button className="btn" onClick={() => go('receipts', { partyId })}><Icon.receipt /> Receive</button>
        </div>
      </div>

      {/* Balances */}
      <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(180, 1fr))', marginBottom: 16 }}>
        <div className="stat">
          <div className="stat-label">Money Balance</div>
          <div className="stat-value num" style={{ color: moneyBal > 0 ? 'var(--dr)' : moneyBal < 0 ? 'var(--cr)' : undefined }}>
            ₹{money(Math.abs(moneyBal))} {moneyBal > 0 ? 'Dr' : moneyBal < 0 ? 'Cr' : ''}
          </div>
        </div>
        {metals.map((m: any) => (
          <div className="stat" key={m.metal}>
            <div className="stat-label">{m.metal} Balance</div>
            <div className="stat-value num">{wt(m.bal)} g</div>
          </div>
        ))}
        {metals.length === 0 && (
          <div className="stat">
            <div className="stat-label">Metal Balances</div>
            <div className="stat-value muted">No metal movements</div>
          </div>
        )}
      </div>

      {/* Advances / Schemes / Orders quick cards */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-head"><span className="card-title">Open Items</span></div>
        <div className="card-body">
          <div className="row wrap" style={{ gap: 12 }}>
            <div className="stat" style={{ minWidth: 200 }}>
              <div className="stat-label">Advances</div>
              <div className="stat-value num">{d?.advances?.length || 0}</div>
              <button className="btn btn-sm" onClick={() => go('ledger', { partyId })}>View</button>
            </div>
            <div className="stat" style={{ minWidth: 200 }}>
              <div className="stat-label">Schemes</div>
              <div className="stat-value num">{d?.schemes?.length || 0}</div>
              <button className="btn btn-sm" onClick={() => go('schemes', { partyId })}>View</button>
            </div>
            <div className="stat" style={{ minWidth: 200 }}>
              <div className="stat-label">Orders</div>
              <div className="stat-value num">{d?.orders?.length || 0}</div>
              <button className="btn btn-sm" onClick={() => go('orders', { partyId })}>View</button>
            </div>
            <div className="stat" style={{ minWidth: 200 }}>
              <div className="stat-label">Repairs</div>
              <div className="stat-value num">{d?.repairs?.length || 0}</div>
              <button className="btn btn-sm" onClick={() => go('repairs', { partyId })}>View</button>
            </div>
            <div className="stat" style={{ minWidth: 200 }}>
              <div className="stat-label">Reservations</div>
              <div className="stat-value num">{d?.reservations?.length || 0}</div>
              <button className="btn btn-sm" onClick={() => go('reservations', { partyId })}>View</button>
            </div>
          </div>
        </div>
      </div>

      {/* Timeline */}
      <div className="card">
        <div className="card-head">
          <span className="card-title">Activity Timeline</span>
          <span className="small muted">{d?.total || 0} events</span>
        </div>
        <div className="card-body flush">
          {summary.loading ? <Loading rows={4} /> : !timeline.length ? (
            <Empty icon={Icon.history} title="No activity" />
          ) : (
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr><th>Date</th><th>Type</th><th>Reference</th><th className="r">Amount</th><th>Metal</th><th></th></tr>
                </thead>
                <tbody>
                  {timeline.map((e: any, i: number) => (
                    <tr key={i} className="clickable" onClick={() => {
                      if (e.type === 'SALE') go('sales.new', { id: e.id })
                      else if (e.type === 'VOUCHER') go('receipts', { id: e.id })
                      else if (e.type === 'ORDER') go('orders', { id: e.id })
                      else if (e.type === 'REPAIR') go('repairs', { id: e.id })
                      else if (e.type === 'RESERVATION') go('reservations', { id: e.id })
                    }}>
                      <td>{dmy(e.doc_date)}</td>
                      <td><span className="badge">{e.type}</span></td>
                      <td className="mono">{e.doc_no || `#${e.id}`}</td>
                      <td className="r num">{money(e.amount || 0)}</td>
                      <td>{e.metal ? wt(e.metal) + ' g ' + (e.metal_metal || '') : <span className="muted">—</span>}</td>
                      <td><Icon.chevronRight width={14} height={14} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <Pagination data={{ page: d?.page || 1, pageSize: d?.pageSize || 50, total: d?.total || 0 }}
            onPage={setPage} disabled={summary.loading} />
        </div>
      </div>
    </div>
  )
}