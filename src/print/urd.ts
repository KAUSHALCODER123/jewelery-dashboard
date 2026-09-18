import { money, wt, dmy } from '../lib/format'
import { DEFAULT_INVOICE_CONFIG, type InvoiceConfig } from './invoice'

const esc = (s: any) =>
  String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!))

/**
 * A4 old gold purchase bill — the paper the customer takes home when they sell
 * old jewellery with nothing bought against it. Same frame as the sales
 * invoice (shop head, party block, one lined table, totals on the right, the
 * signature strip) so the two look like they came from the same counter; the
 * table is the old-gold table, and the money reads the other way round: what
 * the shop owes, what it paid, what it still owes.
 */
export function urdBillHtml(data: any, cfgIn?: Partial<InvoiceConfig>) {
  const cfg: InvoiceConfig = { ...DEFAULT_INVOICE_CONFIG, ...(cfgIn || {}) }
  const { company: c, bill: b, party: p, pending_balance, amount_in_words } = data
  const lines: any[] = b.urds || []

  const rows = lines.map((u, i) => `<tr>
      <td class="c">${i + 1}</td>
      <td>${esc(u.name)}${u.description ? ` <span class="tag">${esc(u.description)}</span>` : ''}</td>
      <td class="r">${wt(u.gross_wt)}</td>
      <td class="r">${wt(u.net_wt)}</td>
      <td class="r">${money(u.purity)}</td>
      <td class="r">${wt(u.final_wt)}</td>
      <td class="r">${money(u.rate)}</td>
      <td class="r">${money(u.amount)}</td>
    </tr>`).join('')
  const filler = Array.from(
    { length: Math.max(0, 6 - lines.length) },
    () => '<tr class="filler"><td colspan="8">&nbsp;</td></tr>'
  ).join('')
  const sum = (k: string) => lines.reduce((a, u) => a + (Number(u[k]) || 0), 0)

  const line = (k: string, v: string, cls = '') =>
    `<tr class="${cls}"><td class="k">${k}</td><td class="v">${v}</td></tr>`

  return `<!doctype html>
<meta charset="utf-8">
<title>Old Gold ${esc(b.bill_no)}</title>
<style>
  @page { size: A4; margin: 10mm; }
  * { box-sizing: border-box; }
  body { font-family: "Segoe UI", Arial, sans-serif; font-size: 10.5px; color: #000;
    margin: 0; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .sheet { border: 1px solid #000; }
  .hd { text-align: center; padding: 6px 8px 4px; }
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
  .c { text-align: center; } .r { text-align: right; }
  .tag { color: #555; font-size: 9px; }
  .split { display: flex; border-top: 1px solid #000; }
  .split .left { flex: 1.35; border-right: 1px solid #000; padding: 5px 8px; }
  .split .right { flex: 1; }
  .words { margin-bottom: 6px; }
  .narr { font-size: 9.5px; color: #333; }
  table.tot { width: 100%; border-collapse: collapse; }
  table.tot td { padding: 2.5px 8px; }
  table.tot td.k { text-align: right; }
  table.tot td.v { text-align: right; width: 90px; font-weight: 600; border-left: 1px solid #000; }
  table.tot tr.grand td { border-top: 1px solid #000; font-weight: 700; font-size: 11.5px; }
  table.tot tr.bal td { border-top: 1px solid #000; font-weight: 700; font-size: 12px;
    background: ${esc(cfg.accent)}33; }
  .decl { font-size: 7.5px; line-height: 1.35; padding: 4px 8px; border-top: 1px solid #000; text-align: justify; }
  .sign { display: flex; border-top: 1px solid #000; font-size: 10px; }
  .sign > div { padding: 6px 8px; flex: 1; }
  .sign .s1, .sign .s2 { border-right: 1px solid #000; }
  .sign .s3 { text-align: right; font-weight: 600; }
  .note { padding: 4px 8px; border-top: 1px solid #000; font-size: 9.5px; text-align: center; }
</style>
<div class="sheet">
  <div class="hd">
    ${cfg.showLogo ? `<div class="co">${esc(c?.name || 'Demo')}</div>` : ''}
    ${c?.address ? `<div class="co-sub">${esc(c.address)}</div>` : ''}
    <div class="co-sub">Contact No.: ${esc(c?.phone || '')} ${c?.gstin ? `&nbsp;&nbsp; GST No: ${esc(c.gstin)}` : ''}</div>
    <div class="ti">OLD GOLD PURCHASE</div>
  </div>

  <div class="meta">
    <div class="l">
      <div><b>Name</b>: ${esc(b.party_name || 'Cash Customer')}</div>
      <div><b>Address</b>: ${esc(b.address || p?.address || '')}</div>
      <div><b>Phone</b>: ${esc(b.mobile || p?.mobile || '')}</div>
      ${b.by_hand ? `<div><b>By Hand</b>: ${esc(b.by_hand)}</div>` : ''}
    </div>
    <div class="r2">
      <div><b>Bill No</b>: ${esc(b.bill_no)}</div>
      <div><b>Date</b>: ${dmy(b.bill_date)}</div>
      <div><b>Paid By</b>: ${esc(b.payment_mode || 'Cash')}</div>
      ${b.manual_no ? `<div><b>Manual No</b>: ${esc(b.manual_no)}</div>` : ''}
    </div>
  </div>

  <table class="items">
    <thead><tr>
      <th style="width:22px">NO</th><th>Description</th>
      <th style="width:60px">Gr.Wt</th><th style="width:60px">Nt.Wt</th>
      <th style="width:48px">Purity</th><th style="width:60px">Fine Wt</th>
      <th style="width:64px">Rate/g</th><th style="width:76px">Amount</th>
    </tr></thead>
    <tbody>
      ${rows}${filler}
      <tr class="tot-row">
        <td></td><td class="r">Total</td>
        <td class="r">${wt(sum('gross_wt'))}</td><td class="r">${wt(sum('net_wt'))}</td>
        <td></td><td class="r">${wt(sum('final_wt'))}</td><td></td>
        <td class="r">${money(b.purchase_amount)}</td>
      </tr>
    </tbody>
  </table>

  <div class="split">
    <div class="left">
      <div class="words"><b>Amount In Words:</b> ${esc(amount_in_words)}</div>
      ${b.narration ? `<div class="narr">${esc(b.narration)}</div>` : ''}
      <div class="narr" style="margin-top:6px">
        The above old gold has been received from the customer and valued on its fine weight
        at the rate agreed on the day.
      </div>
    </div>
    <div class="right">
      <table class="tot">
        ${line('Old Gold Value:', money(b.purchase_amount))}
        ${Number(b.discount) ? line('Less Deduction:', money(b.discount)) : ''}
        ${Number(b.other_amount) ? line('Other Amount:', money(b.other_amount)) : ''}
        ${line('Payable to Customer:', money(b.total_amount), 'grand')}
        ${line('Paid Now:', money(b.amount_given))}
        ${line('Balance Due to Customer:', money(b.net_balance), 'bal')}
      </table>
    </div>
  </div>

  ${cfg.footerNote ? `<div class="note">${esc(cfg.footerNote)}</div>` : ''}

  ${cfg.showSignature ? `<div class="sign">
    <div class="s1">Customer Sign</div>
    <div class="s2">${cfg.showPendingBalance && p ? `Khata Balance: ${money(Math.abs(pending_balance))} ${pending_balance >= 0 ? 'Dr' : 'Cr'}` : ''}</div>
    <div class="s3">For ${esc(c?.name || 'Demo')}</div>
  </div>` : ''}
</div>`
}
