// T07 — durable stock-count sessions with immutable expected sets.
// A missing scan alone never deletes stock: counting only records what was
// seen. Nothing here changes tag_stock.
const { get } = require('./db.cjs')
const audit = require('./audit.cjs')

// Same purity-aware group the stock screens show (api.cjs PIECE_GROUP).
const PIECE_GROUP = `CASE WHEN g.id IS NULL OR ABS(g.purity - ts.purity) < 0.05 THEN g.name
  ELSE COALESCE((
    SELECT g2.name FROM item_group g2
    WHERE g2.item_type_id = g.item_type_id AND ABS(g2.purity - ts.purity) < 0.05
      AND g2.name NOT LIKE 'Old %'
    ORDER BY g2.id LIMIT 1
  ), g.name) END`

// Scans that put a piece on the "found" side of the sheet.
const FOUND = `('MATCHED','WRONG_LOCATION')`
const TRANSITIONS = {
  OPEN: ['PAUSED', 'SUBMITTED', 'CANCELLED'],
  PAUSED: ['OPEN', 'SUBMITTED', 'CANCELLED'],
  SUBMITTED: ['APPROVED', 'OPEN', 'CANCELLED'],
  APPROVED: ['CLOSED'],
  CLOSED: [], CANCELLED: [],
}
// Signing a count off is a manager's call, not the counter's.
const NEEDS_MANAGER = new Set(['APPROVED', 'CLOSED'])

function session(db, id) {
  const s = db.prepare(`SELECT * FROM stock_count_session WHERE id=?`).get(id)
  if (!s) throw new Error('Count session not found')
  return s
}

function create({ scope = {}, business_date, actor, branch }) {
  const db = get()
  if (!scope || typeof scope !== 'object' || Array.isArray(scope)) throw new Error('Count scope is required')
  const clean = {}
  for (const k of ['location', 'shelf_tray', 'item_id']) {
    if (scope[k] != null && String(scope[k]).trim() !== '') {
      clean[k] = k === 'item_id' ? Number(scope[k]) : String(scope[k]).trim()
    }
  }
  const tx = db.transaction(() => {
    const id = db.prepare(`INSERT INTO stock_count_session
      (scope_json, business_date, status, creator, version, branch, created_at, updated_at)
      VALUES (?,?, 'OPEN', ?, 1, ?, datetime('now','localtime'), datetime('now','localtime'))`).run(
      JSON.stringify(clean), business_date || null, actor || '', branch || null).lastInsertRowid
    // Immutable expected set: every IN_STOCK piece in scope right now, copied
    // in one statement so a shop with thousands of pieces snapshots at once.
    const clauses = [`status='IN_STOCK'`]
    if (clean.location) clauses.push('location=@location')
    if (clean.shelf_tray) clauses.push('shelf_tray=@shelf_tray')
    if (clean.item_id) clauses.push('item_id=@item_id')
    db.prepare(`INSERT INTO stock_count_expected
        (session_id, tag_id, tag, net_wt, final_wt, location, status_snapshot)
      SELECT @session, id, tag, net_wt, final_wt, COALESCE(location,''), status
      FROM tag_stock WHERE ${clauses.join(' AND ')} ORDER BY id`).run({ ...clean, session: id })
    audit.record(db, { actor, operation: 'COUNT.CREATE', entity: 'stock_count', entity_id: id, business_date })
    return id
  })
  return read({ id: tx() })
}

const SUMMARY = `
  (SELECT COUNT(*) FROM stock_count_expected e WHERE e.session_id = s.id) AS expected_pcs,
  (SELECT COALESCE(SUM(net_wt),0) FROM stock_count_expected e WHERE e.session_id = s.id) AS expected_net,
  (SELECT COUNT(DISTINCT sc.resolved_tag_id) FROM stock_count_scan sc
     JOIN stock_count_expected e ON e.session_id = sc.session_id AND e.tag_id = sc.resolved_tag_id
    WHERE sc.session_id = s.id AND sc.classification IN ${FOUND}) AS found_pcs,
  (SELECT COUNT(*) FROM stock_count_scan sc WHERE sc.session_id = s.id) AS scans`

