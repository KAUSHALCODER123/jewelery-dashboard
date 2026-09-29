/**
 * Account cum Stock Display — docs/VIDEO-SPEC-2.md §2.
 *
 * One statement per party carrying rupees AND fine grams together, each with its
 * own running Dr/Cr. The thing worth guarding is that a document which moves both
 * appears as ONE row, and that the two balances stay independent — folding metal
 * into money is exactly the mistake this screen exists to prevent.
 *    npm run test:acstock
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
const head = (t) => console.log(`\n── ${t} ${'─'.repeat(Math.max(0, 46 - t.length))}`)

app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'parivar-run-')))

app.whenReady().then(() => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'parivar-acs-'))
  const db = require('../electron/db.cjs')
  db.open(tmp)
  const api = require('../electron/api.cjs')

  try {
    head('1. A customer with both kinds of opening balance')
    const partyId = api.party.save({
      party_type: 'CUSTOMER', name: 'Sachin Patil', state: 'Maharashtra',
      opening_balance: 9500, opening_dr_cr: 'Dr',
      metals: [{ metal: 'Gold', weight: 10, dr_cr: 'Dr' }],
    })
    let acs = api.reports.accountCumStock({ partyId })
    check('opening money', acs.opening.amount, 9500)
    check('opening metal', acs.opening.weight, 10)
    check('no documents yet', acs.rows.length, 0)
    check('closing money = opening', acs.closing.amount, 9500)
    check('closing metal = opening', acs.closing.weight, 10)

    head('2. One weightwise bill = ONE row, moving both')
    const g22 = api.itemGroup.list().find((g) => g.name === '22K Gold')
    const itemId = api.item.save({
      name: 'Ring', item_type_id: g22.item_type_id, item_group_id: g22.id,
      design_id: null, weight_mode: 'WEIGHT', uom: 'GRAM', hsn: '7113', image: '',
    })
    const sale = api.sale.save({
      head: {
        prefix: 'COM', bill_date: DAY, party_id: partyId, party_name: 'Sachin Patil',
        state: 'Maharashtra', is_credit: 1, payment_mode: 'Cash', gst_pct: 3,
        weightwise: 1, bill_discount: 0, making_discount: 0, other_amount: 0,
        manual_urd_amount: 0, tcs_pct: 0, amount_received: 0,
      },
      items: [{
        item_id: itemId, item_name: 'Ring', hsn: '7113', qty: 3,
        gross_wt: 15, purity: 100, stone_wt: 0, net_wt: 15,
        rate_per_gm: 0, mkg_per_gm: 0, hallmark_charges: 0,
      }],
      urds: [{ name: 'Old Gold', gross_wt: 6, net_wt: 6, purity: 100, rate: 0 }],
      metals: [{ metal: 'Gold', balance_wt: 5, rate_per_gm: 5000 }],
    })
    acs = api.reports.accountCumStock({ partyId })
    check('the bill is a single row', acs.rows.length, 1)
    const r = acs.rows[0]
    check('document number', r.doc_no, sale.bill_no)
    check('amount billed', r.amount, 25750)
    check('nothing received yet', r.received, 0)
    check('metal moved (4 g still owed)', r.fine_wt, 4)
    check('metal went out to the customer', r.in_out, 'OUT')
    check('running money balance', r.bal_amt, 9500 + 25750)
    check('running metal balance', r.bal_wt, 14)

    head('3. The two balances stay independent')
    check('closing money', acs.closing.amount, 35250)
    check('closing metal', acs.closing.weight, 14)
    check('agrees with the money khata',
      api.party.balance({ id: partyId }).balance, acs.closing.amount)
    check('agrees with the gold khata',
      api.party.metalBalance({ id: partyId }).balance, acs.closing.weight)

    head('4. A receipt pays money without touching metal')
    api.voucher.save({
      kind: 'RECEIPT', voucher_date: DAY, party_id: partyId,
      party_name: 'Sachin Patil', amount: 20000, payment_type: 'Cash',
    })
    acs = api.reports.accountCumStock({ partyId })
    check('a second row', acs.rows.length, 2)
    check('receipt shows in the received column', acs.rows[1].received, 20000)
    check('receipt bills nothing', acs.rows[1].amount, 0)
    check('receipt moves no metal', acs.rows[1].fine_wt, 0)
    check('money balance falls', acs.closing.amount, 15250)
    check('metal balance unchanged', acs.closing.weight, 14)

    head('5. Rows are ordered by date, balances run down the page')
    const dates = acs.rows.map((x) => x.entry_date)
    check('in date order', String(dates), String([...dates].sort()))
    check('last row balance is the closing balance', acs.rows[1].bal_amt, acs.closing.amount)

    head('6. A date range moves the opening balance forward')
    const later = api.reports.accountCumStock({ partyId, from: '2026-07-22' })
    check('everything before the range is folded into opening', later.opening.amount, 15250)
    check('opening metal too', later.opening.weight, 14)
    check('no rows inside the range', later.rows.length, 0)

    head('7. Stock Cash Settlement turns metal into money')
    // A supplier we owe metal to: 100 g Cr on the gold khata.
    const supId = api.party.save({
      party_type: 'SUPPLIER', name: 'Sangam Gold', state: 'Maharashtra',
      opening_balance: 0, opening_dr_cr: 'Cr',
      metals: [{ metal: 'Gold', weight: 100, dr_cr: 'Cr' }],
    })
    check('supplier is owed 100 g', api.party.metalBalance({ id: supId }).balance, -100)
    check('and no money yet', api.party.balance({ id: supId }).balance, 0)

    // Settle it: metal goes OUT to them on the books, money comes back the other way.
    const so = api.stockSettlement.save({
      settle_date: DAY, party_id: supId, party_name: 'Sangam Gold', metal: 'Gold',
      direction: 'OUT', fine_wt: 100, rate_per_gm: 5000, gst_pct: 0,
    })
    check('settlement number', so.settle_no, 'SO1')
    const soRow = api.stockSettlement.read({ id: so.id })
    check('amount (100 x 5000)', soRow.amount, 500000)
    check('bill amount', soRow.bill_amount, 500000)
    check('metal balance cleared', api.party.metalBalance({ id: supId }).balance, 0)
    check('now owed in rupees instead', api.party.balance({ id: supId }).balance, -500000)

    head('8. It shows on the combined statement as one row')
    const sup = api.reports.accountCumStock({ partyId: supId })
    check('one settlement row', sup.rows.length, 1)
    check('row is the settlement', sup.rows[0].particulars, 'Stock Cash Settlement')
    check('fine weight on the row', sup.rows[0].fine_wt, 100)
    check('metal went out', sup.rows[0].in_out, 'OUT')
    check('closing money', sup.closing.amount, -500000)
    check('closing metal', sup.closing.weight, 0)

    head('9. Paying it down, and reversing the settlement')
    api.voucher.save({
      kind: 'PAYMENT', voucher_date: DAY, party_id: supId,
      party_name: 'Sangam Gold', amount: 30000, payment_type: 'Cash',
    })
    check('money owed falls by the payment',
      api.party.balance({ id: supId }).balance, -470000)
    api.stockSettlement.remove({ id: so.id })
    check('metal debt comes back', api.party.metalBalance({ id: supId }).balance, -100)
    check('money side reversed too', api.party.balance({ id: supId }).balance, 30000)

    head('10. Deleting the bill reverses both sides')
    api.sale.remove({ id: sale.id })
    acs = api.reports.accountCumStock({ partyId })
    check('money back to opening less the receipt', acs.closing.amount, 9500 - 20000)
    check('metal back to opening', acs.closing.weight, 10)
  } catch (e) {
    fail++
    console.error('\nUNCAUGHT:', e.stack || e.message)
  }

  console.log(`\n${'═'.repeat(50)}`)
  console.log(`${pass} passed, ${fail} failed`)
  console.log('═'.repeat(50))
  process.exit(fail ? 1 : 0)
})
