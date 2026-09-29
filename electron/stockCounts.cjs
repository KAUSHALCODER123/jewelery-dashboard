// T07 — durable stock-count sessions with immutable expected sets.
// A missing scan alone never deletes stock; corrections post via approved
// explicit adjustments (updateRows) only.
const { get } = require('./db.cjs')
const audit = require('./audit.cjs')

function create({ scope, business_date, actor, branch }) {
  const db = get()
  if (!scope || typeof scope !== 'object') throw new Error('Count scope is required')
  const tx = db.transaction(() => {
    const id = db.prepare(`INSERT INTO stock_count_session
      (scope_json, business_date, status, creator, version, branch, created_at, updated_at)
      VALUES (?,?, 'OPEN', ?, 1, ?, datetime('now','localtime'), datetime('now','localtime'))`).run(
      JSON.stringify(scope).slice(0, 8000), business_date || null, actor || '', branch || null).lastInsertRowid
    // Immutable expected set: IN_STOCK tags matching scope at creation time.
    const clauses = [`ts.status='IN_STOCK'`]
    const args = {}
    if (scope.location) { clauses.push('ts.location=@loc'); args.loc = scope.location }
    if (scope.shelf_tray) { clauses.push('ts.shelf_tray=@tray'); args.tray = scope.shelf_tray }
    if (scope.item_id) { clauses.push('ts.item_id=@item'); args.item = scope.item_id }
    const rows = db.prepare(`SELECT ts.id, ts.tag, ts.net_wt, ts.final_wt, ts.location, ts.status
      FROM tag_stock ts WHERE ${clauses.join(' AND ')} ORDER BY ts.id`).all(args)
    const ins = db.prepare(`INSERT INTO stock_count_expected
      (session_id, tag_id, tag, net_wt, final_wt, location, status_snapshot) VALUES (?,?,?,?,?,?,?)`)
    for (const r of rows) ins.run(id, r.id, r.tag, r.net_wt, r.final_wt, r.location, r.status)
    audit.record(db, { actor, operation: 'COUNT.CREATE', entity: 'stock_count', entity_id: id, business_date })
    return read({ id })
  })
  return tx()
}

function read({ id }) {
  const db = get()
  const head = db.prepare(`SELECT * FROM stock_count_session WHERE id=?`).get(id)
  if (!head) return null
  head.scope = JSON.parse(head.scope_json || '{}')
  head.expected = db.prepare(`SELECT COUNT(*) n, COALESCE(SUM(net_wt),0) w FROM stock_count_expected WHERE session_id=?`).get(id)
  head.scanned = db.prepare(`SELECT COUNT(DISTINCT tag_id) n FROM stock_count_scan WHERE session_id=? AND resolved_tag_id IS NOT NULL`).get(id)
  return head
}

function list({ status, page, pageSize } = {}) {
  const db = get()
  const where = status ? `WHERE status=@status` : ''
  const total = db.prepare(`SELECT COUNT(*) n FROM stock_count_session ${where}`).get(status ? { status } : {}).n
  const size = Math.max(10, Math.min(200, Math.trunc(Number(pageSize)) || 50))
  const pg = Math.max(1, Math.min(Math.max(1, Math.ceil(total / size)), Math.trunc(Number(page)) || 1))
  const rows = db.prepare(`SELECT * FROM stock_count_session ${where}
    ORDER BY id DESC LIMIT @limit OFFSET @offset`).all({ ...(status ? { status } : {}), limit: size, offset: (pg - 1) * size })
  return { rows: rows.map(r => ({ ...r, scope: JSON.parse(r.scope_json || '{}') })), page: pg, pageSize: size, total }
}

