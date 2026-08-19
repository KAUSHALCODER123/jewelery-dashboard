import React, { useState } from 'react'
import { Icon } from '../lib/icons'
import { Field, Input, Loading, useAsync } from '../lib/ui'
import { ReportActions } from '../lib/grid'
import { money, todayISO, wt } from '../lib/format'

/**
 * Changeover Check — this shop's books against the ones it is coming from.
 *
 * Every figure in this software has been checked against tests. That is not the
 * same as being right. The only thing that settles it is running both systems
 * over the same period and seeing whether they agree, so this screen exists to
 * make that possible — not to make it unnecessary.
 *
 * A blank box is reported as "not checked", never as agreement: an unanswered
 * question is not a pass.
 */
export default function Changeover() {
  const [asOn, setAsOn] = useState(todayISO())
  const [theirs, setTheirs] = useState<Record<string, string>>({})
  const rep = useAsync(
    () => window.api.reports.reconcile({ as_on: asOn, expected: theirs }),
    [asOn, theirs]
  )
  const d = rep.data

  const set = (k: string, v: string) => setTheirs((t) => ({ ...t, [k]: v }))
  const fmt = (v: any, unit: string) =>
    v === null || v === undefined ? '—' : unit === 'g' ? `${wt(v)} g` : `₹${money(v)}`

  const report = () => ({
    baseName: `changeover-${asOn}`,
    title: `Changeover Check as on ${asOn}`,
    meta: d ? `${d.agreeing} of ${d.checked} figures agree` : '',
    headers: ['Figure', 'This software', 'Your old books', 'Difference', 'Status'],
    rows: (d?.rows || []).map((r: any) => [
      r.label, fmt(r.ours, r.unit), fmt(r.theirs, r.unit),
      r.difference === null ? '' : fmt(r.difference, r.unit), r.status,
    ]),
  })

  return (
    <div className="content-narrow">
      <div className="toolbar">
        <Field label="Balances as on">
          <Input type="date" value={asOn} onChange={(e) => setAsOn(e.target.value)}
            style={{ width: 160 }} />
        </Field>
        <span className="spacer" />
        {d && <ReportActions build={report} />}
      </div>

      <div className="note" style={{ marginBottom: 14 }}>
        <b>Run both systems side by side before you trust this one.</b> Keep entering the
        day's work in whatever you use now as well, for a week or a month. Then type what
        that system says below and see whether the two agree. Anything that does not match
        is worth chasing before you switch over — not after.
      </div>

      {rep.loading || !d ? <Loading rows={6} /> : (
        <>
          <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(3, minmax(0,1fr))' }}>
            <div className="stat"><div className="stat-label">Figures Checked</div>
              <div className="stat-value num">{d.checked} <span className="muted">/ {d.rows.length}</span></div>
              <div className="stat-meta">Fill a box in to check it</div></div>
            <div className="stat"><div className="stat-label">Agree</div>
              <div className="stat-value num" style={{ color: d.agreeing ? 'var(--ok)' : undefined }}>
                {d.agreeing}</div></div>
            <div className="stat"><div className="stat-label">Differ</div>
              <div className="stat-value num" style={{ color: d.differing ? 'var(--danger)' : undefined }}>
                {d.differing}</div>
              <div className="stat-meta">Chase these before switching</div></div>
          </div>

          {d.uncostedPieces > 0 && (
            <div className="note" style={{ marginBottom: 12 }}>
              {d.uncostedPieces} piece{d.uncostedPieces === 1 ? '' : 's'} in stock
              {d.uncostedPieces === 1 ? ' has' : ' have'} no <b>Cost/Gm</b> recorded, so
              {d.uncostedPieces === 1 ? ' it is' : ' they are'} left out of the stock value
              entirely. That is the most common reason the stock figure will not tie — fill
              the cost in on the Stock Report and check again.
            </div>
          )}

          <div className="card">
            <div className="card-head">
              <span className="card-title">Your old books, against this one</span>
            </div>
            <div className="card-body flush">
              <table className="data">
                <thead>
                  <tr><th>Figure</th><th className="r">This software</th>
                    <th className="r" style={{ width: 170 }}>Your old books</th>
                    <th className="r">Difference</th><th>Status</th></tr>
                </thead>
                <tbody>
                  {d.rows.map((r: any) => (
                    <tr key={r.key}
                      className={r.status === 'differs' ? 'row-bad' : r.status === 'agrees' ? 'row-ok' : ''}>
                      <td className="strong">{r.label}
                        {r.status === 'differs' && (
                          <div className="small muted" style={{ marginTop: 2 }}>{r.where}</div>
                        )}
                      </td>
                      <td className="r num strong">{fmt(r.ours, r.unit)}</td>
                      <td className="r">
                        <Input className="right" value={theirs[r.key] ?? ''}
                          placeholder={r.unit === 'g' ? 'grams' : '₹'}
                          onChange={(e) => set(r.key, e.target.value)} />
                      </td>
                      <td className="r num strong"
                        style={{ color: r.status === 'differs' ? 'var(--danger)' : undefined }}>
                        {r.difference === null ? '—' : fmt(r.difference, r.unit)}
                      </td>
                      <td>
                        {r.status === 'agrees'
                          ? <span className="badge badge-ok">Agrees</span>
                          : r.status === 'differs'
                            ? <span className="badge badge-danger">Differs</span>
                            : <span className="badge badge-mute">Not checked</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* A debtors difference is chased customer by customer, so the list is
              here rather than a screen away. */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginTop: 14 }}>
            <PartyList title="Customers owe us" rows={d.debtors} />
            <PartyList title="We owe suppliers" rows={d.creditors} />
          </div>
        </>
      )}
    </div>
  )
}

function PartyList({ title, rows }: { title: string; rows: any[] }) {
  return (
    <div className="card">
      <div className="card-head">
        <span className="card-title">{title}</span>
        <span className="hint" style={{ marginLeft: 'auto' }}>{(rows || []).length} parties</span>
      </div>
      <div className="card-body flush">
        {!(rows || []).length ? (
          <p className="small muted" style={{ padding: 14 }}>Nobody.</p>
        ) : (
          <div className="table-wrap" style={{ maxHeight: 260 }}>
            <table className="data">
              <thead><tr><th>Name</th><th className="r">Amount</th></tr></thead>
              <tbody>
                {rows.map((r: any) => (
                  <tr key={r.name}>
                    <td>{r.name}</td>
                    <td className="r num strong">₹{money(r.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
