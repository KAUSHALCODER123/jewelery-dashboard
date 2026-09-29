/**
 * Gold Saving Scheme — the four scheme types, docs/VIDEO-SPEC-2.md §11, gap #8.
 *
 * On Amount and On Making accrue rupees; On Weight and Weight Wise accrue grams.
 * The difference between the two weight types is which side of the conversion is
 * fixed: On Weight fixes the rupees paid and lets the grams follow the day's
 * rate, Weight Wise fixes the grams and lets the rupees follow. Balances are
 * DERIVED from the received instalments, so undoing one self-corrects.
 *    npm run test:gssweight
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
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'parivar-gssw-'))
  const db = require('../electron/db.cjs')
  db.open(tmp)
  const api = require('../electron/api.cjs')

  const member = api.party.save({
    name: 'Scheme Member', type: 'CUSTOMER', state: 'Maharashtra', opening_balance: 0,
  })
  /** Receive every paying instalment of an account at a given rate. */
  const payAll = (id, rate) => {
    const a = api.gss.readAccount({ id })
    for (const r of a.receipts.filter((x) => x.status === 'PENDING')) {
      api.gss.receive({ receipt_id: r.id, rate, received_date: r.due_date })
    }
  }

  try {
    head('1. Scheme types are the four from the spec')
    check('four types offered', api.gss.types().length, 4)
    check('types listed', api.gss.types().join('|'), 'On Amount|On Making|On Weight|Weight Wise')
    throws('an unknown type is refused', () =>
      api.gss.saveScheme({ name: 'Bogus', scheme_type: 'On Vibes' }))

    head('2. On Amount — rupees in, rupees out')
    const sAmt = api.gss.saveScheme({
      name: '11 + 1 Amount', scheme_type: 'On Amount', period_unit: 'Months',
      total_periods: 12, paying_periods: 11, monthly_amount: 1000, maturity_bonus: 1000,
    })
    const aAmt = api.gss.assign({ scheme_id: sAmt, party_id: member, start_date: '2025-01-10' })
    const detAmt = api.gss.readAccount({ id: aAmt.id })
    check('12 scheduled rows', detAmt.receipts.length, 12)
    check('11 payable, 1 shop benefit',
      detAmt.receipts.filter((r) => r.status === 'INTEREST').length, 1)
    check('maturity a year out', detAmt.maturity_date, '2026-01-10')
    check('nothing accrued yet', detAmt.balance_amount, 0)
    payAll(aAmt.id, 0)
    const balAmt = api.gss.balance({ id: aAmt.id, as_of: '2026-02-01' })
    check('rupees accrued', balAmt.paid_amount, 11000)
    check('no grams on an amount scheme', balAmt.paid_weight, 0)
    check('matured', balAmt.matured, true)
    check('benefit added at maturity', balAmt.balance_amount, 12000)
    check('redeem value is the rupees', balAmt.redeem_value, 12000)

    head('3. The benefit is only earned once, at maturity')
    // Same account read before its maturity date: paid in full, but not yet due.
    const early = api.gss.balance({ id: aAmt.id, as_of: '2025-12-01' })
    check('complete but not matured', early.matured, false)
    check('benefit withheld before maturity', early.balance_amount, 11000)

    head('4. On Weight — fixed rupees, grams follow the day rate')
    const sWt = api.gss.saveScheme({
      name: 'Weight Saver', scheme_type: 'On Weight', period_unit: 'Months',
      total_periods: 3, paying_periods: 2, monthly_amount: 6000, bonus_weight: 0.5,
    })
    const aWt = api.gss.assign({ scheme_id: sWt, party_id: member, start_date: '2025-01-01' })
    const rows = api.gss.readAccount({ id: aWt.id }).receipts
    throws('a weight scheme will not take a receipt without a rate', () =>
      api.gss.receive({ receipt_id: rows[0].id }))
    // 6,000 at 6,000/g = 1.000g; 6,000 at 5,000/g = 1.200g. Total 2.200g.
    api.gss.receive({ receipt_id: rows[0].id, rate: 6000, received_date: '2025-01-01' })
    api.gss.receive({ receipt_id: rows[1].id, rate: 5000, received_date: '2025-02-01' })
    const balWt = api.gss.balance({ id: aWt.id, as_of: '2025-05-01', rate: 7000 })
    check('rupees paid', balWt.paid_amount, 12000)
    check('grams accrued at each day rate', balWt.paid_weight, 2.2)
    check('benefit is grams, not rupees', balWt.benefit_weight, 0.5)
    check('gram balance', balWt.balance_weight, 2.7)
    // The member is hedged: 12,000 paid is worth 2.7g × 7,000 = 18,900 today.
    check('worth today rate', balWt.redeem_value, 18900)

    head('5. Weight Wise — fixed grams, rupees follow the day rate')
    const sWise = api.gss.saveScheme({
      name: 'Gram A Month', scheme_type: 'Weight Wise', period_unit: 'Months',
      total_periods: 3, paying_periods: 2, monthly_weight: 1, bonus_weight: 1,
    })
    const aWise = api.gss.assign({ scheme_id: sWise, party_id: member, start_date: '2025-01-01' })
    const wRows = api.gss.readAccount({ id: aWise.id }).receipts
    check('schedule carries grams, not rupees', wRows[0].weight, 1)
    check('rupees unknown until paid', wRows[0].amount, 0)
    api.gss.receive({ receipt_id: wRows[0].id, rate: 6000, received_date: '2025-01-01' })
    api.gss.receive({ receipt_id: wRows[1].id, rate: 7000, received_date: '2025-02-01' })
    const balWise = api.gss.balance({ id: aWise.id, as_of: '2025-05-01', rate: 8000 })
    check('grams fixed at 1 a month', balWise.paid_weight, 2)
    check('rupees varied with the rate', balWise.paid_amount, 13000)
    check('gram balance with benefit', balWise.balance_weight, 3)
    check('worth today rate', balWise.redeem_value, 24000)
    throws('Weight Wise needs grams per instalment', () =>
      api.gss.assign({
        scheme_id: api.gss.saveScheme({
          name: 'No Grams', scheme_type: 'Weight Wise', total_periods: 2, paying_periods: 1,
        }),
        party_id: member,
      }))

    head('6. On Making — rupees, with a making waiver at maturity')
    const sMak = api.gss.saveScheme({
      name: 'Making Free', scheme_type: 'On Making', period_unit: 'Months',
      total_periods: 3, paying_periods: 2, monthly_amount: 2000, making_disc_pct: 100,
    })
    const aMak = api.gss.assign({ scheme_id: sMak, party_id: member, start_date: '2025-01-01' })
    payAll(aMak.id, 0)
    const balMak = api.gss.balance({ id: aMak.id, as_of: '2025-05-01' })
    check('accrues rupees like On Amount', balMak.balance_amount, 4000)
    check('making waiver available at maturity', balMak.making_disc_pct, 100)
    check('waiver withheld before maturity',
      api.gss.balance({ id: aMak.id, as_of: '2025-02-01' }).making_disc_pct, 0)

    head('7. Day and Year schedules')
    const sDay = api.gss.saveScheme({
      name: 'Daily', scheme_type: 'On Amount', period_unit: 'Days',
      total_periods: 10, paying_periods: 9, monthly_amount: 100, maturity_bonus: 100,
    })
    const aDay = api.gss.assign({ scheme_id: sDay, party_id: member, start_date: '2025-01-28' })
    const dRows = api.gss.readAccount({ id: aDay.id })
    check('due dates step one day', dRows.receipts[1].due_date, '2025-01-29')
    check('and roll over the month end', dRows.receipts[4].due_date, '2025-02-01')
    check('maturity is ten days out', dRows.maturity_date, '2025-02-07')
    const sYr = api.gss.saveScheme({
      name: 'Yearly', scheme_type: 'On Amount', period_unit: 'Years',
      total_periods: 3, paying_periods: 2, monthly_amount: 50000, maturity_bonus: 10000,
    })
    const aYr = api.gss.assign({ scheme_id: sYr, party_id: member, start_date: '2025-06-15' })
    check('due dates step one year',
      api.gss.readAccount({ id: aYr.id }).receipts[1].due_date, '2026-06-15')

    head('8. The account keeps the terms it was sold')
    // Rewriting the template must not rewrite an existing member's deal.
    api.gss.saveScheme({
      id: sWt, name: 'Weight Saver', scheme_type: 'On Amount', period_unit: 'Months',
      total_periods: 3, paying_periods: 2, monthly_amount: 9999, bonus_weight: 0,
    })
    const stillWt = api.gss.balance({ id: aWt.id, as_of: '2025-05-01', rate: 7000 })
    check('member stays on a weight scheme', stillWt.scheme_type, 'On Weight')
    check('and keeps the grams accrued', stillWt.balance_weight, 2.7)

    head('9. Undoing a receipt self-corrects the balance')
    const undoRow = api.gss.readAccount({ id: aWise.id }).receipts[1]
    api.gss.unreceive({ receipt_id: undoRow.id })
    const afterUndo = api.gss.balance({ id: aWise.id, as_of: '2025-05-01', rate: 8000 })
    check('grams drop back', afterUndo.paid_weight, 1)
    check('rupees drop back', afterUndo.paid_amount, 6000)
    check('no longer complete, so no benefit', afterUndo.balance_weight, 1)
    const restored = api.gss.readAccount({ id: aWise.id }).receipts[1]
    check('row goes back to owing grams', restored.weight, 1)
    check('and owing no rupees', restored.amount, 0)
    check('rate cleared', restored.rate, 0)

    head('10. Deposits still reach the liability ledger')
    const books = api.reports.trialBalance({ from: '2025-01-01', to: '2026-03-31' })
    const gssRow = books.cr.find((r) => r.name === 'Gold Saving Scheme')
    // 11,000 (On Amount) + 12,000 (On Weight) + 6,000 (Weight Wise, one undone)
    // + 4,000 (On Making) = 33,000 held as a liability.
    check('GSS liability is the money actually taken', gssRow.amount, 33000)

    /* ─────────────────── Redemption onto a sales bill ─────────────────── */

    const g = (name) => api.itemGroup.list().find((x) => x.name === name)
    const grp = g('22K Gold')
    const itemId = api.item.save({
      name: 'Gold Chain', item_type_id: grp.item_type_id, item_group_id: grp.id,
      design_id: null, weight_mode: 'WEIGHT', uom: 'GRAM', hsn: '7113', image: '',
    })
    /** Sell one piece to the member, optionally redeeming a scheme. */
    const sell = (extra = {}, mkg = 0) => {
      api.tagStock.saveBatch({ itemId, rows: [{ gross_wt: 10, purity: 100, entry_date: '2026-03-01' }] })
      const tag = api.tagStock.list({ status: 'IN_STOCK' }).sort((a, b) => b.id - a.id)[0]
      return api.sale.save({
        head: {
          prefix: 'COM', bill_date: '2026-03-01', party_id: member, party_name: 'Scheme Member',
          state: 'Maharashtra', is_credit: 1, payment_mode: 'Cash', gst_pct: 3,
          bill_discount: 0, making_discount: 0, other_amount: 0, manual_urd_amount: 0,
          tcs_pct: 0, amount_received: 0, ...extra,
        },
        items: [{
          tag: tag.tag, tag_stock_id: tag.id, item_id: itemId, item_name: 'Gold Chain',
          hsn: '7113', qty: 0, gross_wt: 10, purity: 100, stone_wt: 0, net_wt: 10,
          rate_per_gm: 5200, mkg_per_gm: mkg, hallmark_charges: 0,
        }],
      })
    }

    head('11. Scheme money settles the bill AFTER tax')
    // The spec's worked example: 52,000 goods + 3% GST = 53,560, less a 6,000
    // scheme balance = 47,560 to pay. The GST is on the full 52,000 either way,
    // because a deposit already taken is not a discount.
    const bill1 = sell({ gss_id: aAmt.id, gss_redeem: 6000 })
    const b1 = api.sale.read({ id: bill1.id })
    check('goods', b1.bill_amount, 52000)
    check('GST on the full bill', b1.gst_amount, 1560)
    check('bill plus GST', b1.total_amount, 53560)
    check('scheme applied', b1.gss_amount, 6000)
    check('net payable', b1.net_balance, 47560)
    check('scheme balance falls', api.gss.balance({ id: aAmt.id, as_of: '2026-03-01' }).balance_amount, 6000)

    head('12. The customer is credited, and the liability released')
    const led = api.reports.ledger({ partyId: member, from: '2025-01-01', to: '2026-03-31' })
    const credit = led.credits.find((r) => r.particulars === 'Gold Saving Scheme')
    check('customer credited for the redemption', credit.amount, 6000)
    const tb2 = api.reports.trialBalance({ from: '2025-01-01', to: '2026-03-31' })
    // 33,000 taken in, less the 6,000 just redeemed.
    check('liability released',
      tb2.cr.find((r) => r.name === 'Gold Saving Scheme').amount, 27000)

    head('13. Redemption is capped at the balance and at the bill')
    // Balance is 6,000; ask for 50,000 → capped at 6,000.
    const bill2 = sell({ gss_id: aAmt.id, gss_redeem: 50000 })
    check('capped at the balance', api.sale.read({ id: bill2.id }).gss_amount, 6000)
    check('account now empty', api.gss.balance({ id: aAmt.id, as_of: '2026-03-01' }).balance_amount, 0)
    api.sale.remove({ id: bill2.id })
    check('deleting the bill puts it back',
      api.gss.balance({ id: aAmt.id, as_of: '2026-03-01' }).balance_amount, 6000)

    head('14. A weight scheme redeems grams at the day rate')
    // 2.7g on the account, worth 18,900 at today's 7,000/g — less than the
    // 53,560 bill, so the grams go in full and the rest is still payable.
    const bill3 = sell({ gss_id: aWt.id, gss_rate: 7000 })
    const b3 = api.sale.read({ id: bill3.id })
    check('grams valued at the day rate', b3.gss_amount, 18900)
    check('all the grams consumed', b3.gss_weight, 2.7)
    check('rate recorded on the bill', b3.gss_rate, 7000)
    check('account emptied', api.gss.balance({
      id: aWt.id, as_of: '2026-03-01', rate: 7000 }).balance_weight, 0)
    check('the rest is still payable', b3.net_balance, 34660)
    api.sale.remove({ id: bill3.id })
    check('deleting restores the grams', api.gss.balance({
      id: aWt.id, as_of: '2026-03-01', rate: 7000 }).balance_weight, 2.7)

    head('14b. Redeeming part of a gram balance leaves the rest as grams')
    // Weight Wise: 2g paid + 1g benefit = 3g, worth 21,000 at 7,000/g.
    payAll(aWise.id, 7000)
    const bill3b = sell({ gss_id: aWise.id, gss_rate: 7000, gss_redeem: 7000 })
    const b3b = api.sale.read({ id: bill3b.id })
    check('only what was asked for', b3b.gss_amount, 7000)
    check('one gram spent', b3b.gss_weight, 1)
    // The member is still holding metal, not the rupees it was worth that day.
    const left = api.gss.balance({ id: aWise.id, as_of: '2026-03-01', rate: 9000 })
    check('two grams left', left.balance_weight, 2)
    check('worth more if the rate rises', left.redeem_value, 18000)
    api.sale.remove({ id: bill3b.id })

    head('15. On Making waives the making charges before tax')
    // 10g at 5,200 = 52,000 goods + 300/g making = 3,000. The 100% waiver takes
    // the making off the taxable value, so GST falls with it.
    const bill4 = sell({ gss_id: aMak.id, gss_redeem: 0 }, 300)
    const b4 = api.sale.read({ id: bill4.id })
    check('making charged', b4.making_amount, 3000)
    check('and waived in full', b4.making_discount, 3000)
    check('GST on the reduced value', b4.gst_amount, 1560)
    check('total after the waiver', b4.total_amount, 53560)
    check('no rupees taken from the account', b4.gss_amount, 0)

    head('16. Leftover balance can be handed back in cash')
    const cashBefore = api.reports.trialBalance({ from: '2025-01-01', to: '2026-03-31' })
      .dr.find((r) => r.name === 'Cash Account')?.amount ?? 0
    // 4,000 on the On Making account; take 1,000 against a bill, 3,000 in cash.
    const bill5 = sell({ gss_id: aMak.id, gss_redeem: 1000, gss_return: 9999 }, 0)
    const b5 = api.sale.read({ id: bill5.id })
    check('applied to the bill', b5.gss_amount, 1000)
    check('returned in cash, capped at what was left', b5.gss_return, 3000)
    check('account emptied', api.gss.balance({ id: aMak.id, as_of: '2026-03-01' }).balance_amount, 0)
    const cashAfter = api.reports.trialBalance({ from: '2025-01-01', to: '2026-03-31' })
      .dr.find((r) => r.name === 'Cash Account')?.amount ?? 0
    check('cash paid out', cashBefore - cashAfter, 3000)

    head('17. Re-saving a bill does not double-count its own redemption')
    const again = api.sale.read({ id: bill1.id })
    api.sale.save({
      id: bill1.id,
      head: { ...again, gss_id: aAmt.id, gss_redeem: 6000 },
      items: again.items, urds: again.urds, metals: again.metals,
    })
    check('still 6,000 applied', api.sale.read({ id: bill1.id }).gss_amount, 6000)
    // 12,000 earned less this one bill's 6,000 — the re-save must not count
    // its own earlier redemption a second time and leave nothing.
    check('and the balance is unchanged',
      api.gss.balance({ id: aAmt.id, as_of: '2026-03-01' }).balance_amount, 6000)

    head('18. A scheme belonging to someone else is refused')
    const other = api.party.save({
      name: 'Someone Else', type: 'CUSTOMER', state: 'Maharashtra', opening_balance: 0,
    })
    throws('wrong customer refused', () => sell({ party_id: other, gss_id: aAmt.id }))
  } catch (e) {
    fail++
    console.log('  ERROR', e && e.stack ? e.stack : e)
  }

  console.log(`\n${pass} passed, ${fail} failed`)
  app.exit(fail ? 1 : 0)
})
