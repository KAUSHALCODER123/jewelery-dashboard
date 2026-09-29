/**
 * Sales Return and Purchase Return — docs/VIDEO-SPEC-2.md §4.
 *
 * A return is a NEW dated document, not an edit or a deletion of the original
 * bill. What matters is that all three books move together — stock, money and
 * metal — and that the original bill is left exactly as it was printed.
 *    npm run test:returns
 */
const { app } = require('electron')
const path = require('node:path')
const fs = require('node:fs')
const os = require('node:os')

const DAY = '2026-07-21'
const NEXT = '2026-07-22'

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
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'parivar-ret-'))
  const db = require('../electron/db.cjs')
  db.open(tmp)
  const api = require('../electron/api.cjs')

  try {
    head('1. Sell a tagged piece')
    const partyId = api.party.save({
      party_type: 'CUSTOMER', name: 'Sandip Jain', state: 'Maharashtra', metals: [],
    })
    const g22 = api.itemGroup.list().find((g) => g.name === '22K Gold')
    const itemId = api.item.save({
      name: 'Ring', item_type_id: g22.item_type_id, item_group_id: g22.id,
      design_id: null, weight_mode: 'WEIGHT', uom: 'GRAM', hsn: '7113', image: '',
    })
    api.tagStock.saveBatch({
      itemId,
      rows: [{ gross_wt: 12, stone_wt: 0, purity: 91.6, entry_date: DAY }],
    })
    const tag = api.tagStock.list({ status: 'IN_STOCK' })[0]

    const sale = api.sale.save({
      head: {
        prefix: 'COM', bill_date: DAY, party_id: partyId, party_name: 'Sandip Jain',
        state: 'Maharashtra', is_credit: 1, payment_mode: 'Cash', gst_pct: 3,
        bill_discount: 0, making_discount: 0, other_amount: 0,
        manual_urd_amount: 0, tcs_pct: 0, amount_received: 0,
      },
      items: [{
        tag: tag.tag, tag_stock_id: tag.id, item_id: itemId, item_name: 'Ring', hsn: '7113',
        qty: 0, gross_wt: 12, purity: 91.6, stone_wt: 0, net_wt: 12,
        rate_per_gm: 4590, mkg_per_gm: 300, hallmark_charges: 0,
      }],
    })
    const s = api.sale.read({ id: sale.id })
    check('bill total', s.total_amount, 60440.4)
    check('customer owes', api.party.balance({ id: partyId }).balance, 60440.4)
    check('piece is sold', api.tagStock.list({ status: 'IN_STOCK' }).length, 0)
    check('customer owes metal', api.party.metalBalance({ id: partyId }).balance, 10.992)

    head('2. The customer brings it back the next day')
    const ret = api.saleReturn.save({
      head: {
        return_date: NEXT, party_id: partyId, party_name: 'Sandip Jain',
        against_sale_id: sale.id, against_bill_no: sale.bill_no,
        reason: 'Wrong size', gst_pct: 3, refund_amount: 0,
      },
      items: [{
        tag: tag.tag, tag_stock_id: tag.id, item_id: itemId, item_name: 'Ring',
        qty: 0, gross_wt: 12, stone_wt: 0, net_wt: 12, purity: 91.6,
        rate_per_gm: 4590, mkg_per_gm: 300,
      }],
    })
    check('return number', ret.return_no, 'SR1')
    const r = api.saleReturn.read({ id: ret.id })
    check('goods credited (12 x 4590)', r.goods_amount, 55080)
    check('making credited (12 x 300)', r.making_amount, 3600)
    check('GST credited', r.gst_amount, 1760.4)
    check('total credited', r.total_amount, 60440.4)
    check('links back to the bill', r.against_bill_no, sale.bill_no)

    head('3. All three books move')
    check('piece is sellable again', api.tagStock.list({ status: 'IN_STOCK' }).length, 1)
    check('customer owes nothing', api.party.balance({ id: partyId }).balance, 0)
    check('metal debt cleared', api.party.metalBalance({ id: partyId }).balance, 0)

    head('4. The original bill is untouched')
    const still = api.sale.read({ id: sale.id })
    check('bill still exists', still.bill_no, sale.bill_no)
    check('bill total unchanged', still.total_amount, 60440.4)

    head('5. The return is dated when the goods came back')
    check('return sits on the later day', r.return_date, NEXT)
    const dbk = api.reports.dayBook({ from: NEXT, to: NEXT })
    check('day book shows the return', dbk.sales_return.amt, 60440.4)
    check('and nothing on the sale day',
      api.reports.dayBook({ from: DAY, to: DAY }).sales_return.amt, 0)

    head('6. A cash refund moves the cash account')
    const cashBefore = api.reports.dayBook({ from: NEXT, to: NEXT }).cash.closing
    const ret2 = api.saleReturn.save({
      head: {
        return_date: NEXT, party_id: partyId, party_name: 'Sandip Jain',
        gst_pct: 0, refund_amount: 5000,
      },
      items: [{ item_name: 'Bangle', qty: 0, gross_wt: 5, net_wt: 5, purity: 91.6, rate_per_gm: 1000 }],
    })
    check('cash paid out',
      api.reports.dayBook({ from: NEXT, to: NEXT }).cash.closing, cashBefore - 5000)

    head('7. Undoing a return puts the piece back to sold')
    api.saleReturn.remove({ id: ret.id })
    check('piece is sold again', api.tagStock.list({ status: 'IN_STOCK' }).length, 0)
    // The second return was refunded in cash, so it nets to zero on the party's
    // money balance — credit the goods, debit the cash handed over.
    check('customer owes again', api.party.balance({ id: partyId }).balance, 60440.4)
    // Its metal stays off though: 5 g @ 91.6% = 4.580 fine came back to us.
    check('metal debt back', api.party.metalBalance({ id: partyId }).balance, 10.992 - 4.58)
    api.saleReturn.remove({ id: ret2.id })

    head('8. Purchase return sends metal back to the supplier')
    const supId = api.party.save({
      party_type: 'SUPPLIER', name: 'Mahavir Gold', state: 'Maharashtra', metals: [],
    })
    const pur = api.purchase.save({
      head: {
        prefix: 'MI', invoice_date: DAY, party_id: supId, party_name: 'Mahavir Gold',
        is_credit: 1, gst_pct: 0, discount: 0, sub_tax: 0, tcs_pct: 0, paid_amount: 0,
      },
      items: [{
        direction: 'IN', item_name: 'Bar', qty: 0, gross_wt: 100, stone_wt: 0, net_wt: 100,
        purity: 100, rate: 5000, wastage_pct: 0,
      }],
    })
    const owedBefore = api.party.balance({ id: supId }).balance
    // 100 g of 100 touch at a 995-basis rate of 5000 = 100 x 100 x 5000 / 99.5
    check('we owe the supplier', owedBefore, -502512.56, 0.02)

    const pret = api.purchaseReturn.save({
      head: {
        return_date: NEXT, party_id: supId, party_name: 'Mahavir Gold',
        against_purchase_id: pur.id, against_invoice_no: pur.invoice_no,
        reason: 'Short purity', gst_pct: 0, received_amount: 0,
      },
      items: [{ item_name: 'Bar', qty: 0, gross_wt: 20, stone_wt: 0, net_wt: 20, purity: 100, rate_per_gm: 5000 }],
    })
    check('return number', pret.return_no, 'PR1')
    const pr = api.purchaseReturn.read({ id: pret.id })
    check('value returned (20 g @ 100 touch, 995 basis)', pr.total_amount, 100502.51, 0.02)
    check('we owe the supplier less', api.party.balance({ id: supId }).balance, -402010.05, 0.02)
    check('day book shows the purchase return',
      api.reports.dayBook({ from: NEXT, to: NEXT }).purchase_return.amt, 100502.51, 0.02)

    head('9. Shop expenses go through the chart of accounts')
    // The whole point: an expense must reach the cash book and the day book.
    const accId = api.account.save({
      name: 'Electricity', acc_type: 'Expense', acc_group: 'Indirect Expense',
    })
    const cashBefore2 = api.reports.dayBook({ from: NEXT, to: NEXT }).cash.closing
    api.voucher.save({
      kind: 'PAYMENT', voucher_date: NEXT, party_id: null, account_id: accId,
      amount: 2000, payment_type: 'Cash', narration: 'July light bill',
    })
    check('cash went down by the bill',
      api.reports.dayBook({ from: NEXT, to: NEXT }).cash.closing, cashBefore2 - 2000)
    const spent = db.get().prepare(
      `SELECT COALESCE(SUM(debit-credit),0) v FROM ledger_entry WHERE account_id = ?`
    ).get(accId).v
    check('and the expense head carries the debit', spent, 2000)
    check('the old expense table is gone',
      db.get().prepare(
        `SELECT COUNT(*) c FROM sqlite_master WHERE type='table' AND name='expense'`
      ).get().c, 0)

    head('10. Undoing the purchase return restores the debt')
    api.purchaseReturn.remove({ id: pret.id })
    check('back to the full amount owed', api.party.balance({ id: supId }).balance, owedBefore)
  } catch (e) {
    fail++
    console.error('\nUNCAUGHT:', e.stack || e.message)
  }

  console.log(`\n${'═'.repeat(50)}`)
  console.log(`${pass} passed, ${fail} failed`)
  console.log('═'.repeat(50))
  process.exit(fail ? 1 : 0)
})
