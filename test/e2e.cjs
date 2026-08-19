/**
 * End-to-end verification against the demo video.
 *
 * Replays the exact transaction shown in the recording and asserts every derived
 * number matches what the original software displayed. Run with:
 *    npm test
 */
const { app } = require('electron')
const path = require('node:path')
const fs = require('node:fs')
const os = require('node:os')

// The whole replay happens on one pinned day. Anything that would otherwise be
// stamped with the real clock (tag entry dates, scheme receipts) is given this
// date explicitly — otherwise the day-book assertions below silently fall out of
// range the moment the machine's date moves past it.
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

// Give each run its own Chromium profile — otherwise two test processes
// fight over the same cache directory and the slower one flakes.
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'parivar-run-')))

app.whenReady().then(() => {
  // Always start from an empty database so the run is deterministic.
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'parivar-test-'))
  const db = require('../electron/db.cjs')
  db.open(tmp)
  const api = require('../electron/api.cjs')

  try {
    console.log('\n── 1. Item master ──────────────────────────────')
    const groups = api.itemGroup.list()
    const g22 = groups.find((g) => g.name === '22K Gold')
    check('22K Gold default purity', g22.purity, 91.6)

    const itemId = api.item.save({
      name: 'Ring',
      item_type_id: groups.find((g) => g.name === '22K Gold').item_type_id,
      item_group_id: g22.id,
      design_id: null, weight_mode: 'WEIGHT', uom: 'GRAM', hsn: '7113', image: '',
    })
    const item = api.item.list()[0]
    check('tag prefix derived from name', item.tag_prefix, 'RIN')

    console.log('\n── 2. Tagged stock (video: 10 / 12 / 15 g @ 91.6%) ──')
    api.tagStock.saveBatch({
      itemId,
      rows: [
        { gross_wt: 10, black_beads: 0, stone_wt: 0, purity: 91.6, mkg_per_gm: 0, hallmark_charges: 0, huid: '', gst_pct: 3, qty: 0, location: 'Shop', entry_date: DAY },
        { gross_wt: 12, black_beads: 0, stone_wt: 0, purity: 91.6, mkg_per_gm: 0, hallmark_charges: 0, huid: '', gst_pct: 3, qty: 0, location: 'Shop', entry_date: DAY },
        { gross_wt: 15, black_beads: 0, stone_wt: 0, purity: 91.6, mkg_per_gm: 0, hallmark_charges: 0, huid: '', gst_pct: 3, qty: 0, location: 'Shop', entry_date: DAY },
      ],
    })
    const tags = api.tagStock.list({ status: 'IN_STOCK' })
    check('tags created', tags.length, 3)
    check('tag 1 number', tags[0].tag, 'RIN00001')
    check('tag 3 number', tags[2].tag, 'RIN00003')
    check('RIN00001 fine wt', tags[0].final_wt, 9.16)
    check('RIN00002 fine wt', tags[1].final_wt, 10.992)
    check('RIN00003 fine wt', tags[2].final_wt, 13.74)
    check('total fine in stock', tags.reduce((s, t) => s + t.final_wt, 0), 33.892)

    console.log('\n── 3. Customer with 9500 Dr opening ────────────')
    const partyId = api.party.save({
      party_type: 'CUSTOMER', name: 'Sandip Jain', area: 'Kothrud',
      whatsapp: '9767211065', mobile: '9767211065', state: 'Maharashtra',
      opening_balance: 9500, opening_dr_cr: 'Dr', metals: [],
    })
    check('opening balance', api.party.balance({ id: partyId }).balance, 9500)

    console.log('\n── 4. Sale of RIN00002 @ 4590/g + 300/g making ──')
    const ring2 = tags[1]
    const sale = api.sale.save({
      head: {
        prefix: 'COM', bill_date: DAY, party_id: partyId, party_name: 'Sandip Jain',
        mobile: '9767211065', area: 'Kothrud', state: 'Maharashtra',
        is_credit: 1, payment_mode: 'Cash', gst_pct: 3,
        bill_discount: 0, making_discount: 0, other_amount: 0,
        manual_urd_amount: 0, tcs_pct: 0, amount_received: 0,
      },
      items: [{
        tag: ring2.tag, tag_stock_id: ring2.id, item_id: itemId, item_name: 'Ring', hsn: '7113',
        qty: 0, gross_wt: 12, purity: 91.6, stone_wt: 0, net_wt: 12,
        rate_per_gm: 4590, mkg_per_gm: 300, hallmark_charges: 0, huid: '',
      }],
      urds: [{
        name: 'Old Gold', description: 'chain',
        gross_wt: 3, net_wt: 3, purity: 80, rate: 4500,
      }],
    })
    check('bill number', sale.bill_no, 'COM1')

    const s = api.sale.read({ id: sale.id })
    check('goods amount  (12 x 4590)', s.goods_amount, 55080)
    check('making amount (12 x 300)', s.making_amount, 3600)
    check('bill amount', s.bill_amount, 58680)
    check('GST @ 3%', s.gst_amount, 1760.4)
    check('total (GST+Bill)', s.total_amount, 60440.4)
    check('URD fine wt (3 @ 80%)', s.urds[0].final_wt, 2.4)
    check('URD amount (2.4 x 4500)', s.urd_amount, 10800)
    check('net balance', s.net_balance, 49640.4)

    console.log('\n── 5. Stock consumed ───────────────────────────')
    const left = api.tagStock.list({ status: 'IN_STOCK' })
    check('tags remaining', left.length, 2)
    check('fine wt remaining (33.892 - 10.992)', left.reduce((a, t) => a + t.final_wt, 0), 22.9)

    console.log('\n── 6. Ledger (video showed 59140 Dr) ───────────')
    check('customer balance after bill', api.party.balance({ id: partyId }).balance, 59140.4)

    console.log('\n── 7. Receipt of 30000 ─────────────────────────')
    const vr = api.voucher.save({
      kind: 'RECEIPT', voucher_date: DAY, party_id: partyId,
      party_name: 'Sandip Jain', amount: 30000, payment_type: 'Cash',
    })
    check('voucher number', vr.voucher_no, 'VR1')
    check('balance after receipt (video: 29140)', api.party.balance({ id: partyId }).balance, 29140.4)

    const led = api.reports.ledger({ partyId, from: '', to: '' })
    check('ledger Dr total', led.drTotal, 59140.4)
    check('ledger Cr total', led.crTotal, 30000)
    check('ledger closing side', led.closingSide, 'Dr')
    check('ledger closing', led.closing, 29140.4)

    console.log('\n── 8. Day book (video: gold 33.892 -> 22.900) ──')
    const dbk = api.reports.dayBook({ from: DAY, to: DAY })
    check('gold closing fine', dbk.stock.gold_closing, 22.9)
    check('URD gold closing fine', dbk.stock.urd_closing, 2.4)
    check('cash closing', dbk.cash.closing, 30000)

    console.log('\n── 9. Invoice print payload ────────────────────')
    const pr = api.sale.forPrint({ id: sale.id })
    check('amount in words', pr.amount_in_words, 'Rs. Fourty Nine Thousand Six Hundred Fourty and Fourty Paise Only')
    check('pending balance on bill', pr.pending_balance, 29140.4)

    console.log('\n── 10. Delete restores stock ───────────────────')
    api.sale.remove({ id: sale.id })
    check('tags back in stock', api.tagStock.list({ status: 'IN_STOCK' }).length, 3)
    check('balance back to opening', api.party.balance({ id: partyId }).balance, 9500 - 30000)

    console.log('\n── 11. Refining: send 15 g @ 91.6% out ─────────')
    const refId = api.party.save({ party_type: 'REFINERY', name: 'Shree Refinery', metals: [] })
    const stockBefore = api.reports.dayBook({ from: DAY, to: DAY }).stock.gold_closing
    check('stock before refining', stockBefore, 33.892)

    const tag3 = api.tagStock.list({ status: 'IN_STOCK' }).find((t) => t.tag === 'RIN00003')
    const refOut = api.refinery.save({
      head: {
        prefix: 'MO', invoice_date: DAY, direction: 'OUT',
        party_id: refId, party_name: 'Shree Refinery',
        gst_pct: 0, discount: 0, sub_tax: 0, paid_amount: 0,
      },
      items: [{
        tag: tag3.tag, item_id: itemId, item_name: 'Ring', qty: 0,
        gross_wt: 15, black_beads: 0, stone_wt: 0, net_wt: 15,
        purity: 91.6, rate_per_gm: 0, gross_wastage: 0.25,
      }],
    })
    check('refinery doc no', refOut.invoice_no, 'MO1')

    const ref = api.refinery.read({ id: refOut.id })
    check('fine sent out (15 @ 91.6%)', ref.items[0].fine_wt, 13.74)
    check('melted tag left stock', api.tagStock.list({ status: 'IN_STOCK' }).length, 2)
    check('stock after sending out (33.892 - 13.740)',
      api.reports.dayBook({ from: DAY, to: DAY }).stock.gold_closing, 20.152)

    console.log('\n── 12. Refining: receive 13.500 pure back ──────')
    api.refinery.save({
      head: {
        prefix: 'MO', invoice_date: DAY, direction: 'IN',
        party_id: refId, party_name: 'Shree Refinery',
        gst_pct: 0, discount: 0, sub_tax: 0, paid_amount: 1500,
      },
      items: [{
        item_name: 'Pure Gold', qty: 0, gross_wt: 13.5, black_beads: 0, stone_wt: 0,
        net_wt: 13.5, purity: 100, rate_per_gm: 6000, gross_wastage: 0,
      }],
    })
    check('stock after receiving (20.152 + 13.500)',
      api.reports.dayBook({ from: DAY, to: DAY }).stock.gold_closing, 33.652)

    console.log('\n── 13. Karagir order + advance ─────────────────')
    const ord = api.order.save({
      head: {
        prefix: 'NO', order_date: DAY, delivery_date: '2026-08-10',
        party_id: partyId, party_name: 'Sandip Jain',
        status: 'BOOKED', discount: 0, advance_amount: 5000,
      },
      items: [{
        item_name: 'Bangle', qty: 1, gross_wt: 20, stone_wt: 0, net_wt: 20,
        purity: 91.6, rate_per_gm: 4590, mkg_per_gm: 250, hallmark_charges: 45,
      }],
    })
    check('order no', ord.order_no, 'NO1')

    const o = api.order.read({ id: ord.id })
    // order_item.amount holds the goods value (the video's "Amount" column);
    // making and hallmark are separate columns.
    check('order goods (20 x 4590)', o.items[0].amount, 91800)
    check('order making (20 x 250)', o.items[0].mkg_amount, 5000)
    check('order total (91800+5000+45)', o.total_amount, 96845)
    check('order balance after 5000 advance', o.balance_amount, 91845)

    const balAfterAdvance = api.party.balance({ id: partyId }).balance
    check('advance credited to customer', balAfterAdvance, 9500 - 30000 - 5000)

    console.log('\n── 14. Order → invoice on delivery ─────────────')
    api.order.setStatus({ id: ord.id, status: 'RECEIVED' })
    const conv = api.order.toInvoice({ id: ord.id })
    check('invoice raised from order', conv.bill_no, 'COM2')
    check('order marked delivered', api.order.read({ id: ord.id }).status, 'DELIVERED')

    const inv = api.sale.read({ id: conv.id })
    check('invoice total incl. GST', inv.total_amount, 99750.35)
    check('advance carried as received', inv.amount_received, 5000)
    check('invoice balance', inv.net_balance, 94750.35)
    // Advance was reversed off the order and now lives on the bill — not counted twice.
    check('customer balance after invoicing',
      api.party.balance({ id: partyId }).balance, 9500 - 30000 + 99750.35 - 5000)
    console.log('\n── 15. Gold Saving Scheme (video: 20 x 11 + 1000) ──')
    const schemeId = api.gss.saveScheme({
      name: '11 + 1 Gold Plan', scheme_type: 'On Amount', period_unit: 'Months',
      total_periods: 12, paying_periods: 11, bonus_periods: 1,
      monthly_amount: 20, maturity_bonus: 1000,
    })
    const scheme = api.gss.schemes()[0]
    check('scheme code auto-generated', scheme.code, 'GSS1')

    const gsa = api.gss.assign({
      scheme_id: schemeId, party_id: partyId, start_date: DAY,
    })
    check('G.S. number', gsa.gs_no, 'GS1')

    const acc = api.gss.readAccount({ id: gsa.id })
    check('schedule rows created', acc.receipts.length, 12)
    check('maturity date is +12 months', acc.maturity_date, '2027-07-21')
    check('2nd instalment due date', acc.receipts[1].due_date, '2026-08-21')
    check('instalment 1 amount', acc.receipts[0].amount, 20)
    check('12th row is the shop benefit', acc.receipts[11].amount, 1000)
    check('12th row status', acc.receipts[11].status, 'INTEREST')
    // Video: 20 x 11 = 220, + 1000 benefit = 1220 "Amount After Maturity"
    check('amount after maturity', acc.maturity_value, 1220)

    const cashBefore = api.reports.dayBook({ from: DAY, to: DAY }).cash.closing
    const rcpt = api.gss.receive({ receipt_id: acc.receipts[0].id, amount: 20, received_date: DAY })
    check('GSS receipt no', rcpt.receipt_no, 'GR1')

    const acc2 = api.gss.readAccount({ id: gsa.id })
    check('paid so far', acc2.paid_amount, 20)
    check('instalment marked received', acc2.receipts[0].status, 'RECEIVED')
    check('cash increased by the instalment',
      api.reports.dayBook({ from: DAY, to: DAY }).cash.closing, cashBefore + 20)
    // Scheme money is a liability, so it must NOT touch the member's trading khata.
    check('member khata untouched by scheme',
      api.party.balance({ id: partyId }).balance, 9500 - 30000 + 99750.35 - 5000)

    api.gss.unreceive({ receipt_id: acc.receipts[0].id })
    check('undo restores pending', api.gss.readAccount({ id: gsa.id }).paid_amount, 0)
    check('cash restored after undo',
      api.reports.dayBook({ from: DAY, to: DAY }).cash.closing, cashBefore)

    console.log('\n── 16. Cost price and stock valuation ──────────')
    // Two costed pieces and one with no cost, to prove partial coverage is
    // reported rather than silently counted as zero-value stock.
    const costItem = api.item.save({
      name: 'Bangle',
      item_type_id: g22.item_type_id, item_group_id: g22.id,
      design_id: null, weight_mode: 'WEIGHT', uom: 'GRAM', hsn: '7113', image: '',
    })
    api.tagStock.saveBatch({
      itemId: costItem,
      rows: [
        { gross_wt: 10, stone_wt: 0, purity: 91.6, purchase_rate: 5800, entry_date: DAY },
        { gross_wt: 20, stone_wt: 0, purity: 91.6, purchase_rate: 5800, entry_date: DAY },
        { gross_wt: 5, stone_wt: 0, purity: 91.6, entry_date: DAY },   // cost not recorded
      ],
    })
    const bangles = api.tagStock.list({ status: 'IN_STOCK', itemId: costItem })
    check('cost per gram persisted', bangles[0].purchase_rate, 5800)
    check('missing cost stored as 0', bangles[2].purchase_rate, 0)

    // 10 g @ 91.6% = 9.160 fine; 9.160 × 5800 = 53,128
    const val = api.reports.stock({ status: 'IN_STOCK', search: 'Bangle' })
    check('piece value = fine × cost/gm', val.rows[0].cost_value, 53128)
    // + 20 g @ 91.6% = 18.320 fine × 5800 = 106,256  →  159,384
    check('total value at cost', val.totals.cost_value, 159384)
    check('uncosted pieces flagged', val.totals.uncosted, 1)

    const byItem = api.reports.stock({ status: 'IN_STOCK', groupBy: 'item', search: 'Bangle' })
    check('group value at cost', byItem.groups[0].cost_value, 159384)
    check('group uncosted count', byItem.groups[0].uncosted, 1)

    // Editing an existing tag must keep the cost, not reset it to the default.
    api.tagStock.saveBatch({
      itemId: costItem,
      rows: [{ ...bangles[0], gross_wt: 11, purchase_rate: 6000 }],
    })
    check('cost updated on edit',
      api.tagStock.list({ status: 'IN_STOCK', itemId: costItem })[0].purchase_rate, 6000)
  } catch (e) {
    fail++
    console.error('\nUNCAUGHT:', e.stack || e.message)
  }

  console.log(`\n${'═'.repeat(50)}`)
  console.log(`${pass} passed, ${fail} failed`)
  console.log('═'.repeat(50))
  process.exit(fail ? 1 : 0)
})
