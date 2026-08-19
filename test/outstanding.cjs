/**
 * Debtor / Creditor lists — docs/VIDEO-SPEC-2.md §5, gap #14.
 *
 * The same outstanding read two ways: money (rupees from the party ledger) and
 * metal (fine grams from the gold khata). Debtors owe us (Dr), creditors are
 * owed by us (Cr), and metal is never converted into a rupee figure.
 *    npm run test:outstanding
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
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'parivar-out-'))
  const db = require('../electron/db.cjs')
  db.open(tmp)
  const api = require('../electron/api.cjs')

  const g = (name) => api.itemGroup.list().find((x) => x.name === name)
  const mkItem = (name, group) => api.item.save({
    name, item_type_id: group.item_type_id, item_group_id: group.id,
    design_id: null, weight_mode: 'WEIGHT', uom: 'GRAM', hsn: '7113', image: '',
  })

  try {
    head('1. One customer owes, one supplier is owed')
    // Customer buys on credit → a money debtor and a gold debtor.
    const custId = api.party.save({ party_type: 'CUSTOMER', name: 'Asha Debtor', state: 'Maharashtra', metals: [] })
    const goldItem = mkItem('Gold Ring', g('22K Gold'))
    api.tagStock.saveBatch({ itemId: goldItem, rows: [{ gross_wt: 10, purity: 100, entry_date: DAY }] })
    const tag = api.tagStock.list({ status: 'IN_STOCK' })[0]
    api.sale.save({
      head: { prefix: 'COM', bill_date: DAY, party_id: custId, party_name: 'Asha Debtor',
              state: 'Maharashtra', is_credit: 1, payment_mode: 'Cash', gst_pct: 0,
              bill_discount: 0, making_discount: 0, other_amount: 0, manual_urd_amount: 0,
              tcs_pct: 0, amount_received: 0 },
      items: [{ tag: tag.tag, tag_stock_id: tag.id, item_id: goldItem, item_name: 'Gold Ring',
                hsn: '7113', qty: 0, gross_wt: 10, purity: 100, stone_wt: 0, net_wt: 10,
                rate_per_gm: 5000, mkg_per_gm: 0, hallmark_charges: 0 }],
    })
    // Supplier we owe money AND metal — an opening credit balance plus a purchase.
    const supId = api.party.save({
      party_type: 'SUPPLIER', name: 'Ratan Creditor', state: 'Maharashtra',
      opening_balance: 20000, opening_dr_cr: 'Cr', metals: [],
    })

    head('2. Money list splits debtors from creditors')
    const m = api.reports.outstandingList({ basis: 'money' })
    check('basis is money', m.basis, 'money')
    check('one debtor', m.debtors.length, 1)
    check('debtor is the customer', m.debtors[0].name, 'Asha Debtor')
    check('customer owes 50,000', m.debtors[0].balance, 50000)
    check('one creditor', m.creditors.length, 1)
    check('creditor is the supplier', m.creditors[0].name, 'Ratan Creditor')
    // Creditor balances are returned as a positive magnitude.
    check('we owe the supplier 20,000', m.creditors[0].balance, 20000)
    check('receivable total', m.debtorTotal, 50000)
    check('payable total', m.creditorTotal, 20000)

    head('3. Metal list is in fine grams, kept separate')
    const gold = api.reports.outstandingList({ basis: 'metal', metal: 'Gold' })
    check('basis is metal', gold.basis, 'metal')
    check('metal is gold', gold.metal, 'Gold')
    check('one gold debtor', gold.debtors.length, 1)
    check('customer owes 10 g gold', gold.debtors[0].balance, 10)
    check('gold receivable total', gold.debtorTotal, 10)
    // No silver has moved, so the silver list is empty — metals do not mix.
    const silver = api.reports.outstandingList({ basis: 'metal', metal: 'Silver' })
    check('no silver debtors', silver.debtors.length, 0)
    check('no silver creditors', silver.creditors.length, 0)

    head('4. Paying the bill clears the debtor from the list')
    api.voucher.save({
      kind: 'RECEIPT', voucher_date: DAY, party_id: custId, party_name: 'Asha Debtor',
      amount: 50000, payment_type: 'Cash',
    })
    const after = api.reports.outstandingList({ basis: 'money' })
    check('no money debtors left', after.debtors.length, 0)
    // The gold is still owed — a cash receipt does not touch the metal khata.
    check('but the gold is still outstanding',
      api.reports.outstandingList({ basis: 'metal', metal: 'Gold' }).debtors.length, 1)
  } catch (e) {
    fail++
    console.log('  ERROR', e && e.stack ? e.stack : e)
  }

  console.log(`\n${pass} passed, ${fail} failed`)
  app.exit(fail ? 1 : 0)
})
