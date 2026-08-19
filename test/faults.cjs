/**
 * When things break — power cuts, corrupted files, restores mid-month.
 *
 * A shop's PC is under a counter in a dusty market. The power drops without
 * warning. A pen drive is yanked out. A file gets truncated. None of that is
 * exotic; it is Tuesday. What must never happen is that the BOOKS come out
 * wrong — half a bill written, a payment recorded against a sale that was rolled
 * back, a total that no longer foots. "It crashed" is forgivable. "It crashed
 * and the accounts are now silently wrong" is not.
 *
 * This suite injects the faults on purpose and checks the guarantees hold:
 *
 *   · a write that throws part-way leaves NOTHING behind, not half a document
 *   · the database survives being reopened, as it would be after a power cut
 *   · a corrupt or truncated backup is REFUSED, not restored into the live books
 *   · a real restore round-trips every figure exactly
 *   · the safety copy taken before a restore is itself a valid, restorable book
 *
 *    npm run test:faults
 */
const { app } = require('electron')
const path = require('node:path')
const fs = require('node:fs')
const os = require('node:os')
const Database = require('better-sqlite3')

const DAY = '2026-07-21'

let pass = 0
let fail = 0

function check(label, actual, expected, tol = 0.02) {
  const ok =
    typeof expected === 'number'
      ? Math.abs(Number(actual) - expected) <= tol
      : String(actual) === String(expected)
  if (ok) { pass++; console.log(`  PASS  ${label} = ${actual}`) }
  else { fail++; console.log(`  FAIL  ${label}: got ${actual}, expected ${expected}`) }
}
function throws(label, fn, match) {
  try { fn(); fail++; console.log(`  FAIL  ${label}: expected a refusal, none came`) }
  catch (e) {
    if (match && !match.test(e.message)) {
      fail++; console.log(`  FAIL  ${label}: wrong message — ${e.message}`)
    } else { pass++; console.log(`  PASS  ${label} — ${e.message}`) }
  }
}
const head = (t) => console.log(`\n══ ${t} ${'═'.repeat(Math.max(0, 54 - t.length))}`)

app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'parivar-run-')))

