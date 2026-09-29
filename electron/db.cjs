const path = require('node:path')
const fs = require('node:fs')
const Database = require('better-sqlite3')

let db = null

function open(userDataDir) {
  const dir = path.join(userDataDir, 'data')
  fs.mkdirSync(dir, { recursive: true })
  const file = path.join(dir, 'parivar.db')

  db = new Database(file)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')

  const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8')
  db.exec(schema)
  migrate()
  db.exec(`CREATE INDEX IF NOT EXISTS idx_stock_discovery ON tag_stock(status,item_id,net_wt);
    CREATE INDEX IF NOT EXISTS idx_stock_location ON tag_stock(location,shelf_tray,status);
    CREATE INDEX IF NOT EXISTS idx_stock_huid ON tag_stock(huid COLLATE NOCASE);
    CREATE INDEX IF NOT EXISTS idx_item_discovery ON item(item_type_id,item_group_id,design_id);`)
  seed()
  backfillLooseSales()
  return db
}

/**
 * The purchase an untagged "Loose pool" sale line is booked to: the oldest
 * purchase of that metal, dated on or before the bill, that still has metal
 * waiting for a label. Without this the grams left the loose pool but no
 * purchase's "still to label" ever went down, so All purchases on Tag & Barcode
 * kept showing 64 g after 9 g of it was sold. Same order as labelling from All
 * purchases: oldest first, else the one with most left, so an overrun shows on
 * one invoice. Null when no purchase has anything left (opening stock, old gold).
 * Left = bought net - tagged net - untagged net sold + returned, as in purchaseTally().
 */
function oldestOpenPurchase(dbh, metal, net, onDate) {
  const open = dbh.prepare(
    `SELECT p.id,
       (SELECT COALESCE(SUM(pi.net_wt),0) FROM purchase_item pi LEFT JOIN item i ON i.id = pi.item_id
         WHERE pi.purchase_id = p.id AND pi.direction = 'IN'
           AND COALESCE(i.stock_mode, 'TAG') <> 'LOOSE_WT')
       - (SELECT COALESCE(SUM(net_wt),0) FROM tag_stock WHERE purchase_id = p.id)
       - (SELECT COALESCE(SUM(net_wt),0) FROM sale_item
           WHERE purchase_id = p.id AND tag_stock_id IS NULL)
       + (SELECT COALESCE(SUM(net_wt),0) FROM sale_return_item
           WHERE purchase_id = p.id AND tag_stock_id IS NULL) AS left_net
     FROM purchase p
     WHERE p.metal = ? AND p.invoice_date <= ?
     ORDER BY p.invoice_date, p.id`
  ).all(metal || 'Gold', onDate || '9999-12-31').filter((p) => p.left_net > 0.005)
  if (!open.length) return null
  const fits = open.find((p) => p.left_net + 0.005 >= net)
  return (fits || open.reduce((a, p) => (p.left_net > a.left_net ? p : a))).id
}

