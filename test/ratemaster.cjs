/**
 * Making Master / Wastage Master — docs/VIDEO-SPEC-2.md §9, gap #12.
 *
 * Default making charges and wastage percentages, set on an item or on an item
 * group. The item's own rule wins over its group's. Defaults are read by the
 * FORMS, never applied on save: a making charge of zero is a real answer, so the
 * engine must not quietly substitute a master value for a nil the user meant.
 *    npm run test:ratemaster
 */
const { app } = require('electron')
const path = require('node:path')
const fs = require('node:fs')
const os = require('node:os')

const DAY = '2026-07-24'

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
  try { fn(); fail++; console.log(`  FAIL  ${label}: expected a refusal, none came`) }
  catch (e) { pass++; console.log(`  PASS  ${label} — ${e.message}`) }
}
const head = (t) => console.log(`\n── ${t} ${'─'.repeat(Math.max(0, 46 - t.length))}`)

app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'parivar-run-')))

app.whenReady().then(() => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'parivar-rate-'))
  const db = require('../electron/db.cjs')
  db.open(tmp)
  const api = require('../electron/api.cjs')

  const g = (name) => api.itemGroup.list().find((x) => x.name === name)
  const gold22 = g('22K Gold')
  const gold18 = g('18K Gold')
  const mkItem = (name, grp) => api.item.save({
    name, item_type_id: grp.item_type_id, item_group_id: grp.id, design_id: null,
    weight_mode: 'WEIGHT', uom: 'GRAM', hsn: '7113', image: '',
  })
  const ringId = mkItem('Ring', gold22)
  const chainId = mkItem('Chain', gold22)
  const studId = mkItem('Stud', gold18)

  try {
    head('1. Nothing set means no default')
    const none = api.rateMaster.resolve({ itemId: ringId })
    check('no making', none.making_per_gram, 0)
    check('no wastage', none.wastage_pct, 0)
    check('and nothing to explain', none.making_from, '')
    check('an unknown item is safe', api.rateMaster.resolve({ itemId: 9999 }).making_per_gram, 0)
    check('so is no item at all', api.rateMaster.resolve({}).making_per_gram, 0)

    head('2. A group rule covers every item in it')
    api.rateMaster.save({ kind: 'MAKING', scope: 'GROUP', ref_id: gold22.id, per_gram: 300, flat: 0 })
    check('ring picks up the group rate',
      api.rateMaster.resolve({ itemId: ringId }).making_per_gram, 300)
    check('so does the chain',
      api.rateMaster.resolve({ itemId: chainId }).making_per_gram, 300)
    check('and it says where it came from',
      api.rateMaster.resolve({ itemId: ringId }).making_from, '22K Gold')
    check('an item in another group is untouched',
      api.rateMaster.resolve({ itemId: studId }).making_per_gram, 0)

    head('3. An item rule beats its group')
    api.rateMaster.save({ kind: 'MAKING', scope: 'ITEM', ref_id: chainId, per_gram: 450, flat: 0 })
    check('chain takes its own rate',
      api.rateMaster.resolve({ itemId: chainId }).making_per_gram, 450)
    check('and says so', api.rateMaster.resolve({ itemId: chainId }).making_from, 'this item')
    check('the ring still follows the group',
      api.rateMaster.resolve({ itemId: ringId }).making_per_gram, 300)

    head('4. Making can be a flat charge per piece')
    api.rateMaster.save({ kind: 'MAKING', scope: 'ITEM', ref_id: ringId, per_gram: 0, flat: 750 })
    const flat = api.rateMaster.resolve({ itemId: ringId })
    check('flat charge resolved', flat.making_flat, 750)
    check('and the per-gram rate is nil', flat.making_per_gram, 0)

    head('5. Saving the same target twice replaces the rule')
    api.rateMaster.save({ kind: 'MAKING', scope: 'ITEM', ref_id: chainId, per_gram: 500, flat: 0 })
    check('the rate is the new one',
      api.rateMaster.resolve({ itemId: chainId }).making_per_gram, 500)
    check('and there is still only one rule for it',
      api.rateMaster.list({ kind: 'MAKING' })
        .filter((r) => r.scope === 'ITEM' && r.ref_id === chainId).length, 1)

    head('6. Wastage is kept apart from making')
    api.rateMaster.save({ kind: 'WASTAGE', scope: 'GROUP', ref_id: gold22.id, per_gram: 8 })
    api.rateMaster.save({ kind: 'WASTAGE', scope: 'ITEM', ref_id: ringId, per_gram: 12 })
    const r = api.rateMaster.resolve({ itemId: ringId })
    check('ring wastage from its own rule', r.wastage_pct, 12)
    check('chain wastage from the group', api.rateMaster.resolve({ itemId: chainId }).wastage_pct, 8)
    check('and making is unaffected', r.making_flat, 750)
    check('wastage never carries a flat charge',
      api.rateMaster.list({ kind: 'WASTAGE' }).every((x) => x.flat === 0), true)

    head('7. Nonsense is refused')
    throws('unknown kind', () =>
      api.rateMaster.save({ kind: 'POLISH', scope: 'ITEM', ref_id: ringId, per_gram: 1 }))
    throws('unknown scope', () =>
      api.rateMaster.save({ kind: 'MAKING', scope: 'PLANET', ref_id: ringId, per_gram: 1 }))
    throws('no target', () =>
      api.rateMaster.save({ kind: 'MAKING', scope: 'ITEM', ref_id: 0, per_gram: 1 }))
    throws('a negative rate', () =>
      api.rateMaster.save({ kind: 'MAKING', scope: 'ITEM', ref_id: ringId, per_gram: -5 }))
    throws('wastage over 100%', () =>
      api.rateMaster.save({ kind: 'WASTAGE', scope: 'ITEM', ref_id: ringId, per_gram: 140 }))

    head('8. Deleting a rule falls back to the group')
    const chainRule = api.rateMaster.list({ kind: 'MAKING' })
      .find((x) => x.scope === 'ITEM' && x.ref_id === chainId)
    api.rateMaster.remove({ id: chainRule.id })
    check('chain drops back to the group rate',
      api.rateMaster.resolve({ itemId: chainId }).making_per_gram, 300)
    check('and says so', api.rateMaster.resolve({ itemId: chainId }).making_from, '22K Gold')

    head('9. The list names what each rule applies to')
    const listed = api.rateMaster.list({ kind: 'MAKING' })
    check('ring rule names the item',
      listed.find((x) => x.scope === 'ITEM' && x.ref_id === ringId).ref_name, 'Ring')
    check('group rule names the group',
      listed.find((x) => x.scope === 'GROUP').ref_name, '22K Gold')
    check('and a kind filter really filters',
      api.rateMaster.list({ kind: 'WASTAGE' }).every((x) => x.kind === 'WASTAGE'), true)

    head('10. A master never overrides what was actually typed')
    // The ring has a 750 flat making rule. A bill that says making is zero must
    // stay zero — the master seeds forms, it does not rewrite documents.
    api.tagStock.saveBatch({
      itemId: ringId, rows: [{ gross_wt: 10, purity: 100, mkg_per_gm: 0, entry_date: DAY }],
    })
    const tag = api.tagStock.list({ status: 'IN_STOCK' }).sort((a, b) => b.id - a.id)[0]
    check('a tag saved with no making keeps none', tag.mkg_per_gm, 0)
    const cust = api.party.save({
      name: 'Buyer', type: 'CUSTOMER', state: 'Maharashtra', opening_balance: 0,
    })
    const bill = api.sale.save({
      head: { prefix: 'COM', bill_date: DAY, party_id: cust, party_name: 'Buyer',
              state: 'Maharashtra', is_credit: 1, payment_mode: 'Cash', gst_pct: 0,
              bill_discount: 0, making_discount: 0, other_amount: 0, manual_urd_amount: 0,
              tcs_pct: 0, amount_received: 0 },
      items: [{ tag: tag.tag, tag_stock_id: tag.id, item_id: ringId, item_name: 'Ring',
                hsn: '7113', qty: 0, gross_wt: 10, purity: 100, stone_wt: 0, net_wt: 10,
                rate_per_gm: 5000, mkg_per_gm: 0, hallmark_charges: 0 }],
    })
    check('and a bill billed at no making stays there',
      api.sale.read({ id: bill.id }).making_amount, 0)
  } catch (e) {
    fail++
    console.log('  ERROR', e && e.stack ? e.stack : e)
  }

  console.log(`\n${pass} passed, ${fail} failed`)
  app.exit(fail ? 1 : 0)
})
