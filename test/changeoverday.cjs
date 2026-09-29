/**
 * Changeover day — a real shop moving its books onto this software.
 *
 * "Shreeji Jewellers" has been trading for years on its old system. On 1 April
 * it enters its position as at that morning: cash in the drawer, money in the
 * bank, what nine customers owe, what three suppliers are owed, two customers
 * who owe *metal* rather than money, a goldsmith holding 180 g, forty tagged
 * pieces at their cost, and bullion in the safe. Then it trades for a month in
 * both systems, and reconciles.
 *
 * This is the scenario Changeover Check exists for, and it is the one that most
 * exercises OPENING BALANCES — the paths a shop only ever walks once, which is
 * exactly why they rot unnoticed. Every figure below is worked out by hand from
 * the shop's position, not read back out of the app.
 *    npm run test:changeoverday
 */
const { app } = require('electron')
const path = require('node:path')
const fs = require('node:fs')
const os = require('node:os')

const OPEN = '2026-04-01'     // the morning of the switch
const FY = { from: OPEN, to: '2027-03-31' }
const RATE = 7000

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
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'parivar-chgday-'))
  const db = require('../electron/db.cjs')
  db.open(tmp)
  const api = require('../electron/api.cjs')

  const grp = (n) => api.itemGroup.list().find((x) => x.name === n)
  const g22 = grp('22K Gold')
  const ring = api.item.save({
    name: 'Gold Ring', item_type_id: g22.item_type_id, item_group_id: g22.id,
    design_id: null, weight_mode: 'WEIGHT', uom: 'GRAM', hsn: '7113', image: '',
  })

  /* ── What the OLD books said on the morning of 1 April ──
     These are the shop's figures. Everything below is entered from them, and
     the reconciliation at the end is checked against them, never against
     whatever the app happens to compute. */
  const OLD = {
    cash: 240000,
    bank: 1850000,
    // Nine customers owing, one of them in credit (he overpaid last month).
    customersOwing: [
      ['Anita Rao', 45000], ['Bharat Shah', 12500], ['Chetna Iyer', 87200],
      ['Dinesh More', 3400], ['Eknath Kale', 156000], ['Farida Sheikh', 9800],
      ['Ganesh Pawar', 61500], ['Hema Nair', 24000], ['Irfan Qureshi', -18000],
    ],
    suppliersOwed: [
      ['Sangam Bullion', 980000], ['Nakoda Refiners', 245000], ['Om Findings', 31000],
    ],
    // Two customers hold our metal — wholesale, on a metal basis.
    customersOwingMetal: [['Chetna Iyer', 22.5], ['Eknath Kale', 8]],
    karagirHolding: 180,          // Ramesh has 180 g of ours
    piecesInStock: 40,            // 40 rings, 12 g each, 91.6%, cost 6,400/fine g
    pieceGross: 12,
    piecePurity: 91.6,
    pieceCost: 6400,
    looseBullionFine: 320,        // in the safe, bought at 6,400
  }

  try {
    head('Entering the position as at 1 April')
    api.company.save({
      id: 1, name: 'Shreeji Jewellers', state: 'Maharashtra',
      gstin: '27AABCS1429B1ZX', fy_start: FY.from, fy_end: FY.to,
    })
    const cashId = api.account.list().find((a) => a.name === 'Cash Account').id
    const bankId = api.account.list().find((a) => a.name === 'Bank Account').id
    api.account.save({
      id: cashId, name: 'Cash Account', acc_type: 'Cash', acc_group: 'Current Asset',
      opening_balance: OLD.cash, opening_dr_cr: 'Dr',
    })
    api.account.save({
      id: bankId, name: 'Bank Account', acc_type: 'Bank', acc_group: 'Bank Accounts',
      opening_balance: OLD.bank, opening_dr_cr: 'Dr',
    })

    const metalOf = (name) =>
      (OLD.customersOwingMetal.find(([n]) => n === name) || [null, 0])[1]
    const customers = {}
    for (const [name, bal] of OLD.customersOwing) {
      customers[name] = api.party.save({
        name, party_type: 'CUSTOMER', state: 'Maharashtra', area: 'Pune',
        // A customer in credit is entered on the OTHER side, not as a negative.
        opening_balance: Math.abs(bal), opening_dr_cr: bal >= 0 ? 'Dr' : 'Cr',
        metals: metalOf(name) ? [{ metal: 'Gold', weight: metalOf(name), dr_cr: 'Dr' }] : [],
      })
    }
    const suppliers = {}
    for (const [name, bal] of OLD.suppliersOwed) {
      suppliers[name] = api.party.save({
        name, party_type: 'SUPPLIER', state: 'Maharashtra',
        opening_balance: bal, opening_dr_cr: 'Cr',
      })
    }
    const karagir = api.party.save({
      name: 'Ramesh Soni', party_type: 'KARAGIR', state: 'Maharashtra',
      opening_balance: 0, opening_dr_cr: 'Dr',
      metals: [{ metal: 'Gold', weight: OLD.karagirHolding, dr_cr: 'Dr' }],
    })

    // Opening stock: the pieces actually in the trays, at what they cost.
    api.tagStock.saveBatch({
      itemId: ring,
      rows: Array.from({ length: OLD.piecesInStock }, () => ({
        gross_wt: OLD.pieceGross, purity: OLD.piecePurity,
        purchase_rate: OLD.pieceCost, entry_date: OPEN,
      })),
    })
    // Opening bullion. Entering it as a purchase would invent a supplier
    // liability that does not exist — it is stock the shop already owns.
    api.looseStock.opening({
      metal: 'Gold', gross_wt: OLD.looseBullionFine, net_wt: OLD.looseBullionFine,
      fine_wt: OLD.looseBullionFine, entry_date: OPEN,
    })
    check('the bullion in the safe is on the books',
      api.looseStock.openingBalances().find((o) => o.metal === 'Gold').fine_wt,
      OLD.looseBullionFine)
    // Re-entering it must replace, not add — a shop correcting a day-one typo
    // must not end up with both attempts on the books.
    api.looseStock.opening({
      metal: 'Gold', gross_wt: OLD.looseBullionFine, net_wt: OLD.looseBullionFine,
      fine_wt: OLD.looseBullionFine, entry_date: OPEN,
    })
    check('correcting it replaces rather than doubles',
      api.looseStock.openingBalances().filter((o) => o.metal === 'Gold').length, 1)

    head('Does the software agree with the old books on day one?')
    // Nothing has been traded yet, so every figure must equal what was entered.
    const expectedDebtors = OLD.customersOwing
      .filter(([, b]) => b > 0).reduce((s, [, b]) => s + b, 0)
    const expectedCreditors =
      OLD.suppliersOwed.reduce((s, [, b]) => s + b, 0) +
      Math.abs(OLD.customersOwing.filter(([, b]) => b < 0).reduce((s, [, b]) => s + b, 0))
    const pieceFine = OLD.pieceGross * OLD.piecePurity / 100          // 10.992
    const stockFine = pieceFine * OLD.piecesInStock + OLD.looseBullionFine
    const stockValue = pieceFine * OLD.piecesInStock * OLD.pieceCost

    const day1 = api.reports.reconcile({
      as_on: OPEN,
      expected: {
        cash: OLD.cash, bank: OLD.bank,
        debtors: expectedDebtors, creditors: expectedCreditors,
        stock_fine: stockFine,
      },
    })
    const r = (k) => day1.rows.find((x) => x.key === k)
    check('cash agrees', r('cash').status, 'agrees')
    check('bank agrees', r('bank').status, 'agrees')
    check('customers owing agrees', r('debtors').status, 'agrees')
    check('and it is the hand-added total', r('debtors').ours, expectedDebtors)
    check('suppliers owed agrees', r('creditors').status, 'agrees')
    check('the customer in credit is on the creditor side',
      day1.creditors.some((c) => c.name === 'Irfan Qureshi'), true)
    check('gold on hand agrees', r('stock_fine').status, 'agrees')
    check('and it is trays plus safe', r('stock_fine').ours, stockFine, 0.01)
    check('every checked figure agreed on day one', day1.differing, 0)
    check('five figures were actually checked', day1.checked, 5)

    head('The parts the old system tracked separately')
    check('the goldsmith holds what he held',
      api.party.metalBalance({ id: karagir }).balance, OLD.karagirHolding)
    check('Chetna owes metal as well as money',
      api.party.metalBalance({ id: customers['Chetna Iyer'] }).balance, 22.5)
    check('and her money balance is untouched by it',
      api.party.balance({ id: customers['Chetna Iyer'] }).balance, 87200)
    check('a customer with no metal has none',
      api.party.metalBalance({ id: customers['Anita Rao'] }).balance, 0)

    head('And the books themselves hold on day one')
    const tb0 = api.reports.trialBalance(FY)
    check('trial balance foots before any trading', tb0.drTotal, tb0.crTotal)
    const bs0 = api.reports.balanceSheet(FY)
    check('balance sheet balances', bs0.assetTotal, bs0.liabilityTotal)
    check('stock is on the balance sheet at cost',
      bs0.assets.find((a) => /Stock/.test(a.name)).amount, stockValue, 1)

    head('A month of trading in both systems')
    // The shop keeps its old books too. Here is what happened, and what the old
    // system would therefore say on 30 April — worked out by hand.
    let cash = OLD.cash
    let bank = OLD.bank
    let debtors = expectedDebtors
    let creditors = expectedCreditors

    // 1. Anita pays 45,000 cash and clears her account.
    api.voucher.save({
      kind: 'RECEIPT', voucher_date: '2026-04-05', party_id: customers['Anita Rao'],
      party_name: 'Anita Rao', amount: 45000, payment_type: 'Cash',
    })
    cash += 45000; debtors -= 45000

    // 2. Four counter sales, cash, 12 g each at 7,500 + 400/g making + 3% GST.
    const stock = api.tagStock.list({ status: 'IN_STOCK' })
    let sold = 0
    for (let i = 0; i < 4; i++) {
      const t = stock[i]
      const goods = 12 * 7500
      const making = 12 * 400
      const total = (goods + making) * 1.03
      api.sale.save({
        head: { prefix: 'COM', bill_date: '2026-04-10', party_id: customers['Bharat Shah'],
                party_name: 'Bharat Shah', state: 'Maharashtra', is_credit: 0,
                payment_mode: 'Cash', gst_pct: 3, bill_discount: 0, making_discount: 0,
                other_amount: 0, manual_urd_amount: 0, tcs_pct: 0, amount_received: total },
        items: [{ tag: t.tag, tag_stock_id: t.id, item_id: ring, item_name: 'Gold Ring',
                  hsn: '7113', qty: 0, gross_wt: 12, purity: 91.6, stone_wt: 0, net_wt: 12,
                  rate_per_gm: 7500, mkg_per_gm: 400, hallmark_charges: 0 }],
      })
      cash += total
      sold++
    }
    check('four pieces left the trays', sold, 4)

    // 3. Pay Sangam 500,000 by bank.
    api.voucher.save({
      kind: 'PAYMENT', voucher_date: '2026-04-20', party_id: suppliers['Sangam Bullion'],
      party_name: 'Sangam Bullion', amount: 500000, payment_type: 'NEFT',
    })
    bank -= 500000; creditors -= 500000

    head('30 April — do the two systems still agree?')
    const day30 = api.reports.reconcile({
      as_on: '2026-04-30',
      expected: {
        cash, bank, debtors, creditors,
        stock_fine: stockFine - pieceFine * sold,
      },
    })
    const q = (k) => day30.rows.find((x) => x.key === k)
    check('cash still agrees', q('cash').status, 'agrees')
    check('and it is opening plus the month', q('cash').ours, cash)
    check('bank still agrees', q('bank').status, 'agrees')
    check('customers owing still agrees', q('debtors').status, 'agrees')
    check('suppliers owed still agrees', q('creditors').status, 'agrees')
    check('gold on hand still agrees', q('stock_fine').status, 'agrees')
    check('nothing drifted over the month', day30.differing, 0)

    head('And it really would have caught a difference')
    // The same reconciliation with one figure deliberately wrong, to prove the
    // month above passing means something.
    const wrong = api.reports.reconcile({
      as_on: '2026-04-30', expected: { cash: cash + 5000 },
    })
    check('a 5,000 discrepancy is caught',
      wrong.rows.find((x) => x.key === 'cash').status, 'differs')
    check('and reported to the rupee',
      wrong.rows.find((x) => x.key === 'cash').difference, -5000)

    head('Month end — the books still hold after a real migration')
    const tb = api.reports.trialBalance(FY)
    check('trial balance foots', tb.drTotal, tb.crTotal)
    const bs = api.reports.balanceSheet(FY)
    check('balance sheet balances', bs.assetTotal, bs.liabilityTotal)
    // Every party's statement must still close where their balance says, opening
    // balance and all — this is what the migration actually risks.
    for (const [name, id] of Object.entries(customers)) {
      const led = api.reports.ledger({ partyId: id, from: FY.from, to: FY.to })
      const signed = led.closingSide === 'Dr' ? led.closing : -led.closing
      check(`${name}: statement matches balance`, signed, api.party.balance({ id }).balance)
    }
    for (const [name, id] of Object.entries(suppliers)) {
      const led = api.reports.ledger({ partyId: id, from: FY.from, to: FY.to })
      const signed = led.closingSide === 'Dr' ? led.closing : -led.closing
      check(`${name}: statement matches balance`, signed, api.party.balance({ id }).balance)
    }
    const cb = api.reports.cashBook({ from: FY.from, to: FY.to })
    check('the cash book carries the opening balance through', cb.closing, cash)
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
