import { money, wt, dmy } from '../lib/format'
import shopLogo from '../assets/parivar-jewellers.jpeg?inline'

const esc = (s: any) =>
  String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!))

export type InvoiceConfig = {
  paper: 'A4' | 'THERMAL'
  title: string
  accent: string
  showLogo: boolean
  showBank: boolean
  showDeclaration: boolean
  showUrd: boolean
  showSignature: boolean
  showPendingBalance: boolean
  cols: Record<string, boolean>
  footerNote: string
}

export const DEFAULT_INVOICE_CONFIG: InvoiceConfig = {
  paper: 'A4',
  title: 'TAX INVOICE',
  accent: '#D4AF37',
  showLogo: true,
  showBank: true,
  showDeclaration: true,
  showUrd: true,
  showSignature: true,
  showPendingBalance: true,
  cols: { hsn: true, purity: true, huid: true, qty: true, gross: true, net: true, rate: true, mkg: true },
  footerNote: '',
}

export function loadConfig(raw?: string | null): InvoiceConfig {
  if (!raw) return DEFAULT_INVOICE_CONFIG
  try {
    const p = JSON.parse(raw)
    return { ...DEFAULT_INVOICE_CONFIG, ...p, cols: { ...DEFAULT_INVOICE_CONFIG.cols, ...(p.cols || {}) } }
  } catch {
    return DEFAULT_INVOICE_CONFIG
  }
}

/** A4 tax invoice, laid out to match the demo software's printed bill. */
/** Fine weight still owed by the customer on a weight-wise bill, 0 otherwise. */
const pendingMetal = (s: any) =>
  Number(s?.weightwise)
    ? (s.metals || []).reduce((t: number, m: any) => t + Number(m.pending_wt || 0), 0)
    : 0
const wt3 = (n: number) => Number(n || 0).toFixed(3)

