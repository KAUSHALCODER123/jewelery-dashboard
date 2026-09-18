import { invoiceHtml, loadConfig, type InvoiceConfig } from '../print/invoice'
import { urdBillHtml } from '../print/urd'

/** Read the saved invoice template settings. */
export async function getInvoiceConfig(): Promise<InvoiceConfig> {
  const s = await window.api.settings.all()
  return loadConfig(s.invoice_config)
}

export async function buildInvoice(saleId: number) {
  const [data, cfg] = await Promise.all([
    window.api.sale.forPrint({ id: saleId }),
    getInvoiceConfig(),
  ])
  if (!data) return null
  return { data, cfg, html: invoiceHtml(data, cfg) }
}

export async function printInvoice(saleId: number) {
  const b = await buildInvoice(saleId)
  if (!b) return
  await window.api.print.html({ html: b.html })
}

export async function pdfInvoice(saleId: number) {
  const b = await buildInvoice(saleId)
  if (!b) return
  await window.api.print.pdf({
    html: b.html,
    suggestedName: `${b.data.sale.bill_no}.pdf`,
  })
}

/** The old gold purchase bill — same template settings as the invoice. */
export async function buildUrdBill(id: number) {
  const [data, cfg] = await Promise.all([window.api.urd.forPrint({ id }), getInvoiceConfig()])
  if (!data) return null
  return { data, cfg, html: urdBillHtml(data, cfg) }
}

export async function printUrdBill(id: number) {
  const b = await buildUrdBill(id)
  if (!b) return
  await window.api.print.html({ html: b.html })
}

export async function pdfUrdBill(id: number) {
  const b = await buildUrdBill(id)
  if (!b) return
  await window.api.print.pdf({ html: b.html, suggestedName: `${b.data.bill.bill_no}.pdf` })
}

/** Plain-text bill summary for WhatsApp / SMS. */
export function billMessage(data: any) {
  const s = data.sale
  const c = data.company
  const n = (v: any) => (Number(v) || 0).toFixed(2)
  const lines = [
    `*${c?.name || 'Invoice'}*`,
    `Bill ${s.bill_no} — ${s.bill_date}`,
    '',
    ...(s.items || []).map((it: any) => `${it.item_name} — ${n(it.net_wt)}g — Rs.${n(it.total_amount)}`),
    '',
    `Bill Amount: Rs.${n(s.bill_amount)}`,
    ...(Number(s.gst_amount) ? [`GST: Rs.${n(s.gst_amount)}`] : []),
    `Total: Rs.${n(s.total_amount)}`,
    ...(Number(s.urd_amount) ? [`Less Old Gold: Rs.${n(s.urd_amount)}`] : []),
    ...(Number(s.amount_received) ? [`Received: Rs.${n(s.amount_received)}`] : []),
    `*Balance: Rs.${n(s.net_balance)}*`,
    '',
    'Thank you for your business.',
  ]
  return lines.join('\n')
}
