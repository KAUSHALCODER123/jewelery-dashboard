/**
 * Loose pool sales come off a purchase.
 *
 * The owner bought 64.640 g, sold 9 g untagged with "Loose pool" on the bill,
 * and Tag & Barcode's All purchases still said 64.640 g to label. A loose-pool
 * line is now booked to the oldest purchase with metal left; bills saved before
 * the fix are booked once when the app opens.
 *    npm run test:loosepool
 */
const { app } = require('electron')
const path = require('node:path')
const fs = require('node:fs')
const os = require('node:os')

let pass = 0
let fail = 0
function check(label, actual, expected, tol = 0.0005) {
  const ok = typeof expected === 'number'
    ? Math.abs(Number(actual) - expected) <= tol
    : String(actual) === String(expected)
  if (ok) { pass++; console.log(`  PASS  ${label} = ${actual}`) }
  else { fail++; console.log(`  FAIL  ${label}: got ${actual}, expected ${expected}`) }
}

app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'parivar-run-')))

app.whenReady().then(() => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'parivar-loosepool-'))
  const db = require('../electron/db.cjs')
  db.open(tmp)
  const api = require('../electron/api.cjs')
  try {
    const g = api.itemGroup.list().find((x) => x.name === '18K Gold') || api.itemGroup.list().find((x) => x.name === '22K Gold')
    const bangle = api.item.save({ name: 'Bangle', item_type_id: g.item_type_id, item_group_id: g.id,
      design_id: null, weight_mode: 'WEIGHT', uom: 'GRAM', hsn: '7113', image: '' })
    const supplier = api.party.save({ name: 'Supplier', party_type: 'SUPPLIER' })
    const buy = (date, net) => api.purchase.save({
      head: { prefix: 'MI', invoice_date: date, party_id: supplier, party_name: 'Supplier',
              is_credit: 1, gst_pct: 0, paid_amount: 0, metal: 'Gold' },
      items: [{ item_id: bangle, item_name: 'Bangle', qty: 0, gross_wt: net, stone_wt: 0, net_wt: net,
                purity: 75, rate: 5000, wastage_pct: 0, hallmark_charges: 0 }],
    }).id
    const sell = (date, net, purchase_id) => api.sale.save({
      head: { prefix: 'COM', bill_date: date, party_name: 'Walk-in', gst_not_required: 1,
              payment_mode: 'Cash', amount_received: 0 },
      items: [{ item_id: bangle, item_name: 'Bangle', gross_wt: net, net_wt: net, purity: 75,
                rate_per_gm: 6000, purchase_id }],
    }).id
    const allOpen = () => api.purchase.openForTagging({ metal: 'Gold' })
      .reduce((s, p) => s + p.pending_net, 0)

    console.log('\n── The owner\'s case: 64.640 g bought, 9 g sold from Loose pool')
    const pu = buy('2026-09-27', 64.64)
    sell('2026-09-27', 9, '')
    check('the purchase dropped by 9 g', api.purchase.tally({ id: pu }).pending_net, 55.64)
    check('All purchases dropped by 9 g', allOpen(), 55.64)

    console.log('\n── Oldest purchase first, never one dated after the bill')
    const puOld = buy('2026-09-01', 5)
    const puNew = buy('2026-09-30', 20)
    sell('2026-09-28', 4, '')
    check('oldest open purchase takes it', api.purchase.tally({ id: puOld }).pending_net, 1)
    check('later-dated purchase untouched', api.purchase.tally({ id: puNew }).pending_net, 20)
    sell('2026-09-28', 3, '')
    check('does not fit the old one -> next oldest with room', api.purchase.tally({ id: pu }).pending_net, 52.64)
    check('old one unchanged', api.purchase.tally({ id: puOld }).pending_net, 1)

    console.log('\n── Picking a purchase on the bill still wins')
    sell('2026-09-30', 2, String(puNew))
    check('picked purchase took it', api.purchase.tally({ id: puNew }).pending_net, 18)

    console.log('\n── A bill saved before the fix is booked when the app opens')
    const old = sell('2026-09-27', 6, '')
    const h = db.get()
    h.prepare(`UPDATE sale_item SET purchase_id = NULL WHERE sale_id = ?`).run(old)
    h.prepare(`DELETE FROM settings WHERE key = 'loose_sale_purchase_backfill'`).run()
    check('before reopening: not on any purchase', api.purchase.tally({ id: pu }).pending_net, 52.64)
    db.close()
    db.open(tmp)
    check('after reopening: off the purchase', api.purchase.tally({ id: pu }).pending_net, 46.64)
    db.close()
    db.open(tmp)
    check('runs only once', api.purchase.tally({ id: pu }).pending_net, 46.64)
  } catch (e) {
    fail++
    console.error(e)
  }
  console.log(`\n${pass} passed, ${fail} failed`)
  db.close()
  app.exit(fail ? 1 : 0)
})
