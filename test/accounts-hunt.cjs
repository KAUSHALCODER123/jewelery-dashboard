/**
 * The books have to balance whatever document produced them. Each section here
 * is a document that used to leave the trial balance out, or a way to lose
 * money on an edit, found in a bug hunt across the money side of the app.
 *    npx electron ./test/accounts-hunt.cjs
 */
const { app } = require('electron')
const path = require('node:path')
const fs = require('node:fs')
const os = require('node:os')

const DAY = '2026-07-21'

let pass = 0
let fail = 0

function check(label, actual, expected, tol = 0.005) {
  const ok =
    typeof expected === 'number'
      ? Math.abs(Number(actual) - expected) <= tol
      : String(actual) === String(expected)
  if (ok) { pass++; console.log(`  PASS  ${label} = ${actual}`) }
  else { fail++; console.log(`  FAIL  ${label}: got ${actual}, expected ${expected}`) }
}
function throws(label, fn, match) {
  try { fn(); fail++; console.log(`  FAIL  ${label}: expected a refusal, none came`) }
  catch (e) {
    if (match && !match.test(e.message)) {
      fail++; console.log(`  FAIL  ${label}: wrong message — ${e.message}`)
    } else { pass++; console.log(`  PASS  ${label} — ${e.message}`) }
  }
}
const head = (t) => console.log(`\n── ${t} ${'─'.repeat(Math.max(0, 46 - t.length))}`)

app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'parivar-run-')))

