/**
 * Loose weight-wise items — mani, fuli, dori.
 *
 * These are not tagged piece by piece. The shop buys a lot by weight (100 g of
 * mani) and sells a few grams of it at a time, so the stock is a running weight
 * against the item, not a count of barcodes. Their grams are beads, not metal:
 * they must never reach the gold khata, and on a weight-wise bill they are paid
 * for in rupees instead of being settled in fine weight.
 *    npm run test:looseitem
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
function throws(label, fn) {
  try { fn(); fail++; console.log(`  FAIL  ${label}: expected it to be refused`) }
  catch { pass++; console.log(`  PASS  ${label} refused`) }
}
const head = (t) => console.log(`\n-- ${t} ${'-'.repeat(Math.max(0, 46 - t.length))}`)

app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'parivar-run-')))

app.whenReady().then(() => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'parivar-loose-'))
  const db = require('../electron/db.cjs')
  db.open(tmp)
  const api = require('../electron/api.cjs')

  const g = (name) => api.itemGroup.list().find((x) => x.name === name)
  const balance = (id) => api.looseItem.balances().find((b) => b.id === id)

  try {
    head('1. An item stocked by weight, not by tag')
    const g22 = g('22K Gold')
    const maniId = api.item.save({
      name: 'Mani', item_type_id: g22.item_type_id, item_group_id: g22.id,
      design_id: null, weight_mode: 'WEIGHT', stock_mode: 'LOOSE_WT',
      uom: 'GRAM', hsn: '7117', image: '',
    })
    const payalId = api.item.save({
      name: 'Payal', item_type_id: g22.item_type_id, item_group_id: g22.id,
      design_id: null, weight_mode: 'WEIGHT', uom: 'GRAM', hsn: '7113', image: '',
    })
    check('mani is loose', api.item.list().find((x) => x.id === maniId).stock_mode, 'LOOSE_WT')
    check('payal stays tagged', api.item.list().find((x) => x.id === payalId).stock_mode, 'TAG')
    check('only the loose item is listed', api.looseItem.balances().length, 1)
    check('it starts empty', balance(maniId).balance_wt, 0)

    head('2. Opening weight')
    api.looseItem.opening({ item_id: maniId, gross_wt: 40, rate: 35, entry_date: DAY })
    check('opening on hand', balance(maniId).balance_wt, 40)
    // Re-entering a corrected opening must replace it, not add a second lot.
    api.looseItem.opening({ item_id: maniId, gross_wt: 25, rate: 35, entry_date: DAY })
    check('corrected opening replaces the first', balance(maniId).balance_wt, 25)
    throws('opening on a tagged item', () =>
      api.looseItem.opening({ item_id: payalId, gross_wt: 10, entry_date: DAY }))

    head('3. Buying a lot by weight')
    const supplier = api.party.save({ name: 'Bead Supplier', party_type: 'SUPPLIER' })
    const goldBefore = api.looseStock.summary({ metal: 'Gold' })
    api.purchase.save({
      head: {
        prefix: 'PUR', invoice_date: DAY, party_id: supplier, party_name: 'Bead Supplier',
        metal: 'Gold', gst_not_required: 1, amount_paid: 0,
      },
      items: [{
        item_id: maniId, item_name: 'Mani', direction: 'IN',
        gross_wt: 100, net_wt: 100, purity: 0, rate: 35, wastage_pct: 0,
      }],
    })
    check('lot added to the item', balance(maniId).balance_wt, 125)
    check('in-weight so far', balance(maniId).in_wt, 125)
    // The whole point of a separate ledger: beads are not gold.
    check('gold stock untouched by beads',
      api.looseStock.summary({ metal: 'Gold' }).loose_gross, goldBefore.loose_gross)

    head('4. Selling ten grams out of the lot')
    const customer = api.party.save({ name: 'Walk-in', party_type: 'CUSTOMER' })
    const { id: saleId } = api.sale.save({
      head: {
        prefix: 'COM', bill_date: DAY, party_id: customer, party_name: 'Walk-in',
        gst_not_required: 1, payment_mode: 'Cash', amount_received: 0,
      },
      items: [{
        item_id: maniId, item_name: 'Mani', gross_wt: 10, net_wt: 10,
        purity: 0, rate_per_gm: 60,
      }],
    })
    check('ten grams gone', balance(maniId).balance_wt, 115)
    check('out-weight recorded', balance(maniId).out_wt, 10)
    const bill = api.sale.read({ id: saleId })
    check('line priced in rupees', bill.total_amount, 600)
    check('line read back as loose', bill.items[0].is_loose, 1)
    check('the movement is on the ledger',
      api.looseItem.ledger({ item_id: maniId }).filter((r) => r.doc_type === 'SALE').length, 1)

    head('5. The lot cannot be oversold')
    throws('billing more than is on hand', () => api.sale.save({
      head: {
        prefix: 'COM', bill_date: DAY, party_id: customer, party_name: 'Walk-in',
        gst_not_required: 1, payment_mode: 'Cash', amount_received: 0,
      },
      items: [{
        item_id: maniId, item_name: 'Mani', gross_wt: 500, net_wt: 500,
        purity: 0, rate_per_gm: 60,
      }],
    }))
    check('balance unchanged after the refusal', balance(maniId).balance_wt, 115)

    head('6. Deleting the bill puts the weight back')
    api.sale.remove({ id: saleId })
    check('ten grams returned', balance(maniId).balance_wt, 125)

    head('7. On a weight-wise bill beads are still paid for in rupees')
    // 10 g of 22K gold sold against nothing taken in: 9.16 g fine owed, settled
    // in full at 6,000/g = 54,960. The mani rides alongside at 600 cash.
    const { id: wwId } = api.sale.save({
      head: {
        prefix: 'COM', bill_date: DAY, party_id: customer, party_name: 'Walk-in',
        gst_not_required: 1, weightwise: 1, payment_mode: 'Cash', amount_received: 0,
      },
      items: [
        { item_id: payalId, item_name: 'Payal', gross_wt: 10, net_wt: 10, purity: 91.6, rate_per_gm: 6000 },
        { item_id: maniId, item_name: 'Mani', gross_wt: 10, net_wt: 10, purity: 0, rate_per_gm: 60 },
      ],
      metals: [{ metal: 'Gold', balance_wt: 9.16, rate_per_gm: 6000 }],
    })
    const ww = api.sale.read({ id: wwId })
    const gold = ww.metals.find((m) => m.metal === 'Gold')
    check('only the gold settles in fine weight', gold.fine_sold, 9.16)
    check('one metal row, beads excluded', ww.metals.length, 1)
    check('goods = settled metal + the beads in rupees', ww.goods_amount, 55560)
    check('mani still left the lot', balance(maniId).balance_wt, 115)

    head('8. A loose item in use cannot be deleted')
    throws('deleting an item with movements', () => api.item.remove({ id: maniId }))

    head('9. Physical count adjustment')
    api.looseItem.adjust({ item_id: maniId, gross_wt: -2, remark: 'counted short', entry_date: DAY })
    check('shortage booked', balance(maniId).balance_wt, 113)
    const last = api.looseItem.ledger({ item_id: maniId }).slice(-1)[0]
    check('adjustment is its own movement', last.doc_type, 'ADJUST')
    check('running balance on the ledger', last.balance_wt, 113)

    head('10. A loose item cannot be tagged or sent out past its lot')
    throws('tagging a loose item', () =>
      api.tagStock.saveBatch({ itemId: maniId, rows: [{ gross_wt: 76.32, purity: 75 }] }))
    check('lot untouched by the refused tag', balance(maniId).balance_wt, 113)
    throws('purchase sending out more than is on hand', () => api.purchase.save({
      head: {
        prefix: 'PUR', invoice_date: DAY, party_id: supplier, party_name: 'Bead Supplier',
        metal: 'Gold', gst_not_required: 1, amount_paid: 0,
      },
      items: [{
        item_id: maniId, item_name: 'Mani', direction: 'OUT',
        gross_wt: 500, net_wt: 500, purity: 0, rate: 35, wastage_pct: 0,
      }],
    }))
    check('lot never goes below zero', balance(maniId).balance_wt, 113)

    head('11. A tag left on a loose item by an older build is folded into its lot')
    // The shop's case: Mani (loose) carries tag MANI00001 of 76.320 g, and a
    // 3.250 g sale came off the lot, leaving it at -3.250 g.
    const raw = db.get()
    const fuliId = api.item.save({
      name: 'Fuli', item_type_id: g22.item_type_id, item_group_id: g22.id,
      design_id: null, weight_mode: 'WEIGHT', stock_mode: 'LOOSE_WT', uom: 'GRAM', hsn: '7117', image: '',
    })
    const tagId = raw.prepare(
      `INSERT INTO tag_stock (tag, item_id, gross_wt, net_wt, purity, final_wt, entry_date)
       VALUES ('FULI00001', ?, 76.32, 76.32, 75, 57.24, ?)`).run(fuliId, DAY).lastInsertRowid
    raw.prepare(
      `INSERT INTO loose_stock (metal, gross_wt, net_wt, fine_wt, doc_type, doc_id, doc_no,
       direction, is_tagged, entry_date) VALUES ('Gold',76.32,76.32,57.24,'OPENING',?,'FULI00001','IN',1,?)`
    ).run(tagId, DAY)
    raw.prepare(
      `INSERT INTO item_stock (item_id, gross_wt, doc_type, direction, entry_date)
       VALUES (?, 3.25, 'SALE', 'OUT', ?)`).run(fuliId, DAY)
    check('before: lot is below zero', balance(fuliId).balance_wt, -3.25)
    db.close(); db.open(tmp)
    check('after reopen: lot holds the tag less the sale', balance(fuliId).balance_wt, 73.07)
    check('the tag is gone from stock',
      db.get().prepare(`SELECT COUNT(*) c FROM tag_stock WHERE tag='FULI00001' AND status='IN_STOCK'`).get().c, 0)
    check('its gold inflow is taken back',
      db.get().prepare(`SELECT COUNT(*) c FROM loose_stock WHERE doc_type='OPENING' AND doc_id=?`).get(tagId).c, 0)
    db.close(); db.open(tmp)
    check('folding again changes nothing', balance(fuliId).balance_wt, 73.07)

    head('12. Taking weight back off a lot cannot leave it owing')
    // 50 g of dori bought, 40 g of it sold. The purchase cannot now be cut to
    // 20 g or deleted, and a return of 10 g cannot be undone once resold:
    // each would leave the lot below zero with the grams already out the door.
    const doriId = api.item.save({
      name: 'Dori', item_type_id: g22.item_type_id, item_group_id: g22.id,
      design_id: null, weight_mode: 'WEIGHT', stock_mode: 'LOOSE_WT', uom: 'GRAM', hsn: '7117', image: '',
    })
    const doriHead = {
      prefix: 'PUR', invoice_date: DAY, party_id: supplier, party_name: 'Bead Supplier',
      metal: 'Gold', gst_not_required: 1, amount_paid: 0,
    }
    const doriLine = (wt) => ({
      item_id: doriId, item_name: 'Dori', direction: 'IN',
      gross_wt: wt, net_wt: wt, purity: 0, rate: 35, wastage_pct: 0,
    })
    const dp = api.purchase.save({ head: doriHead, items: [doriLine(50)] })
    const sellDori = (wt) => api.sale.save({
      head: {
        prefix: 'Service', bill_date: DAY, party_id: customer, party_name: 'Walk-in',
        gst_not_required: 1, payment_mode: 'Cash', amount_received: 0,
      },
      items: [{ item_id: doriId, item_name: 'Dori', gross_wt: wt, net_wt: wt, purity: 0, rate_per_gm: 60 }],
    })
    const ds = sellDori(40)
    check('dori on hand', balance(doriId).balance_wt, 10)
    throws('cutting the purchase below what has been sold', () => api.purchase.save({
      head: { ...doriHead, id: dp.id, invoice_no: dp.invoice_no }, items: [doriLine(20)],
    }))
    check('lot unchanged by the refused edit', balance(doriId).balance_wt, 10)
    throws('deleting the purchase once its beads are sold', () => api.purchase.remove({ id: dp.id }))
    check('lot unchanged by the refused delete', balance(doriId).balance_wt, 10)
    // A correction that leaves enough on hand still goes through.
    api.purchase.save({ head: { ...doriHead, id: dp.id, invoice_no: dp.invoice_no }, items: [doriLine(45)] })
    check('a smaller cut is allowed', balance(doriId).balance_wt, 5)
    const dr = api.saleReturn.save({
      head: { return_date: DAY, party_id: customer, party_name: 'Walk-in', against_sale_id: ds.id, gst_pct: 0 },
      items: [{ item_id: doriId, item_name: 'Dori', gross_wt: 10, net_wt: 10, purity: 0, rate_per_gm: 60 }],
    })
    check('returned beads back in the lot', balance(doriId).balance_wt, 15)
    sellDori(15)
    check('and sold again', balance(doriId).balance_wt, 0)
    throws('undoing the return once those beads are resold', () => api.saleReturn.remove({ id: dr.id }))
    check('lot never goes below zero', balance(doriId).balance_wt, 0)
  } catch (e) {
    fail++
    console.log('  ERROR', e && e.stack ? e.stack : e)
  }

  console.log(`\n${pass} passed, ${fail} failed`)
  app.exit(fail ? 1 : 0)
})
