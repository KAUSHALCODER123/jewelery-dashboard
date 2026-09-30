/**
 * Locks on saved documents, as the shop owner decided them.
 *
 *  1. Staff (any role but the owner) edit or delete a saved bill, purchase,
 *     return, voucher, old-gold bill or order only on the day it is dated.
 *     The owner can change any day.
 *  2. Once a day's Daily Closing is LOCKED nothing dated that day can be
 *     created, edited or deleted, by anyone, until the owner reopens it.
 *  3. The retired COM sales series never comes back into the Series picker,
 *     yet a COM bill still saves with the next number and opens and prints.
 *
 *    npx electron ./test/locks.cjs
 */
const { app } = require('electron')
const path = require('node:path')
const fs = require('node:fs')
const os = require('node:os')

let pass = 0
let fail = 0
function check(label, actual, expected) {
  if (String(actual) === String(expected)) { pass++; console.log(`  PASS  ${label} = ${actual}`) }
  else { fail++; console.log(`  FAIL  ${label}: got ${actual}, expected ${expected}`) }
}
function throws(label, fn, re) {
  try { fn(); fail++; console.log(`  FAIL  ${label}: did not throw`) } catch (e) {
    if (re.test(e.message)) { pass++; console.log(`  PASS  ${label} → ${e.message}`) }
    else { fail++; console.log(`  FAIL  ${label}: threw "${e.message}"`) }
  }
}
function works(label, fn) {
  try { const r = fn(); pass++; console.log(`  PASS  ${label}`); return r } catch (e) {
    fail++; console.log(`  FAIL  ${label}: threw "${e.message}"`)
  }
}

const pad = (n) => String(n).padStart(2, '0')
const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const daysAgo = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return iso(d) }
const TODAY = daysAgo(0)
const YDAY = daysAgo(1)
const SHUT = daysAgo(3)   // the day that gets locked in Daily Closing
const EARLIER_DAY = /Only the owner can change a .* from an earlier day/
const CLOSED = /is closed in Daily Closing — the owner must reopen it first/

app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'parivar-run-')))

