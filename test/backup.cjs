/**
 * Backup inspection and restore.
 *
 * The point of restore is that it is the last line of defence when something has
 * gone wrong, so the failure modes matter more than the happy path: a file that
 * is not a database, a database that is not this app's, and a stale write-ahead
 * log surviving the swap and corrupting the restored books.
 *    npm run test:backup
 */
const { app } = require('electron')
const path = require('node:path')
const fs = require('node:fs')
const os = require('node:os')
const Database = require('better-sqlite3')

let pass = 0
let fail = 0

function check(label, actual, expected) {
  const ok = String(actual) === String(expected)
  if (ok) { pass++; console.log(`  PASS  ${label} = ${actual}`) }
  else { fail++; console.log(`  FAIL  ${label}: got ${actual}, expected ${expected}`) }
}
function ok(label, cond) {
  if (cond) { pass++; console.log(`  PASS  ${label}`) }
  else { fail++; console.log(`  FAIL  ${label}`) }
}
function rejects(label, fn, match) {
  try {
    fn()
    fail++
    console.log(`  FAIL  ${label}: expected it to be refused`)
  } catch (e) {
    if (match && !match.test(e.message)) {
      fail++
      console.log(`  FAIL  ${label}: wrong message — ${e.message}`)
    } else {
      pass++
      console.log(`  PASS  ${label} — "${e.message}"`)
    }
  }
}
const head = (t) => console.log(`\n── ${t} ${'─'.repeat(Math.max(0, 46 - t.length))}`)

app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'parivar-run-')))

