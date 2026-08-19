/**
 * Order booking gaps — docs/VIDEO-SPEC-2.md §10.
 *
 *   1. A karagir deadline that is separate from the customer's promise date, with
 *      its own "days left" and overdue flag in the tracking report.
 *   2. Old gold taken from the customer AT BOOKING — it pays the order down like a
 *      second advance, posts to the customer's gold khata immediately, and carries
 *      onto the invoice on conversion without the metal being counted twice.
 *    npm run test:orderbooking
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
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'parivar-ob-'))
  const db = require('../electron/db.cjs')
  db.open(tmp)
  const api = require('../electron/api.cjs')

  try {
    head('1. Book an order with two dates and old gold')
    const custId = api.party.save({
      party_type: 'CUSTOMER', name: 'Meena Rao', state: 'Maharashtra', metals: [],
    })
    const karId = api.party.save({
      party_type: 'KARAGIR', name: 'Suresh', state: 'Maharashtra', metals: [],
    })
    const g22 = api.itemGroup.list().find((g) => g.name === '22K Gold')
    const itemId = api.item.save({
      name: 'Bangle', item_type_id: g22.item_type_id, item_group_id: g22.id,
      design_id: null, weight_mode: 'WEIGHT', uom: 'GRAM', hsn: '7113', image: '',
    })

    const order = api.order.save({
      head: {
        prefix: 'NO', order_date: DAY,
        delivery_date: '2026-08-10',   // promised to the customer
        karagir_date: '2026-08-05',    // karagir must deliver earlier
        party_id: custId, party_name: 'Meena Rao', karagir_id: karId,
        advance_amount: 0, remark: '',
      },
      items: [{
        item_id: itemId, item_name: 'Bangle', qty: 0, gross_wt: 20, stone_wt: 0,
        net_wt: 20, purity: 100, rate_per_gm: 5000, mkg_per_gm: 0,
      }],
      // Old gold handed over at booking: 10 g pure @ 5000 = 50,000.
      urds: [{ item_name: 'Old Gold', gross_wt: 10, net_wt: 10, purity: 100, rate: 5000 }],
    })
    check('order number', order.order_no, 'NO1')

    head('2. Both dates are stored, distinct')
    const o = api.order.read({ id: order.id })
    check('customer delivery date', o.delivery_date, '2026-08-10')
    check('karagir date is its own field', o.karagir_date, '2026-08-05')
    check('old gold line saved', o.urds.length, 1)
    check('old gold fine weight (10 x 100%)', o.urds[0].final_wt, 10)
    check('old gold amount (10 x 5000)', o.urds[0].amount, 50000)

    head('3. Old gold pays the order down and posts to the gold khata')
    // goods 20 x 5000 = 1,00,000 ; less old gold 50,000 → balance 50,000
    check('order total', o.total_amount, 100000)
    check('balance after old gold', o.balance_amount, 50000)
    // The customer handed us 10 g, so we now owe them 10 g — a credit on their khata.
    check('customer gold khata (Cr 10 g)', api.party.metalBalance({ id: custId }).balance, -10)
    // Money is untouched — an order is not a sale.
    check('no money moved at booking', api.party.balance({ id: custId }).balance, 0)

    head('4. Tracking shows a karagir deadline ahead of the customer date')
    // As of 1 Aug: karagir due 5 Aug (4 left), customer due 10 Aug (9 left).
    const t1 = api.reports.orderTracking({ asOf: '2026-08-01' }).find((r) => r.id === order.id)
    check('customer days left', t1.remaining_days, 9)
    check('karagir days left (tighter)', t1.karagir_remaining_days, 4)
    check('neither overdue yet', t1.karagir_overdue, false)
    // As of 7 Aug: karagir date passed, still not received → karagir overdue,
    // but the customer promise (10 Aug) is not yet breached.
    const t2 = api.reports.orderTracking({ asOf: '2026-08-07' }).find((r) => r.id === order.id)
    check('karagir now overdue', t2.karagir_overdue, true)
    check('customer promise not yet breached', t2.overdue, false)

    head('5. Editing the order does not double the old gold')
    api.order.save({
      head: { ...o, id: order.id },
      items: o.items.map((l) => ({ ...l })),
      urds: o.urds.map((u) => ({ item_name: u.item_name, gross_wt: u.gross_wt, net_wt: u.net_wt, purity: u.purity, rate: u.rate })),
    })
    check('still one old gold line', api.order.read({ id: order.id }).urds.length, 1)
    check('gold khata unchanged after re-save', api.party.metalBalance({ id: custId }).balance, -10)

    head('6. On conversion the old gold carries to the bill, metal not double-counted')
    const inv = api.order.toInvoice({ id: order.id })
    const bill = api.sale.read({ id: inv.id })
    check('old gold carried onto the invoice', bill.urd_amount, 50000)
    check('order marked delivered', api.order.read({ id: order.id }).status, 'DELIVERED')
    // Now they have BOUGHT the 20 g piece and paid with 10 g old gold, so on net
    // they owe us 10 g (Dr). The booking-time −10 was reversed and re-posted by the
    // sale. If the old gold had double-counted, this would read 20 − 20 = 0.
    check('gold khata nets to 10 g owed (20 sold − 10 old gold)',
      api.party.metalBalance({ id: custId }).balance, 10)
  } catch (e) {
    fail++
    console.log('  ERROR', e && e.stack ? e.stack : e)
  }

  console.log(`\n${pass} passed, ${fail} failed`)
  app.exit(fail ? 1 : 0)
})