/** Books Loose pool lines saved before v1.28.2 to a purchase, once, oldest bill first. */
function backfillLooseSales() {
  const KEY = 'loose_sale_purchase_backfill'
  if (db.prepare(`SELECT 1 FROM settings WHERE key = ?`).get(KEY)) return
  db.transaction(() => {
    const lines = db.prepare(
      `SELECT si.id, si.net_wt, s.bill_date,
              CASE WHEN it.name IN ('Gold', 'Silver', 'Platinum') THEN it.name ELSE 'Gold' END AS metal
       FROM sale_item si
       JOIN sale s ON s.id = si.sale_id
       LEFT JOIN item i ON i.id = si.item_id
       LEFT JOIN item_group g ON g.id = i.item_group_id
       LEFT JOIN item_type it ON it.id = g.item_type_id
       WHERE si.tag_stock_id IS NULL AND si.purchase_id IS NULL AND si.net_wt > 0
         AND COALESCE(i.stock_mode, 'TAG') <> 'LOOSE_WT'
       ORDER BY s.bill_date, s.id, si.line_no`
    ).all()
    const set = db.prepare(`UPDATE sale_item SET purchase_id = ? WHERE id = ?`)
    for (const l of lines) {
      const pid = oldestOpenPurchase(db, l.metal, l.net_wt, l.bill_date)
      if (pid) set.run(pid, l.id)
    }
    // Returns of those lines go back on the same purchase.
    const rets = db.prepare(
      `SELECT ri.id, ri.item_id, r.against_sale_id FROM sale_return_item ri
       JOIN sale_return r ON r.id = ri.return_id
       LEFT JOIN item i ON i.id = ri.item_id
       WHERE ri.tag_stock_id IS NULL AND ri.purchase_id IS NULL AND r.against_sale_id IS NOT NULL
         AND COALESCE(i.stock_mode, 'TAG') <> 'LOOSE_WT'`
    ).all()
    const soldFrom = db.prepare(
      `SELECT purchase_id FROM sale_item
       WHERE sale_id = ? AND tag_stock_id IS NULL AND purchase_id IS NOT NULL
       ORDER BY (item_id IS ?) DESC, line_no LIMIT 1`)
    const setRet = db.prepare(`UPDATE sale_return_item SET purchase_id = ? WHERE id = ?`)
    for (const r of rets) {
      const pid = soldFrom.get(r.against_sale_id, r.item_id ?? null)?.purchase_id
      if (pid) setRet.run(pid, r.id)
    }
    db.prepare(`INSERT INTO settings (key, value) VALUES (?, ?)`).run(KEY, new Date().toISOString())
  })()
}

/**
 * Schema changes for databases created by an earlier build.
 * `CREATE TABLE IF NOT EXISTS` cannot add a column to a table that already
 * exists, so anything added later has to be applied here. Every step must be
 * safe to run repeatedly.
 */
