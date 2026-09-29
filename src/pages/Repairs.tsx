import React, { useEffect, useMemo, useState } from 'react'
import { Icon } from '../lib/icons'
import {
  Button, Check, Confirm, Empty, Field, Input, Loading, Modal, Select,
  useAction, useAsync, useDebounced, useToast,
} from '../lib/ui'
import { num } from '../lib/calc'
import { dmy, money, todayISO, wt } from '../lib/format'
import { Pagination } from '../lib/inventory'

/**
 * T10 — Customer repair register.
 * Customer articles are separate custody identity: never saleable shop stock.
 */
export default function Repairs({ go }: { go: (n: string, p?: any) => void }) {
  const run = useAction()
  const { push } = useToast()

  const [status, setStatus] = useState('ALL')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [editing, setEditing] = useState<any>(null)
  const [confirmDel, setConfirmDel] = useState<any>(null)
  const [showAttach, setShowAttach] = useState<any>(null)
  const q = useDebounced(search, 250)

  const list = useAsync(() => window.api.repairs.list({ status: status === 'ALL' ? undefined : status, search: q, page }), [status, q, page])
  const customers = useAsync(() => window.api.party.list({ type: 'CUSTOMER', search: '' }), [])
  const karagirs = useAsync(() => window.api.party.list({ type: 'KARAGIR', search: '' }), [])

  const STATES = ['RECEIVED', 'ASSESSED', 'ASSIGNED', 'IN_PROGRESS', 'READY', 'DELIVERED', 'CANCELLED']
  const NEXT = {
    RECEIVED: ['ASSESSED', 'CANCELLED'],
    ASSESSED: ['ASSIGNED', 'CANCELLED'],
    ASSIGNED: ['IN_PROGRESS', 'CANCELLED'],
    IN_PROGRESS: ['READY', 'CANCELLED'],
    READY: ['DELIVERED', 'CANCELLED'],
    DELIVERED: [],
    CANCELLED: [],
  }

  const create = async () => {
    setEditing({ id: null, status: 'RECEIVED', customer_id: '', customer_name: '', description: '', gross_wt: '', net_wt: '', stone_details: '', damage: '', requested_work: '', estimate: '', promised_date: '', karigar_id: '' })
  }

  const save = async () => {
    if (!editing.customer_name?.trim() && !editing.customer_id) return run(async () => { throw new Error('Customer is required') })
    const ok = await run(
      () => window.api.repairs.create({
        ...editing,
        customer_id: editing.customer_id ? Number(editing.customer_id) : null,
        gross_wt: num(editing.gross_wt), net_wt: num(editing.net_wt),
        estimate: num(editing.estimate), promised_date: editing.promised_date || null,
        karigar_id: editing.karigar_id ? Number(editing.karigar_id) : null,
      }),
      editing.id ? 'Repair updated' : 'Repair created'
    )
    if (ok !== undefined) { setEditing(null); list.reload() }
  }

  const transition = async (jobId: number, to: string) => {
    if (!confirm(`Move to ${to}?`)) return
    const ok = await run(
      () => window.api.repairs.transition({ id: jobId, to, actor: 'user' }),
      `Repair ${to.toLowerCase()}`
    )
    if (ok !== undefined) list.reload()
  }

  const deleteRepair = async () => {
    if (!confirmDel) return
    const ok = await run(() => window.api.repairs.remove({ id: confirmDel.id }), 'Repair deleted')
    setConfirmDel(null)
    if (ok !== undefined) list.reload()
  }

  const attachFile = async (jobId: number, file: File) => {
    if (file.size > 8 * 1024 * 1024) return push('error', 'File exceeds 8 MB')
    if (!/^(image\/jpeg|image\/png|image\/webp|application\/pdf)$/.test(file.type)) return push('error', 'Only JPG, PNG, WebP or PDF')
    // In a real app, this would upload to a managed storage and return a file_id
    // For now, use a placeholder
    const fileId = `repair-${jobId}-${Date.now()}`
    const ok = await run(
      () => window.api.repairs.addAttachment({ job_id: jobId, file_id: fileId, file_name: file.name, mime: file.type, size: file.size, actor: 'user' }),
      'Attachment added'
    )
    if (ok !== undefined) { list.reload(); push('success', 'Attachment added') }
  }

  const rows = list.data || []

  return (
    <div className="content-narrow">
      <div className="toolbar">
        <div className="search-box" style={{ flex: 1 }}>
          <Icon.search />
          <input className="input" placeholder="Search repairs…" value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1) }} />
        </div>
        <Select value={status} onChange={v => { setStatus(v); setPage(1) }} style={{ width: 160 }}
          options={[{ value: 'ALL', label: 'All' }, ...STATES.map(s => ({ value: s, label: s }))]} />
        <button className="btn btn-primary" onClick={create}><Icon.plus /> New Repair</button>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-body flush">
          {list.error && <div className="note" role="alert">{list.error} <button className="btn" onClick={list.reload}>Retry</button></div>}
          <Pagination data={list.data} onPage={setPage} disabled={list.loading} />
          {!list.loading && !rows.length ? (
            <Empty icon={Icon.wrench} title="No repairs found"
              action={<button className="btn btn-primary btn-sm" onClick={create}>Create a repair job</button>} />
          ) : (
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th>ID</th><th>Date</th><th>Customer</th>
                    <th>Description</th><th>Status</th>
                    <th className="r">Estimate</th><th>Promised</th><th>Karigar</th>
                    <th className="r">Wt(g)</th><th></th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r: any) => (
                    <tr key={r.id}>
                      <td className="mono">#{r.id}</td>
                      <td>{dmy(r.created_at?.slice(0, 10))}</td>
                      <td>{r.customer_name}</td>
                      <td style={{ maxWidth: 200 }}>{r.description}</td>
                      <td>
                        <span className={`badge ${r.status === 'DELIVERED' ? 'badge-ok' : r.status === 'CANCELLED' ? 'badge-mute' : 'badge-gold'}`}>
                          {r.status}
                        </span>
                      </td>
                      <td className="r num">{money(r.estimate)}</td>
                      <td>{r.promised_date ? dmy(r.promised_date) : <span className="muted">—</span>}</td>
                      <td>{r.karigar_id ? `K#${r.karigar_id}` : <span className="muted">—</span>}</td>
                      <td className="r num">{wt(r.net_wt || r.gross_wt)}</td>
                      <td className="r">
                        <button className="btn btn-ghost btn-icon btn-sm" onClick={() => setEditing(r)} aria-label="Edit"><Icon.edit /></button>
                        <button className="btn btn-ghost btn-icon btn-sm" onClick={() => setConfirmDel(r)} aria-label="Delete"><Icon.trash /></button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* New/Edit modal */}
      {editing && (
        <Modal title={editing.id ? 'Edit Repair' : 'New Repair'} onClose={() => setEditing(null)}
          footer={<><span className="spacer" /><button className="btn" onClick={() => setEditing(null)}>Cancel</button><button className="btn btn-primary" onClick={save}><Icon.save /> Save</button></>}>
          <div className="form-grid cols-2">
            <Field label="Customer" required>
              <Select value={editing.customer_id || ''}
                onChange={(v) => {
                  const p = (customers.data || []).find(x => String(x.id) === String(v))
                  setEditing({ ...editing, customer_id: v, customer_name: p?.name || '' })
                }}
                options={[{ value: '', label: 'Select or type…' }, ...(customers.data || []).map((c: any) => ({ value: String(c.id), label: c.name }))]} />
            </Field>
            <Field label="Customer Name" hint="Or type a walk-in name">
              <Input value={editing.customer_name} onChange={e => setEditing({ ...editing, customer_name: e.target.value })} />
            </Field>
            <Field label="Description" className="span-2" hint="What was brought in — e.g. 'Gold chain with pendant'">
              <Input value={editing.description} onChange={e => setEditing({ ...editing, description: e.target.value })} />
            </Field>
            <Field label="Gross Wt (g)">
              <Input className="right" inputMode="decimal" value={editing.gross_wt} onChange={e => setEditing({ ...editing, gross_wt: e.target.value })} />
            </Field>
            <Field label="Net Wt (g)">
              <Input className="right" inputMode="decimal" value={editing.net_wt} onChange={e => setEditing({ ...editing, net_wt: e.target.value })} />
            </Field>
            <Field label="Stone Details">
              <Input value={editing.stone_details} onChange={e => setEditing({ ...editing, stone_details: e.target.value })} />
            </Field>
            <Field label="Damage / Notes" className="span-2">
              <Input value={editing.damage} onChange={e => setEditing({ ...editing, damage: e.target.value })} />
            </Field>
            <Field label="Requested Work" className="span-2">
              <Input value={editing.requested_work} onChange={e => setEditing({ ...editing, requested_work: e.target.value })} />
            </Field>
            <Field label="Estimate (₹)">
              <Input className="right" inputMode="decimal" value={editing.estimate} onChange={e => setEditing({ ...editing, estimate: e.target.value })} />
            </Field>
            <Field label="Promised Date">
              <Input type="date" value={editing.promised_date} onChange={e => setEditing({ ...editing, promised_date: e.target.value })} />
            </Field>
            <Field label="Karigar">
              <Select value={editing.karigar_id || ''}
                onChange={v => setEditing({ ...editing, karigar_id: v })}
                options={[{ value: '', label: '—' }, ...(karagirs.data || []).map((k: any) => ({ value: String(k.id), label: k.name }))]} />
            </Field>
          </div>

          {/* Attachments */}
          <div className="divider" style={{ margin: '16px 0' }} />
          <div className="row" style={{ gap: 8, alignItems: 'center', marginBottom: 8 }}>
            <span className="card-title">Attachments</span>
            <input type="file" accept="image/jpeg,image/png,image/webp,application/pdf"
              onChange={e => e.target.files?.[0] && attachFile(editing.id, e.target.files[0])} style={{ display: 'none' }} ref={attachInput} id="attach-input" />
            <button className="btn btn-sm" onClick={() => attachInput.current?.click()}>
              <Icon.plus /> Add photo / PDF
            </button>
          </div>
          {(editing.attachments || []).length && (
            <div className="row wrap" style={{ gap: 8 }}>
              {editing.attachments.map((a: any) => (
                <span key={a.id} className="badge badge-gold">{a.file_name} ({Math.round((a.size||0)/1024)} KB)</span>
              ))}
            </div>
          )}
        </Modal>
      )}

      {confirmDel && (
        <Confirm title="Delete repair?" message={`"${confirmDel.customer_name}" will be removed.`}
          onConfirm={deleteRepair} onCancel={() => setConfirmDel(null)} />
      )}
    </div>
  )
}

// Ref for file input
function RepairsWithRef() {
  const attachInput = React.useRef<HTMLInputElement>(null)
  return <Repairs attachInput={attachInput} />
}
// Actually just use a ref in the component
export default Repairs