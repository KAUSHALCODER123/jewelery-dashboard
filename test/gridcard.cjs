/**
 * Grid Settings, barcode reprint protection, card-swipe charges and making % —
 * docs/VIDEO-SPEC-2.md §8, §9, §12; gaps #17, #18, #19 and the two small stock
 * fields.
 *    npm run test:gridcard
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
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'parivar-gc-'))
  const db = require('../electron/db.cjs')
  db.open(tmp)
  const api = require('../electron/api.cjs')

  const g = (name) => api.itemGroup.list().find((x) => x.name === name)
  const grp = g('22K Gold')
  const itemId = api.item.save({
    name: 'Ring', item_type_id: grp.item_type_id, item_group_id: grp.id, design_id: null,
    weight_mode: 'WEIGHT', uom: 'GRAM', hsn: '7113', image: '',
  })
  const cust = api.party.save({
    name: 'Buyer', type: 'CUSTOMER', state: 'Maharashtra', opening_balance: 0,
  })
  const sell = (extra = {}, mkg = 0) => {
    api.tagStock.saveBatch({ itemId, rows: [{ gross_wt: 10, purity: 100, entry_date: DAY }] })
    const tag = api.tagStock.list({ status: 'IN_STOCK' }).sort((a, b) => b.id - a.id)[0]
    return api.sale.save({
      head: { prefix: 'COM', bill_date: DAY, party_id: cust, party_name: 'Buyer',
              state: 'Maharashtra', is_credit: 1, payment_mode: 'Cash', gst_pct: 3,
              bill_discount: 0, making_discount: 0, other_amount: 0, manual_urd_amount: 0,
              tcs_pct: 0, amount_received: 0, ...extra },
      items: [{ tag: tag.tag, tag_stock_id: tag.id, item_id: itemId, item_name: 'Ring',
                hsn: '7113', qty: 0, gross_wt: 10, purity: 100, stone_wt: 0, net_wt: 10,
                rate_per_gm: 5000, mkg_per_gm: mkg, hallmark_charges: 0 }],
    })
  }

  try {
    head('1. Grid Settings remembers a column layout')
    check('nothing saved to begin with', api.gridPref.read({ key: 'stock.detail' }).length, 0)
    api.gridPref.save({
      key: 'stock.detail',
      config: [
        { key: 'tag', label: 'Barcode', width: 120, visible: true },
        { key: 'huid', label: 'HUID', width: 0, visible: false },
      ],
    })
    const saved = api.gridPref.read({ key: 'stock.detail' })
    check('two columns stored', saved.length, 2)
    check('the heading was renamed', saved[0].label, 'Barcode')
    check('the width kept', saved[0].width, 120)
    check('and one hidden', saved[1].visible, false)
    check('a different grid is untouched', api.gridPref.read({ key: 'sale.items' }).length, 0)

    head('2. Saving again replaces rather than appends')
    api.gridPref.save({ key: 'stock.detail', config: [{ key: 'tag', label: 'Tag', visible: true }] })
    check('one column now', api.gridPref.read({ key: 'stock.detail' }).length, 1)
    throws('a grid key is required', () => api.gridPref.save({ config: [] }))

    head('3. Reset forgets the layout entirely')
    api.gridPref.reset({ key: 'stock.detail' })
    check('back to nothing', api.gridPref.read({ key: 'stock.detail' }).length, 0)
    // A grid that was never customised, and one that was reset, must be
    // indistinguishable — both fall back to the code's own column list.
    check('reset is idempotent', api.gridPref.reset({ key: 'stock.detail' }), true)

    head('4. Barcode — Not Printed Only')
    api.tagStock.saveBatch({
      itemId, rows: [
        { gross_wt: 5, purity: 100, entry_date: DAY },
        { gross_wt: 6, purity: 100, entry_date: DAY },
      ],
    })
    const all = api.tagStock.list({ status: 'IN_STOCK' })
    check('both start unprinted', api.tagStock.list({ printed: 'NO' }).length, all.length)
    check('and none are printed', api.tagStock.list({ printed: 'YES' }).length, 0)
    api.tagStock.markPrinted({ ids: [all[0].id], copies: 2 })
    check('one is printed now', api.tagStock.list({ printed: 'YES' }).length, 1)
    check('and drops out of the unprinted list',
      api.tagStock.list({ printed: 'NO' }).some((t) => t.id === all[0].id), false)
    const printed = api.tagStock.list({ printed: 'YES' })[0]
    check('the copy count is kept', printed.label_print_count, 2)
    // Printing again should count the copies, not reset them.
    api.tagStock.markPrinted({ ids: [all[0].id], copies: 1 })
    check('a reprint adds to the count',
      api.tagStock.list({ printed: 'YES' })[0].label_print_count, 3)

    head('5. A jammed print can be un-marked')
    api.tagStock.clearPrinted({ ids: [all[0].id] })
    check('back to unprinted', api.tagStock.list({ printed: 'YES' }).length, 0)
    check('and the count is cleared',
      api.tagStock.list({ printed: 'NO' }).find((t) => t.id === all[0].id).label_print_count, 0)

    head('6. Making discount as a percentage')
    // 10g at 5,000 = 50,000 goods, making 400/g = 4,000. A 25% making discount
    // is 1,000 off, before GST — so the tax falls with it.
    const pct = sell({ making_disc_pct: 25 }, 400)
    const p = api.sale.read({ id: pct.id })
    check('making charged', p.making_amount, 4000)
    check('25% of it discounted', p.making_discount, 1000)
    check('GST on 53,000', p.gst_amount, 1590)
    check('total', p.total_amount, 54590)
    // Rupees and percent together add up, but never past the making itself.
    const both = sell({ making_disc_pct: 50, making_discount: 3000 }, 400)
    check('capped at the making charged',
      api.sale.read({ id: both.id }).making_discount, 4000)

    head('7. Card-swipe charges')
    const bank = api.account.list().find((a) => a.name === 'Bank Account')
    api.account.save({
      ...bank, acc_group: 'Bank Accounts',
      is_card_swap: 1, card_pct_customer: 1, card_pct_shop: 0.5,
    })
    check('the bank is the card-swap account',
      api.account.list().find((a) => a.name === 'Bank Account').is_card_swap, 1)
    // A cash bill is untouched.
    check('cash bills carry no card charge',
      api.sale.read({ id: sell({}, 0).id }).card_charge_customer, 0)
    // Card bill at the counter: 50,000 goods + 3% GST = 51,500 all swiped.
    // It must be a counter sale — on a CREDIT bill nothing has gone through the
    // terminal yet, so there is correctly no fee (see test/bugfixes.cjs §6).
    const card = sell({ payment_mode: 'Card', is_credit: 0 }, 0)
    const c = api.sale.read({ id: card.id })
    check('customer pays 1%', c.card_charge_customer, 515)
    check('shop bears 0.5%', c.card_charge_shop, 257.5)
    check('the fee is on top of the bill', c.total_amount, 52015)

    head('8. The shop’s share reaches the P&L')
    const pl = api.reports.profitAndLoss({ from: '2026-04-01', to: '2027-03-31' })
    const cardRow = pl.pl.dr.find((r) => r.name === 'Card Charges')
    check('card charges are an expense head', cardRow?.amount, 257.5)

    head('9. Card settings are refused where they make no sense')
    throws('a negative rate', () => api.account.save({
      ...bank, acc_group: 'Bank Accounts', is_card_swap: 1, card_pct_customer: -1,
    }))
    throws('over 100% in total', () => api.account.save({
      ...bank, acc_group: 'Bank Accounts', is_card_swap: 1,
      card_pct_customer: 60, card_pct_shop: 60,
    }))
    // Card settings only mean anything on a bank account.
    const exp = api.account.save({
      name: 'Tea Expense', acc_type: 'Expense', acc_group: 'Indirect Expense',
      is_card_swap: 1, card_pct_customer: 5,
    })
    const tea = api.account.list().find((a) => a.id === exp)
    check('a non-bank account cannot be a card account', tea.is_card_swap, 0)
    check('and its rate is dropped', tea.card_pct_customer, 0)

    head('10. Only one account can be the card account')
    api.account.save({
      name: 'HDFC Bank', acc_type: 'Bank', acc_group: 'Bank Accounts',
      is_card_swap: 1, card_pct_customer: 2, card_pct_shop: 0,
    })
    check('exactly one card account',
      api.account.list().filter((a) => a.is_card_swap).length, 1)
    check('and it is the new one',
      api.account.list().find((a) => a.is_card_swap).name, 'HDFC Bank')
  } catch (e) {
    fail++
    console.log('  ERROR', e && e.stack ? e.stack : e)
  }

  console.log(`\n${pass} passed, ${fail} failed`)
  app.exit(fail ? 1 : 0)
})
