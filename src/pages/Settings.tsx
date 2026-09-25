import React, { useEffect, useMemo, useState } from 'react'
import { Icon } from '../lib/icons'
import { Check, Field, Input, Loading, Modal, Segmented, Select, useAction, useAsync } from '../lib/ui'
import { DEFAULT_INVOICE_CONFIG, invoiceHtml, loadConfig, type InvoiceConfig } from '../print/invoice'
import { num } from '../lib/calc'
import Users from './Users'
import GoogleDrive from './GoogleDrive'
import MobileAccess from './MobileAccess'

/**
 * Making Master and Wastage Master — default making charges and wastage
 * percentages so the shop types them once instead of on every tag, bill and
 * purchase. A rule sits on an item or on an item group; the item's own rule wins.
 *
 * These seed the forms. They never rewrite a saved document: a making charge of
 * zero is a real answer, and the engine must not second-guess it.
 */
function RateMasters() {
  const run = useAction()
  const [kind, setKind] = useState<'MAKING' | 'WASTAGE'>('MAKING')
  const rules = useAsync(() => window.api.rateMaster.list({ kind }), [kind])
  const items = useAsync(() => window.api.item.list(), [])
  const groups = useAsync(() => window.api.itemGroup.list(), [])
  const [editing, setEditing] = useState<any>(null)

  const making = kind === 'MAKING'
  const targets = editing?.scope === 'ITEM' ? items.data || [] : groups.data || []

  const save = async () => {
    const ok = await run(() => window.api.rateMaster.save({
      kind, scope: editing.scope, ref_id: Number(editing.ref_id),
      per_gram: num(editing.per_gram), flat: num(editing.flat),
    }), 'Rule saved')
    if (ok !== undefined) { setEditing(null); rules.reload() }
  }

  return (
    <div className="card">
      <div className="card-head">
        <span className="card-title">{making ? 'Making Master' : 'Wastage Master'}</span>
        <span className="spacer" />
        <Segmented value={kind} onChange={(v) => setKind(v as any)}
          options={[{ value: 'MAKING', label: 'Making' }, { value: 'WASTAGE', label: 'Wastage' }]} />
        <button className="btn btn-primary btn-sm" style={{ marginLeft: 8 }}
          onClick={() => setEditing({ scope: 'GROUP', ref_id: '', per_gram: '', flat: '' })}>
          <Icon.plus /> New Rule
        </button>
      </div>
      <div className="card-body flush">
        <p className="small muted" style={{ padding: '10px 14px 0' }}>
          {making
            ? <>Default making charges. Set one for a whole group such as <b>22K Gold</b>, and
                a different one for a particular item where it differs — the item's rule wins.
                New tag rows and bill lines start at this rate; you can still change any of
                them before saving.</>
            : <>Default wastage percentages for purchases. Set one per group or per item; the
                item's rule wins. A new purchase line starts at this rate.</>}
        </p>
        {rules.loading ? <Loading rows={3} /> : !rules.data?.length ? (
          <p className="small muted" style={{ padding: '14px' }}>
            No {making ? 'making' : 'wastage'} rules yet — every {making ? 'charge' : 'percentage'} is
            typed by hand.
          </p>
        ) : (
          <table className="data">
            <thead>
              <tr><th>Applies to</th><th>Scope</th>
                <th className="r">{making ? 'Making ₹/g' : 'Wastage %'}</th>
                {making && <th className="r">Flat ₹/piece</th>}
                <th></th></tr>
            </thead>
            <tbody>
              {rules.data.map((r: any) => (
                <tr key={r.id}>
                  <td className="strong">{r.ref_name || '—'}
                    {r.ref_detail && <span className="muted small"> · {r.ref_detail}</span>}</td>
                  <td>
                    <span className={`badge ${r.scope === 'ITEM' ? 'badge-gold' : 'badge-mute'}`}>
                      {r.scope === 'ITEM' ? 'Item' : 'Group'}
                    </span>
                  </td>
                  <td className="r num strong">{r.per_gram}{making ? '' : '%'}</td>
                  {making && <td className="r num">{r.flat > 0 ? r.flat : '—'}</td>}
                  <td className="r">
                    <button className="btn btn-ghost btn-icon btn-sm" aria-label="Edit"
                      onClick={() => setEditing({ ...r, ref_id: String(r.ref_id) })}>
                      <Icon.edit />
                    </button>
                    <button className="btn btn-ghost btn-icon btn-sm" aria-label="Delete"
                      onClick={async () => {
                        await run(() => window.api.rateMaster.remove({ id: r.id }), 'Rule deleted')
                        rules.reload()
                      }}><Icon.trash /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {editing && (
        <Modal title={`${making ? 'Making' : 'Wastage'} Rule`} onClose={() => setEditing(null)}
          footer={<><span className="spacer" />
            <button className="btn" onClick={() => setEditing(null)}>Cancel</button>
            <button className="btn btn-primary" onClick={save}><Icon.save /> Save</button></>}>
          <div className="form-grid cols-2">
            <Field label="Applies to" hint="An item's own rule overrides its group's">
              <Select value={editing.scope}
                onChange={(v) => setEditing({ ...editing, scope: v, ref_id: '' })}
                options={[
                  { value: 'GROUP', label: 'A whole item group' },
                  { value: 'ITEM', label: 'One item' },
                ]} />
            </Field>
            <Field label={editing.scope === 'ITEM' ? 'Item' : 'Item Group'} required>
              <Select value={editing.ref_id} placeholder="Select…"
                onChange={(v) => setEditing({ ...editing, ref_id: v })}
                options={targets.map((t: any) => ({ value: String(t.id), label: t.name }))} />
            </Field>
            <Field label={making ? 'Making per gram (₹)' : 'Wastage (%)'}>
              <Input className="right" value={editing.per_gram}
                onChange={(e) => setEditing({ ...editing, per_gram: e.target.value })} />
            </Field>
            {making && (
              <Field label="Flat charge per piece (₹)" hint="Used instead of a per-gram rate">
                <Input className="right" value={editing.flat}
                  onChange={(e) => setEditing({ ...editing, flat: e.target.value })} />
              </Field>
            )}
          </div>
        </Modal>
      )}
    </div>
  )
}

/**
 * Loyalty programme rates. Points are earned as a percentage of the bill's goods
 * value and spent at a fixed rupee value each — both kept in `settings` so the
 * shop can tune them without a rebuild.
 */
function LoyaltySettings() {
  const run = useAction()
  const [earn, setEarn] = useState('1')
  const [value, setValue] = useState('1')
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    window.api.settings.all().then((s: any) => {
      setEarn(String(s?.loyalty_earn_pct ?? '1'))
      setValue(String(s?.loyalty_redeem_value ?? '1'))
      setLoaded(true)
    })
  }, [])

  const save = () =>
    run(async () => {
      await window.api.settings.set({ key: 'loyalty_earn_pct', value: String(Number(earn) || 0) })
      await window.api.settings.set({ key: 'loyalty_redeem_value', value: String(Number(value) || 1) })
      return true
    }, 'Loyalty settings saved')

  if (!loaded) return null
  return (
    <div className="card" style={{ marginBottom: 14 }}>
      <div className="card-head">
        <span className="card-title">Loyalty Programme</span>
        <span className="spacer" />
        <button className="btn btn-sm" onClick={save}><Icon.save /> Save</button>
      </div>
      <div className="card-body">
        <div className="form-grid cols-2">
          <Field label="Points earned (% of goods)"
            hint="1 means a ₹50,000 bill earns 500 points.">
            <Input className="right" inputMode="decimal" value={earn}
              onChange={(e) => setEarn(e.target.value)} />
          </Field>
          <Field label="Value of one point (₹)"
            hint="What a point is worth when the customer spends it.">
            <Input className="right" inputMode="decimal" value={value}
              onChange={(e) => setValue(e.target.value)} />
          </Field>
        </div>
        <p className="small muted" style={{ marginTop: 8 }}>
          Only customers with <strong>Loyalty</strong> ticked on their record earn points.
          Points appear on their next bill as a <em>Redeem Points</em> box.
        </p>
      </div>
    </div>
  )
}

export default function Settings({ tab: initialTab }: { tab?: string } = {}) {
  const run = useAction()
  const [tab, setTab] = useState<
    'company' | 'invoice' | 'series' | 'accounts' | 'rates' | 'users' | 'data' | 'mobile'
  >((initialTab as any) || 'company')
  const [form, setForm] = useState<any>(null)
  const info = useAsync(() => window.api.app.info(), [])
  const company = useAsync(() => window.api.company.read(), [])
  const series = useAsync(() => window.api.series.list(), [])
  const accounts = useAsync(() => window.api.account.list(), [])

  useEffect(() => { if (company.data && !form) setForm(company.data) }, [company.data, form])

  const save = async () => {
    const ok = await run(() => window.api.company.save(form), 'Settings saved')
    if (ok !== undefined) company.reload()
  }

  const backup = async () => {
    const res = await window.api.backup.create()
    if (res?.ok) await run(async () => true, 'Backup saved')
  }

  // Restore is two steps on purpose: pick and read the file, show the owner what
  // it holds next to what they have now, and only then overwrite anything.
  const [newAcc, setNewAcc] = useState<any>(null)

  const saveAccount = async () => {
    if (!newAcc?.name?.trim()) return run(async () => { throw new Error('Enter a name') })
    const okd = await run(() => window.api.account.save(newAcc), 'Account created')
    if (okd !== undefined) { setNewAcc(null); accounts.reload() }
  }

  const [restore, setRestore] = useState<any>(null)
  const [restoring, setRestoring] = useState(false)

  // A rejected call surfaces as a toast; `run` returns undefined in that case.
  const chooseBackup = async () => {
    const res = await run(() => window.api.backup.inspect())
    if (res?.ok) setRestore(res)
  }

  const doRestore = async () => {
    setRestoring(true)
    const res = await run(() => window.api.backup.restore({ filePath: restore.backup.filePath }))
    // On success the main process restarts the app a moment from now, so the
    // "restoring" notice is left up deliberately.
    if (!res?.ok) setRestoring(false)
  }

  // Clearing the entries: show what is there, make the owner type DELETE, and
  // let the main process back up, clear and restart.
  // Owner only. The main process refuses anyone else regardless; this just
  // keeps the button off a manager's or staff member's screen.
  const perms = useAsync(() => window.api.auth.permissions(), [])
  const isOwner = perms.data?.restore_backup === true
  const [clearing, setClearing] = useState<any>(null)
  const [clearWord, setClearWord] = useState('')
  const [clearBusy, setClearBusy] = useState(false)

  const openClear = async () => {
    const res = await run(() => window.api.backup.current())
    if (res?.ok) { setClearWord(''); setClearing(res.current) }
  }

  const doClear = async () => {
    setClearBusy(true)
    const res = await run(() => window.api.backup.clearEntries({ confirm: clearWord }))
    // On success the app restarts a moment from now; leave the notice up.
    if (!res?.ok) setClearBusy(false)
  }

  if (!form) return <Loading rows={6} />

  return (
    <div className="content-narrow">
      <div className="tabs">
        {([
          ['company', 'Company'],
          ['invoice', 'Invoice Design'],
          ['series', 'Bill Numbering'],
          ['accounts', 'Accounts'],
          ['rates', 'Making & Wastage'],
          ['users', 'Users'],
          ['data', 'Data & Backup'],
          ['mobile', 'Mobile View'],
        ] as const).map(([k, label]) => (
          <button key={k} className="tab" aria-selected={tab === k} onClick={() => setTab(k as any)}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'company' && (
        <>
          <div className="card" style={{ marginBottom: 14 }}>
            <div className="card-head"><span className="card-title">Shop Details</span>
              <span className="hint" style={{ marginLeft: 'auto' }}>Printed on every invoice</span></div>
            <div className="card-body">
              <div className="form-grid cols-2">
                <Field label="Company Name" required className="span-2">
                  <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
                </Field>
                <Field label="Address" className="span-2">
                  <Input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
                </Field>
                <Field label="Phone"><Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></Field>
                <Field label="GSTIN"><Input value={form.gstin} onChange={(e) => setForm({ ...form, gstin: e.target.value })} /></Field>
                <Field label="State"><Input value={form.state} onChange={(e) => setForm({ ...form, state: e.target.value })} /></Field>
                <Field label="Financial Year" hint="Used by reports">
                  <div className="row">
                    <Input type="date" value={form.fy_start} onChange={(e) => setForm({ ...form, fy_start: e.target.value })} />
                    <Input type="date" value={form.fy_end} onChange={(e) => setForm({ ...form, fy_end: e.target.value })} />
                  </div>
                </Field>
              </div>
            </div>
          </div>

          <div className="card" style={{ marginBottom: 14 }}>
            <div className="card-head"><span className="card-title">Bank Details</span></div>
            <div className="card-body">
              <div className="form-grid cols-2">
                <Field label="Bank Name"><Input value={form.bank_name} onChange={(e) => setForm({ ...form, bank_name: e.target.value })} /></Field>
                <Field label="Account No"><Input value={form.account_no} onChange={(e) => setForm({ ...form, account_no: e.target.value })} /></Field>
                <Field label="Branch"><Input value={form.branch} onChange={(e) => setForm({ ...form, branch: e.target.value })} /></Field>
                <Field label="IFSC Code"><Input value={form.ifsc} onChange={(e) => setForm({ ...form, ifsc: e.target.value })} /></Field>
              </div>
            </div>
          </div>

          <div className="card" style={{ marginBottom: 14 }}>
            <div className="card-head"><span className="card-title">Invoice Declaration</span></div>
            <div className="card-body">
              <textarea className="textarea" rows={4} value={form.declaration}
                onChange={(e) => setForm({ ...form, declaration: e.target.value })} />
            </div>
          </div>

          <LoyaltySettings />

          <div className="sticky-actions">
            <span className="spacer" />
            <button className="btn btn-primary" onClick={save}><Icon.save /> Save Settings</button>
          </div>
        </>
      )}

      {tab === 'invoice' && <InvoiceDesign company={company.data} />}

      {tab === 'series' && (
        <div className="card">
          <div className="card-head"><span className="card-title">Document Numbering</span>
            <span className="hint" style={{ marginLeft: 'auto' }}>Next number is reserved when a document is saved</span></div>
          <div className="card-body flush">
            <table className="data">
              <thead><tr><th>Document</th><th>Prefix</th><th>Label</th><th className="r">Next No</th></tr></thead>
              <tbody>
                {(series.data || []).map((s: any) => (
                  <tr key={s.id}>
                    <td className="strong">{s.doc_type}</td>
                    <td className="mono">{s.prefix}</td>
                    <td className="muted">{s.label}</td>
                    <td className="r mono">{s.prefix}{s.next_no}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'accounts' && (
        <div className="card">
          <div className="card-head">
            <span className="card-title">Chart of Accounts</span>
            <button className="btn btn-primary btn-sm" style={{ marginLeft: 'auto' }}
              onClick={() => setNewAcc({
                name: '', acc_type: 'Expense', acc_group: '', opening_balance: '',
                opening_dr_cr: 'Dr', is_card_swap: 0, card_pct_customer: '', card_pct_shop: '',
              })}>
              <Icon.plus /> New Account
            </button>
          </div>
          <div className="card-body flush">
            <p className="small muted" style={{ padding: '10px 14px 0' }}>
              Shop expenses live here. Add a head such as <b>Electricity</b> or <b>Tea</b>,
              then spend against it from <b>Receipts &amp; Payments → Payments</b>. That is
              what puts it in the cash book and the day book.
            </p>
            <table className="data">
              <thead><tr><th>Code</th><th>Name</th><th>Type</th><th>Group</th><th></th></tr></thead>
              <tbody>
                {(accounts.data || []).map((a: any) => (
                  <tr key={a.id} className="clickable" onClick={() => setNewAcc({ ...a })}>
                    <td className="mono">{a.code}</td>
                    <td className="strong">{a.name}</td>
                    <td>{a.acc_type}</td>
                    <td className="muted">{a.acc_group}</td>
                    <td className="r">
                      {!!a.is_card_swap && (
                        <span className="badge badge-gold" style={{ marginRight: 4 }}
                          title={`Customer ${a.card_pct_customer}% · shop ${a.card_pct_shop}%`}>
                          Card {num(a.card_pct_customer) + num(a.card_pct_shop)}%
                        </span>
                      )}
                      {!!a.is_system && <span className="badge badge-mute">System</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'rates' && <RateMasters />}

      {newAcc && (
        <Modal title={newAcc.id ? `Edit ${newAcc.name}` : 'New Account'} onClose={() => setNewAcc(null)}
          footer={<><span className="spacer" />
            <button className="btn" onClick={() => setNewAcc(null)}>Cancel</button>
            <button className="btn btn-primary" onClick={saveAccount}><Icon.save /> Save</button></>}>
          <div className="form-grid cols-2">
            <Field label="Account name" required className="span-2">
              <Input value={newAcc.name} placeholder="Electricity, Rent, Tea…"
                onChange={(e) => setNewAcc({ ...newAcc, name: e.target.value })} />
            </Field>
            <Field label="Type">
              <Select value={newAcc.acc_type} onChange={(v) => setNewAcc({ ...newAcc, acc_type: v })}
                options={[
                  { value: 'Expense', label: 'Expense' },
                  { value: 'Income', label: 'Income' },
                  { value: 'Cash', label: 'Cash' },
                  { value: 'Bank', label: 'Bank' },
                  { value: 'Asset', label: 'Asset' },
                  { value: 'Liability', label: 'Liability' },
                ]} />
            </Field>
            <Field label="Group">
              <Input value={newAcc.acc_group} placeholder="Indirect Expense…"
                onChange={(e) => setNewAcc({ ...newAcc, acc_group: e.target.value })} />
            </Field>
            {/* Card charges only mean anything on a bank account — the terminal
                settles into a bank, and the fee comes out of the same place. */}
            {newAcc.acc_group === 'Bank Accounts' && (
              <>
                <div className="span-2">
                  <Check label="Card swap account" checked={!!newAcc.is_card_swap}
                    onChange={(b) => setNewAcc({ ...newAcc, is_card_swap: b ? 1 : 0 })} />
                  <p className="small muted" style={{ margin: '4px 0 0' }}>
                    The bank's swipe fee, split between the two sides. Only one account can
                    be the card account.
                  </p>
                </div>
                {!!newAcc.is_card_swap && (
                  <>
                    <Field label="For Customer in %" hint="Added to the bill">
                      <Input className="right" value={newAcc.card_pct_customer ?? ''}
                        onChange={(e) => setNewAcc({ ...newAcc, card_pct_customer: e.target.value })} />
                    </Field>
                    <Field label="For Us in %" hint="The shop absorbs this as an expense">
                      <Input className="right" value={newAcc.card_pct_shop ?? ''}
                        onChange={(e) => setNewAcc({ ...newAcc, card_pct_shop: e.target.value })} />
                    </Field>
                  </>
                )}
              </>
            )}
          </div>
        </Modal>
      )}

      {tab === 'users' && <Users />}

      {tab === 'mobile' && <MobileAccess />}

      {tab === 'data' && (
        <>
        <div className="card">
          <div className="card-head"><span className="card-title">Data &amp; Backup</span></div>
          <div className="card-body">
            <div className="form-grid" style={{ gap: 16 }}>
              <div>
                <div className="label">Database location</div>
                <div className="mono small muted" style={{ wordBreak: 'break-all' }}>
                  {info.data?.dataDir || '—'}
                </div>
              </div>
              <div>
                <div className="label">Version</div>
                <div className="small muted">Parivar Jewellery ERP v{info.data?.version || '1.0.0'}</div>
              </div>
              <div className="divider" />
              <div>
                <div className="strong" style={{ marginBottom: 4 }}>Back up your data</div>
                <p className="small muted" style={{ marginBottom: 10, maxWidth: 520 }}>
                  Saves a complete copy of the database to a file you choose. Keep a copy on a
                  pen drive or cloud folder — do this at the end of every working day.
                </p>
                <button className="btn btn-primary" onClick={backup}>
                  <Icon.download /> Create Backup
                </button>
              </div>
              <div className="divider" />
              <div>
                <div className="strong" style={{ marginBottom: 4 }}>Restore from a backup</div>
                <p className="small muted" style={{ marginBottom: 10, maxWidth: 520 }}>
                  Loads a backup file and replaces everything currently in the app — bills,
                  stock, customers and khata. You will see what the file contains before
                  anything is changed, and today's books are saved to a
                  <span className="mono"> pre-restore </span> file first so this can be undone.
                </p>
                <button className="btn" onClick={chooseBackup}>
                  <Icon.upload /> Choose Backup File…
                </button>
              </div>
              {isOwner && <>
              <div className="divider" />
              <div>
                <div className="strong" style={{ marginBottom: 4 }}>Clear all entries (start fresh) — Owner only</div>
                <p className="small muted" style={{ marginBottom: 10, maxWidth: 520 }}>
                  For after a trial run, or a start full of practice entries. Deletes every
                  bill, purchase, return, tag, stock entry, order, scheme, voucher and khata
                  entry, and all customers and suppliers. Bill and tag numbers start again
                  from 1. <b>Kept:</b> shop details, logins, items and groups, accounts, rates
                  and settings. The current books are saved to a
                  <span className="mono"> before-clear </span> file first, so this can be undone
                  with Restore. To fix just one wrong bill, open it and delete it instead.
                </p>
                <button className="btn btn-danger" onClick={openClear}>
                  <Icon.trash /> Clear All Entries…
                </button>
              </div>
              </>}
            </div>
          </div>
        </div>
        <GoogleDrive />
        </>
      )}

      {clearing && (
        <Modal
          title="Clear all entries"
          onClose={() => { if (!clearBusy) setClearing(null) }}
          footer={
            <>
              <span className="spacer" />
              <button className="btn" onClick={() => setClearing(null)} disabled={clearBusy}>
                Cancel
              </button>
              <button className="btn btn-danger" onClick={doClear}
                disabled={clearBusy || clearWord.trim().toUpperCase() !== 'DELETE'}>
                {clearBusy ? <span className="spinner" /> : <Icon.trash />}
                {clearBusy ? 'Clearing…' : 'Delete all entries'}
              </button>
            </>
          }
        >
          <p className="small" style={{ marginBottom: 12 }}>
            This deletes everything below from <b>{clearing.company || 'this shop'}</b>, and
            every other entry with it. Your shop details, logins, items, accounts, rates and
            settings stay.
          </p>
          <table className="data" style={{ marginBottom: 14 }}>
            <tbody>
              <tr><td>Customers &amp; suppliers</td><td className="r mono">{clearing.counts.parties}</td></tr>
              <tr><td>Tags</td><td className="r mono">{clearing.counts.tags}</td></tr>
              <tr><td>Sales bills</td><td className="r mono">{clearing.counts.sales}</td></tr>
              <tr><td>Purchases</td><td className="r mono">{clearing.counts.purchases}</td></tr>
            </tbody>
          </table>
          <p className="small muted" style={{ marginBottom: 12 }}>
            A copy of today's books is saved first as a <span className="mono">before-clear</span> file
            in the database folder. To undo, use <b>Restore from a backup</b> and choose that file.
            The app restarts when it is done.
          </p>
          <Field label="Type DELETE to confirm">
            <Input value={clearWord} autoFocus disabled={clearBusy}
              onChange={(e) => setClearWord(e.target.value)} />
          </Field>
        </Modal>
      )}

      {restore && (
        <Modal
          title="Restore from backup"
          onClose={() => { if (!restoring) setRestore(null) }}
          footer={
            <>
              <span className="spacer" />
              <button className="btn" onClick={() => setRestore(null)} disabled={restoring}>
                Cancel
              </button>
              <button className="btn btn-danger" onClick={doRestore} disabled={restoring}>
                {restoring ? <span className="spinner" /> : <Icon.upload />}
                {restoring ? 'Restoring…' : 'Replace my data'}
              </button>
            </>
          }
        >
          <p className="small" style={{ marginBottom: 12 }}>
            <span className="mono small muted" style={{ wordBreak: 'break-all' }}>
              {restore.backup.filePath}
            </span>
          </p>

          <table className="data" style={{ marginBottom: 14 }}>
            <thead>
              <tr><th></th><th className="r">In this backup</th><th className="r">In the app now</th></tr>
            </thead>
            <tbody>
              <tr>
                <td>Shop</td>
                <td className="r">{restore.backup.company}</td>
                <td className="r">{restore.current.company || '—'}</td>
              </tr>
              <tr>
                <td>Customers &amp; suppliers</td>
                <td className="r num">{restore.backup.counts.parties}</td>
                <td className="r num">{restore.current.counts.parties}</td>
              </tr>
              <tr>
                <td>Tagged pieces</td>
                <td className="r num">{restore.backup.counts.tags}</td>
                <td className="r num">{restore.current.counts.tags}</td>
              </tr>
              <tr>
                <td>Sale bills</td>
                <td className="r num">{restore.backup.counts.sales}</td>
                <td className="r num">{restore.current.counts.sales}</td>
              </tr>
              <tr>
                <td>Purchase bills</td>
                <td className="r num">{restore.backup.counts.purchases}</td>
                <td className="r num">{restore.current.counts.purchases}</td>
              </tr>
              <tr>
                <td>Last ledger entry</td>
                <td className="r">{restore.backup.last_entry || '—'}</td>
                <td className="r">{restore.current.last_entry || '—'}</td>
              </tr>
            </tbody>
          </table>

          <div className="note">
            <strong>Everything in the right-hand column will be replaced.</strong> If the
            backup is older than your current books, any work done since it was taken will
            no longer be in the app. A copy of today's data is saved as a
            <span className="mono"> pre-restore </span> file in the data folder, so you can
            come back from this. The app will restart when the restore finishes.
          </div>
        </Modal>
      )}
    </div>
  )
}


/* ───────────────────────── Invoice designer ─────────────────────────
   A configurable template rather than a free-form canvas: every option here
   maps to something the print layout actually uses, and the preview runs the
   real renderer, so what you see is exactly what prints. */

const SAMPLE = (company: any) => ({
  company: company ?? { name: 'Demo', phone: '', gstin: '', declaration: '' },
  party: { gstin: '27ABCDE1234F1Z5', address: 'Kothrud, Pune', mobile: '9767211065' },
  pending_balance: 29140.4,
  amount_in_words: 'Rs. Fourty Nine Thousand Six Hundred Fourty and Fourty Paise Only',
  sale: {
    prefix: 'COM', bill_no: 'COM1', bill_date: new Date().toISOString().slice(0, 10),
    manual_no: '', party_name: 'Sandip Jain', address: 'Kothrud, Pune',
    mobile: '9767211065', is_credit: 1, payment_mode: 'Cash',
    goods_amount: 55080, making_amount: 3600, hallmark_amount: 0,
    bill_amount: 58680, gst_pct: 3, gst_amount: 1760.4,
    bill_discount: 0, making_discount: 0, other_amount: 0, tcs_amount: 0,
    total_amount: 60440.4, urd_amount: 10800, amount_received: 0, net_balance: 49640.4,
    items: [{
      item_name: 'Ring', tag: 'RIN00002', hsn: '7113', qty: 0, gross_wt: 12,
      purity: 91.6, stone_wt: 0, net_wt: 12, rate_per_gm: 4590, mkg_per_gm: 300,
      mkg_amount: 3600, total_amount: 55080, hallmark_charges: 0, huid: '',
    }],
    urds: [{
      name: 'Old Gold', description: 'chain', gross_wt: 3, net_wt: 3,
      purity: 80, final_wt: 2.4, rate: 4500, amount: 10800,
    }],
  },
})

const COLS = [
  { k: 'hsn', label: 'HSN' }, { k: 'purity', label: 'Purity' },
  { k: 'huid', label: 'HUID' }, { k: 'qty', label: 'Qty' },
  { k: 'gross', label: 'Gross Wt' }, { k: 'net', label: 'Net Wt' },
  { k: 'rate', label: 'Rate' }, { k: 'mkg', label: 'Making' },
]

function InvoiceDesign({ company }: { company: any }) {
  const run = useAction()
  const [cfg, setCfg] = useState<InvoiceConfig | null>(null)

  useEffect(() => {
    window.api.settings.all().then((s) => setCfg(loadConfig(s.invoice_config)))
  }, [])

  const html = useMemo(() => (cfg ? invoiceHtml(SAMPLE(company), cfg) : ''), [cfg, company])

  if (!cfg) return <Loading rows={4} />

  const set = (patch: Partial<InvoiceConfig>) => setCfg({ ...cfg, ...patch })
  const setCol = (k: string, v: boolean) => setCfg({ ...cfg, cols: { ...cfg.cols, [k]: v } })

  const save = () => run(
    () => window.api.settings.set({ key: 'invoice_config', value: JSON.stringify(cfg) }),
    'Invoice design saved'
  )

  return (
    <>
      <div style={{ display: 'grid', gridTemplateColumns: '330px 1fr', gap: 14, alignItems: 'start' }}>
        <div className="col" style={{ gap: 14 }}>
          <div className="card">
            <div className="card-head"><span className="card-title">Layout</span></div>
            <div className="card-body">
              <div className="form-grid" style={{ gap: 12 }}>
                <Field label="Paper">
                  <Segmented value={cfg.paper} onChange={(v) => set({ paper: v as any })}
                    options={[{ value: 'A4', label: 'A4 Sheet' }, { value: 'THERMAL', label: 'Thermal 3in' }]} />
                </Field>
                <Field label="Document Title">
                  <Input value={cfg.title} onChange={(e) => set({ title: e.target.value })} />
                </Field>
                <Field label="Accent Colour" hint="Company name and highlight bands">
                  <div className="row">
                    <input type="color" value={cfg.accent} style={{ width: 44, height: 34, padding: 2 }}
                      onChange={(e) => set({ accent: e.target.value })} />
                    <Input value={cfg.accent} className="mono"
                      onChange={(e) => set({ accent: e.target.value })} />
                  </div>
                </Field>
                <Field label="Footer Note" hint="Printed under the totals">
                  <Input value={cfg.footerNote} placeholder="e.g. Goods once sold will not be taken back"
                    onChange={(e) => set({ footerNote: e.target.value })} />
                </Field>
              </div>
            </div>
          </div>

          <div className="card">
            <div className="card-head"><span className="card-title">Item Columns</span></div>
            <div className="card-body">
              <div className="col" style={{ gap: 9 }}>
                {COLS.map((c) => (
                  <Check key={c.k} label={c.label} checked={!!cfg.cols[c.k]}
                    onChange={(v) => setCol(c.k, v)} />
                ))}
              </div>
            </div>
          </div>

          <div className="card">
            <div className="card-head"><span className="card-title">Sections</span></div>
            <div className="card-body">
              <div className="col" style={{ gap: 9 }}>
                <Check label="Print company logo" checked={cfg.showLogo} onChange={(v) => set({ showLogo: v })} />
                <Check label="Old gold (URD) table" checked={cfg.showUrd} onChange={(v) => set({ showUrd: v })} />
                <Check label="Bank details" checked={cfg.showBank} onChange={(v) => set({ showBank: v })} />
                <Check label="Declaration text" checked={cfg.showDeclaration} onChange={(v) => set({ showDeclaration: v })} />
                <Check label="Signature row" checked={cfg.showSignature} onChange={(v) => set({ showSignature: v })} />
                <Check label="Pending balance" checked={cfg.showPendingBalance} onChange={(v) => set({ showPendingBalance: v })} />
              </div>
            </div>
          </div>
        </div>

        <div className="card" style={{ position: 'sticky', top: 0 }}>
          <div className="card-head">
            <span className="card-title">Live Preview</span>
            <span className="hint" style={{ marginLeft: 'auto' }}>Sample data, real print renderer</span>
          </div>
          <div className="card-body" style={{ background: 'var(--surface-3)' }}>
            <iframe
              title="Invoice preview"
              srcDoc={html}
              style={{
                width: '100%', height: cfg.paper === 'A4' ? 760 : 620,
                border: '1px solid var(--line)', borderRadius: 'var(--radius-sm)', background: '#fff',
              }}
            />
          </div>
        </div>
      </div>

      <div className="sticky-actions">
        <button className="btn" onClick={() => setCfg({ ...DEFAULT_INVOICE_CONFIG })}>Reset to default</button>
        <span className="spacer" />
        <button className="btn" onClick={() => window.api.print.html({ html })}>
          <Icon.print /> Test Print
        </button>
        <button className="btn btn-primary" onClick={save}><Icon.save /> Save Design</button>
      </div>
    </>
  )
}
