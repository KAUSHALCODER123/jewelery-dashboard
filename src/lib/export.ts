import { toCsv } from './format'

/**
 * Export a table as CSV, Excel or Word.
 *
 * Excel and Word both open an HTML table natively when it carries the right
 * MIME type and file extension — Word since 2000, Excel since 2003. That is
 * deliberately what this does rather than pulling in a spreadsheet library: the
 * app is fully offline and ships as a 90 MB installer, and a real .xlsx writer
 * would add a dependency and a build step to produce a file the shop opens,
 * glances at and prints. The trade-off is that Excel shows a "different format
 * than specified" prompt on open; the file itself is correct.
 *
 * Numbers are emitted with `mso-number-format:"\@"` off so Excel treats them as
 * numbers, not text — otherwise every weight lands left-aligned and un-summable.
 */

export type ExportFormat = 'csv' | 'excel' | 'word'

const esc = (v: any) =>
  String(v ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

const isNumeric = (v: any) =>
  v !== '' && v !== null && v !== undefined && !isNaN(Number(String(v).replace(/,/g, '')))

function tableHtml(title: string, headers: string[], rows: any[][], meta?: string) {
  const head = headers.map((h) => `<th>${esc(h)}</th>`).join('')
  const body = rows
    .map((r) => `<tr>${r.map((c) => {
      // Let Excel right-align and total the numeric columns by leaving them
      // unquoted; anything else is forced to text so a tag like "007" keeps
      // its leading zeros.
      const num = isNumeric(c)
      return `<td${num ? '' : ' style="mso-number-format:\'\\@\'"'}>${esc(c)}</td>`
    }).join('')}</tr>`)
    .join('')
  return `<html xmlns:o="urn:schemas-microsoft-com:office:office"
  xmlns:x="urn:schemas-microsoft-com:office:excel">
<head><meta charset="utf-8" />
<style>
  body { font-family: Calibri, Arial, sans-serif; font-size: 11pt; }
  h1 { font-size: 15pt; margin: 0 0 2pt; }
  p.meta { margin: 0 0 10pt; color: #555; font-size: 9pt; }
  table { border-collapse: collapse; }
  th, td { border: 0.5pt solid #999; padding: 3pt 6pt; }
  th { background: #F2E6C8; text-align: left; font-weight: bold; }
</style></head>
<body>
<h1>${esc(title)}</h1>
${meta ? `<p class="meta">${esc(meta)}</p>` : ''}
<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>
</body></html>`
}

/**
 * The same table, laid out for paper.
 *
 * Reports print landscape by default — a stock sheet has more columns than a
 * portrait page holds, and a report that silently truncates its right-hand
 * columns is worse than one that does not print at all. The heading repeats on
 * every page (`thead` + `display: table-header-group`), because a shop reading
 * page four of a stock count needs to know which column is which.
 */
function printableHtml(
  title: string, headers: string[], rows: any[][],
  meta: string | undefined, shop: string, printedOn: string
) {
  const head = headers.map((h) => `<th>${esc(h)}</th>`).join('')
  const body = rows
    .map((r) => `<tr>${r.map((c) =>
      `<td class="${isNumeric(c) ? 'r' : ''}">${esc(c)}</td>`).join('')}</tr>`)
    .join('')
  return `<html><head><meta charset="utf-8" />
<style>
  @page { size: A4 landscape; margin: 10mm; }
  * { box-sizing: border-box; }
  body { font-family: Arial, Helvetica, sans-serif; font-size: 10px; color: #111; margin: 0; }
  .shop { font-size: 15px; font-weight: 700; }
  h1 { font-size: 12px; margin: 2px 0 1px; font-weight: 700; }
  .meta { font-size: 9px; color: #555; margin-bottom: 6px; }
  table { width: 100%; border-collapse: collapse; }
  thead { display: table-header-group; }
  th, td { border: 0.5px solid #999; padding: 2.5px 4px; }
  th { background: #EFE3C4; text-align: left; font-weight: 700; }
  td.r, th.r { text-align: right; }
  tr { page-break-inside: avoid; }
  tbody tr:nth-child(even) { background: #FAFAFA; }
  .foot { margin-top: 6px; font-size: 8px; color: #777; text-align: right; }
</style></head>
<body>
  <div class="shop">${esc(shop)}</div>
  <h1>${esc(title)}</h1>
  ${meta ? `<div class="meta">${esc(meta)}</div>` : ''}
  <table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>
  <div class="foot">${rows.length} row${rows.length === 1 ? '' : 's'} · printed ${esc(printedOn)}</div>
</body></html>`
}

/** Send one table to the printer, headed with the shop's name. */
export async function printTable(opts: {
  title: string; headers: string[]; rows: any[][]; meta?: string
}) {
  const company = await window.api.company.read()
  const stamp = new Date().toLocaleString('en-IN')
  return window.api.print.html({
    html: printableHtml(
      opts.title, opts.headers, opts.rows, opts.meta,
      company?.name || '', stamp
    ),
  })
}

const FILTERS: Record<ExportFormat, any> = {
  csv: { name: 'CSV', extensions: ['csv'] },
  excel: { name: 'Excel Workbook', extensions: ['xls'] },
  word: { name: 'Word Document', extensions: ['doc'] },
}

/**
 * Write one table out in the chosen format. `baseName` is without extension.
 * Returns whatever the save dialog returned, so a caller can tell a cancel from
 * a failure.
 */
export async function exportTable(
  format: ExportFormat,
  opts: { baseName: string; title: string; headers: string[]; rows: any[][]; meta?: string }
) {
  const { baseName, title, headers, rows, meta } = opts
  const ext = format === 'csv' ? 'csv' : format === 'excel' ? 'xls' : 'doc'
  const content = format === 'csv'
    ? toCsv(headers, rows)
    : tableHtml(title, headers, rows, meta)
  return window.api.file.saveText({
    content,
    suggestedName: `${baseName}.${ext}`,
    filters: [FILTERS[format]],
  })
}

/** The three-button export group every report screen uses. */
export function exportButtons(
  build: () => { baseName: string; title: string; headers: string[]; rows: any[][]; meta?: string }
) {
  return (['csv', 'excel', 'word'] as ExportFormat[]).map((f) => ({
    format: f,
    label: f === 'csv' ? 'CSV' : f === 'excel' ? 'Excel' : 'Word',
    run: () => exportTable(f, build()),
  }))
}
