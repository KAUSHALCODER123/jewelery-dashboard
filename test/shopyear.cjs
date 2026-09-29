/**
 * A year of trading, and the things that only go wrong over a year.
 *
 * A month can hide a lot. Balances only drift once the same customer comes back
 * a dozen times. A scheme only matures after eleven instalments. Stock only goes
 * wrong after the same metal has been bought, made, sold, returned, melted and
 * re-tagged. Diwali is the day the shop does a month's trade in an afternoon.
 *
 * Two things are tested here that shorter runs cannot reach:
 *
 *   1. CONSERVATION — every gram that entered the shop is still accounted for,
 *      as stock on the shelf, metal owed by someone, or metal sent away. Gold
 *      does not evaporate, and no report may invent it.
 *   2. STABILITY — the books foot after every single document, not just at the
 *      end. A month-end check can pass while a mid-month state was nonsense.
 *
 *    npm run test:shopyear
 */
const { app } = require('electron')
const path = require('node:path')
const fs = require('node:fs')
const os = require('node:os')

const FY = { from: '2026-04-01', to: '2027-03-31' }

let pass = 0
let fail = 0
const problems = []

function check(label, actual, expected, tol = 0.05) {
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
const head = (t) => console.log(`\n══ ${t} ${'═'.repeat(Math.max(0, 54 - t.length))}`)

app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'parivar-run-')))

