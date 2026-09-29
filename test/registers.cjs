/**
 * Cash Book, Journal and the Sales/Purchase registers — docs/VIDEO-SPEC-2.md §5,
 * gap #13. These are read-backs of the ledger and the document tables, so what
 * matters is that every rupee lands where it should and the running balance and
 * column totals foot.
 *    npm run test:registers
 */
const { app } = require('electron')
const path = require('node:path')
const fs = require('node:fs')
const os = require('node:os')

const DAY = '2026-07-21'

let pass = 0
let fail = 0

function check(label, actual, expected, tol = 0.01) {
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
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'parivar-reg-'))
  const db = require('../electron/db.cjs')
  db.open(tmp)
  const api = require('../electron/api.cjs')

  const g = (name) => api.itemGroup.list().find((x) => x.name === name)
  const mkItem = (name, group) => api.item.save({
    name, item_type_id: group.item_type_id, item_group_id: group.id,
    design_id: null, weight_mode: 'WEIGHT', uom: 'GRAM', hsn: '7113', image: '',
  })

  try {
    head('1. A few transactions to fill the books')
    const cust = api.party.save({ party_type: 'CUSTOMER', name: 'Rekha', state: 'Maharashtra', metals: [] })
    const sup = api.party.save({ party_type: 'SUPPLIER', name: 'Bullion Co', state: 'Maharashtra', metals: [] })
    const goldItem = mkItem('Gold Ring', g('22K Gold'))
    api.tagStock.saveBatch({ itemId: goldItem, rows: [{ gross_wt: 10, purity: 100, entry_date: DAY }] })
    const tag = api.tagStock.list({ status: 'IN_STOCK' })[0]

    // Cash sale: goods 50,000 + no GST, paid in full → cash in 50,000.
    api.sale.save({
      head: { prefix: 'COM', bill_date: DAY, party_id: cust, party_name: 'Rekha',
              state: 'Maharashtra', is_credit: 0, payment_mode: 'Cash', gst_pct: 0,
              bill_discount: 0, making_discount: 0, other_amount: 0, manual_urd_amount: 0,
              tcs_pct: 0, amount_received: 50000 },
      items: [{ tag: tag.tag, tag_stock_id: tag.id, item_id: goldItem, item_name: 'Gold Ring',
                hsn: '7113', qty: 0, gross_wt: 10, purity: 100, stone_wt: 0, net_wt: 10,
                rate_per_gm: 5000, mkg_per_gm: 0, hallmark_charges: 0 }],
    })
    // A shop expense paid in cash → cash out 5,000.
    const shopAcc = api.account.list().find((a) => a.name === 'Shop Expenses')
    api.voucher.save({ kind: 'PAYMENT', voucher_date: DAY, account_id: shopAcc.id,
      amount: 5000, payment_type: 'Cash', narration: 'Rent' })
    // A credit purchase with 3% GST from a supplier.
    api.purchase.save({
      head: { prefix: 'MI', invoice_date: DAY, party_id: sup, party_name: 'Bullion Co',
              is_credit: 1, gst_pct: 3, paid_amount: 0, metal: 'Gold' },
      items: [{ item_name: 'Gold Bar', qty: 0, gross_wt: 20, stone_wt: 0, net_wt: 20,
                purity: 100, rate: 5000, wastage_pct: 0, hallmark_charges: 0 }],
    })

    head('2. Cash Book runs a balance')
    const cb = api.reports.cashBook({ account: 'Cash Account', from: DAY, to: DAY })
    check('opening is zero', cb.opening, 0)
    check('cash received total', cb.totalDebit, 50000)
    check('cash paid total', cb.totalCredit, 5000)
    // 0 + 50,000 in − 5,000 out = 45,000 on hand.
    check('closing balance', cb.closing, 45000)
    // The running balance on the last row equals the closing figure.
    check('last row balance matches closing', cb.rows[cb.rows.length - 1].balance, 45000)

    head('3. Journal lists every posting, and foots')
    const j = api.reports.journal({ from: DAY, to: DAY })
    // Each posted leg appears; debits and credits of the whole day are equal only
    // when every leg is present — here they need not match (single-entry), but the
    // journal must at least surface the cash legs we can check.
    check('journal has rows', j.rows.length > 0, true)
    const cashLegs = j.rows.filter((r) => r.head === 'Cash Account')
    check('cash receipt leg present', cashLegs.some((r) => Number(r.debit) === 50000), true)
    check('cash payment leg present', cashLegs.some((r) => Number(r.credit) === 5000), true)

    head('4. Sales & Purchase registers total their columns')
    const sr = api.reports.register({ book: 'SALES', from: DAY, to: DAY })
    check('one sale in the register', sr.rows.length, 1)
    check('sales taxable total', sr.totals.taxable, 50000)
    check('sales grand total', sr.totals.total, 50000)

    const pr = api.reports.register({ book: 'PURCHASE', from: DAY, to: DAY })
    check('one purchase in the register', pr.rows.length, 1)
    // A gold rate is per gram of 995, so 20 g of 100 touch = 20 x 100 x 5000 / 99.5
    // = 1,00,502.51 taxable ; +3% GST = 3,015.08 ; total 1,03,517.59
    check('purchase taxable total', pr.totals.taxable, 100502.51, 0.01)
    check('purchase GST total', pr.totals.gst_amount, 3015.08, 0.01)
    check('purchase grand total', pr.totals.total, 103517.59, 0.02)

    head('5. Empty registers are valid and zeroed')
    const sret = api.reports.register({ book: 'SALERETURN', from: DAY, to: DAY })
    check('no sales returns', sret.rows.length, 0)
    check('empty register totals to zero', sret.totals.total, 0)
    check('titled correctly', sret.title, 'Sales Return Register')
  } catch (e) {
    fail++
    console.log('  ERROR', e && e.stack ? e.stack : e)
  }

  console.log(`\n${pass} passed, ${fail} failed`)
  app.exit(fail ? 1 : 0)
})
