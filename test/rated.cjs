/**
 * Diamond & stone as rated components — docs/VIDEO-SPEC-2.md §7, gap #11.
 *
 * A diamond ring is not priced like a gold bangle. The stones and diamonds come
 * OUT of the metal weight (they are not gold) and are charged in their own right
 * at their own rate. This suite proves:
 *   • net weight, and therefore the fine gold owed, excludes stone and diamond;
 *   • stone_amount = stone_wt x stone_rate, diamond_amount = diamond_wt x rate;
 *   • both fold into goods and so attract GST;
 *   • a tagged piece carries its stone/diamond rates for the bill to pick up.
 *    npm run test:rated
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
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'parivar-rated-'))
  const db = require('../electron/db.cjs')
  db.open(tmp)
  const api = require('../electron/api.cjs')

  try {
    head('1. The line maths — one diamond ring')
    // gross 20 ; stone 2 g @ 500 ; diamond 1 g @ 10,000 ; metal 100% @ 5000/g
    const totals = api.calc.saleTotals({
      head: { gst_pct: 3 },
      items: [{
        item_name: 'Diamond Ring', gross_wt: 20, stone_wt: 2, stone_rate: 500,
        diamond_wt: 1, diamond_rate: 10000, purity: 100, rate_per_gm: 5000, mkg_per_gm: 0,
      }],
    })
    const line = totals.items[0]
    // net = 20 - stone 2 - diamond 1 = 17
    check('net excludes stone and diamond', line.net_wt, 17)
    check('metal amount = 17 x 5000', line.total_amount, 85000)
    check('stone amount = 2 x 500', line.stone_amount, 1000)
    check('diamond amount = 1 x 10000', line.diamond_amount, 10000)
    check('line total = metal + stone + diamond', line.item_total, 96000)

    head('2. The bill — stones attract GST like the rest')
    const t = totals.totals
    check('goods = metal + stone + diamond', t.goods_amount, 96000)
    check('stone total surfaced', t.stone_amount, 1000)
    check('diamond total surfaced', t.diamond_amount, 10000)
    check('GST 3% on 96,000', t.gst_amount, 2880)
    check('bill total', t.total_amount, 98880)

    head('3. A plain gold piece is completely unaffected')
    const plain = api.calc.saleTotals({
      head: { gst_pct: 3 },
      items: [{ item_name: 'Bangle', gross_wt: 10, stone_wt: 0, net_wt: 10,
                purity: 100, rate_per_gm: 5000, mkg_per_gm: 0 }],
    })
    check('no stone value', plain.totals.stone_amount, 0)
    check('no diamond value', plain.totals.diamond_amount, 0)
    check('goods is just the metal', plain.totals.goods_amount, 50000)

    head('4. A tagged piece carries its stone & diamond rates')
    const g22 = api.itemGroup.list().find((g) => g.name === '22K Gold')
    const itemId = api.item.save({
      name: 'Diamond Ring', item_type_id: g22.item_type_id, item_group_id: g22.id,
      design_id: null, weight_mode: 'WEIGHT', uom: 'GRAM', hsn: '7113', image: '',
    })
    api.tagStock.saveBatch({
      itemId,
      rows: [{ gross_wt: 20, stone_wt: 2, stone_rate: 500, diamond_wt: 1, diamond_rate: 10000,
               purity: 100, entry_date: DAY }],
    })
    const tag = api.tagStock.list({ status: 'IN_STOCK' })[0]
    check('stone rate stored on the piece', tag.stone_rate, 500)
    check('diamond weight stored', tag.diamond_wt, 1)
    check('diamond rate stored', tag.diamond_rate, 10000)
    // net was computed with the diamond out: 20 - 2 - 1 = 17
    check('piece net excludes stone and diamond', tag.net_wt, 17)

    head('5. Selling it bills the stones and owes only the gold')
    const custId = api.party.save({
      party_type: 'CUSTOMER', name: 'Priya Nair', state: 'Maharashtra', metals: [],
    })
    const sale = api.sale.save({
      head: {
        prefix: 'COM', bill_date: DAY, party_id: custId, party_name: 'Priya Nair',
        state: 'Maharashtra', is_credit: 1, payment_mode: 'Cash', gst_pct: 3,
        bill_discount: 0, making_discount: 0, other_amount: 0,
        manual_urd_amount: 0, tcs_pct: 0, amount_received: 0,
      },
      items: [{
        tag: tag.tag, tag_stock_id: tag.id, item_id: itemId, item_name: 'Diamond Ring', hsn: '7113',
        qty: 0, gross_wt: 20, purity: 100, stone_wt: 2, stone_rate: 500,
        diamond_wt: 1, diamond_rate: 10000, net_wt: 17,
        rate_per_gm: 5000, mkg_per_gm: 0, hallmark_charges: 0,
      }],
    })
    const s = api.sale.read({ id: sale.id })
    check('saved stone amount', s.items[0].stone_amount, 1000)
    check('saved diamond amount', s.items[0].diamond_amount, 10000)
    check('bill total', s.total_amount, 98880)
    check('customer owes the full rupee bill', api.party.balance({ id: custId }).balance, 98880)
    // The gold khata sees only 17 g of fine metal — stones and diamonds are not gold.
    check('gold owed excludes stone & diamond (17 g fine)',
      api.party.metalBalance({ id: custId }).balance, 17)
  } catch (e) {
    fail++
    console.log('  ERROR', e && e.stack ? e.stack : e)
  }

  console.log(`\n${pass} passed, ${fail} failed`)
  app.exit(fail ? 1 : 0)
})
