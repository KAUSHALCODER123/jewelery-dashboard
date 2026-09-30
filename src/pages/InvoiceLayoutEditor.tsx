import React, { useState } from 'react'
import { BLOCKS, SOURCES, defaultLayout, normalizeLayout, type LayoutField } from '../print/layout'
import { type InvoiceConfig } from '../print/invoice'
import { HEADER_LIMITS, normalizeHeader, type HeaderDesign, type HeaderLine } from '../print/header'
import { Check, Field, Input, Segmented, Select, useAction } from '../lib/ui'

const COLUMN_NAMES: Record<string, string> = {
  no: 'Sr No', name: 'Item Name', hsn: 'HSN', purity: 'Purity', huid: 'HUID', qty: 'Qty',
  gross: 'Gross Wt', net: 'Net Wt', rate: 'Rate/10g', mkg: 'Making/g', amt: 'Amount',
  stone: 'Stone Wt', mkgamt: 'Making Amt', hallmark: 'Hallmark',
}
const COLUMNS = Object.keys(COLUMN_NAMES)
export default function InvoiceLayoutEditor({ cfg, onChange }: { cfg: InvoiceConfig; onChange: (p: Partial<InvoiceConfig>) => void }) {
  const [selected, select] = useState('header')
  const layout = cfg.layout
  const field = layout?.fields.find(f => f.id === selected)
  const update = (patch: Partial<LayoutField>) => layout && onChange({ layout: normalizeLayout({ ...layout,
    fields: layout.fields.map(f => f.id === selected ? { ...f, ...patch } : f) }) })
  const order = [...new Set([...(cfg.columnOrder || []), ...COLUMNS])].filter(k => COLUMNS.includes(k))
  const moveColumn = (from: string, to: string) => {
    const next = order.filter(k => k !== from); next.splice(next.indexOf(to), 0, from); onChange({ columnOrder: next })
  }
  return <div className="card" style={{ marginBottom: 14 }}>
    <div className="card-head"><span className="card-title">Drag-and-drop layout</span>
      <span className="spacer" /><button className="btn btn-sm" onClick={() => onChange({ layout: layout ? undefined : defaultLayout() })}>
        {layout ? 'Use classic layout' : 'Enable custom layout'}</button></div>
    <div className="card-body">
      {layout && <>
        <p className="hint">Drag a field onto a cell. Select a field to edit its position, width or content. Row and column controls also work with the keyboard. All invoice items always print.</p>
        <div className="row" style={{ margin: '12px 0', flexWrap: 'wrap' }}>
          <Field label="Layout rows"><Input aria-label="Layout rows" type="number" min={1} max={100} value={layout.rows}
            onChange={e => onChange({ layout: normalizeLayout({ ...layout, rows: e.target.value }) })} /></Field>
          <Field label="Layout columns"><Input aria-label="Layout columns" type="number" min={1} max={12} value={layout.columns}
            onChange={e => onChange({ layout: normalizeLayout({ ...layout, columns: e.target.value }) })} /></Field>
          <button className="btn" onClick={() => {
            const id = crypto.randomUUID(); select(id)
            onChange({ layout: { ...layout, rows: Math.min(100, layout.rows + 1), fields: [...layout.fields, {
              id, kind: 'custom', label: 'New field', value: '', source: 'text', row: Math.min(100, layout.rows + 1),
              column: 1, span: layout.columns, fontSize: 11, align: 'left',
            }] } })
          }}>+ Add field</button>
          <Select aria-label="Restore section" value="" placeholder="Add removed section…" options={BLOCKS.filter(([k]) => !layout.fields.some(f => f.kind === k)).map(([value, label]) => ({ value, label }))}
            onChange={kind => { const f = defaultLayout().fields.find(f => f.kind === kind)!; select(f.id); onChange({ layout: { ...layout, fields: [...layout.fields, { ...f, row: layout.rows, span: layout.columns }] } }) }} />
        </div>
        <div className="invoice-canvas" style={{ gridTemplateColumns: `repeat(${layout.columns}, minmax(0,1fr))` }}>
          {Array.from({ length: layout.rows * layout.columns }, (_, i) => {
            const row = Math.floor(i / layout.columns) + 1, column = i % layout.columns + 1
            return <div key={i} className="invoice-cell" style={{ gridRow: row, gridColumn: column }}
              onDragOver={e => e.preventDefault()} onDrop={e => {
                e.preventDefault(); const id = e.dataTransfer.getData('application/invoice-field')
                onChange({ layout: normalizeLayout({ ...layout, fields: layout.fields.map(f => f.id === id ? { ...f, row, column } : f) }) })
              }}><span className="hint">{row}:{column}</span>
              {layout.fields.filter(f => f.row === row && f.column === column).map(f => <button key={f.id}
                className={`btn invoice-block ${selected === f.id ? 'btn-primary' : ''}`} draggable
                onDragStart={e => e.dataTransfer.setData('application/invoice-field', f.id)} onClick={() => select(f.id)}>
                ⠿ {f.label || f.kind} <small>({f.span} col)</small></button>)}
            </div>
          })}
        </div>
        {field && <div className="form-grid cols-2" style={{ marginTop: 14 }}>
          <Field label="Field label"><Input value={field.label} onChange={e => update({ label: e.target.value })} /></Field>
          {field.kind === 'custom' && <>
            <Field label="Content"><Select value={field.source} options={SOURCES.map(value => ({ value, label: value === 'text' ? 'Custom text' : value }))} onChange={source => update({ source })} /></Field>
            {field.source === 'text' && <Field label="Text" className="span-2"><textarea className="textarea" value={field.value} onChange={e => update({ value: e.target.value })} /></Field>}
          </>}
          {(['row', 'column', 'span', 'fontSize'] as const).map(key => <Field key={key} label={{ row: 'Row number', column: 'Column number', span: 'Width in columns', fontSize: 'Font size' }[key]}>
            <Input type="number" min={key === 'fontSize' ? 7 : 1} max={key === 'row' ? layout.rows : key === 'fontSize' ? 36 : layout.columns}
              value={field[key]} onChange={e => update({ [key]: Number(e.target.value) })} /></Field>)}
          <Field label="Alignment"><Select value={field.align} options={['left', 'center', 'right'].map(value => ({ value, label: value }))} onChange={align => update({ align: align as any })} /></Field>
          <button className="btn btn-danger" onClick={() => onChange({ layout: { ...layout, fields: layout.fields.filter(f => f.id !== selected) } })}>Remove field</button>
        </div>}
      </>}
      <Field label="Minimum item rows" hint="Adds blank rows for short bills; never removes actual items.">
        <Input type="number" min={0} max={100} value={cfg.minRows ?? 8} onChange={e => onChange({ minRows: Math.max(0, Math.min(100, Number(e.target.value))) })} /></Field>
      <p className="hint">Drag item columns to reorder, or use the arrow buttons. Rename headings and set widths (0 = automatic).</p>
      <div className="table-wrap"><table className="data"><thead><tr><th>Show</th><th>Column</th><th>Heading</th><th>Width (px)</th><th>Order</th></tr></thead><tbody>
        {order.map((key, i) => <tr key={key} draggable onDragStart={e => e.dataTransfer.setData('application/invoice-column', key)}
          onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); const from = e.dataTransfer.getData('application/invoice-column'); if (order.includes(from)) moveColumn(from, key) }}>
          <td><input type="checkbox" aria-label={`Show ${key}`} checked={cfg.cols[key] ?? true} onChange={e => onChange({ cols: { ...cfg.cols, [key]: e.target.checked } })} /></td>
          <td className="small muted">{COLUMN_NAMES[key]}</td>
          <td><Input aria-label={`${key} heading`} placeholder={COLUMN_NAMES[key]} value={cfg.columnLabels?.[key] ?? ''} onChange={e => onChange({ columnLabels: { ...cfg.columnLabels, [key]: e.target.value } })} /></td>
          <td><Input aria-label={`${key} width`} type="number" min={0} max={300} value={cfg.columnWidths?.[key] ?? 0} onChange={e => onChange({ columnWidths: { ...cfg.columnWidths, [key]: Number(e.target.value) } })} /></td>
          <td><button className="btn btn-sm" disabled={!i} aria-label={`Move ${key} up`} onClick={() => moveColumn(key, order[i - 1])}>↑</button>
            <button className="btn btn-sm" disabled={i === order.length - 1} aria-label={`Move ${key} down`} onClick={() => moveColumn(order[i + 1], key)}>↓</button></td>
        </tr>)}
      </tbody></table></div>
    </div>
  </div>
}

