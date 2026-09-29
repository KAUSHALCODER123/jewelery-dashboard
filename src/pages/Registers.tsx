import React, { useState } from 'react'
import { Icon } from '../lib/icons'
import { ReportActions } from '../lib/grid'
import { Input, Loading, Segmented, Select, useAsync } from '../lib/ui'
import { dmy, money, todayISO } from '../lib/format'

/** April–March financial year a date falls in. */
function fyStart(iso: string) {
  const d = new Date(iso)
  const y = d.getMonth() + 1 >= 4 ? d.getFullYear() : d.getFullYear() - 1
  return `${y}-04-01`
}

type Tab = 'cash' | 'journal' | 'register'

export default function Registers() {
  const [tab, setTab] = useState<Tab>('cash')
  const [account, setAccount] = useState('Cash Account')
  const [book, setBook] = useState('SALES')
  const today = todayISO()
  const [from, setFrom] = useState(fyStart(today))
  const [to, setTo] = useState(today)

  return (
    <div className="content-narrow">
      <div className="toolbar" style={{ paddingBottom: 0, border: 0 }}>
        <Segmented value={tab} onChange={(v) => setTab(v as Tab)}
          options={[
            { value: 'cash', label: 'Cash / Bank Book' },
            { value: 'journal', label: 'Journal' },
            { value: 'register', label: 'Sales & Purchase Books' },
          ]} />
      </div>
      <div className="toolbar">
        {tab === 'cash' && (
          <Select value={account} onChange={setAccount} style={{ width: 150 }}
            options={[{ value: 'Cash Account', label: 'Cash Book' }, { value: 'Bank Account', label: 'Bank Book' }]} />
        )}
        {tab === 'register' && (
          <Select value={book} onChange={setBook} style={{ width: 190 }}
            options={[
              { value: 'SALES', label: 'Sales Register' },
              { value: 'SALERETURN', label: 'Sales Return Register' },
              { value: 'PURCHASE', label: 'Purchase Register' },
              { value: 'PURCHASERETURN', label: 'Purchase Return Register' },
            ]} />
        )}
        <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} style={{ width: 150 }} />
        <span className="muted">to</span>
        <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} style={{ width: 150 }} />
        <button className="btn btn-sm" onClick={() => { setFrom(fyStart(today)); setTo(today) }}>This FY</button>
        <span className="spacer" />
      </div>

      {tab === 'cash' && <CashBook account={account} from={from} to={to} />}
      {tab === 'journal' && <Journal from={from} to={to} />}
      {tab === 'register' && <Register book={book} from={from} to={to} />}
    </div>
  )
}


/* ───────────────────────────── Cash / Bank Book ───────────────────────────── */

