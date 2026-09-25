/**
 * Reading and restoring backup files.
 *
 * Kept out of main.cjs so the risky parts — deciding whether a file is a real
 * Parivar database, and swapping it in without leaving a stale write-ahead log
 * behind — can be tested directly.
 */
const fs = require('node:fs')
const path = require('node:path')
const Database = require('better-sqlite3')

/** A backup missing any of these is not this app's database. */
const REQUIRED_TABLES = ['company', 'party', 'item', 'tag_stock', 'sale', 'ledger_entry']

const countOf = (database, table) => {
  try { return database.prepare(`SELECT COUNT(*) c FROM ${table}`).get().c } catch { return 0 }
}

/** Counts and dates used to describe a database to the owner. */
function summarise(database) {
  const one = (sql) => { try { return database.prepare(sql).get() } catch { return null } }
  const co = one(`SELECT name, fy_start, fy_end FROM company WHERE id = 1`)
  return {
    company: co?.name || '',
    fy_start: co?.fy_start || '',
    fy_end: co?.fy_end || '',
    counts: {
      parties: countOf(database, 'party'),
      tags: countOf(database, 'tag_stock'),
      sales: countOf(database, 'sale'),
      purchases: countOf(database, 'purchase'),
    },
    last_entry: one(`SELECT MAX(entry_date) d FROM ledger_entry`)?.d || '',
  }
}

/**
 * Read a backup file without touching the live database. Throws a message meant
 * for the shopkeeper if the file is unusable — better to refuse here than to
 * fail half-way through replacing their books.
 */
function inspect(filePath) {
  if (!filePath || !fs.existsSync(filePath)) {
    throw new Error('That backup file could not be found.')
  }
  let probe
  try {
    probe = new Database(filePath, { readonly: true, fileMustExist: true })
  } catch {
    throw new Error('That file could not be opened. Choose a .db backup created by this app.')
  }
  try {
    let integrity
    try {
      integrity = probe.pragma('integrity_check', { simple: true })
    } catch {
      throw new Error('That file is not a database. Choose a .db backup created by this app.')
    }
    if (integrity !== 'ok') {
      throw new Error('That backup file is damaged and cannot be restored.')
    }

    const tables = new Set(
      probe.prepare(`SELECT name FROM sqlite_master WHERE type='table'`).all().map((r) => r.name)
    )
    if (REQUIRED_TABLES.some((t) => !tables.has(t))) {
      throw new Error("That file is not a Parivar backup — it is missing the shop's tables.")
    }

    return { filePath, size: fs.statSync(filePath).size, ...summarise(probe) }
  } finally {
    try { probe.close() } catch { /* nothing to close */ }
  }
}

/**
 * Replace the live database with a backup.
 *
 * The current books are copied aside first, so restoring the wrong file is
 * itself recoverable. The caller is expected to restart the app afterwards —
 * every module holds rows read from a database that no longer exists.
 */
function restore({ filePath, dataDir, db, stamp }) {
  // Re-validate. The path made a round trip through the renderer, and a check
  // done before that trip proves nothing about the file being opened now.
  inspect(filePath)

  const livePath = path.join(dataDir, 'parivar.db')
  const at = stamp || new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const safety = path.join(dataDir, `pre-restore-${at}.db`)

  db.get().pragma('wal_checkpoint(TRUNCATE)')
  fs.copyFileSync(livePath, safety)
  db.close()

  // The write-ahead log belongs to the OLD database. Left in place, SQLite
  // would replay it over the restored file and corrupt it.
  for (const suffix of ['-wal', '-shm']) {
    try { fs.unlinkSync(livePath + suffix) } catch { /* not present */ }
  }
  fs.copyFileSync(filePath, livePath)

  return { safety, livePath }
}

/*
 * Clearing the entries — for a shop that practised on the software, or made a
 * mess of its first days, and wants to start its real books clean.
 *
 * Every table is on exactly one of these two lists; the test suite fails if a
 * new table is added to neither, so nobody has to remember to come back here.
 *
 *   KEEP   the shop's setup: company and settings, logins, item masters,
 *          accounts, rates, scheme definitions and bill-number series.
 *   CLEAR  everything that happened: bills, purchases, returns, tags and stock,
 *          orders, karagir and refinery work, schemes joined, vouchers, both
 *          ledgers — and the customers and suppliers themselves.
 *
 * Stock and khata balances are sums over these entries, so emptying them leaves
 * every balance at zero with nothing to recalculate. Tag numbers restart too:
 * the next one is worked out from the tags that exist.
 */
const KEEP_TABLES = [
  'company', 'settings', 'app_user', 'branch', 'grid_pref',
  'item_type', 'item_group', 'design', 'item', 'rate_master', 'metal_rate',
  'account', 'voucher_series', 'gss_scheme',
]
const CLEAR_TABLES = [
  'sale', 'sale_item', 'sale_urd', 'sale_payment', 'sale_metal',
  'sale_return', 'sale_return_item',
  'purchase', 'purchase_item', 'purchase_return', 'purchase_return_item',
  'urd_bill', 'refinery', 'refinery_item', 'stock_settlement',
  'tag_stock', 'loose_stock', 'item_stock', 'stock_transfer', 'stock_transfer_item',
  'order_booking', 'order_item', 'order_urd', 'karagir_issue', 'karagir_receive',
  'gss_account', 'gss_receipt',
  'voucher', 'ledger_entry', 'metal_entry',
  'party', 'party_metal_opening',
]

/**
 * Empty every CLEAR table and restart the bill numbers, after copying the whole
 * database aside. One transaction: it all happens or none of it does.
 */
function clearEntries({ dataDir, db, stamp }) {
  const live = db.get()
  const at = stamp || new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const safety = path.join(dataDir, `before-clear-${at}.db`)
  live.pragma('wal_checkpoint(TRUNCATE)')
  fs.copyFileSync(path.join(dataDir, 'parivar.db'), safety)

  const present = new Set(
    live.prepare(`SELECT name FROM sqlite_master WHERE type='table'`).all().map((r) => r.name)
  )
  const tables = CLEAR_TABLES.filter((t) => present.has(t))
  const removed = {}
  live.transaction(() => {
    // Checked once at commit, not row by row, so the order tables are emptied
    // in does not matter — only that nothing kept still points at them.
    live.pragma('defer_foreign_keys = ON')
    for (const t of tables) removed[t] = live.prepare(`DELETE FROM ${t}`).run().changes
    live.prepare(`UPDATE voucher_series SET next_no = 1`).run()
    if (present.has('sqlite_sequence')) {
      const del = live.prepare(`DELETE FROM sqlite_sequence WHERE name = ?`)
      for (const t of tables) del.run(t)
    }
  })()
  return { safety, removed }
}

module.exports = { inspect, restore, summarise, clearEntries, REQUIRED_TABLES, KEEP_TABLES, CLEAR_TABLES }
