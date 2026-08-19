import React, { useState } from 'react'
import { Icon } from '../lib/icons'
import { ReportActions } from '../lib/grid'
import { Input, Loading, Segmented, useAsync } from '../lib/ui'
import { money, todayISO } from '../lib/format'

/** April–March financial year that a date falls in. */
function fyStart(iso: string) {
  const d = new Date(iso)
  const y = d.getMonth() + 1 >= 4 ? d.getFullYear() : d.getFullYear() - 1
  return `${y}-04-01`
}

type Book = 'trial' | 'pl' | 'balance'

export default function AccountBooks() {
  const [book, setBook] = useState<Book>('trial')
  const today = todayISO()
  const [from, setFrom] = useState(fyStart(today))
  const [to, setTo] = useState(today)

  return (
    <div className="content-narrow">
      <div className="toolbar" style={{ paddingBottom: 0, border: 0 }}>
        <Segmented
          value={book}
          onChange={(v) => setBook(v as Book)}
          options={[
            { value: 'trial', label: 'Trial Balance' },
            { value: 'pl', label: 'Profit & Loss' },
            { value: 'balance', label: 'Balance Sheet' },
          ]}
        />
      </div>
      <div className="toolbar">
        <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} style={{ width: 150 }} />
        <span className="muted">to</span>
        <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} style={{ width: 150 }} />
        <button className="btn btn-sm" onClick={() => { setFrom(fyStart(today)); setTo(today) }}>This FY</button>
        <span className="spacer" />
      </div>

      {book === 'trial' && <TrialBalance from={from} to={to} />}
      {book === 'pl' && <ProfitLoss from={from} to={to} />}
      {book === 'balance' && <BalanceSheet from={from} to={to} />}
    </div>
  )
}

const dash = '—'
const amt = (n: number) => (Math.abs(n) < 0.005 ? dash : money(n))


/* ───────────────────────────── Trial Balance ───────────────────────────── */

function TrialBalance({ from, to }: { from: string; to: string }) {
  const rep = useAsync(() => window.api.reports.trialBalance({ from, to }), [from, to])
  const d = rep.data
  if (rep.loading || !d) return <Loading rows={8} />

  // Lay the two columns side by side, one head per row.
  const max = Math.max(d.dr.length, d.cr.length)
  const rows = Array.from({ length: max }, (_, i) => ({ dr: d.dr[i], cr: d.cr[i] }))

  const report = () => {
    return {
      baseName: `trial-balance-${to}`, title: 'Trial Balance',
      headers: ['Debit — Particulars', 'Amount', 'Credit — Particulars', 'Amount'],
      rows: [
        ...rows.map((r: any) => [r.dr?.name ?? '', r.dr ? r.dr.amount : '', r.cr?.name ?? '', r.cr ? r.cr.amount : '']),
        ['Total', d.drTotal, 'Total', d.crTotal],
      ],
    }
  }

  return (
    <div className="card">
      <div className="card-head">
        <span className="card-title">Trial Balance as on {to}</span>
        <span className="spacer" />
        <ReportActions build={report} />
      </div>
      <div className="card-body flush">
        <table className="data">
          <thead>
            <tr>
              <th>Particulars</th><th className="r">Debit</th>
              <th>Particulars</th><th className="r">Credit</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r: any, i: number) => (
              <tr key={i}>
                <td className={r.dr?.balancing ? 'muted' : ''}>{r.dr?.name ?? ''}</td>
                <td className="r num">{r.dr ? amt(r.dr.amount) : ''}</td>
                <td className={r.cr?.balancing ? 'muted' : ''}>{r.cr?.name ?? ''}</td>
                <td className="r num">{r.cr ? amt(r.cr.amount) : ''}</td>
              </tr>
            ))}
            <tr className="strong" style={{ borderTop: '2px solid var(--border)' }}>
              <td>Total</td><td className="r num">{money(d.drTotal)}</td>
              <td>Total</td><td className="r num">{money(d.crTotal)}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <div className="card-foot muted" style={{ padding: '8px 14px', fontSize: 12 }}>
        The two columns must agree. Any capital brought forward or un-booked opening
        difference is shown as its own line rather than hidden.
      </div>
    </div>
  )
}

/* ─────────────────────────── Trading & P&L ─────────────────────────── */

