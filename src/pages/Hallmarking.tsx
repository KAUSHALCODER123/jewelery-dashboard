import React, { useState } from 'react'
import { Icon } from '../lib/icons'
import {
  Confirm, Empty, Field, Input, Modal, Select, Segmented,
  useAction, useAsync, useDebounced, useToast,
} from '../lib/ui'
import { num } from '../lib/calc'
import { dmy, wt } from '../lib/format'
import { Pagination } from '../lib/inventory'

/**
 * T12 — Hallmarking batches.
 * Pieces away carry a HALLMARK hold and cannot be sold. A piece sent back for
 * rework stays out (and held) until it is received again.
 */
const STATES = ['PREPARED', 'DISPATCHED', 'PARTIAL', 'CLOSED', 'CANCELLED']
const LABEL: Record<string, string> = {
  PREPARED: 'Prepared', DISPATCHED: 'At centre', PARTIAL: 'Part received', CLOSED: 'Closed', CANCELLED: 'Cancelled',
  PENDING: 'Not sent', RETURNED: 'Returned', FAILED: 'Failed', REWORK: 'Rework',
}
const batchBadge = (s: string) => s === 'CLOSED' ? 'badge-ok' : s === 'DISPATCHED' || s === 'PARTIAL' ? 'badge-gold' : s === 'PREPARED' ? 'badge-info' : 'badge-mute'
const itemBadge = (s: string) => s === 'RETURNED' ? 'badge-ok' : s === 'FAILED' ? 'badge-danger' : s === 'REWORK' ? 'badge-warn' : s === 'DISPATCHED' ? 'badge-gold' : 'badge-mute'
const OUT = ['DISPATCHED', 'REWORK']

type Pick = { id: number; tag: string; item_name: string; net_wt: number }

