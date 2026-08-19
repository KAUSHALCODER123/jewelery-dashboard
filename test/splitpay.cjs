/**
 * Split payment on a sale bill, and making charged as a percentage.
 *
 * A bill settled half in UPI and half in cash must move the drawer and the bank
 * by what each actually took — the whole point of the split is that the money
 * lands in two places. So the checks here are ledger checks, not form checks:
 * where did the rupees go, does the day book agree, and does the split survive
 * a re-save without doubling.
 *    npm run test:splitpay
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
const rejects = (label, fn) => {
  try { fn(); fail++; console.log(`  FAIL  ${label}: expected a rejection`) }
  catch { pass++; console.log(`  PASS  ${label} = rejected`) }
}
const head = (t) => console.log(`\n── ${t} ${'─'.repeat(Math.max(0, 46 - t.length))}`)

app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'parivar-run-')))

app.whenReady().then(() => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'parivar-split-'))
  const db = require('../electron/db.cjs')
  db.open(tmp)
  const api = require('../electron/api.cjs')

  const acctBalance = (name) => {
    const a = api.account.list().find((x) => x.name === name)
    const cb = api.reports.cashBook({ account: name, from: DAY, to: DAY })
    return { id: a.id, closing: cb.closing }
  }

  try {
    head('1. A piece to sell')
    const grp = api.itemGroup.list().find((x) => x.name === '22K Gold')
    const itemId = api.item.save({
      name: 'Ring', item_type_id: grp.item_type_id, item_group_id: grp.id,
      design_id: null, weight_mode: 'WEIGHT', uom: 'GRAM', hsn: '7113', image: '',
    })
    const cust = api.party.save({ party_type: 'CUSTOMER', name: 'Rekha', state: 'Maharashtra', metals: [] })
    api.tagStock.saveBatch({ itemId, rows: [{ gross_wt: 10, purity: 100, entry_date: DAY }] })
    const tag = api.tagStock.list({ status: 'IN_STOCK' })[0]

    const line = (over) => ({
      tag: tag.tag, tag_stock_id: tag.id, item_id: itemId, item_name: 'Ring', hsn: '7113',
      qty: 0, gross_wt: 10, purity: 100, stone_wt: 0, net_wt: 10,
      rate_per_gm: 5000, mkg_per_gm: 0, hallmark_charges: 0, ...over,
    })
    const billHead = (over) => ({
      prefix: 'COM', bill_date: DAY, party_id: cust, party_name: 'Rekha',
      state: 'Maharashtra', is_credit: 0, payment_mode: 'Cash', gst_pct: 0,
      bill_discount: 0, making_discount: 0, other_amount: 0, manual_urd_amount: 0,
      tcs_pct: 0, amount_received: 50000, ...over,
    })

    head('2. Making charged as a percentage of the metal value')
    // 10 g at 5,000 = 50,000 of metal; 12% making = 6,000.
    const mk = api.sale.save({
      head: billHead({ amount_received: 0, is_credit: 1 }),
      items: [line({ mkg_pct: 12 })], urds: [],
    })
    const mkr = api.sale.read({ id: mk.id })
    check('metal value', mkr.goods_amount, 50000)
    check('making is 12% of the metal', mkr.making_amount, 6000)
    check('the percentage is stored on the line', mkr.items[0].mkg_pct, 12)
    check('bill total', mkr.bill_amount, 56000)
    api.sale.remove({ id: mk.id })

    // A rupee figure typed onto the line still wins over the percentage, and a
    // per-gram rate is used when no percentage is given — the three ways of
    // charging making must not fight each other.
    const mk2 = api.sale.save({
      head: billHead({ amount_received: 0, is_credit: 1 }),
      items: [line({ mkg_pct: 12, mkg_amount: 999 })], urds: [],
    })
    check('a typed rupee figure beats the percentage',
      api.sale.read({ id: mk2.id }).making_amount, 999)
    api.sale.remove({ id: mk2.id })
    const mk3 = api.sale.save({
      head: billHead({ amount_received: 0, is_credit: 1 }),
      items: [line({ mkg_per_gm: 300 })], urds: [],
    })
    check('no percentage falls back to the per-gram rate',
      api.sale.read({ id: mk3.id }).making_amount, 3000)
    api.sale.remove({ id: mk3.id })

    head('3. Half in UPI, half in cash')
    const cashBefore = acctBalance('Cash Account').closing
    const bankBefore = acctBalance('Bank Account').closing
    const sale = api.sale.save({
      head: billHead({}),
      items: [line({})],
      urds: [],
      payments: [
        { mode: 'Cash', amount: 20000, ref: '' },
        { mode: 'UPI', amount: 30000, ref: 'UPI-88231' },
      ],
    })
    const s = api.sale.read({ id: sale.id })
    check('both legs stored', s.payments.length, 2)
    check('the reference is kept', s.payments[1].ref, 'UPI-88231')
    check('the bill still totals', s.amount_received, 50000)
    // UPI is not cash, so it belongs in the bank — that is the whole point.
    check('cash drawer took only its leg',
      acctBalance('Cash Account').closing - cashBefore, 20000)
    check('the bank took the UPI leg',
      acctBalance('Bank Account').closing - bankBefore, 30000)
    check('the bill names its largest leg', s.payment_mode, 'UPI')
    check('nothing is owed', s.net_balance, 0)

    head('4. The day book counts each mode separately')
    const dayb = api.reports.dayBook({ from: DAY, to: DAY })
    const mode = (m) => (dayb.receivedBy || []).find((r) => r.mode === m)?.amount ?? 0
    check('cash side of the takings', mode('Cash'), 20000)
    check('UPI side of the takings', mode('UPI'), 30000)

    head('5. A split that does not foot is refused')
    rejects('short split rejected', () => api.sale.save({
      head: billHead({ id: sale.id, bill_no: s.bill_no }),
      items: [line({})], urds: [],
      payments: [{ mode: 'Cash', amount: 20000, ref: '' }],
    }))

    head('6. Re-saving replaces the split instead of doubling it')
    api.sale.save({
      head: { ...s, id: sale.id },
      items: s.items, urds: [],
      payments: [
        { mode: 'Cash', amount: 10000, ref: '' },
        { mode: 'Card', amount: 40000, ref: '4242' },
      ],
    })
    const s2 = api.sale.read({ id: sale.id })
    check('still two legs, not four', s2.payments.length, 2)
    check('cash leg re-posted, not added to',
      acctBalance('Cash Account').closing - cashBefore, 10000)
    check('card money went to the bank',
      acctBalance('Bank Account').closing - bankBefore, 40000)

    head('7. The swipe fee follows the card leg, not the whole bill')
    // Only what goes through the terminal is charged: cash handed over the
    // counter never reaches the bank, so it must not attract a fee.
    const bank = api.account.list().find((a) => a.name === 'Bank Account')
    api.account.save({
      ...bank, acc_group: 'Bank Accounts',
      is_card_swap: 1, card_pct_customer: 2, card_pct_shop: 1,
    })
    {
      api.tagStock.saveBatch({ itemId, rows: [{ gross_wt: 9, purity: 100, entry_date: DAY }] })
      const t3 = api.tagStock.list({ status: 'IN_STOCK' })[0]
      const cardBill = api.sale.save({
        head: billHead({ amount_received: 45000 }),
        items: [line({ tag: t3.tag, tag_stock_id: t3.id, gross_wt: 9, net_wt: 9 })],
        urds: [],
        payments: [
          { mode: 'Cash', amount: 25000, ref: '' },
          { mode: 'Card', amount: 20000, ref: '4242' },
        ],
      })
      const cb = api.sale.read({ id: cardBill.id })
      check('customer fee is 2% of the card leg only', cb.card_charge_customer, 400)
      check("the shop's own share is 1% of the same leg", cb.card_charge_shop, 200)
      api.sale.remove({ id: cardBill.id })
    }

    head('8. A bill with no split is unchanged')
    // A fresh piece — the one above is sold and cannot be billed twice.
    api.tagStock.saveBatch({ itemId, rows: [{ gross_wt: 8, purity: 100, entry_date: DAY }] })
    const tag2 = api.tagStock.list({ status: 'IN_STOCK' })[0]
    const plain = api.sale.save({
      head: billHead({ amount_received: 0, is_credit: 1 }),
      items: [line({ tag: tag2.tag, tag_stock_id: tag2.id, gross_wt: 8, net_wt: 8 })],
      urds: [],
    })
    check('no payment rows written', api.sale.read({ id: plain.id }).payments.length, 0)
    check('mode still the one on the bill',
      api.sale.read({ id: plain.id }).payment_mode, 'Cash')
  } catch (e) {
    fail++
    console.log('\n  ERROR', e && e.stack ? e.stack : e)
  }

  console.log(`\n${'═'.repeat(50)}\n  ${pass} passed, ${fail} failed\n${'═'.repeat(50)}`)
  app.exit(fail ? 1 : 0)
})
