/**
 * Day Book — gross/net/fine per metal, multiple bank accounts, and the
 * "Today Received Details" split. docs/VIDEO-SPEC-2.md §9, gap #21.
 *
 * The original shows three opening/closing pairs per metal, not one fine
 * figure. A shop counting its trays counts GROSS, so a book that reports only
 * fine weight cannot be checked against a physical count.
 *    npm run test:daybook
 */
const { app } = require('electron')
const path = require('node:path')
const fs = require('node:fs')
const os = require('node:os')

const D1 = '2026-07-20'   // opening day
const D2 = '2026-07-21'   // the day under test

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
const head = (t) => console.log(`\n── ${t} ${'─'.repeat(Math.max(0, 46 - t.length))}`)

app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'parivar-run-')))

app.whenReady().then(() => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'parivar-day-'))
  const db = require('../electron/db.cjs')
  db.open(tmp)
  const api = require('../electron/api.cjs')

  const g = (name) => api.itemGroup.list().find((x) => x.name === name)
  const mkItem = (name, groupName) => {
    const grp = g(groupName)
    return api.item.save({
      name, item_type_id: grp.item_type_id, item_group_id: grp.id, design_id: null,
      weight_mode: 'WEIGHT', uom: 'GRAM', hsn: '7113', image: '',
    })
  }
  const goldRing = mkItem('Gold Ring', '22K Gold')
  const silverAnklet = mkItem('Silver Anklet', 'Silver')

  const cust = api.party.save({
    name: 'Buyer', type: 'CUSTOMER', state: 'Maharashtra', opening_balance: 0,
  })

  try {
    head('1. Opening day: gold and silver tagged, with stones')
    // Gold: 20 gross, 2 stone → 18 net, 91.6% → 16.488 fine.
    api.tagStock.saveBatch({
      itemId: goldRing,
      rows: [{ gross_wt: 20, stone_wt: 2, purity: 91.6, entry_date: D1 }],
    })
    // Silver: 100 gross, no stone, 92.5% → 92.500 fine.
    api.tagStock.saveBatch({
      itemId: silverAnklet,
      rows: [{ gross_wt: 100, purity: 92.5, entry_date: D1 }],
    })

    const d2 = api.reports.dayBook({ from: D2, to: D2 })
    check('two metals on the book', d2.metals.length, 2)
    check('gold first', d2.metals[0].metal, 'Gold')
    check('silver second', d2.metals[1].metal, 'Silver')

    head('2. Three weight pairs, not one')
    const gold = d2.metals.find((m) => m.metal === 'Gold')
    check('gold opening gross', gold.opening.gross_wt, 20)
    check('gold opening net (stone out)', gold.opening.net_wt, 18)
    check('gold opening fine', gold.opening.fine_wt, 16.488)
    // Gross and net differ because of the stone — the whole point of showing all
    // three. A book reporting only fine could not be checked against the tray.
    check('gross and net really differ',
      gold.opening.gross_wt !== gold.opening.net_wt, true)
    const silver = d2.metals.find((m) => m.metal === 'Silver')
    check('silver kept apart', silver.opening.gross_wt, 100)
    check('with its own fine weight', silver.opening.fine_wt, 92.5)

    head('3. A day’s trade moves closing but not opening')
    const tag = api.tagStock.list({ status: 'IN_STOCK' })
      .find((t) => t.item_name === 'Gold Ring')
    api.sale.save({
      head: { prefix: 'COM', bill_date: D2, party_id: cust, party_name: 'Buyer',
              state: 'Maharashtra', is_credit: 0, payment_mode: 'Card', gst_pct: 3,
              bill_discount: 0, making_discount: 0, other_amount: 0, manual_urd_amount: 0,
              tcs_pct: 0, amount_received: 50000 },
      items: [{ tag: tag.tag, tag_stock_id: tag.id, item_id: goldRing, item_name: 'Gold Ring',
                hsn: '7113', qty: 0, gross_wt: 20, purity: 91.6, stone_wt: 2, net_wt: 18,
                rate_per_gm: 2700, mkg_per_gm: 0, hallmark_charges: 0 }],
      urds: [{ name: 'Old Gold', gross_wt: 5, net_wt: 5, purity: 80, rate: 4500 }],
    })

    const d3 = api.reports.dayBook({ from: D2, to: D2 })
    const gold3 = d3.metals.find((m) => m.metal === 'Gold')
    check('opening is unchanged by today', gold3.opening.gross_wt, 20)
    check('closing gross drops by what was sold', gold3.closing.gross_wt, 0)
    check('closing net too', gold3.closing.net_wt, 0)
    check('and closing fine', gold3.closing.fine_wt, 0)
    check('silver is untouched by a gold sale',
      d3.metals.find((m) => m.metal === 'Silver').closing.fine_wt, 92.5)

    head('4. Old gold is a separate stock line')
    const urdGold = d3.urdMetals.find((m) => m.metal === 'Gold')
    // 5 g at 80% = 4.000 fine taken in today.
    check('urd opening was nil', urdGold.opening.fine_wt, 0)
    check('urd closing holds today’s old gold', urdGold.closing.fine_wt, 4)
    check('with its gross weight too', urdGold.closing.gross_wt, 5)
    check('and it is NOT in the main stock line', gold3.closing.fine_wt, 0)

    head('5. Every cash and bank account, not just one')
    const names = d3.accounts.map((a) => a.name)
    check('cash account listed', names.includes('Cash Account'), true)
    check('bank account listed', names.includes('Bank Account'), true)
    api.account.save({
      name: 'SBI Bank', acc_type: 'Bank', acc_group: 'Bank Accounts',
      opening_balance: 2500, opening_dr_cr: 'Dr',
    })
    const d4 = api.reports.dayBook({ from: D2, to: D2 })
    const sbi = d4.accounts.find((a) => a.name === 'SBI Bank')
    check('a new bank appears', !!sbi, true)
    check('carrying its opening balance', sbi.opening, 2500)
    check('and its closing', sbi.closing, 2500)
    check('with no movement today', sbi.movement, 0)
    // The bill was SWIPED, so its 50,000 settles into the bank — not the drawer.
    // Anything but literal cash does; that is what makes these two balances mean
    // something, and it matches where the swipe fee comes out of.
    const cash = d4.accounts.find((a) => a.name === 'Cash Account')
    const bank = d4.accounts.find((a) => a.name === 'Bank Account')
    check('the drawer did not move', cash.movement, 0)
    check('the bank took the card payment', bank.movement, 50000)
    check('which is closing less opening', bank.closing - bank.opening, 50000)

    head('6. Today Received Details, split by how it was paid')
    api.voucher.save({
      kind: 'RECEIPT', voucher_date: D2, party_id: cust, party_name: 'Buyer',
      amount: 7000, payment_type: 'UPI', narration: 'part payment',
    })
    api.voucher.save({
      kind: 'RECEIPT', voucher_date: D2, party_id: cust, party_name: 'Buyer',
      amount: 3000, payment_type: 'Cash', narration: 'cash in',
    })
    const d5 = api.reports.dayBook({ from: D2, to: D2 })
    const mode = (m) => d5.receivedBy.find((r) => r.mode === m)?.amount ?? 0
    // The bill's 50,000 was swiped, so it belongs under Card, not Cash.
    check('card takings from the bill', mode('Card'), 50000)
    check('UPI from a voucher', mode('UPI'), 7000)
    check('cash from a voucher', mode('Cash'), 3000)
    check('sorted with the largest first', d5.receivedBy[0].mode, 'Card')
    check('and nothing else invented', d5.receivedBy.length, 3)

    head('7. The old single-figure fields still read the same')
    // Anything already reading `stock.gold_*` must keep working — the new rows
    // are additional, not a replacement.
    check('gold opening still there', d5.stock.gold_opening, 16.488)
    check('gold closing still there', d5.stock.gold_closing, 0)
    check('urd closing still there', d5.stock.urd_closing, 4)
    check('and it agrees with the per-metal row',
      d5.stock.gold_opening,
      d5.metals.find((m) => m.metal === 'Gold').opening.fine_wt)

    head('8. A day with nothing in it does not break')
    const quiet = api.reports.dayBook({ from: '2026-01-01', to: '2026-01-01' })
    check('no metal rows before any stock existed', quiet.metals.length, 0)
    check('nothing received', quiet.receivedBy.length, 0)
    check('but the accounts are still listed', quiet.accounts.length >= 2, true)
  } catch (e) {
    fail++
    console.log('  ERROR', e && e.stack ? e.stack : e)
  }

  console.log(`\n${pass} passed, ${fail} failed`)
  app.exit(fail ? 1 : 0)
})
