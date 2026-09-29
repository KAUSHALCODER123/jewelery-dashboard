/**
 * Loyalty points — docs/VIDEO-SPEC-2.md §10.6, gap #9.
 *
 * A member earns points as a percentage of the bill's goods value, and can spend
 * them as a discount on a later bill. The balance is DERIVED from the bills
 * (earned − redeemed), so editing or deleting a bill self-corrects. Redemption is
 * capped at the balance and at the bill's own value.
 *    npm run test:loyalty
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
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'parivar-loy-'))
  const db = require('../electron/db.cjs')
  db.open(tmp)
  const api = require('../electron/api.cjs')

  const g = (name) => api.itemGroup.list().find((x) => x.name === name)
  const itemId = api.item.save({
    name: 'Gold Ring', item_type_id: g('22K Gold').item_type_id, item_group_id: g('22K Gold').id,
    design_id: null, weight_mode: 'WEIGHT', uom: 'GRAM', hsn: '7113', image: '',
  })
  const sell = (party, gross, extra = {}) => {
    api.tagStock.saveBatch({ itemId, rows: [{ gross_wt: gross, purity: 100, entry_date: DAY }] })
    const tag = api.tagStock.list({ status: 'IN_STOCK' }).sort((a, b) => b.id - a.id)[0]
    return api.sale.save({
      head: { prefix: 'COM', bill_date: DAY, party_id: party, party_name: 'x', state: 'Maharashtra',
              is_credit: 1, payment_mode: 'Cash', gst_pct: 0, bill_discount: 0, making_discount: 0,
              other_amount: 0, manual_urd_amount: 0, tcs_pct: 0, amount_received: 0, ...extra },
      items: [{ tag: tag.tag, tag_stock_id: tag.id, item_id: itemId, item_name: 'Gold Ring',
                hsn: '7113', qty: 0, gross_wt: gross, purity: 100, stone_wt: 0, net_wt: gross,
                rate_per_gm: 5000, mkg_per_gm: 0, hallmark_charges: 0 }],
    })
  }

  try {
    head('1. Defaults: 1% earn, ₹1 per point')
    check('earn rate seeded', api.settings.all().loyalty_earn_pct, '1')
    check('redeem value seeded', api.settings.all().loyalty_redeem_value, '1')

    head('2. A member earns points on a bill')
    const member = api.party.save({
      party_type: 'CUSTOMER', name: 'Loyal Latha', state: 'Maharashtra',
      loyalty_enabled: 1, metals: [],
    })
    // 10 g @ 5000 = 50,000 goods · 1% = 500 points.
    const s1 = sell(member, 10)
    check('bill earned 500 points', api.sale.read({ id: s1.id }).loyalty_earned, 500)
    check('member balance is 500', api.party.loyaltyBalance({ id: member }).balance, 500)
    check('balance flags the member as enabled', api.party.loyaltyBalance({ id: member }).enabled, true)

    head('3. A non-member earns nothing')
    const walkin = api.party.save({ party_type: 'CUSTOMER', name: 'Walk In', state: 'Maharashtra', metals: [] })
    const s2 = sell(walkin, 10)
    check('no points for a non-member', api.sale.read({ id: s2.id }).loyalty_earned, 0)
    check('non-member balance stays zero', api.party.loyaltyBalance({ id: walkin }).balance, 0)

    head('4. Redeeming points discounts the next bill')
    // Redeem 200 points → ₹200 off. New bill: 50,000 goods − 200 = 49,800 taxable.
    const s3 = sell(member, 10, { loyalty_redeem: 200 })
    const b3 = api.sale.read({ id: s3.id })
    check('200 points redeemed', b3.loyalty_redeemed, 200)
    check('₹200 discount applied', b3.loyalty_discount, 200)
    check('bill total reduced by 200', b3.total_amount, 49800)
    // Earned on this bill: 1% of 50,000 goods = 500 (earn is on goods, before the discount).
    check('still earns on the goods value', b3.loyalty_earned, 500)
    // Balance: 500 (s1) + 500 (s3 earned) − 200 (s3 redeemed) = 800.
    check('balance nets earn and redeem', api.party.loyaltyBalance({ id: member }).balance, 800)

    head('5. Cannot redeem more than the balance')
    // Balance is 800; ask for 5,000 → capped at 800.
    const s4 = sell(member, 10, { loyalty_redeem: 5000 })
    const b4 = api.sale.read({ id: s4.id })
    check('redemption capped at the balance', b4.loyalty_redeemed, 800)
    check('discount is the capped value', b4.loyalty_discount, 800)
    // After: 800 + 500 earned − 800 redeemed = 500.
    check('balance after big redeem', api.party.loyaltyBalance({ id: member }).balance, 500)

    head('6. Deleting a bill self-corrects the balance')
    api.sale.remove({ id: s4.id })
    // Removing s4 (earned 500, redeemed 800) → balance returns to 800.
    check('balance recomputed after delete', api.party.loyaltyBalance({ id: member }).balance, 800)
  } catch (e) {
    fail++
    console.log('  ERROR', e && e.stack ? e.stack : e)
  }

  console.log(`\n${pass} passed, ${fail} failed`)
  app.exit(fail ? 1 : 0)
})
