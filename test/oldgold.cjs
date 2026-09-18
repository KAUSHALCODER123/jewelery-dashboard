/**
 * Old gold bought on its own bill — no sale against it.
 *
 * The metal lands in URD loose stock, the customer's khata goes into credit for
 * whatever was not paid on the spot, the cash book drops by what was, and the
 * Old Gold report counts it alongside old gold exchanged on sale bills.
 *    npm run test:oldgold
 */
const { app } = require('electron')
const path = require('node:path')
const fs = require('node:fs')
const os = require('node:os')

const DAY = '2026-07-21'
const NEXT = '2026-07-22'

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
const head = (t) => console.log(`\n── ${t} ${'─'.repeat(Math.max(0, 46 - t.length))}`)

app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'parivar-run-')))

app.whenReady().then(() => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'parivar-urd-'))
  const db = require('../electron/db.cjs')
  db.open(tmp)
  const api = require('../electron/api.cjs')

  try {
    head('1. A walk-in sells a broken chain, paid in full in cash')
    const cashBefore = api.reports.cashBook({ from: DAY, to: DAY, account: 'Cash Account' }).opening
    const b1 = api.urd.save({
      head: { bill_date: DAY, payment_mode: 'Cash' },
      urds: [{ name: 'Old Gold', description: 'broken chain', gross_wt: 10, net_wt: 10, purity: 80, rate: 5000 }],
    })
    check('bill number from the O series', b1.bill_no, 'O1')
    const r1 = api.urd.read({ id: b1.id })
    check('old gold value = 8 g fine × 5000', r1.purchase_amount, 40000)
    check('paid in full when nothing was typed', r1.amount_given, 40000)
    check('no balance', r1.net_balance, 0)
    check('one line stored', r1.urds.length, 1)
    check('line fine weight', r1.urds[0].final_wt, 8)
    const cb = api.reports.cashBook({ from: DAY, to: DAY, account: 'Cash Account' })
    check('cash paid out', cb.totalCredit, 40000)
    check('cash closes 40,000 lower', cb.closing, cashBefore - 40000)
    check('URD gold in the safe', api.looseStock.summary({ metal: 'Gold' }).urd_fine, 8)

    head('2. A customer sells two pieces, part paid by UPI, rest on khata')
    const partyId = api.party.save({
      party_type: 'CUSTOMER', name: 'Meena Shah', state: 'Maharashtra', metals: [],
    })
    const b2 = api.urd.save({
      head: {
        bill_date: DAY, party_id: partyId, party_name: 'Meena Shah', payment_mode: 'UPI',
        discount: 500, other_amount: 0, amount_given: 30000,
      },
      urds: [
        { name: 'Old Gold', description: 'bangle', gross_wt: 12, net_wt: 11.5, purity: 91.6, rate: 5200 },
        { name: 'Old Gold', description: 'ring', gross_wt: 4, net_wt: 4, purity: 75, rate: 5200 },
      ],
    })
    check('second bill number', b2.bill_no, 'O2')
    const r2 = api.urd.read({ id: b2.id })
    // 11.5 × 0.916 = 10.534 fine → 54,776.80 ; 4 × 0.75 = 3 fine → 15,600
    check('old gold value', r2.purchase_amount, 70376.8)
    check('payable after deduction', r2.total_amount, 69876.8)
    check('balance owed to customer', r2.net_balance, 39876.8)
    check('marked as credit', r2.is_credit, 1)
    check('customer khata is in credit (shop owes)', api.party.balance({ id: partyId }).balance, -39876.8)
    check('customer handed us metal', api.party.metalBalance({ id: partyId }).balance, -13.534)
    const bank = api.reports.cashBook({ from: DAY, to: DAY, account: 'Bank Account' })
    check('UPI went out of the bank', bank.totalCredit, 30000)
    check('URD gold in the safe now', api.looseStock.summary({ metal: 'Gold' }).urd_fine, 21.534)
    const led = api.reports.ledger({ partyId, from: DAY, to: DAY })
    check('khata credit leg', led.credits.find((c) => c.particulars === 'Old Gold Purchase')?.amount, 69876.8)
    check('khata debit leg (paid)', led.debits.find((c) => c.particulars === 'Bank Account')?.amount, 30000)

    head('3. Guard rails')
    let err = ''
    try { api.urd.save({ head: { bill_date: DAY }, urds: [] }) } catch (e) { err = e.message }
    check('refuses an empty bill', /at least one/.test(err), true)
    err = ''
    try {
      api.urd.save({ head: { bill_date: DAY, amount_given: 99999 },
        urds: [{ gross_wt: 1, net_wt: 1, purity: 100, rate: 5000 }] })
    } catch (e) { err = e.message }
    check('refuses overpaying', /owed less/.test(err), true)
    err = ''
    try {
      api.urd.save({ head: { bill_date: DAY, amount_given: 100 },
        urds: [{ gross_wt: 1, net_wt: 1, purity: 100, rate: 5000 }] })
    } catch (e) { err = e.message }
    check('refuses a balance with no customer', /Select a customer/.test(err), true)
    check('nothing extra was booked', api.urd.list({ from: DAY, to: DAY }).length, 2)

    head('4. Old gold on a sale bill sits in the same report')
    const g22 = api.itemGroup.list().find((g) => g.name === '22K Gold')
    const itemId = api.item.save({
      name: 'Ring', item_type_id: g22.item_type_id, item_group_id: g22.id,
      design_id: null, weight_mode: 'WEIGHT', uom: 'GRAM', hsn: '7113', image: '',
    })
    api.tagStock.saveBatch({ itemId, rows: [{ gross_wt: 5, stone_wt: 0, purity: 91.6, entry_date: DAY }] })
    const tag = api.tagStock.list({ status: 'IN_STOCK' })[0]
    api.sale.save({
      head: {
        prefix: 'COM', bill_date: NEXT, party_id: partyId, party_name: 'Meena Shah',
        state: 'Maharashtra', is_credit: 0, payment_mode: 'Cash', gst_pct: 3,
        bill_discount: 0, making_discount: 0, other_amount: 0, manual_urd_amount: 0,
        tcs_pct: 0, amount_received: 0,
      },
      items: [{
        tag: tag.tag, tag_stock_id: tag.id, item_id: itemId, item_name: 'Ring', hsn: '7113',
        qty: 1, gross_wt: 5, purity: 91.6, stone_wt: 0, net_wt: 5, rate_per_gm: 5000,
        mkg_per_gm: 0, hallmark_charges: 0,
      }],
      urds: [{ name: 'Old Gold', gross_wt: 2, net_wt: 2, purity: 75, rate: 5000 }],
    })
    const rep = api.reports.oldGold({ from: DAY, to: NEXT })
    check('report has all four lines', rep.rows.length, 4)
    check('three bills', rep.totals.bills, 3)
    check('fine taken in', rep.totals.fine_wt, 23.034)
    check('old gold total (₹)', rep.totals.amount, 117876.8)
    check('sale-bill slice', rep.bySource.SALE.fine_wt, 1.5)
    check('old-gold-bill slice', rep.bySource.URD.fine_wt, 21.534)
    check('URD gold in safe on the report', rep.stock.fine_on_hand, 23.034)
    check('average rate per fine gram', rep.totals.avg_rate, 5117.51, 0.01)
    const only = api.reports.oldGold({ from: DAY, to: NEXT, search: 'Meena' })
    check('search narrows to the customer', only.rows.length, 3)

    head('5. Day book and P&L count it')
    const dbk = api.reports.dayBook({ from: DAY, to: DAY })
    check('day book: paid on old gold bills', dbk.urd_bills.paid, 70000)
    check('day book: still owed', dbk.urd_bills.credit, 39876.8)
    check('day book: URD stock closing', dbk.stock.urd_closing, 21.534)
    const pl = api.reports.profitAndLoss({ from: DAY, to: NEXT })
    const og = pl.trading.dr.find((r) => r.name === 'Old Gold Purchase')
    check('P&L old gold = both bills + the sale-bill exchange', og?.amount, 109876.8 + 7500)
    const tb = api.reports.trialBalance({ from: DAY, to: NEXT })
    check('trial balance still foots', tb.difference === 0 || Math.abs(tb.difference) < 0.01, true)

    head('6. Edit and delete reverse cleanly')
    api.urd.save({
      head: { ...r2, id: b2.id, amount_given: 69876.8 },
      urds: r2.urds,
    })
    // Only the ring bought in step 4 is left on the khata: 25,750 bill less 7,500 old gold.
    check('after paying in full only the sale is left on the khata', api.party.balance({ id: partyId }).balance, 18250)
    check('still 21.534 g URD from the two bills (plus 1.5 from the sale)',
      api.looseStock.summary({ metal: 'Gold' }).urd_fine, 23.034)
    check('bill number kept on edit', api.urd.read({ id: b2.id }).bill_no, 'O2')
    api.urd.remove({ id: b1.id })
    check('deleted bill gone', api.urd.read({ id: b1.id }), 'null')
    check('its metal left the safe', api.looseStock.summary({ metal: 'Gold' }).urd_fine, 15.034)
    check('its cash came back', api.reports.cashBook({ from: DAY, to: DAY, account: 'Cash Account' }).totalCredit, 0)
    check('no orphan lines', api.reports.oldGold({ from: DAY, to: NEXT }).rows.length, 3)
  } catch (e) {
    fail++
    console.error('\n  ERROR', e.stack || e.message)
  }

  console.log(`\n${pass} passed, ${fail} failed`)
  db.close()
  app.exit(fail ? 1 : 0)
})
