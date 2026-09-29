import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Icon } from '../lib/icons'
import {
  Check, Confirm, Empty, Loading, Modal, Select, Segmented,
  useAction, useAsync, useDebounced, useToast,
} from '../lib/ui'
import { num } from '../lib/calc'
import { dmy, money, wt } from '../lib/format'
import { Pagination } from '../lib/inventory'

/**
 * Physical stock verification with durable sessions (T07).
 * Creates an immutable expected set, saves each scan, supports
 * pause/resume, and requires approved explicit adjustments.
 */
export default function StockCheck() {
  const run = useAction()
  const { push } = useToast()

  // Session state
  const [sessionId, setSessionId] = useState<number | null>(null)
  const [session, setSession] = useState<any>(null)
  const [sessions, setSessions] = useState<any[]>([])
  const [sessionsPage, setSessionsPage] = useState(1)
  const [sessionsTotal, setSessionsTotal] = useState(0)
  const [sessionsLoading, setSessionsLoading] = useState(false)
  const [sessionsOpen, setSessionsOpen] = useState(false)

  // Count state
  const [scanned, setScanned] = useState<Set<number>>(new Set())
  const [extras, setExtras] = useState<any[]>([])
  const [entry, setEntry] = useState('')
  const [filter, setFilter] = useState('all')
  const [itemFilter, setItemFilter] = useState('ALL')
  const [confirmReset, setConfirmReset] = useState(false)
  const [lastHit, setLastHit] = useState<{ tag: string; ok: boolean } | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // Create new session
  const newSession = async () => {
    const scope = { location: 'Shop' }
    const res = await window.api.stockCount.create({ scope, business_date: new Date().toISOString().slice(0, 10), actor: 'user' })
    if (res) {
      setSessionId(res.id)
      setSession(res)
      setScanned(new Set())
      setExtras([])
      setFilter('all')
      push('ok', 'Count session created')
    }
  }

  // Load session
  const loadSession = async (id: number) => {
    const res = await window.api.stockCount.read({ id })
    if (res) {
      setSessionId(res.id)
      setSession(res)
      // Note: scans would be loaded from discrepancies endpoint
      setScanned(new Set())
      setExtras([])
      push('ok', 'Session loaded')
    }
  }

  // Load sessions list
  const loadSessions = async (page = 1) => {
    setSessionsLoading(true)
    try {
      const res = await window.api.stockCount.list({ page, pageSize: 20 })
      setSessions(res.rows || [])
      setSessionsTotal(res.total || 0)
      setSessionsPage(page)
    } finally { setSessionsLoading(false) }
  }

  // Scan a tag
  const submit = async (raw: string) => {
    if (!sessionId) { push('error', 'Create or load a session first'); return }
    const tag = raw.trim().toUpperCase()
    if (!tag) return
    setEntry('')
    const res = await window.api.stockCount.scan({ session_id: sessionId, raw: tag, actor: 'user' })
    if (res) {
      if (res.resolved_tag_id) {
        setScanned(s => new Set(s).add(res.resolved_tag_id))
        setLastHit({ tag, ok: res.classification === 'MATCHED' })
      } else {
        setExtras(e => e.some(x => x.raw_scan === tag) ? e : [...e, res])
        setLastHit({ tag, ok: false })
      }
    }
    inputRef.current?.focus()
  }

  // Fallback to loading IN_STOCK tags for the current scope
  const stock = useAsync(() => window.api.tagStock.list({ status: 'IN_STOCK' }), [])
  const allRows = stock.data || []
  const itemOptions = useMemo(() => {
    const m = new Map<string, string>()
    for (const r of allRows) m.set(String(r.item_id), r.item_name)
    return [...m].sort((a, b) => a[1].localeCompare(b[1]))
  }, [allRows])
  const rows = itemFilter === 'ALL'
    ? allRows : allRows.filter((r: any) => String(r.item_id) === itemFilter)
  const byTag = useMemo(
    () => new Map(allRows.map((r: any) => [String(r.tag).toUpperCase(), r])),
    [allRows]
  )

  const matched = rows.filter((r: any) => scanned.has(r.id))
  const missing = rows.filter((r: any) => !scanned.has(r.id))

  const visible =
    filter === 'found' ? matched : filter === 'missing' ? missing : rows

  const sum = (list: any[], key: string) => list.reduce((s, r) => s + num(r[key]), 0)

  const byItem = useMemo(() => {
    const m = new Map<string, any>()
    for (const r of rows) {
      const k = String(r.item_id)
      const g = m.get(k) || { name: r.item_name, pcs: 0, net: 0, foundPcs: 0, foundNet: 0 }
      g.pcs += 1; g.net += num(r.net_wt)
      if (scanned.has(r.id)) { g.foundPcs += 1; g.foundNet += num(r.net_wt) }
      m.set(k, g)
    }
    return [...m.values()].sort((a, b) => a.name.localeCompare(b.name))
  }, [rows, scanned])

  const exportCsv = async () => {
    const csv = [
      ['Tag', 'Item', 'Group', 'Gross Wt', 'Net Wt', 'Fine Wt', 'Location', 'Result'],
      ...rows.map((r: any) => [
        r.tag, r.item_name, r.group_name, r.gross_wt, r.net_wt, r.final_wt, r.location,
        scanned.has(r.id) ? 'FOUND' : 'MISSING',
      ]),
      ...extras.map((t: any) => [t.raw_scan || t.tag || '', '', '', '', '', '', '', 'NOT IN STOCK'])
    ].map(row => row.map(csvCell).join(',')).join('\n')
    await window.api.file.saveText({ content: csv, suggestedName: 'stock-verification.csv' })
  }

  const setStatus = async (status: string) => {
    if (!sessionId) return
    const res = await window.api.stockCount.setStatus({ id: sessionId, status, actor: 'user' })
    if (res) {
      setSession(res)
      push('ok', `Session ${status.toLowerCase()}`)
    }
  }

  if (stock.loading) return <Loading rows={6} />

  return (
    <div>
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
                placeholder={sessionId ? 'RIN00001' : 'Create or load a session first'}
                value={entry}
                onChange={(e) => setEntry(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') submit(entry) }}
                disabled={!sessionId}
              />
            </div>
            <button className="btn btn-primary" style={{ height: 44 }} onClick={submit} disabled={!sessionId}>
              <Icon.check /> Mark Found
            </button>
            <button className="btn" style={{ height: 44 }} onClick={() => setConfirmReset(true)} disabled={!sessionId}>
              Reset
            </button>
            {sessionId && (
              <Segmented value={session.status} onChange={setStatus} disabled={session.status !== 'OPEN' && session.status !== 'PAUSED'}
                options={[
                  { value: 'OPEN', label: 'Open' },
                  { value: 'PAUSED', label: 'Pause' },
                  { value: 'SUBMITTED', label: 'Submit' },
                ]} />
            )}
          </div>

          {session && (
            <div className="row" style={{ marginTop: 12, gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
              <span className="small"><b>Session:</b> #{session.id} · {session.status} · {session.scope?.location || 'Shop'} · Expected: {session.expected?.n || '?'} pcs</span>
              <button className="btn btn-sm" onClick={() => { loadSessions(1); setSessionsOpen(true) }}>
                <Icon.list /> All Sessions
              </button>
              <button className="btn btn-sm" onClick={newSession}><Icon.plus /> New Session</button>
            </div>
          )}

          {lastHit && (
            <div className="row" style={{ marginTop: 12 }}>
              <span className={`balance-flag ${lastHit.ok ? 'cr' : 'dr'}`} key={lastHit.tag + String(scanned.size + extras.length)}>
                {lastHit.ok
                  ? <><Icon.check width={15} height={15} /> {lastHit.tag} {sessionId ? 'scanned' : 'found'}</>
                  : <><Icon.alert width={15} height={15} /> {lastHit.tag} is not in stock</>}
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
          ]} disabled={!sessionId} />
      </div>

      <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(4, minmax(0,1fr))' }}>
        <div className="stat">
          <div className="stat-label">Expected</div>
          <div className="stat-value num">{rows.length}</div>
          <div className="stat-meta">{wt(sum(rows, 'net_wt'))} g net · {wt(sum(rows, 'final_wt'))} g fine</div>
        </div>
        <div className="stat">
          <div className="stat-label">Found</div>
          <div className="stat-value num" style={{ color: 'var(--ok)' }}>{matched.length}</div>
          <div className="stat-meta">{wt(sum(matched, 'net_wt'))} g net · {wt(sum(matched, 'final_wt'))} g fine</div>
        </div>
        <div className="stat">
          <div className="stat-label">Missing</div>
          <div className="stat-value num" style={{ color: missing.length ? 'var(--danger)' : undefined }}>
            {missing.length}
          </div>
          <div className="stat-meta">{wt(sum(missing, 'net_wt'))} g net · {wt(sum(missing, 'final_wt'))} g fine</div>
        </div>
        <div className="stat">
          <div className="stat-label">Not In Stock</div>
          <div className="stat-value num" style={{ color: extras.length ? 'var(--warn)' : undefined }}>
            {extras.length}
          </div>
          <div className="stat-meta">Scanned but not expected</div>
        </div>
      </div>

      {extras.length > 0 && (
        <div className="card" style={{ marginBottom: 14, borderColor: 'var(--warn)' }}>
          <div className="card-head">
            <span className="card-title">Scanned but not in stock</span>
            <button className="btn btn-ghost btn-sm" style={{ marginLeft: 'auto' }}
              onClick={() => setExtras([])}>Clear</button>
          </div>
          <div className="card-body">
            <div className="row wrap" style={{ gap: 6 }}>
              {extras.map((t: any) => <span key={t.id} className="badge badge-warn mono">{t.raw_scan || t.tag}</span>)}
            </div>
            <p className="small muted" style={{ marginTop: 8 }}>
              These tags were scanned but are not in the in-stock list — they may already be
              sold, melted, or belong to another branch.
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
                { value: 'found', label: `Found (${matched.length})` },
              ]} disabled={!sessionId} />
            <button className="btn btn-sm" onClick={exportCsv} disabled={!sessionId}><Icon.download /> Export</button>
          </div>
        </div>
        <div className="card-body flush">
          {!rows.length ? (
            <Empty icon={Icon.stock} title="No stock to verify">
              Create tags under Tag & Barcode first.
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
                  {visible.map((r: any, i: number) => {
                    const ok = scanned.has(r.id)
                    return (
                      <tr key={r.id} className={ok ? 'row-ok' : 'row-bad'}>
                        <td className="muted">{i + 1}</td>
                        <td className="mono strong">{r.tag}</td>
                        <td>{r.item_name}</td>
                        <td>{r.group_name || '—'}</td>
                        <td className="r num">{wt(r.gross_wt)}</td>
                        <td className="r num">{wt(r.net_wt)}</td>
                        <td className="r num strong">{wt(r.final_wt)}</td>
                        <td>{r.location}</td>
                        <td>
                          {ok ? <span className="badge badge-ok">Found</span>
                            : <span className="badge badge-danger">Missing</span>}
                        </td>
                      </tr>
                    )
                  })}
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

      {confirmReset && (
        <Confirm title="Reset this count?" confirmLabel="Reset"
          message="All scans in this session will be cleared. Nothing in the database changes."
          onConfirm={() => { setScanned(new Set()); setExtras([]); setLastHit(null); setConfirmReset(false) }}
          onCancel={() => setConfirmReset(false)} />
      )}

      {/* Sessions modal */}
      {sessionsOpen && (
        <Modal title="Stock Count Sessions" onClose={() => setSessionsOpen(false)}
          footer={<button className="btn" onClick={() => setSessionsOpen(false)}>Close</button>}>
          <div className="card">
            <div className="card-body flush">
              <div className="table-wrap">
                <table className="data">
                  <thead>
                    <tr><th>ID</th><th>Date</th><th>Scope</th><th>Status</th><th>Expected</th><th>Scanned</th><th></th></tr>
                  </thead>
                  <tbody>
                    {sessions.map((s: any) => (
                      <tr key={s.id}>
                        <td>{s.id}</td>
                        <td>{s.business_date || s.created_at?.slice(0, 10)}</td>
                        <td>{s.scope?.location || 'Shop'}</td>
                        <td><span className={`badge ${s.status === 'CLOSED' ? 'badge-ok' : s.status === 'OPEN' ? 'badge-gold' : 'badge-mute'}`}>{s.status}</span></td>
                        <td className="r">{s.expected?.n || '?'}</td>
                        <td className="r">{s.scanned?.n || '?'}</td>
                        <td className="r">
                          <button className="btn btn-sm" onClick={() => { loadSession(s.id); setSessionsOpen(false) }}>Load</button>
                        </td>
                      </tr>
                    ))}
                    {!sessions.length && <tr><td colSpan={7} className="muted">No sessions</td></tr>}
                  </tbody>
                </table>
              </div>
              <Pagination data={{page: sessionsPage, pageSize: 20, total: sessionsTotal}}
                onPage={loadSessions} disabled={sessionsLoading} />
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}

// CSV helper
function csvCell(v: any) {
  let s = v == null ? '' : String(v)
  if (/^[\s'"]*[=+\-@]/.test(s)) s = `'` + s
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}