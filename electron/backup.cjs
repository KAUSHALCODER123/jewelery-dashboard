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

module.exports = { inspect, restore, summarise, REQUIRED_TABLES }
