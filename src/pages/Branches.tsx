import React, { useState } from 'react'
import { Icon } from '../lib/icons'
import {
  Confirm, Empty, Field, Input, Loading, Modal, Segmented, Select, useAction, useAsync,
} from '../lib/ui'
import { ReportActions } from '../lib/grid'
import { dmy, money, todayISO, wt } from '../lib/format'
import { num } from '../lib/calc'

/**
 * Branches and stock transfer.
 *
 * A branch IS a location: a tagged piece already records where it is, so a
 * transfer moves that field and leaves a document behind. There is deliberately
 * no second per-branch stock ledger — two ledgers could disagree about where one
 * physical ring is, and then neither could be trusted.
 */
export default function Branches() {
  const [tab, setTab] = useState<'transfers' | 'branches'>('transfers')
  return (
    <div>
      <div className="tabs">
        <button className="tab" aria-selected={tab === 'transfers'} onClick={() => setTab('transfers')}>
          Transfers
        </button>
        <button className="tab" aria-selected={tab === 'branches'} onClick={() => setTab('branches')}>
          Branches
        </button>
      </div>
      {tab === 'transfers' ? <Transfers /> : <BranchList />}
    </div>
  )
}

function Transfers() {
  const run = useAction()
  const list = useAsync(() => window.api.stockTransfer.list(), [])
  const positions = useAsync(() => window.api.branch.stock(), [])
  const [making, setMaking] = useState(false)
  const [openId, setOpenId] = useState<number | null>(null)
  const [confirmDel, setConfirmDel] = useState<number | null>(null)
  const rows = list.data || []

  return (
    <div>
      <div className="toolbar">
        <span className="page-title">Stock Transfers</span>
        <span className="spacer" />
        <ReportActions build={() => ({
          baseName: 'stock-transfers', title: 'Stock Transfers',
          headers: ['Doc No', 'Date', 'From', 'To', 'Pieces', 'Remarks'],
          rows: rows.map((r: any) => [r.doc_no, r.transfer_date, r.from_branch, r.to_branch, r.pieces, r.remarks]),
        })} />
        <button className="btn btn-primary" onClick={() => setMaking(true)}>
          <Icon.plus /> New Transfer
        </button>
      </div>

      <div className="card" style={{ marginBottom: 14 }}>
        <div className="card-head"><span className="card-title">Where the stock is</span></div>
        <div className="card-body flush">
          {positions.loading ? <Loading rows={2} /> : (
            <table className="data">
              <thead><tr><th>Branch</th><th className="r">Pieces</th>
                <th className="r">Gross Wt</th><th className="r">Fine Wt</th>
                <th className="r">Value at Cost</th></tr></thead>
              <tbody>
                {(positions.data || []).map((p: any) => (
                  <tr key={p.branch}>
                    <td className="strong">{p.branch}</td>
                    <td className="r num">{p.pieces}</td>
                    <td className="r num">{wt(p.gross_wt)}</td>
                    <td className="r num strong">{wt(p.fine_wt)}</td>
                    <td className="r num">{money(p.cost_value)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <div className="card">
        <div className="card-body flush">
          {list.loading ? <Loading rows={3} /> : !rows.length ? (
            <Empty icon={Icon.stock} title="No transfers yet">
              Move pieces between branches and each move is recorded here.
            </Empty>
          ) : (
            <div className="table-wrap">
              <table className="data">
                <thead><tr><th>Doc No</th><th>Date</th><th>From</th><th>To</th>
                  <th className="r">Pieces</th><th>Remarks</th><th></th></tr></thead>
                <tbody>
                  {rows.map((r: any) => (
                    <tr key={r.id} className="clickable" onClick={() => setOpenId(r.id)}>
                      <td className="mono strong">{r.doc_no}</td>
                      <td>{dmy(r.transfer_date)}</td>
                      <td>{r.from_branch}</td>
                      <td className="strong">{r.to_branch}</td>
                      <td className="r num">{r.pieces}</td>
                      <td className="muted small">{r.remarks || '—'}</td>
                      <td className="r">
                        <button className="btn btn-ghost btn-icon btn-sm" aria-label="Delete"
                          onClick={(e) => { e.stopPropagation(); setConfirmDel(r.id) }}>
                          <Icon.trash />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {making && (
        <TransferModal onClose={() => setMaking(false)}
          onSaved={() => { setMaking(false); list.reload(); positions.reload() }} />
      )}
      {openId && <TransferDetail id={openId} onClose={() => setOpenId(null)} />}
      {confirmDel && (
        <Confirm title="Undo this transfer?"
          message="Every piece goes back to the branch it came from."
          onConfirm={async () => {
            const id = confirmDel
            setConfirmDel(null)
            await run(() => window.api.stockTransfer.remove({ id }), 'Transfer undone')
            list.reload(); positions.reload()
          }}
          onCancel={() => setConfirmDel(null)} />
      )}
    </div>
  )
}

function TransferModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const run = useAction()
  const branches = useAsync(() => window.api.branch.list(), [])
  const [f, setF] = useState<any>({
    from_branch: '', to_branch: '', transfer_date: todayISO(), remarks: '',
  })
  const [scan, setScan] = useState('')
  const [tags, setTags] = useState<string[]>([])

  // Only what is actually at the source branch can be sent from it — the engine
  // refuses anything else, so the picker should not offer it either.
  const available = useAsync(
    () => f.from_branch
      ? window.api.tagStock.list({ status: 'IN_STOCK' })
      : Promise.resolve([]),
    [f.from_branch]
  )
  const here = (available.data || []).filter((t: any) => (t.location || '') === f.from_branch)

  const add = (tag: string) => {
    const t = tag.trim()
    if (!t || tags.includes(t)) return
    setTags((ts) => [...ts, t])
    setScan('')
  }

  const save = async () => {
    const res = await run(() => window.api.stockTransfer.save({ ...f, tags }), 'Transfer saved')
    if (res) onSaved()
  }

  return (
    <Modal wide title="New Stock Transfer" onClose={onClose}
      footer={<>
        <span className="small muted">{tags.length} piece{tags.length === 1 ? '' : 's'}</span>
        <span className="spacer" />
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" onClick={save}><Icon.save /> Save Transfer</button>
      </>}>
      <div className="form-grid cols-2">
        <Field label="From Branch" required>
          <Select value={f.from_branch} placeholder="Select…"
            onChange={(v) => { setF({ ...f, from_branch: v }); setTags([]) }}
            options={(branches.data || []).map((b: any) => ({ value: b.name, label: b.name }))} />
        </Field>
        <Field label="To Branch" required>
          <Select value={f.to_branch} placeholder="Select…"
            onChange={(v) => setF({ ...f, to_branch: v })}
            options={(branches.data || [])
              .filter((b: any) => b.name !== f.from_branch)
              .map((b: any) => ({ value: b.name, label: b.name }))} />
        </Field>
        <Field label="Date">
          <Input type="date" value={f.transfer_date}
            onChange={(e) => setF({ ...f, transfer_date: e.target.value })} />
        </Field>
        <Field label="Remarks">
          <Input value={f.remarks} onChange={(e) => setF({ ...f, remarks: e.target.value })} />
        </Field>

        <Field label="Scan or type a tag" className="span-2"
          hint={f.from_branch ? `${here.length} piece(s) at ${f.from_branch}` : 'Choose the from-branch first'}>
          <Input className="mono" value={scan} disabled={!f.from_branch}
            placeholder="Scan a barcode and press Enter"
            onChange={(e) => setScan(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') add(scan) }} />
        </Field>

        <div className="span-2">
          <div className="section-title">To move</div>
          {!tags.length ? (
            <p className="small muted">Nothing added yet.</p>
          ) : (
            <div className="row wrap" style={{ gap: 6 }}>
              {tags.map((t) => (
                <span key={t} className="badge badge-gold" style={{ cursor: 'pointer' }}
                  onClick={() => setTags((ts) => ts.filter((x) => x !== t))}>
                  {t} ✕
                </span>
              ))}
            </div>
          )}
        </div>

        {f.from_branch && (
          <div className="span-2">
            <div className="section-title">At {f.from_branch}</div>
            <div className="table-wrap" style={{ maxHeight: 200 }}>
              <table className="data">
                <thead><tr><th>Tag</th><th>Item</th><th className="r">Gross</th>
                  <th className="r">Fine</th><th></th></tr></thead>
                <tbody>
                  {here.map((t: any) => (
                    <tr key={t.id}>
                      <td className="mono">{t.tag}</td>
                      <td>{t.item_name}</td>
                      <td className="r num">{wt(t.gross_wt)}</td>
                      <td className="r num">{wt(t.final_wt)}</td>
                      <td className="r">
                        <button className="btn btn-ghost btn-sm" disabled={tags.includes(t.tag)}
                          onClick={() => add(t.tag)}>
                          {tags.includes(t.tag) ? 'Added' : 'Add'}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </Modal>
  )
}

function TransferDetail({ id, onClose }: { id: number; onClose: () => void }) {
  const t = useAsync(() => window.api.stockTransfer.read({ id }), [id])
  const d = t.data
  return (
    <Modal title={d ? `${d.doc_no} · ${d.from_branch} → ${d.to_branch}` : 'Transfer'}
      onClose={onClose}
      footer={<><span className="spacer" /><button className="btn" onClick={onClose}>Close</button></>}>
      {t.loading || !d ? <Loading rows={3} /> : (
        <>
          <p className="small muted" style={{ marginTop: 0 }}>
            {dmy(d.transfer_date)}{d.remarks ? ` · ${d.remarks}` : ''}
          </p>
          <table className="data">
            <thead><tr><th>Tag</th><th>Item</th><th>Was at</th><th>Now at</th>
              <th className="r">Fine Wt</th></tr></thead>
            <tbody>
              {d.items.map((i: any) => (
                <tr key={i.id}>
                  <td className="mono strong">{i.tag}</td>
                  <td>{i.item_name}</td>
                  <td className="muted">{i.from_location || '—'}</td>
                  <td>{i.location}</td>
                  <td className="r num">{wt(i.final_wt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </Modal>
  )
}

function BranchList() {
  const run = useAction()
  const list = useAsync(() => window.api.branch.list(), [])
  const positions = useAsync(() => window.api.branch.stock(), [])
  const [editing, setEditing] = useState<any>(null)

  const held = (name: string) =>
    (positions.data || []).find((p: any) => p.branch === name)?.pieces ?? 0

  const save = async () => {
    const ok = await run(() => window.api.branch.save(editing), 'Branch saved')
    if (ok !== undefined) { setEditing(null); list.reload(); positions.reload() }
  }

  return (
    <div className="content-narrow">
      <div className="toolbar">
        <span className="spacer" />
        <button className="btn btn-primary"
          onClick={() => setEditing({ name: '', address: '', is_main: 0 })}>
          <Icon.plus /> New Branch
        </button>
      </div>
      <div className="card">
        <div className="card-body flush">
          <p className="small muted" style={{ padding: '10px 14px 0' }}>
            A branch is a <b>location</b>. Every tagged piece records which branch it is at, so
            the stock report can be grouped by branch and a transfer simply moves pieces from
            one to another.
          </p>
          {list.loading ? <Loading rows={2} /> : (
            <table className="data">
              <thead><tr><th>Branch</th><th>Address</th><th className="r">Pieces Held</th><th></th></tr></thead>
              <tbody>
                {(list.data || []).map((b: any) => (
                  <tr key={b.id}>
                    <td className="strong">{b.name}
                      {!!b.is_main && <span className="badge badge-gold" style={{ marginLeft: 6 }}>Main</span>}
                    </td>
                    <td className="muted">{b.address || '—'}</td>
                    <td className="r num">{held(b.name)}</td>
                    <td className="r">
                      <button className="btn btn-ghost btn-icon btn-sm" aria-label="Edit"
                        onClick={() => setEditing({ ...b })}><Icon.edit /></button>
                      <button className="btn btn-ghost btn-icon btn-sm" aria-label="Delete"
                        onClick={async () => {
                          await run(() => window.api.branch.remove({ id: b.id }), 'Branch deleted')
                          list.reload(); positions.reload()
                        }}><Icon.trash /></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {editing && (
        <Modal title={editing.id ? 'Edit Branch' : 'New Branch'} onClose={() => setEditing(null)}
          footer={<><span className="spacer" />
            <button className="btn" onClick={() => setEditing(null)}>Cancel</button>
            <button className="btn btn-primary" onClick={save}><Icon.save /> Save</button></>}>
          <div className="form-grid cols-1">
            <Field label="Branch name" required
              hint="Renaming moves every piece recorded there along with it">
              <Input autoFocus value={editing.name}
                onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
            </Field>
            <Field label="Address">
              <Input value={editing.address}
                onChange={(e) => setEditing({ ...editing, address: e.target.value })} />
            </Field>
            <Field label="">
              <Segmented value={editing.is_main ? 'main' : 'branch'}
                onChange={(v) => setEditing({ ...editing, is_main: v === 'main' ? 1 : 0 })}
                options={[{ value: 'branch', label: 'Branch' }, { value: 'main', label: 'Main shop' }]} />
            </Field>
          </div>
        </Modal>
      )}
    </div>
  )
}