app.whenReady().then(() => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'parivar-acct-'))
  const db = require('../electron/db.cjs')
  db.open(tmp)
  const api = require('../electron/api.cjs')

  const grp = api.itemGroup.list().find((x) => x.name === '22K Gold')
  const itemId = api.item.save({
    name: 'Ring', item_type_id: grp.item_type_id, item_group_id: grp.id, design_id: null,
    weight_mode: 'WEIGHT', uom: 'GRAM', hsn: '7113', image: '',
  })
  const cust = api.party.save({
    name: 'Buyer', party_type: 'CUSTOMER', state: 'Maharashtra', loyalty_enabled: 1, metals: [],
  })
  const sup = api.party.save({ name: 'Supplier', party_type: 'SUPPLIER', state: 'Maharashtra', metals: [] })

  const tb = () => api.reports.trialBalance({}).difference
  const tag = () => {
    api.tagStock.saveBatch({ itemId, rows: [{ gross_wt: 10, purity: 91.6, entry_date: DAY }] })
    return api.tagStock.list({ status: 'IN_STOCK' }).sort((a, b) => b.id - a.id)[0]
  }
  const saleHead = (extra = {}) => ({
    prefix: 'Service', bill_date: DAY, party_id: cust, party_name: 'Buyer', state: 'Maharashtra',
    is_credit: 0, payment_mode: 'Cash', gst_pct: 3, bill_discount: 0, making_discount: 0,
    other_amount: 0, manual_urd_amount: 0, tcs_pct: 0, amount_received: 0, ...extra,
  })
  // 10 g @ 5000 + 500/g making = 55,000 + 3% = 56,650.
  const line = (t) => ({
    tag: t.tag, tag_stock_id: t.id, item_id: itemId, item_name: 'Ring', hsn: '7113', qty: 0,
    gross_wt: 10, purity: 91.6, stone_wt: 0, net_wt: 10, rate_per_gm: 5000, mkg_per_gm: 500,
    hallmark_charges: 0,
  })
  const sell = (extra = {}) => api.sale.save({ head: saleHead(extra), items: [line(tag())] })

  try {
    head('1. A counter bill cannot leave money on nobody')
    // Received left blank on a cash counter bill: taken as paid at the counter.
    const blank = sell({ party_id: null, party_name: '' })
    const bs = api.sale.read({ id: blank.id })
    check('blank received is taken as paid in full', bs.amount_received, 56650)
    check('so nothing is left open', bs.net_balance, 0)
    check('and the cash reached the cash book',
      api.reports.cashBook({ from: DAY, to: DAY }).totalDebit, 56650)
    check('trial balance foots', tb(), 0)
    throws('a SHORT amount typed on a walk-in bill is refused',
      () => sell({ party_id: null, party_name: '', amount_received: 30000 }), /unsettled/)
    throws('a credit bill with no customer is refused',
      () => sell({ party_id: null, party_name: '', is_credit: 1 }), /unsettled/)
    check('and nothing reached the books', tb(), 0)
    const walk = sell({ party_id: null, party_name: '', amount_received: 56650 })
    check('a walk-in bill paid in full saves', !!walk.id, true)
    check('trial balance still foots', tb(), 0)

    head('2. A walk-in return must be refunded in full')
    const w = api.sale.read({ id: walk.id })
    throws('return with no customer and no refund is refused', () => api.saleReturn.save({
      head: { return_date: DAY, party_id: null, against_sale_id: walk.id, gst_pct: 3, refund_amount: 0 },
      items: [{ tag_stock_id: w.items[0].tag_stock_id, item_id: itemId, gross_wt: 10, net_wt: 10,
                purity: 91.6, rate_per_gm: 5000, mkg_per_gm: 500 }],
    }), /customer/)
    check('trial balance still foots', tb(), 0)

    head('3. Card fee, loyalty points: both reach the books')
    const bank = api.account.list().find((a) => a.name === 'Bank Account')
    api.account.save({ ...bank, acc_group: 'Bank Accounts', is_card_swap: 1,
      card_pct_customer: 1, card_pct_shop: 1 })
    const card = sell({ payment_mode: 'Card' })
    check('customer pays a 1% card fee', api.sale.read({ id: card.id }).card_charge_customer, 566.5)
    check('trial balance foots after a card bill', tb(), 0)
    check('the fee the customer paid is income',
      api.reports.profitAndLoss({}).trading.cr.find((r) => r.name === 'Other Charges')?.amount, 566.5)
    // The member has earned points on the bills above; spend 100 of them.
    const pts = sell({ loyalty_redeem: 100 })
    check('100 points came off', api.sale.read({ id: pts.id }).loyalty_discount, 100)
    check('trial balance foots after a loyalty redemption', tb(), 0)

    head('4. A receipt against an income or liability head')
    const inc = api.account.save({ name: 'Commission', acc_type: 'Income' })
    const pl0 = api.reports.profitAndLoss({}).netProfit
    api.voucher.save({ kind: 'RECEIPT', account_id: inc, amount: 1000, voucher_date: DAY })
    check('trial balance foots after commission received', tb(), 0)
    check('the commission is profit', api.reports.profitAndLoss({}).netProfit - pl0, 1000)
    const loan = api.account.save({ name: 'Bank Loan', acc_type: 'Liability' })
    api.voucher.save({ kind: 'RECEIPT', account_id: loan, amount: 50000, voucher_date: DAY })
    check('trial balance foots after a loan is taken', tb(), 0)
    check('the loan is on the trial balance',
      api.reports.trialBalance({}).cr.find((r) => r.name === 'Bank Loan')?.amount, 50000)
    check('and is a liability on the balance sheet',
      api.reports.balanceSheet({}).liabilities.find((r) => r.name === 'Bank Loan')?.amount, 50000)

    head('5. Re-saving a bill does not grow its making discount')
    const m = sell({ making_disc_pct: 10, making_discount: 100 })
    let r = api.sale.read({ id: m.id })
    check('first save: 100 + 10% of 5,000 making', r.making_discount, 600)
    check('the typed rupee figure is kept apart', r.making_disc_rs, 100)
    const total0 = r.total_amount
    // What the invoice screen does on re-open: the typed figure goes back in the box.
    for (let i = 0; i < 3; i++) {
      api.sale.save({
        head: { ...r, making_discount: r.making_disc_rs, loyalty_redeem: r.loyalty_redeemed },
        items: r.items, urds: r.urds, metals: r.metals, payments: r.payments,
      })
      r = api.sale.read({ id: m.id })
    }
    check('after three re-saves the discount is unchanged', r.making_discount, 600)
    check('and so is the bill', r.total_amount, total0)

    head('6. Purchases: every part of the bill has a home')
    api.purchase.save({ head: { prefix: 'MI', invoice_date: DAY, party_id: sup, party_name: 'Supplier',
      is_credit: 1, gst_pct: 0, paid_amount: 0, paid_fine_wt: 5, paid_fine_rate: 6000 },
      items: [{ item_name: 'Bar', gross_wt: 10, net_wt: 10, purity: 99.5, rate: 6000, wastage_pct: 0 }] })
    check('paid partly in fine metal', tb(), 0)
    const ex = api.purchase.save({ head: { prefix: 'MI', invoice_date: DAY, party_id: sup,
      party_name: 'Supplier', is_credit: 1, gst_pct: 0, paid_amount: 0 },
      items: [{ direction: 'IN', item_name: 'Orn', gross_wt: 100, net_wt: 100, purity: 91.6, rate: 6000 },
              { direction: 'OUT', item_name: 'Bar', gross_wt: 95, net_wt: 95, purity: 99.5, rate: 6000 }] })
    check('metal-for-metal exchange', tb(), 0)
    api.purchase.save({ head: { prefix: 'MI', invoice_date: DAY, party_id: sup, party_name: 'Supplier',
      is_credit: 1, gst_pct: 3, tcs_pct: 0.1, discount: 500, paid_amount: 0 },
      items: [{ item_name: 'Chain', qty: 2, gross_wt: 20, net_wt: 20, purity: 91.6, rate: 6000,
                hallmark_charges: 45 }] })
    check('discount, hallmarking and TCS on a purchase', tb(), 0)
    throws('a purchase with no supplier and a balance is refused', () => api.purchase.save({
      head: { prefix: 'MI', invoice_date: DAY, party_id: null, is_credit: 1, gst_pct: 3, paid_amount: 0 },
      items: [{ item_name: 'Bar', gross_wt: 1, net_wt: 1, purity: 99.5, rate: 6000 }] }), /supplier/)
    const xr = api.purchase.read({ id: ex.id })
    const reg = api.reports.register({ book: 'PURCHASE', from: DAY, to: DAY })
      .rows.find((x) => x.doc_no === xr.invoice_no)
    check('purchase register taxable is net of the metal handed back', reg.taxable, xr.bill_amount)

    head('7. Stock settlement both ways, refining with GST')
    api.stockSettlement.save({ settle_date: DAY, party_id: sup, party_name: 'Supplier', metal: 'Gold',
      direction: 'OUT', fine_wt: 1, rate_per_gm: 5000, gst_pct: 0, paid_amount: 0 })
    check('settlement OUT (we pay rupees for metal owed)', tb(), 0)
    api.stockSettlement.save({ settle_date: DAY, party_id: sup, party_name: 'Supplier', metal: 'Gold',
      direction: 'IN', fine_wt: 1, rate_per_gm: 5000, gst_pct: 3, paid_amount: 1000 })
    check('settlement IN (they pay rupees for metal owed)', tb(), 0)
    api.refinery.save({ head: { invoice_date: DAY, party_id: sup, party_name: 'Supplier',
      direction: 'IN', metal: 'Gold', gst_pct: 18, paid_amount: 100 },
      items: [{ item_name: 'Pure', gross_wt: 10, net_wt: 10, purity: 99.5, rate_per_gm: 50 }] })
    check('refining charges with GST', tb(), 0)
    const kar = api.party.save({ name: 'Ramesh', party_type: 'KARAGIR', state: 'Maharashtra', metals: [] })
    api.karagir.receive({ receive_date: DAY, karagir_id: kar, karagir_name: 'Ramesh', item_name: 'Ring',
      gross_wt: 10, net_wt: 10, purity: 91.6, wastage_pct: 0, rate_per_gm: 300, discount: 200,
      tds_pct: 1, paid_amount: 500 })
    check('karagir labour with a discount and TDS', tb(), 0)
    throws('a scheme instalment cannot be negative', () => {
      const s2 = api.gss.saveScheme({ name: 'Neg', scheme_type: 'On Amount', period_unit: 'Months',
        total_periods: 2, paying_periods: 1, monthly_amount: 1000 })
      const a2 = api.gss.assign({ scheme_id: s2, party_id: cust, start_date: DAY })
      api.gss.receive({ receipt_id: api.gss.readAccount({ id: a2.id }).receipts[0].id,
        amount: -1000, received_date: DAY })
    }, /amount/)
    throws('a voucher with neither party nor head is refused',
      () => api.voucher.save({ kind: 'RECEIPT', amount: 100, voucher_date: DAY }), /party or an account/)

    head('8. A redeemed scheme instalment cannot be un-received')
    const sc = api.gss.saveScheme({ name: 'Eleven', scheme_type: 'On Amount', period_unit: 'Months',
      total_periods: 3, paying_periods: 2, monthly_amount: 2000 })
    const ac = api.gss.assign({ scheme_id: sc, party_id: cust, start_date: '2026-01-01' })
    const rcpts = api.gss.readAccount({ id: ac.id }).receipts
    for (const x of rcpts.slice(0, 2)) api.gss.receive({ receipt_id: x.id, received_date: '2026-02-01' })
    const g = sell({ gss_id: ac.id })
    check('the bill spent the scheme', api.sale.read({ id: g.id }).gss_amount, 4000)
    throws('un-receiving a spent instalment is refused',
      () => api.gss.unreceive({ receipt_id: rcpts[0].id }), /redeemed/)
    throws('deleting a redeemed account is refused',
      () => api.gss.removeAccount({ id: ac.id }), /redeemed/)
    check('the balance never went negative', api.gss.balance({ id: ac.id, as_of: DAY }).balance_amount, 0)
    api.sale.remove({ id: g.id })
    api.gss.unreceive({ receipt_id: rcpts[0].id })
    check('once the bill is gone the instalment can be undone',
      api.gss.balance({ id: ac.id, as_of: DAY }).balance_amount, 2000)
    check('trial balance foots', tb(), 0)

    head('9. GST returns carry the discounted taxable value')
    const d = sell({ bill_discount: 1000, making_discount: 500 })
    const ds = api.sale.read({ id: d.id })
    const taxable = 55000 - 1500
    check('the bill charged GST on 53,500', ds.gst_amount, taxable * 0.03)
    const g1 = api.reports.gstReturn({ direction: 'OUT', from: DAY, to: DAY })
      .rows.find((x) => x.doc_no === ds.bill_no)
    check('GSTR-1 taxable value', g1.taxable, taxable)
    check('sales register taxable value', api.reports.register({ book: 'SALES', from: DAY, to: DAY })
      .rows.find((x) => x.doc_no === ds.bill_no).taxable, taxable)
    check('B2B register taxable value', api.reports.gstRegister({ from: DAY, to: DAY })
      .find((x) => x.invoice_no === ds.bill_no).taxable_value, taxable)
    const hsn = api.reports.hsnSummary({ from: DAY, to: DAY }).totals
    const out = api.reports.gstReturn({ direction: 'OUT', from: DAY, to: DAY }).totals
    check('HSN summary taxable agrees with GSTR-1', hsn.taxable, out.taxable, 0.05)
    check('HSN summary tax agrees with GSTR-1', hsn.tax, out.gst, 0.05)
    check('trial balance foots at the end', tb(), 0)

    head('10. A document with a return under it says so when deleted')
    const rs = sell({ is_credit: 1 })
    const rsl = api.sale.read({ id: rs.id }).items[0]
    api.saleReturn.save({ head: { return_date: DAY, party_id: cust, party_name: 'Buyer',
      against_sale_id: rs.id, gst_pct: 3, refund_amount: 0 },
      items: [{ tag_stock_id: rsl.tag_stock_id, item_id: itemId, gross_wt: 10, net_wt: 10,
                purity: 91.6, rate_per_gm: 5000, mkg_per_gm: 500 }] })
    throws('deleting a bill with a return names the return',
      () => api.sale.remove({ id: rs.id }), /Delete the return first/)
    const pu = api.purchase.save({ head: { prefix: 'MI', invoice_date: DAY, party_id: sup,
      party_name: 'Supplier', is_credit: 1, gst_pct: 0, paid_amount: 0 },
      items: [{ item_name: 'Bar', gross_wt: 10, net_wt: 10, purity: 100, rate: 5000 }] })
    api.purchaseReturn.save({ head: { return_date: DAY, party_id: sup, party_name: 'Supplier',
      against_purchase_id: pu.id, gst_pct: 0, received_amount: 0 },
      items: [{ item_name: 'Bar', gross_wt: 2, net_wt: 2, purity: 100, rate_per_gm: 5000 }] })
    throws('deleting a purchase with a return names the return',
      () => api.purchase.remove({ id: pu.id }), /Delete the return first/)
    check('trial balance foots', tb(), 0)

    head('11. Staff cannot delete money documents or rewrite shop settings')
    const main = fs.readFileSync(path.join(__dirname, '..', 'electron', 'main.cjs'), 'utf8')
    for (const ch of ['saleReturn:remove', 'purchaseReturn:remove', 'karagir:removeIssue',
      'karagir:removeReceive', 'stockSettlement:remove', 'stockTransfer:remove',
      'branch:remove', 'gss:unreceive']) {
      check(`${ch} is owner-only`, new RegExp(`'${ch}':\\s*'permanent_delete'`).test(main), true)
    }
    check('settings:set is gated by key', /channel === 'settings:set'/.test(main), true)
  } catch (e) {
    fail++
    console.log('  FAIL  unexpected error:', e.stack)
  }

  console.log(`\n${pass} passed, ${fail} failed`)
  db.close?.()
  app.exit(fail ? 1 : 0)
})
