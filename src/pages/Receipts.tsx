import React, { useEffect, useState } from 'react'
import { Icon } from '../lib/icons'
import {
  Autocomplete, Empty, Field, Input, Loading, Modal, Segmented, Select,
  useAction, useAsync,
} from '../lib/ui'
import { drcr, dmy, money, monthStartISO, todayISO, wt } from '../lib/format'

const blank = () => ({
  kind: 'RECEIPT',
  voucher_date: todayISO(),
  party_id: null as number | null,
  party_name: '',
  amount: '',
  narration: '',
  payment_type: 'Cash',
  bank_name: '',
  ref_no: '',
  manual_no: '',
})

export default function Receipts({ partyId, voucherKind }: { partyId?: number; voucherKind?: string } = {}) {
  const [from, setFrom] = useState(monthStartISO())
  const [to, setTo] = useState(todayISO())
  const [kind, setKind] = useState(voucherKind === 'PAYMENT' ? 'PAYMENT' : 'RECEIPT')
  const [editing, setEditing] = useState<any>(null)
  const run = useAction()

  // Opened from a customer, the ledger or Outstanding: the receipt starts with
  // that party picked, so it is not searched for a second time.
  useEffect(() => {
    if (!partyId) return
    window.api.party.read({ id: partyId }).then((p: any) => {
      if (p) setEditing({ ...blank(), kind, party_id: p.id, party_name: p.name })
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [partyId])

  const isSettle = kind === 'SETTLE'
  const list = useAsync(
    () => (isSettle
      ? window.api.stockSettlement.list({ from, to })
      : window.api.voucher.list({ kind, from, to })),
    [kind, from, to]
  )
  const total = (list.data || []).reduce(
    (s: number, r: any) => s + (Number(kind === 'SETTLE' ? r.bill_amount : r.amount) || 0), 0)

  return (
    <div className="content-narrow">
      <div className="toolbar">
        <Segmented value={kind} onChange={setKind}
          options={[
            { value: 'RECEIPT', label: 'Receipts' },
            { value: 'PAYMENT', label: 'Payments' },
            { value: 'SETTLE', label: 'Metal Settlement' },
          ]} />
        <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} style={{ width: 150 }} />
        <span className="muted">to</span>
        <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} style={{ width: 150 }} />
        <span className="spacer" />
        <button className="btn btn-primary" onClick={() => setEditing({ ...blank(), kind })}>
          <Icon.plus /> New {kind === 'RECEIPT' ? 'Receipt' : kind === 'PAYMENT' ? 'Payment' : 'Settlement'}
        </button>
      </div>

      <div className="card">
        <div className="card-head">
          <span className="card-title">
            {kind === 'RECEIPT' ? 'Money In' : kind === 'PAYMENT' ? 'Money Out' : 'Metal Settled for Cash'}
          </span>
          <span className="badge badge-gold" style={{ marginLeft: 'auto' }}>₹{money(total)}</span>
        </div>
        <div className="card-body flush">
          {list.loading ? <Loading rows={4} /> : !list.data?.length ? (
            <Empty icon={Icon.receipt} title={`No ${kind.toLowerCase()}s in this period`}
              action={<button className="btn btn-primary btn-sm" onClick={() => setEditing({ ...blank(), kind })}>
                Record one</button>} />
          ) : (
            <div className="table-wrap">
              <table className="data">
                <thead>
                  {isSettle ? (
                    <tr><th>Doc</th><th>Date</th><th>Party</th><th>Direction</th>
                      <th className="r">Fine Wt</th><th className="r">Rate/Gm</th>
                      <th className="r">Amount</th><th></th></tr>
                  ) : (
                    <tr><th>Voucher</th><th>Date</th><th>Party</th><th>Mode</th><th>Reference</th><th className="r">Amount</th><th></th></tr>
                  )}
                </thead>
                <tbody>
                  {list.data.map((r: any) => (
                    <tr key={r.id}>
                      <td className="mono strong">{isSettle ? r.settle_no : r.voucher_no}</td>
                      <td>{dmy(isSettle ? r.settle_date : r.voucher_date)}</td>
                      <td>{r.party_name || <span className="muted">—</span>}</td>
                      {isSettle ? (
                        <>
                          <td><span className="badge badge-mute">
                            {r.direction === 'OUT' ? 'Metal out' : 'Metal in'}
                          </span></td>
                          <td className="r num">{wt(r.fine_wt)} g</td>
                          <td className="r num">₹{money(r.rate_per_gm)}</td>
                        </>
                      ) : (
                        <>
                          <td><span className="badge badge-mute">{r.payment_type}</span></td>
                          <td className="small muted">{r.ref_no || r.narration || '—'}</td>
                        </>
                      )}
                      <td className="r num strong">₹{money(isSettle ? r.bill_amount : r.amount)}</td>
                      <td className="r">
                        <button className="btn btn-ghost btn-icon btn-sm" aria-label="Delete"
                          onClick={async () => {
                            await run(() => (isSettle
                              ? window.api.stockSettlement.remove({ id: r.id })
                              : window.api.voucher.remove({ id: r.id })), 'Deleted')
                            list.reload()
                          }}><Icon.trash /></button>
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr><td colSpan={5}>Total</td><td className="r num">₹{money(total)}</td><td></td></tr>
                </tfoot>
              </table>
            </div>
          )}
        </div>
      </div>

      {editing && (editing.kind === 'SETTLE' ? (
        <SettleModal onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); list.reload() }} />
      ) : (
        <VoucherModal v={editing} onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); list.reload() }} />
      ))}
    </div>
  )
}

