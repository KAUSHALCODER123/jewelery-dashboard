import { money, dmy } from '../lib/format'

export const BLOCKS = [
  ['header', 'Shop header'], ['customer', 'Customer & bill details'], ['items', 'Item table'],
  ['oldgold', 'Old gold'], ['totals', 'Totals & bank'], ['declaration', 'Declaration'],
  ['note', 'Footer note'], ['signature', 'Signatures'],
] as const
export const SOURCES = ['text', 'sale.bill_no', 'sale.bill_date', 'sale.party_name', 'sale.mobile',
  'sale.address', 'sale.manual_no', 'sale.total_amount', 'sale.net_balance', 'sale.payment_mode',
  'company.name', 'company.phone', 'company.gstin', 'party.gstin', 'amount_in_words', 'pending_balance']
export type LayoutField = { id: string; kind: string; label: string; value: string; source: string;
  row: number; column: number; span: number; fontSize: number; align: 'left' | 'center' | 'right' }
export type InvoiceLayout = { columns: number; rows: number; fields: LayoutField[] }
const bounded = (v: any, min: number, max: number, fallback: number) => Number.isFinite(Number(v)) ? Math.max(min, Math.min(max, Math.round(Number(v)))) : fallback
export function defaultLayout(): InvoiceLayout {
  return { columns: 2, rows: 8, fields: BLOCKS.map(([kind, label], i) => ({
    id: kind, kind, label, value: '', source: 'text', row: i + 1, column: 1, span: 2, fontSize: 11, align: 'left',
  })) }
}
export function normalizeLayout(raw: any): InvoiceLayout | undefined {
  if (!raw || !Array.isArray(raw.fields)) return undefined
  const columns = bounded(raw.columns, 1, 12, 2), rows = bounded(raw.rows, 1, 100, 8)
  const ids = new Set<string>()
  return { columns, rows, fields: raw.fields.slice(0, 100).filter((f: any) => {
    if (!f || typeof f.id !== 'string' || ids.has(f.id) || !['custom', ...BLOCKS.map(b => b[0])].includes(f.kind)) return false
    ids.add(f.id); return true
  }).map((f: any) => {
    const column = bounded(f.column, 1, columns, 1)
    return { ...f, label: String(f.label || ''), value: String(f.value || ''),
      source: SOURCES.includes(f.source) ? f.source : 'text',
      row: bounded(f.row, 1, rows, 1), column, span: bounded(f.span, 1, columns - column + 1, 1),
      fontSize: bounded(f.fontSize, 7, 36, 11), align: ['left', 'center', 'right'].includes(f.align) ? f.align : 'left' }
  }) }
}
const esc = (s: any) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))
/** A bound field prints the way the rest of the bill prints it: dates as dd/Mon/yyyy, rupees with commas. */
function display(source: string, v: any) {
  if (v == null || v === '') return ''
  if (source.endsWith('_date')) return dmy(v)
  if (/(amount|balance)$/.test(source)) return money(v)
  return v
}

export function applyLayout(html: string, raw: InvoiceLayout | undefined, data: any) {
  const layout = normalizeLayout(raw)
  if (!layout) return html
  const start = html.indexOf('<div class="sheet">'), end = html.lastIndexOf('</div>')
  const body = html.slice(start + '<div class="sheet">'.length, end)
  const sections: Record<string, string> = {}
  const matches = [...body.matchAll(/<!--block:(\w+)-->/g)]
  matches.forEach((m, i) => { sections[m[1]] = body.slice(m.index! + m[0].length, matches[i + 1]?.index ?? body.length) })
  // Each grid row flows naturally across printed pages; no fixed heights clip long bills.
  const rows = Array.from({ length: layout.rows }, (_, i) => {
    const fields = layout.fields.filter(f => f.row === i + 1).sort((a, b) => a.column - b.column)
    return `<div class="layout-row" style="display:grid;grid-template-columns:repeat(${layout.columns},minmax(0,1fr));min-height:8px">${fields.map(f => {
      const value = f.source === 'text' ? f.value : display(f.source, f.source.split('.').reduce((v, k) => v?.[k], data))
      const content = f.kind === 'custom' ? `<div style="padding:6px;white-space:pre-wrap;overflow-wrap:anywhere"><b>${esc(f.label)}</b>${f.label ? ': ' : ''}${esc(value)}</div>` : sections[f.kind] || ''
      return `<div style="min-width:0;grid-column:${f.column}/span ${f.span};font-size:${f.fontSize}px;text-align:${f.align}">${content}</div>`
    }).join('')}</div>`
  }).join('')
  return html.slice(0, start) + `<div class="sheet">${rows}</div>`
}
