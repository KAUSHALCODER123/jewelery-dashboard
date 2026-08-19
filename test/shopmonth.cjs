/**
 * A real month at a jewellery shop, end to end.
 *
 * Every other suite checks one function against a number I chose. This one runs
 * a whole trading month the way a shop actually trades — buy bullion on credit,
 * send metal to the goldsmith, get pieces back, tag them, sell for cash and on
 * credit, take old gold in, book an order with an advance, run a saving scheme,
 * take a return, melt scrap, pay the supplier, pay the electricity bill — and
 * then checks that the books AGREE WITH THEMSELVES.
 *
 * The assertions are deliberately not "this function returns 47". They are the
 * reconciliations a shop's accountant would run, each of which reads the same
 * business fact through two independent paths:
 *
 *   · the trial balance foots
 *   · the balance sheet balances
 *   · every party's own ledger closes where party.balance says it does
 *   · the customers add up to Sundry Debtors, the suppliers to Sundry Creditors
 *   · the cash book closes where the trial balance and the day book say
 *   · the GST on the bills equals the GST on the return
 *   · the stock report's fine weight equals the pieces actually in the trays
 *   · every karagir's metal balance equals issued less received
 *
 * If any single figure in the app is wrong, one of these disagrees. That is the
 * point: nothing here trusts a number because I typed it into a test.
 *    npm run test:shopmonth
 */
const { app } = require('electron')
const path = require('node:path')
const fs = require('node:fs')
const os = require('node:os')

const FY = { from: '2026-04-01', to: '2027-03-31' }
const RATE = 7000          // ₹ per fine gram, held flat so every figure is checkable
const MAKING = 450         // ₹ per gram

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
    fail++
    problems.push(`${label}: got ${actual}, expected ${expected}`)
    console.log(`  FAIL  ${label}: got ${actual}, expected ${expected}`)
  }
}
const head = (t) => console.log(`\n══ ${t} ${'═'.repeat(Math.max(0, 54 - t.length))}`)
const sub = (t) => console.log(`\n   ── ${t}`)

app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'parivar-run-')))