app.whenReady().then(() => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'parivar-locks-'))
  require('../electron/db.cjs').open(tmp)
  const { auth, bootstrap } = require('../electron/auth.cjs')
  const api = require('../electron/api.cjs')
  const asOwner = () => { auth.logout(); auth.login({ username: 'admin', password: 'admin' }) }
  const asStaff = () => { auth.logout(); auth.login({ username: 'ramesh', password: 'shop123' }) }
  const asManager = () => { auth.logout(); auth.login({ username: 'suresh', password: 'shop123' }) }

  try {
    bootstrap()
    asOwner()
    auth.addUser({ username: 'ramesh', name: 'Ramesh', role: 'staff', password: 'shop123' })
    auth.addUser({ username: 'suresh', name: 'Suresh', role: 'manager', password: 'shop123' })

    const cust = api.party.save({ party_type: 'CUSTOMER', name: 'Rekha Shah', state: 'Maharashtra', metals: [] })
    const sup = api.party.save({ party_type: 'SUPPLIER', name: 'Mahavir Gold', state: 'Maharashtra', metals: [] })
    const g = api.itemGroup.list().find((x) => x.name === '22K Gold')
    const item = api.item.save({
      name: 'Gold Ring', item_type_id: g.item_type_id, item_group_id: g.id,
      design_id: null, weight_mode: 'WEIGHT', uom: 'GRAM', hsn: '7113', image: '',
    })
    const newTag = () => {
      api.tagStock.saveBatch({ itemId: item, rows: [{ gross_wt: 10, purity: 91.6, entry_date: SHUT, location: 'Shop' }] })
      return api.tagStock.list({ status: 'IN_STOCK' }).sort((a, b) => b.id - a.id)[0]
    }

    // One payload builder per kind of document, and how to re-save it as an edit.
    const docs = {
      sale: {
        make: (date, extra = {}) => {
          const t = newTag()
          return { head: { prefix: 'Service', bill_date: date, party_id: cust, party_name: 'Rekha Shah',
            state: 'Maharashtra', is_credit: 1, payment_mode: 'Cash', gst_pct: 3, bill_discount: 0,
            making_discount: 0, other_amount: 0, manual_urd_amount: 0, tcs_pct: 0, amount_received: 0, ...extra },
          items: [{ tag: t.tag, tag_stock_id: t.id, item_id: item, item_name: 'Gold Ring', hsn: '7113',
            qty: 0, gross_wt: 10, purity: 91.6, stone_wt: 0, net_wt: 10, rate_per_gm: 6000, mkg_per_gm: 0,
            hallmark_charges: 0 }], urds: [], metals: [], payments: [] }
        },
        edit: (p, id, date) => ({ ...p, head: { ...p.head, id, bill_date: date || p.head.bill_date } }),
      },
      urd: {
        make: (date) => ({ head: { bill_date: date, payment_mode: 'Cash' },
          urds: [{ name: 'Old Gold', description: 'chain', gross_wt: 5, net_wt: 5, purity: 80, rate: 5000 }] }),
        edit: (p, id, date) => ({ ...p, head: { ...p.head, id, bill_date: date || p.head.bill_date } }),
      },
      purchase: {
        make: (date) => ({ head: { prefix: 'MI', invoice_date: date, party_id: sup, party_name: 'Mahavir Gold',
          is_credit: 1, gst_pct: 0, discount: 0, sub_tax: 0, tcs_pct: 0, paid_amount: 0 },
          items: [{ direction: 'IN', item_name: 'Bar', qty: 0, gross_wt: 10, stone_wt: 0, net_wt: 10,
            purity: 100, rate: 5000, wastage_pct: 0 }] }),
        edit: (p, id, date) => ({ ...p, head: { ...p.head, id, invoice_date: date || p.head.invoice_date } }),
      },
      voucher: {
        make: (date) => ({ kind: 'RECEIPT', voucher_date: date, party_id: cust, party_name: 'Rekha Shah',
          amount: 1000, payment_type: 'Cash' }),
        edit: (p, id, date) => ({ ...p, id, voucher_date: date || p.voucher_date }),
      },
      saleReturn: {
        make: (date) => ({ head: { return_date: date, party_id: cust, party_name: 'Rekha Shah', gst_pct: 0, refund_amount: 0 },
          items: [{ item_name: 'Bangle', qty: 0, gross_wt: 5, net_wt: 5, purity: 91.6, rate_per_gm: 1000 }] }),
        edit: (p, id, date) => ({ ...p, head: { ...p.head, id, return_date: date || p.head.return_date } }),
      },
      purchaseReturn: {
        make: (date) => ({ head: { return_date: date, party_id: sup, party_name: 'Mahavir Gold', gst_pct: 0, received_amount: 0 },
          items: [{ item_name: 'Bar', qty: 0, gross_wt: 1, stone_wt: 0, net_wt: 1, purity: 100, rate_per_gm: 5000 }] }),
        edit: (p, id, date) => ({ ...p, head: { ...p.head, id, return_date: date || p.head.return_date } }),
      },
      order: {
        make: (date) => ({ head: { prefix: 'NO', order_date: date, delivery_date: '', karagir_date: '',
          party_id: cust, party_name: 'Rekha Shah', advance_amount: 0, remark: '' },
          items: [{ item_id: item, item_name: 'Gold Ring', qty: 0, gross_wt: 10, stone_wt: 0, net_wt: 10,
            purity: 91.6, rate_per_gm: 6000, mkg_per_gm: 0 }], urds: [] }),
        edit: (p, id, date) => ({ ...p, head: { ...p.head, id, order_date: date || p.head.order_date } }),
      },
      stockSettlement: {
        make: (date) => ({ settle_date: date, party_id: sup, party_name: 'Mahavir Gold', metal: 'Gold',
          direction: 'OUT', fine_wt: 1, rate_per_gm: 5000, gst_pct: 0, paid_amount: 0 }),
        edit: (p, id, date) => ({ ...p, id, settle_date: date || p.settle_date }),
      },
    }
    const kinds = Object.keys(docs)
    const save = (k, date) => { const p = docs[k].make(date); return { p, id: api[k].save(p).id } }

    console.log('\n── 1. Staff change a document only on its own day ──')
    asOwner()
    const old = {}, fresh = {}
    for (const k of kinds) { old[k] = save(k, YDAY); fresh[k] = save(k, TODAY) }
    asStaff()
    for (const k of kinds) {
      throws(`staff cannot edit yesterday's ${k}`, () => api[k].save(docs[k].edit(old[k].p, old[k].id)), EARLIER_DAY)
      throws(`staff cannot delete yesterday's ${k}`, () => api[k].remove({ id: old[k].id }), EARLIER_DAY)
      works(`staff can edit today's ${k}`, () => api[k].save(docs[k].edit(fresh[k].p, fresh[k].id)))
    }
    throws('the bill message is plain', () => api.sale.save(docs.sale.edit(old.sale.p, old.sale.id)),
      /^Only the owner can change a bill from an earlier day\.$/)
    check('page told staff cannot touch yesterday', api.locks.check({ kind: 'sale', id: old.sale.id }).editable, false)
    check('page told why', api.locks.check({ kind: 'sale', id: old.sale.id }).reason, 'Only the owner can change a bill from an earlier day.')
    check('page told staff can edit today', api.locks.check({ kind: 'sale', id: fresh.sale.id }).editable, true)
    works('staff can still enter a new bill for an earlier day', () => save('purchase', YDAY))
    works('staff can delete today\'s voucher', () => api.voucher.remove({ id: fresh.voucher.id }))
    asManager()
    throws('a manager is staff too', () => api.purchase.save(docs.purchase.edit(old.purchase.p, old.purchase.id)), EARLIER_DAY)
    asOwner()
    check('owner may edit yesterday', api.locks.check({ kind: 'sale', id: old.sale.id }).editable, true)
    for (const k of kinds) {
      works(`owner edits yesterday's ${k}`, () => api[k].save(docs[k].edit(old[k].p, old[k].id)))
    }
    works('owner deletes yesterday\'s voucher', () => api.voucher.remove({ id: old.voucher.id }))
    works('owner deletes yesterday\'s purchase', () => api.purchase.remove({ id: old.purchase.id }))

    console.log('\n── 2. A LOCKED Daily Closing shuts its day for everyone ──')
    const shut = {}
    for (const k of kinds) shut[k] = save(k, SHUT)
    const openToday = save('voucher', TODAY)
    const lockDay = () => {
      const c = api.closing.open({ business_date: SHUT })
      api.closing.saveCounts({ session_id: c.id, counts: [], other: Math.max(0, c.expected.expected) })
      api.closing.submit({ id: c.id })
      return api.closing.approve({ id: c.id, note: 'test count' })
    }
    const c = lockDay()
    check('closing locked', c.status, 'LOCKED')
    for (const k of kinds) {
      throws(`owner cannot add a ${k} on a closed day`, () => api[k].save(docs[k].make(SHUT)), CLOSED)
      throws(`owner cannot edit a closed day's ${k}`, () => api[k].save(docs[k].edit(shut[k].p, shut[k].id)), CLOSED)
      throws(`owner cannot delete a closed day's ${k}`, () => api[k].remove({ id: shut[k].id }), CLOSED)
    }
    throws('cannot move a closed day\'s bill onto another day',
      () => api.sale.save(docs.sale.edit(shut.sale.p, shut.sale.id, TODAY)), CLOSED)
    throws('cannot move today\'s voucher onto a closed day',
      () => api.voucher.save(docs.voucher.edit(openToday.p, openToday.id, SHUT)), CLOSED)
    const [y, m, d] = SHUT.split('-')
    const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][Number(m) - 1]
    throws('message names the day', () => api.voucher.save(docs.voucher.make(SHUT)),
      new RegExp(`^${d}/${MON}/${y} is closed in Daily Closing — the owner must reopen it first\\.$`))
    const ord = save('order', TODAY)
    throws('an order cannot be billed into a closed day', () => api.order.toInvoice({ id: ord.id, bill_date: SHUT }), CLOSED)
    const draft = docs.sale.make(SHUT)
    const parked = api.parked.park({ draft, actor: 'test' })
    throws('a parked bill cannot be billed into a closed day',
      () => api.parked.finalize({ id: parked.id, sale: draft }), CLOSED)
    check('and stays parked', api.parked.read({ id: parked.id }).status, 'PARKED')
    check('page told the day is closed', api.locks.check({ kind: 'voucher', id: shut.voucher.id }).editable, false)
    works('the next day is untouched', () => save('voucher', daysAgo(2)))
    asStaff()
    throws('staff are refused a closed earlier day as well', () => api.voucher.remove({ id: shut.voucher.id }), EARLIER_DAY)
    asOwner()

    console.log('\n── 2b. The owner reopens the closing to allow changes ──')
    api.closing.reopen({ id: c.id, reason: 'late receipt' })
    works('a bill can be added again', () => save('voucher', SHUT))
    for (const k of kinds) {
      works(`${k} can be edited again`, () => api[k].save(docs[k].edit(shut[k].p, shut[k].id)))
    }
    works('and deleted', () => api.voucher.remove({ id: shut.voucher.id }))
    const c2 = api.closing.read({ id: c.id })
    api.closing.saveCounts({ session_id: c2.id, counts: [], other: Math.max(0, c2.expected.expected) })
    api.closing.submit({ id: c2.id })
    check('locked again', api.closing.approve({ id: c2.id, note: 'test count' }).status, 'LOCKED')
    throws('and shut again', () => api.voucher.save(docs.voucher.make(SHUT)), CLOSED)

    console.log('\n── 3. The retired COM series stays out of the picker ──')
    const offered = () => api.series.list({ docType: 'SALE' }).map((s) => s.prefix)
    check('COM not offered at start', offered().includes('COM'), false)
    const com1 = api.sale.save(docs.sale.make(TODAY, { prefix: 'COM' }))
    check('a COM bill still numbers from the COM series', com1.bill_no, 'COM1')
    check('COM still not offered after a COM bill', offered().includes('COM'), false)
    check('nor in the full series list', api.series.list().some((s) => s.doc_type === 'SALE' && s.prefix === 'COM'), false)
    check('other series still offered', offered().includes('Service'), true)
    const com2 = api.sale.save(docs.sale.make(TODAY, { prefix: 'COM' }))
    check('the next COM bill carries on', com2.bill_no, 'COM2')
    check('a COM bill opens', api.sale.read({ id: com1.id }).bill_no, 'COM1')
    check('a COM bill prints', !!api.sale.forPrint({ id: com1.id }), true)
    works('a COM bill can be edited', () => api.sale.save(docs.sale.edit(docs.sale.make(TODAY, { prefix: 'COM' }), com1.id)))
    check('and keeps its number', api.sale.read({ id: com1.id }).bill_no, 'COM1')
  } catch (e) {
    fail++
    console.log('  FAIL  crashed:', e.stack)
  }

  console.log(`\n${pass} passed, ${fail} failed`)
  app.exit(fail ? 1 : 0)
})