function withScope(r) {
  let scope = {}
  try { scope = JSON.parse(r.scope_json || '{}') } catch { /* keep {} */ }
  return { ...r, scope }
}

function read({ id }) {
  const r = get().prepare(`SELECT s.*, ${SUMMARY} FROM stock_count_session s WHERE s.id=?`).get(id)
  return r ? withScope(r) : null
}

function list({ status, page, pageSize } = {}) {
  const db = get()
  const where = status ? `WHERE s.status=@status` : ''
  const args = status ? { status } : {}
  const total = db.prepare(`SELECT COUNT(*) n FROM stock_count_session s ${where}`).get(args).n
  const size = Math.max(10, Math.min(200, Math.trunc(Number(pageSize)) || 50))
  const pg = Math.max(1, Math.min(Math.max(1, Math.ceil(total / size)), Math.trunc(Number(page)) || 1))
  const rows = db.prepare(`SELECT s.*, ${SUMMARY} FROM stock_count_session s ${where}
    ORDER BY s.id DESC LIMIT @limit OFFSET @offset`).all({ ...args, limit: size, offset: (pg - 1) * size })
  return { rows: rows.map(withScope), page: pg, pageSize: size, total }
}

/**
 * One scan, classified against the session's frozen expected set:
 *   MATCHED         expected and still in stock
 *   WRONG_LOCATION  expected, but the piece now sits somewhere else
 *   DUPLICATE       this piece was already found in this session
 *   OUTSIDE_SCOPE   in stock, just not part of this count
 *   ALREADY_SOLD    the tag exists but is sold / issued / melted
 *   UNKNOWN         no such tag
 */
function scan({ session_id, raw, actor }) {
  const db = get()
  const s = session(db, session_id)
  if (s.status !== 'OPEN') throw new Error(s.status === 'PAUSED' ? 'Count is paused — resume it to scan' : `Count is ${s.status}`)
  const tag = String(raw || '').trim().toUpperCase()
  if (!tag) throw new Error('Scan is empty')
  const piece = db.prepare(`SELECT ts.id, ts.tag, ts.status, COALESCE(ts.location,'') AS location,
      ts.net_wt, ts.final_wt, i.name AS item_name
    FROM tag_stock ts JOIN item i ON i.id = ts.item_id WHERE ts.tag = ? COLLATE NOCASE`).get(tag)
  let classification = 'UNKNOWN'
  let expected = null
  if (piece) {
    expected = db.prepare(`SELECT location FROM stock_count_expected WHERE session_id=? AND tag_id=?`).get(session_id, piece.id)
    const seen = db.prepare(`SELECT 1 FROM stock_count_scan
      WHERE session_id=? AND resolved_tag_id=? AND classification IN ${FOUND}`).get(session_id, piece.id)
    if (seen) classification = 'DUPLICATE'
    else if (piece.status !== 'IN_STOCK') classification = 'ALREADY_SOLD'
    else if (!expected) classification = 'OUTSIDE_SCOPE'
    else classification = piece.location !== (expected.location || '') ? 'WRONG_LOCATION' : 'MATCHED'
  }
  const id = db.prepare(`INSERT INTO stock_count_scan
    (session_id, raw_scan, resolved_tag_id, classification, actor, created_at)
    VALUES (?,?,?,?,?,datetime('now','localtime'))`).run(
    session_id, tag, piece ? piece.id : null, classification, actor || '').lastInsertRowid
  return {
    id, session_id, raw_scan: tag, resolved_tag_id: piece?.id ?? null, classification,
    expected: !!expected, tag: piece?.tag ?? tag, item_name: piece?.item_name ?? '',
    net_wt: piece?.net_wt ?? 0, location: piece?.location ?? '', status: piece?.status ?? '',
  }
}

