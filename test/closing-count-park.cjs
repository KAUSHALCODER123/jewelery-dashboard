/**
 * Stock count sessions, daily closing and parked bills (ERP T06–T08).
 *
 *  - A count snapshots the stock in scope, classifies every scan (found,
 *    duplicate, unknown, sold, outside scope) and lists what is missing.
 *  - A day's expected cash is the Cash Book's closing for that day; the count,
 *    submit, approve and reopen steps hold to it, and a bill entered after the
 *    close was opened stops it being signed off unseen.
 *  - A parked bill resumes and saves into exactly one sale, however often
 *    Save is pressed.
 *    npx electron ./test/closing-count-park.cjs
 */
const { app } = require('electron')
const path = require('node:path')
const fs = require('node:fs')
const os = require('node:os')

const DAY = '2026-09-28'
let pass = 0
let fail = 0
function check(label, actual, expected, tol = 0.001) {
  const ok = typeof expected === 'number'
    ? Math.abs(Number(actual) - expected) <= tol
    : String(actual) === String(expected)
  if (ok) { pass++; console.log(`  PASS  ${label} = ${actual}`) }
  else { fail++; console.log(`  FAIL  ${label}: got ${actual}, expected ${expected}`) }
}
function throws(label, fn, re) {
  try { fn(); fail++; console.log(`  FAIL  ${label}: did not throw`) } catch (e) {
    if (re.test(e.message)) { pass++; console.log(`  PASS  ${label} → ${e.message}`) }
    else { fail++; console.log(`  FAIL  ${label}: threw "${e.message}"`) }
  }
}

app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'parivar-run-')))

