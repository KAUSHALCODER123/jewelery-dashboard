import React, { useMemo, useRef, useState } from 'react'
import { Icon } from '../lib/icons'
import { Confirm, Empty, Loading, Select, useAction, useAsync } from '../lib/ui'
import { num } from '../lib/calc'
import { money, toCsv, wt } from '../lib/format'

/**
 * Physical stock verification. Scan every piece in the tray; anything left
 * unscanned at the end is physically missing from the shop.
 * Green = found, red = not found — the same signal the original software gave.
 */
export default function StockCheck() {
  const run = useAction()
  const stock = useAsync(() => window.api.tagStock.list({ status: 'IN_STOCK' }), [])
  const [scanned, setScanned] = useState<Set<string>>(new Set())
  const [extras, setExtras] = useState<string[]>([])
  const [entry, setEntry] = useState('')
  const [filter, setFilter] = useState('all')
  const [confirmReset, setConfirmReset] = useState(false)
  const [lastHit, setLastHit] = useState<{ tag: string; ok: boolean } | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const rows = stock.data || []
  const byTag = useMemo(
    () => new Map(rows.map((r: any) => [String(r.tag).toUpperCase(), r])),
    [rows]
  )

  const submit = (raw: string) => {
    const tag = raw.trim().toUpperCase()
    if (!tag) return
    setEntry('')
    if (byTag.has(tag)) {
      setScanned((s) => new Set(s).add(tag))
      setLastHit({ tag, ok: true })
    } else {
      // A tag that isn't in stock at all — wrong shop, already sold, or mis-scan.
      setExtras((e) => (e.includes(tag) ? e : [...e, tag]))
      setLastHit({ tag, ok: false })
    }
    inputRef.current?.focus()
  }

  const found = rows.filter((r: any) => scanned.has(String(r.tag).toUpperCase()))
  const missing = rows.filter((r: any) => !scanned.has(String(r.tag).toUpperCase()))

  const visible =
    filter === 'found' ? found : filter === 'missing' ? missing : rows

  const sum = (list: any[], key: string) => list.reduce((s, r) => s + num(r[key]), 0)

  const exportCsv = async () => {
    const csv = toCsv(
      ['Tag', 'Item', 'Group', 'Gross Wt', 'Net Wt', 'Fine Wt', 'Location', 'Result'],
      rows.map((r: any) => [
        r.tag, r.item_name, r.group_name, r.gross_wt, r.net_wt, r.final_wt, r.location,
        scanned.has(String(r.tag).toUpperCase()) ? 'FOUND' : 'MISSING',
      ]).concat(extras.map((t) => [t, '', '', '', '', '', '', 'NOT IN STOCK']))
    )
    await window.api.file.saveText({ content: csv, suggestedName: 'stock-verification.csv' })
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
                placeholder="RIN00001"
                value={entry}
                onChange={(e) => setEntry(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') submit(entry) }}
              />
            </div>
            <button className="btn btn-primary" style={{ height: 44 }} onClick={() => submit(entry)}>
              <Icon.check /> Mark Found
            </button>
            <button className="btn" style={{ height: 44 }} onClick={() => setConfirmReset(true)}>
              Reset
            </button>
          </div>

          {lastHit && (
            <div className="row" style={{ marginTop: 12 }}>
              <span className={`balance-flag ${lastHit.ok ? 'cr' : 'dr'}`} key={lastHit.tag + String(scanned.size + extras.length)}>
                {lastHit.ok
                  ? <><Icon.check width={15} height={15} /> {lastHit.tag} found</>
                  : <><Icon.alert width={15} height={15} /> {lastHit.tag} is not in stock</>}
              </span>
            </div>
          )}
        </div>
      </div>

      <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(4, minmax(0,1fr))' }}>
        <div className="stat">
          <div className="stat-label">Expected</div>
          <div className="stat-value num">{rows.length}</div>
          <div className="stat-meta">{wt(sum(rows, 'final_wt'))} g fine</div>
        </div>
        <div className="stat">
          <div className="stat-label">Found</div>
          <div className="stat-value num" style={{ color: 'var(--ok)' }}>{found.length}</div>
          <div className="stat-meta">{wt(sum(found, 'final_wt'))} g fine</div>
        </div>
        <div className="stat">
          <div className="stat-label">Missing</div>
          <div className="stat-value num" style={{ color: missing.length ? 'var(--danger)' : undefined }}>
            {missing.length}
          </div>
          <div className="stat-meta">{wt(sum(missing, 'final_wt'))} g fine</div>
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
              {extras.map((t) => <span key={t} className="badge badge-warn mono">{t}</span>)}
            </div>
            <p className="small muted" style={{ marginTop: 8 }}>
              These tags were scanned but are not in the in-stock list — they may already be
              sold, melted, or belong to another branch.
            </p>
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
              Create tags under Tag &amp; Barcode first.
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
                    const ok = scanned.has(String(r.tag).toUpperCase())
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
    </div>
  )
}
