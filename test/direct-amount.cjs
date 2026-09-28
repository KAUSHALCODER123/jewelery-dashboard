/**
 * Direct-amount bills — the counter types what the piece sells for.
 *
 * On an estimate the typed amount is the bill. On a GST bill it already
 * includes the 3%, so 2,00,000 is 1,94,174.76 taxable + 2,912.62 CGST +
 * 2,912.62 SGST, and the bill still totals exactly 2,00,000. The rate only
 * prints and no making is charged. Reopening the bill shows the typed figure.
 *    npm run test:direct-amount
 */
const { app } = require('electron')
const path = require('node:path')
const fs = require('node:fs')
const os = require('node:os')

const DAY = '2026-09-28'
let pass = 0
let fail = 0
function check(label, actual, expected, tol = 0.001) {
  const ok = typeof expected === 'number'
    ? Math.abs(Number(actual) - expected) <= tol
    : String(actual) === String(expected)
  if (ok) { pass++; console.log(`  PASS  ${label} = ${actual}`) }
  else { fail++; console.log(`  FAIL  ${label}: got ${actual}, expected ${expected}`) }
}

app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'parivar-run-')))

app.whenReady().then(() => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'parivar-direct-'))
  const db = require('../electron/db.cjs')
  db.open(tmp)
  const api = require('../electron/api.cjs')

  const g = api.itemGroup.list().find((x) => x.name === '22K Gold')
  const item = api.item.save({
    name: 'Gold Ring', item_type_id: g.item_type_id, item_group_id: g.id,
    design_id: null, weight_mode: 'WEIGHT', uom: 'GRAM', hsn: '7113', image: '',
  })
  const sell = (prefix, extra) => {
    api.tagStock.saveBatch({ itemId: item, rows: [{ gross_wt: 25, purity: 91.6, entry_date: DAY }] })
    const tag = api.tagStock.list({ status: 'IN_STOCK' }).sort((a, b) => b.id - a.id)[0]
    const res = api.sale.save({
      head: { prefix, bill_date: DAY, party_name: 'Walk-in', state: 'Maharashtra',
              is_credit: 0, payment_mode: 'Cash', gst_pct: 3, bill_discount: 0, making_discount: 0,
              other_amount: 0, manual_urd_amount: 0, tcs_pct: 0, amount_received: 0,
              direct_amount: 1, ...extra },
      // Rate and making are on the line, as a scanned tag would bring them; a
      // direct bill must ignore both and bill the typed amount.
      items: [{ tag: tag.tag, tag_stock_id: tag.id, item_id: item, item_name: 'Gold Ring',
                hsn: '7113', qty: 0, gross_wt: 25, purity: 91.6, stone_wt: 0, net_wt: 25,
                rate_per_gm: 7300, mkg_per_gm: 450, hallmark_charges: 45,
                entered_amount: 200000 }],
    })
    return api.sale.read({ id: typeof res === 'object' ? res.id : res })
  }

  try {
    console.log('\n── GST bill, typed 2,00,000 including GST')
    const gst = sell('COM', {})
    check('taxable', gst.bill_amount, 194174.76)
    check('GST', gst.gst_amount, 5825.24)
    check('CGST', gst.gst_amount / 2, 2912.62)
    check('total is exactly what was typed', gst.total_amount, 200000)
    check('no making charged', gst.making_amount, 0)
    check('no hallmark charged', gst.hallmark_amount, 0)
    check('bill marked direct', gst.direct_amount, 1)
    check('typed amount kept on the line', gst.items[0].entered_amount, 200000)
    check('rate still stored for printing', gst.items[0].rate_per_gm, 7300)
    check('piece left stock', api.tagStock.list({ status: 'IN_STOCK' }).length, 0)

    console.log('\n── Estimate, typed 2,00,000, no GST')
    const est = sell('ESM', { gst_not_required: 1 })
    check('bill amount', est.bill_amount, 200000)
    check('GST', est.gst_amount, 0)
    check('total', est.total_amount, 200000)

    console.log('\n── A discount still comes off before tax')
    const disc = sell('COM', { bill_discount: 1000 })
    check('taxable after discount', disc.bill_amount - 1000, 193174.76, 0.01)
    check('GST on the discounted value', disc.gst_amount, 5795.24, 0.01)

    console.log('\n── Printed bill hides making on a direct bill')
    const bundle = path.join(tmp, 'invoice.cjs')
    require('esbuild').buildSync({
      entryPoints: [path.join(__dirname, '../src/print/invoice.ts')], bundle: true,
      platform: 'node', format: 'cjs', outfile: bundle, loader: { '.jpeg': 'dataurl' },
    })
    const { invoiceHtml } = require(bundle)
    const html = invoiceHtml({ company: api.company.read(), sale: gst, party: null,
      pending_balance: 0, amount_in_words: '' })
    check('no Mkg column', /<th[^>]*>Mkg<\/th>/.test(html), false)
    check('no Making Amt line', html.includes('Making Amt:'), false)
    check('rate column still prints', html.includes('73,000.00') || html.includes('73000.00'), true)
    check('CGST line prints', html.includes('CGST 1.5%'), true)
  } catch (e) {
    fail++
    console.error(e)
  }

  console.log(`\n${pass} passed, ${fail} failed`)
  db.close()
  app.exit(fail ? 1 : 0)
})
