/**
 * The books around orders, schemes and returns — each section is a way the
 * day book, the cash book, the P&L or the shelf used to come out wrong:
 *   1. Old gold taken at an order booking, before the order is billed.
 *   2. An order advance in the Day Book — on the day it was paid, once.
 *   3. The balance paid on a bill that was made from an order.
 *   4. A Gold Saving Scheme maturity bonus.
 *   5. Removing a sales return, then deleting the bill it was made against.
 *   6. Deleting a bill that has a return against it.
 * Every section ends on the same invariants: the trial balance foots, the
 * customer's khata agrees with the documents, and the shelf count is right.
 *    npx electron ./test/books-orders.cjs
 */
const { app } = require('electron')
const path = require('node:path')
const fs = require('node:fs')
const os = require('node:os')

const BOOK = '2026-07-01'   // order booked, advance paid
const BILL = '2026-07-10'   // order billed
const PAID = '2026-07-15'   // balance paid, bill edited
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
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'parivar-bo-'))
  const db = require('../electron/db.cjs')
  db.open(tmp)
  const api = require('../electron/api.cjs')

  const grp = api.itemGroup.list().find((x) => x.name === '22K Gold')
  const itemId = api.item.save({
    name: 'Ring', item_type_id: grp.item_type_id, item_group_id: grp.id, design_id: null,
    weight_mode: 'WEIGHT', uom: 'GRAM', hsn: '7113', image: '',
  })
  const customer = (name) => api.party.save({
    name, party_type: 'CUSTOMER', state: 'Maharashtra', metals: [],
  })

  const tb = () => api.reports.trialBalance({}).difference
  const tbRow = (name) => {
    const t = api.reports.trialBalance({})
    const dr = t.dr.find((r) => r.name === name)
    const cr = t.cr.find((r) => r.name === name)
    return dr ? dr.amount : cr ? -cr.amount : 0
  }
  const khata = (id) => api.party.balance({ id }).balance
  const inStock = () => api.tagStock.list({ status: 'IN_STOCK' }).length
  const received = (d, mode = 'Cash') =>
    api.reports.dayBook({ from: d, to: d }).receivedBy.find((r) => r.mode === mode)?.amount || 0
  const cashIn = (d, account = 'Cash Account') =>
    api.reports.cashBook({ from: d, to: d, account }).totalDebit
  const plDr = (name) => {
    const p = api.reports.profitAndLoss({})
    return [...p.trading.dr, ...p.pl.dr].find((r) => r.name === name)?.amount || 0
  }
  /** What the customer owes by the documents: bills less money and returns. */
  const owedByDocs = (partyId) => {
    const bills = api.sale.list({}).filter((s) => s.party_id === partyId)
    const rets = api.saleReturn.list({}).filter((r) => r.party_id === partyId)
    return bills.reduce((s, b) => s + Number(b.net_balance), 0)
      - rets.reduce((s, r) => s + Number(r.total_amount) - Number(r.refund_amount), 0)
  }

  const tag = (d = DAY) => {
    api.tagStock.saveBatch({ itemId, rows: [{ gross_wt: 10, purity: 91.6, entry_date: d }] })
    return api.tagStock.list({ status: 'IN_STOCK' }).sort((a, b) => b.id - a.id)[0]
  }
  const saleHead = (extra = {}) => ({
    prefix: 'Service', bill_date: DAY, party_id: null, party_name: '', state: 'Maharashtra',
    is_credit: 0, payment_mode: 'Cash', gst_pct: 3, bill_discount: 0, making_discount: 0,
    other_amount: 0, manual_urd_amount: 0, tcs_pct: 0, ...extra,
  })
  // 10 g @ 5000 + 500/g making = 55,000 + 3% = 56,650.
  const line = (t) => ({
    tag: t.tag, tag_stock_id: t.id, item_id: itemId, item_name: 'Ring', hsn: '7113', qty: 0,
    gross_wt: 10, purity: 91.6, stone_wt: 0, net_wt: 10, rate_per_gm: 5000, mkg_per_gm: 500,
    hallmark_charges: 0,
  })
  const retLine = (t) => ({
    tag_stock_id: t.id, item_id: itemId, gross_wt: 10, net_wt: 10,
    purity: 91.6, rate_per_gm: 5000, mkg_per_gm: 500,
  })
  /** Re-save a bill as the invoice screen would, with some head fields changed. */
  const resave = (id, extra = {}, payments) => {
    const b = api.sale.read({ id })
    return api.sale.save({
      head: { ...b, ...extra, id },
      items: b.items.map((l) => ({ ...l })),
      urds: b.urds.map((u) => ({
        item_name: u.name, gross_wt: u.gross_wt, net_wt: u.net_wt, purity: u.purity, rate: u.rate,
      })),
      payments,
    })
  }

  try {
    // Runs first, on empty books, so the profit it checks is this order's alone.
    head('1. Old gold at an open order: cost and stock agree')
    const og = customer('Old Gold Order')
    const order1 = api.order.save({
      head: { prefix: 'NO', order_date: BOOK, party_id: og, party_name: 'Old Gold Order',
              advance_amount: 0 },
      items: [{ item_name: 'Bangle', qty: 0, gross_wt: 20, net_wt: 20, purity: 100,
                rate_per_gm: 5000, mkg_per_gm: 0 }],
      // 10 g pure @ 5000 = 50,000 handed over at booking.
      urds: [{ item_name: 'Old Gold', gross_wt: 10, net_wt: 10, purity: 100, rate: 5000 }],
    })
    check('the old gold is in closing stock',
      api.reports.profitAndLoss({}).trading.cr.find((r) => r.name.startsWith('Closing Stock'))?.amount,
      50000)
    check('and its cost is in Old Gold Purchase', plDr('Old Gold Purchase'), 50000)
    check('so an order with no sale makes no profit', api.reports.profitAndLoss({}).netProfit, 0)
    check('trial balance foots with the order open', tb(), 0)
    check('the customer is owed the old gold until it is billed',
      tbRow('Old Gold on Open Orders'), -50000)
    check('the money khata is untouched by the booking', khata(og), 0)

    api.order.toInvoice({ id: order1.id, bill_date: BILL })
    check('billed: old gold cost counted once, not twice', plDr('Old Gold Purchase'), 50000)
    check('and the open-order line is gone', tbRow('Old Gold on Open Orders'), 0)
    check('trial balance foots after billing', tb(), 0)
    check('khata agrees with the bill', khata(og), owedByDocs(og))
    check('the P&L for the booking month alone carries the cost',
      api.reports.profitAndLoss({ from: BOOK, to: BOOK }).trading.dr
        .find((r) => r.name === 'Old Gold Purchase')?.amount || 0, 50000)
    check('and the billing day does not carry it again',
      api.reports.profitAndLoss({ from: BILL, to: BILL }).trading.dr
        .find((r) => r.name === 'Old Gold Purchase')?.amount || 0, 0)

    head('2. An order advance, in the Day Book on the day it was paid')
    const adv = customer('Advance Payer')
    const order2 = api.order.save({
      head: { prefix: 'NO', order_date: BOOK, party_id: adv, party_name: 'Advance Payer',
              advance_amount: 20000 },
      items: [{ item_name: 'Kada', qty: 0, gross_wt: 10, net_wt: 10, purity: 91.6,
                rate_per_gm: 5000, mkg_per_gm: 500 }],
    })
    check('Day Book: received on the booking day', received(BOOK), 20000)
    check('Cash Book: in the till on the booking day', cashIn(BOOK), 20000)
    const inv = api.order.toInvoice({ id: order2.id, bill_date: BILL })
    const billTotal = Number(api.sale.read({ id: inv.id }).total_amount)
    check('Day Book: still on the booking day after billing', received(BOOK), 20000)
    check('Day Book: nothing received on the bill date', received(BILL), 0)
    check('Cash Book: nothing on the bill date', cashIn(BILL), 0)
    check('Cash Book: booking day unchanged', cashIn(BOOK), 20000)
    const dashCash = (d) => Number(api.reports.dashboardV2({ business_date: d }).cashSales.v)
    check('Dashboard: advance counted on the booking day', dashCash(BOOK), 20000)
    check('Dashboard: not again on the bill date', dashCash(BILL), 0)
    check('customer owes the bill less the advance', khata(adv), billTotal - 20000)
    check('khata agrees with the bill', khata(adv), owedByDocs(adv))
    check('trial balance foots', tb(), 0)

    head('3. The balance paid on a bill made from an order')
    throws('the bill cannot show less received than the advance',
      () => resave(inv.id, { amount_received: 5000 }), /advance/)
    resave(inv.id, { bill_date: PAID, amount_received: billTotal })
    check('the new money reached the cash book', cashIn(PAID), billTotal - 20000)
    check('and the Day Book', received(PAID), billTotal - 20000)
    check('the advance stays on the booking day', cashIn(BOOK), 20000)
    check('and is not received again', received(BOOK), 20000)
    check('the customer is settled', khata(adv), 0)
    check('khata agrees with the bill', khata(adv), owedByDocs(adv))
    check('trial balance foots', tb(), 0)
    resave(inv.id, {})
    check('re-saving again posts nothing more', cashIn(PAID), billTotal - 20000)
    check('customer still settled', khata(adv), 0)
    // Paid partly in cash, partly by bank: the advance comes off the cash leg.
    const bankPart = 10000
    resave(inv.id, { amount_received: billTotal }, [
      { mode: 'Cash', amount: billTotal - bankPart }, { mode: 'Bank', amount: bankPart },
    ])
    check('split: cash leg less the advance', cashIn(PAID), billTotal - bankPart - 20000)
    check('split: bank leg in full', cashIn(PAID, 'Bank Account'), bankPart)
    check('split: Day Book cash', received(PAID), billTotal - bankPart - 20000)
    check('split: Day Book bank', received(PAID, 'Bank'), bankPart)
    check('split: customer settled', khata(adv), 0)
    check('trial balance foots', tb(), 0)

    head('4. A scheme bonus is the shop\'s cost')
    const mem = customer('Scheme Member')
    const sc = api.gss.saveScheme({ name: 'Two Plus One', scheme_type: 'On Amount',
      period_unit: 'Months', total_periods: 3, paying_periods: 2, monthly_amount: 1000,
      maturity_bonus: 500 })
    const ac = api.gss.assign({ scheme_id: sc, party_id: mem, start_date: '2026-01-01' })
    for (const r of api.gss.readAccount({ id: ac.id }).receipts.filter((x) => x.status === 'PENDING')) {
      api.gss.receive({ receipt_id: r.id, received_date: '2026-02-01' })
    }
    check('scheme holds the deposits', tbRow('Gold Saving Scheme'), -2000)
    const plBefore = api.reports.profitAndLoss({}).netProfit
    const gsBill = api.sale.save({
      head: saleHead({ party_id: mem, party_name: 'Scheme Member', gss_id: ac.id, is_credit: 1,
                       amount_received: 0 }),
      items: [line(tag())],
    })
    const gb = api.sale.read({ id: gsBill.id })
    check('the bill took deposits and bonus', gb.gss_amount, 2500)
    check('the scheme liability is back to zero', tbRow('Gold Saving Scheme'), 0)
    check('the bonus is an expense', plDr('Scheme Bonus'), 500)
    check('the account has nothing left', api.gss.balance({ id: ac.id, as_of: DAY }).balance_amount, 0)
    check('trial balance foots', tb(), 0)
    check('khata agrees with the bill', khata(mem), owedByDocs(mem))
    check('profit moved by the sale less the bonus',
      api.reports.profitAndLoss({}).netProfit - plBefore < 56650, true)
    resave(gsBill.id, {})
    check('re-saving the bill books the bonus once', plDr('Scheme Bonus'), 500)
    check('liability still zero', tbRow('Gold Saving Scheme'), 0)
    check('trial balance foots', tb(), 0)

    head('5. Removing a return, then deleting its bill')
    const rc = customer('Returner')
    const t5 = tag()
    const shelf5 = inStock()
    const b5 = api.sale.save({
      head: saleHead({ party_id: rc, party_name: 'Returner', amount_received: 56650 }),
      items: [line(t5)],
    })
    check('sold: one fewer on the shelf', inStock(), shelf5 - 1)
    const r5 = api.saleReturn.save({
      head: { return_date: DAY, party_id: rc, party_name: 'Returner', against_sale_id: b5.id,
              gst_pct: 3, refund_amount: 0 },
      items: [retLine(t5)],
    })
    check('returned: back on the shelf', inStock(), shelf5)
    check('customer credited the return', khata(rc), -56650)
    api.saleReturn.remove({ id: r5.id })
    const t5a = api.tagStock.list({}).find((x) => x.id === t5.id)
    check('return removed: piece is sold again', t5a.status, 'SOLD')
    check('and belongs to the bill that sold it', t5a.sold_doc, `SALE:${b5.id}`)
    check('shelf count after removing the return', inStock(), shelf5 - 1)
    check('customer credit gone', khata(rc), 0)
    // A database from an older build: the same piece left with no bill named.
    db.get().prepare(`UPDATE tag_stock SET sold_doc = '' WHERE id = ?`).run(t5.id)
    db.close(); db.open(tmp)
    check('reopened: the piece is linked back to its bill',
      api.tagStock.list({}).find((x) => x.id === t5.id).sold_doc, `SALE:${b5.id}`)
    api.sale.remove({ id: b5.id })
    check('bill deleted: piece is back in stock',
      api.tagStock.list({}).find((x) => x.id === t5.id).status, 'IN_STOCK')
    check('shelf count after deleting the bill', inStock(), shelf5)
    check('khata agrees with the documents', khata(rc), owedByDocs(rc))
    check('trial balance foots', tb(), 0)

    head('6. Deleting a bill that has a return against it')
    const t6 = tag()
    const shelf6 = inStock()
    const b6 = api.sale.save({
      head: saleHead({ party_id: rc, party_name: 'Returner', amount_received: 56650 }),
      items: [line(t6)],
    })
    const r6 = api.saleReturn.save({
      head: { return_date: DAY, party_id: rc, party_name: 'Returner', against_sale_id: b6.id,
              gst_pct: 3, refund_amount: 56650 },
      items: [retLine(t6)],
    })
    const r6no = api.saleReturn.read({ id: r6.id }).return_no
    throws('deleting the bill is refused, naming the return',
      () => api.sale.remove({ id: b6.id }), new RegExp(r6no))
    check('the piece is on the shelf once', inStock(), shelf6)
    // Sold again to someone else, the return can no longer be undone.
    const b6b = api.sale.save({ head: saleHead({ amount_received: 56650 }), items: [line(t6)] })
    check('resold: off the shelf', inStock(), shelf6 - 1)
    throws('removing the return under a resold piece is refused',
      () => api.saleReturn.remove({ id: r6.id }), /sold again/)
    check('the piece stays with its new bill',
      api.tagStock.list({}).find((x) => x.id === t6.id).sold_doc, `SALE:${b6b.id}`)
    // Editing the original bill must not take the returned piece off the new one.
    resave(b6.id, {})
    check('editing the original bill leaves the resold piece alone',
      api.tagStock.list({}).find((x) => x.id === t6.id).sold_doc, `SALE:${b6b.id}`)
    check('shelf count unchanged', inStock(), shelf6 - 1)
    check('khata agrees with the documents', khata(rc), owedByDocs(rc))
    check('trial balance foots', tb(), 0)
  } catch (e) {
    fail++
    console.log('  ERROR', e && e.stack ? e.stack : e)
  }

  console.log(`\n${pass} passed, ${fail} failed`)
  app.exit(fail ? 1 : 0)
})
