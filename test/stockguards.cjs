/**
 * Stock and old-gold guards found in the review after the loose-lot fix.
 *
 * Each section is a way the shelf, the old gold in the safe or a bill number
 * could come out wrong without any error on screen:
 *   1. Editing a refining document that melts a tag.
 *   2. Melting a piece that is reserved or out on a memo.
 *   3. Taking the same piece back twice on sales returns.
 *   4. Cancelling the bill an order became, with old gold taken at booking.
 *   5. A bill on a series that has been retired (COM), e.g. a parked draft.
 *   6. The phone's Day Book leaving out old gold bills.
 *    electron ./test/stockguards.cjs
 */
const { app } = require('electron')
const path = require('node:path')
const fs = require('node:fs')
const os = require('node:os')

const DAY = '2026-09-01'
const NEXT = '2026-09-02'

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
  try { fn(); fail++; console.log(`  FAIL  ${label}: expected it to be refused`) }
  catch (e) {
    if (match && !match.test(String(e.message))) {
      fail++; console.log(`  FAIL  ${label}: refused with the wrong message: ${e.message}`)
    } else { pass++; console.log(`  PASS  ${label} refused (${e.message})`) }
  }
}
function works(label, fn) {
  try { const r = fn(); pass++; console.log(`  PASS  ${label}`); return r }
  catch (e) { fail++; console.log(`  FAIL  ${label}: ${e.message}`); return null }
}
const head = (t) => console.log(`\n-- ${t} ${'-'.repeat(Math.max(0, 46 - t.length))}`)

app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'parivar-run-')))