function CashBook({ account, from, to }: { account: string; from: string; to: string }) {
  const rep = useAsync(() => window.api.reports.cashBook({ account, from, to }), [account, from, to])
  const d = rep.data
  if (rep.loading || !d) return <Loading rows={8} />

  const drcr = (v: number) => `${money(Math.abs(v))} ${v >= 0 ? 'Dr' : 'Cr'}`
  const report = () => {
    return {
      baseName: `${d.account.replace(/\s+/g, '-').toLowerCase()}-${to}`, title: 'Cash / Bank Book',
      headers: ['Date', 'Particulars', 'Voucher', 'Receipt (Dr)', 'Payment (Cr)', 'Balance'],
      rows: [
        ['', 'Opening Balance', '', '', '', d.opening],
        ...d.rows.map((r: any) => [dmy(r.entry_date), r.particulars, r.doc_no, r.debit || '', r.credit || '', r.balance]),
        ['', 'Closing Balance', '', d.totalDebit, d.totalCredit, d.closing],
      ],
    }
  }

  return (
    <div className="card">
      <div className="card-head">
        <span className="card-title">{d.account === 'Bank Account' ? 'Bank Book' : 'Cash Book'}</span>
        <span className="spacer" />
        <ReportActions build={report} />
      </div>
      <div className="card-body flush">
        <table className="data">
          <thead>
            <tr><th>Date</th><th>Particulars</th><th>Voucher</th>
              <th className="r">Receipt</th><th className="r">Payment</th><th className="r">Balance</th></tr>
          </thead>
          <tbody>
            <tr className="muted"><td></td><td>Opening Balance</td><td></td><td></td><td></td>
              <td className="r num">{drcr(d.opening)}</td></tr>
            {d.rows.map((r: any, i: number) => (
              <tr key={i}>
                <td>{dmy(r.entry_date)}</td>
                <td>{r.particulars}</td>
                <td className="mono">{r.doc_no}</td>
                <td className="r num">{r.debit ? money(r.debit) : ''}</td>
                <td className="r num">{r.credit ? money(r.credit) : ''}</td>
                <td className="r num">{drcr(r.balance)}</td>
              </tr>
            ))}
            {d.rows.length === 0 && (
              <tr><td colSpan={6} className="muted" style={{ textAlign: 'center', padding: 16 }}>No movements in this period</td></tr>
            )}
          </tbody>
          <tfoot>
            <tr className="strong" style={{ borderTop: '2px solid var(--border)' }}>
              <td colSpan={3}>Closing Balance</td>
              <td className="r num">{money(d.totalDebit)}</td>
              <td className="r num">{money(d.totalCredit)}</td>
              <td className="r num">{drcr(d.closing)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  )
}

/* ───────────────────────────── Journal ───────────────────────────── */

function Journal({ from, to }: { from: string; to: string }) {
  const rep = useAsync(() => window.api.reports.journal({ from, to }), [from, to])
  const d = rep.data
  if (rep.loading || !d) return <Loading rows={8} />

  const report = () => {
    return {
      baseName: `journal-${from}_${to}`, title: 'Journal',
      headers: ['Date', 'Head', 'Particulars', 'Voucher', 'Debit', 'Credit'],
      rows: [
        ...d.rows.map((r: any) => [dmy(r.entry_date), r.head, r.particulars, r.doc_no, r.debit || '', r.credit || '']),
        ['', '', 'Total', '', d.totalDebit, d.totalCredit],
      ],
    }
  }

  return (
    <div className="card">
      <div className="card-head">
        <span className="card-title">Journal</span>
        <span className="spacer" />
        <ReportActions build={report} />
      </div>
      <div className="card-body flush">
        <table className="data">
          <thead>
            <tr><th>Date</th><th>Head</th><th>Particulars</th><th>Voucher</th>
              <th className="r">Debit</th><th className="r">Credit</th></tr>
          </thead>
          <tbody>
            {d.rows.map((r: any, i: number) => (
              <tr key={i}>
                <td>{dmy(r.entry_date)}</td>
                <td>{r.head}</td>
                <td className="muted">{r.particulars}</td>
                <td className="mono">{r.doc_no}</td>
                <td className="r num">{r.debit ? money(r.debit) : ''}</td>
                <td className="r num">{r.credit ? money(r.credit) : ''}</td>
              </tr>
            ))}
            {d.rows.length === 0 && (
              <tr><td colSpan={6} className="muted" style={{ textAlign: 'center', padding: 16 }}>No postings in this period</td></tr>
            )}
          </tbody>
          <tfoot>
            <tr className="strong" style={{ borderTop: '2px solid var(--border)' }}>
              <td colSpan={4}>Total</td>
              <td className="r num">{money(d.totalDebit)}</td>
              <td className="r num">{money(d.totalCredit)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  )
}

/* ───────────────────────────── Document register ───────────────────────────── */

function Register({ book, from, to }: { book: string; from: string; to: string }) {
  const rep = useAsync(() => window.api.reports.register({ book, from, to }), [book, from, to])
  const d = rep.data
  if (rep.loading || !d) return <Loading rows={8} />

  const report = () => {
    return {
      baseName: `${book.toLowerCase()}-register-${to}`, title: 'Register',
      headers: ['Date', 'Document', 'Party', 'Taxable', 'GST', 'Total'],
      rows: [
        ...d.rows.map((r: any) => [dmy(r.date), r.doc_no, r.party_name, r.taxable, r.gst_amount, r.total]),
        ['', '', 'Total', d.totals.taxable, d.totals.gst_amount, d.totals.total],
      ],
    }
  }

  return (
    <div className="card">
      <div className="card-head">
        <span className="card-title">{d.title}</span>
        <span className="spacer" />
        <ReportActions build={report} />
      </div>
      <div className="card-body flush">
        <table className="data">
          <thead>
            <tr><th>Date</th><th>Document</th><th>Party</th>
              <th className="r">Taxable</th><th className="r">GST</th><th className="r">Total</th></tr>
          </thead>
          <tbody>
            {d.rows.map((r: any, i: number) => (
              <tr key={i}>
                <td>{dmy(r.date)}</td>
                <td className="mono">{r.doc_no}</td>
                <td>{r.party_name || <span className="muted">Counter</span>}</td>
                <td className="r num">{money(r.taxable)}</td>
                <td className="r num">{money(r.gst_amount)}</td>
                <td className="r num strong">{money(r.total)}</td>
              </tr>
            ))}
            {d.rows.length === 0 && (
              <tr><td colSpan={6} className="muted" style={{ textAlign: 'center', padding: 16 }}>No documents in this period</td></tr>
            )}
          </tbody>
          <tfoot>
            <tr className="strong" style={{ borderTop: '2px solid var(--border)' }}>
              <td colSpan={3}>Total ({d.rows.length})</td>
              <td className="r num">{money(d.totals.taxable)}</td>
              <td className="r num">{money(d.totals.gst_amount)}</td>
              <td className="r num">{money(d.totals.total)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  )
}
