import React, { useState } from 'react'
import { Icon } from '../lib/icons'
import { ReportActions } from '../lib/grid'
import { Loading, Segmented, Select, useAsync } from '../lib/ui'
import { money, wt } from '../lib/format'

const METALS = ['Gold', 'Silver', 'Platinum']

/**
 * Debtor / Creditor lists — the same outstanding read two ways, money or by
 * metal weight (docs/VIDEO-SPEC-2.md §5). Metal is never turned into rupees.
 */
export default function Outstanding({ go }: { go?: (n: string, p?: any) => void } = {}) {
  const [basis, setBasis] = useState<'money' | 'metal'>('money')
  const [metal, setMetal] = useState('Gold')
  const rep = useAsync(
    () => window.api.reports.outstandingList({ basis, metal }),
    [basis, metal]
  )
  const d = rep.data
  const isMetal = basis === 'metal'
  const fmt = (n: number) => (isMetal ? `${wt(n)} g` : `₹${money(n)}`)

  const report = () => {
    const max = Math.max(d.debtors.length, d.creditors.length)
    const rows = Array.from({ length: max }, (_, i) => [
      d.debtors[i]?.name ?? '', d.debtors[i] ? d.debtors[i].balance : '',
      d.creditors[i]?.name ?? '', d.creditors[i] ? d.creditors[i].balance : '',
    ])
    const unit = isMetal ? `${metal} (g fine)` : 'Amount'
    return {
      baseName: `outstanding-${basis}${isMetal ? '-' + metal : ''}`,
      title: isMetal ? `Outstanding by weight — ${metal}` : 'Outstanding — money',
      headers: ['Debtor', unit, 'Creditor', unit],
      rows: [...rows, ['Total', d.debtorTotal, 'Total', d.creditorTotal]],
    }
  }

  return (
    <div className="content-narrow">
      <div className="toolbar">
        <Segmented value={basis} onChange={(v) => setBasis(v as 'money' | 'metal')}
          options={[{ value: 'money', label: 'Money (₹)' }, { value: 'metal', label: 'Metal (g)' }]} />
        {isMetal && (
          <Select value={metal} onChange={setMetal} style={{ width: 120 }}
            options={METALS.map((m) => ({ value: m, label: m }))} />
        )}
        <span className="spacer" />
        {d && <ReportActions build={report} />}
      </div>

      {rep.loading || !d ? <Loading rows={6} /> : (
        <>
          <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(2, minmax(0,1fr))' }}>
            <div className="stat">
              <div className="stat-label">Total receivable (Dr)</div>
              <div className="stat-value num">{fmt(d.debtorTotal)}</div>
              <div className="stat-meta">{d.debtors.length} {d.debtors.length === 1 ? 'party' : 'parties'} owe us</div>
            </div>
            <div className="stat">
              <div className="stat-label">Total payable (Cr)</div>
              <div className="stat-value num">{fmt(d.creditorTotal)}</div>
              <div className="stat-meta">we owe {d.creditors.length} {d.creditors.length === 1 ? 'party' : 'parties'}</div>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            <OutTable title="Debtors — they owe us (Dr)" rows={d.debtors} total={d.debtorTotal} fmt={fmt}
              go={go} action={isMetal ? undefined : 'RECEIPT'} />
            <OutTable title="Creditors — we owe them (Cr)" rows={d.creditors} total={d.creditorTotal} fmt={fmt}
              go={go} action={isMetal ? undefined : 'PAYMENT'} />
          </div>
          {isMetal && (
            <p className="muted" style={{ fontSize: 12, marginTop: 10 }}>
              Weights are fine grams of {metal}. Metal owed is metal, never converted to a
              rupee figure — its value changes with the rate every day.
            </p>
          )}
        </>
      )}
    </div>
  )
}

function OutTable({ title, rows, total, fmt, go, action }: {
  title: string; rows: any[]; total: number; fmt: (n: number) => string
  go?: (n: string, p?: any) => void; action?: 'RECEIPT' | 'PAYMENT'
}) {
  return (
    <div className="card">
      <div className="card-head"><span className="card-title">{title}</span></div>
      <div className="card-body flush">
        <table className="data">
          <thead>
            <tr><th>Party</th><th>Mobile</th><th className="r">Balance</th>{go && <th></th>}</tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr><td colSpan={go ? 4 : 3} className="muted" style={{ textAlign: 'center', padding: 16 }}>Nothing outstanding</td></tr>
            )}
            {rows.map((r) => (
              <tr key={r.id}>
                <td>
                  {r.name}
                  <span className="muted" style={{ fontSize: 11 }}> · {r.party_type === 'CUSTOMER' ? 'Customer' : r.party_type === 'SUPPLIER' ? 'Supplier' : r.party_type === 'KARAGIR' ? 'Karagir' : 'Refinery'}</span>
                </td>
                <td className="muted">{r.mobile || '—'}</td>
                <td className="r num">{fmt(r.balance)}</td>
                {go && (
                  <td className="r" style={{ whiteSpace: 'nowrap' }}>
                    {action && (
                      <button className="btn btn-ghost btn-icon btn-sm"
                        title={action === 'RECEIPT' ? 'Receive payment' : 'Make payment'}
                        onClick={() => go('receipts', { partyId: r.id, kind: action })}>
                        <Icon.receipt />
                      </button>
                    )}
                    <button className="btn btn-ghost btn-icon btn-sm" title="Open ledger"
                      onClick={() => go('ledger', { partyId: r.id })}><Icon.ledger /></button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
          {rows.length > 0 && (
            <tfoot>
              <tr className="strong" style={{ borderTop: '2px solid var(--border)' }}>
                <td colSpan={2}>Total</td><td className="r num">{fmt(total)}</td>{go && <td></td>}
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  )
}
