/**
 * Loose weight-wise items — the flows AROUND the bill.
 *
 * test/looseitem.cjs covers buying and selling a lot. This one covers what
 * happens afterwards, which is where beads leak out of the books:
 *   · goods coming back (sales return) must go back INTO the lot
 *   · goods going back to the supplier (purchase return) must come OUT of it
 *   · a bead line on a purchase must never reach the supplier's GOLD khata,
 *     even though the item master seeds a purity from its group
 *   · a lot cannot be corrected or re-opened into a negative balance
 *   · an item that already holds stock cannot switch how it is stocked
 *    npm run test:looseflow
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
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'parivar-looseflow-'))
  const db = require('../electron/db.cjs')
  db.open(tmp)
  const api = require('../electron/api.cjs')

  const balance = (id) => api.looseItem.balances().find((b) => b.id === id)

  try {
    const g22 = api.itemGroup.list().find((x) => x.name === '22K Gold')
    const maniId = api.item.save({
      name: 'Mani', item_type_id: g22.item_type_id, item_group_id: g22.id,
      design_id: null, weight_mode: 'WEIGHT', stock_mode: 'LOOSE_WT',
      uom: 'GRAM', hsn: '7117', image: '',
    })
    const payalId = api.item.save({
      name: 'Payal', item_type_id: g22.item_type_id, item_group_id: g22.id,
      design_id: null, weight_mode: 'WEIGHT', uom: 'GRAM', hsn: '7113', image: '',
    })
    const supplier = api.party.save({ name: 'Bead Supplier', party_type: 'SUPPLIER' })
    const customer = api.party.save({ name: 'Walk-in', party_type: 'CUSTOMER' })

    head('1. Buying beads must not touch the gold khata')
    // The purchase screen seeds a line's purity from the item's group, so a
    // mani bought against "22K Gold" arrives carrying 91.6 unless something
    // stops it. If it is not stopped, 100 g of beads lands on the supplier's
    // fine-weight account as though it were gold.
    const pur = api.purchase.save({
      head: {
        prefix: 'PUR', invoice_date: DAY, party_id: supplier, party_name: 'Bead Supplier',
        metal: 'Gold', gst_not_required: 1,
      },
      items: [{
        item_id: maniId, item_name: 'Mani', direction: 'IN',
        gross_wt: 100, net_wt: 100, purity: 91.6, rate: 35, wastage_pct: 0,
      }],
    })
    check('the lot is on the item', balance(maniId).balance_wt, 100)
    check('no fine weight on the purchase',
      api.purchase.read({ id: pur.id }).total_fine_wt ?? 0, 0)
    check('supplier owes us no gold',
      api.party.metalBalance({ id: supplier }).balance, 0)

    head('2. A sales return puts the weight back in the lot')
    const sale = api.sale.save({
      head: {
        prefix: 'COM', bill_date: DAY, party_id: customer, party_name: 'Walk-in',
        gst_not_required: 1, payment_mode: 'Cash', amount_received: 0,
      },
      items: [{
        item_id: maniId, item_name: 'Mani', gross_wt: 10, net_wt: 10,
        purity: 0, rate_per_gm: 60,
      }],
    })
    check('ten grams gone', balance(maniId).balance_wt, 90)
    const sold = api.sale.read({ id: sale.id }).items[0]
    api.saleReturn.save({
      head: {
        return_date: DAY, party_id: customer, party_name: 'Walk-in',
        against_sale_id: sale.id, gst_pct: 0,
      },
      items: [{
        item_id: sold.item_id, item_name: 'Mani', gross_wt: 10, net_wt: 10,
        purity: 0, rate_per_gm: 60,
      }],
    })
    check('the beads are back in the lot', balance(maniId).balance_wt, 100)
    check('and the return is on the weight ledger',
      api.looseItem.ledger({ item_id: maniId }).filter((r) => r.doc_type === 'SALERET').length, 1)

    head('3. A purchase return takes the weight out again')
    const pret = api.purchaseReturn.save({
      head: {
        return_date: DAY, party_id: supplier, party_name: 'Bead Supplier',
        against_purchase_id: pur.id, gst_pct: 0,
      },
      items: [{
        item_id: maniId, item_name: 'Mani', gross_wt: 20, net_wt: 20,
        purity: 0, rate_per_gm: 35,
      }],
    })
    check('twenty grams went back', balance(maniId).balance_wt, 80)
    api.purchaseReturn.remove({ id: pret.id })
    check('undoing the return restores the lot', balance(maniId).balance_wt, 100)

    head('4. The lot cannot be driven negative')
    throws('a correction bigger than the lot', () =>
      api.looseItem.adjust({ item_id: maniId, gross_wt: -500, entry_date: DAY }))
    check('balance unchanged after the refusal', balance(maniId).balance_wt, 100)
    // Re-entering an opening replaces the old one, so correcting it downwards can
    // pull the lot below what has already gone out on documents.
    api.looseItem.opening({ item_id: maniId, gross_wt: 50, rate: 35, entry_date: DAY })
    check('opening on top of the lot', balance(maniId).balance_wt, 150)
    api.sale.save({
      head: {
        prefix: 'COM', bill_date: DAY, party_id: customer, party_name: 'Walk-in',
        gst_not_required: 1, payment_mode: 'Cash', amount_received: 0,
      },
      items: [{
        item_id: maniId, item_name: 'Mani', gross_wt: 140, net_wt: 140,
        purity: 0, rate_per_gm: 60,
      }],
    })
    check('almost all of it is sold', balance(maniId).balance_wt, 10)
    throws('an opening that leaves less than has been sold', () =>
      api.looseItem.opening({ item_id: maniId, gross_wt: 5, rate: 35, entry_date: DAY }))
    check('the opening is untouched', balance(maniId).balance_wt, 10)

    head('5. How an item is stocked cannot change under its stock')
    const mani = api.item.list().find((x) => x.id === maniId)
    throws('switching a loose item with weight on it to tagged', () =>
      api.item.save({ ...mani, stock_mode: 'TAG' }))
    check('it is still loose', api.item.list().find((x) => x.id === maniId).stock_mode, 'LOOSE_WT')

    const madeIds = api.tagStock.saveBatch({
      itemId: payalId,
      rows: [{ gross_wt: 10, purity: 91.6, entry_date: DAY }],
    })
    // Save & Print reads back exactly the pieces it just made.
    const made = api.tagStock.list({ ids: madeIds })
    check('Save & Print finds the new piece', made.length, 1)
    check('with its item name for the label', made[0].item_name ? 'yes' : 'no', 'yes')
    check('an empty id list finds nothing', api.tagStock.list({ ids: [] }).length, 0)
    const payal = api.item.list().find((x) => x.id === payalId)
    throws('switching a tagged item with tags on it to loose', () =>
      api.item.save({ ...payal, stock_mode: 'LOOSE_WT' }))
    check('it is still tagged', api.item.list().find((x) => x.id === payalId).stock_mode, 'TAG')

    head('6. The item master decides, not the flag on the line')
    // Typing over a picked item can leave is_loose behind at 0 while item_id
    // still points at the lot. If the bill believed that flag the beads would
    // walk out without leaving the lot — and their grams would land on gold.
    const before = balance(maniId).balance_wt
    const goldBefore = api.party.metalBalance({ id: customer }).balance
    api.sale.save({
      head: {
        prefix: 'COM', bill_date: DAY, party_id: customer, party_name: 'Walk-in',
        gst_not_required: 1, payment_mode: 'Cash', amount_received: 0,
      },
      items: [{
        item_id: maniId, item_name: 'Mani', is_loose: 0,
        gross_wt: 5, net_wt: 5, purity: 91.6, rate_per_gm: 60,
      }],
    })
    check('the lot still moved', balance(maniId).balance_wt, before - 5)
    check('and no gold was billed', api.party.metalBalance({ id: customer }).balance, goldBefore)

    head('7. Loose lots are visible where stock is reported')
    const onHand = balance(maniId).balance_wt
    const rep = api.reports.stock({ status: 'IN_STOCK' })
    const lot = (rep.loose || []).find((r) => r.id === maniId)
    check('the lot is on the stock report', lot ? lot.balance_wt : -1, onHand)
    // Costed at moving average: everything the lot cost, over everything that
    // came into it. The purchase went in at 35/g, the opening at 35/g too.
    check('valued at what it cost', lot.cost_rate, 35)
    check('and the value follows the weight', lot.cost_value, Number((onHand * 35).toFixed(2)))
    check('the report totals it', rep.looseTotals.cost_value, lot.cost_value)
    check('pieces and lots add up to what is held',
      rep.totals.total_cost_value, Number((rep.totals.cost_value + lot.cost_value).toFixed(2)))
    // A lot cannot be "sold" the way a tagged piece can, so it has no place on a
    // sold-stock view.
    check('no lots on the sold view', (api.reports.stock({ status: 'SOLD' }).loose || []).length, 0)

    const dayb = api.reports.dayBook({ from: DAY, to: DAY })
    const strip = (dayb.looseItems || []).find((r) => r.item_id === maniId)
    check('the day book closes the lot where it stands', strip ? strip.closing : -1, onHand)
    check('and opens it at nil — it was all bought today', strip.opening, 0)
  } catch (e) {
    fail++
    console.log('  ERROR', e && e.stack ? e.stack : e)
  }

  console.log(`\n${pass} passed, ${fail} failed`)
  app.exit(fail ? 1 : 0)
})