export function invoiceHtml(data: any, cfgIn?: Partial<InvoiceConfig>) {
  const cfg: InvoiceConfig = { ...DEFAULT_INVOICE_CONFIG, ...(cfgIn || {}) }
  if (cfg.paper === 'THERMAL') return thermalHtml(data, cfg)

  const { company: c, sale: s, party: p, pending_balance, amount_in_words } = data
  const pendingWt = pendingMetal(s)
  const C = cfg.cols

  const gstHalf = (Number(s.gst_amount) || 0) / 2
  const halfPct = ((Number(s.gst_pct) || 0) / 2).toFixed(2).replace(/\.?0+$/, '')

  // Only the enabled columns are rendered, so widths stay sane at any combination.
  const columns = [
    { k: 'no', label: 'NO', w: 22, on: true, cls: 'c', get: (_it: any, i: number) => String(i + 1) },
    { k: 'name', label: 'Item Name', w: 0, on: true, cls: '', get: (it: any) =>
      `${esc(it.item_name)}${it.tag ? ` <span class="tag">${esc(it.tag)}</span>` : ''}` },
    { k: 'hsn', label: 'HSN', w: 44, on: C.hsn, cls: 'c', get: (it: any) => esc(it.hsn || '') },
    { k: 'purity', label: 'Purity', w: 42, on: C.purity, cls: 'r', get: (it: any) => it.purity ? money(it.purity) : '' },
    { k: 'huid', label: 'HUID', w: 58, on: C.huid, cls: 'c small', get: (it: any) => esc(it.huid || '') },
    { k: 'qty', label: 'Qty', w: 28, on: C.qty, cls: 'r', get: (it: any) => it.qty ? money(it.qty, 0) : '' },
    { k: 'gross', label: 'Gr.Wt', w: 52, on: C.gross, cls: 'r', get: (it: any) => wt(it.gross_wt) },
    { k: 'net', label: 'Nt.Wt', w: 52, on: C.net, cls: 'r', get: (it: any) => wt(it.net_wt) },
    // Quoted per ten grams, the way the rate is agreed at the counter and typed
    // into the bill. The line is stored per gram; only the presentation scales.
    { k: 'rate', label: 'Rate/10g', w: 64, on: C.rate, cls: 'r',
      get: (it: any) => money((Number(it.rate_per_gm) || 0) * 10) },
    { k: 'mkg', label: 'Mkg', w: 44, on: C.mkg, cls: 'r', get: (it: any) => money(it.mkg_per_gm) },
    { k: 'amt', label: 'Amount', w: 72, on: true, cls: 'r', get: (it: any) => money(it.total_amount) },
  ].filter((x) => x.on)

  const head = columns
    .map((col) => `<th${col.w ? ` style="width:${col.w}px"` : ''}>${col.label}</th>`)
    .join('')

  const rows = (s.items || [])
    .map((it: any, i: number) =>
      `<tr>${columns.map((col) => `<td class="${col.cls}">${col.get(it, i)}</td>`).join('')}</tr>`)
    .join('')

  const filler = Array.from(
    { length: Math.max(0, 8 - (s.items?.length || 0)) },
    () => `<tr class="filler"><td colspan="${columns.length}">&nbsp;</td></tr>`
  ).join('')

  const totalGross = (s.items || []).reduce((a: number, i: any) => a + (Number(i.gross_wt) || 0), 0)
  const totalNet = (s.items || []).reduce((a: number, i: any) => a + (Number(i.net_wt) || 0), 0)
  const totalQty = (s.items || []).reduce((a: number, i: any) => a + (Number(i.qty) || 0), 0)

  // Build the total row cell-by-cell so it lines up with whatever columns are on.
  const totalCells = columns.map((col) => {
    if (col.k === 'qty') return `<td class="r">${totalQty ? money(totalQty, 0) : ''}</td>`
    if (col.k === 'gross') return `<td class="r">${wt(totalGross)}</td>`
    if (col.k === 'net') return `<td class="r">${wt(totalNet)}</td>`
    if (col.k === 'amt') return `<td class="r">${money(s.goods_amount)}</td>`
    if (col.k === 'name') return `<td class="r">Total</td>`
    return '<td></td>'
  }).join('')

  const urdBlock = cfg.showUrd && (s.urds || []).length
    ? `<div class="urd">
         <div class="urd-title">Old Gold Received</div>
         <table class="urd-tbl">
           <tr><th>Description</th><th class="r">Gross</th><th class="r">Net</th><th class="r">Purity</th><th class="r">Fine</th><th class="r">Rate</th><th class="r">Amount</th></tr>
           ${(s.urds || []).map((u: any) => `<tr>
                 <td>${esc(u.name)}${u.description ? ` — ${esc(u.description)}` : ''}</td>
                 <td class="r">${wt(u.gross_wt)}</td><td class="r">${wt(u.net_wt)}</td>
                 <td class="r">${money(u.purity)}</td><td class="r">${wt(u.final_wt)}</td>
                 <td class="r">${money(u.rate)}</td><td class="r">${money(u.amount)}</td>
               </tr>`).join('')}
         </table>
       </div>`
    : ''

  const line = (k: string, v: string, cls = '') =>
    `<tr class="${cls}"><td class="k">${k}</td><td class="v">${v}</td></tr>`

  return `<!doctype html>
<meta charset="utf-8">
<title>Invoice ${esc(s.bill_no)}</title>
<style>
  @page { size: A4; margin: 10mm; }
  * { box-sizing: border-box; }
  body { font-family: "Segoe UI", Arial, sans-serif; font-size: 10.5px; color: #000;
    margin: 0; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .sheet { border: 1px solid #000; }
  .hd { text-align: center; padding: 6px 8px 4px; break-inside: avoid; }
  .shop-logo { display: block; width: 32mm; max-width: 100%; height: auto;
    object-fit: contain; margin: 2mm auto; break-inside: avoid; }
  .co { font-size: 20px; font-weight: 700; letter-spacing: .3px; color: ${esc(cfg.accent)}; }
  .co-sub { font-size: 10px; margin-top: 1px; }
  .ti { font-weight: 700; text-decoration: underline; font-size: 12px; margin-top: 3px; }
  .meta { display: flex; border-top: 1px solid #000; border-bottom: 1px solid #000; }
  .meta > div { padding: 5px 8px; }
  .meta .l { flex: 1.6; border-right: 1px solid #000; }
  .meta .r2 { flex: 1; }
  .meta b { display: inline-block; min-width: 62px; }
  table.items { width: 100%; border-collapse: collapse; }
  table.items th { border-bottom: 1px solid #000; border-right: 1px solid #000;
    padding: 3px 4px; font-size: 9.5px; background: ${esc(cfg.accent)}22; }
  table.items td { border-right: 1px solid #000; padding: 3px 4px; }
  table.items th:last-child, table.items td:last-child { border-right: 0; }
  table.items tr.filler td { height: 15px; border-right: 0; }
  .tot-row td { border-top: 1px solid #000; font-weight: 700; }
  .c { text-align: center; } .r { text-align: right; } .small { font-size: 9px; }
  .tag { color: #555; font-size: 9px; }
  .split { display: flex; border-top: 1px solid #000; }
  .split .left { flex: 1.35; border-right: 1px solid #000; padding: 5px 8px; }
  .split .right { flex: 1; }
  .words { margin-bottom: 6px; }
  table.tot { width: 100%; border-collapse: collapse; }
  table.tot td { padding: 2.5px 8px; }
  table.tot td.k { text-align: right; }
  table.tot td.v { text-align: right; width: 90px; font-weight: 600; border-left: 1px solid #000; }
  table.tot tr.grand td { border-top: 1px solid #000; font-weight: 700; font-size: 11.5px; }
  table.tot tr.bal td { border-top: 1px solid #000; font-weight: 700; font-size: 12px;
    background: ${esc(cfg.accent)}33; }
  .pay { display: flex; gap: 14px; margin-bottom: 6px; font-size: 10px; }
  .bank { border: 1px solid #000; padding: 4px 6px; font-size: 9.5px; line-height: 1.5; }
  .decl { font-size: 7.5px; line-height: 1.35; padding: 4px 8px; border-top: 1px solid #000; text-align: justify; }
  .sign { display: flex; border-top: 1px solid #000; font-size: 10px; }
  .sign > div { padding: 6px 8px; flex: 1; }
  .sign .s1, .sign .s2 { border-right: 1px solid #000; }
  .sign .s3 { text-align: right; font-weight: 600; }
  .note { padding: 4px 8px; border-top: 1px solid #000; font-size: 9.5px; text-align: center; }
  .urd { border-top: 1px solid #000; padding: 4px 8px; }
  .urd-title { font-weight: 700; font-size: 9.5px; margin-bottom: 2px; }
  .urd-tbl { width: 100%; border-collapse: collapse; font-size: 9.5px; }
  .urd-tbl th, .urd-tbl td { border: 1px solid #999; padding: 2px 4px; }
</style>
<div class="sheet">
  <div class="hd">
    ${cfg.showLogo ? `<img class="shop-logo" src="${shopLogo}" alt="Parivar Jewellers">` : ''}
    <div class="co">${esc(c?.name || 'Demo')}</div>
    ${c?.address ? `<div class="co-sub">${esc(c.address)}</div>` : ''}
    <div class="co-sub">Contact No.: ${esc(c?.phone || '')} ${c?.gstin ? `&nbsp;&nbsp; GST No: ${esc(c.gstin)}` : ''}</div>
    <div class="ti">${esc(cfg.title)}</div>
  </div>

  <div class="meta">
    <div class="l">
      <div><b>Name</b>: ${esc(s.party_name || 'Cash Customer')}</div>
      <div><b>Address</b>: ${esc(s.address || p?.address || '')}</div>
      <div><b>Phone</b>: ${esc(s.mobile || p?.mobile || '')}</div>
      <div><b>GST No</b>: ${esc(p?.gstin || '')}</div>
    </div>
    <div class="r2">
      <div><b>Bill No</b>: ${esc(s.bill_no)}</div>
      <div><b>Date</b>: ${dmy(s.bill_date)}</div>
      <div><b>Payment</b>: ${s.is_credit ? 'CREDIT' : 'CASH'}</div>
      ${s.manual_no ? `<div><b>Manual No</b>: ${esc(s.manual_no)}</div>` : ''}
    </div>
  </div>

  <table class="items">
    <thead><tr>${head}</tr></thead>
    <tbody>${rows}${filler}<tr class="tot-row">${totalCells}</tr></tbody>
  </table>

  ${urdBlock}

  <div class="split">
    <div class="left">
      <div class="words"><b>Amount In Words:</b> ${esc(amount_in_words)}</div>
      <div class="pay">
        <span>By Cheque: ${s.payment_mode === 'Cheque' ? money(s.amount_received) : '0'}</span>
        <span>By NEFT: ${s.payment_mode === 'NEFT' ? money(s.amount_received) : '0'}</span>
        <span>By Card/UPI: ${s.payment_mode === 'UPI' || s.payment_mode === 'Card' ? money(s.amount_received) : '0'}</span>
      </div>
      ${cfg.showBank ? `<div class="bank">
        <b>Bank Details:</b><br>
        Bank Name: ${esc(c?.bank_name || '')} &nbsp;&nbsp; Account No: ${esc(c?.account_no || '')}<br>
        Branch: ${esc(c?.branch || '')} &nbsp;&nbsp; IFSC Code: ${esc(c?.ifsc || '')}
      </div>` : ''}
    </div>
    <div class="right">
      <table class="tot">
        ${line('Making Amt:', money(s.making_amount))}
        ${line('Basic Amt:', money(s.bill_amount))}
        ${Number(s.gst_amount) ? line(`CGST ${halfPct}%:`, money(gstHalf)) : ''}
        ${Number(s.gst_amount) ? line(`SGST ${halfPct}%:`, money(gstHalf)) : ''}
        ${line('Discount:', money(Number(s.bill_discount) + Number(s.making_discount)))}
        ${line('Other Amount:', money(s.other_amount))}
        ${Number(s.tcs_amount) ? line('TCS:', money(s.tcs_amount)) : ''}
        ${line('Total Amount:', money(s.total_amount), 'grand')}
        ${line('Old Purchase Amt:', money(s.urd_amount))}
        ${line('Cash Received:', money(s.amount_received))}
        ${line('Balance:', money(s.net_balance), 'bal')}
        ${pendingWt ? line('Gold Pending (g):', wt3(pendingWt), 'bal') : ''}
      </table>
    </div>
  </div>

  ${cfg.showDeclaration && c?.declaration ? `<div class="decl">${esc(c.declaration)}</div>` : ''}
  ${cfg.footerNote ? `<div class="note">${esc(cfg.footerNote)}</div>` : ''}

  ${cfg.showSignature ? `<div class="sign">
    <div class="s1">Customer Sign</div>
    <div class="s2">${cfg.showPendingBalance ? `Pending Balance: ${money(pending_balance)}` : ''}</div>
    <div class="s3">For ${esc(c?.name || 'Demo')}</div>
  </div>` : ''}
</div>`
}

