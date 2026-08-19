/**
 * GST report pack — docs/VIDEO-SPEC-2.md §5/§6, gap #22.
 *
 * GSTR-1 (outward) and GSTR-2 (inward) split each supply into CGST+SGST when it
 * is inside the shop's own state and IGST when it crosses a state line, and group
 * B2B vs B2C. GSTR-3B nets output tax against input credit. HSN summary and the
 * TCS/TDS list round out what a monthly return needs.
 *    npm run test:gst
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
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'parivar-gst-'))
  const db = require('../electron/db.cjs')
  db.open(tmp)
  const api = require('../electron/api.cjs')

  const g = (name) => api.itemGroup.list().find((x) => x.name === name)
  const goldItem = () => api.item.save({
    name: 'Gold Ring', item_type_id: g('22K Gold').item_type_id, item_group_id: g('22K Gold').id,
    design_id: null, weight_mode: 'WEIGHT', uom: 'GRAM', hsn: '7113', image: '',
  })
  const tagOne = (itemId, gross) => {
    api.tagStock.saveBatch({ itemId, rows: [{ gross_wt: gross, purity: 100, entry_date: DAY }] })
    return api.tagStock.list({ status: 'IN_STOCK' }).sort((a, b) => b.id - a.id)[0]
  }
  const sell = (party, state, gross, extra = {}) => {
    const item = goldItem()
    const tag = tagOne(item, gross)
    return api.sale.save({
      head: { prefix: 'COM', bill_date: DAY, party_id: party, party_name: 'x', state,
              is_credit: 1, payment_mode: 'Cash', gst_pct: 3, bill_discount: 0, making_discount: 0,
              other_amount: 0, manual_urd_amount: 0, tcs_pct: 0, amount_received: 0, ...extra },
      items: [{ tag: tag.tag, tag_stock_id: tag.id, item_id: item, item_name: 'Gold Ring',
                hsn: '7113', qty: 0, gross_wt: gross, purity: 100, stone_wt: 0, net_wt: gross,
                rate_per_gm: 5000, mkg_per_gm: 0, hallmark_charges: 0 }],
    })
  }

  try {
    head('1. Two sales — one in-state B2B, one out-of-state B2C')
    check('shop is in Maharashtra', api.company.read().state, 'Maharashtra')
    // Registered dealer, same state → CGST + SGST.
    const b2b = api.party.save({ party_type: 'CUSTOMER', name: 'Registered Jeweller',
      state: 'Maharashtra', gstin: '27ABCDE1234F1Z5', metals: [] })
    // Walk-in, another state → IGST.
    const b2c = api.party.save({ party_type: 'CUSTOMER', name: 'Gujarat Buyer', state: 'Gujarat', metals: [] })
    sell(b2b, 'Maharashtra', 20)   // goods 1,00,000 · GST 3% = 3,000
    sell(b2c, 'Gujarat', 10)       // goods 50,000 · GST 3% = 1,500

    head('2. GSTR-1 splits the tax the right way')
    const r1 = api.reports.gstReturn({ direction: 'OUT', from: DAY, to: DAY })
    check('two outward supplies', r1.rows.length, 2)
    const intra = r1.rows.find((r) => r.supply === 'Intra')
    const inter = r1.rows.find((r) => r.supply === 'Inter')
    check('in-state → CGST half', intra.cgst, 1500)
    check('in-state → SGST half', intra.sgst, 1500)
    check('in-state → no IGST', intra.igst, 0)
    check('out-of-state → IGST full', inter.igst, 1500)
    check('out-of-state → no CGST', inter.cgst, 0)
    check('registered dealer is B2B', intra.segment, 'B2B')
    check('walk-in is B2C', inter.segment, 'B2C')
    check('B2B taxable', r1.b2b.taxable, 100000)
    check('B2C taxable', r1.b2c.taxable, 50000)
    check('total tax = 3,000 + 1,500', r1.totals.gst, 4500)

    head('3. A purchase feeds GSTR-2 (input credit)')
    const sup = api.party.save({ party_type: 'SUPPLIER', name: 'Bullion Co',
      state: 'Maharashtra', gstin: '27ZZZZZ9999Z1Z9', metals: [] })
    api.purchase.save({
      head: { prefix: 'MI', invoice_date: DAY, party_id: sup, party_name: 'Bullion Co',
              state: 'Maharashtra', is_credit: 1, gst_pct: 3, paid_amount: 0, metal: 'Gold' },
      items: [{ item_name: 'Gold Bar', qty: 0, gross_wt: 40, stone_wt: 0, net_wt: 40,
                purity: 100, rate: 5000, wastage_pct: 0, hallmark_charges: 0 }],
    })
    const r2 = api.reports.gstReturn({ direction: 'IN', from: DAY, to: DAY })
    check('one inward supply', r2.rows.length, 1)
    // A gold rate is quoted per gram of 995, so 40 g of 100 touch costs
    // 40 x 100 x 5000 / 99.5 = 2,01,005.03 — not a flat 40 x 5000.
    check('purchase taxable', r2.rows[0].taxable, 201005.03, 0.01)
    check('in-state purchase → CGST', r2.rows[0].cgst, 3015.08, 0.01)
    check('input tax total', r2.totals.gst, 6030.15, 0.02)

    head('4. GSTR-3B nets output against input')
    const b3 = api.reports.gstSummary({ from: DAY, to: DAY })
    check('output tax', b3.output_tax, 4500)
    check('input tax credit', b3.input_tax, 6030.15, 0.02)
    // Input exceeds output, so nothing is payable and the rest carries forward.
    check('nothing payable this month', b3.net_payable, 0)
    check('credit carried forward', b3.credit_carried, 1530.15, 0.02)

    head('5. HSN-wise summary groups by code')
    const hsn = api.reports.hsnSummary({ from: DAY, to: DAY })
    const row = hsn.rows.find((r) => r.hsn === '7113')
    check('7113 taxable = 1,00,000 + 50,000', row.taxable, 150000)
    check('7113 tax = 3% of that', row.tax, 4500)
    check('hsn total matches', hsn.totals.taxable, 150000)

    head('6. TCS and TDS are listed for deposit')
    // A sale that collects 1% TCS.
    sell(b2b, 'Maharashtra', 20, { tcs_pct: 1 })
    // A karagir receipt that withholds 2% TDS on labour.
    const kar = api.party.save({ party_type: 'KARAGIR', name: 'Ramesh', state: 'Maharashtra', metals: [] })
    api.karagir.receive({
      receive_date: DAY, karagir_id: kar, karagir_name: 'Ramesh', item_name: 'Ring',
      gross_wt: 10, purity: 100, rate_per_gm: 500, tds_pct: 2,
    })
    const tt = api.reports.tcsTds({ from: DAY, to: DAY })
    check('one TCS row', tt.tcs.length, 1)
    check('TCS collected', tt.tcsTotal > 0, true)
    check('one TDS row', tt.tds.length, 1)
    // labour 10 x 500 = 5,000 ; TDS 2% = 100
    check('TDS withheld', tt.tdsTotal, 100)
  } catch (e) {
    fail++
    console.log('  ERROR', e && e.stack ? e.stack : e)
  }

  console.log(`\n${pass} passed, ${fail} failed`)
  app.exit(fail ? 1 : 0)
})
