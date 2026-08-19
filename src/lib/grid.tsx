import React, { useEffect, useMemo, useState } from 'react'
import { Icon } from './icons'
import { Input, Modal, useAction } from './ui'
import { exportTable, printTable } from './export'

/**
 * Grid Settings — the column chooser behind every grid's `GS` button.
 *
 * The spec calls this a shared component rather than a per-screen feature, so
 * every grid declares its columns once and gets the same chooser: rename a
 * heading, set a width, hide a column, drag the order about, reset to default.
 *
 * The saved preference is RECONCILED with the columns the code actually has, on
 * every read. A saved column the code has since dropped is discarded, and a
 * column added since the preference was saved is appended rather than silently
 * missing — otherwise shipping a new column would hide it from every user who
 * had ever opened the chooser.
 */

export type GridCol = {
  key: string
  label: string
  width?: number
  /** A column the grid cannot work without — offered but never hideable. */
  fixed?: boolean
  /**
   * A heading that states what the figure MEANS, not merely what to call it —
   * "Rate/10Gm" being the case in point. A stale saved label would leave the
   * shop typing a per-ten-gram rate under a heading that still says per gram, so
   * the code's label wins and renaming is refused for this column.
   */
  lockLabel?: boolean
}

type Pref = { key: string; label: string; width: number; visible: boolean }

/** Merge a stored preference over the code's column list. */
function reconcile(defs: GridCol[], saved: Pref[]): Pref[] {
  const byKey = new Map(saved.map((p) => [p.key, p]))
  const known = new Set(defs.map((d) => d.key))
  const ordered: Pref[] = []
  // Saved order first, skipping anything the code no longer has.
  for (const p of saved) {
    if (!known.has(p.key)) continue
    const d = defs.find((x) => x.key === p.key)!
    ordered.push({
      key: d.key,
      label: d.lockLabel ? d.label : (p.label || d.label),
      width: p.width || d.width || 0,
      visible: d.fixed ? true : p.visible !== false,
    })
  }
  // Then anything the code has that the preference never saw.
  for (const d of defs) {
    if (ordered.some((p) => p.key === d.key)) continue
    ordered.push({ key: d.key, label: d.label, width: d.width || 0, visible: true })
  }
  return ordered
}

/**
 * Column state for one grid.
 *
 * `cols` is what to render — visible columns in the user's order. `open()` shows
 * the chooser. Render `{settings}` somewhere in the tree for the modal to exist.
 */