app.whenReady().then(() => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'parivar-guards-'))
  const db = require('../electron/db.cjs')
  db.open(tmp)
  const api = require('../electron/api.cjs')

  const g22 = api.itemGroup.list().find((x) => x.name === '22K Gold')
  const ringId = api.item.save({
    name: 'Ring', item_type_id: g22.item_type_id, item_group_id: g22.id,
    design_id: null, weight_mode: 'WEIGHT', uom: 'GRAM', hsn: '7113', image: '',
  })
  const makeTag = (gross) => {
    const [id] = api.tagStock.saveBatch({
      itemId: ringId, rows: [{ gross_wt: gross, purity: 91.6, entry_date: DAY }],
    })
    return db.get().prepare(`SELECT * FROM tag_stock WHERE id = ?`).get(id)
  }
  const status = (id) => db.get().prepare(`SELECT status FROM tag_stock WHERE id = ?`).get(id).status
  const refinerId = api.party.save({ party_type: 'SUPPLIER', name: 'Shree Refinery', metals: [] })
  const custId = api.party.save({ party_type: 'CUSTOMER', name: 'Meena Rao', metals: [] })
  const refLine = (t) => ({
    tag: t.tag, item_id: ringId, item_name: 'Ring', qty: 0, gross_wt: t.gross_wt,
    black_beads: 0, stone_wt: 0, net_wt: t.net_wt, purity: 91.6, rate_per_gm: 0, gross_wastage: 0,
  })
  const refHead = {
    prefix: 'MO', invoice_date: DAY, direction: 'OUT', party_id: refinerId,
    party_name: 'Shree Refinery', gst_pct: 0, discount: 0, sub_tax: 0, paid_amount: 0,
  }
  const sellTag = (t, date = DAY) => api.sale.save({
    head: {
      prefix: 'Service', bill_date: date, party_id: custId, party_name: 'Meena Rao',
      is_credit: 1, payment_mode: 'Cash', gst_pct: 3, amount_received: 0,
    },
    items: [{
      tag: t.tag, tag_stock_id: t.id, item_id: ringId, item_name: 'Ring', hsn: '7113',
      qty: 0, gross_wt: t.gross_wt, purity: 91.6, stone_wt: 0, net_wt: t.net_wt,
      rate_per_gm: 6000, mkg_per_gm: 0, hallmark_charges: 0,
    }],
  })
  const returnTag = (t, sale, extra = {}) => api.saleReturn.save({
    head: {
      return_date: NEXT, party_id: custId, party_name: 'Meena Rao',
      against_sale_id: sale.id, against_bill_no: sale.bill_no, gst_pct: 3, refund_amount: 0,
      ...extra,
    },
    items: [{
      tag: t.tag, tag_stock_id: t.id, item_id: ringId, item_name: 'Ring', qty: 0,
      gross_wt: t.gross_wt, stone_wt: 0, net_wt: t.net_wt, purity: 91.6, rate_per_gm: 6000,
    }],
  })
  const taggedFine = () => api.looseStock.summary({ metal: 'Gold' }).tagged_fine

  try {
    head('1. Editing a refining document that melts tags')
    const a = makeTag(10)
    const b = makeTag(5)
    const ref = api.refinery.save({ head: refHead, items: [refLine(a), refLine(b)] })
    check('both pieces melted', `${status(a.id)} ${status(b.id)}`, 'MELTED MELTED')
    // Correct the document: piece b was never sent after all.
    works('the document can be edited and re-saved',
      () => api.refinery.save({ head: { ...refHead, id: ref.id, invoice_no: ref.invoice_no }, items: [refLine(a)] }))
    check('the piece still on it stays melted', status(a.id), 'MELTED')
    check('the piece taken off it is back in stock', status(b.id), 'IN_STOCK')
    // Tag & Barcode can list melted pieces and bulk-delete them. Deleting one
    // takes back its inflow while the refining document still sends it out.
    const fineBefore = taggedFine()
    throws('deleting a melted piece', () => api.tagStock.remove({ id: a.id }), /refin|melted/i)
    check('tagged stock unchanged', taggedFine(), fineBefore)

    head('2. A reserved piece cannot be melted')
    const c = makeTag(8)
    require('../electron/availability.cjs').placeHold(db.get(), {
      tag_id: c.id, kind: 'RESERVATION', source_type: 'RESERVATION', source_id: 1, actor: 'test',
    })
    throws('sending a reserved piece for refining',
      () => api.refinery.save({ head: refHead, items: [refLine(c)] }), /hold|reserv/i)
    check('the reserved piece is still in stock', status(c.id), 'IN_STOCK')

    head('3. The same piece cannot come back twice')
    const d = makeTag(12)
    const sale = sellTag(d)
    const before = taggedFine()
    const r1 = returnTag(d, sale)
    check('first return puts it back', status(d.id), 'IN_STOCK')
    const afterOne = taggedFine()
    check('tagged stock back by its fine weight', afterOne - before, 10.992)
    throws('a second return of the same piece', () => returnTag(d, sale), /not sold|in stock|already/i)
    check('tagged stock counted once', taggedFine(), afterOne)
    // Correcting the original bill (a phone number, say) must not quietly sell
    // the returned piece again: it is back on the shelf.
    const resave = (s) => {
      const { items, urds, metals, payments, ...h } = api.sale.read({ id: s.id })
      return api.sale.save({ head: h, items, urds, metals, payments })
    }
    works('the original bill can still be corrected', () => resave(sale))
    check('the returned piece stays in stock', status(d.id), 'IN_STOCK')
    check('tagged stock still counted once', taggedFine(), afterOne)
    // It is sold again to someone else; re-saving the first return must not
    // put it back on the shelf a second time.
    const sale2 = sellTag(d, NEXT)
    check('sold again', status(d.id), 'SOLD')
    works('the original bill can be corrected after the piece is resold', () => resave(sale))
    check('the piece stays on the new bill',
      db.get().prepare(`SELECT sold_doc FROM tag_stock WHERE id = ?`).get(d.id).sold_doc, `SALE:${sale2.id}`)
    throws('re-saving the old return once the piece is sold again',
      () => returnTag(d, sale, { id: r1.id, return_no: r1.return_no }), /sold|bill/i)
    check('the piece stays sold on the new bill', status(d.id), 'SOLD')
    check('still on the new bill',
      db.get().prepare(`SELECT sold_doc FROM tag_stock WHERE id = ?`).get(d.id).sold_doc, `SALE:${sale2.id}`)

    head('4. Cancelling an order\'s bill keeps its old gold on the books')
    const ord = api.order.save({
      head: { prefix: 'NO', order_date: DAY, party_id: custId, party_name: 'Meena Rao', advance_amount: 0 },
      items: [{ item_name: 'Kada', qty: 1, gross_wt: 20, net_wt: 20, purity: 91.6, rate_per_gm: 6000 }],
      urds: [{ item_name: 'Old Gold', gross_wt: 10, net_wt: 10, purity: 100, rate: 5000 }],
    })
    const urdFine = () => api.reports.oldGold({}).stock.fine_on_hand
    const metal = () => api.party.metalBalance({ id: custId }).balance
    const urdBooked = urdFine()
    const metalBooked = metal()
    check('booking puts 10 g of old gold in the safe', urdBooked, 10)
    const reportFine = () => api.reports.oldGold({}).totals.fine_wt
    check('the Old Gold Report lists the gold taken at booking', reportFine(), 10)
    check('as an order booking', api.reports.oldGold({}).bySource.ORDER.fine_wt, 10)
    const inv = api.order.toInvoice({ id: ord.id, bill_date: NEXT })
    check('still 10 g once billed', urdFine(), 10)
    check('the report lists it once, on the bill', reportFine(), 10)
    check('and no longer on the order', api.reports.oldGold({}).bySource.ORDER.lines, 0)
    api.sale.remove({ id: inv.id })
    check('order open again', api.order.read({ id: ord.id }).status, 'RECEIVED')
    check('the old gold is still in the safe', urdFine(), urdBooked)
    check('and still on the customer\'s gold khata', metal(), metalBooked)
    api.order.toInvoice({ id: ord.id, bill_date: NEXT })
    check('billed again: counted once', urdFine(), 10)
    // The order screen still offers Save on a delivered order.
    const o2 = api.order.read({ id: ord.id })
    const metalBilled = metal()
    api.order.save({
      head: { ...o2, remark: 'Collected' },
      items: o2.items.map((l) => ({ ...l })),
      urds: o2.urds.map((u) => ({ item_name: u.item_name, gross_wt: u.gross_wt, net_wt: u.net_wt, purity: u.purity, rate: u.rate })),
    })
    check('re-saving the delivered order: still counted once', urdFine(), 10)
    check('customer\'s gold khata unchanged by the re-save', metal(), metalBilled)

    head('5. A bill on a retired series')
    // A COM bill from before the change, then the upgrade retires the series.
    const old = sellTag(makeTag(4))
    db.get().prepare(`UPDATE sale SET prefix = 'COM', bill_no = 'COM1' WHERE id = ?`).run(old.id)
    db.close(); db.open(tmp)
    check('COM is gone from the picker',
      api.series.list({ docType: 'SALE' }).some((s) => s.prefix === 'COM'), false)
    // A draft parked before the upgrade still says COM.
    const e = makeTag(3)
    const res = works('saving it does not collide with the old COM1', () => api.sale.save({
      head: {
        prefix: 'COM', bill_date: NEXT, party_id: custId, party_name: 'Meena Rao',
        is_credit: 1, payment_mode: 'Cash', gst_pct: 3, amount_received: 0,
      },
      items: [{
        tag: e.tag, tag_stock_id: e.id, item_id: ringId, item_name: 'Ring', qty: 0,
        gross_wt: 3, purity: 91.6, net_wt: 3, rate_per_gm: 6000,
      }],
    }))
    check('numbered after the old bills', res && res.bill_no, 'COM2')

    head('6. The phone\'s Day Book shows old gold bills too')
    const html = fs.readFileSync(path.join(__dirname, '../electron/mobile.html'), 'utf8')
    const daybook = html.slice(html.indexOf('async daybook('), html.indexOf('async outstanding('))
    check('old gold bills are read on the phone', /urd_bills/.test(daybook), true)
    // The stock tile sums bead lots (mani, fuli) — beads, not metal.
    const stock = html.slice(html.indexOf('async stock('), html.indexOf('async sales('))
    check('bead lots are not called metal', /Loose metal/.test(stock), false)
  } catch (e) {
    fail++
    console.log('  ERROR', e && e.stack ? e.stack : e)
  }

  console.log(`\n${pass} passed, ${fail} failed`)
  db.close()
  app.exit(fail ? 1 : 0)
})
