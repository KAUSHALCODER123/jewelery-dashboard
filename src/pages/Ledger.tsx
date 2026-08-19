import React, { useEffect, useState } from 'react'
import { Icon } from '../lib/icons'
import { Autocomplete, Empty, Input, Loading, Segmented, useAsync } from '../lib/ui'
import { dmy, money, toCsv, todayISO, wt } from '../lib/format'

export default function Ledger({ partyId }: { partyId?: number }) {
  const [pid, setPid] = useState<number | null>(partyId ?? null)
  const [query, setQuery] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState(todayISO())
  const [book, setBook] = useState<'money' | 'metal' | 'both'>('money')
  const [metal, setMetal] = useState('Gold')

  useEffect(() => {
    if (!partyId) return
    setPid(partyId)
    window.api.party.read({ id: partyId }).then((p) => p && setQuery(p.name))
  }, [partyId])

  const rep = useAsync(
    async () =>
      !pid ? null
        : book === 'money'
          ? window.api.reports.ledger({ partyId: pid, from, to })
          : book === 'metal'
            ? window.api.reports.metalLedger({ partyId: pid, metal, from, to })
            : window.api.reports.accountCumStock({ partyId: pid, metal, from, to }),
    [pid, from, to, book, metal]
  )
  const d = rep.data
  const isMetal = book === 'metal'
  const isBoth = book === 'both'

  // Both balances are shown as a magnitude with its side, the way a khata reads.
  const amtDrCr = (v: number) =>
    Math.abs(v) < 0.005 ? '—' : `${money(Math.abs(v))} ${v > 0 ? 'Dr' : 'Cr'}`
  const wtDrCr = (v: number) =>
    Math.abs(v) < 0.0005 ? '—' : `${wt(Math.abs(v))} ${v > 0 ? 'Dr' : 'Cr'}`
  /** Money rows carry `amount`; metal rows carry `weight` in fine grams. */
  const val = (r: any) => (isMetal ? wt(r.weight) : money(r.amount))
  const total = (n: any) => (isMetal ? `${wt(n)} g` : money(n))

  const exportCsv = async () => {
    if (!d) return
    if (isBoth) {
      const csv = toCsv(
        ['Date', 'Doc No', 'Particulars', 'Amount', 'Received', 'Fine Wt', 'In/Out',
          'Balance (Rs)', 'Balance (g)'],
        [
          ['', '', 'Opening Balance', '', '', '', '',
            d.opening.amount, d.opening.weight],
          ...d.rows.map((r: any) => [
            dmy(r.entry_date), r.doc_no, r.particulars, r.amount, r.received,
            r.fine_wt, r.in_out, r.bal_amt, r.bal_wt,
          ]),
          ['', '', 'Closing Balance', '', '', '', '',
            d.closing.amount, d.closing.weight],
        ]
      )
      await window.api.file.saveText({
        content: csv, suggestedName: `account-cum-stock-${d.party.name}.csv`,
      })
      return
    }
    const max = Math.max(d.debits.length, d.credits.length)
    const rows = Array.from({ length: max }, (_, i) => {
      const dr = d.debits[i]
      const cr = d.credits[i]
      const v = (r: any) => (r ? (isMetal ? r.weight : r.amount) : '')
      return [
        dr ? dmy(dr.entry_date) : '', dr?.particulars ?? '', dr?.doc_no ?? '', v(dr),
        cr ? dmy(cr.entry_date) : '', cr?.particulars ?? '', cr?.doc_no ?? '', v(cr),
      ]
    })
    const unit = isMetal ? 'Fine Wt' : 'Amount'
    const csv = toCsv(
      ['Dr Date', 'Particulars', 'Doc No', unit, 'Cr Date', 'Particulars', 'Doc No', unit],
      rows
    )
    await window.api.file.saveText({
      content: csv,
      suggestedName: `${isMetal ? 'gold-khata' : 'ledger'}-${d.party.name}.csv`,
    })
  }

  return (
    <div className="content-narrow">
      <div className="toolbar">
        <div style={{ width: 320 }}>
          <Autocomplete value={query} placeholder="Search a customer or supplier…"
            onText={(s) => { setQuery(s); setPid(null) }}
            onPick={(p: any) => { setQuery(p.name); setPid(p.id) }}
            fetch={(q) => window.api.party.list({ type: 'ALL', search: q })}
            render={(p: any) => <span><b>{p.name}</b><span className="muted"> · {p.party_type === 'CUSTOMER' ? 'Customer' : 'Supplier'}</span></span>} />
        </div>
        <Segmented value={book} onChange={(v) => setBook(v as 'money' | 'metal' | 'both')}
          options={[
            { value: 'money', label: 'Money' },
            { value: 'metal', label: 'Metal' },
            { value: 'both', label: 'Money + Metal' },
          ]} />
        {book !== 'money' && (
          <select className="select" style={{ width: 110 }} value={metal}
            onChange={(e) => setMetal(e.target.value)}>
            <option>Gold</option>
            <option>Silver</option>
            <option>Platinum</option>
          </select>
        )}
        <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} style={{ width: 150 }} />
        <span className="muted">to</span>
        <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} style={{ width: 150 }} />
        <span className="spacer" />
        {d && <button className="btn btn-sm" onClick={exportCsv}><Icon.download /> Export</button>}
      </div>

      {!pid ? (
        <div className="card"><div className="card-body">
          <Empty icon={Icon.ledger} title="Select a party">
            Pick a customer or supplier above to see their khata in the classic Dr / Cr format — in rupees, or in fine grams of gold.
          </Empty>
        </div></div>
      ) : rep.loading ? <Loading rows={6} /> : !d ? null :
        // While the mode is switching, `d` still holds the PREVIOUS report's
        // shape. Branch on the data, not on the toggle, or the combined view
        // renders against a money ledger that has no opening/closing objects.
        isBoth ? (d.opening ? (
        <div className="card">
          <div className="card-head">
            <div>
              <div className="card-title">{d.party.name}</div>
              <div className="small muted">Account cum Stock — money and metal on one statement</div>
            </div>
            <div className="row" style={{ marginLeft: 'auto', gap: 8 }}>
              <span className={`balance-flag ${d.closing.amount >= 0 ? 'dr' : 'cr'}`}>
                ₹{money(Math.abs(d.closing.amount))} {d.closing.amount >= 0 ? 'Dr' : 'Cr'}
              </span>
              <span className={`balance-flag ${d.closing.weight >= 0 ? 'dr' : 'cr'}`}>
                {wt(Math.abs(d.closing.weight))} g {d.closing.weight >= 0 ? 'Dr' : 'Cr'}
              </span>
            </div>
          </div>
          <div className="card-body flush">
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th style={{ width: 96 }}>Date</th>
                    <th style={{ width: 80 }}>Doc No</th>
                    <th>Transaction</th>
                    <th className="r" style={{ width: 92 }}>Fine Wt</th>
                    <th className="r" style={{ width: 62 }}>In/Out</th>
                    <th className="r" style={{ width: 110 }}>Amount</th>
                    <th className="r" style={{ width: 110 }}>Received</th>
                    <th className="r" style={{ width: 124 }}>Balance ₹</th>
                    <th className="r" style={{ width: 110 }}>Balance g</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td colSpan={3} className="strong">Opening Balance</td>
                    <td colSpan={4}></td>
                    <td className="r num strong">{amtDrCr(d.opening.amount)}</td>
                    <td className="r num strong">{wtDrCr(d.opening.weight)}</td>
                  </tr>
                  {d.rows.map((r: any, i: number) => (
                    <tr key={i}>
                      <td>{dmy(r.entry_date)}</td>
                      <td className="mono small">{r.doc_no}</td>
                      <td>{r.particulars}</td>
                      <td className="r num">{r.fine_wt ? wt(r.fine_wt) : ''}</td>
                      <td className="r small muted">{r.in_out}</td>
                      <td className="r num">{r.amount ? money(r.amount) : ''}</td>
                      <td className="r num">{r.received ? money(r.received) : ''}</td>
                      <td className="r num">{amtDrCr(r.bal_amt)}</td>
                      <td className="r num">{wtDrCr(r.bal_wt)}</td>
                    </tr>
                  ))}
                  {!d.rows.length && (
                    <tr><td colSpan={9} className="muted" style={{ padding: 18, textAlign: 'center' }}>
                      Nothing in this date range.
                    </td></tr>
                  )}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={3}>Closing Balance</td>
                    <td colSpan={2}></td>
                    <td className="r num">{money(d.totals.amount)}</td>
                    <td className="r num">{money(d.totals.received)}</td>
                    <td className="r num strong">{amtDrCr(d.closing.amount)}</td>
                    <td className="r num strong">{wtDrCr(d.closing.weight)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        </div>
      ) : <Loading rows={6} />) : d.debits ? (
        <div className="card">
          <div className="card-head">
            <div>
              <div className="card-title">{d.party.name}</div>
              <div className="small muted">
                {[d.party.mobile, d.party.area, d.party.city].filter(Boolean).join(' · ') || 'No contact details'}
              </div>
            </div>
            <span className={`balance-flag ${d.closingSide === 'Dr' ? 'dr' : 'cr'}`} style={{ marginLeft: 'auto' }}>
              Balance {isMetal ? `${wt(d.closing)} g fine` : `₹${money(d.closing)}`} {d.closingSide}
            </span>
          </div>
          <div className="card-body flush">
            <div className="ledger">
              <div>
                <table>
                  <caption>{isMetal ? 'Dr — Metal we gave them' : 'Dr — What they owe'}</caption>
                  <tbody>
                    {d.debits.map((r: any, i: number) => (
                      <tr key={i}>
                        <td style={{ width: 92 }}>{dmy(r.entry_date)}</td>
                        <td>{r.particulars}</td>
                        <td className="mono small" style={{ width: 70 }}>{r.doc_no || ''}</td>
                        <td className="r num" style={{ width: 100 }}>{val(r)}</td>
                      </tr>
                    ))}
                    {d.credits.length > d.debits.length &&
                      Array.from({ length: d.credits.length - d.debits.length }, (_, i) => (
                        <tr key={`f${i}`}><td colSpan={4}>&nbsp;</td></tr>
                      ))}
                  </tbody>
                  <tfoot>
                    <tr><td colSpan={3}>Total</td><td className="r num">{total(d.grandTotal)}</td></tr>
                  </tfoot>
                </table>
              </div>
              <div>
                <table>
                  <caption>{isMetal ? 'Cr — Metal they gave us' : 'Cr — What they paid'}</caption>
                  <tbody>
                    {d.credits.map((r: any, i: number) => (
                      <tr key={i}>
                        <td style={{ width: 92 }}>{dmy(r.entry_date)}</td>
                        <td>{r.particulars}</td>
                        <td className="mono small" style={{ width: 70 }}>{r.doc_no || ''}</td>
                        <td className="r num" style={{ width: 100 }}>{val(r)}</td>
                      </tr>
                    ))}
                    {d.closingSide === 'Dr' && Math.abs(d.closing) > 0.005 && (
                      <tr><td colSpan={2} className="strong">By Balance c/d</td><td></td>
                        <td className="r num strong">{total(d.closing)}</td></tr>
                    )}
                    {d.debits.length > d.credits.length &&
                      Array.from({ length: d.debits.length - d.credits.length - (d.closingSide === 'Dr' ? 1 : 0) }, (_, i) => (
                        <tr key={`f${i}`}><td colSpan={4}>&nbsp;</td></tr>
                      ))}
                  </tbody>
                  <tfoot>
                    <tr><td colSpan={3}>Total</td><td className="r num">{total(d.grandTotal)}</td></tr>
                  </tfoot>
                </table>
              </div>
            </div>
            <div style={{ padding: '10px 14px', borderTop: '1px solid var(--line)' }}>
              <span className="strong">To Balance b/d</span>
              <span className="strong num" style={{ marginLeft: 12 }}>
                {isMetal ? `${wt(d.closing)} g fine` : `₹${money(d.closing)}`} {d.closingSide}
              </span>
            </div>
          </div>
        </div>
      ) : <Loading rows={6} />}
    </div>
  )
}