function scan({ session_id, raw, actor }) {
  const db = get()
  const s = db.prepare(`SELECT * FROM stock_count_session WHERE id=?`).get(session_id)
  if (!s) throw new Error('Count session not found')
  if (s.status !== 'OPEN' && s.status !== 'PAUSED') throw new Error(`Session is ${s.status}`)
  const tag = String(raw || '').trim()
  if (!tag) throw new Error('Scan is empty')
  const resolved = db.prepare(`SELECT * FROM tag_stock WHERE tag=? COLLATE NOCASE`).get(tag)
  // Classify: matched / duplicate / unknown / wrong location / already sold / outside scope.
  let classification = 'UNKNOWN'
  if (resolved) {
    const dup = db.prepare(`SELECT 1 FROM stock_count_scan WHERE session_id=? AND resolved_tag_id=?`).get(session_id, resolved.id)
    const expected = db.prepare(`SELECT * FROM stock_count_expected WHERE session_id=? AND tag_id=?`).get(session_id, resolved.id)
    if (dup) classification = 'DUPLICATE'
    else if (!expected) classification = resolved.status === 'IN_STOCK' ? 'OUTSIDE_SCOPE' : 'ALREADY_SOLD'
    else if (resolved.status !== 'IN_STOCK') classification = 'ALREADY_SOLD'
    else {
      const scope = JSON.parse(s.scope_json || '{}')
      classification = (scope.location && resolved.location !== scope.location) ? 'WRONG_LOCATION' : 'MATCHED'
    }
  }
  const id = db.prepare(`INSERT INTO stock_count_scan
    (session_id, raw_scan, resolved_tag_id, classification, actor, created_at)
    VALUES (?,?,?,?,?,datetime('now','localtime'))`).run(
    session_id, tag, resolved ? resolved.id : null, classification, actor || '').lastInsertRowid
  return db.prepare(`SELECT * FROM stock_count_scan WHERE id=?`).get(id)
}

function setStatus({ id, status, actor, business_date }) {
  const db = get()
  const allowed = { OPEN: ['PAUSED', 'SUBMITTED', 'CANCELLED'], PAUSED: ['OPEN', 'SUBMITTED', 'CANCELLED'], SUBMITTED: ['APPROVED', 'CLOSED', 'OPEN'], APPROVED: ['CLOSED'], CLOSED: [], CANCELLED: [] }
  const cur = db.prepare(`SELECT * FROM stock_count_session WHERE id=?`).get(id)
  if (!cur) throw new Error('Count session not found')
  if (!allowed[cur.status]?.includes(status)) throw new Error(`Cannot move ${cur.status} → ${status}`)
  db.prepare(`UPDATE stock_count_session SET status=?, version=version+1, updated_at=datetime('now','localtime') WHERE id=?`).run(status, id)
  audit.record(db, { actor, operation: `COUNT.${status}`, entity: 'stock_count', entity_id: id, business_date })
  return read({ id })
}

function discrepancies({ session_id }) {
  const db = get()
  const s = db.prepare(`SELECT * FROM stock_count_session WHERE id=?`).get(session_id)
  if (!s) throw new Error('Count session not found')
  const expected = db.prepare(`SELECT * FROM stock_count_expected WHERE session_id=?`).all(session_id)
  const scannedIds = new Set(db.prepare(`SELECT DISTINCT resolved_tag_id id FROM stock_count_scan
    WHERE session_id=? AND resolved_tag_id IS NOT NULL`).all(session_id).map(r => r.id))
  const missing = expected.filter(e => !scannedIds.has(e.tag_id)).map(e => {
    // Movements after snapshot are exceptions, never auto-missing.
    const live = db.prepare(`SELECT status, location FROM tag_stock WHERE id=?`).get(e.tag_id)
    const moved = live && (live.status !== e.status_snapshot || live.location !== e.location)
    return { ...e, moved: !!moved, live_status: live?.status, live_location: live?.location }
  })
  const scans = db.prepare(`SELECT * FROM stock_count_scan WHERE session_id=? ORDER BY id`).all(session_id)
  return { missing, scans, expected_count: expected.length, scanned_count: scannedIds.size }
}

module.exports = { create, read, list, scan, setStatus, discrepancies }
