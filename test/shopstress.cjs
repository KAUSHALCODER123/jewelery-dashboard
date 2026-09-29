/**
 * The awkward days — real situations a jewellery shop hits that a tidy demo
 * never does, and that a tidy test suite therefore never catches.
 *
 * The gold rate moves between buying and selling. A customer pays partly in
 * cash, partly by card and partly in old gold. A bill is renegotiated the next
 * morning. A cheque bounces. Someone tries to sell the same ring twice. A
 * customer owes money AND owes metal at the same time. A scheme matures. Bullion
 * goes back to the supplier. The year ends mid-ledger.
 *
 * Same discipline as shopmonth.cjs: the assertions are reconciliations and
 * business facts, not "this function returns 47".
 *    npm run test:shopstress
 */
const { app } = require('electron')
const path = require('node:path')
const fs = require('node:fs')
const os = require('node:os')

const FY = { from: '2026-04-01', to: '2027-03-31' }

let pass = 0
let fail = 0
const problems = []

function check(label, actual, expected, tol = 0.02) {
  const ok =
    typeof expected === 'number'
      ? Math.abs(Number(actual) - expected) <= tol
      : String(actual) === String(expected)
  if (ok) { pass++; console.log(`  PASS  ${label} = ${actual}`) }
  else {
    fail++; problems.push(`${label}: got ${actual}, expected ${expected}`)
    console.log(`  FAIL  ${label}: got ${actual}, expected ${expected}`)
  }
}
function refuses(label, fn) {
  try { fn(); fail++; problems.push(`${label}: went through when it should not have`)
        console.log(`  FAIL  ${label}: went through when it should not have`) }
  catch (e) { pass++; console.log(`  PASS  ${label} — ${e.message}`) }
}
const head = (t) => console.log(`\n══ ${t} ${'═'.repeat(Math.max(0, 54 - t.length))}`)

app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'parivar-run-')))