function ProfitLoss({ from, to }: { from: string; to: string }) {
  const rep = useAsync(() => window.api.reports.profitAndLoss({ from, to }), [from, to])
  const d = rep.data
  if (rep.loading || !d) return <Loading rows={8} />

  const profit = d.netProfit >= 0

  const report = () => {
        const line = (section: string, r: any) => [section, r.name, r.amount]
    return {
      baseName: `profit-loss-${from}_${to}`, title: 'Trading and Profit & Loss',
      headers: ['Section', 'Particulars', 'Amount'],
      rows: [
        ...d.trading.dr.map((r: any) => line('Trading Dr', r)),
        ...d.trading.cr.map((r: any) => line('Trading Cr', r)),
        ['Trading', 'Gross Profit', d.grossProfit],
        ...d.pl.dr.map((r: any) => line('P&L Dr', r)),
        ['P&L', 'Net Profit', d.netProfit],
      ],
    }
  }

  // A two-column T-account: expenses left, income right, gross profit as the
  // balancing line that carries down into the P&L below it.
  const tradeDr = [...d.trading.dr]
  const tradeCr = [...d.trading.cr]
  const tradeMax = Math.max(tradeDr.length + (d.grossProfit >= 0 ? 1 : 0), tradeCr.length + (d.grossProfit < 0 ? 1 : 0))

  return (
    <>
      <div className="card">
        <div className="card-head">
          <span className="card-title">Trading Account · {from} to {to}</span>
          <span className="spacer" />
          <ReportActions build={report} />
        </div>
        <div className="card-body flush">
          <TAccount
            left={[...tradeDr, ...(d.grossProfit >= 0 ? [{ name: 'Gross Profit c/d', amount: d.grossProfit, strong: true }] : [])]}
            right={[...tradeCr, ...(d.grossProfit < 0 ? [{ name: 'Gross Loss c/d', amount: -d.grossProfit, strong: true }] : [])]}
            leftHead="To (Dr)" rightHead="By (Cr)"
          />
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <span className="card-title">Profit &amp; Loss Account</span>
        </div>
        <div className="card-body flush">
          <TAccount
            left={[...d.pl.dr, ...(profit ? [{ name: 'Net Profit', amount: d.netProfit, strong: true }] : [])]}
            right={[
              { name: d.grossProfit >= 0 ? 'Gross Profit b/d' : 'Gross Loss b/d', amount: Math.abs(d.grossProfit) },
              ...(profit ? [] : [{ name: 'Net Loss', amount: -d.netProfit, strong: true }]),
            ]}
            leftHead="To (Dr)" rightHead="By (Cr)"
          />
        </div>
      </div>

      <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(2, minmax(0,1fr))' }}>
        <div className="stat">
          <div className="stat-label">Gross Profit</div>
          <div className="stat-value num">₹{money(d.grossProfit)}</div>
          <div className="stat-meta">Sales + closing stock − purchases</div>
        </div>
        <div className="stat">
          <div className="stat-label">{profit ? 'Net Profit' : 'Net Loss'}</div>
          <div className="stat-value num" style={{ color: profit ? 'var(--ok)' : 'var(--danger)' }}>
            ₹{money(Math.abs(d.netProfit))}
          </div>
          <div className="stat-meta">after ₹{money(d.pl.indirectExpenses)} indirect expenses</div>
        </div>
      </div>
    </>
  )
}

/** A classic two-sided T-account table. */
function TAccount({
  left, right, leftHead, rightHead,
}: {
  left: any[]; right: any[]; leftHead: string; rightHead: string
}) {
  const max = Math.max(left.length, right.length)
  const rows = Array.from({ length: max }, (_, i) => ({ l: left[i], r: right[i] }))
  const lTotal = left.reduce((s, r) => s + r.amount, 0)
  const rTotal = right.reduce((s, r) => s + r.amount, 0)
  return (
    <table className="data">
      <thead>
        <tr><th>{leftHead}</th><th className="r">Amount</th><th>{rightHead}</th><th className="r">Amount</th></tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i}>
            <td className={r.l?.strong ? 'strong' : ''}>{r.l?.name ?? ''}</td>
            <td className="r num">{r.l ? amt(r.l.amount) : ''}</td>
            <td className={r.r?.strong ? 'strong' : ''}>{r.r?.name ?? ''}</td>
            <td className="r num">{r.r ? amt(r.r.amount) : ''}</td>
          </tr>
        ))}
        <tr className="strong" style={{ borderTop: '2px solid var(--border)' }}>
          <td>Total</td><td className="r num">{money(lTotal)}</td>
          <td>Total</td><td className="r num">{money(rTotal)}</td>
        </tr>
      </tbody>
    </table>
  )
}

/* ───────────────────────────── Balance Sheet ───────────────────────────── */

function BalanceSheet({ from, to }: { from: string; to: string }) {
  const rep = useAsync(() => window.api.reports.balanceSheet({ from, to }), [from, to])
  const d = rep.data
  if (rep.loading || !d) return <Loading rows={8} />

  const report = () => {
    return {
      baseName: `balance-sheet-${to}`, title: 'Balance Sheet',
      headers: ['Liabilities', 'Amount', 'Assets', 'Amount'],
      rows: [
        ...Array.from({ length: Math.max(d.liabilities.length, d.assets.length) }, (_, i) => [
          d.liabilities[i]?.name ?? '', d.liabilities[i] ? d.liabilities[i].amount : '',
          d.assets[i]?.name ?? '', d.assets[i] ? d.assets[i].amount : '',
        ]),
        ['Total', d.liabilityTotal, 'Total', d.assetTotal],
      ],
    }
  }

  const max = Math.max(d.liabilities.length, d.assets.length)
  const rows = Array.from({ length: max }, (_, i) => ({ l: d.liabilities[i], a: d.assets[i] }))

  return (
    <div className="card">
      <div className="card-head">
        <span className="card-title">Balance Sheet as on {to}</span>
        <span className="spacer" />
        <ReportActions build={report} />
      </div>
      <div className="card-body flush">
        <table className="data">
          <thead>
            <tr>
              <th>Liabilities</th><th className="r">Amount</th>
              <th>Assets</th><th className="r">Amount</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
                <td>
                  {r.l?.name ?? ''}
                  {r.l?.note && <span className="muted" style={{ fontSize: 11 }}> ({r.l.note})</span>}
                </td>
                <td className="r num">{r.l ? amt(r.l.amount) : ''}</td>
                <td>{r.a?.name ?? ''}</td>
                <td className="r num">{r.a ? amt(r.a.amount) : ''}</td>
              </tr>
            ))}
            <tr className="strong" style={{ borderTop: '2px solid var(--border)' }}>
              <td>Total</td><td className="r num">{money(d.liabilityTotal)}</td>
              <td>Total</td><td className="r num">{money(d.assetTotal)}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <div className="card-foot muted" style={{ padding: '8px 14px', fontSize: 12 }}>
        Capital is struck so the two sides agree; it carries the period's net profit
        of ₹{money(d.netProfit)}. Stock is valued at cost from current inventory.
      </div>
    </div>
  )
}
