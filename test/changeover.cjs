/**
 * Changeover Check — the instrument for running this software beside the shop's
 * existing books before trusting it.
 *
 * The thing being tested here is not arithmetic; it is whether the tool would
 * actually TELL YOU when the two disagree. A reconciliation screen that reports
 * agreement when it has not checked, or that shrugs at a mismatch, is worse than
 * no reconciliation at all — it converts an open question into false confidence.
 *    npm run test:changeover
 */
const { app } = require('electron')
const path = require('node:path')
const fs = require('node:fs')
const os = require('node:os')

const DAY = '2026-07-21'

let pass = 0
let fail = 0

function check(label, actual, expected, tol = 0.02) {
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
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'parivar-chg-'))
  const db = require('../electron/db.cjs')
  db.open(tmp)
  const api = require('../electron/api.cjs')

  const grp = (n) => api.itemGroup.list().find((x) => x.name === n)
  const g22 = grp('22K Gold')
  const ring = api.item.save({
    name: 'Gold Ring', item_type_id: g22.item_type_id, item_group_id: g22.id,
    design_id: null, weight_mode: 'WEIGHT', uom: 'GRAM', hsn: '7113', image: '',
  })
  const cust = api.party.save({
    name: 'Rekha Joshi', party_type: 'CUSTOMER', state: 'Maharashtra', opening_balance: 0,
  })
  const row = (d, key) => d.rows.find((r) => r.key === key)

  try {
    api.company.save({
      id: 1, name: 'Test Jewellers', state: 'Maharashtra',
      fy_start: '2026-04-01', fy_end: '2027-03-31',
    })
    const cashId = api.account.list().find((a) => a.name === 'Cash Account').id
    api.account.save({
      id: cashId, name: 'Cash Account', acc_type: 'Cash', acc_group: 'Current Asset',
      opening_balance: 100000, opening_dr_cr: 'Dr',
    })
    api.tagStock.saveBatch({
      itemId: ring,
      rows: [{ gross_wt: 20, purity: 100, purchase_rate: 6000, entry_date: DAY }],
    })
    const tag = api.tagStock.list({ status: 'IN_STOCK' })[0]
    api.sale.save({
      head: { prefix: 'COM', bill_date: DAY, party_id: cust, party_name: 'Rekha Joshi',
              state: 'Maharashtra', is_credit: 1, payment_mode: 'Cash', gst_pct: 3,
              bill_discount: 0, making_discount: 0, other_amount: 0, manual_urd_amount: 0,
              tcs_pct: 0, amount_received: 0 },
      items: [{ tag: tag.tag, tag_stock_id: tag.id, item_id: ring, item_name: 'Gold Ring',
                hsn: '7113', qty: 0, gross_wt: 20, purity: 100, stone_wt: 0, net_wt: 20,
                rate_per_gm: 7000, mkg_per_gm: 0, hallmark_charges: 0 }],
    })

    head('1. An unanswered question is not a pass')
    const blank = api.reports.reconcile({ as_on: DAY })
    check('nothing counted as checked', blank.checked, 0)
    check('and nothing counted as agreeing', blank.agreeing, 0)
    check('every line says so', blank.rows.every((r) => r.status === 'not checked'), true)
    check('no difference is invented', blank.rows.every((r) => r.difference === null), true)
    // This is the whole point: a blank form must not read as a clean bill of health.
    check('a blank form reports zero agreement, not total agreement', blank.differing, 0)

    head('2. It shows our own figure to check against')
    check('cash is the opening balance', row(blank, 'cash').ours, 100000)
    check('the customer owes the bill', row(blank, 'debtors').ours, 144200)
    check('gold on hand is nil — the piece was sold', row(blank, 'stock_fine').ours, 0)
    check('and the units are labelled', row(blank, 'stock_fine').unit, 'g')

    head('3. It catches a difference and says where to look')
    const wrong = api.reports.reconcile({
      as_on: DAY,
      expected: { cash: 100000, debtors: 140000 },
    })
    check('two figures were checked', wrong.checked, 2)
    check('one agrees', wrong.agreeing, 1)
    check('one differs', wrong.differing, 1)
    check('cash agrees', row(wrong, 'cash').status, 'agrees')
    check('debtors differ', row(wrong, 'debtors').status, 'differs')
    check('by exactly the gap', row(wrong, 'debtors').difference, 4200)
    check('and it says where to chase it',
      /Outstanding/.test(row(wrong, 'debtors').where), true)
    // The customer list comes back with it, so the difference can be chased
    // without leaving the screen.
    check('the debtor is named', wrong.debtors.some((x) => x.name === 'Rekha Joshi'), true)

    head('4. It agrees when the books really do agree')
    const right = api.reports.reconcile({
      as_on: DAY,
      expected: { cash: 100000, debtors: 144200, stock_fine: 0 },
    })
    check('three checked', right.checked, 3)
    check('all three agree', right.agreeing, 3)
    check('none differ', right.differing, 0)

    head('5. A gram is held to a tighter tolerance than a rupee')
    // A rupee out is a rounding artefact; a hundredth of a gram is real money.
    const looseRupee = api.reports.reconcile({ as_on: DAY, expected: { cash: 100000.4 } })
    check('40 paise is treated as agreement', row(looseRupee, 'cash').status, 'agrees')
    api.tagStock.saveBatch({
      itemId: ring, rows: [{ gross_wt: 10, purity: 91.6, purchase_rate: 6000, entry_date: DAY }],
    })
    const grams = api.reports.reconcile({ as_on: DAY, expected: { stock_fine: 9.15 } })
    // We hold 9.160 g; they say 9.150. Ten milligrams is about 70 rupees of gold.
    check('ten milligrams is not', row(grams, 'stock_fine').status, 'differs')
    check('and the gap is reported', row(grams, 'stock_fine').difference, 0.01)

    head('6. It flags the usual reason stock will not tie')
    api.tagStock.saveBatch({
      itemId: ring, rows: [{ gross_wt: 5, purity: 100, entry_date: DAY }],
    })
    const uncosted = api.reports.reconcile({ as_on: DAY })
    check('the unpriced piece is counted', uncosted.uncostedPieces, 1)
    // It is in the weight but not in the value — exactly the trap.
    check('it is in the weight', uncosted.rows.find((r) => r.key === 'stock_fine').ours, 14.16)
    check('but contributes nothing to the value',
      uncosted.rows.find((r) => r.key === 'stock_value').ours, 54960)

    head('7. The check moves with the date')
    const later = api.reports.reconcile({ as_on: '2026-07-20', expected: { debtors: 0 } })
    check('before the bill, nobody owed anything', row(later, 'debtors').ours, 0)
    check('so it agrees on that date', row(later, 'debtors').status, 'agrees')
  } catch (e) {
    fail++
    console.log('  ERROR', e && e.stack ? e.stack : e)
  }

  console.log(`\n${pass} passed, ${fail} failed`)
  app.exit(fail ? 1 : 0)
})