/** 3-inch thermal receipt — for counter estimates and quick bills. */
function thermalHtml(data: any, cfg: InvoiceConfig) {
  const { company: c, sale: s, amount_in_words } = data
  const pendingWt = pendingMetal(s)
  const row = (k: string, v: string, b = false) =>
    `<div class="l${b ? ' b' : ''}"><span>${k}</span><span>${v}</span></div>`

  return `<!doctype html>
<meta charset="utf-8">
<title>${esc(s.bill_no)}</title>
<style>
  @page { size: auto; margin: 3mm; }
  * { box-sizing: border-box; }
  body { font-family: "Segoe UI", Arial, sans-serif; font-size: 11px; width: 72mm;
    max-width: 100%; margin: 0; color: #000; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .receipt-header { break-inside: avoid; }
  .shop-logo { display: block; width: 32mm; max-width: 100%; height: auto;
    object-fit: contain; margin: 2mm auto; break-inside: avoid; }
  .ct { text-align: center; }
  .co { font-size: 15px; font-weight: 700; }
  .ti { font-weight: 700; margin: 3px 0; }
  hr { border: 0; border-top: 1px dashed #000; margin: 5px 0; }
  .l { display: flex; justify-content: space-between; gap: 8px; padding: 1px 0; }
  .l.b { font-weight: 700; font-size: 12.5px; }
  .it { padding: 2px 0; border-bottom: 1px dotted #999; }
  .it .n { font-weight: 600; }
  .it .d { display: flex; justify-content: space-between; font-size: 10px; color: #333; }
  .w { font-size: 10px; margin-top: 4px; }
</style>
<div class="ct receipt-header">
  ${cfg.showLogo ? `<img class="shop-logo" src="${shopLogo}" alt="Parivar Jewellers">` : ''}
  <div class="co">${esc(c?.name || 'Demo')}</div>
  ${c?.address ? `<div style="font-size:10px">${esc(c.address)}</div>` : ''}
  ${c?.phone ? `<div style="font-size:10px">Ph: ${esc(c.phone)}</div>` : ''}
  <div class="ti">${esc(cfg.title)}</div>
</div>
<hr>
${row('Bill No', esc(s.bill_no))}
${row('Date', dmy(s.bill_date))}
${row('Customer', esc(s.party_name || 'Cash'))}
<hr>
${(s.items || []).map((it: any) => `
  <div class="it">
    <div class="n">${esc(it.item_name)}${it.tag ? ` (${esc(it.tag)})` : ''}</div>
    <div class="d"><span>${wt(it.net_wt)} g × ${money(it.rate_per_gm)}</span><span>${money(it.total_amount)}</span></div>
    ${Number(it.mkg_amount) ? `<div class="d"><span>Making</span><span>${money(it.mkg_amount)}</span></div>` : ''}
  </div>`).join('')}
<hr>
${row('Basic', money(s.bill_amount))}
${Number(s.gst_amount) ? row(`GST ${s.gst_pct}%`, money(s.gst_amount)) : ''}
${row('Total', money(s.total_amount), true)}
${Number(s.urd_amount) ? row('Less Old Gold', `-${money(s.urd_amount)}`) : ''}
${Number(s.amount_received) ? row('Received', money(s.amount_received)) : ''}
${row('Balance', money(s.net_balance), true)}
${pendingWt ? row('Gold Pending (g)', wt3(pendingWt), true) : ''}
<hr>
<div class="w">${esc(amount_in_words)}</div>
${cfg.footerNote ? `<div class="ct" style="margin-top:6px">${esc(cfg.footerNote)}</div>` : ''}
<div class="ct" style="margin-top:6px">Thank you — visit again</div>`
}
