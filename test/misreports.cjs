/**
 * Scheme merging, the Gold Scheme report pack and the MIS pack —
 * docs/VIDEO-SPEC-2.md §11 and the MIS menu.
 *    npm run test:misreports
 */
const { app } = require('electron')
const path = require('node:path')
const fs = require('node:fs')
const os = require('node:os')

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
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'parivar-mis-'))
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
  const cust = api.party.save({
    name: 'Merge Member', type: 'CUSTOMER', state: 'Maharashtra', opening_balance: 0, area: 'Camp',
  })
  const other = api.party.save({
    name: 'Someone Else', type: 'CUSTOMER', state: 'Maharashtra', opening_balance: 0,
  })

  const scheme = (name, extra = {}) => api.gss.saveScheme({
    name, scheme_type: 'On Amount', period_unit: 'Months',
    total_periods: 3, paying_periods: 2, monthly_amount: 1000, maturity_bonus: 500, ...extra,
  })
  const payAll = (id, rate = 0) => {
    for (const r of api.gss.readAccount({ id }).receipts.filter((x) => x.status === 'PENDING')) {
      api.gss.receive({ receipt_id: r.id, rate, received_date: r.due_date })
    }
  }

  try {
    head('1. Two cards merge into one')
    const sA = scheme('Plan A')
    const a1 = api.gss.assign({ scheme_id: sA, party_id: cust, start_date: '2025-01-01' })
    const a2 = api.gss.assign({ scheme_id: sA, party_id: cust, start_date: '2025-02-01' })
    payAll(a1.id)
    payAll(a2.id)
    check('first card holds 2,000', api.gss.balance({ id: a1.id, as_of: '2025-01-01' }).paid_amount, 2000)
    const res = api.gss.merge({ from_id: a2.id, into_id: a1.id })
    check('two receipts moved', res.moved, 2)
    check('into the surviving card', res.into, api.gss.readAccount({ id: a1.id }).gs_no)
    check('which now holds 4,000',
      api.gss.balance({ id: a1.id, as_of: '2025-01-01' }).paid_amount, 4000)
    check('the merged card is closed', api.gss.readAccount({ id: a2.id }).closed, 1)
    check('and empty', api.gss.balance({ id: a2.id, as_of: '2025-01-01' }).paid_amount, 0)
    check('the note says where it went',
      /Merged into/.test(api.gss.readAccount({ id: a2.id }).remarks), true)

    head('2. The receipts move, they are not summed away')
    // The audit trail is the point: four dated receipts, not one lump of 4,000.
    const merged = api.gss.readAccount({ id: a1.id })
    check('four received rows on the survivor',
      merged.receipts.filter((r) => r.status === 'RECEIVED').length, 4)
    check('the money is still in the ledger',
      api.reports.trialBalance({ from: '2025-01-01', to: '2026-03-31' })
        .cr.find((r) => r.name === 'Gold Saving Scheme').amount, 4000)

    head('3. Merges that would lose information are refused')
    const a3 = api.gss.assign({ scheme_id: sA, party_id: other, start_date: '2025-01-01' })
    throws('a different customer', () => api.gss.merge({ from_id: a3.id, into_id: a1.id }))
    throws('an account into itself', () => api.gss.merge({ from_id: a1.id, into_id: a1.id }))
    const sW = scheme('Weight Plan', { scheme_type: 'On Weight', bonus_weight: 1 })
    const a4 = api.gss.assign({ scheme_id: sW, party_id: cust, start_date: '2025-01-01' })
    throws('a weight scheme into an amount one', () =>
      api.gss.merge({ from_id: a4.id, into_id: a1.id }))

    head('4. An account already spent on a bill cannot be merged')
    api.tagStock.saveBatch({
      itemId: ringId, rows: [{ gross_wt: 10, purity: 100, purchase_rate: 4000, entry_date: '2025-06-01' }],
    })
    const tag = api.tagStock.list({ status: 'IN_STOCK' })[0]
    const bill = api.sale.save({
      head: { prefix: 'COM', bill_date: '2026-03-01', party_id: cust, party_name: 'Merge Member',
              state: 'Maharashtra', area: 'Camp', is_credit: 1, payment_mode: 'Cash', gst_pct: 3,
              bill_discount: 0, making_discount: 0, other_amount: 0, manual_urd_amount: 0,
              tcs_pct: 0, amount_received: 0, gss_id: a1.id, gss_redeem: 1000 },
      items: [{ tag: tag.tag, tag_stock_id: tag.id, item_id: ringId, item_name: 'Ring',
                hsn: '7113', qty: 0, gross_wt: 10, purity: 100, stone_wt: 0, net_wt: 10,
                rate_per_gm: 6000, mkg_per_gm: 0, hallmark_charges: 0 }],
    })
    check('the bill spent from the scheme', api.sale.read({ id: bill.id }).gss_amount, 1000)
    const a5 = api.gss.assign({ scheme_id: sA, party_id: cust, start_date: '2025-03-01' })
    throws('a redeemed account cannot be moved', () =>
      api.gss.merge({ from_id: a1.id, into_id: a5.id }))

    head('5. Scheme reports')
    const master = api.reports.schemeReport({ kind: 'master' })
    check('every scheme listed', master.rows.length, 2)
    check('with its member count',
      master.rows.find((r) => r.name === 'Plan A').members >= 3, true)
    const alloc = api.reports.schemeReport({ kind: 'allocated' })
    check('one line per member', alloc.rows.length >= 4, true)
    const survivor = alloc.rows.find((r) => r.gs_no === merged.gs_no)
    // 4,000 paid in (2,000 of it merged across) + the 500 maturity bonus, which
    // this card has earned, less the 1,000 the bill above spent.
    check('carrying the derived balance', survivor.balance_amount, 3500)
    check('and how many instalments are still due', survivor.pending_count >= 0, true)
    const pending = api.reports.schemeReport({ kind: 'pending' })
    check('pending rows are unpaid', pending.rows.every((r) => r.status === 'PENDING'), true)
    const received = api.reports.schemeReport({ kind: 'received' })
    check('received rows are paid', received.rows.every((r) => r.status === 'RECEIVED'), true)
    check('and name the member', !!received.rows[0]?.party_name, true)
    const schemeSales = api.reports.schemeReport({ kind: 'sales' })
    check('the redemption shows as a scheme sale', schemeSales.rows.length, 1)
    check('with what it took', schemeSales.rows[0].gss_amount, 1000)

    head('6. MIS — non-moving stock')
    api.tagStock.saveBatch({
      itemId: ringId, rows: [{ gross_wt: 8, purity: 100, purchase_rate: 4000, entry_date: '2020-01-01' }],
    })
    const mis = api.reports.mis({ days: 90 })
    const stale = mis.nonMoving.find((r) => r.entry_date === '2020-01-01')
    check('the old piece is flagged', !!stale, true)
    check('with its age in days', stale.age_days > 1000, true)
    check('and its value at cost', stale.cost_value, 32000)
    check('totalled', mis.nonMovingValue >= 32000, true)

    head('7. MIS — dormant customers and top sellers')
    // The only bills are dated March; against a 90-day cutoff that customer has
    // gone quiet, which is exactly what the report is for.
    const quiet = mis.dormant.find((d) => d.name === 'Merge Member')
    check('the buyer has gone quiet', !!quiet, true)
    check('with their last bill shown', quiet.last_bill, '2026-03-01')
    check('and their lifetime value', quiet.lifetime > 0, true)
    // A wide enough window and nobody is dormant.
    check('a longer window clears them',
      api.reports.mis({ days: 3650 }).dormant.length, 0)
    check('top items led by the ring', mis.topItems[0]?.item_name, 'Ring')
    check('with the amount billed', mis.topItems[0]?.amount, 60000)
    check('top areas names the area', mis.topAreas[0]?.area, 'Camp')

    head('8. MIS — purity profit is at cost, and says what it excluded')
    // 10g at 100% sold for 60,000; it cost 10 fine grams at 4,000 = 40,000.
    const pp = mis.purityProfit.find((r) => r.purity === '100%')
    check('revenue', pp.revenue, 60000)
    check('cost', pp.cost, 40000)
    check('profit', pp.profit, 20000)
    check('margin', pp.margin_pct, 33.33)
    // A piece with no cost recorded must not read as pure profit.
    api.tagStock.saveBatch({
      itemId: ringId, rows: [{ gross_wt: 5, purity: 100, entry_date: '2026-03-01' }],
    })
    const free = api.tagStock.list({ status: 'IN_STOCK' }).sort((a, b) => b.id - a.id)[0]
    api.sale.save({
      head: { prefix: 'COM', bill_date: '2026-03-02', party_id: cust, party_name: 'Merge Member',
              state: 'Maharashtra', is_credit: 1, payment_mode: 'Cash', gst_pct: 3,
              bill_discount: 0, making_discount: 0, other_amount: 0, manual_urd_amount: 0,
              tcs_pct: 0, amount_received: 0 },
      items: [{ tag: free.tag, tag_stock_id: free.id, item_id: ringId, item_name: 'Ring',
                hsn: '7113', qty: 0, gross_wt: 5, purity: 100, stone_wt: 0, net_wt: 5,
                rate_per_gm: 6000, mkg_per_gm: 0, hallmark_charges: 0 }],
    })
    const mis2 = api.reports.mis({ days: 90 })
    check('the uncosted sale is excluded from margin',
      mis2.purityProfit.find((r) => r.purity === '100%').revenue, 60000)
    check('and counted separately instead', mis2.uncostedSold, 1)

    head('8b. MIS — profit answers for a financial year, not for all time')
    // "How did this year go?" is the question an owner actually asks, so the
    // profit views must honour a date range. Both bills sit in March 2026,
    // which is FY 2025-26 — the year that ends on 31 March 2026.
    const fy2526 = api.reports.mis({ from: '2025-04-01', to: '2026-03-31' })
    check('the year that holds the bills shows the profit',
      fy2526.purityProfit.find((r) => r.purity === '100%')?.profit, 20000)
    check('and still says what it left out', fy2526.uncostedSold, 1)
    check('one costed piece, one row', fy2526.itemProfit.length, 1)
    check('the row carries its bill', fy2526.itemProfit[0]?.bill_no, mis2.itemProfit[0]?.bill_no)

    // The following year saw no trade at all — it must read as nothing, not as
    // the same figures repeated.
    const fy2627 = api.reports.mis({ from: '2026-04-01', to: '2027-03-31' })
    check('a year with no sales shows no profit rows', fy2627.purityProfit.length, 0)
    check('and no item rows either', fy2627.itemProfit.length, 0)
    check('and excludes nothing, because nothing sold', fy2627.uncostedSold, 0)

    // A single day inside the year picks up only that day's bill.
    const oneDay = api.reports.mis({ from: '2026-03-02', to: '2026-03-02' })
    check('a one-day window sees only that day', oneDay.uncostedSold, 1)
    check('and no costed sale, which was the day before', oneDay.itemProfit.length, 0)

    head('9. Branches and stock transfer')
    check('the shop is seeded as the main branch',
      api.branch.list().find((b) => b.is_main)?.name, 'Shop')
    const locker = api.branch.save({ name: 'Locker Branch', address: 'MG Road' })
    api.tagStock.saveBatch({
      itemId: ringId,
      rows: [{ gross_wt: 12, purity: 100, purchase_rate: 4000, location: 'Shop', entry_date: '2026-03-01' }],
    })
    const moveTag = api.tagStock.list({ status: 'IN_STOCK' }).sort((a, b) => b.id - a.id)[0]
    const tr = api.stockTransfer.save({
      from_branch: 'Shop', to_branch: 'Locker Branch', transfer_date: '2026-07-01',
      tags: [moveTag.tag], remarks: 'Window display',
    })
    check('one piece moved', tr.moved, 1)
    check('and it is now at the branch',
      api.tagStock.list({ status: 'IN_STOCK' }).find((t) => t.tag === moveTag.tag).location,
      'Locker Branch')
    const pos = api.branch.stock()
    check('the branch position shows it',
      pos.find((p) => p.branch === 'Locker Branch').pieces, 1)

    head('10. A transfer cannot invent stock')
    throws('a piece that is not there', () => api.stockTransfer.save({
      from_branch: 'Shop', to_branch: 'Locker Branch', tags: [moveTag.tag],
    }))
    throws('an unknown tag', () => api.stockTransfer.save({
      from_branch: 'Shop', to_branch: 'Locker Branch', tags: ['NOPE999'],
    }))
    throws('the same branch twice', () => api.stockTransfer.save({
      from_branch: 'Shop', to_branch: 'Shop', tags: [moveTag.tag],
    }))
    throws('no tags at all', () => api.stockTransfer.save({
      from_branch: 'Shop', to_branch: 'Locker Branch', tags: [],
    }))
    // The sold ring from section 4 is not movable stock.
    throws('a sold piece', () => api.stockTransfer.save({
      from_branch: 'Shop', to_branch: 'Locker Branch', tags: [tag.tag],
    }))

    head('11. A branch holding stock cannot be deleted')
    throws('while it holds pieces', () => api.branch.remove({ id: locker }))

    head('12. Renaming a branch carries its stock along')
    api.branch.save({ id: locker, name: 'Camp Branch', address: 'MG Road' })
    check('the piece followed the rename',
      api.tagStock.list({ status: 'IN_STOCK' }).find((t) => t.tag === moveTag.tag).location,
      'Camp Branch')
    check('and so did the document',
      api.stockTransfer.read({ id: tr.id }).to_branch, 'Camp Branch')

    head('13. Undoing a transfer puts everything back')
    api.stockTransfer.remove({ id: tr.id })
    check('the piece is home again',
      api.tagStock.list({ status: 'IN_STOCK' }).find((t) => t.tag === moveTag.tag).location, 'Shop')
    check('and the document is gone', api.stockTransfer.list().length, 0)
    check('so the empty branch can be deleted now', api.branch.remove({ id: locker }), true)
  } catch (e) {
    fail++
    console.log('  ERROR', e && e.stack ? e.stack : e)
  }

  console.log(`\n${pass} passed, ${fail} failed`)
  app.exit(fail ? 1 : 0)
})
