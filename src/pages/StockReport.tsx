import React, { useState } from 'react'
import { Icon } from '../lib/icons'
import { Empty, Loading, Segmented, Select, useAction, useAsync, useDebounced } from '../lib/ui'
import { money, wt } from '../lib/format'
import { num, fineWeight, netWeight } from '../lib/calc'
import { GridSettingsButton, ReportActions, useGridCols, type GridCol } from '../lib/grid'

/* Columns a stock-take is allowed to correct. Net and fine weight are absent on
   purpose: they are derived from these, and the engine recomputes them on save
   rather than trusting whatever the grid sends. */
const EDITABLE = ['gross_wt', 'stone_wt', 'purity', 'purchase_rate', 'location', 'huid']

/* The grid's columns, in their shipped order. The user can rename, resize,
   reorder and hide any of them through Grid Settings — except the tag, which is
   the only thing identifying which piece a row is about. */
const COLS: GridCol[] = [
  { key: 'tag', label: 'Tag', fixed: true },
  { key: 'item_name', label: 'Item' },
  { key: 'group_name', label: 'Group' },
  { key: 'gross_wt', label: 'Gross Wt' },
  { key: 'stone_wt', label: 'Stone' },
  { key: 'net_wt', label: 'Net Wt' },
  { key: 'purity', label: 'Purity' },
  { key: 'stone_amount', label: 'StoneAmt' },
  { key: 'diamond_amount', label: 'DiamondAmt' },
  { key: 'purchase_rate', label: 'Cost/Gm' },
  { key: 'cost_value', label: 'Value' },
  { key: 'location', label: 'Location' },
  { key: 'huid', label: 'HUID' },
  { key: 'status', label: 'Status' },
]
const RIGHT = new Set([
  'gross_wt', 'stone_wt', 'net_wt', 'purity',
  'stone_amount', 'diamond_amount', 'purchase_rate', 'cost_value',
])

/** One read-only cell of the detail grid. */
function detailCell(key: string, r: any) {
  switch (key) {
    case 'tag': return <span className="mono strong">{r.tag}</span>
    case 'group_name': return r.group_name || '—'
    case 'gross_wt': return wt(r.gross_wt)
    case 'stone_wt': return wt(r.stone_wt)
    case 'net_wt': return wt(r.net_wt)
    case 'purity': return `${money(r.purity)}%`
    case 'stone_amount': return num(r.stone_amount) > 0 ? money(r.stone_amount) : '—'
    case 'diamond_amount': return num(r.diamond_amount) > 0 ? money(r.diamond_amount) : '—'
    case 'purchase_rate': return num(r.purchase_rate) > 0 ? money(r.purchase_rate) : '—'
    case 'cost_value': return num(r.purchase_rate) > 0 ? money(r.cost_value) : '—'
    case 'huid': return <span className="mono small">{r.huid || '—'}</span>
    case 'status': return (
      <span className={`badge ${r.status === 'IN_STOCK' ? 'badge-ok' : 'badge-mute'}`}>
        {r.status === 'IN_STOCK' ? 'In stock' : 'Sold'}
      </span>
    )
    default: return r[key] ?? ''
  }
}