/** Pictures wider than a printed A4 band needs are shrunk before they go into the setting. */
const MAX_BANNER_PX = 2400
function readBanner(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('Could not read that picture.'))
    reader.onload = () => {
      const url = String(reader.result)
      const img = new Image()
      img.onerror = () => reject(new Error('That file is not a picture this app can print.'))
      img.onload = () => {
        if (img.naturalWidth <= MAX_BANNER_PX && url.length < 1_500_000) return resolve(url)
        const scale = Math.min(1, MAX_BANNER_PX / img.naturalWidth)
        const canvas = document.createElement('canvas')
        canvas.width = Math.round(img.naturalWidth * scale); canvas.height = Math.round(img.naturalHeight * scale)
        canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height)
        // PNG keeps a transparent banner transparent; photos go smaller as JPEG.
        resolve(file.type === 'image/png' ? canvas.toDataURL('image/png') : canvas.toDataURL('image/jpeg', 0.9))
      }
      img.src = url
    }
    reader.readAsDataURL(file)
  })
}

const LINES: [keyof Pick<HeaderDesign, 'name' | 'taglineLine' | 'address' | 'contact'>, string][] = [
  ['name', 'Shop name'], ['taglineLine', 'Tagline'], ['address', 'Address'], ['contact', 'Contact & GST'],
]
const ALIGN_OPTIONS = [{ value: 'left', label: 'Left' }, { value: 'center', label: 'Centre' }, { value: 'right', label: 'Right' }]

