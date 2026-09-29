import React, { useMemo, useState } from 'react'
import { Icon } from '../lib/icons'
import {
  Autocomplete, Confirm, Empty, Field, Input, Loading, Modal, Segmented, Select,
  useAction, useAsync, useDebounced,
} from '../lib/ui'
import { num, r3 } from '../lib/calc'
import { dmy, money, todayISO } from '../lib/format'

/* The four scheme types differ in what the member accumulates: 'On Amount' and
   'On Making' accrue rupees, the other two accrue grams. 'On Weight' fixes the
   rupees paid each period and lets the grams follow that day's rate; 'Weight
   Wise' fixes the grams and lets the rupees follow. */
const GSS_TYPES = ['On Amount', 'On Making', 'On Weight', 'Weight Wise']
const isWeight = (t: string) => t === 'On Weight' || t === 'Weight Wise'
/** Singular period noun for labels — 'Months' → 'Monthly', 'Days' → 'Daily'. */
const perLabel = (unit: string) =>
  unit === 'Days' ? 'Daily' : unit === 'Years' ? 'Yearly' : 'Monthly'
const gm = (n: any) => `${r3(num(n)).toFixed(3)} g`

const SCHEME_HINT: Record<string, string> = {
  'On Amount': 'Fixed rupees each period; the balance is rupees',
  'On Making': 'Fixed rupees, plus a making-charge waiver at maturity',
  'On Weight': "Fixed rupees, converted to grams at the day's rate",
  'Weight Wise': "Fixed grams; the member pays that day's rate",
}

/** What the member ends up with — the one line that makes a scheme legible. */
function SchemeSummary({ s }: { s: any }) {
  const paying = num(s.paying_periods)
  const unit = String(s.period_unit || 'Months').toLowerCase()
  if (s.scheme_type === 'Weight Wise') {
    const g = num(s.monthly_weight)
    return (
      <>
        <div className="small muted">
          {gm(g)} × {paying} {unit} + {gm(s.bonus_weight)} benefit — the member pays
          whatever those grams cost on each due date
        </div>
        <div className="strong num" style={{ fontSize: 18, marginTop: 3 }}>
          Weight at maturity: {gm(g * paying + num(s.bonus_weight))} {s.metal || 'Gold'}
        </div>
      </>
    )
  }
  const rs = num(s.monthly_amount)
  if (s.scheme_type === 'On Weight') {
    return (
      <>
        <div className="small muted">
          ₹{money(rs)} × {paying} {unit} = <b>₹{money(rs * paying)}</b>, each instalment
          converted to grams at the rate on the day it is paid, + {gm(s.bonus_weight)} benefit
        </div>
        <div className="strong num" style={{ fontSize: 18, marginTop: 3 }}>
          Balance accrues in {s.metal || 'Gold'} — the member is hedged against the rate
        </div>
      </>
    )
  }
  const bonus = num(s.maturity_bonus)
  return (
    <>
      <div className="small muted">
        {money(rs)} × {paying} {unit}
        {s.scheme_type === 'On Making'
          ? ` + ${num(s.making_disc_pct)}% making waiver at maturity`
          : ` + ${money(bonus)} benefit`}
      </div>
      <div className="strong num" style={{ fontSize: 18, marginTop: 3 }}>
        Value at maturity: ₹{money(rs * paying + (s.scheme_type === 'On Making' ? 0 : bonus))}
      </div>
    </>
  )
}

export default function Schemes() {
  const [tab, setTab] = useState<'members' | 'schemes'>('members')
  return (
    <div>
      <div className="tabs">
        <button className="tab" aria-selected={tab === 'members'} onClick={() => setTab('members')}>
          Members
        </button>
        <button className="tab" aria-selected={tab === 'schemes'} onClick={() => setTab('schemes')}>
          Scheme Types
        </button>
      </div>
      {tab === 'members' ? <Members /> : <SchemeTypes />}
    </div>
  )
}

/* ───────────────────────────── Members ───────────────────────────── */