app.whenReady().then(() => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'parivar-ccp-'))
  const db = require('../electron/db.cjs')
  db.open(tmp)
  const api = require('../electron/api.cjs')

  try {
    const g = api.itemGroup.list().find((x) => x.name === '22K Gold')
    const item = api.item.save({
      name: 'Gold Ring', item_type_id: g.item_type_id, item_group_id: g.id,
      design_id: null, weight_mode: 'WEIGHT', uom: 'GRAM', hsn: '7113', image: '',
    })
    api.tagStock.saveBatch({ itemId: item, rows: [
      { gross_wt: 10, purity: 91.6, entry_date: DAY, location: 'Shop' },
      { gross_wt: 12, purity: 91.6, entry_date: DAY, location: 'Shop' },
      { gross_wt: 8, purity: 91.6, entry_date: DAY, location: 'Shop' },
      { gross_wt: 5, purity: 91.6, entry_date: DAY, location: 'Locker' },
    ] })
    const tags = api.tagStock.list({ status: 'IN_STOCK' }).sort((a, b) => a.id - b.id)
    const [t1, t2, t3, t4] = tags

    const saleOf = (t, extra = {}) => ({
      head: { prefix: 'COM', bill_date: DAY, party_name: 'Walk-in', state: 'Maharashtra',
              is_credit: 0, payment_mode: 'Cash', gst_pct: 3, bill_discount: 0, making_discount: 0,
              other_amount: 0, manual_urd_amount: 0, tcs_pct: 0, ...extra },
      items: [{ tag: t.tag, tag_stock_id: t.id, item_id: item, item_name: 'Gold Ring', hsn: '7113',
                qty: 0, gross_wt: t.gross_wt, purity: 91.6, stone_wt: 0, net_wt: t.net_wt,
                rate_per_gm: 6000, mkg_per_gm: 0, hallmark_charges: 0 }],
      urds: [], metals: [], payments: [],
    })

    console.log('\n── 1. Stock count: snapshot, scans, discrepancies, status ──')
    const sc = api.stockCount.create({ scope: { location: 'Shop' }, business_date: DAY, actor: 'test' })
    check('expected pieces in Shop', sc.expected_pcs, 3)
    check('nothing found yet', sc.found_pcs, 0)
    check('first scan matches', api.stockCount.scan({ session_id: sc.id, raw: t1.tag.toLowerCase() }).classification, 'MATCHED')
    check('same tag again is a duplicate', api.stockCount.scan({ session_id: sc.id, raw: t1.tag }).classification, 'DUPLICATE')
    check('unknown tag', api.stockCount.scan({ session_id: sc.id, raw: 'ZZZ999' }).classification, 'UNKNOWN')
    check('Locker piece is outside a Shop count', api.stockCount.scan({ session_id: sc.id, raw: t4.tag }).classification, 'OUTSIDE_SCOPE')
    // t2 sells after the count began: still expected, now a sold scan.
    api.sale.save(saleOf(t2))
    check('piece sold mid-count', api.stockCount.scan({ session_id: sc.id, raw: t2.tag }).classification, 'ALREADY_SOLD')
    const sheet = api.stockCount.sheet({ session_id: sc.id })
    check('sheet rows', sheet.rows.length, 3)
    check('sheet found', sheet.rows.filter((r) => r.found).length, 1)
    check('sold piece flagged as moved', sheet.rows.find((r) => r.id === t2.id).moved, true)
    check('extras exclude duplicates', sheet.extras.length, 3)
    const d = api.stockCount.discrepancies({ session_id: sc.id })
    check('missing pieces', d.missing.length, 2)
    check('missing marks the sold one as moved', d.missing.filter((m) => m.moved).length, 1)
    check('scan log keeps every scan', d.scans.length, 5)
    check('read counts found', api.stockCount.read({ id: sc.id }).found_pcs, 1)
    api.stockCount.setStatus({ id: sc.id, status: 'PAUSED' })
    throws('no scanning while paused', () => api.stockCount.scan({ session_id: sc.id, raw: t3.tag }), /paused/)
    api.stockCount.setStatus({ id: sc.id, status: 'OPEN' })
    check('resumed scan matches', api.stockCount.scan({ session_id: sc.id, raw: t3.tag }).classification, 'MATCHED')
    api.stockCount.setStatus({ id: sc.id, status: 'SUBMITTED' })
    throws('no jumping SUBMITTED → CLOSED', () => api.stockCount.setStatus({ id: sc.id, status: 'CLOSED' }), /Cannot move/)
    api.stockCount.setStatus({ id: sc.id, status: 'APPROVED' })
    check('closed', api.stockCount.setStatus({ id: sc.id, status: 'CLOSED' }).status, 'CLOSED')
    throws('no scanning a closed count', () => api.stockCount.scan({ session_id: sc.id, raw: t3.tag }), /CLOSED/)
    check('list shows counts', api.stockCount.list({}).rows[0].found_pcs, 2)
    const big = api.stockCount.create({ scope: {}, business_date: DAY })
    check('whole-shop count takes every piece in stock', big.expected_pcs, 3)
    check('stock untouched by counting', api.tagStock.list({ status: 'IN_STOCK' }).length, 3)

    console.log('\n── 2. Daily closing: expected cash is the cash book ──')
    // A receipt and a payment in cash, plus a bank receipt that must not count.
    const cust = api.party.save({ name: 'Rekha Shah', party_type: 'CUSTOMER', state: 'Maharashtra' })
    api.voucher.save({ kind: 'RECEIPT', voucher_date: DAY, party_id: cust, party_name: 'Rekha Shah', amount: 5000, payment_type: 'Cash' })
    api.voucher.save({ kind: 'PAYMENT', voucher_date: DAY, party_id: cust, party_name: 'Rekha Shah', amount: 1200, payment_type: 'Cash' })
    api.voucher.save({ kind: 'RECEIPT', voucher_date: DAY, party_id: cust, party_name: 'Rekha Shah', amount: 7000, payment_type: 'UPI' })
    const book = api.reports.cashBook({ from: DAY, to: DAY })
    const cl = api.closing.open({ business_date: DAY })
    check('expected = cash book closing', cl.expected.expected, book.closing)
    check('expected opening = cash book opening', cl.expected.opening, book.opening)
    check('opening the same day again returns the same close', api.closing.open({ business_date: DAY }).id, cl.id)
    check('bank receipt offered for settlement', cl.non_cash.some((r) => r.amount === 7000), true)
    throws('submit needs a count', () => api.closing.submit({ id: cl.id }), /Count the cash/)
    const counted = api.closing.saveCounts({ session_id: cl.id, counts: [{ denomination: 500, qty: 2 }, { denomination: 100, qty: 3 }], other: 50 })
    check('counted cash', counted.counted_cash, 1350)
    check('variance vs cash book', counted.variance, 1350 - book.closing, 0.01)
    check('count saved as lines', counted.counts.length, 3)
    // Counting again replaces, never adds.
    const recount = api.closing.saveCounts({ session_id: cl.id, counts: [{ denomination: 500, qty: 1 }], other: 0 })
    check('recount replaces', recount.counted_cash, 500)
    const bank = cl.non_cash.find((r) => r.amount === 7000)
    throws('cannot match more than was received',
      () => api.closing.match({ session_id: cl.id, settlement_ref: 'UTR1', provider: 'PhonePe',
        allocations: [{ source_type: bank.doc_type, source_id: bank.doc_id, amount: 7001 }] }), /left to match/)
    const matched = api.closing.match({ session_id: cl.id, settlement_ref: 'UTR1', provider: 'PhonePe', fees: 14,
      allocations: [{ source_type: bank.doc_type, source_id: bank.doc_id, amount: 7000 }] })
    check('settlement matched', matched.matches.length, 1)
    check('settlement net after fees', matched.matches[0].net, 6986)
    throws('same UTR twice', () => api.closing.match({ session_id: cl.id, settlement_ref: 'UTR1', provider: 'PhonePe',
      allocations: [{ source_type: bank.doc_type, source_id: bank.doc_id, amount: 1 }] }), /already matched/)
    // A cash bill after the close opened: the day changed under it.
    api.sale.save(saleOf(t3, { amount_received: 100 }))
    check('close sees the day changed', api.closing.read({ id: cl.id }).stale, true)
    throws('submit refuses a stale close', () => api.closing.submit({ id: cl.id }), /changed/)
    const fresh = api.closing.saveCounts({ session_id: cl.id, counts: [{ denomination: 500, qty: 1 }], other: 0 })
    check('recount takes in the new bill', fresh.stale, false)
    check('expected now includes the cash bill', fresh.expected.expected, api.reports.cashBook({ from: DAY, to: DAY }).closing)
    check('submits after recount', api.closing.submit({ id: cl.id }).status, 'SUBMITTED')
    // Reopen is only for submitted/locked; a draft is refreshed by recounting via reopen of a submitted one.
    // Start again cleanly on a new day.
    const DAY2 = '2026-09-29'
    api.voucher.save({ kind: 'RECEIPT', voucher_date: DAY2, party_id: cust, party_name: 'Rekha Shah', amount: 2000, payment_type: 'Cash' })
    const book2 = api.reports.cashBook({ from: DAY2, to: DAY2 })
    const c2 = api.closing.open({ business_date: DAY2 })
    check('day 2 opening carries day 1 cash', c2.expected.opening, api.reports.cashBook({ from: DAY, to: DAY }).closing)
    check('day 2 expected', c2.expected.expected, book2.closing)
    api.closing.saveCounts({ session_id: c2.id, counts: [], other: book2.closing })
    check('submitted', api.closing.submit({ id: c2.id }).status, 'SUBMITTED')
    throws('no recount once submitted', () => api.closing.saveCounts({ session_id: c2.id, counts: [], other: 1 }), /SUBMITTED/)
    const locked = api.closing.approve({ id: c2.id, note: '' })
    check('locked with no variance', locked.status, 'LOCKED')
    check('variance zero', locked.variance, 0)
    throws('reopen needs a reason', () => api.closing.reopen({ id: c2.id, reason: ' ' }), /reason/)
    const re = api.closing.reopen({ id: c2.id, reason: 'late receipt' })
    check('reopened to draft', re.status, 'DRAFT')
    check('revision bumped', re.revision, 2)
    api.closing.saveCounts({ session_id: c2.id, counts: [], other: book2.closing - 10 })
    api.closing.submit({ id: c2.id })
    throws('variance needs an explanation', () => api.closing.approve({ id: c2.id, note: '' }), /Explain/)
    check('approved with a note', api.closing.approve({ id: c2.id, note: '10 short, noted' }).status, 'LOCKED')

    console.log('\n── 3. Parked bill: resume and bill once ──')
    api.tagStock.saveBatch({ itemId: item, rows: [{ gross_wt: 9, purity: 91.6, entry_date: DAY, location: 'Shop' }] })
    const t5 = api.tagStock.list({ status: 'IN_STOCK' }).sort((a, b) => b.id - a.id)[0]
    const draft = saleOf(t5)
    const p = api.parked.park({ draft, actor: 'test' })
    check('parked', p.status, 'PARKED')
    check('parked list', api.parked.list({}).rows.length, 1)
    check('list summarises party', api.parked.list({}).rows[0].party_name, 'Walk-in')
    const p2 = api.parked.park({ id: p.id, revision: p.revision, draft })
    check('re-park bumps revision', p2.revision, 2)
    throws('stale revision refused', () => api.parked.park({ id: p.id, revision: 1, draft }), /another counter/)
    throws('too-large draft refused, not truncated',
      () => api.parked.park({ draft: { ...draft, blob: 'x'.repeat(600 * 1024) } }), /too large/)
    check('piece not reserved by parking', api.tagStock.list({ status: 'IN_STOCK' }).some((t) => t.id === t5.id), true)
    const salesBefore = api.sale.list({}).length
    const s1 = api.parked.finalize({ id: p.id, revision: p2.revision, sale: draft })
    const s2 = api.parked.finalize({ id: p.id, revision: p2.revision, sale: draft })
    check('second save returns the same bill', s2.id, s1.id)
    check('second save flagged', s2.already, true)
    check('exactly one sale made', api.sale.list({}).length, salesBefore + 1)
    check('draft converted', api.parked.read({ id: p.id }).status, 'CONVERTED')
    check('draft points at the sale', api.parked.read({ id: p.id }).sale_id, s1.id)
    check('converted drafts leave the parked list', api.parked.list({}).rows.length, 0)
    throws('converted draft cannot be discarded', () => api.parked.discard({ id: p.id }), /converted/)
    const p3 = api.parked.park({ draft })
    api.parked.discard({ id: p3.id })
    throws('discarded draft cannot be billed', () => api.parked.finalize({ id: p3.id, sale: draft }), /discarded/)
    // A failing sale leaves the draft parked.
    const p4 = api.parked.park({ draft })
    throws('sold piece cannot be billed again', () => api.parked.finalize({ id: p4.id, sale: draft }), /./)
    check('failed bill leaves draft parked', api.parked.read({ id: p4.id }).status, 'PARKED')
  } catch (e) {
    fail++
    console.log('  FAIL  crashed:', e.stack)
  }

  console.log(`\n${pass} passed, ${fail} failed`)
  app.exit(fail ? 1 : 0)
})