app.whenReady().then(() => {
  const userDir = fs.mkdtempSync(path.join(os.tmpdir(), 'parivar-fault-'))
  const db = require('../electron/db.cjs')
  const backup = require('../electron/backup.cjs')
  db.open(userDir)
  let api = require('../electron/api.cjs')
  const dataDir = path.join(userDir, 'data')
  const livePath = path.join(dataDir, 'parivar.db')

  const grp = (n) => api.itemGroup.list().find((x) => x.name === n)
  const g22 = grp('22K Gold')
  const ring = api.item.save({
    name: 'Gold Ring', item_type_id: g22.item_type_id, item_group_id: g22.id,
    design_id: null, weight_mode: 'WEIGHT', uom: 'GRAM', hsn: '7113', image: '',
  })
  const cust = api.party.save({
    name: 'Priya Shah', party_type: 'CUSTOMER', state: 'Maharashtra', opening_balance: 0,
  })
  const tagOne = (gross, date) => {
    api.tagStock.saveBatch({
      itemId: ring, rows: [{ gross_wt: gross, purity: 100, purchase_rate: 6000, entry_date: date }],
    })
    return api.tagStock.list({ status: 'IN_STOCK' }).sort((a, b) => b.id - a.id)[0]
  }
  const sellHead = (extra) => ({
    prefix: 'COM', bill_date: DAY, party_id: cust, party_name: 'Priya Shah',
    state: 'Maharashtra', is_credit: 1, payment_mode: 'Cash', gst_pct: 3,
    bill_discount: 0, making_discount: 0, other_amount: 0, manual_urd_amount: 0,
    tcs_pct: 0, amount_received: 0, ...extra,
  })

  try {
    head('A write that fails leaves nothing behind')
    // A sale is one transaction. If ANYTHING inside it throws, the whole thing
    // must roll back — no line item, no ledger row, no consumed tag. We force a
    // failure by billing a tag that is fine and a second "line" whose tag does
    // not exist, so the posting loop throws half-way through.
    const good = tagOne(10, DAY)
    const salesBefore = api.sale.list({}).length
    const ledgerBefore = require('../electron/db.cjs').get()
      .prepare(`SELECT COUNT(*) c FROM ledger_entry`).get().c
    throws('a bill with a bad line is refused with a clear message', () =>
      api.sale.save({
        head: sellHead({}),
        items: [
          { tag: good.tag, tag_stock_id: good.id, item_id: ring, item_name: 'Gold Ring',
            hsn: '7113', qty: 0, gross_wt: 10, purity: 100, stone_wt: 0, net_wt: 10,
            rate_per_gm: 6000, mkg_per_gm: 0, hallmark_charges: 0 },
          // Second line points at a tag that is not in stock — the save throws.
          { tag: 'GHOST999', tag_stock_id: 999999, item_id: ring, item_name: 'Ghost',
            hsn: '7113', qty: 0, gross_wt: 5, purity: 100, stone_wt: 0, net_wt: 5,
            rate_per_gm: 6000, mkg_per_gm: 0, hallmark_charges: 0 },
      ] }))
    const raw = require('../electron/db.cjs').get()
    check('no sale was written', api.sale.list({}).length, salesBefore)
    check('no ledger rows leaked', raw.prepare(`SELECT COUNT(*) c FROM ledger_entry`).get().c, ledgerBefore)
    check('no orphan line items', raw.prepare(`SELECT COUNT(*) c FROM sale_item`).get().c, 0)
    check('and the good tag is still in stock',
      api.tagStock.list({ status: 'IN_STOCK' }).some((t) => t.id === good.id), true)
    check('the customer owes nothing from a failed bill',
      api.party.balance({ id: cust }).balance, 0)

    head('The books foot after a fault, not just before it')
    // Do some real trading, then a failed write, then check the trial balance
    // is exactly what it was before the failure — the failure changed nothing.
    api.sale.save({
      head: sellHead({ amount_received: 0 }),
      items: [{ tag: good.tag, tag_stock_id: good.id, item_id: ring, item_name: 'Gold Ring',
                hsn: '7113', qty: 0, gross_wt: 10, purity: 100, stone_wt: 0, net_wt: 10,
                rate_per_gm: 6000, mkg_per_gm: 0, hallmark_charges: 0 }],
    })
    const tbBefore = api.reports.trialBalance({ from: '2026-04-01', to: '2027-03-31' }).drTotal
    const g2 = tagOne(8, DAY)
    throws('another bad bill is refused', () =>
      api.sale.save({
        head: sellHead({}),
        items: [
          { tag: g2.tag, tag_stock_id: g2.id, item_id: ring, item_name: 'Gold Ring',
            hsn: '7113', qty: 0, gross_wt: 8, purity: 100, stone_wt: 0, net_wt: 8,
            rate_per_gm: 6000, mkg_per_gm: 0, hallmark_charges: 0 },
          { tag: 'GHOST', tag_stock_id: 888888, item_id: ring, item_name: 'Ghost',
            hsn: '7113', qty: 0, gross_wt: 1, purity: 100, stone_wt: 0, net_wt: 1,
            rate_per_gm: 6000, mkg_per_gm: 0, hallmark_charges: 0 },
      ] }))
    check('the trial balance is untouched by the failure',
      api.reports.trialBalance({ from: '2026-04-01', to: '2027-03-31' }).drTotal, tbBefore)
    check('and it still foots',
      api.reports.trialBalance({ from: '2026-04-01', to: '2027-03-31' }).drTotal,
      api.reports.trialBalance({ from: '2026-04-01', to: '2027-03-31' }).crTotal)

    head('The database survives being reopened, as after a power cut')
    // A power cut is, from the file's point of view, the process vanishing and
    // the file being opened again later. Simulate exactly that: close, reopen,
    // and check every figure is still there and still foots.
    const balBefore = api.party.balance({ id: cust }).balance
    const salesN = api.sale.list({}).length
    db.close()
    delete require.cache[require.resolve('../electron/api.cjs')]
    db.open(userDir)
    api = require('../electron/api.cjs')
    check('the sale is still there after reopening', api.sale.list({}).length, salesN)
    check('the customer balance survived', api.party.balance({ id: cust }).balance, balBefore)
    check('the books still foot after a reopen',
      api.reports.trialBalance({ from: '2026-04-01', to: '2027-03-31' }).drTotal,
      api.reports.trialBalance({ from: '2026-04-01', to: '2027-03-31' }).crTotal)
    check('the integrity check passes',
      require('../electron/db.cjs').get().pragma('integrity_check', { simple: true }), 'ok')

    head('A good backup can be taken and read back')
    require('../electron/db.cjs').get().pragma('wal_checkpoint(TRUNCATE)')
    const backupPath = path.join(userDir, 'good-backup.db')
    fs.copyFileSync(livePath, backupPath)
    const info = backup.inspect(backupPath)
    check('the backup inspects clean', info.company, 'Demo')
    check('and knows how many bills it holds', info.counts.sales, salesN)

    head('A corrupt backup is refused, not restored')
    // A file truncated half-way — a pen drive pulled out during the copy.
    const truncated = path.join(userDir, 'truncated.db')
    const bytes = fs.readFileSync(backupPath)
    fs.writeFileSync(truncated, bytes.subarray(0, Math.floor(bytes.length / 2)))
    throws('a truncated file is refused', () => backup.inspect(truncated),
      /damaged|not a database|could not be opened/i)

    // A file with the right size but garbage inside.
    const garbage = path.join(userDir, 'garbage.db')
    fs.writeFileSync(garbage, Buffer.alloc(bytes.length, 0x7a))
    throws('a garbage file is refused', () => backup.inspect(garbage),
      /not a database|could not be opened|damaged/i)

    // A valid SQLite database, but not one of ours.
    const foreign = path.join(userDir, 'foreign.db')
    const fdb = new Database(foreign)
    fdb.exec(`CREATE TABLE something (id INTEGER); INSERT INTO something VALUES (1)`)
    fdb.close()
    throws('a database that is not ours is refused', () => backup.inspect(foreign),
      /not a Parivar backup|missing/i)

    // A file that does not exist at all.
    throws('a missing file is refused', () => backup.inspect(path.join(userDir, 'nope.db')),
      /could not be found/i)

    head('None of those refusals touched the live books')
    check('the live database still foots',
      api.reports.trialBalance({ from: '2026-04-01', to: '2027-03-31' }).drTotal,
      api.reports.trialBalance({ from: '2026-04-01', to: '2027-03-31' }).crTotal)
    check('and still holds every bill', api.sale.list({}).length, salesN)

    head('A real restore round-trips every figure')
    // Take the position now, then trade some MORE, then restore the earlier
    // backup and confirm we are back exactly where the backup was — not one
    // rupee of the later trading survived.
    const atBackup = {
      sales: salesN,
      balance: api.party.balance({ id: cust }).balance,
      stock: api.tagStock.list({ status: 'IN_STOCK' }).length,
      tb: api.reports.trialBalance({ from: '2026-04-01', to: '2027-03-31' }).drTotal,
    }
    // More trading, that the restore must erase.
    const later = tagOne(20, DAY)
    api.sale.save({
      head: sellHead({ amount_received: 50000 }),
      items: [{ tag: later.tag, tag_stock_id: later.id, item_id: ring, item_name: 'Gold Ring',
                hsn: '7113', qty: 0, gross_wt: 20, purity: 100, stone_wt: 0, net_wt: 20,
                rate_per_gm: 7000, mkg_per_gm: 0, hallmark_charges: 0 }],
    })
    check('the extra bill is there before the restore', api.sale.list({}).length, salesN + 1)

    // Restore the backup over the live file, the way the app does it.
    const res = backup.restore({ filePath: backupPath, dataDir, db, stamp: 'faulttest' })
    delete require.cache[require.resolve('../electron/api.cjs')]
    db.open(userDir)
    api = require('../electron/api.cjs')
    check('sales are back to the backup point', api.sale.list({}).length, atBackup.sales)
    check('the later bill is gone', api.sale.list({}).some((s) => s.total_amount > 140000), false)
    check('the customer balance is restored', api.party.balance({ id: cust }).balance, atBackup.balance)
    check('stock is restored', api.tagStock.list({ status: 'IN_STOCK' }).length, atBackup.stock)
    check('and the trial balance is exactly the backup’s',
      api.reports.trialBalance({ from: '2026-04-01', to: '2027-03-31' }).drTotal, atBackup.tb)
    check('the restored books foot',
      api.reports.trialBalance({ from: '2026-04-01', to: '2027-03-31' }).drTotal,
      api.reports.trialBalance({ from: '2026-04-01', to: '2027-03-31' }).crTotal)

    head('The safety copy taken before a restore is itself restorable')
    // Restoring the WRONG file must be recoverable — the shop's real books were
    // copied aside first. Prove that copy is a valid, readable backup holding
    // the state that was live a moment ago.
    check('a safety copy was written', fs.existsSync(res.safety), true)
    const safetyInfo = backup.inspect(res.safety)
    check('the safety copy inspects clean', safetyInfo.company, 'Demo')
    // It held the LATER trading, since it was the live state when the restore ran.
    check('and it holds the state that was replaced', safetyInfo.counts.sales, salesN + 1)
  } catch (e) {
    fail++
    console.log('\n  ERROR', e && e.stack ? e.stack : e)
  }

  console.log(`\n${'═'.repeat(60)}`)
  console.log(`${pass} passed, ${fail} failed`)
  console.log('═'.repeat(60))
  app.exit(fail ? 1 : 0)
})
