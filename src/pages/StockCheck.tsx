import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Icon } from '../lib/icons'
import { Confirm, Empty, Field, Loading, Modal, Select, useAction } from '../lib/ui'
import { num } from '../lib/calc'
import { dmy, toCsv, todayISO, wt } from '../lib/format'
import { Pagination } from '../lib/inventory'

/**
 * Physical stock verification (T07). Scan every piece in the tray; anything
 * left unscanned at the end is physically missing. Green = found, red = not
 * found — the same signal the original software gave.
 *
 * A count is a saved session: the pieces expected are frozen when it starts,
 * every scan is stored as it happens, and a count can be paused, picked up
 * again on another day, submitted and signed off. Counting never changes stock.
 */
const RESULT: Record<string, { ok: boolean; text: string }> = {
  MATCHED: { ok: true, text: 'found' },
  WRONG_LOCATION: { ok: true, text: 'found — but it is booked to another location' },
  DUPLICATE: { ok: false, text: 'was already scanned' },
  OUTSIDE_SCOPE: { ok: false, text: 'is in stock but not part of this count' },
  ALREADY_SOLD: { ok: false, text: 'is not in stock (sold, issued or melted)' },
  UNKNOWN: { ok: false, text: 'is not a known tag' },
}
const EXTRA_LABEL: Record<string, string> = {
  OUTSIDE_SCOPE: 'Other location', ALREADY_SOLD: 'Not in stock', UNKNOWN: 'Unknown tag',
}
const STATUS_BADGE: Record<string, string> = {
  OPEN: 'badge-gold', PAUSED: 'badge-info', SUBMITTED: 'badge-warn', APPROVED: 'badge-ok', CLOSED: 'badge-ok', CANCELLED: 'badge-mute',
}
const LIVE = ['OPEN', 'PAUSED']

