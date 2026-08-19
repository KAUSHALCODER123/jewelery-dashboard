import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Icon } from '../lib/icons'
import {
  Check, Confirm, Empty, Field, Input, Loading, Modal, Segmented, Select,
  useAction, useAsync, useDebounced,
} from '../lib/ui'
import { fineWeight, netWeight, num, r3 } from '../lib/calc'
import { money, toCsv, wt } from '../lib/format'
import { LABEL_SIZES, labelSheetHtml, type LabelSize } from '../print/barcode'
import { GridSettingsButton, useGridCols, type GridCol } from '../lib/grid'

type Row = {
  id?: number
  tag?: string
  gross_wt: any; black_beads: any; bag_wt: any; stone_wt: any; stone_rate: any
  diamond_wt: any; diamond_rate: any
  purity: any; mkg_per_gm: any; hallmark_charges: any; purchase_rate: any
  huid: string; gst_pct: any; qty: any; location: string
}

type Defaults = {
  purity: any; mkg_per_gm: any; hallmark_charges: any; purchase_rate: any
  location: string; gst_pct: any
  category: string; salesman: string; shelf_tray: string; size: string
}

const blankRow = (d: Defaults): Row => ({
  gross_wt: '', black_beads: '', bag_wt: '', stone_wt: '', stone_rate: '',
  diamond_wt: '', diamond_rate: '',
  purity: d.purity, mkg_per_gm: d.mkg_per_gm, hallmark_charges: d.hallmark_charges,
  purchase_rate: d.purchase_rate,
  huid: '', gst_pct: d.gst_pct, qty: '', location: d.location,
})

/** The order columns appear in the grid, and the order a grid copy pastes back in. */
const COLS: GridCol[] = [
  { key: 'gross_wt', label: 'Gross Wt', fixed: true },
  { key: 'black_beads', label: 'Black B.' },
  { key: 'bag_wt', label: 'Bag Wt' },
  { key: 'stone_wt', label: 'Stone Wt' },
  { key: 'stone_rate', label: 'Stone Rate' },
  { key: 'diamond_wt', label: 'Dia. Wt' },
  { key: 'diamond_rate', label: 'Dia. Rate' },
  { key: 'purity', label: 'Purity %' },
  { key: 'mkg_per_gm', label: 'Mkg/Gm' },
  { key: 'hallmark_charges', label: 'Hallmark' },
  { key: 'purchase_rate', label: 'Cost/Gm' },
  { key: 'qty', label: 'Qty' },
]

/**
 * Positional column order for a HEADERLESS paste. Kept deliberately in the
 * original order — stone/diamond are appended at the end rather than slotted
 * next to Stone Wt (where they sit in the grid) so a headerless CSV saved before
 * these columns existed still lands every value in the right field. A CSV *with*
 * a header is matched by name and is unaffected by column order either way.
 */
const CSV_COLS: (keyof Row)[] = [
  'gross_wt', 'black_beads', 'stone_wt', 'purity', 'mkg_per_gm', 'hallmark_charges',
  'purchase_rate', 'qty', 'huid', 'location', 'stone_rate', 'diamond_wt', 'diamond_rate',
  'bag_wt',
]

