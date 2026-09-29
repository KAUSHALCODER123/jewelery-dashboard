/**
 * Karagir job work — docs/VIDEO-SPEC-2.md §10.
 *
 * Metal out to the goldsmith, finished pieces back, wastage allowed, and whatever
 * is left standing on his ledger. That last figure is the point of the whole
 * module: it is the only number that says a goldsmith is holding metal he has not
 * accounted for.
 *    npm run test:karagir
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
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'parivar-kar-'))
  const db = require('../electron/db.cjs')
  db.open(tmp)
  const api = require('../electron/api.cjs')

  try {
    head('1. An order for a customer, to be made by a karagir')
    const custId = api.party.save({
      party_type: 'CUSTOMER', name: 'Sachin Patil', state: 'Maharashtra', metals: [],
    })
    const karId = api.party.save({
      party_type: 'KARAGIR', name: 'Ramesh', state: 'Maharashtra', metals: [],
    })
    const g22 = api.itemGroup.list().find((g) => g.name === '22K Gold')
    const itemId = api.item.save({
      name: 'Ring', item_type_id: g22.item_type_id, item_group_id: g22.id,
      design_id: null, weight_mode: 'WEIGHT', uom: 'GRAM', hsn: '7113', image: '',
    })
    const order = api.order.save({
      head: {
        prefix: 'NO', order_date: DAY, delivery_date: '2026-08-10',
        party_id: custId, party_name: 'Sachin Patil', karagir_id: karId,
        advance_amount: 0, remark: '',
      },
      items: [{
        item_id: itemId, item_name: 'Ring', qty: 0, gross_wt: 10, stone_wt: 0,
        net_wt: 10, purity: 100, rate_per_gm: 5000, mkg_per_gm: 300,
      }],
    })
    check('order number', order.order_no, 'NO1')

    head('2. Issue 10 g of fine metal to the goldsmith')
    const iss = api.karagir.issue({
      issue_date: DAY, order_id: order.id, sub_order_no: 'NO1/1',
      karagir_id: karId, karagir_name: 'Ramesh', item_name: 'Ring',
      gross_wt: 10, less_wt: 0, net_wt: 10, purity: 100, wastage_pct: 2,
    })
    check('issue number', iss.issue_no, 'KI1')
    check('goldsmith holds 10 g', api.party.metalBalance({ id: karId }).balance, 10)
    check('order moved to ISSUED', api.order.read({ id: order.id }).status, 'ISSUED')

    let led = api.karagir.ledger({ karagirId: karId })
    check('fine issued', led.totals.issued, 10)
    check('nothing back yet', led.totals.received, 0)
    check('all 10 g outstanding', led.totals.outstanding, 10)

    head('3. Receive 9.900 g back, 0.100 g allowed as wastage')
    // 9.900 fine returned + 1% wastage on it (0.099) = 9.999 relieved.
    const rec = api.karagir.receive({
      receive_date: DAY, order_id: order.id, sub_order_no: 'NO1/1',
      karagir_id: karId, karagir_name: 'Ramesh', item_name: 'Ring',
      gross_wt: 9.9, less_wt: 0, stone_wt: 0, diamond_wt: 0, net_wt: 9.9,
      purity: 100, wastage_pct: 1, rate_per_gm: 300, tds_pct: 0, paid_amount: 0,
    })
    check('receive number', rec.receive_no, 'KR1')
    const r = db.get().prepare(`SELECT * FROM karagir_receive WHERE id = ?`).get(rec.id)
    check('fine received', r.fine_wt, 9.9)
    check('wastage allowed (1% of 9.900)', r.wastage_wt, 0.099)
    check('labour (9.9 x 300)', r.labour_amount, 2970)
    check('order moved to RECEIVED', api.order.read({ id: order.id }).status, 'RECEIVED')

    head('4. The shortfall is what he cannot account for')
    led = api.karagir.ledger({ karagirId: karId })
    check('issued', led.totals.issued, 10)
    check('received', led.totals.received, 9.9)
    check('wastage', led.totals.wastage, 0.099)
    // 10 - 9.900 - 0.099 = 0.001 g unaccounted
    check('unaccounted metal', led.totals.outstanding, 0.001)
    check('and it shows on his metal khata',
      api.party.metalBalance({ id: karId }).balance, 0.001)

    head('5. Labour is money we owe him')
    check('we owe the goldsmith', api.party.balance({ id: karId }).balance, -2970)
    check('pending on the receipt', r.pending_amount, 2970)

    head('6. TDS is deducted from the labour bill')
    const rec2 = api.karagir.receive({
      receive_date: DAY, karagir_id: karId, karagir_name: 'Ramesh', item_name: 'Chain',
      gross_wt: 20, net_wt: 20, purity: 100, wastage_pct: 0,
      rate_per_gm: 100, tds_pct: 5, paid_amount: 1000,
    })
    const r2 = db.get().prepare(`SELECT * FROM karagir_receive WHERE id = ?`).get(rec2.id)
    check('labour (20 x 100)', r2.labour_amount, 2000)
    check('TDS @ 5%', r2.tds_amount, 100)
    check('final after TDS', r2.final_amount, 1900)
    check('paid now', r2.paid_amount, 1000)
    check('still pending', r2.pending_amount, 900)

    head('7. Order tracking shows the promise date and how long is left')
    const track = api.reports.orderTracking({ asOf: DAY })
    check('one order tracked', track.length, 1)
    const t = track[0]
    check('customer', t.customer_name, 'Sachin Patil')
    check('karagir', t.karagir_name, 'Ramesh')
    check('delivery date', t.delivery_date, '2026-08-10')
    check('days remaining from 21 Jul', t.remaining_days, 20)
    check('not overdue yet', String(t.overdue), 'false')
    check('metal issued on this order', t.fine_issued, 10)
    check('metal received on this order', t.fine_received, 9.9)

    head('8. Past the promise date it flags as overdue')
    const late = api.reports.orderTracking({ asOf: '2026-08-20' })[0]
    check('days remaining is negative', late.remaining_days, -10)
    check('flagged overdue', String(late.overdue), 'true')

    head('9. Undoing an issue gives the metal back')
    api.karagir.removeReceive({ id: rec.id })
    api.karagir.removeReceive({ id: rec2.id })
    check('only the issue is left', api.party.metalBalance({ id: karId }).balance, 10)
    check('and no labour owed', api.party.balance({ id: karId }).balance, 0)
    api.karagir.removeIssue({ id: iss.id })
    check('goldsmith holds nothing', api.party.metalBalance({ id: karId }).balance, 0)
  } catch (e) {
    fail++
    console.error('\nUNCAUGHT:', e.stack || e.message)
  }

  console.log(`\n${'═'.repeat(50)}`)
  console.log(`${pass} passed, ${fail} failed`)
  console.log('═'.repeat(50))
  process.exit(fail ? 1 : 0)
})