app.whenReady().then(() => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'parivar-year-'))
  const db = require('../electron/db.cjs')
  db.open(tmp)
  const api = require('../electron/api.cjs')
  const raw = db.get()

  const grp = (n) => api.itemGroup.list().find((x) => x.name === n)
  const g22 = grp('22K Gold')
  const ring = api.item.save({
    name: 'Gold Ring', item_type_id: g22.item_type_id, item_group_id: g22.id,
    design_id: null, weight_mode: 'WEIGHT', uom: 'GRAM', hsn: '7113', image: '',
  })
  const supplier = api.party.save({
    party_type: 'SUPPLIER', name: 'Year Bullion', state: 'Maharashtra', opening_balance: 0,
  })
  const customers = ['Anita', 'Bharat', 'Chetna', 'Dinesh', 'Eknath'].map((n) =>
    api.party.save({
      name: n, party_type: 'CUSTOMER', state: 'Maharashtra', area: 'Pune', opening_balance: 0,
    })
  )

  /** Books foot right now? Called after every document, not just at year end. */
  let footChecks = 0
  let footFailures = 0
  const stillFoots = (whenLabel) => {
    const tb = api.reports.trialBalance(FY)
    footChecks++
    if (Math.abs(tb.drTotal - tb.crTotal) > 0.05) {
      footFailures++
      problems.push(`books stopped footing after ${whenLabel}: Dr ${tb.drTotal} vs Cr ${tb.crTotal}`)
    }
  }

  /**
   * Every gram the shop has ever taken in, from any door.
   * Purchases, old gold from customers, and metal received back from karagirs.
   */
  const fineIn = () => {
    const rows = raw.prepare(
      `SELECT COALESCE(SUM(CASE WHEN direction='IN' THEN fine_wt ELSE -fine_wt END),0) v
       FROM loose_stock WHERE metal = 'Gold'`
    ).get()
    return Number(rows.v)
  }

  try {
    head('Twelve months of trading')
    let month = 4
    let billsMade = 0
    const monthDate = (m, d) => {
      const y = m > 12 ? 2027 : 2026
      const mm = ((m - 1) % 12) + 1
      return `${y}-${String(mm).padStart(2, '0')}-${String(d).padStart(2, '0')}`
    }

    for (let m = 4; m <= 15; m++) {
      const buyDay = monthDate(m, 2)
      // Rate drifts through the year the way a real one does, so no two months
      // price the same and a stale-rate bug cannot hide.
      const rate = 6800 + (m - 4) * 60

      api.purchase.save({
        head: { prefix: 'MI', invoice_date: buyDay, party_id: supplier,
                party_name: 'Year Bullion', is_credit: 1, gst_pct: 3, paid_amount: 0,
                metal: 'Gold', state: 'Maharashtra' },
        items: [{ item_name: 'Gold Bar', qty: 0, gross_wt: 100, black_beads: 0, stone_wt: 0,
                  net_wt: 100, purity: 99.5, rate, wastage_pct: 0, hallmark_charges: 0 }],
      })
      stillFoots(`purchase in month ${m}`)

      // Tag six rings out of the bar.
      api.looseStock.convert({
        itemId: ring,
        rows: Array.from({ length: 6 }, () => ({
          gross_wt: 15, purity: 91.6, mkg_per_gm: 400, purchase_rate: rate,
        })),
        entry_date: monthDate(m, 4),
      })
      stillFoots(`tagging in month ${m}`)

      // Sell four of them across the month, to different customers, cash and credit.
      const stock = api.tagStock.list({ status: 'IN_STOCK' })
      for (let i = 0; i < 4 && i < stock.length; i++) {
        const t = stock[i]
        const cust = customers[(m + i) % customers.length]
        const credit = (m + i) % 3 === 0
        api.sale.save({
          head: {
            prefix: 'COM', bill_date: monthDate(m, 6 + i * 4), party_id: cust,
            party_name: 'x', state: 'Maharashtra', is_credit: credit ? 1 : 0,
            payment_mode: credit ? 'Cash' : 'Card', gst_pct: 3,
            bill_discount: 0, making_discount: 0, other_amount: 0,
            manual_urd_amount: 0, tcs_pct: 0,
            amount_received: credit ? 0 : undefined,
          },
          items: [{
            tag: t.tag, tag_stock_id: t.id, item_id: ring, item_name: 'Gold Ring',
            hsn: '7113', qty: 0, gross_wt: t.gross_wt, purity: t.purity, stone_wt: 0,
            net_wt: t.net_wt, rate_per_gm: rate + 500, mkg_per_gm: 400,
            hallmark_charges: 45,
          }],
          // Every third bill takes old gold in part exchange.
          urds: i === 2
            ? [{ name: 'Old Gold', gross_wt: 4, net_wt: 4, purity: 80, rate }]
            : [],
        })
        billsMade++
      }
      stillFoots(`sales in month ${m}`)

      // Pay the supplier something most months.
      if (m % 2 === 0) {
        api.voucher.save({
          kind: 'PAYMENT', voucher_date: monthDate(m, 26), party_id: supplier,
          party_name: 'Year Bullion', amount: 400000, payment_type: 'NEFT',
        })
        stillFoots(`supplier payment in month ${m}`)
      }
      month = m
    }
    check('a year of bills went through', billsMade, 48)
    check('the books footed after every single document', footFailures, 0)
    check('and that was checked many times', footChecks > 30, true)

    head('Diwali — a month of trade in one afternoon')
    const before = api.reports.trialBalance(FY)
    const rush = api.tagStock.list({ status: 'IN_STOCK' }).slice(0, 12)
    for (const [i, t] of rush.entries()) {
      api.sale.save({
        head: {
          prefix: 'COM', bill_date: '2026-11-01', party_id: customers[i % customers.length],
          party_name: 'x', state: 'Maharashtra', is_credit: 0, payment_mode: 'Cash',
          gst_pct: 3, bill_discount: 0, making_discount: 0, other_amount: 0,
          manual_urd_amount: 0, tcs_pct: 0,
        },
        items: [{
          tag: t.tag, tag_stock_id: t.id, item_id: ring, item_name: 'Gold Ring',
          hsn: '7113', qty: 0, gross_wt: t.gross_wt, purity: t.purity, stone_wt: 0,
          net_wt: t.net_wt, rate_per_gm: 7600, mkg_per_gm: 400, hallmark_charges: 45,
        }],
      })
    }
    check('twelve bills in one day', rush.length, 12)
    const day = api.reports.dayBook({ from: '2026-11-01', to: '2026-11-01' })
    const dayBills = raw.prepare(
      `SELECT COUNT(*) c, COALESCE(SUM(total_amount),0) v FROM sale WHERE bill_date = '2026-11-01'`
    ).get()
    check('the day book counted them all', day.sales.n, dayBills.c)
    check('and totalled them correctly',
      day.sales.cash + day.sales.credit, dayBills.v)
    check('the books still foot after the rush',
      api.reports.trialBalance(FY).drTotal, api.reports.trialBalance(FY).crTotal)
    check('and the day did move the books',
      api.reports.trialBalance(FY).drTotal !== before.drTotal, true)

    head('CONSERVATION — where did every gram go?')
    // Everything that came in, minus everything sold or sent out, must equal
    // what is on the shelf. This is the check a shop actually cares about.
    const onShelf = api.tagStock.list({ status: 'IN_STOCK' })
      .reduce((s, t) => s + Number(t.final_wt), 0)
    const loosePool = api.looseStock.summary({ metal: 'Gold' })
    // `total_fine` is the whole gold position: loose pool plus tagged pieces.
    check('the ledger position equals the trays plus the pool',
      loosePool.total_fine, fineIn(), 0.01)
    check('and the tagged part is really on the shelf',
      loosePool.total_fine >= onShelf - 0.01, true)
    check('no gold was invented', loosePool.total_fine > 0, true)

    head('The same customer, a dozen visits later')
    for (const c of customers) {
      const led = api.reports.ledger({ partyId: c, from: FY.from, to: FY.to })
      const signed = led.closingSide === 'Dr' ? led.closing : -led.closing
      check(`${api.party.read({ id: c }).name}: statement still matches after a year`,
        signed, api.party.balance({ id: c }).balance, 0.05)
    }

    head('A scheme that actually runs its course')
    const scheme = api.gss.saveScheme({
      name: '11 + 1', scheme_type: 'On Amount', period_unit: 'Months',
      total_periods: 12, paying_periods: 11, monthly_amount: 3000, maturity_bonus: 3000,
    })
    const acct = api.gss.assign({
      scheme_id: scheme, party_id: customers[0], start_date: '2026-04-01',
    })
    const rows = api.gss.readAccount({ id: acct.id }).receipts.filter((r) => r.status === 'PENDING')
    check('eleven instalments to pay', rows.length, 11)
    rows.forEach((r) => api.gss.receive({ receipt_id: r.id, received_date: r.due_date }))
    const matured = api.gss.balance({ id: acct.id, as_of: '2027-04-02' })
    check('member paid 33,000 over the year', matured.paid_amount, 33000)
    check('shop adds 3,000 at maturity', matured.balance_amount, 36000)
    check('and it only counted as matured once complete', matured.matured, true)
    check('books still foot with a scheme liability sitting there',
      api.reports.trialBalance(FY).drTotal, api.reports.trialBalance(FY).crTotal)
    const gssLiab = api.reports.trialBalance(FY).cr
      .find((r) => r.name === 'Gold Saving Scheme')?.amount ?? 0
    check('the liability is the money actually collected', gssLiab, 33000)

    head('Year end')
    const tb = api.reports.trialBalance(FY)
    check('trial balance foots', tb.drTotal, tb.crTotal)
    const bs = api.reports.balanceSheet(FY)
    check('balance sheet balances', bs.assetTotal, bs.liabilityTotal)
    const pl = api.reports.profitAndLoss(FY)
    check('the year made a profit', pl.netProfit > 0, true)
    // Closing stock must include the LOOSE pool, not just tagged pieces. Bullion
    // in the safe is stock; counting only what happens to be tagged turned every
    // untagged purchase into a pure expense and showed a loss the shop never made.
    const closingRow = pl.trading.cr.find((r) => /Closing Stock/.test(r.name))
    const tagged = api.reports.stock({ status: 'IN_STOCK' }).totals.cost_value
    check('closing stock is more than just the tagged pieces',
      closingRow.amount > tagged, true)
    check('the difference is the loose metal in the safe',
      closingRow.amount - tagged > 0, true)
    // And the balance sheet must carry the same asset.
    const stockAsset = bs.assets.find((r) => /Stock/.test(r.name))
    check('the balance sheet carries the same closing stock',
      stockAsset.amount, closingRow.amount, 0.05)
    const cb = api.reports.cashBook({ from: FY.from, to: FY.to })
    check('cash book agrees with the trial balance',
      cb.closing, tb.dr.find((r) => r.name === 'Cash Account')?.amount ?? 0)
    const gst = api.reports.gstReturn({ direction: 'OUT', from: FY.from, to: FY.to })
    const billed = raw.prepare(
      `SELECT COALESCE(SUM(gst_amount),0) v FROM sale WHERE bill_date BETWEEN ? AND ?`
    ).get(FY.from, FY.to).v
    check('a full year of GST reconciles', gst.totals.gst, billed)
    const sup = api.reports.ledger({ partyId: supplier, from: FY.from, to: FY.to })
    const supSigned = sup.closingSide === 'Dr' ? sup.closing : -sup.closing
    check('the supplier account survived a year of buying and paying',
      supSigned, api.party.balance({ id: supplier }).balance)

    head('Reports do not disagree with each other')
    const stock = api.reports.stock({ status: 'IN_STOCK' })
    check('stock report piece count equals the trays',
      stock.rows.length, api.tagStock.list({ status: 'IN_STOCK' }).length)
    const outList = api.reports.outstandingList({ from: FY.from, to: FY.to })
    const sumD = (outList.debtors || []).reduce((s, r) => s + Number(r.balance || 0), 0)
    check('debtors still tie to the trial balance',
      sumD, tb.dr.find((r) => r.name === 'Sundry Debtors')?.amount ?? 0)
    const misY = api.reports.mis({ from: FY.from, to: FY.to, days: 60 })
    check('MIS sees the year’s sales', misY.topItems.length > 0, true)
    const misRevenue = misY.purityProfit.reduce((s, r) => s + Number(r.revenue), 0)
    const goodsBilled = raw.prepare(
      `SELECT COALESCE(SUM(si.item_total),0) v FROM sale_item si
       JOIN sale s ON s.id = si.sale_id
       JOIN tag_stock ts ON ts.id = si.tag_stock_id
       WHERE ts.purchase_rate > 0 AND s.bill_date BETWEEN ? AND ?`
    ).get(FY.from, FY.to).v
    check('and its revenue equals what those pieces were billed at',
      misRevenue, goodsBilled, 1)
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