/** Header style, band size, background and the text drawn on it. The preview beside it is the real print. */
export function HeaderDesigner({ cfg, onChange }: { cfg: InvoiceConfig; onChange: (p: Partial<InvoiceConfig>) => void }) {
  const h = normalizeHeader(cfg.header)
  const set = (patch: Partial<HeaderDesign>) => onChange({ header: normalizeHeader({ ...h, ...patch }) })
  const setLine = (key: typeof LINES[number][0], patch: Partial<HeaderLine>) => set({ [key]: { ...h[key], ...patch } })
  const run = useAction()
  const upload = (file?: File) => file && run(async () => set({ image: await readBanner(file) }))
  return <div className="card">
    <div className="card-head"><span className="card-title">Shop header</span></div>
    <div className="card-body">
      <div className="form-grid" style={{ gap: 12 }}>
        <Field label="Header style" hint={cfg.paper === 'THERMAL' && !cfg.layout ? 'Prints on A4 bills; the thermal receipt keeps its simple header.' : undefined}>
          <Segmented value={h.style} onChange={style => set({ style: style as HeaderDesign['style'] })}
            options={[{ value: 'standard', label: 'Standard' }, { value: 'image', label: 'Image only' }, { value: 'banner', label: 'Image + text' }]} />
        </Field>
        {h.style !== 'standard' && <>
          <Field label={`Header height: ${h.height} mm`}>
            <input type="range" aria-label="Header height" min={HEADER_LIMITS.height[0]} max={HEADER_LIMITS.height[1]} value={h.height}
              onChange={e => set({ height: Number(e.target.value) })} />
          </Field>
          <Field label={h.style === 'image' ? 'Banner image' : 'Background image'}
            hint={h.style === 'image' && !h.image ? 'Until a picture is chosen the standard header prints.' : 'PNG or JPEG, ideally about 7 : 1 wide.'}>
            <div className="row" style={{ flexWrap: 'wrap' }}>
              <label className="btn btn-sm">{h.image ? 'Replace image…' : 'Upload image…'}
                <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" aria-label="Header image" style={{ display: 'none' }}
                  onChange={e => { upload(e.target.files?.[0]); e.target.value = '' }} /></label>
              {h.image && <button className="btn btn-sm btn-danger" onClick={() => set({ image: '' })}>Remove image</button>}
            </div>
          </Field>
          {h.image && <Field label="Image fit">
            <Segmented value={h.fit} onChange={fit => set({ fit: fit as HeaderDesign['fit'] })}
              options={[{ value: 'cover', label: 'Fill (crop)' }, { value: 'contain', label: 'Fit whole' }, { value: 'stretch', label: 'Stretch' }]} />
          </Field>}
        </>}
        {h.style === 'banner' && <>
          <Field label="Background colour" hint="Shows behind the text, and around an image that does not fill the band">
            <div className="row">
              <input type="color" aria-label="Header background colour" value={h.background || '#ffffff'} style={{ width: 44, height: 34, padding: 2 }}
                onChange={e => set({ background: e.target.value })} />
              <button className="btn btn-sm" disabled={!h.background} onClick={() => set({ background: '' })}>No colour</button>
            </div>
          </Field>
          <Field label="Logo in the band">
            <Select aria-label="Header logo position" value={h.logo} onChange={logo => set({ logo: logo as HeaderDesign['logo'] })}
              options={[...ALIGN_OPTIONS, { value: 'hidden', label: 'Hidden' }]} />
          </Field>
          <Field label="Tagline" hint="A sub-line under the shop name">
            <Input aria-label="Header tagline" value={h.tagline} placeholder="e.g. Trusted jewellers since 1985"
              onChange={e => set({ tagline: e.target.value })} />
          </Field>
          {LINES.map(([key, label]) => <div key={key} className="col" style={{ gap: 6, borderTop: '1px solid var(--line)', paddingTop: 8 }}>
            <Check label={`Show ${label.toLowerCase()}`} checked={h[key].show} onChange={show => setLine(key, { show })} />
            {h[key].show && <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
              <input type="color" aria-label={`${label} colour`} value={h[key].color} style={{ width: 36, height: 30, padding: 2 }}
                onChange={e => setLine(key, { color: e.target.value })} />
              <Input aria-label={`${label} size`} type="number" min={HEADER_LIMITS.size[0]} max={HEADER_LIMITS.size[1]} value={h[key].size}
                style={{ width: 64 }} onChange={e => setLine(key, { size: Number(e.target.value) })} />
              <Select aria-label={`${label} alignment`} value={h[key].align} options={ALIGN_OPTIONS}
                onChange={align => setLine(key, { align: align as HeaderLine['align'] })} />
            </div>}
          </div>)}
        </>}
      </div>
    </div>
  </div>
}
