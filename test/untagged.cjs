/**
 * Untagged sale lines sold straight out of a purchase.
 *
 * A bill line with no tag can name the purchase invoice it came from. Its net
 * weight then comes off that invoice's labels tally — the metal has left the
 * shop, so it is no longer waiting for a label — and the pool is guarded so a
 * line cannot take more than the invoice still has unlabelled.
 *    npm run test:untagged
 */
const { app } = require('electron')
const path = require('node:path')
const fs = require('node:fs')
const os = require('node:os')

const DAY = '2026-07-21'

let pass = 0
let fail = 0
function check(label, actual, expected, tol = 0.005) {
  const ok = typeof expected === 'number'
    ? Math.abs(Number(actual) - expected) <= tol
    : String(actual) === String(expected)
  if (ok) { pass++; console.log(`  PASS  ${label} = ${actual}`) }
  else { fail++; console.log(`  FAIL  ${label}: got ${actual}, expected ${expected}`) }
}
function throws(label, fn, re) {
  try { fn(); fail++; console.log(`  FAIL  ${label}: expected it to be refused`) }
  catch (e) {
    if (!re || re.test(e.message)) { pass++; console.log(`  PASS  ${label} refused — ${e.message}`) }
    else { fail++; console.log(`  FAIL  ${label}: wrong message — ${e.message}`) }
  }
}
const head = (t) => console.log(`\n-- ${t} ${'-'.repeat(Math.max(0, 46 - t.length))}`)

app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'parivar-run-')))