app.whenReady().then(() => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'parivar-stress-'))
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
    name: 'Sunita Patil', party_type: 'CUSTOMER', state: 'Maharashtra',
    area: 'Deccan', opening_balance: 0,
  })
  const supplier = api.party.save({
    party_type: 'SUPPLIER', name: 'Nakoda Bullion', state: 'Maharashtra', opening_balance: 0,
  })

  /** Tag one piece at a known cost, and return it. */
  const tag = (gross, cost, date) => {
    api.tagStock.saveBatch({
      itemId: ring,
      rows: [{ gross_wt: gross, purity: 100, purchase_rate: cost, entry_date: date }],
    })
    return api.tagStock.list({ status: 'IN_STOCK' }).sort((a, b) => b.id - a.id)[0]
  }
  const bill = (t, headExtra, urds) => api.sale.save({
    head: {
      prefix: 'COM', bill_date: '2026-08-10', party_id: cust, party_name: 'Sunita Patil',
      state: 'Maharashtra', is_credit: 1, payment_mode: 'Cash', gst_pct: 3,
      bill_discount: 0, making_discount: 0, other_amount: 0, manual_urd_amount: 0,
      tcs_pct: 0, amount_received: 0, ...headExtra,
    },
    items: [{
      tag: t.tag, tag_stock_id: t.id, item_id: ring, item_name: 'Gold Ring',
      hsn: '7113', qty: 0, gross_wt: t.gross_wt, purity: 100, stone_wt: 0,
      net_wt: t.gross_wt, rate_per_gm: 7500, mkg_per_gm: 0, hallmark_charges: 0,
    }],
    urds: urds || [],
  })

  try {
    head('The gold rate moved — is the profit right?')
    // Bought at 6,000 a gram in April, sold at 7,500 in August. 10 g.
    const cheap = tag(10, 6000, '2026-04-05')
    const sold = bill(cheap, { is_credit: 0, amount_received: 77250 })
    const b = api.sale.read({ id: sold.id })
    check('sold at the August rate', b.goods_amount, 75000)
    const mis = api.reports.mis({ from: FY.from, to: FY.to, days: 30 })
    const pp = mis.purityProfit.find((r) => r.purity === '100%')
    // Cost 10 fine grams at 6,000 = 60,000. Sold for 75,000. Profit 15,000.
    check('cost is what we actually paid in April', pp.cost, 60000)
    check('profit is the rate movement', pp.profit, 15000)
    check('margin', pp.margin_pct, 20)

    head('One bill, paid three ways: cash, card and old gold')
    const t2 = tag(20, 6000, '2026-08-01')
    const mixed = bill(t2, {
      is_credit: 1, payment_mode: 'Card', amount_received: 40000,
    }, [{ name: 'Old Gold', gross_wt: 10, net_wt: 10, purity: 75, rate: 7000 }])
    const m = api.sale.read({ id: mixed.id })
    // 20 g at 7,500 = 150,000 + 3% GST = 154,500.
    // Old gold 10 x 75% = 7.5 fine x 7,000 = 52,500. Card 40,000. Owing 62,000.
    check('bill with tax', m.total_amount, 154500)
    check('old gold credited', m.urd_amount, 52500)
    check('what is still owed', m.net_balance, 62000)
    check('and the khata says the same',
      api.party.balance({ id: cust }).balance, 62000)
    // The old gold really came in as metal, not just as a number on a bill.
    const looseAfter = api.looseStock.summary({ metal: 'Gold' })
    check('the old gold is in the melting pot', looseAfter.urd_fine >= 7.5, true)

    head('Next morning she talks the making charge down')
    const before = api.party.balance({ id: cust }).balance
    const reread = api.sale.read({ id: mixed.id })
    api.sale.save({
      id: mixed.id,
      head: { ...reread, bill_discount: 5000 },
      items: reread.items, urds: reread.urds, metals: reread.metals,
    })
    const m2 = api.sale.read({ id: mixed.id })
    // 145,000 taxable + 3% = 149,350, less 52,500 old gold and 40,000 card.
    check('the bill is redone, not patched', m2.total_amount, 149350)
    check('she owes 5,150 less', api.party.balance({ id: cust }).balance, before - 5150)
    check('and the old gold was not counted twice', m2.urd_amount, 52500)
    check('nor the payment', m2.amount_received, 40000)

    head('The cheque bounces')
    const rc = api.voucher.save({
      kind: 'RECEIPT', voucher_date: '2026-08-12', party_id: cust,
      party_name: 'Sunita Patil', amount: 30000, payment_type: 'Cheque',
      ref_no: '004512', narration: 'part payment',
    })
    const afterCheque = api.party.balance({ id: cust }).balance
    check('the receipt reduced what she owes', afterCheque, m2.net_balance - 30000)
    api.voucher.remove({ id: rc.id })
    check('reversing it puts the debt straight back',
      api.party.balance({ id: cust }).balance, m2.net_balance)
    check('and the books still foot',
      api.reports.trialBalance(FY).drTotal, api.reports.trialBalance(FY).crTotal)

    head('Someone tries to sell the same ring twice')
    refuses('the second bill is refused', () => bill(t2, { is_credit: 0 }))
    check('and it is still shown as sold',
      api.tagStock.list({ status: 'ALL' }).find((x) => x.id === t2.id).status, 'SOLD')

    head('She owes money AND owes us metal at the same time')
    const t3 = tag(15, 6000, '2026-08-15')
    api.sale.save({
      head: {
        prefix: 'COM', bill_date: '2026-08-15', party_id: cust, party_name: 'Sunita Patil',
        state: 'Maharashtra', is_credit: 1, payment_mode: 'Cash', gst_pct: 3, weightwise: 1,
        bill_discount: 0, making_discount: 0, other_amount: 0, manual_urd_amount: 0,
        tcs_pct: 0, amount_received: 0,
      },
      items: [{ tag: t3.tag, tag_stock_id: t3.id, item_id: ring, item_name: 'Gold Ring',
                hsn: '7113', qty: 0, gross_wt: 15, purity: 100, stone_wt: 0, net_wt: 15,
                rate_per_gm: 0, mkg_per_gm: 0, hallmark_charges: 0 }],
      metals: [{ metal: 'Gold', balance_wt: 5, rate_per_gm: 7000 }],
    })
    const money = api.party.balance({ id: cust }).balance
    const metal = api.party.metalBalance({ id: cust }).balance
    // The gold khata is a METAL-MOVEMENT position, not "unpaid metal": every gram
    // that crossed the counter sits on it, exactly as the original's Account cum
    // Stock Display does (see VIDEO-SPEC-2 §2, where an ordinary purchase moves
    // the supplier's `Bal Wt`). So this is the 10 g still owed on the weightwise
    // bill PLUS the metal handed over on the earlier rupee bills, less her old
    // gold. What matters is that money and metal never contaminate each other.
    check('the gold khata carries every gram that moved', metal, 32.5, 0.02)
    check('and money is owed as well', money > 0, true)
    const combined = api.reports.accountCumStock({ partyId: cust, from: FY.from, to: FY.to })
    check('the combined statement closes on the money', combined.closing.amount, money, 0.05)
    check('and separately on the metal', combined.closing.weight, metal, 0.02)

    head('Bullion goes back to the supplier')
    const buy = api.purchase.save({
      head: { prefix: 'MI', invoice_date: '2026-08-20', party_id: supplier,
              party_name: 'Nakoda Bullion', is_credit: 1, gst_pct: 3, paid_amount: 0,
              metal: 'Gold', state: 'Maharashtra' },
      items: [{ item_name: 'Gold Bar', qty: 0, gross_wt: 100, black_beads: 0, stone_wt: 0,
                net_wt: 100, purity: 99.5, rate: 7000, wastage_pct: 0, hallmark_charges: 0 }],
    })
    const owed = api.party.balance({ id: supplier }).balance
    const stockBefore = api.looseStock.summary({ metal: 'Gold' }).total_fine
    api.purchaseReturn.save({
      head: { return_date: '2026-08-22', against_purchase_id: buy.id, party_id: supplier,
              party_name: 'Nakoda Bullion', gst_pct: 3, received_amount: 0, metal: 'Gold' },
      items: [{ item_name: 'Gold Bar', qty: 0, gross_wt: 20, stone_wt: 0, net_wt: 20,
                purity: 99.5, rate_per_gm: 7000 }],
    })
    // 20 g of 995 at a 995-basis rate of 7,000 = 1,40,000 + 3% = 1,44,200 back to us.
    check('the metal left our stock',
      stockBefore - api.looseStock.summary({ metal: 'Gold' }).total_fine, 19.9, 0.01)
    check('and we owe the supplier less',
      api.party.balance({ id: supplier }).balance, owed + 144200, 1)
    // The decisive case: send back EXACTLY what was bought and the account must
    // come to nothing. Pricing a return on raw weight while the purchase was
    // priced on fine weight left the supplier owing us money for goods we had
    // simply handed back.
    const buy2 = api.purchase.save({
      head: { prefix: 'MI', invoice_date: '2026-08-25', party_id: supplier,
              party_name: 'Nakoda Bullion', is_credit: 1, gst_pct: 3, paid_amount: 0,
              metal: 'Gold', state: 'Maharashtra' },
      items: [{ item_name: 'Gold Bar', qty: 0, gross_wt: 50, black_beads: 0, stone_wt: 0,
                net_wt: 50, purity: 91.6, rate: 7000, wastage_pct: 2, hallmark_charges: 0 }],
    })
    const owedAfterBuy = api.party.balance({ id: supplier }).balance
    api.purchaseReturn.save({
      head: { return_date: '2026-08-26', against_purchase_id: buy2.id, party_id: supplier,
              party_name: 'Nakoda Bullion', gst_pct: 3, received_amount: 0, metal: 'Gold' },
      items: [{ item_name: 'Gold Bar', qty: 0, gross_wt: 50, stone_wt: 0, net_wt: 50,
                purity: 91.6, wastage_pct: 2, rate_per_gm: 7000 }],
    })
    const bought = api.purchase.read({ id: buy2.id }).bill_amount
    check('a full return cancels the purchase exactly',
      api.party.balance({ id: supplier }).balance, owedAfterBuy + bought, 1)

    head('A scheme matures and is spent')
    const scheme = api.gss.saveScheme({
      name: 'Short Plan', scheme_type: 'On Amount', period_unit: 'Months',
      total_periods: 3, paying_periods: 2, monthly_amount: 10000, maturity_bonus: 2000,
    })
    const acct = api.gss.assign({
      scheme_id: scheme, party_id: cust, start_date: '2026-05-01',
    })
    for (const r of api.gss.readAccount({ id: acct.id }).receipts.filter((x) => x.status === 'PENDING')) {
      api.gss.receive({ receipt_id: r.id, received_date: r.due_date, payment_type: 'Cash' })
    }
    const matured = api.gss.balance({ id: acct.id, as_of: '2026-09-01' })
    check('she paid 20,000 in', matured.paid_amount, 20000)
    check('and the shop adds 2,000 at maturity', matured.balance_amount, 22000)
    const t4 = tag(30, 6000, '2026-09-01')
    const redeemed = api.sale.save({
      head: {
        prefix: 'COM', bill_date: '2026-09-02', party_id: cust, party_name: 'Sunita Patil',
        state: 'Maharashtra', is_credit: 1, payment_mode: 'Cash', gst_pct: 3,
        bill_discount: 0, making_discount: 0, other_amount: 0, manual_urd_amount: 0,
        tcs_pct: 0, amount_received: 0, gss_id: acct.id,
      },
      items: [{ tag: t4.tag, tag_stock_id: t4.id, item_id: ring, item_name: 'Gold Ring',
                hsn: '7113', qty: 0, gross_wt: 30, purity: 100, stone_wt: 0, net_wt: 30,
                rate_per_gm: 7500, mkg_per_gm: 0, hallmark_charges: 0 }],
    })
    const rb = api.sale.read({ id: redeemed.id })
    check('the whole scheme balance came off', rb.gss_amount, 22000)
    check('GST was still charged on the full goods', rb.gst_amount, 6750)
    check('the account is empty now',
      api.gss.balance({ id: acct.id, as_of: '2026-09-02' }).balance_amount, 0)

    head('Stock count finds a piece missing')
    const inStock = api.tagStock.list({ status: 'IN_STOCK' })
    check('the trays and the report agree before the count',
      api.reports.stock({ status: 'IN_STOCK' }).rows.length, inStock.length)

    head('The year ends mid-ledger')
    // A bill on 31 March and one on 1 April must land in different years, and
    // the two years must add up to the whole.
    const tMar = tag(5, 6000, '2027-03-30')
    const tApr = tag(5, 6000, '2027-03-30')
    bill(tMar, { bill_date: '2027-03-31', is_credit: 0, amount_received: 38625 })
    bill(tApr, { bill_date: '2027-04-01', is_credit: 0, amount_received: 38625 })
    const thisYear = api.reports.trialBalance({ from: '2026-04-01', to: '2027-03-31' })
    const nextYear = api.reports.trialBalance({ from: '2027-04-01', to: '2028-03-31' })
    const salesThis = thisYear.cr.find((r) => r.name === 'Sales Account')?.amount ?? 0
    const salesNext = nextYear.cr.find((r) => r.name === 'Sales Account')?.amount ?? 0
    check('March bill is in this year', salesThis > 0, true)
    check('April bill is in the next', salesNext, 37500)
    check('this year foots', thisYear.drTotal, thisYear.crTotal)
    check('next year foots too', nextYear.drTotal, nextYear.crTotal)

    head('And after all of that, the books still hold')
    const tb = api.reports.trialBalance(FY)
    check('trial balance foots', tb.drTotal, tb.crTotal)
    const bs = api.reports.balanceSheet(FY)
    check('balance sheet balances', bs.assetTotal, bs.liabilityTotal, 0.05)
    const led = api.reports.ledger({ partyId: cust, from: FY.from, to: FY.to })
    const signed = led.closingSide === 'Dr' ? led.closing : -led.closing
    check('her statement still matches her balance',
      signed, api.party.balance({ id: cust }).balance, 0.05)
    const cb = api.reports.cashBook({ from: FY.from, to: FY.to })
    check('the cash book agrees with the trial balance',
      cb.closing, tb.dr.find((r) => r.name === 'Cash Account')?.amount ?? 0, 0.05)
  } catch (e) {
    fail++
    problems.push(`ERROR ${e.message}`)
    console.log('\n  ERROR', e && e.stack ? e.stack : e)
  }

  console.log(`\n${'═'.repeat(60)}`)
  console.log(`${pass} passed, ${fail} failed`)
  if (problems.length) {
    console.log('\nWhat disagreed:')
    problems.forEach((x) => console.log('  · ' + x))
  }
  console.log('═'.repeat(60))
  app.exit(fail ? 1 : 0)
})