function setStatus({ id, status, actor, business_date }) {
  const db = get()
  const cur = session(db, id)
  if (!TRANSITIONS[cur.status]?.includes(status)) throw new Error(`Cannot move ${cur.status} → ${status}`)
  if (NEEDS_MANAGER.has(status)) {
    const { session: who, can } = require('./auth.cjs')
    const u = who.get()
    if (u && !can(u.role, 'irreversible_stock')) throw new Error('Only a manager or the owner can approve a stock count')
  }
  db.prepare(`UPDATE stock_count_session SET status=?, version=version+1,
    updated_at=datetime('now','localtime') WHERE id=?`).run(status, id)
  audit.record(db, { actor, operation: `COUNT.${status}`, entity: 'stock_count', entity_id: id, business_date })
  return read({ id })
}

/**
 * The verification sheet: every expected piece and whether it was found, plus
 * the scans that did not land on one. All in SQL — a large shop is thousands
 * of rows.
 */
function sheet({ session_id }) {
  const db = get()
  const s = read({ id: session_id })
  if (!s) throw new Error('Count session not found')
  const rows = db.prepare(`
    SELECT e.tag_id AS id, e.tag, e.net_wt, e.final_wt, e.location, e.status_snapshot,
           ts.item_id, i.name AS item_name, ${PIECE_GROUP} AS group_name, ts.gross_wt,
           ts.status AS live_status, COALESCE(ts.location,'') AS live_location,
           EXISTS (SELECT 1 FROM stock_count_scan sc WHERE sc.session_id = e.session_id
                     AND sc.resolved_tag_id = e.tag_id AND sc.classification IN ${FOUND}) AS found
    FROM stock_count_expected e
    JOIN tag_stock ts ON ts.id = e.tag_id
    JOIN item i ON i.id = ts.item_id
    LEFT JOIN item_group g ON g.id = i.item_group_id
    WHERE e.session_id = ?
    ORDER BY i.name, e.tag`).all(session_id)
  for (const r of rows) {
    r.found = !!r.found
    // A piece that moved or sold after the count began is an exception to look
    // into, never an automatic "missing".
    r.moved = r.live_status !== r.status_snapshot || r.live_location !== (r.location || '')
  }
  const extras = db.prepare(`
    SELECT sc.id, sc.raw_scan, sc.classification, sc.created_at, ts.status AS live_status,
           COALESCE(ts.location,'') AS live_location, i.name AS item_name
    FROM stock_count_scan sc
    LEFT JOIN tag_stock ts ON ts.id = sc.resolved_tag_id
    LEFT JOIN item i ON i.id = ts.item_id
    WHERE sc.session_id = ? AND sc.classification NOT IN ${FOUND} AND sc.classification <> 'DUPLICATE'
    ORDER BY sc.id DESC`).all(session_id)
  return { session: s, rows, extras }
}

/** Missing pieces (flagged when they moved since the snapshot) and the scan log. */
function discrepancies({ session_id }) {
  const db = get()
  const s = read({ id: session_id })
  if (!s) throw new Error('Count session not found')
  const missing = db.prepare(`
    SELECT e.*, ts.status AS live_status, ts.location AS live_location,
           (ts.status <> e.status_snapshot OR COALESCE(ts.location,'') <> COALESCE(e.location,'')) AS moved
    FROM stock_count_expected e
    LEFT JOIN tag_stock ts ON ts.id = e.tag_id
    WHERE e.session_id = ?
      AND NOT EXISTS (SELECT 1 FROM stock_count_scan sc WHERE sc.session_id = e.session_id
                        AND sc.resolved_tag_id = e.tag_id AND sc.classification IN ${FOUND})
    ORDER BY e.tag`).all(session_id).map((r) => ({ ...r, moved: !!r.moved }))
  const scans = db.prepare(`SELECT * FROM stock_count_scan WHERE session_id=? ORDER BY id`).all(session_id)
  return { missing, scans, expected_count: s.expected_pcs, scanned_count: s.found_pcs }
}

module.exports = { create, read, list, scan, setStatus, sheet, discrepancies }