export function useGridCols(gridKey: string, defs: GridCol[]) {
  const [pref, setPref] = useState<Pref[] | null>(null)
  const [showing, setShowing] = useState(false)

  useEffect(() => {
    let alive = true
    window.api.gridPref.read({ key: gridKey }).then((saved: any) => {
      if (alive) setPref(reconcile(defs, saved || []))
    })
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gridKey])

  // Until the preference has loaded, show the code's own defaults — a grid that
  // flashed empty on every open would be worse than one that ignores a hidden
  // column for a moment.
  const effective = pref ?? reconcile(defs, [])
  const cols = useMemo(
    () => effective.filter((p) => p.visible).map((p) => ({
      ...defs.find((d) => d.key === p.key)!, label: p.label, width: p.width,
    })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [effective, defs]
  )

  const settings = showing ? (
    <GridSettings gridKey={gridKey} defs={defs} pref={effective}
      onClose={() => setShowing(false)}
      onSaved={(next) => { setPref(next); setShowing(false) }} />
  ) : null

  return { cols, open: () => setShowing(true), settings, isCustom: !!pref?.some((p) => !p.visible) }
}

/**
 * Export split-button — CSV, Excel or Word from one place, so every report
 * offers the same three and no screen quietly supports fewer.
 */
export function ExportButton({ build }: {
  build: () => { baseName: string; title: string; headers: string[]; rows: any[][]; meta?: string }
}) {
  const [open, setOpen] = useState(false)
  return (
    <span style={{ position: 'relative' }}>
      <button className="btn btn-sm" onClick={() => setOpen((o) => !o)}>
        <Icon.download /> Export
      </button>
      {open && (
        <>
          {/* Click-away catcher, so the menu closes like a native one. */}
          <div style={{ position: 'fixed', inset: 0, zIndex: 40 }} onClick={() => setOpen(false)} />
          <div className="card" style={{
            position: 'absolute', right: 0, top: '100%', marginTop: 4, zIndex: 41,
            minWidth: 150, padding: 4,
          }}>
            {(['csv', 'excel', 'word'] as const).map((f) => (
              <button key={f} className="btn btn-ghost btn-sm"
                style={{ width: '100%', justifyContent: 'flex-start' }}
                onClick={async () => { setOpen(false); await exportTable(f, build()) }}>
                {f === 'csv' ? 'CSV (.csv)' : f === 'excel' ? 'Excel (.xls)' : 'Word (.doc)'}
              </button>
            ))}
          </div>
        </>
      )}
    </span>
  )
}

/**
 * Print the table the Export button would write. Same `build` callback, so a
 * screen cannot end up printing something different from what it exports.
 */
export function PrintButton({ build }: {
  build: () => { baseName: string; title: string; headers: string[]; rows: any[][]; meta?: string }
}) {
  return (
    <button className="btn btn-sm" title="Print this report"
      onClick={() => printTable(build())}>
      <Icon.print /> Print
    </button>
  )
}

/** Print + Export together — the pair every report screen carries. */
export function ReportActions({ build }: {
  build: () => { baseName: string; title: string; headers: string[]; rows: any[][]; meta?: string }
}) {
  return (
    <>
      <PrintButton build={build} />
      <ExportButton build={build} />
    </>
  )
}

/**
 * A rate cell that is typed per ten grams but stored per gram.
 *
 * The counter quotes "1,15,000" and means ten grams; everything stored, printed
 * and reported stays per gram, so the typed figure is divided by ten on its way
 * in. The text is held locally rather than derived on every render — converting
 * on each keystroke would round "7500." back to "7500" the moment it was typed,
 * making decimals impossible to enter. It is only pulled back into step when the
 * underlying rate changes from somewhere else: a scanned tag, the rate master,
 * or a saved document being opened.
 */
export function Rate10Cell({ v, on }: { v: any; on: (v: string) => void }) {
  const perTen = v === '' || v == null ? '' : String(Math.round(Number(v) * 10 * 1000) / 1000)
  const [txt, setTxt] = useState(perTen)
  useEffect(() => {
    if (Number(txt || 0) !== Number(perTen || 0)) setTxt(perTen)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [perTen])
  return (
    <td>
      <input className="right" inputMode="decimal" value={txt}
        onChange={(e) => {
          const t = e.target.value
          if (t !== '' && !/^\d*\.?\d*$/.test(t)) return
          setTxt(t)
          on(t === '' ? '' : String(Number(t) / 10))
        }}
        onFocus={(e) => e.target.select()} />
    </td>
  )
}

/** The `GS` toolbar button. Kept here so every grid's looks and reads the same. */
export function GridSettingsButton({ onClick }: { onClick: () => void }) {
  return (
    <button className="btn btn-sm" onClick={onClick} title="Grid settings — choose columns">
      <Icon.columns /> Columns
    </button>
  )
}

function GridSettings({ gridKey, defs, pref, onClose, onSaved }: {
  gridKey: string; defs: GridCol[]; pref: Pref[]
  onClose: () => void; onSaved: (p: Pref[]) => void
}) {
  const run = useAction()
  const [rows, setRows] = useState<Pref[]>(pref)
  const fixed = (k: string) => !!defs.find((d) => d.key === k)?.fixed

  const move = (i: number, d: number) => {
    const j = i + d
    if (j < 0 || j >= rows.length) return
    const next = rows.slice()
    ;[next[i], next[j]] = [next[j], next[i]]
    setRows(next)
  }
  const set = (i: number, patch: Partial<Pref>) =>
    setRows((rs) => rs.map((r, k) => (k === i ? { ...r, ...patch } : r)))

  const save = async () => {
    const ok = await run(() => window.api.gridPref.save({ key: gridKey, config: rows }),
      'Columns saved')
    if (ok !== undefined) onSaved(rows)
  }

  const reset = async () => {
    const ok = await run(() => window.api.gridPref.reset({ key: gridKey }), 'Columns reset')
    if (ok !== undefined) onSaved(reconcile(defs, []))
  }

  return (
    <Modal title="Grid Settings" onClose={onClose}
      footer={<>
        <button className="btn" onClick={reset}>Reset to Default</button>
        <span className="spacer" />
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" onClick={save}><Icon.save /> Save</button>
      </>}>
      <p className="small muted" style={{ marginTop: 0 }}>
        Choose which columns appear, rename a heading, or set a width. The order here is
        the order on screen.
      </p>
      <div className="table-wrap" style={{ maxHeight: 380 }}>
        <table className="data">
          <thead>
            <tr><th style={{ width: 62 }}>Order</th><th>Name</th><th>H.Text</th>
              <th className="r" style={{ width: 90 }}>H.Width</th>
              <th className="r" style={{ width: 70 }}>Visible</th></tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.key}>
                <td>
                  <button className="btn btn-ghost btn-icon btn-sm" aria-label="Move up"
                    disabled={i === 0} onClick={() => move(i, -1)}><Icon.up /></button>
                  <button className="btn btn-ghost btn-icon btn-sm" aria-label="Move down"
                    disabled={i === rows.length - 1} onClick={() => move(i, 1)}><Icon.down /></button>
                </td>
                <td className="muted small">{defs.find((d) => d.key === r.key)?.label}</td>
                <td>
                  <Input value={r.label} disabled={defs.find((d) => d.key === r.key)?.lockLabel}
                    title={defs.find((d) => d.key === r.key)?.lockLabel
                      ? 'This heading states the unit the figure is typed in, so it cannot be renamed'
                      : undefined}
                    onChange={(e) => set(i, { label: e.target.value })} />
                </td>
                <td>
                  <Input className="right" value={r.width || ''} placeholder="auto"
                    onChange={(e) => set(i, { width: Number(e.target.value) || 0 })} />
                </td>
                <td className="r">
                  <input type="checkbox" checked={r.visible} disabled={fixed(r.key)}
                    title={fixed(r.key) ? 'This grid cannot work without this column' : undefined}
                    onChange={(e) => set(i, { visible: e.target.checked })} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Modal>
  )
}
