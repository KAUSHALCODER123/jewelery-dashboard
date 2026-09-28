import React, { useState } from 'react'
import { BLOCKS, SOURCES, defaultLayout, normalizeLayout, type LayoutField } from '../print/layout'
import { type InvoiceConfig } from '../print/invoice'
import { Field, Input, Select } from '../lib/ui'

const COLUMNS = ['no', 'name', 'hsn', 'purity', 'huid', 'qty', 'gross', 'net', 'rate', 'mkg', 'amt']
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
      <div className="table-wrap"><table className="data"><thead><tr><th>Show</th><th>Heading</th><th>Width (px)</th><th>Order</th></tr></thead><tbody>
        {order.map((key, i) => <tr key={key} draggable onDragStart={e => e.dataTransfer.setData('application/invoice-column', key)}
          onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); const from = e.dataTransfer.getData('application/invoice-column'); if (order.includes(from)) moveColumn(from, key) }}>
          <td><input type="checkbox" aria-label={`Show ${key}`} checked={cfg.cols[key] !== false} onChange={e => onChange({ cols: { ...cfg.cols, [key]: e.target.checked } })} /></td>
          <td><Input aria-label={`${key} heading`} placeholder={key} value={cfg.columnLabels?.[key] ?? ''} onChange={e => onChange({ columnLabels: { ...cfg.columnLabels, [key]: e.target.value } })} /></td>
          <td><Input aria-label={`${key} width`} type="number" min={0} max={300} value={cfg.columnWidths?.[key] ?? 0} onChange={e => onChange({ columnWidths: { ...cfg.columnWidths, [key]: Number(e.target.value) } })} /></td>
          <td><button className="btn btn-sm" disabled={!i} aria-label={`Move ${key} up`} onClick={() => moveColumn(key, order[i - 1])}>↑</button>
            <button className="btn btn-sm" disabled={i === order.length - 1} aria-label={`Move ${key} down`} onClick={() => moveColumn(order[i + 1], key)}>↓</button></td>
        </tr>)}
      </tbody></table></div>
    </div>
  </div>
}
