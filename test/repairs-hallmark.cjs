/**
 * Repairs register (T10) and hallmarking batches (T12).
 *
 * Repairs: intake, correcting the intake, search, the step-by-step workflow and
 * that a finished job can no longer be edited. Hallmarking: a batch goes out,
 * its pieces are on hold and cannot be billed, and each piece comes back
 * returned (with a HUID), failed, or for rework — rework keeps it held and the
 * batch open until it is received again.
 *    npx electron ./test/repairs-hallmark.cjs
 */
const { app } = require('electron')
const path = require('node:path')
const fs = require('node:fs')
const os = require('node:os')
const { seed } = require('./demo-data.cjs')

let pass = 0
let fail = 0
function check(label, actual, expected) {
  if (String(actual) === String(expected)) { pass++; console.log(`  PASS  ${label} = ${actual}`) }
  else { fail++; console.log(`  FAIL  ${label}: got ${actual}, expected ${expected}`) }
}
function throws(label, fn, re) {
  try { fn(); fail++; console.log(`  FAIL  ${label}: did not throw`) }
  catch (e) {
    if (re.test(e.message)) { pass++; console.log(`  PASS  ${label} → ${e.message}`) }
    else { fail++; console.log(`  FAIL  ${label}: threw "${e.message}", expected ${re}`) }
  }
}
const head = (t) => console.log(`\n── ${t} ${'─'.repeat(Math.max(0, 46 - t.length))}`)

app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'parivar-run-')))

