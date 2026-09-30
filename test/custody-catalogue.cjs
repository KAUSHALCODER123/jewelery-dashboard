/**
 * Reservations, approval memos and the catalogue (T11/T14).
 *
 * A reserved or memo'd piece cannot be billed, reserved again or sent out
 * twice; fulfilling, returning or expiring puts it back. Catalogue imports are
 * previewed and idempotent; a merge re-points every line that used the item.
 *    npx electron ./test/custody-catalogue.cjs
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
  try { fn(); fail++; console.log(`  FAIL  ${label}: did not throw`) }
  catch (e) {
    if (re.test(e.message)) { pass++; console.log(`  PASS  ${label} — ${e.message}`) }
    else { fail++; console.log(`  FAIL  ${label}: threw "${e.message}", expected ${re}`) }
  }
}
const section = (s) => console.log(`\n── ${s}`)

app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'parivar-run-')))

app.whenReady().then(() => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'parivar-custody-'))
  const dbmod = require('../electron/db.cjs')
  dbmod.open(tmp)
  const db = dbmod.get()
  const api = require('../electron/api.cjs')
  const { seed } = require('./demo-data.cjs')
  try {
    const S = seed(api)
    const today = S.dates.today
    const tags = api.tagStock.list({ status: 'IN_STOCK' })
    const [t1, t2, t3] = tags
    const saleable = (t) => require('../electron/availability.cjs').availability(db, db.prepare('SELECT * FROM tag_stock WHERE id=?').get(t.id)).saleable
    const sell = (t) => api.sale.save({
      head: { prefix: 'COM', bill_date: today, party_name: 'Walk-in', gst_pct: 3, payment_mode: 'Cash', state: 'Maharashtra' },
      items: [{ tag: t.tag, tag_stock_id: t.id, item_id: t.item_id, item_name: t.item_name, qty: t.qty,
                gross_wt: t.gross_wt, purity: t.purity, stone_wt: t.stone_wt, net_wt: t.net_wt, rate_per_gm: 6000, mkg_per_gm: 200 }],
    })

    section('Reservation holds the piece')
    const r1 = api.reservations.create({ tag_id: t1.id, customer_name: 'Priya' })
    check('reservation active', r1.status, 'ACTIVE')
    check('reserved tag not saleable', saleable(t1), false)
    throws('cannot bill a reserved piece', () => sell(t1), /cannot be sold/)
    throws('cannot reserve it twice', () => api.reservations.create({ tag_id: t1.id, customer_name: 'Rekha' }), /already on hold/)
    throws('cannot send it out on memo', () => api.memos.issue({ direction: 'OUT', tag_id: t1.id, counterparty: 'Rekha' }), /already on hold/)
    throws('expiry in the past refused', () => api.reservations.create({ tag_id: t2.id, customer_name: 'X', expires_at: '2000-01-01' }), /future/)
    const listed = api.reservations.list({ status: 'ACTIVE', search: 'priy' })
    check('search finds it by customer', listed.rows.map((r) => r.tag).join(), t1.tag)
    check('list carries the item name', !!listed.rows[0].item_name, true)

    section('Fulfil → can be billed')
    api.reservations.set({ id: r1.id, status: 'FULFILLED' })
    check('fulfilled tag saleable', saleable(t1), true)
    check('hold consumed', db.prepare(`SELECT state FROM stock_hold WHERE kind='RESERVATION' AND source_id=?`).get(r1.id).state, 'CONSUMED')
    check('bill saves', !!sell(t1).id, true)
    throws('cannot fulfil twice', () => api.reservations.set({ id: r1.id, status: 'RELEASED' }), /already FULFILLED/)

    section('Release and expiry')
    const r2 = api.reservations.create({ tag_id: t2.id, customer_id: S.customers.priya })
    check('customer name filled from party', !!r2.customer_name, true)
    api.reservations.set({ id: r2.id, status: 'RELEASED' })
    check('released tag saleable', saleable(t2), true)
    const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10)
    const r3 = api.reservations.create({ tag_id: t2.id, customer_name: 'Sandip', expires_at: tomorrow })
    check('date expiry held to end of day', r3.expires_at, `${tomorrow} 23:59:59`)
    db.prepare(`UPDATE reservation SET expires_at='2000-01-01 00:00:00' WHERE id=?`).run(r3.id)
    db.prepare(`UPDATE stock_hold SET expires_at='2000-01-01 00:00:00' WHERE kind='RESERVATION' AND source_id=?`).run(r3.id)
    api.reservations.list({})
    check('overdue reservation expired on read', db.prepare('SELECT status FROM reservation WHERE id=?').get(r3.id).status, 'EXPIRED')
    check('expired tag saleable again', saleable(t2), true)

    section('Approval memos')
    const m1 = api.memos.issue({ direction: 'OUT', tag_id: t3.id, counterparty: 'Mrs Shah', due_date: tomorrow })
    check('outbound memo issued', m1.status, 'ISSUED')
    check('memo tag not saleable', saleable(t3), false)
    throws('outbound memo cannot be ACQUIRED', () => api.memos.close({ id: m1.id, outcome: 'ACQUIRED' }), /RETURNED or SOLD/)
    api.memos.close({ id: m1.id, outcome: 'RETURNED' })
    check('returned memo frees the tag', saleable(t3), true)
    throws('closed memo cannot close again', () => api.memos.close({ id: m1.id, outcome: 'SOLD' }), /already RETURNED/)
    const m2 = api.memos.issue({ direction: 'OUT', tag_id: t3.id, counterparty: 'Mrs Shah' })
    api.memos.close({ id: m2.id, outcome: 'SOLD' })
    check('sold memo: hold consumed', db.prepare(`SELECT state FROM stock_hold WHERE kind='MEMO' AND source_id=?`).get(m2.id).state, 'CONSUMED')
    check('sold memo: piece can be billed', saleable(t3), true)
    const mi = api.memos.issue({ direction: 'IN', counterparty: 'Mahavir Gold' })
    throws('inbound memo cannot be SOLD', () => api.memos.close({ id: mi.id, outcome: 'SOLD' }), /RETURNED or ACQUIRED/)
    api.memos.close({ id: mi.id, outcome: 'ACQUIRED' })
    check('memo list filters by direction', api.memos.list({ direction: 'IN' }).total, 1)
    check('custody events logged', db.prepare(`SELECT COUNT(*) n FROM custody_event WHERE kind IN ('HOLD_RELEASED','HOLD_CONSUMED')`).get().n >= 4, true)

    section('Categories and CSV import')
    const csv = 'name,parent\nBridal,\n"Temple, Antique",Bridal\nDaily wear,\n'
    const p = api.catalogue.previewCsv({ kind: 'category', csv })
    check('preview: 3 valid', p.valid, 3)
    check('quoted comma kept in one cell', p.rows[1].name, 'Temple, Antique')
    const bad = api.catalogue.previewCsv({ kind: 'category', csv: 'name,parent\nA,Nowhere\nA,\n,\n' })
    check('preview: bad rows reported (blank row skipped)', bad.invalid, 2)
    throws('commit refuses a file with errors', () => api.catalogue.commitCsv({ kind: 'category', csv: 'name,parent\nA,Nowhere\n', batch_key: 'k0' }), /errors/)
    const c1 = api.catalogue.commitCsv({ kind: 'category', csv, batch_key: 'k1' })
    check('commit adds 3', c1.row_count, 3)
    const c2 = api.catalogue.commitCsv({ kind: 'category', csv, batch_key: 'k1' })
    check('same key again is a no-op', c2.repeated, true)
    check('no duplicate categories', db.prepare(`SELECT COUNT(*) n FROM category`).get().n, 3)
    const temple = api.catalogue.categories({}).find((c) => c.name === 'Temple, Antique')
    check('parent linked from the file', temple.parent_name, 'Bridal')
    throws('duplicate category name refused', () => api.catalogue.saveCategory({ name: 'bridal' }), /already exists/)
    const bridal = api.catalogue.categories({}).find((c) => c.name === 'Bridal')
    throws('category cycle refused', () => api.catalogue.saveCategory({ id: bridal.id, name: 'Bridal', parent_id: temple.id }), /loop/)
    check('search narrows the list', api.catalogue.categories({ search: 'daily' }).length, 1)

    section('Aliases')
    const ring = api.item.list({ search: 'Ring' })[0]
    const a1 = api.catalogue.saveAlias({ entity: 'item', entity_id: ring.id, alias: 'Angoothi', locale: 'hi' })
    const a2 = api.catalogue.saveAlias({ entity: 'item', entity_id: ring.id, alias: 'angoothi' })
    check('duplicate alias not added twice', a2.id, a1.id)
    throws('alias for a missing item refused', () => api.catalogue.saveAlias({ entity: 'item', entity_id: 99999, alias: 'x' }), /No item/)
    const found = api.catalogue.aliasSearch({ q: 'angoo' })
    check('alias search resolves the name', found[0]?.target_name, ring.name)
    const ac = api.catalogue.commitCsv({ kind: 'alias', csv: `entity,entity_id,alias\nitem,${ring.id},Mundri\nitem,${ring.id},Angoothi\n`, batch_key: 'a1' })
    check('alias import skips existing alias', ac.row_count, 1)
    api.catalogue.removeAlias({ id: a1.id })
    check('alias removed', api.catalogue.aliasSearch({ q: 'angoo' }).length, 0)

    section('Merge duplicate items')
    const dupId = api.item.save({ name: 'Ring (dup)', item_type_id: ring.item_type_id, item_group_id: ring.item_group_id,
      design_id: null, weight_mode: ring.weight_mode, uom: ring.uom, hsn: '7113', image: '', stock_mode: ring.stock_mode })
    const pu = api.purchase.save({
      head: { prefix: 'MI', invoice_date: today, party_id: S.suppliers.mahavir, party_name: 'Mahavir Gold',
              is_credit: 1, gst_pct: 0, paid_amount: 0, metal: 'Gold' },
      items: [{ item_id: dupId, item_name: 'Ring (dup)', qty: 1, gross_wt: 5, stone_wt: 0, net_wt: 5, purity: 91.6, rate: 6000, wastage_pct: 0 }],
    })
    const silverItem = api.item.list({}).find((i) => i.item_type_id !== ring.item_type_id)
    if (silverItem) throws('different metal refused', () => api.catalogue.mergeItems({ from_id: dupId, into_id: silverItem.id }), /cannot be merged/)
    const mg = api.catalogue.mergeItems({ from_id: dupId, into_id: ring.id })
    check('purchase line re-pointed', db.prepare(`SELECT item_id FROM purchase_item WHERE purchase_id=?`).get(pu.id).item_id, ring.id)
    check('merge reports purchase_item', mg.moved.purchase_item, 1)
    check('duplicate deleted', db.prepare(`SELECT COUNT(*) n FROM item WHERE id=?`).get(dupId).n, 0)
    check('old name kept as alias', api.catalogue.aliasSearch({ q: 'Ring (dup)' })[0]?.entity_id, ring.id)
    check('foreign keys intact', db.prepare(`PRAGMA foreign_key_check`).all().length, 0)

    section('Clear all entries still commits with holds present')
    api.reservations.create({ tag_id: api.tagStock.list({ status: 'IN_STOCK' })[3].id, customer_name: 'Z' })
    const backup = require('../electron/backup.cjs')
    const cleared = backup.clearEntries({ dataDir: path.join(tmp, 'data'), db: dbmod, stamp: 'test' })
    check('holds cleared with stock', cleared.removed.stock_hold >= 1, true)
    check('categories kept', db.prepare(`SELECT COUNT(*) n FROM category`).get().n, 3)
  } catch (e) {
    fail++
    console.log('  FAIL  crashed:', e.stack)
  }
  console.log(`\n${pass} passed, ${fail} failed`)
  app.exit(fail ? 1 : 0)
})
