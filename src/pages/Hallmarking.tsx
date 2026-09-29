import React, { useEffect, useMemo, useState } from 'react'
import { Icon } from '../lib/icons'
import {
  Button, Confirm, Empty, Field, Input, Loading, Modal, Select, Segmented,
  useAction, useAsync, useDebounced, useToast,
} from '../lib/ui'
import { num } from '../lib/calc'
import { dmy, money, todayISO, wt } from '../lib/format'
import { Pagination } from '../lib/inventory'

/**
 * T12 — Hallmarking batches.
 * Pieces away carry a HALLMARK hold and cannot be sold.
 */
export default function Hallmarking() {
  const run = useAction()
  const { push } = useToast()

  const [status, setStatus] = useState('ALL')
  const [page, setPage] = useState(1)
  const [editing, setEditing] = useState<any>(null)
  const [receiving, setReceiving] = useState<any>(null)
  const list = useAsync(() => window.api.hallmark.list({ status: status === 'ALL' ? undefined : status, page }), [status, page])
  const tagSearch = useState('') // for picking tags

  const rows = list.data?.rows || []
  const STATES = ['PREPARED', 'DISPATCHED', 'PARTIAL', 'CLOSED', 'CANCELLED']

  const create = async () => {
    if (!editing?.centre?.trim()) return push('error', 'Centre name required')
    if (!editing?.tag_ids?.length) return push('error', 'At least one tag required')
    const ok = await run(
      () => window.api.hallmark.create({ centre: editing.centre, tag_ids: editing.tag_ids, actor: 'user' }),
      'Hallmark batch created'
    )
    if (ok !== undefined) { setEditing(null); list.reload() }
  }

  const dispatch = async (id: number) => {
    const ok = await run(() => window.api.hallmark.dispatch({ id, actor: 'user' }), 'Batch dispatched')
    if (ok !== undefined) list.reload()
  }

  const receive = async () => {
    if (!receiving) return
    const items = receiving.items.map((r: any) => ({
      tag_id: r.tag_id, outcome: r.outcome, huid: r.huid || undefined, return_wt: r.return_wt ? num(r.return_wt) : undefined
    }))
    const ok = await run(
      () => window.api.hallmark.receive({ id: receiving.id, receipts: items, actor: 'user' }),
      'Items received'
    )
    if (ok !== undefined) { setReceiving(null); list.reload() }
  }

  return (
    <div className="content-narrow">
      <div className="toolbar">
        <Segmented value={status} onChange={v => { setStatus(v); setPage(1) }}
          options={[{ value: 'ALL', label: 'All' }, ...STATES.map(s => ({ value: s, label: s }))]} />
        <button className="btn btn-primary" onClick={() => setEditing({ centre: '', tag_ids: [], tagSearch: '' })}>
          <Icon.plus /> New Batch
        </button>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-body flush">
          {list.error && <div className="note" role="alert">{list.error} <button className="btn" onClick={list.reload}>Retry</button></div>}
          <Pagination data={list.data} onPage={setPage} disabled={list.loading} />
          {!list.loading && !rows.length ? (
            <Empty icon={Icon.stamp} title="No hallmark batches" />
          ) : (
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr><th>ID</th><th>Created</th><th>Centre</th><th>Status</th><th className="r">Pieces</th><th></th></tr>
                </thead>
                <tbody>
                  {rows.map((r: any) => (
                    <tr key={r.id}>
                      <td className="mono">#{r.id}</td>
                      <td>{dmy(r.created_at?.slice(0, 10))}</td>
                      <td>{r.centre}</td>
                      <td><span className={`badge ${r.status === 'CLOSED' ? 'badge-ok' : r.status === 'DISPATCHED' || r.status === 'PARTIAL' ? 'badge-gold' : r.status === 'PREPARED' ? 'badge-info' : 'badge-mute'}`}>{r.status}</span></td>
                      <td className="r">{r.pieces}</td>
                      <td className="r">
                        <button className="btn btn-ghost btn-icon btn-sm" onClick={() => window.api.hallmark.read({ id: r.id }).then(d => setEditing(d))} title="View"><Icon.edit /></button>
                        {r.status === 'PREPARED' && (
                          <button className="btn btn-ghost btn-icon btn-sm" onClick={() => dispatch(r.id)} title="Dispatch"><Icon.send /></button>
                        )}
                        {r.status === 'DISPATCHED' || r.status === 'PARTIAL' && (
                          <button className="btn btn-ghost btn-icon btn-sm" onClick={() => window.api.hallmark.read({ id: r.id }).then(d => setReceiving(d))} title="Receive"><Icon.download /></button>
                        )}
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
      {editing && !editing.items && (
        <Modal title="New Hallmark Batch" onClose={() => setEditing(null)}
          footer={<><span className="spacer" /><button className="btn" onClick={() => setEditing(null)}>Cancel</button><button className="btn btn-primary" onClick={create}><Icon.save /> Create</button></>}>
          <div className="form-grid cols-2">
            <Field label="Assaying Centre" required>
              <Input value={editing.centre} onChange={e => setEditing({ ...editing, centre: e.target.value })} />
            </Field>
            <Field label="Tags to Send" required>
              <div className="row" style={{ gap: 8, marginBottom: 8 }}>
                <input className="input grow" placeholder="Scan or search tag…" value={editing.tagSearch}
                  onChange={e => setEditing({ ...editing, tagSearch: e.target.value })} />
              </div>
              {editing.tagSearch && (
                <div className="table-wrap" style={{ maxHeight: 200 }}>
                  <table className="data"><thead><tr><th>Tag</th><th>Item</th><th className="r">Net Wt</th><th></th></tr></thead>
                  <tbody>
                    {(await window.api.tagStock.searchPaged({ q: editing.tagSearch, page: 1, pageSize: 20 })).rows?.map((t: any) => (
                      <tr key={t.id} onClick={() => setEditing({ ...editing, tag_ids: [...(editing.tag_ids || []), t.id], tagSearch: '' })}>
                        <td className="mono strong">{t.tag}</td><td>{t.item_name}</td>
                        <td className="r num">{wt(t.net_wt)}</td><td><button className="btn btn-sm">Add</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                </div>
              )}
              {editing.tag_ids?.length && (
                <div className="row wrap" style={{ gap: 6 }}>
                  {editing.tag_ids.map((tid: number) => (
                    <span key={tid} className="badge badge-gold">
                      { (await window.api.tagStock.list({ ids: [tid] }))[0]?.tag || `Tag #${tid}` }
                      <button className="btn btn-ghost btn-icon btn-xs" onClick={e => { e.stopPropagation(); setEditing({ ...editing, tag_ids: editing.tag_ids.filter((id: number) => id !== tid) }) }}><Icon.close width={12} height={12} /></button>
                    </span>
                  ))}
                </div>
              )}
            </Field>
          </div>
        </Modal>
      )}

      {/* Detail/Receive modal */}
      {(editing?.items || receiving) && (
        <Modal title={receiving ? 'Receive Hallmark Items' : `Batch #{editing.id} — ${editing.centre}`} onClose={() => { setEditing(null); setReceiving(null) }}
          footer={receiving ? (
            <><span className="spacer" /><button className="btn" onClick={() => { setReceiving(null); setEditing(null) }}>Cancel</button><button className="btn btn-primary" onClick={receive}><Icon.save /> Save Receipt</button></>
          ) : (
            <><span className="spacer" /><button className="btn" onClick={() => { setEditing(null); setReceiving(null) }}>Close</button>
            {editing.status === 'PREPARED' && <button className="btn btn-primary" onClick={() => dispatch(editing.id)}><Icon.send /> Dispatch</button>}</>
          )}>
          <div className="form-grid cols-2">
            <Field label="Status" className="span-2">
              <span className={`badge ${editing.status === 'CLOSED' ? 'badge-ok' : editing.status === 'DISPATCHED' || editing.status === 'PARTIAL' ? 'badge-gold' : editing.status === 'PREPARED' ? 'badge-info' : 'badge-mute'}`}>
                {editing.status}
              </span>
            </Field>
            <Field label="Centre" className="span-2">
              <Input readOnly value={editing.centre} />
            </Field>
            <Field label="Created" className="span-2">
              <Input readOnly value={editing.created_at?.slice(0, 16).replace('T', ' ')} />
            </Field>
          </div>
          <div className="divider" style={{ margin: '12px 0' }} />
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Tag</th><th>Item</th>
                  <th>Outcome</th>
                  {receiving && <><th>HUID</th><th className="r">Return Wt</th></>}
                  <th className="r">Net Wt</th>
                </tr>
              </thead>
              <tbody>
                {editing.items.map((it: any, i: number) => (
                  <tr key={it.id}>
                    <td className="mono strong">{it.tag}</td>
                    <td>{it.item_name || '—'}</td>
                    <td>
                      {receiving ? (
                        <Select value={it.outcome} onChange={v => setReceiving({ ...receiving, items: receiving.items.map((r: any, j: number) => j === i ? { ...r, outcome: v } : r) })}
                          options={[{ value: 'RETURNED', label: 'Returned (OK)' }, { value: 'FAILED', label: 'Failed' }, { value: 'REWORK', label: 'Rework' }]} />
                      ) : (
                        <span className={`badge ${it.outcome === 'RETURNED' ? 'badge-ok' : it.outcome === 'DISPATCHED' ? 'badge-gold' : it.outcome === 'FAILED' ? 'badge-danger' : it.outcome === 'REWORK' ? 'badge-warn' : 'badge-mute'}`}>
                          {it.outcome}
                        </span>
                      )}
                    </td>
                    {receiving && it.outcome === 'RETURNED' && (
                      <>
                        <td><Input value={it.huid || ''} onChange={e => setReceiving({ ...receiving, items: receiving.items.map((r: any, j: number) => j === i ? { ...r, huid: e.target.value } : r) })} placeholder="HUID if returned" /></td>
                        <td className="r"><Input className="right" inputMode="decimal" value={it.return_wt || ''} onChange={e => setReceiving({ ...receiving, items: receiving.items.map((r: any, j: number) => j === i ? { ...r, return_wt: e.target.value } : r) })} placeholder="Return wt" /></td>
                      </>
                    )}
                    {(!receiving || it.outcome !== 'RETURNED') && <td colSpan={2} />}
                    <td className="r num">{wt(it.net_wt || it.final_wt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Modal>
      )}
    </div>
  )
}