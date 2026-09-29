import React, { useState } from 'react'
import { Icon } from '../lib/icons'
import {
  Check, Confirm, Empty, Field, Input, Loading, Modal, Select,
  useAction, useAsync, useDebounced,
} from '../lib/ui'
import { drcr, money, toCsv } from '../lib/format'

const METALS = ['Gold', 'Silver', 'Platinum', 'Stone']

const blank = (party_type: string) => ({
  id: null as number | null,
  party_type,
  name: '', district: '', taluka: '', city: '', area: '', address: '',
  whatsapp: '', mobile: '', birth_date: '', anniversary: '', email: '',
  ref_name: '', aadhaar: '', pan: '', gstin: '', state: 'Maharashtra', regi_number: '',
  opening_balance: 0, opening_dr_cr: 'Dr',
  loyalty_enabled: 0, show_in_purchase: 0, photo: '',
  metals: METALS.map((m) => ({ metal: m, weight: 0, dr_cr: 'Dr' })),
})

export default function Parties({ type, go, openNew }: {
  type: 'CUSTOMER' | 'SUPPLIER'; go?: (n: string, p?: any) => void; openNew?: boolean
}) {
  const label = type === 'CUSTOMER' ? 'Customer' : 'Supplier'
  const [search, setSearch] = useState('')
  const q = useDebounced(search, 250)
  const [editing, setEditing] = useState<any>(() => (openNew ? blank(type) : null))
  const [confirming, setConfirming] = useState<any>(null)
  const run = useAction()

  const list = useAsync(() => window.api.party.list({ type, search: q }), [type, q])

  const open = async (row?: any) => {
    if (!row) return setEditing(blank(type))
    const full = await window.api.party.read({ id: row.id })
    const metals = METALS.map((m) => {
      const found = (full.metals || []).find((x: any) => x.metal === m)
      return { metal: m, weight: found?.weight ?? 0, dr_cr: found?.dr_cr ?? 'Dr' }
    })
    setEditing({ ...full, metals })
  }

  const save = async () => {
    if (!editing.name.trim()) return run(async () => { throw new Error(`${label} name is required`) })
    const ok = await run(
      () => window.api.party.save({
        ...editing,
        opening_balance: Number(editing.opening_balance) || 0,
        loyalty_enabled: editing.loyalty_enabled ? 1 : 0,
        show_in_purchase: editing.show_in_purchase ? 1 : 0,
      }),
      `${label} saved`
    )
    if (ok !== undefined) { setEditing(null); list.reload() }
  }

  const remove = async () => {
    const ok = await run(() => window.api.party.remove({ id: confirming.id }), `${label} deleted`)
    setConfirming(null)
    if (ok !== undefined) list.reload()
  }

  const exportCsv = async () => {
    const csv = toCsv(
      ['Name', 'Mobile', 'Area', 'City', 'GSTIN', 'Balance', 'Side'],
      (list.data || []).map((r: any) => {
        const b = drcr(r.balance)
        return [r.name, r.mobile, r.area, r.city, r.gstin, b.text, b.side]
      })
    )
    await window.api.file.saveText({ content: csv, suggestedName: `${label.toLowerCase()}s.csv` })
  }

  const totalOut = (list.data || []).reduce((s: number, r: any) => s + Math.max(0, Number(r.balance) || 0), 0)

  return (
    <div className="content-narrow">
      <div className="toolbar">
        <div className="search-box">
          <Icon.search />
          <input className="input" placeholder={`Search ${label.toLowerCase()}s…`} value={search}
            onChange={(e) => setSearch(e.target.value)} />
        </div>
        {totalOut > 0 && (
          <span className="badge badge-warn">Outstanding ₹{money(totalOut)}</span>
        )}
        <span className="spacer" />
        <button className="btn btn-sm" onClick={exportCsv}><Icon.download /> Export</button>
        <button className="btn btn-primary" onClick={() => open()}>
          <Icon.plus /> New {label}
        </button>
      </div>

      <div className="card">
        <div className="card-body flush">
          {list.loading ? <Loading /> : !list.data?.length ? (
            <Empty icon={Icon.users} title={`No ${label.toLowerCase()}s yet`}
              action={<button className="btn btn-primary btn-sm" onClick={() => open()}>Add {label.toLowerCase()}</button>}>
              {type === 'CUSTOMER'
                ? 'Add customers to bill them faster and keep a running khata.'
                : 'Suppliers you buy material from.'}
            </Empty>
          ) : (
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th>Name</th><th>Mobile</th><th>Area</th><th>City</th>
                    <th>GSTIN</th><th className="r">Balance</th><th></th>
                  </tr>
                </thead>
                <tbody>
                  {list.data.map((r: any) => {
                    const b = drcr(r.balance)
                    return (
                      <tr key={r.id} className="clickable" onClick={() => open(r)}>
                        <td className="strong">
                          {r.name}
                          {!!r.loyalty_enabled && <span className="badge badge-gold" style={{ marginLeft: 6 }}>Loyalty</span>}
                        </td>
                        <td className="num">{r.mobile || r.whatsapp || '—'}</td>
                        <td>{r.area || '—'}</td>
                        <td>{r.city || '—'}</td>
                        <td className="mono small">{r.gstin || '—'}</td>
                        <td className="r num">
                          {b.side ? <span className={b.side === 'Dr' ? 'danger strong' : 'ok strong'}>₹{b.text} {b.side}</span>
                            : <span className="muted">0.00</span>}
                        </td>
                        <td className="r" style={{ whiteSpace: 'nowrap' }} onClick={(e) => e.stopPropagation()}>
                          {go && type === 'CUSTOMER' && (
                            <button className="btn btn-ghost btn-icon btn-sm" title="New bill for this customer"
                              onClick={() => go('sales.new', { partyId: r.id })}><Icon.invoice /></button>
                          )}
                          {go && (
                            <button className="btn btn-ghost btn-icon btn-sm"
                              title={type === 'CUSTOMER' ? 'Receive payment' : 'Make payment'}
                              onClick={() => go('receipts', { partyId: r.id, kind: type === 'CUSTOMER' ? 'RECEIPT' : 'PAYMENT' })}>
                              <Icon.receipt /></button>
                          )}
                          {go && (
                            <button className="btn btn-ghost btn-icon btn-sm" title="Open ledger"
                              onClick={() => go('ledger', { partyId: r.id })}><Icon.ledger /></button>
                          )}
                          <button className="btn btn-ghost btn-icon btn-sm" onClick={() => setConfirming(r)} aria-label="Delete">
                            <Icon.trash />
                          </button>
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
        <Modal wide
          title={editing.id ? `Edit ${label}` : `New ${label}`}
          onClose={() => setEditing(null)}
          footer={<>
            {editing.id != null && <span className="small muted">Balance is derived from transactions</span>}
            <span className="spacer" />
            <button className="btn" onClick={() => setEditing(null)}>Cancel</button>
            <button className="btn btn-primary" onClick={save}><Icon.save /> Save</button>
          </>}
        >
          <div className="section-title">Identity</div>
          <div className="form-grid cols-3" style={{ marginBottom: 18 }}>
            <Field label="Name" required className="span-2">
              <Input autoFocus value={editing.name}
                onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
            </Field>
            <Field label="Mobile">
              <Input value={editing.mobile} inputMode="numeric"
                onChange={(e) => setEditing({ ...editing, mobile: e.target.value })} />
            </Field>
            <Field label="WhatsApp No" hint="Used to send bills & reminders">
              <Input value={editing.whatsapp} inputMode="numeric"
                onChange={(e) => setEditing({ ...editing, whatsapp: e.target.value })} />
            </Field>
            <Field label="Email">
              <Input type="email" value={editing.email}
                onChange={(e) => setEditing({ ...editing, email: e.target.value })} />
            </Field>
            <Field label="Reference Name">
              <Input value={editing.ref_name}
                onChange={(e) => setEditing({ ...editing, ref_name: e.target.value })} />
            </Field>
          </div>

          <div className="section-title">Address</div>
          <div className="form-grid cols-3" style={{ marginBottom: 18 }}>
            <Field label="Area"><Input value={editing.area} onChange={(e) => setEditing({ ...editing, area: e.target.value })} /></Field>
            <Field label="City"><Input value={editing.city} onChange={(e) => setEditing({ ...editing, city: e.target.value })} /></Field>
            <Field label="Taluka"><Input value={editing.taluka} onChange={(e) => setEditing({ ...editing, taluka: e.target.value })} /></Field>
            <Field label="District"><Input value={editing.district} onChange={(e) => setEditing({ ...editing, district: e.target.value })} /></Field>
            <Field label="State"><Input value={editing.state} onChange={(e) => setEditing({ ...editing, state: e.target.value })} /></Field>
            <Field label="Full Address"><Input value={editing.address} onChange={(e) => setEditing({ ...editing, address: e.target.value })} /></Field>
          </div>

          <div className="section-title">KYC & Dates</div>
          <div className="form-grid cols-4" style={{ marginBottom: 18 }}>
            <Field label="Aadhaar No"><Input value={editing.aadhaar} onChange={(e) => setEditing({ ...editing, aadhaar: e.target.value })} /></Field>
            <Field label="PAN No"><Input value={editing.pan} onChange={(e) => setEditing({ ...editing, pan: e.target.value })} /></Field>
            <Field label="GSTIN"><Input value={editing.gstin} onChange={(e) => setEditing({ ...editing, gstin: e.target.value })} /></Field>
            {type === 'SUPPLIER' && (
              <Field label="Regi. Number"><Input value={editing.regi_number} onChange={(e) => setEditing({ ...editing, regi_number: e.target.value })} /></Field>
            )}
            <Field label="Birth Date" hint="For greetings">
              <Input type="date" value={editing.birth_date || ''}
                onChange={(e) => setEditing({ ...editing, birth_date: e.target.value })} />
            </Field>
            <Field label="Anniversary">
              <Input type="date" value={editing.anniversary || ''}
                onChange={(e) => setEditing({ ...editing, anniversary: e.target.value })} />
            </Field>
          </div>

          <div className="section-title">Opening Balance</div>
          <div className="form-grid cols-4" style={{ marginBottom: 18 }}>
            <Field label="Amount (₹)">
              <Input className="right" inputMode="decimal" value={editing.opening_balance}
                onChange={(e) => setEditing({ ...editing, opening_balance: e.target.value })} />
            </Field>
            <Field label="Side" hint="Dr = they owe you">
              <Select value={editing.opening_dr_cr}
                onChange={(v) => setEditing({ ...editing, opening_dr_cr: v })}
                options={[{ value: 'Dr', label: 'Debit (they owe)' }, { value: 'Cr', label: 'Credit (you owe)' }]} />
            </Field>
            <div className="span-2 col" style={{ justifyContent: 'flex-end', paddingBottom: 4 }}>
              <Check label="Enable loyalty points" checked={!!editing.loyalty_enabled}
                onChange={(b) => setEditing({ ...editing, loyalty_enabled: b ? 1 : 0 })} />
              <Check label="Show in purchase screen" checked={!!editing.show_in_purchase}
                onChange={(b) => setEditing({ ...editing, show_in_purchase: b ? 1 : 0 })} />
            </div>
          </div>

          <div className="section-title">Opening Metal Balance</div>
          <div className="table-wrap" style={{ border: '1px solid var(--line)' }}>
            <table className="grid-edit">
              <thead>
                <tr><th>Metal</th><th style={{ textAlign: 'right' }}>Weight (g)</th><th style={{ width: 190 }}>Side</th></tr>
              </thead>
              <tbody>
                {editing.metals.map((m: any, i: number) => (
                  <tr key={m.metal}>
                    <td style={{ padding: '0 10px' }}>{m.metal}</td>
                    <td>
                      <input className="right" inputMode="decimal" value={m.weight || ''}
                        onChange={(e) => {
                          const t = e.target.value
                          if (t !== '' && !/^\d*\.?\d*$/.test(t)) return
                          const metals = [...editing.metals]
                          metals[i] = { ...m, weight: t }
                          setEditing({ ...editing, metals })
                        }} />
                    </td>
                    <td style={{ padding: '3px 6px' }}>
                      <select className="select" style={{ height: 27 }} value={m.dr_cr}
                        onChange={(e) => {
                          const metals = [...editing.metals]
                          metals[i] = { ...m, dr_cr: e.target.value }
                          setEditing({ ...editing, metals })
                        }}>
                        <option value="Dr">Debit</option>
                        <option value="Cr">Credit</option>
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Modal>
      )}

      {confirming && (
        <Confirm
          title={`Delete ${label.toLowerCase()}?`}
          message={`"${confirming.name}" will be removed. Parties with transactions cannot be deleted.`}
          onConfirm={remove}
          onCancel={() => setConfirming(null)}
        />
      )}
    </div>
  )
}
