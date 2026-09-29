/**
 * Stock report — editable grid and Item Name Total, docs/VIDEO-SPEC-2.md §9, gap #20.
 *
 * The report grid can be corrected in place, but only for pieces still in stock:
 * a sold piece's weights are already priced on a bill. Net and fine weight are
 * recomputed by the engine rather than trusted from the grid, and the metal
 * inflow booked when the tag was made is re-posted so the stock position moves
 * with the correction. Item Name Total collapses to one row per item with a
 * weighted purity derived from the weights, not an average of percentages.
 *    npm run test:stockedit
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
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'parivar-sedit-'))
  const db = require('../electron/db.cjs')
  db.open(tmp)
  const api = require('../electron/api.cjs')

  const g = (name) => api.itemGroup.list().find((x) => x.name === name)
  const grp = g('22K Gold')
  const mkItem = (name) => api.item.save({
    name, item_type_id: grp.item_type_id, item_group_id: grp.id, design_id: null,
    weight_mode: 'WEIGHT', uom: 'GRAM', hsn: '7113', image: '',
  })
  const ringId = mkItem('Ring')
  const chainId = mkItem('Chain')
  const tagsOf = (itemId) => api.tagStock.list({ itemId }).sort((a, b) => a.id - b.id)

  try {
    head('1. A tag can be corrected in place')
    api.tagStock.saveBatch({
      itemId: ringId,
      rows: [{ gross_wt: 10, stone_wt: 0, purity: 90, purchase_rate: 5000,
               location: 'Shop', entry_date: DAY }],
    })
    const t0 = tagsOf(ringId)[0]
    check('as tagged', t0.final_wt, 9)
    // Re-weighed: 10.500 gross with 0.500 of stone, and the purity was mistyped.
    const res = api.tagStock.updateRows({
      rows: [{ id: t0.id, gross_wt: 10.5, stone_wt: 0.5, purity: 91.6, location: 'Locker' }],
    })
    check('one row updated', res.updated, 1)
    const t1 = tagsOf(ringId)[0]
    check('net recomputed by the engine', t1.net_wt, 10)
    check('fine recomputed too', t1.final_wt, 9.16)
    check('and the plain field saved', t1.location, 'Locker')

    head('2. The grid cannot lie about net or fine weight')
    // A grid that sent its own (wrong) net and fine must not be believed.
    api.tagStock.updateRows({
      rows: [{ id: t0.id, gross_wt: 10.5, stone_wt: 0.5, purity: 91.6,
               net_wt: 999, final_wt: 999 }],
    })
    const t2 = tagsOf(ringId)[0]
    check('net still derived', t2.net_wt, 10)
    check('fine still derived', t2.final_wt, 9.16)

    head('3. The correction moves the stock position')
    // The tag booked 9.000 g fine in when it was made; after the correction the
    // metal on hand must read 9.160, not 18.160 and not the original 9.000.
    const loose = api.looseStock.summary({ metal: 'Gold' })
    check('fine in stock follows the correction', loose.total_fine, 9.16)

    head('4. A sold piece is refused')
    api.tagStock.saveBatch({
      itemId: ringId, rows: [{ gross_wt: 5, purity: 100, purchase_rate: 5000, entry_date: DAY }],
    })
    const sellTag = tagsOf(ringId)[1]
    const cust = api.party.save({
      name: 'Buyer', type: 'CUSTOMER', state: 'Maharashtra', opening_balance: 0,
    })
    api.sale.save({
      head: { prefix: 'COM', bill_date: DAY, party_id: cust, party_name: 'Buyer',
              state: 'Maharashtra', is_credit: 1, payment_mode: 'Cash', gst_pct: 3,
              bill_discount: 0, making_discount: 0, other_amount: 0, manual_urd_amount: 0,
              tcs_pct: 0, amount_received: 0 },
      items: [{ tag: sellTag.tag, tag_stock_id: sellTag.id, item_id: ringId, item_name: 'Ring',
                hsn: '7113', qty: 0, gross_wt: 5, purity: 100, stone_wt: 0, net_wt: 5,
                rate_per_gm: 6000, mkg_per_gm: 0, hallmark_charges: 0 }],
    })
    throws('a sold tag cannot be edited here', () =>
      api.tagStock.updateRows({ rows: [{ id: sellTag.id, gross_wt: 99 }] }))
    check('and it was left alone', tagsOf(ringId)[1].gross_wt, 5)
    throws('a tag that no longer exists is refused', () =>
      api.tagStock.updateRows({ rows: [{ id: 9999, gross_wt: 1 }] }))

    head('5. Nothing is written when one row in the batch is bad')
    // The whole update is one transaction, so a bad row must not leave the good
    // rows of the same save applied.
    throws('the batch is refused', () =>
      api.tagStock.updateRows({
        rows: [{ id: t0.id, location: 'Safe' }, { id: sellTag.id, gross_wt: 99 }],
      }))
    check('the good row rolled back too', tagsOf(ringId)[0].location, 'Locker')

    head('6. Item Name Total — weighted purity, not an average')
    // Two rings: 40.000 g net at 100%, 1.000 g net at 50%. Averaging the two
    // percentages gives 75%; the honest weighted figure is 39.500 ÷ 41.000.
    api.tagStock.saveBatch({
      itemId: chainId,
      rows: [
        { gross_wt: 40, purity: 100, purchase_rate: 5000, entry_date: DAY },
        { gross_wt: 1, purity: 50, purchase_rate: 5000, entry_date: DAY },
      ],
    })
    const rep = api.reports.stock({ status: 'IN_STOCK', groupBy: 'item' })
    const chain = rep.groups.find((x) => x.key === 'Chain')
    check('two pieces collapse to one row', chain.count, 2)
    check('net weight totalled', chain.net_wt, 41)
    check('fine weight totalled', chain.final_wt, 40.5)
    check('weighted purity', chain.purity, 98.78)
    // The naive average of 100 and 50 would have been 75.
    check('and it is not the average of the percentages', chain.purity !== 75, true)

    head('7. Stone and diamond value on the report')
    api.tagStock.saveBatch({
      itemId: chainId,
      rows: [{ gross_wt: 12, stone_wt: 2, stone_rate: 300, diamond_wt: 1, diamond_rate: 20000,
               purity: 100, purchase_rate: 5000, entry_date: DAY }],
    })
    const rep2 = api.reports.stock({ status: 'IN_STOCK' })
    const stoned = rep2.rows.find((r) => num(r.stone_rate) > 0)
    check('stone value on the row', stoned.stone_amount, 600)
    check('diamond value on the row', stoned.diamond_amount, 20000)
    check('stone value totalled', rep2.totals.stone_amount, 600)
    check('diamond value totalled', rep2.totals.diamond_amount, 20000)
    const rep3 = api.reports.stock({ status: 'IN_STOCK', groupBy: 'item' })
    check('and grouped',
      rep3.groups.find((x) => x.key === 'Chain').diamond_amount, 20000)

    head('8. A group with no net weight does not divide by zero')
    const beadId = mkItem('Loose Beads')
    api.tagStock.saveBatch({
      itemId: beadId, rows: [{ gross_wt: 0, qty: 5, purity: 0, entry_date: DAY }],
    })
    check('purity reads zero, not NaN',
      api.reports.stock({ status: 'IN_STOCK', groupBy: 'item' })
        .groups.find((x) => x.key === 'Loose Beads').purity, 0)

    head('9. A piece is shown in the group of its own purity')
    // The shop's CP: an item kept under 18K Gold, one piece corrected to 91.6.
    const g18 = g('18K Gold')
    const cpId = api.item.save({
      name: 'CP', item_type_id: g18.item_type_id, item_group_id: g18.id, design_id: null,
      weight_mode: 'WEIGHT', uom: 'GRAM', hsn: '7113', image: '',
    })
    api.tagStock.saveBatch({
      itemId: cpId,
      rows: [{ gross_wt: 3, purity: 75, entry_date: DAY }, { gross_wt: 2, purity: 75, entry_date: DAY }],
    })
    const [cp1, cp2] = tagsOf(cpId)
    check('an 18K piece reads 18K Gold', cp1.group_name, '18K Gold')
    api.tagStock.updateRows({ rows: [{ id: cp2.id, purity: 91.6 }] })
    check('corrected to 91.6 it reads 22K Gold', tagsOf(cpId)[1].group_name, '22K Gold')
    check('and the scan on the bill says so too',
      api.tagStock.findByTag({ tag: cp2.tag }).group_name, '22K Gold')
    const byGroup = api.reports.stock({ status: 'IN_STOCK', groupBy: 'group' }).groups
    check('the group total counts it under 22K', byGroup.find((x) => x.key === '18K Gold').count, 1)
    api.tagStock.updateRows({ rows: [{ id: cp2.id, purity: 80 }] })
    check('a purity no group has keeps the item group', tagsOf(cpId)[1].group_name, '18K Gold')

    head('10. A changed weight or purity sends the label back for reprint')
    api.tagStock.markPrinted({ ids: [cp1.id], copies: 1 })
    const moved = api.tagStock.updateRows({ rows: [{ id: cp1.id, location: 'Locker' }] })
    check('moving a piece leaves its label alone', moved.relabel.length, 0)
    check('still marked printed', tagsOf(cpId)[0].label_printed_at ? 'yes' : 'no', 'yes')
    const reweighed = api.tagStock.updateRows({ rows: [{ id: cp1.id, gross_wt: 3.25 }] })
    check('re-weighing it asks for a new label', reweighed.relabel[0], cp1.id)
    check('and it is back under Not printed', tagsOf(cpId)[0].label_printed_at, '')
  } catch (e) {
    fail++
    console.log('  ERROR', e && e.stack ? e.stack : e)
  }

  console.log(`\n${pass} passed, ${fail} failed`)
  app.exit(fail ? 1 : 0)
})

function num(v) { return Number(v) || 0 }