app.whenReady().then(() => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'parivar-rh-'))
  const dbm = require('../electron/db.cjs')
  dbm.open(tmp)
  const api = require('../electron/api.cjs')
  const holds = require('../electron/availability.cjs')

  try {
    const S = seed(api)

    head('1. Repair intake and edit')
    const job = api.repairs.create({ customer_id: S.customers.priya, customer_name: 'Priya Deshmukh',
      description: 'Gold chain, broken clasp', gross_wt: 12.5, estimate: 450, karigar_id: S.karagir })
    check('new job is RECEIVED', job.status, 'RECEIVED')
    check('karigar kept on intake', job.karigar_id, S.karagir)
    check('karigar name joined', job.karigar_name, 'Chetan Kapila')
    check('intake event', job.events.length, 1)
    const walkin = api.repairs.create({ customer_name: 'Walk-in Ramesh', description: 'Silver anklet' })
    throws('customer is required', () => api.repairs.create({ description: 'x' }), /Customer is required/)
    const edited = api.repairs.update({ ...job, estimate: 600, promised_date: '2026-10-05' })
    check('update changed estimate', edited.estimate, 600)
    check('update is not a new job', api.repairs.list({}).total, 2)

    head('2. Search')
    check('by customer', api.repairs.list({ search: 'priya' }).total, 1)
    check('by article', api.repairs.list({ search: 'anklet' }).rows[0]?.id, walkin.id)
    check('by job no.', api.repairs.list({ search: `#${walkin.id}` }).rows[0]?.id, walkin.id)
    check('LIKE wildcards are literal', api.repairs.list({ search: '%' }).total, 0)

    head('3. Workflow')
    throws('cannot skip a step', () => api.repairs.transition({ id: walkin.id, to: 'READY' }), /Cannot move/)
    api.repairs.transition({ id: walkin.id, to: 'ASSESSED' })
    throws('assigning needs a karigar', () => api.repairs.transition({ id: walkin.id, to: 'ASSIGNED' }), /karigar/)
    const a = api.repairs.transition({ id: walkin.id, to: 'ASSIGNED', karigar_id: S.karagir, note: 'polish + clasp' })
    check('assigned to karigar', a.karigar_id, S.karagir)
    for (const to of ['IN_PROGRESS', 'READY', 'DELIVERED']) api.repairs.transition({ id: walkin.id, to })
    const done = api.repairs.read({ id: walkin.id })
    check('delivered', done.status, 'DELIVERED')
    check('history has every step', done.events.map((e) => e.to_state).join(','), 'RECEIVED,ASSESSED,ASSIGNED,IN_PROGRESS,READY,DELIVERED')
    throws('delivered job is locked', () => api.repairs.update({ ...done, estimate: 1 }), /cannot be edited/)
    check('open filter excludes delivered', api.repairs.list({ status: 'OPEN' }).total, 1)
    api.repairs.transition({ id: job.id, to: 'CANCELLED', note: 'customer took it back' })
    check('cancel is a step, not a delete', api.repairs.read({ id: job.id }).status, 'CANCELLED')

    head('4. Hallmark batch out')
    const stock = api.tagStock.list({ status: 'IN_STOCK' })
    const [p1, p2, p3] = stock
    throws('centre is required', () => api.hallmark.create({ centre: ' ', tag_ids: [p1.id] }), /centre/)
    const b = api.hallmark.create({ centre: 'Pune Assay Centre', tag_ids: [p1.id, p2.id, p3.id, p1.id] })
    check('duplicates collapsed', b.items.length, 3)
    check('item name joined', !!b.items[0].item_name, true)
    throws('a piece cannot be on two open batches', () => api.hallmark.create({ centre: 'Other', tag_ids: [p1.id] }), /already on hallmark batch/)
    const spare = api.hallmark.create({ centre: 'Other', tag_ids: [stock[3].id] })
    check('prepared batch can be cancelled', api.hallmark.cancel({ id: spare.id }).status, 'CANCELLED')

    api.hallmark.dispatch({ id: b.id })
    const db = dbm.get()
    const tagRow = (id) => db.prepare(`SELECT * FROM tag_stock WHERE id=?`).get(id)
    check('piece at centre is not saleable', holds.availability(db, tagRow(p1.id)).reason, 'ON_HOLD')
    throws('sale of a held piece is refused', () => api.sale.save({
      head: { prefix: 'COM', bill_date: S.dates.today, party_id: S.customers.priya, party_name: 'Priya Deshmukh',
        state: 'Maharashtra', gst_pct: 3, payment_mode: 'Cash' },
      items: [{ tag: p1.tag, tag_stock_id: p1.id, item_id: p1.item_id, item_name: p1.item_name, qty: p1.qty,
        gross_wt: p1.gross_wt, purity: p1.purity, stone_wt: p1.stone_wt, net_wt: p1.net_wt, rate_per_gm: 6200, mkg_per_gm: 300 }],
    }), /cannot be sold/)

    head('5. Receive: returned, failed, rework')
    throws('HUID must be 6 characters', () => api.hallmark.receive({ id: b.id, receipts: [{ tag_id: p1.id, outcome: 'RETURNED', huid: 'AB12' }] }), /6 letters/)
    throws('returned piece needs a HUID', () => api.hallmark.receive({ id: b.id, receipts: [{ tag_id: p1.id, outcome: 'RETURNED' }] }), /Enter the HUID/)
    db.prepare(`UPDATE tag_stock SET huid='TAKEN1' WHERE id=?`).run(stock[4].id)
    throws('duplicate HUID refused', () => api.hallmark.receive({ id: b.id, receipts: [{ tag_id: p1.id, outcome: 'RETURNED', huid: 'taken1' }] }), /already on/)
    check('failed receipt wrote nothing', api.hallmark.read({ id: b.id }).status, 'DISPATCHED')

    const r1 = api.hallmark.receive({ id: b.id, receipts: [
      { tag_id: p1.id, outcome: 'RETURNED', huid: 'ab12cd', return_wt: p1.net_wt },
      { tag_id: p2.id, outcome: 'FAILED' },
      { tag_id: p3.id, outcome: 'REWORK' },
    ] })
    check('rework keeps batch open', r1.status, 'PARTIAL')
    check('HUID saved upper-case on the tag', tagRow(p1.id).huid, 'AB12CD')
    check('returned piece saleable again', holds.availability(db, tagRow(p1.id)).saleable, true)
    check('failed piece saleable again', holds.availability(db, tagRow(p2.id)).saleable, true)
    check('rework piece still held', holds.availability(db, tagRow(p3.id)).reason, 'ON_HOLD')
    throws('returned piece cannot be received twice', () => api.hallmark.receive({ id: b.id, receipts: [{ tag_id: p1.id, outcome: 'FAILED' }] }), /already returned/)
    check('list shows 1 still out', api.hallmark.list({}).rows.find((x) => x.id === b.id).outstanding, 1)

    const r2 = api.hallmark.receive({ id: b.id, receipts: [{ tag_id: p3.id, outcome: 'RETURNED', huid: 'ZX98Q1' }] })
    check('batch closes when nothing is out', r2.status, 'CLOSED')
    check('rework piece released', holds.availability(db, tagRow(p3.id)).saleable, true)
    check('hold release logged in custody', db.prepare(`SELECT COUNT(*) n FROM custody_event WHERE kind='HOLD_RELEASED'`).get().n, 3)
  } catch (e) {
    fail++
    console.log('  FAIL  crashed:', e.stack)
  }

  console.log(`\n${pass} passed, ${fail} failed`)
  app.exit(fail ? 1 : 0)
})