export default function StockCheck() {
  const run = useAction()
  const [booting, setBooting] = useState(true)
  const [sheet, setSheet] = useState<any>(null)   // { session, rows, extras }
  const [history, setHistory] = useState(false)

  const loadSheet = async (id: number) => {
    const res = await run(() => window.api.stockCount.sheet({ session_id: id }))
    if (res) setSheet(res)
  }

  // Carry on with a count left open or paused; otherwise offer to start one.
  useEffect(() => {
    window.api.stockCount.list({ pageSize: 20 })
      .then((r: any) => {
        const live = (r.rows || []).find((s: any) => LIVE.includes(s.status))
        return live ? loadSheet(live.id) : undefined
      })
      .catch(() => {})
      .finally(() => setBooting(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (booting) return <Loading rows={6} />

  return (
    <div>
      {sheet
        ? <Count sheet={sheet} setSheet={setSheet} reload={() => loadSheet(sheet.session.id)}
            onNew={() => setSheet(null)} onHistory={() => setHistory(true)} />
        : <Start onStarted={(id) => loadSheet(id)} onHistory={() => setHistory(true)} />}
      {history && <History onClose={() => setHistory(false)} onPick={(id) => { setHistory(false); loadSheet(id) }} />}
    </div>
  )
}

function Start({ onStarted, onHistory }: { onStarted: (id: number) => void; onHistory: () => void }) {
  const run = useAction()
  const [locations, setLocations] = useState<string[]>([])
  const [location, setLocation] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    window.api.tagStock.facets(['location']).then((f: any) => setLocations(f?.location || [])).catch(() => {})
  }, [])
  const start = async () => {
    setBusy(true)
    const res = await run(() => window.api.stockCount.create({
      scope: location ? { location } : {}, business_date: todayISO(),
    }), 'Count started')
    setBusy(false)
    if (res) onStarted(res.id)
  }
  return (
    <div className="card">
      <div className="card-head"><span className="card-title">Start a stock count</span>
        <span className="spacer" /><button className="btn btn-sm" onClick={onHistory}><Icon.list /> Past Counts</button></div>
      <div className="card-body">
        <p className="small muted" style={{ marginTop: 0 }}>
          The pieces in stock right now are listed as expected. Scan each one you find; whatever is left
          unscanned is missing. The count is saved as you go — you can pause and finish it later.
        </p>
        <div className="row" style={{ gap: 12, alignItems: 'flex-end' }}>
          <Field label="Count which pieces">
            <Select value={location} onChange={setLocation} style={{ minWidth: 220 }}
              options={[{ value: '', label: 'Everything in stock' }, ...locations.map((l) => ({ value: l, label: `Only ${l}` }))]} />
          </Field>
          <button className="btn btn-primary" style={{ height: 38 }} disabled={busy} onClick={start}>
            <Icon.check /> Start Count
          </button>
        </div>
      </div>
    </div>
  )
}

function Count({ sheet, setSheet, reload, onNew, onHistory }: {
  sheet: any; setSheet: (fn: (s: any) => any) => void; reload: () => void; onNew: () => void; onHistory: () => void
}) {
  const run = useAction()
  const s = sheet.session
  const live = LIVE.includes(s.status)
  const [entry, setEntry] = useState('')
  const [filter, setFilter] = useState('all')
  // Count one item at a time (all the CP, then all the Kanchan) with its own
  // totals, instead of one lump weight for the whole shop.
  const [itemFilter, setItemFilter] = useState('ALL')
  const [confirm, setConfirm] = useState<null | 'cancel'>(null)
  const [lastHit, setLastHit] = useState<{ tag: string; cls: string; n: number } | null>(null)
  const [pending, setPending] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  // A scanner types a tag and Enter faster than the last scan returns. Scans go
  // through one at a time, in order, so none is lost and none is sent twice.
  const queue = useRef<Promise<void>>(Promise.resolve())
  const hits = useRef(0)

  const allRows: any[] = sheet.rows
  const extras: any[] = sheet.extras

  const submit = (raw: string) => {
    const tag = raw.trim().toUpperCase()
    setEntry('')
    inputRef.current?.focus()
    if (!tag) return
    setPending((p) => p + 1)
    queue.current = queue.current.then(async () => {
      try {
        const res = await window.api.stockCount.scan({ session_id: s.id, raw: tag })
        setLastHit({ tag: res.tag || tag, cls: res.classification, n: ++hits.current })
        setSheet((cur: any) => {
          if (!cur || cur.session.id !== s.id) return cur
          if (RESULT[res.classification]?.ok) {
            return { ...cur, rows: cur.rows.map((r: any) => (r.id === res.resolved_tag_id ? { ...r, found: true } : r)) }
          }
          if (res.classification === 'DUPLICATE') return cur
          return { ...cur, extras: [{ id: res.id, raw_scan: res.raw_scan, classification: res.classification, item_name: res.item_name }, ...cur.extras] }
        })
      } catch (e: any) {
        await run(async () => { throw e })
      } finally {
        setPending((p) => p - 1)
      }
    })
  }

  const setStatus = async (status: string, ok: string) => {
    await queue.current
    const res = await run(() => window.api.stockCount.setStatus({ id: s.id, status }), ok)
    if (res) setSheet((cur: any) => ({ ...cur, session: { ...cur.session, ...res } }))
    if (status === 'OPEN') setTimeout(() => inputRef.current?.focus(), 0)
  }

  const itemOptions = useMemo(() => {
    const m = new Map<string, string>()
    for (const r of allRows) m.set(String(r.item_id), r.item_name)
    return [...m].sort((a, b) => a[1].localeCompare(b[1]))
  }, [allRows])
  const rows = itemFilter === 'ALL' ? allRows : allRows.filter((r) => String(r.item_id) === itemFilter)
  const found = rows.filter((r) => r.found)
  const missing = rows.filter((r) => !r.found)
  const visible = filter === 'found' ? found : filter === 'missing' ? missing : rows
  const sum = (list: any[], key: string) => list.reduce((t, r) => t + num(r[key]), 0)

  /** Pieces and weight per item: expected, found, missing. */
  const byItem = useMemo(() => {
    const m = new Map<string, any>()
    for (const r of rows) {
      const k = String(r.item_id)
      const g = m.get(k) || { name: r.item_name, pcs: 0, net: 0, foundPcs: 0, foundNet: 0 }
      g.pcs += 1; g.net += num(r.net_wt)
      if (r.found) { g.foundPcs += 1; g.foundNet += num(r.net_wt) }
      m.set(k, g)
    }
    return [...m.values()].sort((a, b) => a.name.localeCompare(b.name))
  }, [rows])

  const exportCsv = async () => {
    const csv = toCsv(
      ['Tag', 'Item', 'Group', 'Gross Wt', 'Net Wt', 'Fine Wt', 'Location', 'Result'],
      rows.map((r) => [
        r.tag, r.item_name, r.group_name, r.gross_wt, r.net_wt, r.final_wt, r.location,
        r.found ? 'FOUND' : r.moved ? `MISSING (now ${r.live_status} ${r.live_location})` : 'MISSING',
      ]).concat(extras.map((t) => [t.raw_scan, t.item_name || '', '', '', '', '', '', EXTRA_LABEL[t.classification] || t.classification]))
    )
    await window.api.file.saveText({ content: csv, suggestedName: `stock-count-${s.id}.csv` })
  }

  const hit = lastHit && RESULT[lastHit.cls]

  return (
    <>
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-body">
          <div className="row" style={{ gap: 12, alignItems: 'flex-end' }}>
            <div className="grow">
              <label className="label">Scan or type a tag, then press Enter</label>
              <input
                ref={inputRef}
                autoFocus
                className="input mono"
                style={{ height: 44, fontSize: 17 }}
                placeholder={s.status === 'OPEN' ? 'RIN00001' : s.status === 'PAUSED' ? 'Paused — press Resume to scan' : `Count ${s.status.toLowerCase()}`}
                value={entry}
                disabled={s.status !== 'OPEN'}
                onChange={(e) => setEntry(e.target.value)}
                // What is in the box, not the last render's state: a fast scanner can
                // press Enter in the same tick as its final character.
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); submit(e.currentTarget.value) } }}
              />
            </div>
            <button className="btn btn-primary" style={{ height: 44 }} onClick={() => submit(entry)} disabled={s.status !== 'OPEN'}>
              <Icon.check /> Mark Found
            </button>
            {s.status === 'OPEN' && <button className="btn" style={{ height: 44 }} onClick={() => setStatus('PAUSED', 'Count paused')}>Pause</button>}
            {s.status === 'PAUSED' && <button className="btn" style={{ height: 44 }} onClick={() => setStatus('OPEN', 'Count resumed')}>Resume</button>}
            {live && <button className="btn" style={{ height: 44 }} onClick={() => setStatus('SUBMITTED', 'Count submitted')}><Icon.send /> Submit</button>}
          </div>

          <div className="row" style={{ marginTop: 12, gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <span className="small">
              <b>Count #{s.id}</b> · {s.scope?.location ? `only ${s.scope.location}` : 'everything in stock'} · started {dmy(s.created_at?.slice(0, 10))}
            </span>
            <span className={`badge ${STATUS_BADGE[s.status] || 'badge-mute'}`}>{s.status}</span>
            {pending > 0 && <span className="small muted"><span className="spinner" /> saving {pending} scan{pending > 1 ? 's' : ''}…</span>}
            <span className="spacer" />
            {s.status === 'SUBMITTED' && <>
              <button className="btn btn-sm" onClick={() => setStatus('OPEN', 'Count reopened')}>Reopen</button>
              <button className="btn btn-sm btn-primary" onClick={() => setStatus('APPROVED', 'Count approved')}>Approve</button>
            </>}
            {s.status === 'APPROVED' && <button className="btn btn-sm btn-primary" onClick={() => setStatus('CLOSED', 'Count closed')}>Close Count</button>}
            {(live || s.status === 'SUBMITTED') && <button className="btn btn-sm" onClick={() => setConfirm('cancel')}>Discard Count</button>}
            {!live && <button className="btn btn-sm" onClick={onNew}><Icon.plus /> New Count</button>}
            <button className="btn btn-sm" onClick={reload} title="Reload from the saved count">Refresh</button>
            <button className="btn btn-sm" onClick={onHistory}><Icon.list /> Past Counts</button>
          </div>

          {lastHit && hit && (
            <div className="row" style={{ marginTop: 12 }}>
              <span className={`balance-flag ${hit.ok ? 'cr' : 'dr'}`} key={lastHit.n}>
                {hit.ok ? <Icon.check width={15} height={15} /> : <Icon.alert width={15} height={15} />} {lastHit.tag} {hit.text}
              </span>
            </div>
          )}
        </div>
      </div>

      <div className="row" style={{ gap: 8, marginBottom: 12, alignItems: 'center' }}>
        <span className="small muted">Item</span>
        <Select value={itemFilter} onChange={(v) => { setItemFilter(v); setFilter('all') }}
          options={[
            { value: 'ALL', label: `All items (${allRows.length} pcs)` },
            ...itemOptions.map(([id, name]) => ({ value: id, label: name })),
          ]} />
      </div>

      <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(4, minmax(0,1fr))' }}>
        <div className="stat">
          <div className="stat-label">Expected</div>
          <div className="stat-value num">{rows.length}</div>
          <div className="stat-meta">{wt(sum(rows, 'net_wt'))} g net · {wt(sum(rows, 'final_wt'))} g fine</div>
        </div>
        <div className="stat">
          <div className="stat-label">Found</div>
          <div className="stat-value num" style={{ color: 'var(--ok)' }}>{found.length}</div>
          <div className="stat-meta">{wt(sum(found, 'net_wt'))} g net · {wt(sum(found, 'final_wt'))} g fine</div>
        </div>
        <div className="stat">
          <div className="stat-label">Missing</div>
          <div className="stat-value num" style={{ color: missing.length ? 'var(--danger)' : undefined }}>{missing.length}</div>
          <div className="stat-meta">{wt(sum(missing, 'net_wt'))} g net · {wt(sum(missing, 'final_wt'))} g fine</div>
        </div>
        <div className="stat">
          <div className="stat-label">Not In This Count</div>
          <div className="stat-value num" style={{ color: extras.length ? 'var(--warn)' : undefined }}>{extras.length}</div>
          <div className="stat-meta">Scanned but not expected</div>
        </div>
      </div>

      {extras.length > 0 && (
        <div className="card" style={{ marginBottom: 14, borderColor: 'var(--warn)' }}>
          <div className="card-head"><span className="card-title">Scanned but not expected</span></div>
          <div className="card-body">
            <div className="row wrap" style={{ gap: 6 }}>
              {extras.map((t) => (
                <span key={t.id} className="badge badge-warn mono" title={t.item_name || ''}>
                  {t.raw_scan} · {EXTRA_LABEL[t.classification] || t.classification}
                </span>
              ))}
            </div>
            <p className="small muted" style={{ marginTop: 8 }}>
              These tags were scanned but are not on this count's list — they may already be sold, melted,
              belong to another location, or be a mis-scan.
            </p>
          </div>
        </div>
      )}

      {byItem.length > 0 && (
        <div className="card" style={{ marginBottom: 14 }}>
          <div className="card-head"><span className="card-title">Item-wise</span></div>
          <div className="card-body flush">
            <div className="table-wrap" style={{ maxHeight: 300 }}>
              <table className="data">
                <thead>
                  <tr><th>Item</th>
                    <th className="r">Expected Pcs</th><th className="r">Expected Net Wt</th>
                    <th className="r">Found Pcs</th><th className="r">Found Net Wt</th>
                    <th className="r">Missing Pcs</th><th className="r">Missing Net Wt</th></tr>
                </thead>
                <tbody>
                  {byItem.map((g) => (
                    <tr key={g.name}>
                      <td className="strong">{g.name}</td>
                      <td className="r num">{g.pcs}</td>
                      <td className="r num">{wt(g.net)}</td>
                      <td className="r num">{g.foundPcs}</td>
                      <td className="r num">{wt(g.foundNet)}</td>
                      <td className="r num">{g.pcs - g.foundPcs}</td>
                      <td className="r num">{wt(g.net - g.foundNet)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      <div className="card">
        <div className="card-head">
          <span className="card-title">Verification Sheet</span>
          <div className="row" style={{ marginLeft: 'auto', gap: 8 }}>
            <Select value={filter} onChange={setFilter}
              options={[
                { value: 'all', label: `All (${rows.length})` },
                { value: 'missing', label: `Missing (${missing.length})` },
                { value: 'found', label: `Found (${found.length})` },
              ]} />
            <button className="btn btn-sm" onClick={exportCsv}><Icon.download /> Export</button>
          </div>
        </div>
        <div className="card-body flush">
          {!rows.length ? (
            <Empty icon={Icon.stock} title="No stock to verify">
              Nothing was in stock for this count. Create tags under Tag & Barcode first.
            </Empty>
          ) : (
            <div className="table-wrap" style={{ maxHeight: 460 }}>
              <table className="data">
                <thead>
                  <tr><th>#</th><th>Tag</th><th>Item</th><th>Group</th>
                    <th className="r">Gross Wt</th><th className="r">Net Wt</th>
                    <th className="r">Fine Wt</th><th>Location</th><th>Result</th></tr>
                </thead>
                <tbody>
                  {visible.map((r, i) => (
                    <tr key={r.id} className={r.found ? 'row-ok' : 'row-bad'}>
                      <td className="muted">{i + 1}</td>
                      <td className="mono strong">{r.tag}</td>
                      <td>{r.item_name}</td>
                      <td>{r.group_name || '—'}</td>
                      <td className="r num">{wt(r.gross_wt)}</td>
                      <td className="r num">{wt(r.net_wt)}</td>
                      <td className="r num strong">{wt(r.final_wt)}</td>
                      <td>{r.location}</td>
                      <td>
                        {r.found ? <span className="badge badge-ok">Found</span>
                          : <span className="badge badge-danger">Missing</span>}
                        {!r.found && r.moved && (
                          <span className="badge badge-warn" style={{ marginLeft: 4 }}
                            title="Changed since the count started — check before treating it as lost">
                            now {r.live_status === 'IN_STOCK' ? r.live_location : r.live_status.toLowerCase()}
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={4}>Showing {visible.length} of {rows.length}</td>
                    <td className="r num">{wt(sum(visible, 'gross_wt'))}</td>
                    <td className="r num">{wt(sum(visible, 'net_wt'))}</td>
                    <td className="r num">{wt(sum(visible, 'final_wt'))}</td>
                    <td colSpan={2}></td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </div>
      </div>

      {confirm === 'cancel' && (
        <Confirm title="Discard this count?" confirmLabel="Discard"
          message="The count and its scans are kept for the record but marked cancelled. Nothing in stock changes."
          onConfirm={async () => { setConfirm(null); await setStatus('CANCELLED', 'Count discarded') }}
          onCancel={() => setConfirm(null)} />
      )}
    </>
  )
}

function History({ onClose, onPick }: { onClose: () => void; onPick: (id: number) => void }) {
  const [page, setPage] = useState(1)
  const [data, setData] = useState<any>(null)
  useEffect(() => {
    let alive = true
    window.api.stockCount.list({ page, pageSize: 20 }).then((d: any) => alive && setData(d)).catch(() => alive && setData({ rows: [] }))
    return () => { alive = false }
  }, [page])
  return (
    <Modal title="Stock counts" wide onClose={onClose}
      footer={<><span className="spacer" /><button className="btn" onClick={onClose}>Close</button></>}>
      {!data ? <Loading rows={4} /> : (
        <>
          <table className="data">
            <thead><tr><th>#</th><th>Started</th><th>Scope</th><th>Status</th><th className="r">Expected</th><th className="r">Found</th><th /></tr></thead>
            <tbody>
              {data.rows.map((r: any) => (
                <tr key={r.id}>
                  <td className="mono">{r.id}</td>
                  <td>{dmy(r.created_at?.slice(0, 10))}</td>
                  <td>{r.scope?.location || 'Everything'}</td>
                  <td><span className={`badge ${STATUS_BADGE[r.status] || 'badge-mute'}`}>{r.status}</span></td>
                  <td className="r num">{r.expected_pcs}</td>
                  <td className="r num">{r.found_pcs}</td>
                  <td className="r"><button className="btn btn-sm" onClick={() => onPick(r.id)}>Open</button></td>
                </tr>
              ))}
              {!data.rows.length && <tr><td colSpan={7} className="muted">No counts yet.</td></tr>}
            </tbody>
          </table>
          <Pagination data={data} onPage={setPage} />
        </>
      )}
    </Modal>
  )
}