app.whenReady().then(() => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'parivar-shop-'))
  const db = require('../electron/db.cjs')
  db.open(tmp)
  const api = require('../electron/api.cjs')
  const raw = db.get()

  const grp = (n) => api.itemGroup.list().find((x) => x.name === n)
  const g22 = grp('22K Gold')
  const g24 = grp('24K Gold')
  const mkItem = (name, group) => api.item.save({
    name, item_type_id: group.item_type_id, item_group_id: group.id, design_id: null,
    weight_mode: 'WEIGHT', uom: 'GRAM', hsn: '7113', image: '',
  })

  try {
    /* ─────────────── The shop opens ─────────────── */
    head('Setting up the shop')
    api.company.save({
      id: 1, name: 'Shreeji Jewellers', address: 'Laxmi Road, Pune',
      gstin: '27AABCS1429B1ZX', state: 'Maharashtra',
      fy_start: FY.from, fy_end: FY.to,
    })
    const cashAccId = api.account.list().find((a) => a.name === 'Cash Account').id
    const bankAccId = api.account.list().find((a) => a.name === 'Bank Account').id
    api.account.save({
      id: cashAccId, name: 'Cash Account', acc_type: 'Cash', acc_group: 'Current Asset',
      opening_balance: 500000, opening_dr_cr: 'Dr',
    })
    api.account.save({
      id: bankAccId, name: 'Bank Account', acc_type: 'Bank', acc_group: 'Bank Accounts',
      opening_balance: 2000000, opening_dr_cr: 'Dr',
    })
    const electricity = api.account.save({
      name: 'Electricity', acc_type: 'Expense', acc_group: 'Indirect Expense',
    })

    const supplier = api.party.save({
      party_type: 'SUPPLIER', name: 'Sangam Bullion', state: 'Maharashtra',
      gstin: '27AAACS9876C1ZP', opening_balance: 0,
    })
    const karagir = api.party.save({
      party_type: 'KARAGIR', name: 'Ramesh Soni', state: 'Maharashtra', opening_balance: 0,
    })
    const refinery = api.party.save({
      party_type: 'REFINERY', name: 'Shree Refinery', state: 'Maharashtra', opening_balance: 0,
    })
    const meena = api.party.save({
      name: 'Meena Kulkarni', party_type: 'CUSTOMER', state: 'Maharashtra',
      area: 'Kothrud', mobile: '9822011111', opening_balance: 0, loyalty_enabled: 1,
    })
    const ashok = api.party.save({
      name: 'Ashok Deshmukh', party_type: 'CUSTOMER', state: 'Maharashtra',
      area: 'Camp', mobile: '9822022222', opening_balance: 0,
    })
    const wholesale = api.party.save({
      name: 'Verma Traders', party_type: 'CUSTOMER', state: 'Gujarat',
      gstin: '24AAACV1234D1ZQ', opening_balance: 0,
    })
    const chainItem = mkItem('Gold Chain', g22)
    const ringItem = mkItem('Gold Ring', g22)
    const barItem = mkItem('Gold Bar', g24)
    check('shop is on the books', api.company.read().name, 'Shreeji Jewellers')

    /* ─────────────── 1 July — buy bullion on credit ─────────────── */
    head('1 Jul — 500 g of bullion from Sangam, on credit')
    const pur = api.purchase.save({
      head: { prefix: 'MI', invoice_date: '2026-07-01', party_id: supplier,
              party_name: 'Sangam Bullion', is_credit: 1, gst_pct: 3, paid_amount: 0,
              metal: 'Gold', state: 'Maharashtra' },
      items: [{ item_name: 'Gold Bar', item_id: barItem, qty: 0, gross_wt: 500,
                black_beads: 0, stone_wt: 0, net_wt: 500, purity: 99.5,
                rate: RATE, wastage_pct: 0, hallmark_charges: 0 }],
    })
    const p = api.purchase.read({ id: pur.id })
    // 500 g at 99.5% = 497.500 fine. The rate is quoted per gram of 995, which is
    // exactly what this bar is, so 500 x 99.5 x 7,000 / 99.5 = 35,00,000;
    // +3% GST = 36,05,000.
    check('fine bought', p.items[0].fine_plus_wastage, 497.5)
    check('goods value', p.purchase_amount, 3500000)
    check('GST at 3%', p.gst_amount, 105000)
    check('supplier is owed the lot', p.net_balance, 3605000)
    check('and the khata agrees', api.party.balance({ id: supplier }).balance, -3605000)

    /* ─────────────── 2 July — metal out to the goldsmith ─────────────── */
    head('2 Jul — 200 g issued to Ramesh to make chains')
    api.karagir.issue({
      issue_date: '2026-07-02', karagir_id: karagir, karagir_name: 'Ramesh Soni',
      item_name: 'Chain', gross_wt: 200, less_wt: 0, net_wt: 200, purity: 100,
      wastage_pct: 0, metal: 'Gold',
    })
    check('Ramesh holds 200 g of our gold', api.party.metalBalance({ id: karagir }).balance, 200)

    sub('10 Jul — he returns 196 g of finished chain, 2% wastage allowed, labour ₹250/g')
    api.karagir.receive({
      receive_date: '2026-07-10', karagir_id: karagir, karagir_name: 'Ramesh Soni',
      item_name: 'Chain', gross_wt: 196, less_wt: 0, stone_wt: 0, diamond_wt: 0,
      net_wt: 196, purity: 100, wastage_pct: 2, rate_per_gm: 250,
      tds_pct: 0, paid_amount: 0, metal: 'Gold',
    })
    // Issued 200, received 196 + 3.92 allowed wastage = 199.92 — he still owes 0.08.
    const karMetal = api.party.metalBalance({ id: karagir }).balance
    check('goldsmith owes only the shortfall', karMetal, 0.08)
    const karLedger = api.karagir.ledger({ karagirId: karagir })
    check('issued and received reconcile',
      karLedger.totals.issued - karLedger.totals.received - karLedger.totals.wastage,
      karMetal, 0.02)

    /* ─────────────── 12 July — tag the chains ─────────────── */
    head('12 Jul — 196 g of chain becomes 8 tagged pieces')
    // Eight chains, 22.4 g gross each at 91.6%, made from the loose pool.
    const conv = api.looseStock.convert({
      itemId: chainItem,
      rows: Array.from({ length: 8 }, () => ({
        gross_wt: 22.4, purity: 91.6, mkg_per_gm: MAKING, purchase_rate: RATE,
      })),
      entry_date: '2026-07-12',
    })
    check('eight chains tagged', conv.created, 8)
    // 22.4 at 91.6% = 20.518 fine each; 8 x 20.518 = 164.144
    check('fine taken out of the loose pool', conv.fine_converted, 164.144, 0.01)
    check('the pool fell by exactly that', conv.loose_before - conv.loose_after, 164.144, 0.01)

    /* ─────────────── Selling ─────────────── */
    head('14–22 Jul — the counter')
    const chains = api.tagStock.list({ status: 'IN_STOCK' }).filter((t) => t.tag.startsWith('GOL'))
    const chainTags = chains.length ? chains : api.tagStock.list({ status: 'IN_STOCK' })
    const sellChain = (i, headExtra, urds) => {
      const t = chainTags[i]
      return api.sale.save({
        head: {
          prefix: 'COM', bill_date: '2026-07-14', state: 'Maharashtra',
          gst_pct: 3, bill_discount: 0, making_discount: 0, other_amount: 0,
          manual_urd_amount: 0, tcs_pct: 0, amount_received: 0, ...headExtra,
        },
        items: [{
          tag: t.tag, tag_stock_id: t.id, item_id: chainItem, item_name: 'Gold Chain',
          hsn: '7113', qty: 0, gross_wt: t.gross_wt, purity: t.purity, stone_wt: 0,
          net_wt: t.net_wt, rate_per_gm: RATE, mkg_per_gm: MAKING, hallmark_charges: 45,
        }],
        urds: urds || [],
      })
    }

    sub('Meena buys a chain for cash')
    const s1 = sellChain(0, {
      party_id: meena, party_name: 'Meena Kulkarni', area: 'Kothrud',
      is_credit: 0, payment_mode: 'Cash',
    })
    const b1 = api.sale.read({ id: s1.id })
    // 20.518 fine? No — a retail bill prices the NET weight at the rate:
    // 22.400 net x 7,000 = 156,800 goods; making 22.4 x 450 = 10,080; hallmark 45.
    check('goods', b1.goods_amount, 156800)
    check('making', b1.making_amount, 10080)
    check('bill before tax', b1.bill_amount, 166925)
    check('GST 3%', b1.gst_amount, 5007.75)
    check('total', b1.total_amount, 171932.75)
    api.sale.save({
      id: s1.id,
      head: { ...b1, amount_received: b1.total_amount },
      items: b1.items, urds: b1.urds, metals: b1.metals,
    })
    check('paid in full, nothing owing', api.sale.read({ id: s1.id }).net_balance, 0)

    sub('Ashok buys on credit and trades in 15 g of old gold at 88%')
    const s2 = sellChain(1, {
      party_id: ashok, party_name: 'Ashok Deshmukh', area: 'Camp',
      is_credit: 1, payment_mode: 'Cash', amount_received: 50000,
    }, [{ name: 'Old Gold', gross_wt: 15, net_wt: 15, purity: 88, rate: RATE }])
    const b2 = api.sale.read({ id: s2.id })
    // Old gold: 15 x 88% = 13.200 fine x 7,000 = 92,400 credited.
    check('old gold valued', b2.urd_amount, 92400)
    check('balance after part payment', b2.net_balance,
      b2.total_amount - 92400 - 50000)
    check('and it is what the khata says',
      api.party.balance({ id: ashok }).balance, b2.net_balance)

    sub('Verma Traders (Gujarat) — a metal-basis wholesale bill')
    const t3 = chainTags[2]
    const s3 = api.sale.save({
      head: {
        prefix: 'COM', bill_date: '2026-07-18', party_id: wholesale,
        party_name: 'Verma Traders', state: 'Gujarat', is_credit: 1,
        payment_mode: 'Cash', gst_pct: 3, weightwise: 1,
        bill_discount: 0, making_discount: 0, other_amount: 0,
        manual_urd_amount: 0, tcs_pct: 0, amount_received: 0,
      },
      items: [{
        tag: t3.tag, tag_stock_id: t3.id, item_id: chainItem, item_name: 'Gold Chain',
        hsn: '7113', qty: 0, gross_wt: t3.gross_wt, purity: t3.purity, stone_wt: 0,
        net_wt: t3.net_wt, rate_per_gm: 0, mkg_per_gm: MAKING, hallmark_charges: 0,
      }],
      metals: [{ metal: 'Gold', balance_wt: 10, rate_per_gm: RATE }],
    })
    const b3 = api.sale.read({ id: s3.id })
    // 22.400 at 91.6% = 20.518 fine sold; 10 settled in cash, 10.518 still owed AS METAL.
    check('fine sold on the bill', b3.metals[0].fine_sold, 20.518, 0.01)
    check('settled now in rupees', b3.metals[0].amount, 70000)
    check('metal still owed', b3.metals[0].pending_wt, 10.518, 0.01)
    check('and it sits on their gold khata, not their money khata',
      api.party.metalBalance({ id: wholesale }).balance, 10.518, 0.01)

    /* ─────────────── Order with an advance ─────────────── */
    head('16 Jul — Meena books a bangle, pays ₹20,000 advance')
    const bangleItem = mkItem('Gold Bangle', g22)
    const order = api.order.save({
      head: {
        prefix: 'NO', order_date: '2026-07-16', delivery_date: '2026-08-05',
        karagir_date: '2026-07-30', party_id: meena, party_name: 'Meena Kulkarni',
        karagir_id: karagir, advance_amount: 20000, remark: 'Plain kada',
      },
      items: [{
        item_id: bangleItem, item_name: 'Gold Bangle', qty: 0, gross_wt: 25,
        stone_wt: 0, net_wt: 25, purity: 91.6, rate_per_gm: RATE, mkg_per_gm: MAKING,
        hallmark_charges: 45,
      }],
    })
    check('order taken', api.order.read({ id: order.id }).status, 'BOOKED')
    const inv = api.order.toInvoice({ id: order.id })
    const b4 = api.sale.read({ id: inv.id })
    check('the advance carries onto the bill', b4.amount_received, 20000)
    check('order is closed out', api.order.read({ id: order.id }).status, 'DELIVERED')

    /* ─────────────── Scheme, return, refining, money ─────────────── */
    head('The rest of the month')
    sub('Ashok is two instalments into a 11+1 gold plan')
    const scheme = api.gss.saveScheme({
      name: '11 + 1 Gold Plan', scheme_type: 'On Amount', period_unit: 'Months',
      total_periods: 12, paying_periods: 11, monthly_amount: 5000, maturity_bonus: 5000,
    })
    const acct = api.gss.assign({
      scheme_id: scheme, party_id: ashok, start_date: '2026-06-01',
    })
    const due = api.gss.readAccount({ id: acct.id }).receipts.filter((r) => r.status === 'PENDING')
    api.gss.receive({ receipt_id: due[0].id, received_date: '2026-06-01', payment_type: 'Cash' })
    api.gss.receive({ receipt_id: due[1].id, received_date: '2026-07-01', payment_type: 'Cash' })
    check('scheme holds 10,000 of his money',
      api.gss.balance({ id: acct.id, as_of: '2026-07-31' }).balance_amount, 10000)

    sub('Meena returns her chain — it did not fit')
    const ret = api.saleReturn.save({
      head: { return_date: '2026-07-20', sale_id: s1.id, party_id: meena,
              party_name: 'Meena Kulkarni', refund_amount: 171932.75, gst_pct: 3 },
      items: [{ tag: chainTags[0].tag, tag_stock_id: chainTags[0].id, item_id: chainItem,
                item_name: 'Gold Chain', gross_wt: chainTags[0].gross_wt, stone_wt: 0,
                net_wt: chainTags[0].net_wt, purity: chainTags[0].purity,
                rate_per_gm: RATE, mkg_per_gm: MAKING, hallmark_charges: 45 }],
    })
    check('the chain is back in the tray',
      api.tagStock.list({ status: 'IN_STOCK' }).some((t) => t.tag === chainTags[0].tag), true)

    sub('Old gold and scrap go to the refinery, pure gold comes back')
    api.refinery.save({
      head: { prefix: 'MO', invoice_date: '2026-07-25', direction: 'OUT',
              party_id: refinery, party_name: 'Shree Refinery', gst_pct: 0,
              paid_amount: 0, metal: 'Gold' },
      items: [{ item_name: 'Scrap', gross_wt: 15, stone_wt: 0, net_wt: 15,
                purity: 88, rate_per_gm: 0, gross_wastage: 0 }],
    })
    check('refinery holds our metal', api.party.metalBalance({ id: refinery }).balance > 0, true)

    sub('Pay Sangam ₹10,00,000 by bank; pay the electricity bill in cash')
    api.voucher.save({
      kind: 'PAYMENT', voucher_date: '2026-07-28', party_id: supplier,
      party_name: 'Sangam Bullion', amount: 1000000, payment_type: 'NEFT',
    })
    api.voucher.save({
      kind: 'PAYMENT', voucher_date: '2026-07-28', account_id: electricity,
      amount: 8400, payment_type: 'Cash', narration: 'July electricity',
    })
    check('supplier owes less now',
      api.party.balance({ id: supplier }).balance, -(3605000 - 1000000))

    /* ═══════════════ THE RECONCILIATIONS ═══════════════ */
    head('Month end — do the books agree with themselves?')

    sub('1. The trial balance foots')
    const tb = api.reports.trialBalance(FY)
    check('Dr equals Cr', tb.drTotal, tb.crTotal)

    sub('2. The balance sheet balances')
    const bs = api.reports.balanceSheet(FY)
    check('assets equal liabilities plus capital', bs.assetTotal, bs.liabilityTotal, 0.05)

    sub('3. Every party closes where their own ledger says')
    const parties = [
      ['Meena', meena], ['Ashok', ashok], ['Verma', wholesale],
      ['Sangam', supplier], ['Ramesh', karagir], ['Shree Refinery', refinery],
    ]
    for (const [name, id] of parties) {
      const led = api.reports.ledger({ partyId: id, from: FY.from, to: FY.to })
      const signed = led.closingSide === 'Dr' ? led.closing : -led.closing
      check(`${name}: statement equals balance`, signed, api.party.balance({ id }).balance, 0.05)
    }

    sub('4. The customers add up to Sundry Debtors')
    const out = api.reports.outstandingList({ from: FY.from, to: FY.to })
    const debtors = tb.dr.find((r) => r.name === 'Sundry Debtors')?.amount ?? 0
    const creditors = tb.cr.find((r) => r.name === 'Sundry Creditors')?.amount ?? 0
    const sumDebtors = (out.debtors || []).reduce((s, r) => s + Number(r.balance || 0), 0)
    const sumCreditors = (out.creditors || []).reduce((s, r) => s + Math.abs(Number(r.balance || 0)), 0)
    check('debtor list equals the trial balance', sumDebtors, debtors, 0.05)
    check('creditor list equals the trial balance', sumCreditors, creditors, 0.05)

    sub('5. Cash and bank agree across three reports')
    const cb = api.reports.cashBook({ from: FY.from, to: FY.to, account: 'Cash Account' })
    const dayb = api.reports.dayBook({ from: '2026-07-31', to: '2026-07-31' })
    const tbCash = tb.dr.find((r) => r.name === 'Cash Account')?.amount ?? 0
    check('cash book closing equals the trial balance', cb.closing, tbCash, 0.05)
    const dayCash = dayb.accounts.find((a) => a.name === 'Cash Account')
    check('and the day book agrees too', dayCash.closing, tbCash, 0.05)
    const dayBank = dayb.accounts.find((a) => a.name === 'Bank Account')
    const tbBank = tb.dr.find((r) => r.name === 'Bank Account')?.amount ?? 0
    check('bank agrees as well', dayBank.closing, tbBank, 0.05)

    sub('6. GST charged on the bills equals GST on the return')
    const billedGst = raw.prepare(
      `SELECT COALESCE(SUM(gst_amount),0) v FROM sale WHERE bill_date BETWEEN ? AND ?`
    ).get(FY.from, FY.to).v
    const r1 = api.reports.gstReturn({ direction: 'OUT', from: FY.from, to: FY.to })
    check('GSTR-1 tax equals what the bills charged', r1.totals.gst, billedGst, 0.05)
    // Inter-state must be IGST and intra-state CGST+SGST — never both on one line.
    const mixed = r1.rows.filter((r) => Number(r.igst) > 0 && Number(r.cgst) > 0)
    check('no bill carries IGST and CGST at once', mixed.length, 0)
    const gujarat = r1.rows.find((r) => r.party_name === 'Verma Traders')
    check('the Gujarat bill is IGST', gujarat && Number(gujarat.igst) > 0, true)
    check('and carries no CGST', gujarat ? Number(gujarat.cgst) : 0, 0)

    sub('7. The stock report equals what is physically in the trays')
    const inStock = api.tagStock.list({ status: 'IN_STOCK' })
    const trayFine = inStock.reduce((s, t) => s + Number(t.final_wt), 0)
    const rep = api.reports.stock({ status: 'IN_STOCK' })
    const repFine = rep.rows.reduce((s, r) => s + Number(r.final_wt), 0)
    check('piece count agrees', rep.rows.length, inStock.length)
    check('fine weight agrees', repFine, trayFine, 0.01)

    sub('8. The goldsmith’s metal balance equals issued less received')
    const kl = api.karagir.ledger({ karagirId: karagir })
    check('karagir khata reconciles',
      api.party.metalBalance({ id: karagir }).balance,
      kl.totals.issued - kl.totals.received - kl.totals.wastage, 0.02)

    sub('9. Nothing changes when nothing happens')
    // Reading the books twice must give the same answer — a report that mutates
    // anything, or depends on wall-clock time inside the period, shows up here.
    const tb2 = api.reports.trialBalance(FY)
    check('trial balance is stable on re-read', tb2.drTotal, tb.drTotal)
    check('and still foots', tb2.drTotal, tb2.crTotal)

    sub('10. Deleting the day’s last bill reverses it completely')
    const beforeDel = {
      tb: api.reports.trialBalance(FY).drTotal,
      ashok: api.party.balance({ id: ashok }).balance,
      stock: api.tagStock.list({ status: 'IN_STOCK' }).length,
    }
    const throwaway = sellChain(3, {
      party_id: ashok, party_name: 'Ashok Deshmukh', is_credit: 1,
      payment_mode: 'Cash', amount_received: 1000,
    })
    api.sale.remove({ id: throwaway.id })
    check('trial balance back where it was',
      api.reports.trialBalance(FY).drTotal, beforeDel.tb, 0.05)
    check('customer balance back where it was',
      api.party.balance({ id: ashok }).balance, beforeDel.ashok, 0.05)
    check('and the piece is back in stock',
      api.tagStock.list({ status: 'IN_STOCK' }).length, beforeDel.stock)
    check('the books still foot afterwards',
      api.reports.trialBalance(FY).drTotal, api.reports.trialBalance(FY).crTotal)

    sub('11. No ledger row is orphaned or one-sided')
    const orphan = raw.prepare(
      `SELECT COUNT(*) c FROM ledger_entry WHERE party_id IS NULL AND account_id IS NULL`
    ).get().c
    check('every posting belongs to a party or an account', orphan, 0)
    const bothSides = raw.prepare(
      `SELECT COUNT(*) c FROM ledger_entry WHERE debit > 0 AND credit > 0`
    ).get().c
    check('no posting is a debit and a credit at once', bothSides, 0)
    const negative = raw.prepare(
      `SELECT COUNT(*) c FROM ledger_entry WHERE debit < 0 OR credit < 0`
    ).get().c
    check('no negative postings', negative, 0)

    sub('12. Stock cannot go negative')
    const negStock = raw.prepare(
      `SELECT COUNT(*) c FROM tag_stock WHERE gross_wt < 0 OR net_wt < 0 OR final_wt < 0`
    ).get().c
    check('no piece has a negative weight', negStock, 0)
    const loose = api.looseStock.summary({ metal: 'Gold' })
    check('the loose pool is not negative', loose.available_fine >= -0.001, true)
  } catch (e) {
    fail++
    problems.push(`ERROR ${e.message}`)
    console.log('\n  ERROR', e && e.stack ? e.stack : e)
  }

  console.log(`\n${'═'.repeat(60)}`)
  console.log(`${pass} passed, ${fail} failed`)
  if (problems.length) {
    console.log('\nWhat disagreed:')
    problems.forEach((p) => console.log('  · ' + p))
  }
  console.log('═'.repeat(60))
  app.exit(fail ? 1 : 0)
})