function Members() {
  const [search, setSearch] = useState('')
  const q = useDebounced(search, 250)
  const [filter, setFilter] = useState('open')
  const [assigning, setAssigning] = useState(false)
  const [merging, setMerging] = useState(false)
  const [openId, setOpenId] = useState<number | null>(null)

  const list = useAsync(
    () => window.api.gss.accounts({
      search: q, closed: filter === 'all' ? undefined : filter === 'open' ? 0 : 1,
    }),
    [q, filter]
  )
  const rows = list.data || []
  const collected = rows.reduce((s: number, r: any) => s + num(r.paid_amount), 0)
  const accrued = rows.reduce((s: number, r: any) => s + num(r.paid_weight), 0)
  const overdue = rows.filter((r: any) => num(r.overdue_count) > 0).length

  if (openId) {
    return <MemberDetail id={openId} onBack={() => { setOpenId(null); list.reload() }} />
  }

  return (
    <div>
      <div className="toolbar">
        <Segmented value={filter} onChange={setFilter}
          options={[
            { value: 'open', label: 'Active' },
            { value: 'closed', label: 'Closed' },
            { value: 'all', label: 'All' },
          ]} />
        <div className="search-box">
          <Icon.search />
          <input className="input" placeholder="Member or G.S. no…" value={search}
            onChange={(e) => setSearch(e.target.value)} />
        </div>
        <span className="spacer" />
        <button className="btn" onClick={() => setMerging(true)}>Merge Cards</button>
        <button className="btn btn-primary" onClick={() => setAssigning(true)}>
          <Icon.plus /> Enrol Member
        </button>
      </div>

      <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(4, minmax(0,1fr))' }}>
        <div className="stat"><div className="stat-label">Members</div>
          <div className="stat-value num">{rows.length}</div></div>
        <div className="stat"><div className="stat-label">Collected</div>
          <div className="stat-value num">₹{money(collected)}</div></div>
        <div className="stat"><div className="stat-label">Metal Accrued</div>
          <div className="stat-value num gold">{gm(accrued)}</div>
          <div className="stat-meta">On weight schemes</div></div>
        <div className="stat"><div className="stat-label">With Overdue Instalments</div>
          <div className="stat-value num" style={{ color: overdue ? 'var(--danger)' : undefined }}>{overdue}</div></div>
      </div>

      <div className="card">
        <div className="card-body flush">
          {list.loading ? <Loading /> : !rows.length ? (
            <Empty icon={Icon.receipt} title="No scheme members"
              action={<button className="btn btn-primary btn-sm" onClick={() => setAssigning(true)}>Enrol a member</button>}>
              Members pay a fixed amount each month; you add a bonus at maturity.
            </Empty>
          ) : (
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr><th>G.S. No</th><th>Member</th><th>Scheme</th><th>Start</th><th>Maturity</th>
                    <th className="r">Per Period</th><th className="r">Paid</th><th className="r">Accrued</th>
                    <th>Progress</th><th></th></tr>
                </thead>
                <tbody>
                  {rows.map((r: any) => (
                    <tr key={r.id} className="clickable" onClick={() => setOpenId(r.id)}>
                      <td className="mono strong">{r.gs_no}</td>
                      <td>{r.party_name}</td>
                      <td className="muted">
                        {r.scheme_name}
                        {isWeight(r.scheme_type) && (
                          <span className="badge badge-gold" style={{ marginLeft: 4 }}>{r.scheme_type}</span>
                        )}
                      </td>
                      <td>{dmy(r.start_date)}</td>
                      <td>{dmy(r.maturity_date)}</td>
                      <td className="r num">
                        {r.scheme_type === 'Weight Wise' ? gm(r.monthly_weight) : money(r.monthly_amount)}
                      </td>
                      <td className="r num strong">₹{money(r.paid_amount)}</td>
                      <td className="r num">
                        {isWeight(r.scheme_type)
                          ? <span className="strong gold">{gm(r.paid_weight)}</span>
                          : <span className="muted">—</span>}
                      </td>
                      <td>
                        <span className="badge badge-mute">
                          {r.paid_count} / {r.paying_periods}
                        </span>
                        {num(r.overdue_count) > 0 && (
                          <span className="badge badge-danger" style={{ marginLeft: 4 }}>
                            {r.overdue_count} due
                          </span>
                        )}
                      </td>
                      <td className="r">
                        {r.closed ? <span className="badge badge-mute">Closed</span> : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {assigning && (
        <AssignModal onClose={() => setAssigning(false)}
          onSaved={() => { setAssigning(false); list.reload() }} />
      )}

      {merging && (
        <MergeModal accounts={rows} onClose={() => setMerging(false)}
          onSaved={() => { setMerging(false); list.reload() }} />
      )}
    </div>
  )
}

/**
 * Merging two cards a member holds. The receipts move across rather than being
 * summed into a total — they are the evidence of what was paid and when, and a
 * weight scheme's gram history depends on the rate on each one.
 */
function MergeModal({ accounts, onClose, onSaved }: {
  accounts: any[]; onClose: () => void; onSaved: () => void
}) {
  const run = useAction()
  const [from, setFrom] = useState('')
  const [into, setInto] = useState('')
  const src = accounts.find((a: any) => String(a.id) === from)
  // Only cards of the same customer, type and metal can absorb this one — the
  // engine refuses anything else, so the list should not offer it either.
  const targets = accounts.filter((a: any) =>
    src && a.id !== src.id && a.party_id === src.party_id &&
    a.scheme_type === src.scheme_type && a.metal === src.metal)

  const label = (a: any) =>
    `${a.gs_no} — ${a.party_name} · ${a.scheme_name} (${a.scheme_type})`

  const save = async () => {
    const res = await run(
      () => window.api.gss.merge({ from_id: Number(from), into_id: Number(into) }),
      'Cards merged'
    )
    if (res) onSaved()
  }

  return (
    <Modal title="Merge Gold Saving Scheme Cards" onClose={onClose}
      footer={<><span className="spacer" />
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" disabled={!from || !into} onClick={save}>
          <Icon.save /> Merge
        </button></>}>
      <div className="form-grid cols-1">
        <Field label="Move this card" required>
          <Select value={from} placeholder="Select the card to close…"
            onChange={(v) => { setFrom(v); setInto('') }}
            options={accounts.filter((a: any) => !a.closed).map((a: any) => ({
              value: String(a.id), label: label(a),
            }))} />
        </Field>
        <Field label="Into this one" required
          hint={src ? 'Same customer, same scheme type and metal' : 'Choose a card to move first'}>
          <Select value={into} placeholder={src && !targets.length ? 'No matching card' : 'Select…'}
            onChange={setInto}
            options={targets.map((a: any) => ({ value: String(a.id), label: label(a) }))} />
        </Field>
        <div className="note" style={{ margin: 0 }}>
          Every <b>received</b> instalment moves across, keeping its own date, amount and rate —
          nothing is added up or thrown away. Instalments not yet paid belong to the closed
          card's own schedule and are dropped, since the surviving card has a schedule of its
          own. The card being moved is closed and marked with where it went.
        </div>
      </div>
    </Modal>
  )
}

function AssignModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const run = useAction()
  const schemes = useAsync(() => window.api.gss.schemes(), [])
  const [f, setF] = useState<any>({
    scheme_id: '', party_id: null, party_name: '', start_date: todayISO(),
    duration: '', paying_periods: '', monthly_amount: '', maturity_bonus: '',
    interest: 0, manual_no: '', remarks: '',
    scheme_type: 'On Amount', period_unit: 'Months', metal: 'Gold',
    monthly_weight: '', bonus_weight: '', making_disc_pct: '',
  })

  const scheme = (schemes.data || []).find((s: any) => String(s.id) === String(f.scheme_id))
  const weighted = isWeight(f.scheme_type)

  // The template's terms are copied onto the form, then frozen onto the account
  // at save — so editing the template later never rewrites this member's deal.
  const pickScheme = (v: string) => {
    const s = (schemes.data || []).find((x: any) => String(x.id) === v)
    setF({
      ...f, scheme_id: v,
      duration: s?.total_periods ?? '', paying_periods: s?.paying_periods ?? '',
      monthly_amount: s?.monthly_amount ?? '', maturity_bonus: s?.maturity_bonus ?? '',
      scheme_type: s?.scheme_type ?? 'On Amount', period_unit: s?.period_unit ?? 'Months',
      metal: s?.metal ?? 'Gold', monthly_weight: s?.monthly_weight ?? '',
      bonus_weight: s?.bonus_weight ?? '', making_disc_pct: s?.making_disc_pct ?? '',
    })
  }

  const paying = num(f.paying_periods)
  const monthly = num(f.monthly_amount)
  const bonus = num(f.maturity_bonus)

  const save = async () => {
    const res = await run(
      () => window.api.gss.assign({
        ...f,
        scheme_id: Number(f.scheme_id),
        duration: num(f.duration), paying_periods: paying,
        monthly_amount: monthly, maturity_bonus: bonus, interest: num(f.interest),
        monthly_weight: num(f.monthly_weight), bonus_weight: num(f.bonus_weight),
        making_disc_pct: num(f.making_disc_pct),
      }),
      'Member enrolled'
    )
    if (res) onSaved()
  }

  return (
    <Modal title="Enrol Member in Scheme" onClose={onClose}
      footer={<><span className="spacer" /><button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" onClick={save}><Icon.save /> Enrol</button></>}>
      <div className="form-grid cols-2">
        <Field label="Customer" required className="span-2">
          <Autocomplete value={f.party_name} placeholder="Search customer…"
            onText={(s) => setF({ ...f, party_name: s, party_id: null })}
            onPick={(p: any) => setF({ ...f, party_id: p.id, party_name: p.name })}
            fetch={(q) => window.api.party.list({ type: 'CUSTOMER', search: q })}
            render={(p: any) => <span><b>{p.name}</b>{p.mobile ? <span className="muted"> · {p.mobile}</span> : null}</span>} />
        </Field>

        <Field label="Scheme" required className="span-2">
          <Select value={f.scheme_id} placeholder="Select a scheme…" onChange={pickScheme}
            options={(schemes.data || []).map((s: any) => ({
              value: String(s.id),
              label: `${s.code} — ${s.name} · ${s.scheme_type} · ${
                s.scheme_type === 'Weight Wise' ? gm(s.monthly_weight) : `₹${money(s.monthly_amount)}`
              } × ${s.paying_periods}`,
            }))} />
        </Field>

        <Field label="Start Date">
          <Input type="date" value={f.start_date}
            onChange={(e) => setF({ ...f, start_date: e.target.value })} />
        </Field>
        <Field label={`Total ${f.period_unit}`} hint="Including the bonus period">
          <Input className="right" value={f.duration}
            onChange={(e) => setF({ ...f, duration: e.target.value })} />
        </Field>
        <Field label={`Paying ${f.period_unit}`}>
          <Input className="right" value={f.paying_periods}
            onChange={(e) => setF({ ...f, paying_periods: e.target.value })} />
        </Field>
        {f.scheme_type === 'Weight Wise' ? (
          <Field label={`${perLabel(f.period_unit)} Weight (g)`}>
            <Input className="right" value={f.monthly_weight}
              onChange={(e) => setF({ ...f, monthly_weight: e.target.value })} />
          </Field>
        ) : (
          <Field label={`${perLabel(f.period_unit)} Amount (₹)`}>
            <Input className="right" value={f.monthly_amount}
              onChange={(e) => setF({ ...f, monthly_amount: e.target.value })} />
          </Field>
        )}
        {weighted ? (
          <Field label="Benefit After Maturity (g)" hint="The shop's contribution">
            <Input className="right" value={f.bonus_weight}
              onChange={(e) => setF({ ...f, bonus_weight: e.target.value })} />
          </Field>
        ) : f.scheme_type === 'On Making' ? (
          <Field label="Making Waiver (%)" hint="Applied when the scheme is redeemed">
            <Input className="right" value={f.making_disc_pct}
              onChange={(e) => setF({ ...f, making_disc_pct: e.target.value })} />
          </Field>
        ) : (
          <Field label="Benefit After Maturity (₹)" hint="The shop's contribution">
            <Input className="right" value={f.maturity_bonus}
              onChange={(e) => setF({ ...f, maturity_bonus: e.target.value })} />
          </Field>
        )}
        <Field label="Remarks">
          <Input value={f.remarks} onChange={(e) => setF({ ...f, remarks: e.target.value })} />
        </Field>

        {scheme && (
          <div className="span-2" style={{
            background: 'var(--gold-soft)', border: '1px solid var(--gold-line)',
            borderRadius: 'var(--radius)', padding: '10px 14px',
          }}>
            <SchemeSummary s={f} />
          </div>
        )}
      </div>
    </Modal>
  )
}

function MemberDetail({ id, onBack }: { id: number; onBack: () => void }) {
  const run = useAction()
  const acct = useAsync(() => window.api.gss.readAccount({ id }), [id])
  const [receiving, setReceiving] = useState<any>(null)
  const [confirmDel, setConfirmDel] = useState(false)
  const a = acct.data

  if (acct.loading || !a) return <Loading rows={6} />

  const pct = a.expected_amount > 0
    ? Math.min(100, Math.round((a.paid_amount / a.expected_amount) * 100)) : 0

  const sendReminder = async () => {
    const next = a.receipts.find((r: any) => r.status === 'PENDING')
    const text =
      `Namaste ${a.party_name}, your gold saving scheme ${a.gs_no} instalment of ` +
      `Rs. ${money(next?.amount ?? a.monthly_amount)} is due on ${dmy(next?.due_date)}. ` +
      `Paid so far: Rs. ${money(a.paid_amount)}. Thank you.`
    const res = await window.api.send.whatsapp({ mobile: a.mobile, text })
    if (!res?.ok) run(async () => { throw new Error(res?.error || 'Could not open WhatsApp') })
  }

  return (
    <div>
      <div className="toolbar">
        <button className="btn btn-ghost" onClick={onBack}><Icon.back /> Back</button>
        <span className="page-title">{a.gs_no} · {a.party_name}</span>
        {!!a.closed && <span className="badge badge-mute">Closed</span>}
        <span className="spacer" />
        <button className="btn btn-sm" onClick={sendReminder}><Icon.whatsapp /> Remind</button>
        <button className="btn btn-sm" onClick={async () => {
          await run(() => window.api.gss.closeAccount({ id, closed: a.closed ? 0 : 1 }),
            a.closed ? 'Reopened' : 'Closed')
          acct.reload()
        }}>{a.closed ? 'Reopen' : 'Close Account'}</button>
        <button className="btn btn-danger btn-sm" onClick={() => setConfirmDel(true)}>
          <Icon.trash /> Delete
        </button>
      </div>

      <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(4, minmax(0,1fr))' }}>
        <div className="stat"><div className="stat-label">Paid So Far</div>
          <div className="stat-value num">₹{money(a.paid_amount)}</div>
          <div className="stat-meta">
            {a.weighted ? `${a.paid_count} of ${a.paying_periods} instalments`
              : `${pct}% of ₹${money(a.expected_amount)}`}
          </div></div>
        <div className="stat"><div className="stat-label">
            {a.weighted ? `${a.metal} Accrued` : perLabel(a.period_unit)}</div>
          <div className="stat-value num">
            {a.weighted ? gm(a.paid_weight)
              : a.scheme_type === 'Weight Wise' ? gm(a.monthly_weight)
              : `₹${money(a.monthly_amount)}`}
          </div>
          <div className="stat-meta">
            {a.weighted ? 'From the rate on each due date' : `${a.paying_periods} instalments`}
          </div></div>
        <div className="stat"><div className="stat-label">Shop Benefit</div>
          <div className="stat-value num">
            {a.weighted ? gm(a.bonus_weight)
              : a.scheme_type === 'On Making' ? `${num(a.making_disc_pct)}%`
              : `₹${money(a.maturity_bonus)}`}
          </div>
          <div className="stat-meta">
            {a.scheme_type === 'On Making' ? 'Making waiver at maturity' : 'Added at maturity'}
          </div></div>
        <div className="stat"><div className="stat-label">
            {a.weighted ? 'Balance at Maturity' : 'Value at Maturity'}</div>
          <div className="stat-value num gold">
            {a.weighted ? gm(a.maturity_weight) : `₹${money(a.maturity_value)}`}
          </div>
          <div className="stat-meta">
            {dmy(a.maturity_date)}{a.matured ? ' · matured' : ''}
          </div></div>
      </div>

      {a.weighted && (
        <div className="note" style={{ marginBottom: 12 }}>
          A weight scheme accrues <b>grams</b>. Each instalment is converted at the {a.metal} rate
          entered on the day it is received, so what the member can spend follows the metal, not
          the rupees they paid.
        </div>
      )}

      <div className="card">
        <div className="card-head">
          <span className="card-title">Instalment Schedule</span>
          <span className="hint" style={{ marginLeft: 'auto' }}>{a.scheme_name}</span>
        </div>
        <div className="card-body flush">
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr><th>#</th><th>Due Date</th><th>Received</th><th>Receipt No</th>
                  <th>Mode</th><th className="r">Amount</th>
                  {a.weighted && <><th className="r">Rate</th><th className="r">Weight</th></>}
                  <th>Status</th><th></th></tr>
              </thead>
              <tbody>
                {a.receipts.map((r: any, i: number) => {
                  const overdue = r.status === 'PENDING' && r.due_date <= todayISO()
                  return (
                    <tr key={r.id} className={r.status === 'RECEIVED' ? 'row-ok' : overdue ? 'row-bad' : ''}>
                      <td className="muted">{i + 1}</td>
                      <td>{dmy(r.due_date)}</td>
                      <td>{r.received_date ? dmy(r.received_date) : <span className="muted">—</span>}</td>
                      <td className="mono small">{r.receipt_no || '—'}</td>
                      <td className="small">{r.payment_type || '—'}</td>
                      <td className="r num strong">
                        {num(r.amount) > 0 ? `₹${money(r.amount)}` : <span className="muted">—</span>}
                      </td>
                      {a.weighted && (
                        <>
                          <td className="r num">
                            {num(r.rate) > 0 ? money(r.rate) : <span className="muted">—</span>}
                          </td>
                          <td className="r num strong">
                            {num(r.weight) > 0 ? gm(r.weight) : <span className="muted">—</span>}
                          </td>
                        </>
                      )}
                      <td>
                        {r.status === 'RECEIVED' ? <span className="badge badge-ok">Received</span>
                          : r.status === 'INTEREST' ? <span className="badge badge-gold">Shop benefit</span>
                          : overdue ? <span className="badge badge-danger">Overdue</span>
                          : <span className="badge badge-mute">Pending</span>}
                      </td>
                      <td className="r">
                        {r.status === 'PENDING' && !a.closed && (
                          <button className="btn btn-primary btn-sm" onClick={() => setReceiving(r)}>
                            Receive
                          </button>
                        )}
                        {r.status === 'RECEIVED' && (
                          <button className="btn btn-ghost btn-sm" onClick={async () => {
                            await run(() => window.api.gss.unreceive({ receipt_id: r.id }), 'Reverted')
                            acct.reload()
                          }}>Undo</button>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={5}>Received {a.paid_count} of {a.paying_periods}</td>
                  <td className="r num">₹{money(a.paid_amount)}</td>
                  {a.weighted && <><td></td><td className="r num strong">{gm(a.paid_weight)}</td></>}
                  <td colSpan={2}></td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      </div>

      {receiving && (
        <ReceiveModal r={receiving} acct={a} onClose={() => setReceiving(null)}
          onSaved={() => { setReceiving(null); acct.reload() }} />
      )}

      {confirmDel && (
        <Confirm title="Delete this member account?"
          message="All instalments and their postings will be removed."
          onConfirm={async () => {
            setConfirmDel(false)
            const ok = await run(() => window.api.gss.removeAccount({ id }), 'Deleted')
            if (ok !== undefined) onBack()
          }}
          onCancel={() => setConfirmDel(false)} />
      )}
    </div>
  )
}

function ReceiveModal({ r, acct, onClose, onSaved }: {
  r: any; acct: any; onClose: () => void; onSaved: () => void
}) {
  const run = useAction()
  const wise = acct.scheme_type === 'Weight Wise'
  const [f, setF] = useState({
    receipt_id: r.id, amount: r.amount, weight: r.weight || acct.monthly_weight,
    rate: '', received_date: todayISO(),
    payment_type: 'Cash', bank_name: '', ref_no: '', manual_no: '',
  })
  const numField = (k: string) => (e: any) => {
    const t = e.target.value
    if (t === '' || /^\d*\.?\d*$/.test(t)) setF({ ...f, [k]: t })
  }

  // A weight scheme fixes one side of the conversion and computes the other, so
  // the member can see exactly what they are getting before the receipt is cut.
  const rate = num(f.rate)
  const computedWeight = rate > 0 ? r3(num(f.amount) / rate) : 0
  const computedAmount = r3(num(f.weight) * rate)

  const save = async () => {
    const res = await run(
      () => window.api.gss.receive({
        ...f, amount: num(f.amount), weight: num(f.weight), rate: num(f.rate),
      }),
      'Instalment received'
    )
    if (res) onSaved()
  }

  return (
    <Modal title={`Receive Instalment — ${acct.gs_no}`} onClose={onClose}
      footer={<><span className="spacer" /><button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" onClick={save}><Icon.save /> Receive</button></>}>
      <div className="form-grid cols-2">
        <div className="span-2 small muted">
          {acct.party_name} · due {dmy(r.due_date)}
          {acct.weighted ? ` · ${acct.scheme_type}, accruing ${acct.metal}` : ''}
        </div>
        {wise ? (
          <Field label="Weight (g)" required hint="Fixed by the scheme">
            <Input autoFocus className="right" value={f.weight} onChange={numField('weight')} />
          </Field>
        ) : (
          <Field label="Amount (₹)" required>
            <Input autoFocus className="right" value={f.amount} onChange={numField('amount')} />
          </Field>
        )}
        {acct.weighted && (
          <Field label={`${acct.metal} Rate (₹/g)`} required hint="The rate on the day of payment">
            <Input className="right" value={f.rate} onChange={numField('rate')} />
          </Field>
        )}
        {acct.weighted && (
          <div className="span-2" style={{
            background: 'var(--gold-soft)', border: '1px solid var(--gold-line)',
            borderRadius: 'var(--radius)', padding: '8px 12px',
          }}>
            {rate <= 0 ? (
              <span className="small muted">Enter the {acct.metal} rate to convert this instalment.</span>
            ) : wise ? (
              <span className="small">
                {gm(f.weight)} at ₹{money(rate)}/g — member pays{' '}
                <b className="num">₹{money(computedAmount)}</b>
              </span>
            ) : (
              <span className="small">
                ₹{money(f.amount)} at ₹{money(rate)}/g — accrues{' '}
                <b className="num">{gm(computedWeight)}</b>
              </span>
            )}
          </div>
        )}
        <Field label="Received On">
          <Input type="date" value={f.received_date}
            onChange={(e) => setF({ ...f, received_date: e.target.value })} />
        </Field>
        <Field label="Payment Mode">
          <Select value={f.payment_type} onChange={(v) => setF({ ...f, payment_type: v })}
            options={['Cash', 'UPI', 'Card', 'NEFT', 'Cheque'].map((m) => ({ value: m, label: m }))} />
        </Field>
        <Field label="Reference No">
          <Input value={f.ref_no} onChange={(e) => setF({ ...f, ref_no: e.target.value })} />
        </Field>
      </div>
    </Modal>
  )
}

/* ───────────────────────────── Scheme types ───────────────────────────── */

function SchemeTypes() {
  const run = useAction()
  const list = useAsync(() => window.api.gss.schemes(), [])
  const [editing, setEditing] = useState<any>(null)

  const blank = {
    id: null, code: '', name: '', scheme_type: 'On Amount', period_unit: 'Months',
    total_periods: 12, paying_periods: 11, bonus_periods: 1,
    monthly_amount: 1000, maturity_bonus: 1000,
    metal: 'Gold', monthly_weight: 0, bonus_weight: 0, making_disc_pct: 0,
  }

  const save = async () => {
    if (!editing.name?.trim()) return run(async () => { throw new Error('Scheme name is required') })
    const ok = await run(() => window.api.gss.saveScheme({
      ...editing,
      total_periods: num(editing.total_periods),
      paying_periods: num(editing.paying_periods),
      bonus_periods: num(editing.bonus_periods),
      monthly_amount: num(editing.monthly_amount),
      maturity_bonus: num(editing.maturity_bonus),
      monthly_weight: num(editing.monthly_weight),
      bonus_weight: num(editing.bonus_weight),
      making_disc_pct: num(editing.making_disc_pct),
    }), 'Scheme saved')
    if (ok !== undefined) { setEditing(null); list.reload() }
  }

  return (
    <div className="content-narrow">
      <div className="toolbar">
        <span className="spacer" />
        <button className="btn btn-primary" onClick={() => setEditing({ ...blank })}>
          <Icon.plus /> New Scheme
        </button>
      </div>

      <div className="card">
        <div className="card-body flush">
          {list.loading ? <Loading rows={3} /> : !list.data?.length ? (
            <Empty icon={Icon.gem} title="No schemes defined"
              action={<button className="btn btn-primary btn-sm" onClick={() => setEditing({ ...blank })}>Create a scheme</button>}>
              Define the template once, then enrol members against it.
            </Empty>
          ) : (
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr><th>Code</th><th>Name</th><th>Type</th><th className="r">Per Period</th>
                    <th className="r">Paying</th><th className="r">Total</th><th className="r">Benefit</th>
                    <th className="r">Maturity Value</th><th></th></tr>
                </thead>
                <tbody>
                  {list.data.map((s: any) => {
                    const w = isWeight(s.scheme_type)
                    return (
                    <tr key={s.id}>
                      <td className="mono strong">{s.code}</td>
                      <td>{s.name}</td>
                      <td>
                        <span className={`badge ${w ? 'badge-gold' : 'badge-mute'}`}>{s.scheme_type}</span>
                        <span className="muted small"> · {s.period_unit}</span>
                      </td>
                      <td className="r num">
                        {s.scheme_type === 'Weight Wise' ? gm(s.monthly_weight) : `₹${money(s.monthly_amount)}`}
                      </td>
                      <td className="r num">{s.paying_periods}</td>
                      <td className="r num">{s.total_periods}</td>
                      <td className="r num">
                        {w ? gm(s.bonus_weight)
                          : s.scheme_type === 'On Making' && num(s.making_disc_pct) > 0
                            ? `${num(s.making_disc_pct)}% making`
                            : `₹${money(s.maturity_bonus)}`}
                      </td>
                      <td className="r num strong gold">
                        {s.scheme_type === 'Weight Wise'
                          ? gm(num(s.monthly_weight) * num(s.paying_periods) + num(s.bonus_weight))
                          : s.scheme_type === 'On Weight'
                            ? `₹${money(num(s.monthly_amount) * num(s.paying_periods))} + ${gm(s.bonus_weight)}`
                            : `₹${money(num(s.monthly_amount) * num(s.paying_periods) + num(s.maturity_bonus))}`}
                      </td>
                      <td className="r">
                        <button className="btn btn-ghost btn-icon btn-sm" aria-label="Edit"
                          onClick={() => setEditing(s)}><Icon.edit /></button>
                        <button className="btn btn-ghost btn-icon btn-sm" aria-label="Delete"
                          onClick={async () => {
                            await run(() => window.api.gss.removeScheme({ id: s.id }), 'Scheme deleted')
                            list.reload()
                          }}><Icon.trash /></button>
                      </td>
                    </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {editing && (
        <Modal title={editing.id ? 'Edit Scheme' : 'New Scheme'} onClose={() => setEditing(null)}
          footer={<><span className="spacer" /><button className="btn" onClick={() => setEditing(null)}>Cancel</button>
            <button className="btn btn-primary" onClick={save}><Icon.save /> Save</button></>}>
          <div className="form-grid cols-2">
            <Field label="Scheme Name" required className="span-2">
              <Input autoFocus value={editing.name} placeholder="e.g. 11 + 1 Gold Plan"
                onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
            </Field>
            <Field label="Scheme Type" hint={SCHEME_HINT[editing.scheme_type as string]}>
              <Select value={editing.scheme_type}
                onChange={(v) => setEditing({ ...editing, scheme_type: v })}
                options={GSS_TYPES.map((t) => ({ value: t, label: t }))} />
            </Field>
            <Field label="Period">
              <Select value={editing.period_unit}
                onChange={(v) => setEditing({ ...editing, period_unit: v })}
                options={['Days', 'Months', 'Years'].map((u) => ({ value: u, label: u }))} />
            </Field>

            {editing.scheme_type === 'Weight Wise' ? (
              <Field label={`${perLabel(editing.period_unit)} Weight (g)`}
                hint="Fixed grams; the member pays that day's rate">
                <Input className="right" value={editing.monthly_weight}
                  onChange={(e) => setEditing({ ...editing, monthly_weight: e.target.value })} />
              </Field>
            ) : (
              <Field label={`${perLabel(editing.period_unit)} Amount (₹)`}>
                <Input className="right" value={editing.monthly_amount}
                  onChange={(e) => setEditing({ ...editing, monthly_amount: e.target.value })} />
              </Field>
            )}
            <Field label={`Paying ${editing.period_unit}`}>
              <Input className="right" value={editing.paying_periods}
                onChange={(e) => setEditing({ ...editing, paying_periods: e.target.value })} />
            </Field>
            <Field label={`Total ${editing.period_unit}`} hint="Paying + bonus">
              <Input className="right" value={editing.total_periods}
                onChange={(e) => setEditing({ ...editing, total_periods: e.target.value })} />
            </Field>

            {isWeight(editing.scheme_type) ? (
              <Field label="Benefit at Maturity (g)" hint="The shop's contribution, in grams">
                <Input className="right" value={editing.bonus_weight}
                  onChange={(e) => setEditing({ ...editing, bonus_weight: e.target.value })} />
              </Field>
            ) : editing.scheme_type === 'On Making' ? (
              <Field label="Making Waiver (%)" hint="Making charges written off at redemption">
                <Input className="right" value={editing.making_disc_pct}
                  onChange={(e) => setEditing({ ...editing, making_disc_pct: e.target.value })} />
              </Field>
            ) : (
              <Field label="Benefit at Maturity (₹)">
                <Input className="right" value={editing.maturity_bonus}
                  onChange={(e) => setEditing({ ...editing, maturity_bonus: e.target.value })} />
              </Field>
            )}
            {isWeight(editing.scheme_type) && (
              <Field label="Metal">
                <Select value={editing.metal} onChange={(v) => setEditing({ ...editing, metal: v })}
                  options={['Gold', 'Silver', 'Platinum'].map((m) => ({ value: m, label: m }))} />
              </Field>
            )}

            <div className="span-2" style={{
              background: 'var(--gold-soft)', border: '1px solid var(--gold-line)',
              borderRadius: 'var(--radius)', padding: '10px 14px',
            }}>
              <SchemeSummary s={editing} />
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}