function migrate() {
  const columns = (table) =>
    db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name)

  // Distinguishes movements of *tagged pieces* from movements of *loose metal*,
  // so the two can be reported separately and a conversion can move weight from
  // one to the other instead of inventing it.
  if (!columns('loose_stock').includes('is_tagged')) {
    db.exec(`ALTER TABLE loose_stock ADD COLUMN is_tagged INTEGER NOT NULL DEFAULT 0`)
  }
  // Backfill: tag creation and tagged-piece sales are tagged movements.
  db.exec(`
    UPDATE loose_stock SET is_tagged = 1
    WHERE is_tagged = 0
      AND ( doc_type = 'OPENING'
         OR (doc_type = 'SALE' AND direction = 'OUT' AND is_urd = 0) )
  `)

  // The `expense` table modelled shop expenses outside the ledger, so nothing
  // posted to it could ever appear in the cash book or a P&L. Expenses are an
  // Expense account spent against with a Payment voucher instead.
  db.exec(`DROP TABLE IF EXISTS expense`)

  // Cost per fine gram. Without a cost basis there is no stock valuation and no
  // profit figure. Existing rows get 0, which reads as "not recorded" — reports
  // must exclude those rather than treat them as free stock.
  if (!columns('tag_stock').includes('purchase_rate')) {
    db.exec(`ALTER TABLE tag_stock ADD COLUMN purchase_rate REAL NOT NULL DEFAULT 0`)
  }

  // A karagir works to a different deadline than the customer's promise date —
  // the shop needs the piece back with time to spare to check and finish it.
  if (!columns('order_booking').includes('karagir_date')) {
    db.exec(`ALTER TABLE order_booking ADD COLUMN karagir_date TEXT DEFAULT ''`)
  }

  // Diamond and stone as rated components. Existing rows get 0 — a plain gold
  // piece is priced exactly as before.
  const addCol = (table, col, decl) => {
    if (!columns(table).includes(col)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${decl}`)
  }
  // Making charged as a percentage of the metal value. Existing rows get 0, so a
  // bill priced per gram of making is unaffected.
  addCol('sale_item', 'mkg_pct', 'REAL NOT NULL DEFAULT 0')
  // Untagged sale lines can name the purchase they were sold out of.
  addCol('sale_item', 'purchase_id', 'INTEGER')
  // A return of untagged metal names the purchase its sale line was booked to.
  addCol('sale_return_item', 'purchase_id', 'INTEGER')
  // Standalone old gold bills: which money account the customer was paid from.
  addCol('urd_bill', 'payment_mode', "TEXT DEFAULT 'Cash'")
  addCol('urd_bill', 'narration', "TEXT DEFAULT ''")
  addCol('sale_item', 'stone_rate', 'REAL NOT NULL DEFAULT 0')
  addCol('sale_item', 'stone_amount', 'REAL NOT NULL DEFAULT 0')
  addCol('sale_item', 'diamond_wt', 'REAL NOT NULL DEFAULT 0')
  addCol('sale_item', 'diamond_rate', 'REAL NOT NULL DEFAULT 0')
  addCol('sale_item', 'diamond_amount', 'REAL NOT NULL DEFAULT 0')
  // A purchase settled in fine metal rather than rupees, and the link from a
  // tagged piece back to the purchase it was made from (purchase ↔ label tally).
  addCol('purchase', 'paid_fine_wt', 'REAL NOT NULL DEFAULT 0')
  addCol('purchase', 'paid_fine_rate', 'REAL NOT NULL DEFAULT 0')
  addCol('purchase', 'paid_fine_amount', 'REAL NOT NULL DEFAULT 0')
  addCol('tag_stock', 'purchase_id', 'INTEGER REFERENCES purchase(id)')
  addCol('tag_stock', 'stone_rate', 'REAL NOT NULL DEFAULT 0')
  addCol('tag_stock', 'diamond_wt', 'REAL NOT NULL DEFAULT 0')
  addCol('tag_stock', 'diamond_rate', 'REAL NOT NULL DEFAULT 0')

  // Multi-metal for the loose/pure-metal flows. Each document chooses its metal;
  // existing rows are Gold, which is what they always were.
  for (const t of ['purchase', 'refinery', 'karagir_issue', 'karagir_receive', 'purchase_return']) {
    addCol(t, 'metal', `TEXT NOT NULL DEFAULT 'Gold'`)
  }

  // Stock-master attributes (category / salesman / shelf / size) and a reorder
  // threshold on the item. All optional; existing pieces get blanks / 0.
  addCol('tag_stock', 'category', `TEXT DEFAULT ''`)
  addCol('tag_stock', 'salesman', `TEXT DEFAULT ''`)
  addCol('tag_stock', 'shelf_tray', `TEXT DEFAULT ''`)
  addCol('tag_stock', 'size', `TEXT DEFAULT ''`)
  addCol('item', 'reorder_level', 'REAL NOT NULL DEFAULT 0')

  // Loyalty points earned and redeemed, per bill. The party's running balance is
  // derived from these, so there is nothing to reverse on an edit or delete.
  addCol('sale', 'loyalty_earned', 'REAL NOT NULL DEFAULT 0')
  addCol('sale', 'loyalty_redeemed', 'REAL NOT NULL DEFAULT 0')
  addCol('sale', 'loyalty_discount', 'REAL NOT NULL DEFAULT 0')

  // Weight-based saving schemes. Existing schemes and accounts default to
  // 'On Amount' with zero weights, which is exactly what they already were.
  for (const t of ['gss_scheme', 'gss_account']) {
    addCol(t, 'metal', `TEXT NOT NULL DEFAULT 'Gold'`)
    addCol(t, 'monthly_weight', 'REAL NOT NULL DEFAULT 0')
    addCol(t, 'bonus_weight', 'REAL NOT NULL DEFAULT 0')
    addCol(t, 'making_disc_pct', 'REAL NOT NULL DEFAULT 0')
  }
  addCol('gss_account', 'scheme_type', `TEXT NOT NULL DEFAULT 'On Amount'`)
  addCol('gss_account', 'period_unit', `TEXT NOT NULL DEFAULT 'Months'`)
  // Both sides of the rupees→grams conversion, kept per instalment.
  addCol('gss_receipt', 'weight', 'REAL NOT NULL DEFAULT 0')
  addCol('gss_receipt', 'rate', 'REAL NOT NULL DEFAULT 0')
  // Barcode reprint protection: when a piece's label was last printed, and how
  // many times. A tag never printed has an empty date, which is what the
  // "Not Printed Only" filter looks for.
  addCol('tag_stock', 'label_printed_at', "TEXT DEFAULT ''")
  addCol('tag_stock', 'label_print_count', 'INTEGER NOT NULL DEFAULT 0')

  // Card-swipe fee handling on bank accounts.
  addCol('account', 'is_card_swap', 'INTEGER NOT NULL DEFAULT 0')
  addCol('account', 'card_pct_customer', 'REAL NOT NULL DEFAULT 0')
  addCol('account', 'card_pct_shop', 'REAL NOT NULL DEFAULT 0')
  // What a bill charged for a card swipe, split between the two sides.
  addCol('sale', 'card_charge_customer', 'REAL NOT NULL DEFAULT 0')
  addCol('sale', 'card_charge_shop', 'REAL NOT NULL DEFAULT 0')

  // Bag weight (the pouch a piece is sold in) and a making discount expressed as
  // a percentage rather than rupees.
  addCol('tag_stock', 'bag_wt', 'REAL NOT NULL DEFAULT 0')
  addCol('sale', 'making_disc_pct', 'REAL NOT NULL DEFAULT 0')

  // Redeeming a scheme onto a bill. Scheme money is a liability the shop already
  // holds, so it settles the bill after tax instead of discounting it.
  addCol('sale', 'gss_id', 'INTEGER')
  addCol('sale', 'gss_amount', 'REAL NOT NULL DEFAULT 0')
  addCol('sale', 'gss_weight', 'REAL NOT NULL DEFAULT 0')
  addCol('sale', 'gss_rate', 'REAL NOT NULL DEFAULT 0')
  addCol('sale', 'gss_return', 'REAL NOT NULL DEFAULT 0')
  // Direct-amount bills: the line's typed amount (GST included on a GST bill)
  // is kept as typed, so reopening the bill shows the figure that was agreed.
  addCol('sale', 'direct_amount', 'INTEGER NOT NULL DEFAULT 0')
  addCol('sale_item', 'entered_amount', 'REAL NOT NULL DEFAULT 0')
  // Accounts enrolled before the account carried its own terms inherit them
  // from their scheme template, which is where they lived at the time.
  db.exec(`
    UPDATE gss_account SET
      scheme_type = COALESCE((SELECT s.scheme_type FROM gss_scheme s WHERE s.id = scheme_id), 'On Amount'),
      period_unit = COALESCE((SELECT s.period_unit FROM gss_scheme s WHERE s.id = scheme_id), 'Months')
    WHERE scheme_type = 'On Amount' AND period_unit = 'Months'
      AND EXISTS (SELECT 1 FROM gss_scheme s WHERE s.id = scheme_id
                    AND (s.scheme_type <> 'On Amount' OR s.period_unit <> 'Months'))
  `)

  // Loose weight-wise items (mani, fuli, dori): bought and sold by the gram out
  // of a common lot rather than tagged piece by piece. Existing items are all
  // tagged goods, so 'TAG' is the right default for every row already there.
  addCol('item', 'stock_mode', "TEXT NOT NULL DEFAULT 'TAG'")
  db.exec(`
    CREATE TABLE IF NOT EXISTS item_stock (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      item_id    INTEGER NOT NULL REFERENCES item(id),
      gross_wt   REAL NOT NULL DEFAULT 0,
      qty        REAL NOT NULL DEFAULT 0,
      rate       REAL NOT NULL DEFAULT 0,
      amount     REAL NOT NULL DEFAULT 0,
      doc_type   TEXT NOT NULL,
      doc_id     INTEGER,
      doc_no     TEXT DEFAULT '',
      direction  TEXT NOT NULL CHECK (direction IN ('IN','OUT')),
      remark     TEXT DEFAULT '',
      entry_date TEXT NOT NULL DEFAULT (date('now','localtime'))
    );
    CREATE INDEX IF NOT EXISTS idx_item_stock_item ON item_stock(item_id);
    CREATE INDEX IF NOT EXISTS idx_item_stock_doc  ON item_stock(doc_type, doc_id);
  `)
  // A purchase return only ever kept the item's NAME. That is enough for metal,
  // but a loose item's weight has to come off that item's own lot, so the return
  // has to say which item it was.
  addCol('purchase_return_item', 'item_id', 'INTEGER')

  // Which bill an order became. Orders delivered before this column existed have
  // no way to say, so they stay NULL — cancelling one of those old bills still
  // needs the order re-opened by hand, but nothing from here on does.
  addCol('order_booking', 'sale_id', 'INTEGER')

  // ── ERP plan R2/R3 tables (T05–T12). Created here for upgrades; fresh
  // installs get them from schema.sql. All idempotent.
  db.exec(`
  CREATE TABLE IF NOT EXISTS audit_event (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    actor TEXT DEFAULT '', operation TEXT NOT NULL, entity TEXT DEFAULT '',
    entity_id INTEGER, business_date TEXT, event_time TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    reason TEXT DEFAULT '', before_json TEXT, after_json TEXT, correlation_id TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_event(entity, entity_id);
  CREATE INDEX IF NOT EXISTS idx_audit_time ON audit_event(event_time);
  CREATE TABLE IF NOT EXISTS approval_request (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    action TEXT NOT NULL, entity TEXT NOT NULL, entity_id INTEGER,
    payload_json TEXT, payload_hash TEXT, target_version INTEGER,
    status TEXT NOT NULL DEFAULT 'REQUESTED' CHECK (status IN ('REQUESTED','APPROVED','REJECTED','CANCELLED','EXECUTED')),
    requester TEXT DEFAULT '', reviewer TEXT DEFAULT '', reason TEXT DEFAULT '',
    business_date TEXT, requested_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    decided_at TEXT, review_note TEXT DEFAULT ''
  );
  CREATE TABLE IF NOT EXISTS stock_hold (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tag_id INTEGER NOT NULL REFERENCES tag_stock(id),
    kind TEXT NOT NULL, source_type TEXT DEFAULT '', source_id INTEGER,
    state TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (state IN ('ACTIVE','RELEASED','CONSUMED','EXPIRED')),
    actor TEXT DEFAULT '', reason TEXT DEFAULT '', expires_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')), released_at TEXT
  );
  CREATE UNIQUE INDEX IF NOT EXISTS idx_hold_active ON stock_hold(tag_id, kind) WHERE state='ACTIVE';
  CREATE TABLE IF NOT EXISTS custody_event (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tag_id INTEGER, kind TEXT NOT NULL, from_state TEXT DEFAULT '', to_state TEXT DEFAULT '',
    actor TEXT DEFAULT '', reason TEXT DEFAULT '', doc_type TEXT DEFAULT '', doc_id INTEGER,
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );
  CREATE TABLE IF NOT EXISTS parked_bill (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    owner TEXT DEFAULT '', branch TEXT, schema_version INTEGER NOT NULL DEFAULT 1,
    draft_json TEXT NOT NULL DEFAULT '{}', revision INTEGER NOT NULL DEFAULT 1,
    status TEXT NOT NULL DEFAULT 'PARKED' CHECK (status IN ('PARKED','CONVERTED','DISCARDED')),
    idempotency_key TEXT, sale_id INTEGER REFERENCES sale(id),
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );
  CREATE TABLE IF NOT EXISTS stock_count_session (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    scope_json TEXT NOT NULL DEFAULT '{}', business_date TEXT,
    status TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','PAUSED','SUBMITTED','APPROVED','CLOSED','CANCELLED')),
    creator TEXT DEFAULT '', version INTEGER NOT NULL DEFAULT 1, branch TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );
  CREATE TABLE IF NOT EXISTS stock_count_expected (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id INTEGER NOT NULL REFERENCES stock_count_session(id) ON DELETE CASCADE,
    tag_id INTEGER NOT NULL, tag TEXT NOT NULL, net_wt REAL NOT NULL DEFAULT 0,
    final_wt REAL NOT NULL DEFAULT 0, location TEXT DEFAULT '', status_snapshot TEXT DEFAULT ''
  );
  CREATE INDEX IF NOT EXISTS idx_count_expected ON stock_count_expected(session_id, tag_id);
  CREATE TABLE IF NOT EXISTS stock_count_scan (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id INTEGER NOT NULL REFERENCES stock_count_session(id) ON DELETE CASCADE,
    raw_scan TEXT NOT NULL, resolved_tag_id INTEGER REFERENCES tag_stock(id),
    classification TEXT NOT NULL DEFAULT 'UNKNOWN', actor TEXT DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );
  CREATE TABLE IF NOT EXISTS stock_count_resolution (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id INTEGER NOT NULL REFERENCES stock_count_session(id) ON DELETE CASCADE,
    tag_id INTEGER, exception TEXT NOT NULL, evidence TEXT DEFAULT '',
    proposed_correction TEXT DEFAULT '', approval_id INTEGER, posting_ref TEXT DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );
  CREATE TABLE IF NOT EXISTS closing_session (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    business_date TEXT NOT NULL, branch TEXT,
    state_or_status TEXT DEFAULT 'DRAFT',
    status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','SUBMITTED','LOCKED')),
    revision INTEGER NOT NULL DEFAULT 1, source_fingerprint TEXT DEFAULT '',
    expected_cash REAL NOT NULL DEFAULT 0, counted_cash REAL, variance REAL,
    approved_by TEXT DEFAULT '', approve_note TEXT DEFAULT '', reopen_reason TEXT DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );
  CREATE TABLE IF NOT EXISTS closing_count (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id INTEGER NOT NULL REFERENCES closing_session(id) ON DELETE CASCADE,
    denomination REAL, qty REAL NOT NULL DEFAULT 0, amount REAL NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS payment_settlement (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    provider TEXT DEFAULT '', provider_ref TEXT UNIQUE, settle_date TEXT,
    gross REAL NOT NULL DEFAULT 0, fees REAL NOT NULL DEFAULT 0, net REAL NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );
  CREATE TABLE IF NOT EXISTS settlement_match (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id INTEGER REFERENCES closing_session(id) ON DELETE CASCADE,
    settlement_id INTEGER REFERENCES payment_settlement(id),
    source_type TEXT NOT NULL, source_id INTEGER NOT NULL, amount REAL NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS repair_job (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    customer_id INTEGER REFERENCES party(id), customer_name TEXT DEFAULT '',
    description TEXT DEFAULT '', gross_wt REAL NOT NULL DEFAULT 0, net_wt REAL NOT NULL DEFAULT 0,
    stone_details TEXT DEFAULT '', damage TEXT DEFAULT '', requested_work TEXT DEFAULT '',
    estimate REAL NOT NULL DEFAULT 0, promised_date TEXT, karigar_id INTEGER REFERENCES party(id),
    status TEXT NOT NULL DEFAULT 'RECEIVED', created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );
  CREATE TABLE IF NOT EXISTS repair_event (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id INTEGER NOT NULL REFERENCES repair_job(id) ON DELETE CASCADE,
    from_state TEXT DEFAULT '', to_state TEXT NOT NULL, actor TEXT DEFAULT '', note TEXT DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );
  CREATE TABLE IF NOT EXISTS repair_attachment (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id INTEGER NOT NULL REFERENCES repair_job(id) ON DELETE CASCADE,
    file_id TEXT NOT NULL, file_name TEXT DEFAULT '', mime TEXT DEFAULT '', size INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );
  CREATE TABLE IF NOT EXISTS reservation (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    customer_id INTEGER REFERENCES party(id), customer_name TEXT DEFAULT '',
    tag_id INTEGER NOT NULL REFERENCES tag_stock(id),
    status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','FULFILLED','RELEASED','EXPIRED')),
    expires_at TEXT, advance_id INTEGER,
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );
  CREATE TABLE IF NOT EXISTS memo_doc (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    direction TEXT NOT NULL CHECK (direction IN ('IN','OUT')),
    tag_id INTEGER REFERENCES tag_stock(id), counterparty TEXT DEFAULT '', custodian TEXT DEFAULT '',
    status TEXT NOT NULL DEFAULT 'ISSUED', due_date TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );
  CREATE TABLE IF NOT EXISTS hallmark_batch (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    centre TEXT DEFAULT '', status TEXT NOT NULL DEFAULT 'PREPARED',
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );
  CREATE TABLE IF NOT EXISTS hallmark_item (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    batch_id INTEGER NOT NULL REFERENCES hallmark_batch(id) ON DELETE CASCADE,
    tag_id INTEGER NOT NULL REFERENCES tag_stock(id),
    outcome TEXT NOT NULL DEFAULT 'PENDING', huid TEXT DEFAULT '', return_wt REAL
  );
  CREATE TABLE IF NOT EXISTS hallmark_event (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    batch_id INTEGER NOT NULL REFERENCES hallmark_batch(id) ON DELETE CASCADE,
    from_state TEXT DEFAULT '', to_state TEXT NOT NULL, actor TEXT DEFAULT '', note TEXT DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );
  CREATE TABLE IF NOT EXISTS category (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    parent_id INTEGER REFERENCES category(id), name TEXT NOT NULL UNIQUE,
    archived INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS item_alias (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    entity TEXT NOT NULL, entity_id INTEGER NOT NULL, locale TEXT DEFAULT '',
    alias TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_alias_lookup ON item_alias(entity, alias COLLATE NOCASE);
  CREATE TABLE IF NOT EXISTS catalogue_batch (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    batch_key TEXT UNIQUE, row_count INTEGER NOT NULL DEFAULT 0, status TEXT DEFAULT 'COMMITTED',
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );
  CREATE TABLE IF NOT EXISTS migration_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE, applied_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    detail TEXT DEFAULT ''
  );
  `)
  for (const m of ['erp_r1_r4_baseline']) {
    db.prepare(`INSERT OR IGNORE INTO migration_log (name, detail) VALUES (?,?)`).run(m, 'ERP plan R1-R4 foundation tables')
  }
}

function get() {
  if (!db) throw new Error('Database not opened')
  return db
}

/**
 * Release the database file. Only used by restore, which has to replace the
 * file on disk — SQLite keeps it open, and on Windows an open handle blocks
 * the overwrite outright.
 */
function close() {
  if (!db) return
  try { db.close() } catch { /* already closed */ }
  db = null
}

/** Idempotent first-run seed: company row, masters, accounts, numbering series. */
function seed() {
  const fyStart = defaultFyStart()
  db.prepare(
    `INSERT OR IGNORE INTO company (id, name, fy_start, fy_end) VALUES (1, 'Demo', ?, ?)`
  ).run(fyStart.start, fyStart.end)

  const types = ['Gold', 'Silver', 'Platinum', 'Diamond', 'Stone']
  const insType = db.prepare(`INSERT OR IGNORE INTO item_type (name) VALUES (?)`)
  types.forEach((t) => insType.run(t))

  const typeId = (n) =>
    db.prepare(`SELECT id FROM item_type WHERE name = ?`).get(n)?.id ?? null

  // name, type, default purity %
  const groups = [
    ['24K Gold', 'Gold', 99.9],
    ['23K Gold', 'Gold', 95.8],
    ['22K Gold', 'Gold', 91.6],
    ['21K Gold', 'Gold', 87.5],
    ['18K Gold', 'Gold', 75.0],
    ['14K Gold', 'Gold', 58.5],
    ['9K Gold', 'Gold', 37.5],
    ['Old Gold', 'Gold', 80.0],
    ['Silver', 'Silver', 92.5],
    ['Old Silver', 'Silver', 80.0],
    ['Platinum', 'Platinum', 95.0],
    ['Stone', 'Stone', 0],
  ]
  const insGroup = db.prepare(
    `INSERT OR IGNORE INTO item_group (name, item_type_id, purity) VALUES (?, ?, ?)`
  )
  groups.forEach(([n, t, p]) => insGroup.run(n, typeId(t), p))

  const accounts = [
    ['1001', 'Cash Account', 'Cash', 'Current Asset', 1],
    ['1002', 'Bank Account', 'Bank', 'Current Asset', 1],
    ['4001', 'Sales Account', 'Income', 'Revenue', 1],
    ['5001', 'Purchase Account', 'Expense', 'Direct Expense', 1],
    ['5002', 'Old Gold Purchase', 'Expense', 'Direct Expense', 1],
    ['2001', 'GST Payable', 'Duties & Taxes', 'Current Liability', 1],
    ['5100', 'Shop Expenses', 'Expense', 'Indirect Expense', 1],
    // The shop's own slice of a card-swipe fee. Its own head so the cost of
    // taking cards is visible in the P&L rather than buried in sundries.
    ['5110', 'Card Charges', 'Expense', 'Indirect Expense', 1],
    // Scheme deposits are a liability (we owe the member gold), so they are kept
    // off the customer's trading khata in their own account.
    ['2100', 'Gold Saving Scheme', 'Liability', 'Current Liability', 1],
  ]
  const insAcc = db.prepare(
    `INSERT OR IGNORE INTO account (code, name, acc_type, acc_group, is_system) VALUES (?,?,?,?,?)`
  )
  accounts.forEach((a) => insAcc.run(...a))

  const series = [
    ['SALE', 'COM', 'Retail / Counter'],
    ['SALE', 'ESM', 'Estimate'],
    ['SALE', 'Service', 'Service bill'],
    ['URD', 'O', 'Old gold purchase'],
    ['PURCHASE', 'MI', 'Material in'],
    ['REFINERY', 'MO', 'Refinery out'],
    ['RECEIPT', 'VR', 'Receipt voucher'],
    ['PAYMENT', 'VP', 'Payment voucher'],
    ['ORDER', 'NO', 'New order'],
    ['GSS', 'GS', 'Gold saving account'],
    ['GSSRCT', 'GR', 'Gold saving receipt'],
    ['SETTLE', 'SO', 'Stock cash settlement'],
    ['SALERET', 'SR', 'Sales return'],
    ['PURRET', 'PR', 'Purchase return'],
    ['KARAGIR_ISSUE', 'KI', 'Material issued to karagir'],
    ['KARAGIR_RECEIVE', 'KR', 'Order received from karagir'],
    ['TRANSFER', 'TR', 'Stock transfer between branches'],
  ]
  const insSeries = db.prepare(
    `INSERT OR IGNORE INTO voucher_series (doc_type, prefix, label) VALUES (?,?,?)`
  )
  series.forEach((s) => insSeries.run(...s))

  // The shop itself is a branch; tagged pieces default to location 'Shop', so
  // seeding it by that name keeps existing stock where it already says it is.
  db.prepare(`INSERT OR IGNORE INTO branch (name, is_main) VALUES ('Shop', 1)`).run()

  const insSetting = db.prepare(
    `INSERT OR IGNORE INTO settings (key, value) VALUES (?,?)`
  )
  insSetting.run('gst_pct', '3')
  insSetting.run('theme', 'light')
  // Loyalty: points earned as a % of the bill's goods value, and the rupee value
  // of one point when redeemed. Defaults give a 1% earn, ₹1 per point.
  insSetting.run('loyalty_earn_pct', '1')
  insSetting.run('loyalty_redeem_value', '1')
}

function defaultFyStart(today = new Date()) {
  const y = today.getMonth() + 1 >= 4 ? today.getFullYear() : today.getFullYear() - 1
  return { start: `${y}-04-01`, end: `${y + 1}-03-31` }
}

/**
 * Reserve the next document number for a series and return it, e.g. "COM7".
 * Runs inside whatever transaction the caller has open.
 */
function nextDocNo(docType, prefix) {
  const row = db
    .prepare(`SELECT id, next_no FROM voucher_series WHERE doc_type = ? AND prefix = ?`)
    .get(docType, prefix)
  if (!row) {
    db.prepare(
      `INSERT INTO voucher_series (doc_type, prefix, next_no) VALUES (?,?,2)`
    ).run(docType, prefix)
    return `${prefix}1`
  }
  db.prepare(`UPDATE voucher_series SET next_no = next_no + 1 WHERE id = ?`).run(row.id)
  return `${prefix}${row.next_no}`
}

/** Peek at the next number without consuming it (for showing on a blank form). */
function peekDocNo(docType, prefix) {
  const row = db
    .prepare(`SELECT next_no FROM voucher_series WHERE doc_type = ? AND prefix = ?`)
    .get(docType, prefix)
  return `${prefix}${row ? row.next_no : 1}`
}

module.exports = { open, get, close, nextDocNo, peekDocNo, defaultFyStart, oldestOpenPurchase }
