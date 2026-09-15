/**
 * Purchase ↔ labels, and a purchase paid in fine metal.
 *
 * The owner's three asks after running the shop on it:
 *   · the purchase register must show WEIGHT, not only money
 *   · a purchase can be settled in fine metal, not only rupees
 *   · once the bought metal is labelled, the invoice must say whether the
 *     labels TALLY with what was bought — and until then the metal can still
 *     be sold loose, by weight, without a label
 * Plus the silver case: pieces made from a silver purchase come out of the
 * silver pool, not the gold one.
 *    npm run test:purchasetally
 */
const { app } = require('electron')
const path = require('node:path')
const fs = require('node:fs')
const os = require('node:os')

const DAY = '2026-09-10'

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
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'parivar-tally-'))
  const db = require('../electron/db.cjs')
  db.open(tmp)
  const api = require('../electron/api.cjs')

  try {
    const g22 = api.itemGroup.list().find((x) => x.name === '22K Gold')
    const gSilver = api.itemGroup.list().find((x) => /silver/i.test(x.name))
    const ringId = api.item.save({
      name: 'Ring', item_type_id: g22.item_type_id, item_group_id: g22.id,
      design_id: null, weight_mode: 'WEIGHT', uom: 'GRAM', hsn: '7113', image: '',
    })
    const maniId = api.item.save({
      name: 'Mani', item_type_id: g22.item_type_id, item_group_id: g22.id,
      design_id: null, weight_mode: 'WEIGHT', stock_mode: 'LOOSE_WT',
      uom: 'GRAM', hsn: '7117', image: '',
    })
    const payalId = api.item.save({
      name: 'Payal', item_type_id: gSilver.item_type_id, item_group_id: gSilver.id,
      design_id: null, weight_mode: 'WEIGHT', uom: 'GRAM', hsn: '7113', image: '',
    })
    const supplier = api.party.save({ name: 'Bullion House', party_type: 'SUPPLIER' })
    const customer = api.party.save({ name: 'Walk-in', party_type: 'CUSTOMER' })
    const goldBefore = api.looseStock.summary({ metal: 'Gold' }).available_fine

    head('1. Purchase register carries weight')
    // 50 g of 22K rings at 91.6 + 2% wastage, and 100 g of mani by the gram.
    const { id: puId, tally: t0 } = api.purchase.save({
      head: { prefix: 'MI', invoice_date: DAY, party_id: supplier, party_name: 'Bullion House',
              is_credit: 1, gst_pct: 0, paid_amount: 0, metal: 'Gold' },
      items: [
        { item_id: ringId, item_name: 'Ring', qty: 5, gross_wt: 52, stone_wt: 2, net_wt: 50,
          purity: 91.6, rate: 6000, wastage_pct: 2, hallmark_charges: 0 },
        { item_id: maniId, item_name: 'Mani', qty: 0, gross_wt: 100, stone_wt: 0, net_wt: 100,
          purity: 0, rate: 35, wastage_pct: 0, hallmark_charges: 0 },
      ],
    })
    const reg = api.purchase.list({ from: DAY, to: DAY }).find((r) => r.id === puId)
    check('register gross (rings + mani)', reg.in_gross_wt, 152)
    check('register net', reg.in_net_wt, 150)
    check('register fine (rings only, with wastage)', reg.in_fine_wt, 46.8)
    check('nothing labelled yet → pending', reg.tally.status, 'PENDING')
    check('tally counts only the metal lines', reg.tally.bought_net, 50)
    check('beads are not waiting for a label', reg.tally.bought_gross, 52)
    check('save returns the tally too', t0.pending_net, 50)
    check('gold pool grew by the fine bought', api.looseStock.summary({ metal: 'Gold' }).available_fine, goldBefore + 46.8)

    head('2. Sell some of it loose, before any label')
    const { id: looseSale } = api.sale.save({
      head: { prefix: 'COM', bill_date: DAY, party_id: customer, party_name: 'Walk-in',
              gst_not_required: 1, payment_mode: 'Cash', amount_received: 0 },
      items: [{ item_id: ringId, item_name: 'Ring', gross_wt: 10, net_wt: 10, purity: 91.6, rate_per_gm: 6500 }],
    })
    check('untagged sale left the loose pool', api.looseStock.summary({ metal: 'Gold' }).available_fine, goldBefore + 46.8 - 9.16)
    check('the purchase tally is unaffected — labels, not sales', api.purchase.tally({ id: puId }).pending_net, 50)
    const { id: retId } = api.saleReturn.save({
      head: { prefix: 'SR', return_date: DAY, party_id: customer, party_name: 'Walk-in',
              against_sale_id: looseSale, gst_not_required: 1 },
      items: [{ item_id: ringId, item_name: 'Ring', gross_wt: 10, net_wt: 10, purity: 91.6, rate_per_gm: 6500 }],
    })
    check('returned untagged metal is loose again', api.looseStock.summary({ metal: 'Gold' }).available_fine, goldBefore + 46.8)
    api.saleReturn.remove({ id: retId })
    api.sale.remove({ id: looseSale })
    check('both undone → pool back', api.looseStock.summary({ metal: 'Gold' }).available_fine, goldBefore + 46.8)

    head('3. Labels made from the purchase')
    const c1 = api.looseStock.convert({
      itemId: ringId, purchaseId: puId, entry_date: DAY,
      rows: [
        { gross_wt: 10.4, stone_wt: 0.4, purity: 91.6, qty: 1 },
        { gross_wt: 10.4, stone_wt: 0.4, purity: 91.6, qty: 1 },
        { gross_wt: 10.4, stone_wt: 0.4, purity: 91.6, qty: 1 },
      ],
    })
    check('three tags made', c1.created, 3)
    check('convert reports the tally', c1.tally.status, 'PENDING')
    check('30 g labelled', c1.tally.tagged_net, 30)
    check('20 g still to label', c1.tally.pending_net, 20)
    const listed = api.purchase.list({ from: DAY, to: DAY }).find((r) => r.id === puId)
    check('register badge: pending 20 g', listed.tally.pending_net, 20)
    const open = api.purchase.openForTagging().find((p) => p.id === puId)
    check('offered on the tag screen while pending', !!open, 'true')
    check('tag carries its purchase', api.tagStock.list({ status: 'IN_STOCK' })
      .filter((t) => t.purchase_no === listed.invoice_no).length, 3)

    const c2 = api.looseStock.convert({
      itemId: ringId, purchaseId: puId, entry_date: DAY,
      rows: [
        { gross_wt: 10.4, stone_wt: 0.4, purity: 91.6, qty: 1 },
        { gross_wt: 10.4, stone_wt: 0.4, purity: 91.6, qty: 1 },
      ],
    })
    check('now tallied', c2.tally.status, 'TALLIED')
    check('five pieces on the invoice', c2.tally.tagged_pieces, 5)
    check('no longer offered for tagging', api.purchase.openForTagging().some((p) => p.id === puId), 'false')
    const full = api.purchase.tally({ id: puId })
    check('tally lists the tags', full.tags.length, 5)
    check('read() carries the tally', api.purchase.read({ id: puId }).tally.status, 'TALLIED')

    head('4. Over-labelling is flagged, not hidden')
    api.looseStock.convert({
      itemId: ringId, purchaseId: puId, entry_date: DAY, allowOverdraw: true,
      rows: [{ gross_wt: 3, purity: 91.6, qty: 1 }],
    })
    check('over by 3 g', api.purchase.tally({ id: puId }).status, 'OVER')
    check('over amount', api.purchase.tally({ id: puId }).pending_net, -3)

    head('5. A purchase paid in fine metal')
    const supplierGoldBefore = api.party.metalBalance({ id: supplier, metal: 'Gold' }).balance
    const supplierMoneyBefore = api.party.balance({ id: supplier }).balance
    const poolBefore = api.looseStock.summary({ metal: 'Gold' }).available_fine
    // Gold is quoted for 99.5 touch, so 100 g fine at 7000/g bills 100×100×7000/99.5.
    const BILL = Math.round(100 * 100 * 7000 / 99.5 * 100) / 100
    const { id: pu2 } = api.purchase.save({
      head: { prefix: 'MI', invoice_date: DAY, party_id: supplier, party_name: 'Bullion House',
              is_credit: 1, gst_pct: 0, paid_amount: 10000,
              paid_fine_wt: 20, paid_fine_rate: 7000, metal: 'Gold' },
      items: [{ item_id: ringId, item_name: 'Ring', qty: 0, gross_wt: 100, stone_wt: 0, net_wt: 100,
                purity: 100, rate: 7000, wastage_pct: 0, hallmark_charges: 0 }],
    })
    const p2 = api.purchase.read({ id: pu2 })
    check('bill amount', p2.bill_amount, BILL)
    check('fine paid value = 20 g × 7000', p2.paid_fine_amount, 140000)
    check('balance = bill − cash − fine', p2.net_balance, BILL - 10000 - 140000)
    check('supplier owes us the fine we gave (100 in − 20 out)',
      api.party.metalBalance({ id: supplier, metal: 'Gold' }).balance, supplierGoldBefore - 100 + 20)
    check('loose pool: +100 bought, −20 handed over',
      api.looseStock.summary({ metal: 'Gold' }).available_fine, poolBefore + 100 - 20)
    check('money khata: creditor up by the unpaid balance only',
      api.party.balance({ id: supplier }).balance, supplierMoneyBefore - (BILL - 10000 - 140000))
    check('summary shows the fine still due (100 in − 20 paid)',
      require('../electron/calc.cjs').purchaseTotals(p2, p2.items).totals.fine_due_wt, 80)
    const khata = api.reports.metalLedger({ partyId: supplier, metal: 'Gold' })
    check('gold khata shows the fine payment as its own line',
      [...khata.debits, ...khata.credits].filter((r) => /Paid in fine/.test(r.particulars)).length, 1)

    // Editing it to a different fine payment re-posts, never doubles.
    api.purchase.save({
      head: { ...p2, paid_fine_wt: 30, paid_fine_rate: 7000 },
      items: p2.items,
    })
    check('edited: balance re-taken', api.purchase.read({ id: pu2 }).net_balance, BILL - 10000 - 210000)
    check('edited: pool re-taken', api.looseStock.summary({ metal: 'Gold' }).available_fine, poolBefore + 100 - 30)
    api.purchase.remove({ id: pu2 })
    check('deleted: pool back', api.looseStock.summary({ metal: 'Gold' }).available_fine, poolBefore)
    check('deleted: khata back', api.party.metalBalance({ id: supplier, metal: 'Gold' }).balance, supplierGoldBefore)

    head('6. Silver pieces come out of the silver pool')
    const silverBefore = api.looseStock.summary({ metal: 'Silver' }).available_fine
    const goldNow = api.looseStock.summary({ metal: 'Gold' }).available_fine
    const { id: puAg } = api.purchase.save({
      head: { prefix: 'MI', invoice_date: DAY, party_id: supplier, party_name: 'Bullion House',
              is_credit: 1, gst_pct: 0, paid_amount: 0, metal: 'Silver' },
      items: [{ item_id: payalId, item_name: 'Payal', qty: 0, gross_wt: 200, stone_wt: 0, net_wt: 200,
                purity: 92.5, rate: 80, wastage_pct: 0, hallmark_charges: 0 }],
    })
    check('silver pool grew', api.looseStock.summary({ metal: 'Silver' }).available_fine, silverBefore + 185)
    const cAg = api.looseStock.convert({
      itemId: payalId, purchaseId: puAg, entry_date: DAY,
      rows: [{ gross_wt: 100, purity: 92.5, qty: 1 }, { gross_wt: 100, purity: 92.5, qty: 1 }],
    })
    check('converted as silver', cAg.metal, 'Silver')
    check('silver purchase tallies', cAg.tally.status, 'TALLIED')
    check('silver pool: metal changed form, not amount',
      api.looseStock.summary({ metal: 'Silver' }).available_fine, silverBefore + 185 - 185)
    check('gold pool untouched by the silver work', api.looseStock.summary({ metal: 'Gold' }).available_fine, goldNow)
    throws('gold pieces cannot be booked against a silver purchase', () => api.looseStock.convert({
      itemId: ringId, purchaseId: puAg, entry_date: DAY, allowOverdraw: true,
      rows: [{ gross_wt: 1, purity: 91.6, qty: 1 }],
    }))
  } catch (e) {
    fail++
    console.log('  ERROR', e && e.stack ? e.stack : e)
  }

  console.log(`\n${pass} passed, ${fail} failed`)
  app.exit(fail ? 1 : 0)
})
