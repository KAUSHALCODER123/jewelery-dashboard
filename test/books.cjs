/**
 * The accounting books — Trial Balance, Trading & P&L, Balance Sheet.
 * docs/VIDEO-SPEC-2.md §5, gap #7.
 *
 * The app keeps a single-entry money ledger, so these three statements are
 * DERIVED from the source documents. This suite proves the derivation is sound
 * by asserting the two invariants that can only hold if every rupee was
 * accounted for on both sides:
 *   • the Trial Balance foots (Dr total == Cr total)
 *   • the Balance Sheet balances (Assets == Liabilities)
 * plus the individual heads against numbers worked by hand below.
 *    npm run test:books
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
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'parivar-books-'))
  const db = require('../electron/db.cjs')
  db.open(tmp)
  const api = require('../electron/api.cjs')

  try {
    // ─────────────────────────────────────────────────────────────
    // A controlled month. Pure metal (purity 100) and round rates keep
    // every figure hand-checkable.
    //
    //   Purchase   40 g @ 5000 (995 basis) = 2,01,005.03 (supplier, on credit)
    //   Tag 2 pieces  20 g each @ cost 5000 = 1,00,000 each  (stock at cost)
    //   Sell 1 piece  20 g @ 6000  + 3% GST                  (to a customer)
    //        goods 1,20,000 · GST 3,600 · total 1,23,600 · ₹5,000 received
    //   Shop expense voucher                =    5,000  (cash)
    // ─────────────────────────────────────────────────────────────
    head('1. Book a month of trade')
    const supplierId = api.party.save({ party_type: 'SUPPLIER', name: 'Refiner Co', state: 'Maharashtra', metals: [] })
    const customerId = api.party.save({ party_type: 'CUSTOMER', name: 'Anita Shah', state: 'Maharashtra', metals: [] })

    const g22 = api.itemGroup.list().find((g) => g.name === '22K Gold')
    const itemId = api.item.save({
      name: 'Chain', item_type_id: g22.item_type_id, item_group_id: g22.id,
      design_id: null, weight_mode: 'WEIGHT', uom: 'GRAM', hsn: '7113', image: '',
    })

    // Purchase 40 g of pure metal for 2,00,000 on credit (supplier is a creditor).
    api.purchase.save({
      head: { prefix: 'MI', invoice_date: DAY, party_id: supplierId, party_name: 'Refiner Co',
              is_credit: 1, gst_pct: 0, paid_amount: 0 },
      items: [{ item_name: 'Fine Bar', qty: 0, gross_wt: 40, stone_wt: 0, net_wt: 40,
                purity: 100, rate: 5000, wastage_pct: 0, hallmark_charges: 0 }],
    })

    // Make two sellable pieces OUT OF THE BAR just bought, each carrying its
    // 5000/g cost. This has to be a conversion, not a fresh stock entry: entering
    // them as new stock would leave the 40 g bar sitting in the safe as well, so
    // the shop would hold 80 g on the books having bought 40 — and the closing
    // stock figure below would rightly count both.
    api.looseStock.convert({
      itemId,
      rows: [
        { gross_wt: 20, purity: 100, purchase_rate: 5000 },
        { gross_wt: 20, purity: 100, purchase_rate: 5000 },
      ],
      entry_date: DAY,
    })
    const tag = api.tagStock.list({ status: 'IN_STOCK' })[0]

    // Sell one piece at 6000/g + 3% GST, ₹5,000 collected in cash now.
    api.sale.save({
      head: {
        prefix: 'COM', bill_date: DAY, party_id: customerId, party_name: 'Anita Shah',
        state: 'Maharashtra', is_credit: 1, payment_mode: 'Cash', gst_pct: 3,
        bill_discount: 0, making_discount: 0, other_amount: 0,
        manual_urd_amount: 0, tcs_pct: 0, amount_received: 5000,
      },
      items: [{
        tag: tag.tag, tag_stock_id: tag.id, item_id: itemId, item_name: 'Chain', hsn: '7113',
        qty: 0, gross_wt: 20, purity: 100, stone_wt: 0, net_wt: 20,
        rate_per_gm: 6000, mkg_per_gm: 0, hallmark_charges: 0,
      }],
    })

    // A shop expense, paid in cash against the Expense head.
    const shopAcc = api.account.list().find((a) => a.name === 'Shop Expenses')
    api.voucher.save({
      kind: 'PAYMENT', voucher_date: DAY, account_id: shopAcc.id,
      amount: 5000, payment_type: 'Cash', narration: 'Electricity',
    })

    head('2. Trading & Profit / Loss')
    const pl = api.reports.profitAndLoss({ from: DAY, to: DAY })
    check('sales revenue', pl.trading.cr.find((r) => r.name === 'Sales').amount, 120000)
    check('closing stock at cost', pl.trading.cr.find((r) => r.name.startsWith('Closing')).amount, 100000)
    // 40 g of 100 touch at a 995-basis rate of 5000 = 40 x 100 x 5000 / 99.5
    check('purchases', pl.trading.dr.find((r) => r.name === 'Purchases').amount, 201005.03, 0.02)
    // gross = (sales 1,20,000 + closing 1,00,000) - (purchases 2,01,005.03) = 18,994.97
    check('gross profit', pl.grossProfit, 18994.97, 0.02)
    check('shop expense in P&L', pl.pl.dr.find((r) => r.name === 'Shop Expenses').amount, 5000)
    check('indirect expenses', pl.pl.indirectExpenses, 5000)
    // net = gross 18,994.97 - expenses 5,000 = 13,994.97
    check('net profit', pl.netProfit, 13994.97, 0.02)

    head('3. Trial Balance foots')
    const tb = api.reports.trialBalance({ from: DAY, to: DAY })
    check('debtors (1,23,600 - 5,000 recd)', tb.dr.find((r) => r.name === 'Sundry Debtors').amount, 118600)
    check('purchases on Dr', tb.dr.find((r) => r.name === 'Purchase Account').amount, 201005.03, 0.02)
    check('shop expense on Dr', tb.dr.find((r) => r.name === 'Shop Expenses').amount, 5000)
    check('creditors on Cr', tb.cr.find((r) => r.name === 'Sundry Creditors').amount, 201005.03, 0.02)
    check('sales on Cr', tb.cr.find((r) => r.name === 'Sales Account').amount, 120000)
    check('GST payable on Cr', tb.cr.find((r) => r.name === 'GST Payable').amount, 3600)
    check('Dr total == Cr total', tb.drTotal, tb.crTotal)
    check('nothing left unexplained', Math.abs(tb.difference) < 1, true)

    head('4. Balance Sheet balances')
    const bs = api.reports.balanceSheet({ from: DAY, to: DAY })
    check('debtors are an asset', bs.assets.find((r) => r.name === 'Sundry Debtors').amount, 118600)
    check('stock is an asset', bs.assets.find((r) => r.name.startsWith('Closing')).amount, 100000)
    check('creditors are a liability', bs.liabilities.find((r) => r.name === 'Sundry Creditors').amount, 201005.03, 0.02)
    check('GST payable is a liability', bs.liabilities.find((r) => r.name === 'GST Payable').amount, 3600)
    // With no opening equity and stock fully bought, capital == the profit earned.
    check('capital == net profit', bs.capital, 13994.97, 0.02)
    check('capital carries the profit note', bs.netProfit, 13994.97, 0.02)
    check('Assets == Liabilities', bs.assetTotal, bs.liabilityTotal)

    head('5. Any period produces a balanced statement')
    // NB: closing stock is valued from CURRENT inventory, not reconstructed
    // as-on a past date, so a historical period still shows today's stock. The
    // invariant that must always hold regardless is that the sheet balances.
    const other = api.reports.balanceSheet({ from: '2020-01-01', to: '2020-01-31' })
    check('balance sheet still balances', other.assetTotal, other.liabilityTotal)
    const etb = api.reports.trialBalance({ from: '2020-01-01', to: '2020-01-31' })
    check('empty trial balance foots', etb.drTotal, etb.crTotal)
  } catch (e) {
    fail++
    console.log('  ERROR', e && e.stack ? e.stack : e)
  }

  console.log(`\n${pass} passed, ${fail} failed`)
  app.exit(fail ? 1 : 0)
})