export default function Hallmarking() {
  const run = useAction()
  const [status, setStatus] = useState('ALL')
  const [page, setPage] = useState(1)
  const [creating, setCreating] = useState(false)
  const [viewing, setViewing] = useState<any>(null)
  const [receiving, setReceiving] = useState<any>(null)
  const [confirm, setConfirm] = useState<{ kind: 'dispatch' | 'cancel'; batch: any } | null>(null)
  const list = useAsync(() => window.api.hallmark.list({ status: status === 'ALL' ? undefined : status, page }), [status, page])
  const rows: any[] = list.data?.rows || []

  const view = async (id: number) => {
    const b = await run(() => window.api.hallmark.read({ id }))
    if (b) setViewing(b)
  }
  const startReceive = async (id: number) => {
    const b = await run(() => window.api.hallmark.read({ id }))
    if (!b) return
    setReceiving({
      ...b,
      lines: b.items.filter((it: any) => OUT.includes(it.outcome)).map((it: any) => ({
        tag_id: it.tag_id, tag: it.tag, item_name: it.item_name, net_wt: it.net_wt,
        outcome: 'RETURNED', huid: it.huid || it.tag_huid || '', return_wt: '', was: it.outcome,
      })),
    })
  }

  const act = async () => {
    if (!confirm) return
    const { kind, batch } = confirm
    const ok = await run(
      () => kind === 'dispatch' ? window.api.hallmark.dispatch({ id: batch.id }) : window.api.hallmark.cancel({ id: batch.id }),
      kind === 'dispatch' ? `Batch #${batch.id} dispatched` : `Batch #${batch.id} cancelled`
    )
    setConfirm(null)
    if (ok) { setViewing(null); list.reload() }
  }

  const receive = async () => {
    // "Still at centre" lines are left out: they stay outstanding on the batch.
    const receipts = receiving.lines.filter((l: any) => l.outcome).map((l: any) => ({
      tag_id: l.tag_id, outcome: l.outcome,
      huid: l.outcome === 'RETURNED' ? l.huid.trim().toUpperCase() : undefined,
      return_wt: l.return_wt === '' ? undefined : num(l.return_wt),
    }))
    const ok = await run(() => window.api.hallmark.receive({ id: receiving.id, receipts }), 'Received')
    if (ok) { setReceiving(null); list.reload() }
  }
  const setLine = (i: number, patch: any) =>
    setReceiving({ ...receiving, lines: receiving.lines.map((l: any, j: number) => j === i ? { ...l, ...patch } : l) })

  return (
    <div className="content-narrow">
      <div className="toolbar">
        <Segmented value={status} onChange={v => { setStatus(v); setPage(1) }}
          options={[{ value: 'ALL', label: 'All' }, ...STATES.map(s => ({ value: s, label: LABEL[s] }))]} />
        <span className="spacer" />
        <button className="btn btn-primary" onClick={() => setCreating(true)}><Icon.plus /> New Batch</button>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-body flush">
          {list.error && <div className="note" role="alert">{list.error} <button className="btn" onClick={list.reload}>Retry</button></div>}
          <Pagination data={list.data} onPage={setPage} disabled={list.loading} />
          {!list.loading && !rows.length ? (
            <Empty icon={Icon.stamp} title="No hallmark batches"
              action={<button className="btn btn-primary btn-sm" onClick={() => setCreating(true)}>Prepare a batch</button>} />
          ) : (
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr><th>Batch</th><th>Created</th><th>Centre</th><th>Status</th><th className="r">Pieces</th><th className="r">Still out</th><th></th></tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id} onDoubleClick={() => view(r.id)}>
                      <td className="mono">#{r.id}</td>
                      <td>{dmy(r.created_at?.slice(0, 10))}</td>
                      <td>{r.centre}</td>
                      <td><span className={`badge ${batchBadge(r.status)}`}>{LABEL[r.status] || r.status}</span></td>
                      <td className="r num">{r.pieces}</td>
                      <td className="r num">{r.status === 'CANCELLED' ? '—' : r.outstanding || '—'}</td>
                      <td className="r" style={{ whiteSpace: 'nowrap' }}>
                        {r.status === 'PREPARED' && <>
                          <button className="btn btn-sm" onClick={() => setConfirm({ kind: 'dispatch', batch: r })}><Icon.send /> Dispatch</button>
                          <button className="btn btn-ghost btn-icon btn-sm" title="Cancel batch" aria-label="Cancel batch" onClick={() => setConfirm({ kind: 'cancel', batch: r })}><Icon.close /></button>
                        </>}
                        {(r.status === 'DISPATCHED' || r.status === 'PARTIAL') && (
                          <button className="btn btn-sm" onClick={() => startReceive(r.id)}><Icon.download /> Receive</button>
                        )}
                        <button className="btn btn-ghost btn-icon btn-sm" title="View" aria-label="View" onClick={() => view(r.id)}><Icon.edit /></button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {creating && <NewBatch onClose={() => setCreating(false)} onSaved={() => { setCreating(false); list.reload() }} />}

      {viewing && (
        <Modal wide title={`Batch #${viewing.id} — ${viewing.centre}`} onClose={() => setViewing(null)}
          footer={<>
            <span className={`badge ${batchBadge(viewing.status)}`}>{LABEL[viewing.status]}</span>
            <span className="spacer" />
            <button className="btn" onClick={() => setViewing(null)}>Close</button>
            {viewing.status === 'PREPARED' && <button className="btn btn-primary" onClick={() => setConfirm({ kind: 'dispatch', batch: viewing })}><Icon.send /> Dispatch</button>}
            {(viewing.status === 'DISPATCHED' || viewing.status === 'PARTIAL') &&
              <button className="btn btn-primary" onClick={() => { const id = viewing.id; setViewing(null); startReceive(id) }}><Icon.download /> Receive</button>}
          </>}>
          <div className="table-wrap">
            <table className="data">
              <thead><tr><th>Tag</th><th>Item</th><th className="r">Net Wt</th><th>Outcome</th><th>HUID</th><th className="r">Return Wt</th></tr></thead>
              <tbody>
                {viewing.items.map((it: any) => (
                  <tr key={it.id}>
                    <td className="mono strong">{it.tag}</td>
                    <td>{it.item_name || '—'}</td>
                    <td className="r num">{wt(it.net_wt)}</td>
                    <td><span className={`badge ${itemBadge(it.outcome)}`}>{LABEL[it.outcome] || it.outcome}</span></td>
                    <td className="mono">{it.huid || it.tag_huid || <span className="muted">—</span>}</td>
                    <td className="r num">{it.return_wt != null ? wt(it.return_wt) : <span className="muted">—</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {viewing.events?.length > 0 && (
            <div className="small muted" style={{ marginTop: 12 }}>
              {viewing.events.map((e: any) => (
                <div key={e.id}>{dmy(e.created_at?.slice(0, 10))} {e.created_at?.slice(11, 16)} · {LABEL[e.to_state] || e.to_state}{e.actor ? ` · ${e.actor}` : ''}{e.note ? ` · ${e.note}` : ''}</div>
              ))}
            </div>
          )}
        </Modal>
      )}

      {receiving && (
        <Modal wide title={`Receive batch #${receiving.id} — ${receiving.centre}`} onClose={() => setReceiving(null)}
          footer={<><span className="spacer" /><button className="btn" onClick={() => setReceiving(null)}>Cancel</button>
            <button className="btn btn-primary" onClick={receive} disabled={!receiving.lines.some((l: any) => l.outcome)}><Icon.save /> Save Receipt</button></>}>
          <p className="hint" style={{ marginTop: 0 }}>
            Returned and failed pieces come back into saleable stock. Rework keeps the piece on hold at the centre;
            "Still at centre" leaves it outstanding on this batch.
          </p>
          <div className="table-wrap">
            <table className="data">
              <thead><tr><th>Tag</th><th>Item</th><th className="r">Net Wt</th><th>Outcome</th><th>HUID</th><th className="r">Return Wt</th></tr></thead>
              <tbody>
                {receiving.lines.map((l: any, i: number) => (
                  <tr key={l.tag_id}>
                    <td className="mono strong">{l.tag}{l.was === 'REWORK' && <span className="badge badge-warn" style={{ marginLeft: 6 }}>rework</span>}</td>
                    <td>{l.item_name || '—'}</td>
                    <td className="r num">{wt(l.net_wt)}</td>
                    <td style={{ minWidth: 170 }}>
                      <Select value={l.outcome} onChange={v => setLine(i, { outcome: v })}
                        options={[{ value: 'RETURNED', label: 'Returned — hallmarked' }, { value: 'FAILED', label: 'Failed' },
                          { value: 'REWORK', label: 'Rework' }, { value: '', label: 'Still at centre' }]} />
                    </td>
                    <td style={{ width: 130 }}>
                      {l.outcome === 'RETURNED'
                        ? <Input className="mono" maxLength={6} value={l.huid} placeholder="6-char HUID"
                            aria-invalid={l.huid && !/^[A-Za-z0-9]{6}$/.test(l.huid.trim()) ? true : undefined}
                            onChange={e => setLine(i, { huid: e.target.value.toUpperCase() })} />
                        : <span className="muted">—</span>}
                    </td>
                    <td className="r" style={{ width: 120 }}>
                      {l.outcome && l.outcome !== 'REWORK'
                        ? <Input className="right" inputMode="decimal" value={l.return_wt} placeholder={wt(l.net_wt)} onChange={e => setLine(i, { return_wt: e.target.value })} />
                        : <span className="muted">—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Modal>
      )}

      {confirm && (
        <Confirm
          title={confirm.kind === 'dispatch' ? `Dispatch batch #${confirm.batch.id}?` : `Cancel batch #${confirm.batch.id}?`}
          message={confirm.kind === 'dispatch'
            ? `Its pieces go on hold and cannot be sold until they are received back from ${confirm.batch.centre}.`
            : 'The batch has not left the shop; its pieces simply stay in stock.'}
          confirmLabel={confirm.kind === 'dispatch' ? 'Dispatch' : 'Cancel batch'} danger={confirm.kind === 'cancel'}
          onConfirm={act} onCancel={() => setConfirm(null)} />
      )}
    </div>
  )
}

/** Prepare a batch: search or scan in-stock pieces and collect them. */
function NewBatch({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const run = useAction()
  const { push } = useToast()
  const [centre, setCentre] = useState('')
  const [search, setSearch] = useState('')
  const [picked, setPicked] = useState<Pick[]>([])
  const q = useDebounced(search.trim(), 200)
  // In-stock only (the lookup's default); pieces already held are refused on save.
  const found = useAsync(() => q ? window.api.tagStock.searchPaged({ q, page: 1, pageSize: 20 }) : Promise.resolve(null), [q])
  const pickedIds = new Set(picked.map(p => p.id))
  const results: any[] = (found.data?.rows || []).filter((t: any) => !pickedIds.has(t.id))

  const add = (t: any) => {
    setPicked((p) => p.some(x => x.id === t.id) ? p : [...p, { id: t.id, tag: t.tag, item_name: t.item_name, net_wt: t.net_wt }])
    setSearch('')
  }
  // A scanner types the tag and presses Enter: take the exact match straight away.
  // Read the box itself, not state: Enter can land in the same tick as the last character.
  const onKey = async (e: React.KeyboardEvent<HTMLInputElement>) => {
    const tag = e.currentTarget.value.trim()
    if (e.key !== 'Enter' || !tag) return
    e.preventDefault()
    const hit = await run(() => window.api.tagStock.exact({ tag }))
    const t = (hit || []).find((x: any) => x.status === 'IN_STOCK')
    if (t) add(t)
    else push('error', `${tag} is not an in-stock tag`)
  }

  const save = async () => {
    const ok = await run(() => window.api.hallmark.create({ centre, tag_ids: picked.map(p => p.id) }), 'Hallmark batch prepared')
    if (ok) onSaved()
  }
  const totalWt = picked.reduce((s, p) => s + (Number(p.net_wt) || 0), 0)

  return (
    <Modal wide title="New Hallmark Batch" onClose={onClose}
      footer={<>
        <span className="small muted">{picked.length} pieces · {wt(totalWt)} g net</span>
        <span className="spacer" />
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" onClick={save} disabled={!centre.trim() || !picked.length}><Icon.save /> Prepare Batch</button>
      </>}>
      <div className="form-grid cols-2">
        <Field label="Assaying Centre" required>
          <Input autoFocus value={centre} onChange={e => setCentre(e.target.value)} />
        </Field>
        <Field label="Add pieces" hint="Scan a tag and press Enter, or search by tag, HUID or item">
          <Input value={search} onChange={e => setSearch(e.target.value)} onKeyDown={onKey} placeholder="Scan or search…" />
        </Field>
      </div>
      {q && (
        <div className="table-wrap" style={{ maxHeight: 220, marginTop: 10 }}>
          <table className="data">
            <thead><tr><th>Tag</th><th>Item</th><th className="r">Net Wt</th><th></th></tr></thead>
            <tbody>
              {results.map((t) => (
                <tr key={t.id} onClick={() => add(t)} style={{ cursor: 'pointer' }}>
                  <td className="mono strong">{t.tag}</td><td>{t.item_name}</td>
                  <td className="r num">{wt(t.net_wt)}</td><td className="r"><button className="btn btn-sm">Add</button></td>
                </tr>
              ))}
              {!found.loading && !results.length && <tr><td colSpan={4} className="muted">No in-stock pieces match</td></tr>}
            </tbody>
          </table>
        </div>
      )}
      {picked.length > 0 && (
        <div className="table-wrap" style={{ marginTop: 14 }}>
          <table className="data">
            <thead><tr><th>Tag</th><th>Item</th><th className="r">Net Wt</th><th></th></tr></thead>
            <tbody>
              {picked.map((p) => (
                <tr key={p.id}>
                  <td className="mono strong">{p.tag}</td><td>{p.item_name}</td><td className="r num">{wt(p.net_wt)}</td>
                  <td className="r">
                    <button className="btn btn-ghost btn-icon btn-sm" aria-label={`Remove ${p.tag}`} onClick={() => setPicked(picked.filter(x => x.id !== p.id))}><Icon.close /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Modal>
  )
}