export default function TagStock() {
  const run = useAction()
  const grid = useGridCols('tagstock.entry', COLS)
  const cols = grid.cols
  const items = useAsync(() => window.api.item.list(), [])
  const [itemId, setItemId] = useState<string>('')
  const [rows, setRows] = useState<Row[]>([])
  const [saving, setSaving] = useState(false)
  const [addCount, setAddCount] = useState(10)
  const [importing, setImporting] = useState(false)
  // 'new'   — first-time stock entry; the pieces simply exist
  // 'loose' — made from bar or scrap already on hand, so that weight must come out
  const [mode, setMode] = useState<'new' | 'loose'>('new')
  const loose = useAsync(() => window.api.looseStock.summary({ metal: 'Gold' }), [])

  const [search, setSearch] = useState('')
  const q = useDebounced(search, 250)
  const [statusFilter, setStatusFilter] = useState('IN_STOCK')
  // Reprint protection: "Not printed" lists only pieces whose label has never
  // been run, so a batch can be finished without labelling anything twice.
  const [printedFilter, setPrintedFilter] = useState('ALL')
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [labelling, setLabelling] = useState<any[] | null>(null)
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false)
  // Bullion already in the safe on the day the shop switched over. Tagged pieces
  // have the grid; loose metal had no way in at all until this.
  const [openingMetal, setOpeningMetal] = useState(false)

  const existing = useAsync(
    () => window.api.tagStock.list({
      status: statusFilter, search: q,
      printed: printedFilter === 'ALL' ? undefined : printedFilter,
    }),
    [q, statusFilter, printedFilter]
  )

  const selectedItem = useMemo(
    () => (items.data || []).find((i: any) => String(i.id) === itemId),
    [items.data, itemId]
  )
  const groupPurity = num(selectedItem?.group_purity) || 91.6

  const [defaults, setDefaults] = useState<Defaults>({
    purity: 91.6, mkg_per_gm: '', hallmark_charges: '', purchase_rate: '',
    location: 'Shop', gst_pct: 3,
    category: '', salesman: '', shelf_tray: '', size: '',
  })

  // Where the making rate came from, so a surprising number is traceable to the
  // rule that set it rather than appearing from nowhere.
  const [makingFrom, setMakingFrom] = useState('')

  // Picking an item resets the sheet and pulls in that group's purity, plus any
  // default making charge from the Making Master. The rate is only seeded — it
  // sits in the field where it can be seen and changed before saving.
  useEffect(() => {
    if (!itemId) { setRows([]); setMakingFrom(''); return }
    let alive = true
    window.api.rateMaster.resolve({ itemId: Number(itemId) }).then((m: any) => {
      if (!alive) return
      const d = {
        ...defaults, purity: groupPurity,
        mkg_per_gm: num(m?.making_per_gram) > 0 ? m.making_per_gram : '',
      }
      setMakingFrom(num(m?.making_per_gram) > 0 ? m.making_from : '')
      setDefaults(d)
      setRows([blankRow(d)])
    })
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemId])

  const computed = rows.map((r) => {
    const net = netWeight(r)
    return { ...r, net_wt: net, final_wt: fineWeight(net, r.purity) }
  })
  const filled = computed.filter((r) => num(r.gross_wt) > 0 || num(r.qty) > 0)

  const totals = {
    gross: r3(filled.reduce((s, r) => s + num(r.gross_wt), 0)),
    net: r3(filled.reduce((s, r) => s + num(r.net_wt), 0)),
    fine: r3(filled.reduce((s, r) => s + num(r.final_wt), 0)),
  }

  /** How much more fine weight these pieces need than the loose pool holds. */
  const shortfall = mode === 'loose' && loose.data
    ? r3(totals.fine - num(loose.data.available_fine))
    : 0

  const setCell = (i: number, key: keyof Row, v: any) => {
    setRows((rs) => {
      const next = rs.map((r, ix) => (ix === i ? { ...r, [key]: v } : r))
      const last = next[next.length - 1]
      if (last && (num(last.gross_wt) > 0 || num(last.qty) > 0)) next.push(blankRow(defaults))
      return next
    })
  }

  /** Add N blank rows carrying the current defaults. */
  const addRows = (n: number) =>
    setRows((rs) => [...rs, ...Array.from({ length: Math.max(1, n) }, () => blankRow(defaults))])

  /** Copy one row N more times — for a batch of identical pieces. */
  const duplicateRow = (i: number, n: number) =>
    setRows((rs) => {
      const src = rs[i]
      const copies = Array.from({ length: Math.max(1, n) }, () => ({ ...src, id: undefined, tag: '' }))
      return [...rs.slice(0, i + 1), ...copies, ...rs.slice(i + 1)]
    })

  /** Push the defaults onto every row that already exists. */
  const applyDefaultsToAll = () =>
    setRows((rs) => rs.map((r) => ({
      ...r,
      purity: defaults.purity,
      mkg_per_gm: defaults.mkg_per_gm,
      hallmark_charges: defaults.hallmark_charges,
      purchase_rate: defaults.purchase_rate,
      location: defaults.location,
      gst_pct: defaults.gst_pct,
    })))

  /** Paste a block from Excel: one line per piece, columns in grid order. */
  const onPaste = (e: React.ClipboardEvent) => {
    const text = e.clipboardData.getData('text/plain')
    if (!text || !/[\t\n,]/.test(text)) return    // a single value — let it paste normally
    e.preventDefault()
    const parsed = parseRows(text, defaults)
    if (!parsed.length) return
    setRows((rs) => {
      const keep = rs.filter((r) => num(r.gross_wt) > 0 || num(r.qty) > 0)
      return [...keep, ...parsed, blankRow(defaults)]
    })
    run(async () => true, `${parsed.length} rows pasted`)
  }

  const payload = () => ({
    itemId: Number(itemId),
    rows: filled.map((r) => ({
      // Category / salesman / shelf / size are set once for the whole batch and
      // carried onto every piece; a row that already has its own keeps it.
      category: defaults.category, salesman: defaults.salesman,
      shelf_tray: defaults.shelf_tray, size: defaults.size,
      ...r,
      gross_wt: num(r.gross_wt), black_beads: num(r.black_beads), stone_wt: num(r.stone_wt),
      stone_rate: num(r.stone_rate), diamond_wt: num(r.diamond_wt), diamond_rate: num(r.diamond_rate),
      purity: num(r.purity), mkg_per_gm: num(r.mkg_per_gm),
      hallmark_charges: num(r.hallmark_charges), gst_pct: num(r.gst_pct), qty: num(r.qty),
    })),
  })

  const save = async () => {
    if (!itemId) return run(async () => { throw new Error('Select an item first') })
    if (!filled.length) return run(async () => { throw new Error('Enter at least one row') })
    setSaving(true)
    const ok = mode === 'loose'
      ? await run(
          () => window.api.looseStock.convert(payload()),
          `${filled.length} tag${filled.length === 1 ? '' : 's'} made from loose stock`
        )
      : await run(
          () => window.api.tagStock.saveBatch(payload()),
          `${filled.length} tag${filled.length === 1 ? '' : 's'} created`
        )
    setSaving(false)
    if (ok !== undefined) {
      setRows([blankRow(defaults)]); existing.reload(); items.reload(); loose.reload()
    }
  }

  /* ── selection in the stock list ── */
  const rowsOut = existing.data || []
  const allSelected = rowsOut.length > 0 && selected.size === rowsOut.length
  const toggleAll = () =>
    setSelected(allSelected ? new Set() : new Set(rowsOut.map((r: any) => r.id)))
  const toggleOne = (id: number) =>
    setSelected((s) => {
      const n = new Set(s)
      n.has(id) ? n.delete(id) : n.add(id)
      return n
    })
  const selectedRows = rowsOut.filter((r: any) => selected.has(r.id))

  const exportCsv = async () => {
    const rs = selectedRows.length ? selectedRows : rowsOut
    const csv = toCsv(
      ['Tag', 'Item', 'Group', 'Gross Wt', 'Net Wt', 'Purity', 'Fine Wt', 'Qty',
        'Cost/Gm', 'Cost Value', 'Location', 'HUID', 'Status'],
      rs.map((r: any) => [r.tag, r.item_name, r.group_name, r.gross_wt, r.net_wt, r.purity,
        r.final_wt, r.qty, r.purchase_rate,
        (num(r.final_wt) * num(r.purchase_rate)).toFixed(2),
        r.location, r.huid, r.status])
    )
    await window.api.file.saveText({ content: csv, suggestedName: 'tag-stock.csv' })
  }

  const bulkDelete = async () => {
    setConfirmBulkDelete(false)
    let done = 0, failed = 0
    for (const r of selectedRows) {
      try { await window.api.tagStock.remove({ id: r.id }); done++ } catch { failed++ }
    }
    setSelected(new Set())
    existing.reload()
    run(async () => true,
      failed ? `${done} deleted, ${failed} could not be (already sold)` : `${done} tags deleted`)
  }

  return (
    <div>
      {grid.settings}
      {openingMetal && (
        <OpeningMetalModal onClose={() => setOpeningMetal(false)}
          onSaved={() => { setOpeningMetal(false); loose.reload() }} />
      )}
      {/* ══ Entry sheet ══ */}
      <div className="card" style={{ marginBottom: 18 }}>
        <div className="card-head">
          <span className="card-title">{mode === 'loose' ? 'Loose Metal → Tags' : 'Create Tags'}</span>
          <span className="hint" style={{ marginLeft: 'auto' }}>
            Net = Gross − Stone − Black beads · Fine = Net × Purity%
          </span>
        </div>
        <div className="card-body">
          <div className="row wrap" style={{ alignItems: 'flex-end', marginBottom: 14, gap: 10 }}>
            <Field label="Where is this metal from?"
              hint={mode === 'new'
                ? 'Pieces that are simply in the shop — first-time stock entry'
                : 'Made from bar or scrap already on hand'}>
              <Segmented value={mode} onChange={(v) => setMode(v as 'new' | 'loose')}
                options={[
                  { value: 'new', label: 'New stock' },
                  { value: 'loose', label: 'From loose metal' },
                ]} />
            </Field>
            <Field label="Select Item" required className="grow">
              <Select value={itemId} placeholder="Choose an item to tag…"
                onChange={setItemId}
                options={(items.data || []).map((i: any) => ({
                  value: String(i.id), label: `${i.name} · ${i.group_name ?? '—'}`,
                }))} />
            </Field>
            {selectedItem && (
              <span className="badge badge-gold" style={{ marginBottom: 7 }}>
                Prefix {selectedItem.tag_prefix || '—'}
              </span>
            )}
          </div>

          {mode === 'loose' && loose.data && (
            <div className="row wrap" style={{
              gap: 20, padding: '11px 14px', marginBottom: 14,
              background: shortfall > 0 ? 'var(--danger-soft)' : 'var(--gold-soft)',
              border: `1px solid ${shortfall > 0 ? 'var(--danger)' : 'var(--gold-line)'}`,
              borderRadius: 'var(--radius)',
            }}>
              <Tot label="Loose metal on hand" v={`${wt(loose.data.loose_fine)} g`} />
              <button className="btn btn-sm" style={{ alignSelf: 'center' }}
                onClick={() => setOpeningMetal(true)}>
                Opening metal
              </button>
              {loose.data.urd_fine > 0 && <Tot label="Old gold (URD)" v={`${wt(loose.data.urd_fine)} g`} />}
              <Tot label="Available to use" v={`${wt(loose.data.available_fine)} g`} gold />
              <Tot label="These pieces need" v={`${wt(totals.fine)} g`} />
              <Tot label={shortfall > 0 ? 'Short by' : 'Left after'}
                v={`${wt(Math.abs(loose.data.available_fine - totals.fine))} g`} />
              {shortfall > 0 && (
                <span className="badge badge-danger" style={{ alignSelf: 'center' }}>
                  Not enough loose metal
                </span>
              )}
            </div>
          )}

          {!itemId ? (
            <Empty icon={Icon.tag} title="Pick an item to begin">
              Each row becomes one physical piece with its own tag number.
            </Empty>
          ) : (
            <>
              {/* ── defaults applied to every new row ── */}
              <div className="section-title">Same for every piece</div>
              <div className="row wrap" style={{ gap: 10, alignItems: 'flex-end', marginBottom: 14 }}>
                <Field label="Purity %">
                  <Input className="right" style={{ width: 92 }} value={defaults.purity}
                    onChange={(e) => setDefaults({ ...defaults, purity: e.target.value })} />
                </Field>
                <Field label="Making /gm" hint={makingFrom ? `From the master (${makingFrom})` : undefined}>
                  <Input className="right" style={{ width: 92 }} value={defaults.mkg_per_gm}
                    onChange={(e) => setDefaults({ ...defaults, mkg_per_gm: e.target.value })} />
                </Field>
                <Field label="Hallmark">
                  <Input className="right" style={{ width: 92 }} value={defaults.hallmark_charges}
                    onChange={(e) => setDefaults({ ...defaults, hallmark_charges: e.target.value })} />
                </Field>
                <Field label="Cost /gm" hint="What you paid, per fine gram. Never printed on a bill.">
                  <Input className="right" style={{ width: 92 }} value={defaults.purchase_rate}
                    onChange={(e) => setDefaults({ ...defaults, purchase_rate: e.target.value })} />
                </Field>
                <Field label="Location">
                  <Input style={{ width: 100 }} value={defaults.location}
                    onChange={(e) => setDefaults({ ...defaults, location: e.target.value })} />
                </Field>
                <Field label="Category" hint="e.g. Ladies / Gents">
                  <Input style={{ width: 100 }} value={defaults.category}
                    onChange={(e) => setDefaults({ ...defaults, category: e.target.value })} />
                </Field>
                <Field label="Salesman">
                  <Input style={{ width: 100 }} value={defaults.salesman}
                    onChange={(e) => setDefaults({ ...defaults, salesman: e.target.value })} />
                </Field>
                <Field label="Shelf / Tray">
                  <Input style={{ width: 90 }} value={defaults.shelf_tray}
                    onChange={(e) => setDefaults({ ...defaults, shelf_tray: e.target.value })} />
                </Field>
                <Field label="Size">
                  <Input style={{ width: 70 }} value={defaults.size}
                    onChange={(e) => setDefaults({ ...defaults, size: e.target.value })} />
                </Field>
                <button className="btn btn-sm" onClick={applyDefaultsToAll} style={{ marginBottom: 1 }}>
                  Apply to all rows
                </button>
                <span className="spacer" style={{ marginLeft: 'auto' }} />
                <div className="row" style={{ gap: 6, marginBottom: 1 }}>
                  <input className="input right" style={{ width: 62 }} value={addCount}
                    onChange={(e) => setAddCount(Math.max(1, Number(e.target.value) || 1))} />
                  <button className="btn btn-sm" onClick={() => addRows(addCount)}>
                    <Icon.plus /> Add rows
                  </button>
                  <GridSettingsButton onClick={grid.open} />
                  <button className="btn btn-sm" onClick={() => setImporting(true)}>
                    <Icon.download /> Import CSV
                  </button>
                </div>
              </div>

              <div className="hint" style={{ marginBottom: 6 }}>
                Tip: copy a block of cells from Excel and paste anywhere in the grid — one
                line per piece, columns in the order shown below.
              </div>

              <div className="table-wrap" style={{ border: '1px solid var(--line)', maxHeight: 360 }}
                onPaste={onPaste}>
                <table className="grid-edit">
                  <thead>
                    <tr>
                      <th style={{ width: 30 }}></th>
                      <th style={{ width: 42 }}>#</th>
                      {cols.map((c) => (
                        <th key={c.key} style={{ textAlign: 'right', width: c.width || undefined }}>
                          {c.label}
                        </th>
                      ))}
                      <th style={{ textAlign: 'right' }}>Net Wt</th>
                      <th style={{ textAlign: 'right' }}>Fine Wt</th>
                      <th style={{ width: 110 }}>HUID</th>
                      <th style={{ width: 66 }}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {computed.map((r, i) => (
                      <tr key={i}>
                        <td className="cell-del"
                          onClick={() => setRows((rs) => rs.length > 1 ? rs.filter((_, ix) => ix !== i) : rs)}>
                          <Icon.close width={13} height={13} />
                        </td>
                        <td style={{ paddingLeft: 8, color: 'var(--text-3)', fontSize: 12 }}>{i + 1}</td>
                        {cols.map((c) => (
                          <td key={c.key}>
                            <input className="right" inputMode="decimal" value={(r as any)[c.key] ?? ''}
                              onChange={(e) => {
                                const t = e.target.value
                                if (t !== '' && !/^\d*\.?\d*$/.test(t)) return
                                setCell(i, c.key as keyof Row, t)
                              }} />
                          </td>
                        ))}
                        <td><input className="right" readOnly value={r.net_wt ? wt(r.net_wt) : ''} /></td>
                        <td><input className="right" readOnly value={r.final_wt ? wt(r.final_wt) : ''} /></td>
                        <td><input value={r.huid} onChange={(e) => setCell(i, 'huid', e.target.value)} /></td>
                        <td style={{ textAlign: 'center' }}>
                          {(num(r.gross_wt) > 0 || num(r.qty) > 0) && (
                            <button className="btn btn-ghost btn-sm" title={`Duplicate this row ${addCount} times`}
                              onClick={() => duplicateRow(i, addCount)}>×{addCount}</button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="row wrap" style={{ marginTop: 14, gap: 18 }}>
                <Tot label="Gross Wt" v={`${wt(totals.gross)} g`} />
                <Tot label="Net Wt" v={`${wt(totals.net)} g`} />
                <Tot label="Fine Wt" v={`${wt(totals.fine)} g`} gold />
                <Tot label="Pieces" v={String(filled.length)} />
                <span className="spacer" style={{ marginLeft: 'auto' }} />
                <button className="btn" onClick={() => setRows([blankRow(defaults)])}>Clear</button>
                <button className="btn btn-primary" onClick={save}
                  disabled={saving || !filled.length || shortfall > 0}
                  title={shortfall > 0 ? 'Not enough loose metal on hand' : undefined}>
                  {saving ? <span className="spinner" /> : <Icon.save />}
                  {mode === 'loose' ? 'Convert' : 'Save'}{' '}
                  {filled.length ? `${filled.length} tag${filled.length === 1 ? '' : 's'}` : 'tags'}
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      {/* ══ Existing stock ══ */}
      <div className="card">
        <div className="card-head">
          <span className="card-title">Tagged Stock</span>
          {selected.size > 0 && (
            <span className="badge badge-gold">{selected.size} selected</span>
          )}
          <div className="row" style={{ marginLeft: 'auto', gap: 8 }}>
            {selected.size > 0 && (
              <>
                <button className="btn btn-sm btn-primary" onClick={() => setLabelling(selectedRows)}>
                  <Icon.print /> Print labels
                </button>
                <button className="btn btn-sm btn-danger" onClick={() => setConfirmBulkDelete(true)}>
                  <Icon.trash /> Delete
                </button>
              </>
            )}
            <div className="search-box">
              <Icon.search />
              <input className="input" placeholder="Search tag or item…" value={search}
                onChange={(e) => setSearch(e.target.value)} style={{ width: 190 }} />
            </div>
            <Select value={statusFilter} onChange={(v) => { setStatusFilter(v); setSelected(new Set()) }}
              options={[
                { value: 'IN_STOCK', label: 'In stock' },
                { value: 'SOLD', label: 'Sold' },
                { value: 'ALL', label: 'All' },
              ]} />
            <Select value={printedFilter}
              onChange={(v) => { setPrintedFilter(v); setSelected(new Set()) }}
              options={[
                { value: 'ALL', label: 'Any label' },
                { value: 'NO', label: 'Not printed only' },
                { value: 'YES', label: 'Already printed' },
              ]} />
            <button className="btn btn-sm" onClick={exportCsv}><Icon.download /> Export</button>
          </div>
        </div>
        <div className="card-body flush">
          {existing.loading ? <Loading rows={4} /> : !rowsOut.length ? (
            <Empty icon={Icon.stock} title="No tags found">Create tags above and they will show here.</Empty>
          ) : (
            <div className="table-wrap" style={{ maxHeight: 420 }}>
              <table className="data">
                <thead>
                  <tr>
                    <th style={{ width: 34 }}>
                      <input type="checkbox" checked={allSelected} onChange={toggleAll}
                        style={{ accentColor: 'var(--gold)' }} aria-label="Select all" />
                    </th>
                    <th>Tag</th><th>Item</th><th>Group</th>
                    <th className="r">Gross</th><th className="r">Net</th><th className="r">Purity</th>
                    <th className="r">Fine</th><th>Location</th><th>Label</th><th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {rowsOut.map((r: any) => (
                    <tr key={r.id} className={selected.has(r.id) ? 'selected' : ''}>
                      <td>
                        <input type="checkbox" checked={selected.has(r.id)}
                          onChange={() => toggleOne(r.id)} style={{ accentColor: 'var(--gold)' }} />
                      </td>
                      <td className="mono strong">{r.tag}</td>
                      <td>{r.item_name}</td>
                      <td>{r.group_name || '—'}</td>
                      <td className="r num">{wt(r.gross_wt)}</td>
                      <td className="r num">{wt(r.net_wt)}</td>
                      <td className="r num">{money(r.purity)}%</td>
                      <td className="r num strong">{wt(r.final_wt)}</td>
                      <td>{r.location}</td>
                      <td>
                        {r.label_printed_at
                          ? <span className="badge badge-mute"
                              title={`Printed ${r.label_printed_at}${
                                r.label_print_count > 1 ? ` · ${r.label_print_count} copies` : ''}`}>
                              Printed
                            </span>
                          : <span className="badge badge-warn">Not printed</span>}
                      </td>
                      <td>
                        <span className={`badge ${r.status === 'IN_STOCK' ? 'badge-ok' : 'badge-mute'}`}>
                          {r.status === 'IN_STOCK' ? 'In stock' : r.status === 'SOLD' ? 'Sold' : 'Melted'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={4}>Total · {rowsOut.length} pieces</td>
                    <td className="r num">{wt(rowsOut.reduce((s: number, r: any) => s + num(r.gross_wt), 0))}</td>
                    <td className="r num">{wt(rowsOut.reduce((s: number, r: any) => s + num(r.net_wt), 0))}</td>
                    <td></td>
                    <td className="r num">{wt(rowsOut.reduce((s: number, r: any) => s + num(r.final_wt), 0))}</td>
                    <td colSpan={2}></td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </div>
      </div>

      {importing && (
        <ImportCsv defaults={defaults} onClose={() => setImporting(false)}
          onImport={(parsed) => {
            setRows((rs) => {
              const keep = rs.filter((r) => num(r.gross_wt) > 0 || num(r.qty) > 0)
              return [...keep, ...parsed, blankRow(defaults)]
            })
            setImporting(false)
            run(async () => true, `${parsed.length} rows loaded — check them, then Save`)
          }} />
      )}

      {labelling && (
        <PrintLabels tags={labelling} onClose={() => setLabelling(null)}
          onPrinted={() => { setSelected(new Set()); existing.reload() }} />
      )}

      {confirmBulkDelete && (
        <Confirm title={`Delete ${selected.size} tags?`}
          message="Only tags still in stock can be deleted. Any that have been sold or melted will be skipped."
          onConfirm={bulkDelete} onCancel={() => setConfirmBulkDelete(false)} />
      )}
    </div>
  )
}

/* ───────────────────────────── helpers ───────────────────────────── */

function Tot({ label, v, gold }: { label: string; v: string; gold?: boolean }) {
  return (
    <div>
      <div className="small muted">{label}</div>
      <div className={`strong num ${gold ? 'gold' : ''}`} style={{ fontSize: 15 }}>{v}</div>
    </div>
  )
}

/** Header labels we recognise, normalised, mapped to the field they fill. */
const HEADER_ALIASES: Record<string, keyof Row> = {
  grosswt: 'gross_wt', gross: 'gross_wt',
  blackbeads: 'black_beads', blackb: 'black_beads', black: 'black_beads',
  stonewt: 'stone_wt', stone: 'stone_wt',
  stonerate: 'stone_rate',
  diamondwt: 'diamond_wt', diawt: 'diamond_wt', diamond: 'diamond_wt',
  diamondrate: 'diamond_rate', diarate: 'diamond_rate',
  purity: 'purity',
  makinggm: 'mkg_per_gm', mkggm: 'mkg_per_gm', making: 'mkg_per_gm',
  hallmark: 'hallmark_charges', hallmarkcharges: 'hallmark_charges',
  costgm: 'purchase_rate', cost: 'purchase_rate', purchaserate: 'purchase_rate',
  qty: 'qty', quantity: 'qty',
  huid: 'huid',
  location: 'location',
}

const normHeader = (s: string) => s.toLowerCase().replace(/[^a-z]/g, '')

/**
 * Turn pasted or imported text into rows. Accepts tabs or commas.
 *
 * If the first line looks like a header, columns are matched BY NAME — so a file
 * saved from an older template still lands in the right fields even though the
 * column order has since changed. Only a headerless paste falls back to position.
 */
export function parseRows(text: string, d: Defaults): Row[] {
  const lines = String(text).trim().split(/\r?\n/).filter((l) => l.trim())
  if (!lines.length) return []

  const split = (l: string) => l.split(/\t|,/).map((x) => x.trim())

  // A header is a first line whose first cell isn't a number.
  const first = split(lines[0])
  const hasHeader = first[0] !== '' && isNaN(Number(first[0]))
  const body = hasHeader ? lines.slice(1) : lines

  // field -> column index. By name when there's a header, else by position.
  const at = {} as Partial<Record<keyof Row, number>>
  if (hasHeader) {
    first.forEach((h, i) => {
      const f = HEADER_ALIASES[normHeader(h)]
      if (f !== undefined && at[f] === undefined) at[f] = i
    })
  } else {
    CSV_COLS.forEach((f, i) => { at[f] = i })
  }

  const out: Row[] = []
  for (const line of body) {
    const c = split(line)
    if (!c.length || !c.some((x) => x !== '')) continue

    const raw = (f: keyof Row) => (at[f] === undefined ? undefined : c[at[f]!])
    const n = (f: keyof Row, fallback: any = '') => {
      const v = raw(f)
      return v !== undefined && v !== '' && !isNaN(Number(v)) ? Number(v) : fallback
    }

    const row: Row = {
      gross_wt: n('gross_wt'), black_beads: n('black_beads', ''), bag_wt: n('bag_wt', ''),
      stone_wt: n('stone_wt', ''),
      stone_rate: n('stone_rate', ''), diamond_wt: n('diamond_wt', ''),
      diamond_rate: n('diamond_rate', ''),
      purity: n('purity', d.purity), mkg_per_gm: n('mkg_per_gm', d.mkg_per_gm),
      hallmark_charges: n('hallmark_charges', d.hallmark_charges),
      purchase_rate: n('purchase_rate', d.purchase_rate),
      qty: n('qty', ''),
      huid: raw('huid') ?? '', gst_pct: d.gst_pct, location: raw('location') || d.location,
    }
    if (num(row.gross_wt) > 0 || num(row.qty) > 0) out.push(row)
  }
  return out
}

/* ───────────────────────────── CSV import ───────────────────────────── */

function ImportCsv({ defaults, onClose, onImport }: {
  defaults: Defaults; onClose: () => void; onImport: (rows: Row[]) => void
}) {
  const [text, setText] = useState('')
  const parsed = useMemo(() => parseRows(text, defaults), [text, defaults])
  const fileRef = useRef<HTMLInputElement>(null)

  const template =
    'Gross Wt,Black Beads,Stone Wt,Purity,Making/gm,Hallmark,Cost/Gm,Qty,HUID,Location\n' +
    '10.000,0,0,91.6,300,45,5800,,,Shop\n' +
    '12.500,0,0.250,91.6,300,45,5800,,,Shop\n'

  const downloadTemplate = () =>
    window.api.file.saveText({ content: template, suggestedName: 'tag-import-template.csv' })

  const readFile = (f: File) => {
    const reader = new FileReader()
    reader.onload = () => setText(String(reader.result || ''))
    reader.readAsText(f)
  }

  return (
    <Modal wide title="Import Tags from a Spreadsheet" onClose={onClose}
      footer={<>
        <button className="btn btn-sm" onClick={downloadTemplate}>Download template</button>
        <span className="spacer" />
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" disabled={!parsed.length}
          onClick={() => onImport(parsed)}>
          <Icon.plus /> Load {parsed.length || ''} rows
        </button>
      </>}>
      <p className="small muted" style={{ marginBottom: 12 }}>
        Columns in this order — a header row is optional, and anything after Gross Wt can
        be left blank:
      </p>
      <div className="mono small" style={{
        background: 'var(--surface-3)', border: '1px solid var(--line)',
        borderRadius: 'var(--radius-sm)', padding: '8px 11px', marginBottom: 14,
      }}>
        Gross Wt, Black Beads, Stone Wt, Purity, Making/gm, Hallmark, Qty, HUID, Location
      </div>

      <div className="row" style={{ gap: 9, marginBottom: 10 }}>
        <button className="btn btn-sm" onClick={() => fileRef.current?.click()}>
          Choose a CSV file
        </button>
        <input ref={fileRef} type="file" accept=".csv,.txt" style={{ display: 'none' }}
          onChange={(e) => e.target.files?.[0] && readFile(e.target.files[0])} />
        <span className="small muted">or paste the rows below</span>
      </div>

      <textarea className="textarea" rows={7} value={text} placeholder="10.000,0,0,91.6,300,45"
        onChange={(e) => setText(e.target.value)} style={{ fontFamily: 'var(--mono)', fontSize: 12.5 }} />

      {text.trim() !== '' && (
        <>
          <div className="section-title" style={{ marginTop: 14 }}>
            Preview — {parsed.length} valid row{parsed.length === 1 ? '' : 's'}
          </div>
          {parsed.length === 0 ? (
            <div className="login-error">
              <Icon.alert width={15} height={15} />
              Nothing could be read. Check that the first column is a gross weight.
            </div>
          ) : (
            <div className="table-wrap" style={{ border: '1px solid var(--line)', maxHeight: 200 }}>
              <table className="data">
                <thead>
                  <tr><th>#</th><th className="r">Gross</th><th className="r">Stone</th>
                    <th className="r">Net</th><th className="r">Purity</th>
                    <th className="r">Fine</th><th>Location</th></tr>
                </thead>
                <tbody>
                  {parsed.slice(0, 50).map((r, i) => {
                    const net = netWeight(r)
                    return (
                      <tr key={i}>
                        <td className="muted">{i + 1}</td>
                        <td className="r num">{wt(r.gross_wt)}</td>
                        <td className="r num">{wt(r.stone_wt)}</td>
                        <td className="r num">{wt(net)}</td>
                        <td className="r num">{money(r.purity)}%</td>
                        <td className="r num strong">{wt(fineWeight(net, r.purity))}</td>
                        <td>{r.location}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
          {parsed.length > 50 && (
            <p className="small muted" style={{ marginTop: 6 }}>
              Showing the first 50 of {parsed.length}.
            </p>
          )}
        </>
      )}
    </Modal>
  )
}

/**
 * Opening loose metal — what was already in the safe on changeover day.
 *
 * Deliberately not a purchase: nobody is owed for it, so it must not touch any
 * supplier's khata. Re-entering replaces the figure rather than adding to it, so
 * correcting a day-one typo cannot leave both attempts on the books.
 */
function OpeningMetalModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const run = useAction()
  const existing = useAsync(() => window.api.looseStock.openingBalances(), [])
  const [f, setF] = useState<any>({ metal: 'Gold', gross_wt: '', net_wt: '', fine_wt: '' })

  const save = async () => {
    const ok = await run(() => window.api.looseStock.opening({
      metal: f.metal,
      gross_wt: num(f.gross_wt), net_wt: num(f.net_wt), fine_wt: num(f.fine_wt),
    }), 'Opening metal recorded')
    if (ok !== undefined) onSaved()
  }

  return (
    <Modal title="Opening Metal in the Safe" onClose={onClose}
      footer={<><span className="spacer" />
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" onClick={save}><Icon.save /> Save</button></>}>
      <p className="small muted" style={{ marginTop: 0 }}>
        Bullion, scrap and old gold already in the safe when you started using this software.
        Enter it here, <b>not</b> as a purchase — you do not owe anyone for it.
      </p>
      <div className="form-grid cols-2">
        <Field label="Metal">
          <Select value={f.metal} onChange={(v) => setF({ ...f, metal: v })}
            options={['Gold', 'Silver', 'Platinum'].map((m) => ({ value: m, label: m }))} />
        </Field>
        <Field label="Fine Weight (g)" required hint="Pure metal — this is the figure that counts">
          <Input className="right" value={f.fine_wt}
            onChange={(e) => setF({ ...f, fine_wt: e.target.value })} />
        </Field>
        <Field label="Gross Weight (g)" hint="Leave blank to use the fine weight">
          <Input className="right" value={f.gross_wt}
            onChange={(e) => setF({ ...f, gross_wt: e.target.value })} />
        </Field>
        <Field label="Net Weight (g)">
          <Input className="right" value={f.net_wt}
            onChange={(e) => setF({ ...f, net_wt: e.target.value })} />
        </Field>
      </div>
      {!!existing.data?.length && (
        <>
          <div className="section-title">Already recorded</div>
          <table className="data">
            <thead><tr><th>Metal</th><th className="r">Fine Wt</th><th>Entered</th></tr></thead>
            <tbody>
              {existing.data.map((o: any) => (
                <tr key={o.metal}>
                  <td>{o.metal}</td>
                  <td className="r num strong">{wt(o.fine_wt)} g</td>
                  <td className="muted small">{o.entry_date}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="small muted">
            Saving the same metal again replaces the figure above rather than adding to it.
          </p>
        </>
      )}
    </Modal>
  )
}

/* ───────────────────────────── label printing ───────────────────────────── */

function PrintLabels({ tags, onClose, onPrinted }: {
  tags: any[]; onClose: () => void; onPrinted: () => void
}) {
  const company = useAsync(() => window.api.company.read(), [])
  const [size, setSize] = useState<LabelSize>('a4-65')
  const [copies, setCopies] = useState(1)
  const [skip, setSkip] = useState(0)
  const [opts, setOpts] = useState({
    showItem: true, showGross: true, showNet: false, showPurity: true,
  })

  const html = useMemo(
    () => labelSheetHtml(tags, {
      size, copies, skip, ...opts, shopName: company.data?.name || '',
    }),
    [tags, size, copies, skip, opts, company.data]
  )

  const sizeInfo = LABEL_SIZES.find((s) => s.value === size)

  return (
    <Modal wide title={`Print Barcode Labels — ${tags.length} tag${tags.length === 1 ? '' : 's'}`}
      onClose={onClose}
      footer={<>
        <span className="small muted">{tags.length * copies} labels will print</span>
        <span className="spacer" />
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" onClick={async () => {
          await window.api.print.html({ html })
          // Marked only AFTER the print dialog returns. Marking on open would
          // empty "Not printed only" for a sheet the user cancelled.
          await window.api.tagStock.markPrinted({ ids: tags.map((t) => t.id), copies })
          onPrinted()
          onClose()
        }}>
          <Icon.print /> Print
        </button>
      </>}>
      <div style={{ display: 'grid', gridTemplateColumns: '250px 1fr', gap: 16, alignItems: 'start' }}>
        <div className="col" style={{ gap: 12 }}>
          <Field label="Label size" hint={sizeInfo?.hint}>
            <Select value={size} onChange={(v) => setSize(v as LabelSize)}
              options={LABEL_SIZES.map((s) => ({ value: s.value, label: s.label }))} />
          </Field>
          <div className="row" style={{ gap: 10 }}>
            <Field label="Copies each">
              <Input className="right" style={{ width: 74 }} value={copies}
                onChange={(e) => setCopies(Math.max(1, Number(e.target.value) || 1))} />
            </Field>
            <Field label="Skip labels" hint="Reuse a part-used sheet">
              <Input className="right" style={{ width: 74 }} value={skip}
                onChange={(e) => setSkip(Math.max(0, Number(e.target.value) || 0))} />
            </Field>
          </div>
          <div className="section-title">Show on the label</div>
          <Check label="Item name" checked={opts.showItem}
            onChange={(v) => setOpts({ ...opts, showItem: v })} />
          <Check label="Purity" checked={opts.showPurity}
            onChange={(v) => setOpts({ ...opts, showPurity: v })} />
          <Check label="Gross weight" checked={opts.showGross}
            onChange={(v) => setOpts({ ...opts, showGross: v })} />
          <Check label="Net weight" checked={opts.showNet}
            onChange={(v) => setOpts({ ...opts, showNet: v })} />
        </div>

        <div>
          <div className="section-title">Preview</div>
          <iframe title="Label preview" srcDoc={html}
            style={{
              width: '100%', height: 420, border: '1px solid var(--line)',
              borderRadius: 'var(--radius-sm)', background: '#fff',
            }} />
          <p className="small muted" style={{ marginTop: 8 }}>
            Print one sheet on plain paper first and hold it against your labels to check
            the alignment.
          </p>
        </div>
      </div>
    </Modal>
  )
}