export default function StockReport() {
  const run = useAction()
  const grid = useGridCols('stock.detail', COLS)
  const cols = grid.cols
  const [groupBy, setGroupBy] = useState('none')
  const [status, setStatus] = useState('IN_STOCK')
  const [search, setSearch] = useState('')
  const [editing, setEditing] = useState(false)
  // Only the cells actually touched, keyed by tag id — so a save writes what the
  // user changed and nothing else.
  const [edits, setEdits] = useState<Record<number, any>>({})
  const q = useDebounced(search, 250)

  const rep = useAsync(
    () => window.api.reports.stock({ status, groupBy, search: q }),
    [status, groupBy, q]
  )
  const reorder = useAsync(() => window.api.reports.reorder(), [])
  const lowStock: any[] = reorder.data || []

  const rows = rep.data?.rows || []
  const groups = rep.data?.groups || []

  // What the grid shows while editing: the stored row with any pending change
  // laid over it, and net/fine recomputed live so the totals stay honest.
  const shown = (r: any) => {
    const e = edits[r.id]
    if (!e) return r
    const merged = { ...r, ...e }
    const net = netWeight(merged)
    return { ...merged, net_wt: net, final_wt: fineWeight(net, merged.purity),
             cost_value: fineWeight(net, merged.purity) * num(merged.purchase_rate) }
  }
  const view = editing ? rows.map(shown) : rows
  const dirty = Object.keys(edits).length

  const setCell = (id: number, k: string, v: string) =>
    setEdits((m) => ({ ...m, [id]: { ...m[id], [k]: v } }))

  const saveEdits = async () => {
    const payload = Object.entries(edits).map(([id, e]) => ({ id: Number(id), ...e }))
    const ok = await run(() => window.api.tagStock.updateRows({ rows: payload }),
      `${payload.length} ${payload.length === 1 ? 'piece' : 'pieces'} updated`)
    if (ok !== undefined) { setEdits({}); setEditing(false); rep.reload() }
  }

  const tot = {
    gross: view.reduce((s: number, r: any) => s + num(r.gross_wt), 0),
    net: view.reduce((s: number, r: any) => s + num(r.net_wt), 0),
    fine: view.reduce((s: number, r: any) => s + num(r.final_wt), 0),
    stone: view.reduce((s: number, r: any) => s + num(r.stone_amount), 0),
    diamond: view.reduce((s: number, r: any) => s + num(r.diamond_amount), 0),
  }
  // Valuation at cost. Pieces with no cost recorded contribute nothing, so the
  // figure is flagged as partial rather than presented as the whole stock value.
  const value = editing
    ? view.reduce((s: number, r: any) => s + num(r.cost_value), 0)
    : num(rep.data?.totals?.cost_value)
  const uncosted = num(rep.data?.totals?.uncosted)
  // Loose lots (mani, fuli) are real stock with no tag to list, so they are
  // reported on their own strip below rather than folded into the piece table —
  // a bead has no fine weight, and mixing it in would corrupt both the piece
  // count and the fine total this screen is reconciled against.
  const loose = rep.data?.loose || []
  const looseValue = num(rep.data?.looseTotals?.cost_value)
  const looseWt = num(rep.data?.looseTotals?.balance_wt)

  /** What Export writes, in whichever format is chosen — see src/lib/export.ts. */
  const exportData = () =>
    groupBy === 'none'
      ? {
          baseName: 'stock-report', title: 'Stock Report',
          meta: `${status === 'ALL' ? 'All' : status === 'SOLD' ? 'Sold' : 'In stock'} · ${rows.length} pieces`,
          headers: ['Tag', 'Item', 'Group', 'Gross Wt', 'Stone Wt', 'Net Wt', 'Purity', 'StoneAmt', 'DiamondAmt', 'Cost/Gm', 'Cost Value', 'Location', 'HUID', 'Status'],
          rows: rows.map((r: any) => [r.tag, r.item_name, r.group_name, r.gross_wt, r.stone_wt, r.net_wt, r.purity, r.stone_amount, r.diamond_amount, r.purchase_rate, r.cost_value, r.location, r.huid, r.status]),
        }
      : {
          baseName: 'stock-summary', title: 'Stock Summary',
          meta: `Grouped by ${groupBy} · ${groups.length} lines`,
          headers: ['Group', 'Pieces', 'Gross Wt', 'Net Wt', 'Purity', 'StoneAmt', 'DiamondAmt', 'Cost Value', 'Uncosted Pieces'],
          rows: groups.map((g: any) => [g.key, g.count, g.gross_wt, g.net_wt, g.purity, g.stone_amount, g.diamond_amount, g.cost_value, g.uncosted]),
        }

  return (
    <div>
      {lowStock.length > 0 && (
        <div className="card" style={{ marginBottom: 12, borderColor: 'var(--danger)' }}>
          <div className="card-head">
            <span className="card-title" style={{ color: 'var(--danger)' }}>
              <Icon.alert /> Reorder alert — {lowStock.length} {lowStock.length === 1 ? 'item is' : 'items are'} below level
            </span>
          </div>
          <div className="card-body flush">
            <table className="data">
              <thead><tr><th>Item</th><th>Group</th><th className="r">In Stock</th><th className="r">Reorder Level</th><th className="r">Short By</th></tr></thead>
              <tbody>
                {lowStock.map((r) => (
                  <tr key={r.id}>
                    <td>{r.name}</td>
                    <td className="muted">{r.group_name || '—'}</td>
                    <td className="r num">{r.in_stock}</td>
                    <td className="r num">{r.reorder_level}</td>
                    <td className="r num strong" style={{ color: 'var(--danger)' }}>{r.short}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      <div className="toolbar">
        <Segmented value={status} onChange={setStatus}
          options={[
            { value: 'IN_STOCK', label: 'In Stock' },
            { value: 'SOLD', label: 'Sold' },
            { value: 'ALL', label: 'All' },
          ]} />
        <Select value={groupBy} onChange={setGroupBy} disabled={editing}
          options={[
            { value: 'none', label: 'Tag-wise (detail)' },
            { value: 'item', label: 'Item Name Total' },
            { value: 'group', label: 'Summary by Item Group' },
            { value: 'location', label: 'Summary by Location' },
            { value: 'category', label: 'Summary by Category' },
            { value: 'salesman', label: 'Summary by Salesman' },
            { value: 'shelf', label: 'Summary by Shelf / Tray' },
          ]} />
        <div className="search-box">
          <Icon.search />
          <input className="input" placeholder="Tag or item…" value={search}
            onChange={(e) => setSearch(e.target.value)} />
        </div>
        <span className="spacer" />
        {/* Correcting stock only makes sense piece by piece, and only for pieces
            still on the shelf — a sold one is already priced on a bill. */}
        {groupBy === 'none' && status === 'IN_STOCK' && (
          editing ? (
            <>
              <button className="btn btn-sm" onClick={() => { setEdits({}); setEditing(false) }}>
                Cancel
              </button>
              <button className="btn btn-primary btn-sm" disabled={!dirty} onClick={saveEdits}>
                <Icon.save /> Save {dirty ? `(${dirty})` : ''}
              </button>
            </>
          ) : (
            <button className="btn btn-sm" onClick={() => setEditing(true)}>
              <Icon.edit /> Edit Stock
            </button>
          )
        )}
        {groupBy === 'none' && !editing && <GridSettingsButton onClick={grid.open} />}
        <ReportActions build={exportData} />
      </div>
      {grid.settings}

      {editing && (
        <div className="note" style={{ marginBottom: 12 }}>
          Correcting stock after a count. Change gross, stone, purity, cost or location and
          press <b>Save</b> — net weight is recalculated for you, and the metal on
          hand moves with the correction. Sold pieces cannot be changed here; correct the
          bill they are on instead.
        </div>
      )}

      <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(4, minmax(0,1fr))' }}>
        <div className="stat"><div className="stat-label">Pieces</div><div className="stat-value num">{rows.length}</div></div>
        <div className="stat"><div className="stat-label">Gross Weight</div><div className="stat-value num">{wt(tot.gross)}<span style={{ fontSize: 13, color: 'var(--text-3)' }}> g</span></div></div>
        <div className="stat"><div className="stat-label">Net Weight</div><div className="stat-value num">{wt(tot.net)}<span style={{ fontSize: 13, color: 'var(--text-3)' }}> g</span></div></div>
        <div className="stat">
          <div className="stat-label">Value at Cost</div>
          <div className="stat-value num">{money(value)}</div>
          {uncosted > 0 && (
            <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 2 }}>
              {uncosted} of {rows.length} piece{uncosted === 1 ? '' : 's'} have no cost — excluded
            </div>
          )}
          {looseValue > 0 && (
            <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 2 }}>
              + {money(looseValue)} in loose lots = {money(value + looseValue)} held
            </div>
          )}
        </div>
      </div>

      <div className="card">
        <div className="card-body flush">
          {rep.loading ? <Loading /> : !rows.length ? (
            <Empty icon={Icon.stock} title="No stock matches this filter">
              Create tags under Tag &amp; Barcode to build up stock.
            </Empty>
          ) : groupBy !== 'none' ? (
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr><th>{({ item: 'Item', group: 'Item Group', location: 'Location', category: 'Category', salesman: 'Salesman', shelf: 'Shelf / Tray' } as any)[groupBy] || 'Group'}</th>
                    <th className="r">Pieces</th><th className="r">Gross Wt</th>
                    <th className="r">Net Wt</th>
                    <th className="r" title="Weighted by net weight, not an average of the percentages">
                      Purity</th>
                    <th className="r">StoneAmt</th><th className="r">DiamondAmt</th>
                    <th className="r">Value at Cost</th></tr>
                </thead>
                <tbody>
                  {groups.map((g: any) => (
                    <tr key={g.key}>
                      <td className="strong">{g.key}</td>
                      <td className="r num">{g.count}</td>
                      <td className="r num">{wt(g.gross_wt)}</td>
                      <td className="r num">{wt(g.net_wt)}</td>
                      <td className="r num">{money(g.purity)}%</td>
                      <td className="r num">{num(g.stone_amount) > 0 ? money(g.stone_amount) : '—'}</td>
                      <td className="r num">{num(g.diamond_amount) > 0 ? money(g.diamond_amount) : '—'}</td>
                      <td className="r num" title={g.uncosted ? `${g.uncosted} piece(s) have no cost recorded` : undefined}>
                        {money(g.cost_value)}{g.uncosted ? ' *' : ''}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td>Total</td>
                    <td className="r num">{rows.length}</td>
                    <td className="r num">{wt(tot.gross)}</td>
                    <td className="r num">{wt(tot.net)}</td>
                    <td className="r num">{tot.net > 0 ? `${money((tot.fine / tot.net) * 100)}%` : ''}</td>
                    <td className="r num">{tot.stone > 0 ? money(tot.stone) : ''}</td>
                    <td className="r num">{tot.diamond > 0 ? money(tot.diamond) : ''}</td>
                    <td className="r num">{money(value)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          ) : (
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th>#</th>
                    {cols.map((c) => (
                      <th key={c.key} className={RIGHT.has(c.key) ? 'r' : ''}
                        style={c.width ? { width: c.width } : undefined}>{c.label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {view.map((r: any, i: number) => (
                    <tr key={r.id}
                      className={r.status === 'SOLD' ? 'row-bad' : edits[r.id] ? 'row-ok' : ''}>
                      <td className="muted">{i + 1}</td>
                      {cols.map((c) => (
                        <td key={c.key} className={RIGHT.has(c.key) ? 'r num' : ''}>
                          {editing && EDITABLE.includes(c.key)
                            ? <input className="cell" value={r[c.key] ?? ''}
                                onChange={(e) => setCell(r.id, c.key, e.target.value)} />
                            : detailCell(c.key, r)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td>Total</td>
                    {cols.map((c) => (
                      <td key={c.key} className={RIGHT.has(c.key) ? 'r num' : ''}>
                        {c.key === 'tag' ? `${rows.length} pieces`
                          : c.key === 'gross_wt' ? wt(tot.gross)
                          : c.key === 'net_wt' ? wt(tot.net)
                          : c.key === 'stone_amount' ? (tot.stone > 0 ? money(tot.stone) : '')
                          : c.key === 'diamond_amount' ? (tot.diamond > 0 ? money(tot.diamond) : '')
                          : c.key === 'cost_value' ? money(value)
                          : ''}
                      </td>
                    ))}
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </div>
      </div>

      {loose.length > 0 && (
        <div className="card" style={{ marginTop: 12 }}>
          <div className="card-head">
            <span className="card-title">
              Loose lots — stocked by weight ({wt(looseWt)} g)
            </span>
          </div>
          <div className="card-body flush">
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th>Item</th><th>Group</th><th className="r">In</th><th className="r">Out</th>
                    <th className="r">On Hand</th><th className="r">Cost/Gm</th>
                    <th className="r">Cost Value</th>
                  </tr>
                </thead>
                <tbody>
                  {loose.map((r: any) => (
                    <tr key={r.id}>
                      <td>{r.name}</td>
                      <td className="muted">{r.group_name || '—'}</td>
                      <td className="r num">{wt(r.in_wt)}</td>
                      <td className="r num">{wt(r.out_wt)}</td>
                      <td className="r num strong">{wt(r.balance_wt)}</td>
                      <td className="r num">{num(r.cost_rate) > 0 ? money(r.cost_rate) : ''}</td>
                      <td className="r num">{num(r.cost_value) > 0 ? money(r.cost_value) : ''}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={4}>{loose.length} lot{loose.length === 1 ? '' : 's'}</td>
                    <td className="r num strong">{wt(looseWt)}</td>
                    <td />
                    <td className="r num strong">{money(looseValue)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
