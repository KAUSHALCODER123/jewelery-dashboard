/**
 * Regression suite for bugs found by an adversarial pass over the features added
 * in this cycle. Each section reproduces the original defect, so a future change
 * that reintroduces it fails here rather than in a shop.
 *    npm run test:bugfixes
 */
const { app } = require('electron')
const path = require('node:path')
const fs = require('node:fs')
const os = require('node:os')

const DAY = '2026-07-21'

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
function throws(label, fn, match) {
  try { fn(); fail++; console.log(`  FAIL  ${label}: expected a refusal, none came`) }
  catch (e) {
    if (match && !match.test(e.message)) {
      fail++; console.log(`  FAIL  ${label}: wrong message — ${e.message}`)
    } else { pass++; console.log(`  PASS  ${label} — ${e.message}`) }
  }
}
const head = (t) => console.log(`\n── ${t} ${'─'.repeat(Math.max(0, 46 - t.length))}`)

app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'parivar-run-')))

app.whenReady().then(() => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'parivar-bug-'))
  const db = require('../electron/db.cjs')
  db.open(tmp)
  const api = require('../electron/api.cjs')

  const g = (n) => api.itemGroup.list().find((x) => x.name === n)
  const grp = g('22K Gold')
  const itemId = api.item.save({
    name: 'Ring', item_type_id: grp.item_type_id, item_group_id: grp.id, design_id: null,
    weight_mode: 'WEIGHT', uom: 'GRAM', hsn: '7113', image: '',
  })
  const cust = api.party.save({
    name: 'Buyer', type: 'CUSTOMER', state: 'Maharashtra', opening_balance: 0,
  })
  const sell = (extra = {}) => {
    api.tagStock.saveBatch({ itemId, rows: [{ gross_wt: 10, purity: 100, entry_date: DAY }] })
    const tag = api.tagStock.list({ status: 'IN_STOCK' }).sort((a, b) => b.id - a.id)[0]
    return api.sale.save({
      head: { prefix: 'COM', bill_date: DAY, party_id: cust, party_name: 'Buyer',
              state: 'Maharashtra', is_credit: 0, payment_mode: 'Cash', gst_pct: 3,
              bill_discount: 0, making_discount: 0, other_amount: 0, manual_urd_amount: 0,
              tcs_pct: 0, amount_received: 0, ...extra },
      items: [{ tag: tag.tag, tag_stock_id: tag.id, item_id: itemId, item_name: 'Ring',
                hsn: '7113', qty: 0, gross_wt: 10, purity: 100, stone_wt: 0, net_wt: 10,
                rate_per_gm: 5000, mkg_per_gm: 0, hallmark_charges: 0 }],
    })
  }

  try {
    head('1. Bag weight is not metal, so it is not priced as metal')
    // The pouch is on the scale when the piece is weighed. Leaving it in net
    // weight charged the customer gold rates for plastic.
    api.tagStock.saveBatch({
      itemId, rows: [{ gross_wt: 10, bag_wt: 0.5, purity: 100, entry_date: DAY }],
    })
    const bagged = api.tagStock.list({ status: 'IN_STOCK' }).sort((a, b) => b.id - a.id)[0]
    check('gross includes the bag', bagged.gross_wt, 10)
    check('net excludes it', bagged.net_wt, 9.5)
    check('and so does fine', bagged.final_wt, 9.5)
    // It stacks with the other non-metal deductions rather than replacing them.
    api.tagStock.saveBatch({
      itemId, rows: [{ gross_wt: 20, bag_wt: 0.5, stone_wt: 2, black_beads: 0.5,
                       diamond_wt: 1, purity: 100, entry_date: DAY }],
    })
    const all = api.tagStock.list({ status: 'IN_STOCK' }).sort((a, b) => b.id - a.id)[0]
    check('every non-metal deduction applies', all.net_wt, 16)
    // A piece with no bag is unaffected — the whole point of a 0 default.
    api.tagStock.saveBatch({
      itemId, rows: [{ gross_wt: 10, purity: 100, entry_date: DAY }],
    })
    check('a plain piece nets as before',
      api.tagStock.list({ status: 'IN_STOCK' }).sort((a, b) => b.id - a.id)[0].net_wt, 10)
    // Correcting a bag weight in place must re-derive, not keep the old net.
    api.tagStock.updateRows({ rows: [{ id: bagged.id, bag_wt: 2 }] })
    check('an edited bag weight re-derives net',
      api.tagStock.list({ status: 'IN_STOCK' }).find((t) => t.id === bagged.id).net_wt, 8)

    head('2. The Day Book reports one opening balance, not two')
    const cashId = api.account.list().find((a) => a.name === 'Cash Account').id
    api.account.save({
      id: cashId, name: 'Cash Account', acc_type: 'Cash', acc_group: 'Current Asset',
      opening_balance: 5000, opening_dr_cr: 'Dr',
    })
    api.voucher.save({
      kind: 'RECEIPT', voucher_date: DAY, party_id: cust, party_name: 'Buyer',
      amount: 1000, payment_type: 'Cash',
    })
    const d = api.reports.dayBook({ from: DAY, to: DAY })
    const cashAcc = d.accounts.find((a) => a.name === 'Cash Account')
    // The legacy pair used to ignore the account's opening balance, so the same
    // payload reported 0 and 5,000 for the same account.
    check('the account carries its opening balance', cashAcc.opening, 5000)
    check('and the legacy pair agrees', d.cash.opening, cashAcc.opening)
    check('as does the closing', d.cash.closing, cashAcc.closing)
    check('which is opening plus the day', d.cash.closing, 6000)

    head('3. Deleting a tag that is on a transfer says why')
    api.branch.save({ name: 'Locker' })
    api.tagStock.saveBatch({
      itemId, rows: [{ gross_wt: 5, purity: 100, location: 'Shop', entry_date: DAY }],
    })
    const moved = api.tagStock.list({ status: 'IN_STOCK' }).sort((a, b) => b.id - a.id)[0]
    const t1 = api.stockTransfer.save({
      from_branch: 'Shop', to_branch: 'Locker', tags: [moved.tag],
    })
    // This used to surface as a bare "FOREIGN KEY constraint failed".
    throws('the refusal names the document',
      () => api.tagStock.remove({ id: moved.id }), /transfer TR\d+/)
    check('and the piece is still there',
      !!api.tagStock.list({ status: 'IN_STOCK' }).find((t) => t.id === moved.id), true)
    // Once the transfer is gone, the tag can go.
    api.stockTransfer.remove({ id: t1.id })
    check('the tag deletes once the document is gone', api.tagStock.remove({ id: moved.id }), true)

    head('4. A piece scanned twice still moves once')
    api.tagStock.saveBatch({
      itemId, rows: [{ gross_wt: 3, purity: 100, location: 'Shop', entry_date: DAY }],
    })
    const dup = api.tagStock.list({ status: 'IN_STOCK' })
      .filter((t) => t.location === 'Shop').sort((a, b) => b.id - a.id)[0]
    const t2 = api.stockTransfer.save({
      from_branch: 'Shop', to_branch: 'Locker', tags: [dup.tag, dup.tag, dup.tag],
    })
    check('counted once, not three times', t2.moved, 1)
    check('and the document lists it once',
      api.stockTransfer.read({ id: t2.id }).items.length, 1)
    check('the branch position agrees',
      api.branch.stock().find((p) => p.branch === 'Locker').pieces, 1)

    head('5. Undoing an old transfer cannot teleport a piece backwards')
    api.branch.save({ name: 'Camp' })
    const t3 = api.stockTransfer.save({
      from_branch: 'Locker', to_branch: 'Camp', tags: [dup.tag],
    })
    check('the piece is at Camp now',
      api.tagStock.list({ status: 'IN_STOCK' }).find((t) => t.id === dup.id).location, 'Camp')
    // Undoing the FIRST move would drag it back to Shop, past a document that
    // still stands saying it is at Camp.
    throws('the older transfer is held',
      () => api.stockTransfer.remove({ id: t2.id }), /moved by TR\d+/)
    check('so it stays at Camp',
      api.tagStock.list({ status: 'IN_STOCK' }).find((t) => t.id === dup.id).location, 'Camp')
    // In the right order it unwinds cleanly.
    api.stockTransfer.remove({ id: t3.id })
    check('undoing the later one first works',
      api.tagStock.list({ status: 'IN_STOCK' }).find((t) => t.id === dup.id).location, 'Locker')
    api.stockTransfer.remove({ id: t2.id })
    check('then the earlier one',
      api.tagStock.list({ status: 'IN_STOCK' }).find((t) => t.id === dup.id).location, 'Shop')

    head('6. No swipe, no swipe fee')
    const bank = api.account.list().find((a) => a.name === 'Bank Account')
    api.account.save({
      ...bank, acc_group: 'Bank Accounts', is_card_swap: 1,
      card_pct_customer: 2, card_pct_shop: 1,
    })
    // A credit bill marked "Card" with nothing received: no card has been
    // presented, so there is nothing for the bank to take a cut of.
    const credit = api.sale.read({ id: sell({ is_credit: 1, payment_mode: 'Card' }).id })
    check('customer is not charged a fee', credit.card_charge_customer, 0)
    check('nor does the shop book one', credit.card_charge_shop, 0)
    check('so the bill is just the goods and GST', credit.total_amount, 51500)
    // Take part of it on a card and the fee is on that part only.
    const part = api.sale.read({
      id: sell({ is_credit: 1, payment_mode: 'Card', amount_received: 20000 }).id,
    })
    check('fee is on what was actually swiped', part.card_charge_customer, 400)
    check('and the shop share too', part.card_charge_shop, 200)
    // A counter sale still charges on the whole bill, as before.
    const counter = api.sale.read({ id: sell({ is_credit: 0, payment_mode: 'Card' }).id })
    check('a counter sale is charged in full', counter.card_charge_customer, 1030)

    head('7. The books still balance after all of it')
    const tb = api.reports.trialBalance({ from: '2026-04-01', to: '2027-03-31' })
    check('trial balance foots', tb.drTotal, tb.crTotal)
  } catch (e) {
    fail++
    console.log('  ERROR', e && e.stack ? e.stack : e)
  }

  console.log(`\n${pass} passed, ${fail} failed`)
  app.exit(fail ? 1 : 0)
})