app.whenReady().then(() => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'parivar-backup-'))
  const dataDir = path.join(tmp, 'data')
  const db = require('../electron/db.cjs')
  const backups = require('../electron/backup.cjs')
  db.open(tmp)
  const api = require('../electron/api.cjs')

  try {
    head('1. A shop with some books in it')
    const g22 = api.itemGroup.list().find((g) => g.name === '22K Gold')
    const itemId = api.item.save({
      name: 'Ring', item_type_id: g22.item_type_id, item_group_id: g22.id,
      design_id: null, weight_mode: 'WEIGHT', uom: 'GRAM', hsn: '7113', image: '',
    })
    api.tagStock.saveBatch({
      itemId,
      rows: [{ gross_wt: 10, stone_wt: 0, purity: 91.6, purchase_rate: 5800, entry_date: '2026-07-21' }],
    })
    api.party.save({ party_type: 'CUSTOMER', name: 'Sandip Jain', metals: [] })
    check('tags before backup', api.tagStock.list({ status: 'IN_STOCK' }).length, 1)
    check('parties before backup', api.party.list({ type: 'CUSTOMER' }).length, 1)

    head('2. Take a backup')
    const backupFile = path.join(tmp, 'good-backup.db')
    db.get().pragma('wal_checkpoint(TRUNCATE)')
    fs.copyFileSync(path.join(dataDir, 'parivar.db'), backupFile)
    ok('backup file written', fs.existsSync(backupFile))

    head('3. Inspect reports what is inside, without opening the live db')
    const info = backups.inspect(backupFile)
    check('company name read', info.company, 'Demo')
    check('tag count read', info.counts.tags, 1)
    check('party count read', info.counts.parties, 1)
    ok('file size reported', info.size > 0)

    head('4. Bad files are refused')
    const notADb = path.join(tmp, 'notes.db')
    fs.writeFileSync(notADb, 'this is not a database at all')
    rejects('plain text refused', () => backups.inspect(notADb), /not a database|could not be opened/i)

    const otherDb = path.join(tmp, 'other.db')
    const o = new Database(otherDb)
    o.exec(`CREATE TABLE recipes (id INTEGER PRIMARY KEY, name TEXT)`)
    o.close()
    rejects('a different app\'s database refused',
      () => backups.inspect(otherDb), /not a Parivar backup/i)

    rejects('missing file refused',
      () => backups.inspect(path.join(tmp, 'nope.db')), /could not be found/i)

    head('5. Work done after the backup')
    api.party.save({ party_type: 'CUSTOMER', name: 'Amit Patel', metals: [] })
    api.tagStock.saveBatch({
      itemId,
      rows: [{ gross_wt: 20, stone_wt: 0, purity: 91.6, entry_date: '2026-07-22' }],
    })
    check('tags now', api.tagStock.list({ status: 'IN_STOCK' }).length, 2)
    check('parties now', api.party.list({ type: 'CUSTOMER' }).length, 2)

    head('6. Restore rolls the shop back')
    const res = backups.restore({ filePath: backupFile, dataDir, db, stamp: 'test' })
    ok('safety copy written', fs.existsSync(res.safety))
    ok('write-ahead log cleared', !fs.existsSync(path.join(dataDir, 'parivar.db-wal')))

    // Restore closes the handle; reopening is what the app restart does.
    db.open(tmp)
    check('tags after restore', api.tagStock.list({ status: 'IN_STOCK' }).length, 1)
    check('parties after restore', api.party.list({ type: 'CUSTOMER' }).length, 1)
    check('cost price survived restore',
      api.tagStock.list({ status: 'IN_STOCK' })[0].purchase_rate, 5800)

    head('7. The restore itself can be undone')
    // The pre-restore copy is a valid backup, so the work from step 5 is not lost.
    const undo = backups.inspect(res.safety)
    check('safety copy holds the newer books', undo.counts.parties, 2)
    backups.restore({ filePath: res.safety, dataDir, db, stamp: 'test2' })
    db.open(tmp)
    check('back to the newer books', api.party.list({ type: 'CUSTOMER' }).length, 2)
    check('and the newer stock', api.tagStock.list({ status: 'IN_STOCK' }).length, 2)

    head('8. A damaged backup never replaces good books')
    const corrupt = path.join(tmp, 'corrupt.db')
    const bytes = fs.readFileSync(backupFile)
    bytes.fill(0, 200, 4096)          // scribble over the first pages
    fs.writeFileSync(corrupt, bytes)
    rejects('damaged file refused', () => backups.restore({ filePath: corrupt, dataDir, db }))
    check('live books untouched', api.party.list({ type: 'CUSTOMER' }).length, 2)

    head('9. Every table is either kept or cleared')
    const tables = db.get().prepare(`SELECT name FROM sqlite_master
      WHERE type='table' AND name NOT LIKE 'sqlite_%'`).all().map((r) => r.name)
    const unlisted = tables.filter((t) =>
      !backups.KEEP_TABLES.includes(t) && !backups.CLEAR_TABLES.includes(t))
    check('tables on neither list (add each to KEEP or CLEAR)', unlisted.join(', ') || 'none', 'none')

    head('10. Clear all entries keeps the setup and starts the books fresh')
    // A real bill, so the clear has to cut rows that point at each other.
    const party = api.party.list({ type: 'CUSTOMER' })[0]
    const tag = api.tagStock.list({ status: 'IN_STOCK' })[0]
    const sale = api.sale.save({
      head: {
        prefix: 'COM', bill_date: '2026-07-23', party_id: party.id, party_name: party.name,
        is_credit: 1, payment_mode: 'Cash', gst_pct: 3, bill_discount: 0, making_discount: 0,
        other_amount: 0, manual_urd_amount: 0, tcs_pct: 0, amount_received: 0,
      },
      items: [{
        tag: tag.tag, tag_stock_id: tag.id, item_id: itemId, item_name: 'Ring', hsn: '7113',
        qty: 0, gross_wt: tag.gross_wt, purity: 91.6, stone_wt: 0, net_wt: tag.gross_wt,
        rate_per_gm: 4590, mkg_per_gm: 300, hallmark_charges: 0, huid: '',
      }],
      urds: [],
    })
    check('a bill was made', sale.bill_no, 'COM1')
    const before = backups.summarise(db.get())
    const itemsBefore = api.item.list().length
    const groupsBefore = api.itemGroup.list().length
    const usersBefore = db.get().prepare(`SELECT COUNT(*) c FROM app_user`).get().c

    const cleared = backups.clearEntries({ dataDir, db, stamp: 'test3' })
    const after = backups.summarise(db.get())
    check('customers cleared', after.counts.parties, 0)
    check('tags cleared', after.counts.tags, 0)
    check('bills cleared', after.counts.sales, 0)
    check('khata cleared', db.get().prepare(`SELECT COUNT(*) c FROM ledger_entry`).get().c, 0)
    check('company kept', after.company, 'Demo')
    check('items kept', api.item.list().length, itemsBefore)
    check('item groups kept', api.itemGroup.list().length, groupsBefore)
    check('logins kept', db.get().prepare(`SELECT COUNT(*) c FROM app_user`).get().c, usersBefore)
    check('bill numbers restart', db.get().prepare(`SELECT MAX(next_no) m FROM voucher_series`).get().m, 1)
    check('tag numbers restart', api.tagStock.nextTag({ itemId }), 'RIN00001')
    check('nothing left pointing at a deleted row', db.get().pragma('foreign_key_check').length, 0)
    const next = api.sale.save({
      head: {
        prefix: 'COM', bill_date: '2026-07-24', party_id: null, party_name: 'Walk-in',
        is_credit: 0, payment_mode: 'Cash', gst_pct: 3, bill_discount: 0, making_discount: 0,
        other_amount: 0, manual_urd_amount: 0, tcs_pct: 0, amount_received: 0,
      },
      items: [], urds: [],
    })
    check('first real bill is number 1', next.bill_no, 'COM1')

    head('11. The clear can be undone from its safety copy')
    const saved = backups.inspect(cleared.safety)
    check('safety copy holds the old bills', saved.counts.sales, before.counts.sales)
    backups.restore({ filePath: cleared.safety, dataDir, db, stamp: 'test4' })
    db.open(tmp)
    check('old customers back', api.party.list({ type: 'CUSTOMER' }).length, before.counts.parties)
  } catch (e) {
    fail++
    console.error('\nUNCAUGHT:', e.stack || e.message)
  }

  console.log(`\n${'═'.repeat(50)}`)
  console.log(`${pass} passed, ${fail} failed`)
  console.log('═'.repeat(50))
  process.exit(fail ? 1 : 0)
})