app.whenReady().then(() => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'parivar-untagged-'))
  const db = require('../electron/db.cjs')
  db.open(tmp)
  const api = require('../electron/api.cjs')

  try {
    const g22 = api.itemGroup.list().find((x) => x.name === '22K Gold')
    const gSilver = api.itemGroup.list().find((x) => /^silver$/i.test(x.name))
    const ringId = api.item.save({
      name: 'Ring', item_type_id: g22.item_type_id, item_group_id: g22.id,
      design_id: null, weight_mode: 'WEIGHT', uom: 'GRAM', hsn: '7113', image: '',
    })
    const payalId = api.item.save({
      name: 'Payal', item_type_id: gSilver.item_type_id, item_group_id: gSilver.id,
      design_id: null, weight_mode: 'WEIGHT', uom: 'GRAM', hsn: '7113', image: '',
    })
    const supplier = api.party.save({ name: 'Bullion House', party_type: 'SUPPLIER' })
    const customer = api.party.save({ name: 'Walk-in', party_type: 'CUSTOMER' })

    head('1. Buy 50 g, label 20 g of it')
    const { id: puId } = api.purchase.save({
      head: { prefix: 'MI', invoice_date: DAY, party_id: supplier, party_name: 'Bullion House',
              is_credit: 1, gst_pct: 0, paid_amount: 0, metal: 'Gold' },
      items: [{ item_id: ringId, item_name: 'Ring', qty: 5, gross_wt: 50, stone_wt: 0, net_wt: 50,
                purity: 91.6, rate: 6000, wastage_pct: 0, hallmark_charges: 0 }],
    })
    api.looseStock.convert({
      itemId: ringId, purchaseId: puId, entry_date: DAY,
      rows: [{ gross_wt: 10, stone_wt: 0, purity: 91.6, qty: 1 }, { gross_wt: 10, stone_wt: 0, purity: 91.6, qty: 1 }],
    })
    check('30 g still to label', api.purchase.tally({ id: puId }).pending_net, 30)
    check('offered to the bill line', api.purchase.openForTagging().some((p) => p.id === puId), true)

    head('2. Sell 12 g untagged, naming the purchase')
    const sale = api.sale.save({
      head: { prefix: 'COM', bill_date: DAY, party_id: customer, party_name: 'Walk-in',
              gst_not_required: 1, payment_mode: 'Cash', amount_received: 0 },
      items: [{ item_id: ringId, item_name: 'Ring', gross_wt: 12, net_wt: 12, purity: 91.6,
                rate_per_gm: 6500, purchase_id: puId }],
    })
    const t2 = api.purchase.tally({ id: puId })
    check('sold untagged counted', t2.sold_loose_net, 12)
    check('pending falls to 18 g', t2.pending_net, 18)
    check('still PENDING', t2.status, 'PENDING')
    check('the bill line remembers its purchase', api.sale.read({ id: sale.id }).items[0].purchase_id, puId)
    check('listed on the invoice', t2.loose_sales.length, 1)
    check('with its bill number', t2.loose_sales[0].bill_no, sale.bill_no)

    head('3. Guard rails')
    throws('cannot take more than is unlabelled', () => api.sale.save({
      head: { prefix: 'COM', bill_date: DAY, gst_not_required: 1, payment_mode: 'Cash', amount_received: 0 },
      items: [{ item_id: ringId, item_name: 'Ring', gross_wt: 20, net_wt: 20, purity: 91.6,
                rate_per_gm: 6500, purchase_id: puId }],
    }), /still unlabelled/)
    throws('a silver line cannot come off a gold purchase', () => api.sale.save({
      head: { prefix: 'COM', bill_date: DAY, gst_not_required: 1, payment_mode: 'Cash', amount_received: 0 },
      items: [{ item_id: payalId, item_name: 'Payal', gross_wt: 5, net_wt: 5, purity: 92.5,
                rate_per_gm: 100, purchase_id: puId }],
    }), /Gold purchase/)
    throws('a purchase that does not exist', () => api.sale.save({
      head: { prefix: 'COM', bill_date: DAY, gst_not_required: 1, payment_mode: 'Cash', amount_received: 0 },
      items: [{ item_id: ringId, item_name: 'Ring', gross_wt: 1, net_wt: 1, purity: 91.6,
                rate_per_gm: 6500, purchase_id: 99999 }],
    }), /no longer exists/)
    check('nothing slipped through', api.purchase.tally({ id: puId }).pending_net, 18)

    head('4. A tagged piece ignores the field, a plain line ignores the purchase')
    const tag = api.tagStock.list({ status: 'IN_STOCK' })[0]
    api.sale.save({
      head: { prefix: 'COM', bill_date: DAY, gst_not_required: 1, payment_mode: 'Cash', amount_received: 0 },
      items: [
        { tag: tag.tag, tag_stock_id: tag.id, item_id: ringId, item_name: 'Ring', gross_wt: 10, net_wt: 10,
          purity: 91.6, rate_per_gm: 6500, purchase_id: puId },
        { item_id: ringId, item_name: 'Ring', gross_wt: 3, net_wt: 3, purity: 91.6, rate_per_gm: 6500 },
      ],
    })
    const t4 = api.purchase.tally({ id: puId })
    check('tagged piece is not double-counted as sold-loose', t4.sold_loose_net, 12)
    check('plain untagged line touches only the pool', t4.pending_net, 18)

    head('5. Editing and deleting the bill moves the tally with it')
    const s = api.sale.read({ id: sale.id })
    api.sale.save({ head: { ...s, id: s.id }, items: [{ ...s.items[0], net_wt: 8, gross_wt: 8 }] })
    check('edited down to 8 g', api.purchase.tally({ id: puId }).pending_net, 22)
    api.sale.remove({ id: sale.id })
    check('deleted → back to 30 g', api.purchase.tally({ id: puId }).pending_net, 30)
    check('no loose sale left on the invoice', api.purchase.tally({ id: puId }).loose_sales.length, 0)

    head('6. Selling the rest untagged tallies the invoice')
    api.sale.save({
      head: { prefix: 'COM', bill_date: DAY, gst_not_required: 1, payment_mode: 'Cash', amount_received: 0 },
      items: [{ item_id: ringId, item_name: 'Ring', gross_wt: 30, net_wt: 30, purity: 91.6,
                rate_per_gm: 6500, purchase_id: puId }],
    })
    const t6 = api.purchase.tally({ id: puId })
    check('tallied', t6.status, 'TALLIED')
    check('no longer offered to the bill line', api.purchase.openForTagging().some((p) => p.id === puId), false)
  } catch (e) {
    fail++
    console.error('\n  ERROR', e.stack || e.message)
  }

  console.log(`\n${pass} passed, ${fail} failed`)
  db.close()
  app.exit(fail ? 1 : 0)
})
