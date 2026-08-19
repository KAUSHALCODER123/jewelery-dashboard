/**
 * Multi-metal — docs/VIDEO-SPEC-2.md §16.
 *
 * Every piece has a metal, read from its item type (Gold / Silver / Platinum).
 * A bill that mixes metals must keep them apart: gold owed is gold, silver owed
 * is silver, and the two never fold into one another. This suite proves the
 * retail path (tag → sell → return) now carries the piece's real metal end to end.
 *    npm run test:multimetal
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
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'parivar-mm-'))
  const db = require('../electron/db.cjs')
  db.open(tmp)
  const api = require('../electron/api.cjs')

  const groups = api.itemGroup.list()
  const g = (name) => groups.find((x) => x.name === name)
  const mkItem = (name, group) => api.item.save({
    name, item_type_id: group.item_type_id, item_group_id: group.id,
    design_id: null, weight_mode: 'WEIGHT', uom: 'GRAM', hsn: '7113', image: '',
  })

  try {
    head('1. Tag a gold piece and a silver piece')
    const goldItem = mkItem('Gold Chain', g('22K Gold'))
    const silverItem = mkItem('Silver Payal', g('Silver'))
    api.tagStock.saveBatch({ itemId: goldItem, rows: [{ gross_wt: 10, purity: 100, entry_date: DAY }] })
    api.tagStock.saveBatch({ itemId: silverItem, rows: [{ gross_wt: 50, purity: 100, entry_date: DAY }] })
    const goldTag = api.tagStock.list({ status: 'IN_STOCK', search: 'GOL' })[0]
    const silverTag = api.tagStock.list({ status: 'IN_STOCK', search: 'SIL' })[0]

    // Stock is tracked in the right metal pool, kept apart.
    check('gold stock', api.looseStock.summary({ metal: 'Gold' }).total_fine, 10)
    check('silver stock', api.looseStock.summary({ metal: 'Silver' }).total_fine, 50)

    head('2. One bill, both metals')
    const custId = api.party.save({
      party_type: 'CUSTOMER', name: 'Vikram Sethi', state: 'Maharashtra', metals: [],
    })
    api.sale.save({
      head: {
        prefix: 'COM', bill_date: DAY, party_id: custId, party_name: 'Vikram Sethi',
        state: 'Maharashtra', is_credit: 1, payment_mode: 'Cash', gst_pct: 3,
        bill_discount: 0, making_discount: 0, other_amount: 0,
        manual_urd_amount: 0, tcs_pct: 0, amount_received: 0,
      },
      items: [
        { tag: goldTag.tag, tag_stock_id: goldTag.id, item_id: goldItem, item_name: 'Gold Chain',
          hsn: '7113', qty: 0, gross_wt: 10, purity: 100, stone_wt: 0, net_wt: 10,
          rate_per_gm: 5000, mkg_per_gm: 0, hallmark_charges: 0 },
        { tag: silverTag.tag, tag_stock_id: silverTag.id, item_id: silverItem, item_name: 'Silver Payal',
          hsn: '7113', qty: 0, gross_wt: 50, purity: 100, stone_wt: 0, net_wt: 50,
          rate_per_gm: 80, mkg_per_gm: 0, hallmark_charges: 0 },
      ],
    })

    head('3. The two khatas are kept apart')
    check('customer owes 10 g gold', api.party.metalBalance({ id: custId, metal: 'Gold' }).balance, 10)
    check('customer owes 50 g silver', api.party.metalBalance({ id: custId, metal: 'Silver' }).balance, 50)
    check('no platinum involved', api.party.metalBalance({ id: custId, metal: 'Platinum' }).balance, 0)
    // Two separate metal-ledger rows were posted, not one lumped-together row.
    const entries = db.get().prepare(
      `SELECT metal, fine_out FROM metal_entry WHERE party_id = ? AND doc_type='SALE' ORDER BY metal`
    ).all(custId)
    check('two metal rows posted', entries.length, 2)
    check('first is gold', `${entries[0].metal}:${entries[0].fine_out}`, 'Gold:10')
    check('second is silver', `${entries[1].metal}:${entries[1].fine_out}`, 'Silver:50')

    head('4. Metal outstanding is per metal')
    check('gold outstanding lists the customer',
      api.reports.metalOutstanding({ metal: 'Gold' }).some((r) => r.id === custId), true)
    check('gold balance in the list',
      api.reports.metalOutstanding({ metal: 'Gold' }).find((r) => r.id === custId).balance, 10)
    check('silver balance in the list',
      api.reports.metalOutstanding({ metal: 'Silver' }).find((r) => r.id === custId).balance, 50)

    head('5. Returning the silver piece clears only the silver khata')
    const s = api.sale.list({})[0]
    api.saleReturn.save({
      head: {
        return_date: DAY, party_id: custId, party_name: 'Vikram Sethi',
        against_sale_id: s.id, against_bill_no: s.bill_no, reason: 'Wrong size',
        gst_pct: 3, refund_amount: 0,
      },
      items: [{
        tag: silverTag.tag, tag_stock_id: silverTag.id, item_id: silverItem,
        item_name: 'Silver Payal', qty: 0, gross_wt: 50, stone_wt: 0, net_wt: 50,
        purity: 100, rate_per_gm: 80, mkg_per_gm: 0,
      }],
    })
    check('silver khata cleared', api.party.metalBalance({ id: custId, metal: 'Silver' }).balance, 0)
    check('gold khata untouched', api.party.metalBalance({ id: custId, metal: 'Gold' }).balance, 10)
    check('silver piece back in stock',
      api.tagStock.list({ status: 'IN_STOCK', search: 'SIL' }).length, 1)

    head('6. Silver flows through purchase, karagir and settlement')
    // A silver purchase from a supplier posts to the SILVER khata and stock.
    const supId = api.party.save({ party_type: 'SUPPLIER', name: 'Silver Mart', state: 'Maharashtra', metals: [] })
    const silverBefore = api.looseStock.summary({ metal: 'Silver' }).total_fine
    api.purchase.save({
      head: { prefix: 'MI', invoice_date: DAY, party_id: supId, party_name: 'Silver Mart',
              is_credit: 1, gst_pct: 0, paid_amount: 0, metal: 'Silver' },
      items: [{ item_name: 'Silver Bar', qty: 0, gross_wt: 100, stone_wt: 0, net_wt: 100,
                purity: 100, rate: 80, wastage_pct: 0, hallmark_charges: 0 }],
    })
    check('supplier silver khata (Cr 100)', api.party.metalBalance({ id: supId, metal: 'Silver' }).balance, -100)
    check('supplier gold khata untouched', api.party.metalBalance({ id: supId, metal: 'Gold' }).balance, 0)
    check('silver stock grew by 100', api.looseStock.summary({ metal: 'Silver' }).total_fine, silverBefore + 100)

    // Issuing silver to a karagir moves it onto his silver account.
    const karId = api.party.save({ party_type: 'KARAGIR', name: 'Silver Smith', state: 'Maharashtra', metals: [] })
    api.karagir.issue({
      issue_date: DAY, karagir_id: karId, karagir_name: 'Silver Smith',
      item_name: 'Payal', gross_wt: 30, purity: 100, metal: 'Silver',
    })
    check('karagir owes 30 g silver', api.party.metalBalance({ id: karId, metal: 'Silver' }).balance, 30)
    check('karagir gold account is clear', api.party.metalBalance({ id: karId, metal: 'Silver' }).balance -
      api.party.metalBalance({ id: karId, metal: 'Gold' }).balance, 30)

    // Settling a customer's silver for cash clears the SILVER khata, not gold.
    // Vikram still owes 10 g gold from section 3; give him a silver debt to settle.
    const cust2 = api.party.save({ party_type: 'CUSTOMER', name: 'Silver Buyer', state: 'Maharashtra', metals: [] })
    const sTag = api.tagStock.list({ status: 'IN_STOCK', search: 'SIL' })[0]
    const s2 = api.sale.save({
      head: { prefix: 'COM', bill_date: DAY, party_id: cust2, party_name: 'Silver Buyer',
              state: 'Maharashtra', is_credit: 1, payment_mode: 'Cash', gst_pct: 3,
              bill_discount: 0, making_discount: 0, other_amount: 0, manual_urd_amount: 0,
              tcs_pct: 0, amount_received: 0 },
      items: [{ tag: sTag.tag, tag_stock_id: sTag.id, item_id: silverItem, item_name: 'Silver Payal',
                hsn: '7113', qty: 0, gross_wt: 50, purity: 100, stone_wt: 0, net_wt: 50,
                rate_per_gm: 80, mkg_per_gm: 0, hallmark_charges: 0 }],
    })
    check('buyer owes 50 g silver', api.party.metalBalance({ id: cust2, metal: 'Silver' }).balance, 50)
    api.stockSettlement.save({
      settle_date: DAY, party_id: cust2, party_name: 'Silver Buyer', metal: 'Silver',
      direction: 'IN', fine_wt: 50, rate_per_gm: 80, paid_amount: 4000,
    })
    check('silver settled to zero', api.party.metalBalance({ id: cust2, metal: 'Silver' }).balance, 0)
  } catch (e) {
    fail++
    console.log('  ERROR', e && e.stack ? e.stack : e)
  }

  console.log(`\n${pass} passed, ${fail} failed`)
  app.exit(fail ? 1 : 0)
})