function VoucherModal({ v, onClose, onSaved }: { v: any; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState(v)
  const [balance, setBalance] = useState<number | null>(null)
  useEffect(() => {
    if (v.party_id) window.api.party.balance({ id: v.party_id }).then((b: any) => setBalance(b.balance))
  }, [v.party_id])
  // A voucher settles either a party's khata or a head in the chart of accounts.
  // The second is how a shop expense — electricity, tea, rent — is recorded.
  const [against, setAgainst] = useState<'PARTY' | 'ACCOUNT'>('PARTY')
  const accounts = useAsync(() => window.api.account.list(), [])
  const run = useAction()
  const isReceipt = f.kind === 'RECEIPT'
  const toAccount = against === 'ACCOUNT'

  const pick = async (p: any) => {
    setF({ ...f, party_id: p.id, party_name: p.name })
    const b = await window.api.party.balance({ id: p.id })
    setBalance(b.balance)
  }

  const save = async () => {
    if (!Number(f.amount)) return run(async () => { throw new Error('Enter an amount') })
    if (toAccount && !f.account_id) return run(async () => { throw new Error('Choose an account') })
    if (!toAccount && !f.party_id) return run(async () => { throw new Error('Select a party') })
    const payload = toAccount
      ? { ...f, party_id: null, party_name: '', amount: Number(f.amount) }
      : { ...f, account_id: null, amount: Number(f.amount) }
    const ok = await run(() => window.api.voucher.save(payload),
      isReceipt ? 'Receipt saved' : 'Payment saved')
    if (ok !== undefined) onSaved()
  }

  const bal = balance != null ? drcr(balance) : null
  const after = balance != null
    ? drcr(balance + (isReceipt ? -Number(f.amount || 0) : Number(f.amount || 0)))
    : null

  return (
    <Modal title={isReceipt ? 'New Receipt' : 'New Payment'} onClose={onClose}
      footer={<><span className="spacer" /><button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" onClick={save}><Icon.save /> Save</button></>}>
      <div className="form-grid cols-2">
        <Field label={isReceipt ? 'Money in from' : 'Money out to'} className="span-2">
          <Segmented value={against} onChange={(v) => setAgainst(v as any)}
            options={[
              { value: 'PARTY', label: 'A customer or supplier' },
              { value: 'ACCOUNT', label: isReceipt ? 'An income head' : 'An expense head' },
            ]} />
        </Field>

        {toAccount ? (
          <Field label={isReceipt ? 'Income head' : 'Expense head'} required className="span-2"
            hint="Add heads under Settings → Accounts.">
            <Select value={String(f.account_id ?? '')}
              onChange={(v) => setF({ ...f, account_id: Number(v) || null })}
              options={[
                { value: '', label: 'Choose…' },
                ...(accounts.data || [])
                  .filter((a: any) => (isReceipt
                    ? ['Income', 'Asset', 'Liability'].includes(a.acc_type)
                    : ['Expense', 'Asset', 'Liability'].includes(a.acc_type)))
                  .map((a: any) => ({ value: String(a.id), label: `${a.name} · ${a.acc_type}` })),
              ]} />
          </Field>
        ) : (
          <Field label="Party" required className="span-2">
            <Autocomplete value={f.party_name} placeholder="Search customer or supplier…"
              onText={(s) => { setF({ ...f, party_name: s, party_id: null }); setBalance(null) }}
              onPick={pick}
              fetch={(q) => window.api.party.list({ type: 'ALL', search: q })}
              render={(p: any) => <span><b>{p.name}</b><span className="muted"> · {p.party_type === 'CUSTOMER' ? 'Customer' : 'Supplier'}</span></span>} />
          </Field>
        )}

        {bal && !toAccount && (
          <div className="span-2 row" style={{ gap: 10 }}>
            <span className={`balance-flag ${bal.cls}`}>Current ₹{bal.text} {bal.side}</span>
            {Number(f.amount) > 0 && after && (
              <>
                <span className="muted">→</span>
                <span className={`balance-flag ${after.cls}`}>After ₹{after.text} {after.side}</span>
              </>
            )}
          </div>
        )}

        <Field label="Amount (₹)" required>
          <Input autoFocus className="right" inputMode="decimal" value={f.amount}
            onChange={(e) => { const t = e.target.value; if (t === '' || /^\d*\.?\d*$/.test(t)) setF({ ...f, amount: t }) }} />
        </Field>
        <Field label="Date">
          <Input type="date" value={f.voucher_date} onChange={(e) => setF({ ...f, voucher_date: e.target.value })} />
        </Field>
        <Field label="Payment Mode">
          <Select value={f.payment_type} onChange={(x) => setF({ ...f, payment_type: x })}
            options={['Cash', 'UPI', 'Card', 'NEFT', 'RTGS', 'Cheque'].map((m) => ({ value: m, label: m }))} />
        </Field>
        <Field label="Reference No" hint="Cheque / UTR / txn id">
          <Input value={f.ref_no} onChange={(e) => setF({ ...f, ref_no: e.target.value })} />
        </Field>
        {f.payment_type !== 'Cash' && (
          <Field label="Bank Name" className="span-2">
            <Input value={f.bank_name} onChange={(e) => setF({ ...f, bank_name: e.target.value })} />
          </Field>
        )}
        <Field label="Narration" className="span-2">
          <Input value={f.narration} onChange={(e) => setF({ ...f, narration: e.target.value })} />
        </Field>
      </div>
    </Modal>
  )
}

/**
 * Stock Cash Settlement — turns a party's metal balance into a money one.
 * See docs/VIDEO-SPEC-2.md section 3.
 */
function SettleModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState<any>({
    settle_date: todayISO(), party_id: null, party_name: '', metal: 'Gold',
    direction: 'OUT', fine_wt: '', rate_per_gm: '', making_amount: '',
    gst_pct: 0, paid_amount: '', narration: '',
  })
  const [metalBal, setMetalBal] = useState<number | null>(null)
  const run = useAction()

  // Load a party's balance in the chosen metal and pre-fill the settlement to
  // clear exactly what is outstanding, in the right direction.
  const loadBalance = async (partyId: number, metal: string) => {
    const b = await window.api.party.metalBalance({ id: partyId, metal })
    setMetalBal(b.balance)
    if (Math.abs(b.balance) > 0.0005) {
      setF((x: any) => ({ ...x, direction: b.balance < 0 ? 'OUT' : 'IN', fine_wt: Math.abs(b.balance) }))
    } else {
      setF((x: any) => ({ ...x, fine_wt: '' }))
    }
  }

  const pick = async (p: any) => {
    setF((x: any) => ({ ...x, party_id: p.id, party_name: p.name }))
    await loadBalance(p.id, f.metal)
  }

  const changeMetal = (metal: string) => {
    setF((x: any) => ({ ...x, metal }))
    if (f.party_id) loadBalance(f.party_id, metal)
    else setMetalBal(null)
  }

  const fine = Number(f.fine_wt) || 0
  const rate = Number(f.rate_per_gm) || 0
  const amount = fine * rate + (Number(f.making_amount) || 0)
  const gst = amount * ((Number(f.gst_pct) || 0) / 100)
  const billAmount = amount + gst
  // OUT means the metal leaves us, so the metal debt moves toward zero from below.
  const metalAfter = metalBal == null ? null
    : metalBal + (f.direction === 'OUT' ? fine : -fine)

  const save = async () => {
    if (!f.party_id) return run(async () => { throw new Error('Select a party') })
    if (!fine) return run(async () => { throw new Error('Enter the fine weight to settle') })
    const ok = await run(() => window.api.stockSettlement.save(f), 'Settlement saved')
    if (ok !== undefined) onSaved()
  }

  return (
    <Modal title="Settle Metal for Cash" onClose={onClose}
      footer={<><span className="spacer" /><button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" onClick={save}><Icon.save /> Save</button></>}>
      <p className="small muted" style={{ marginBottom: 12 }}>
        Closes out gold owed by turning it into a money balance. The metal moves one way on
        the books and the money the other. Physical stock is not touched — the metal itself
        moved on its own bill.
      </p>
      <div className="form-grid cols-2">
        <Field label="Party" required className="span-2">
          <Autocomplete value={f.party_name} placeholder="Search a customer or supplier…"
            onText={(t) => setF({ ...f, party_name: t, party_id: null })}
            onPick={pick}
            fetch={(q) => window.api.party.list({ type: 'ALL', search: q })}
            render={(p: any) => <span><b>{p.name}</b><span className="muted"> · {p.party_type === 'CUSTOMER' ? 'Customer' : 'Supplier'}</span></span>} />
        </Field>
        <Field label="Metal">
          <Select value={f.metal} onChange={changeMetal}
            options={['Gold', 'Silver', 'Platinum'].map((m) => ({ value: m, label: m }))} />
        </Field>
        {metalBal != null && (
          <div className="span-2 small" style={{ marginTop: -6 }}>
            {f.metal} on account:{' '}
            <b>{wt(Math.abs(metalBal))} g {metalBal > 0 ? 'Dr (they owe us)' : metalBal < 0 ? 'Cr (we owe them)' : ''}</b>
            {metalAfter != null && (
              <span className="muted"> → after this: {wt(Math.abs(metalAfter))} g {metalAfter > 0.0005 ? 'Dr' : metalAfter < -0.0005 ? 'Cr' : ''}</span>
            )}
          </div>
        )}
        <Field label="Date">
          <Input type="date" value={f.settle_date}
            onChange={(e) => setF({ ...f, settle_date: e.target.value })} />
        </Field>
        <Field label="Direction" hint={f.direction === 'OUT' ? 'Metal leaves us — we will owe money' : 'Metal comes to us — they will owe money'}>
          <Select value={f.direction} onChange={(v) => setF({ ...f, direction: v })}
            options={[
              { value: 'OUT', label: 'Metal out (we settle what we owe)' },
              { value: 'IN', label: 'Metal in (they settle what they owe)' },
            ]} />
        </Field>
        <Field label="Fine Weight (g)" required>
          <Input className="right" value={f.fine_wt}
            onChange={(e) => setF({ ...f, fine_wt: e.target.value })} />
        </Field>
        <Field label="Rate / gram" required>
          <Input className="right" value={f.rate_per_gm}
            onChange={(e) => setF({ ...f, rate_per_gm: e.target.value })} />
        </Field>
        <Field label="Making Amount">
          <Input className="right" value={f.making_amount}
            onChange={(e) => setF({ ...f, making_amount: e.target.value })} />
        </Field>
        <Field label="GST %">
          <Input className="right" value={f.gst_pct}
            onChange={(e) => setF({ ...f, gst_pct: e.target.value })} />
        </Field>
        <Field label="Paid now" className="span-2" hint="Leave blank to leave the whole amount outstanding.">
          <Input className="right" value={f.paid_amount}
            onChange={(e) => setF({ ...f, paid_amount: e.target.value })} />
        </Field>
      </div>
      <div className="row" style={{ gap: 18, marginTop: 14, justifyContent: 'flex-end' }}>
        <span className="muted small">Amount ₹{money(amount)}</span>
        {gst > 0 && <span className="muted small">GST ₹{money(gst)}</span>}
        <span className="strong">Bill Amount ₹{money(billAmount)}</span>
      </div>
    </Modal>
  )
}
