// T11 — reservations + approval/memo stock. Reuses stock_hold (T05) so a piece
// can carry only one custody hold at a time; expiry uses backend time and is
// enforced on read AND on sale save.
const { get } = require('./db.cjs')
const holds = require('./availability.cjs')
const audit = require('./audit.cjs')

const likeOf = (s) => `%${String(s).trim().replace(/[\\%_]/g, '\\$&')}%`

function pageOf({ total, page, pageSize }) {
  const size = Math.max(10, Math.min(200, Math.trunc(Number(pageSize)) || 50))
  const pg = Math.max(1, Math.min(Math.max(1, Math.ceil(total / size)), Math.trunc(Number(page)) || 1))
  return { page: pg, pageSize: size, offset: (pg - 1) * size }
}

/** A tag to be reserved or memo'd must be saleable now: in stock and on no hold of any kind. */
function availableTag(db, tag_id) {
  const tag = db.prepare(`SELECT * FROM tag_stock WHERE id=?`).get(tag_id)
  if (!tag) throw new Error('Tag not found')
  const a = holds.availability(db, tag)
  if (a.reason === 'ON_HOLD') throw new Error(`Tag ${tag.tag} is already on hold (${a.holds.map(h => h.kind).join(', ')})`)
  if (!a.saleable) throw new Error(`Tag ${tag.tag} is not in stock`)
  return tag
}

/**
 * A date picked in the UI means "until the end of that day"; a bare date would
 * compare as midnight and expire the reservation a day early.
 */
function expiryOf(expires_at) {
  const v = String(expires_at || '').trim()
  if (!v) return null
  if (!/^\d{4}-\d{2}-\d{2}( \d{2}:\d{2}(:\d{2})?)?$/.test(v)) throw new Error('Expiry must be a date (YYYY-MM-DD)')
  const full = v.length === 10 ? `${v} 23:59:59` : v
  const now = get().prepare(`SELECT datetime('now','localtime') n`).get().n
  if (full <= now) throw new Error('Expiry must be in the future')
  return full
}

/** End the source's active hold: CONSUMED when the piece went out, RELEASED otherwise. */
function endHold(db, kind, sourceId, consumed, actor, reason) {
  const h = db.prepare(`SELECT * FROM stock_hold WHERE kind=? AND source_id=? AND state='ACTIVE'`).get(kind, sourceId)
  if (!h) return
  if (!consumed) return holds.releaseHold(db, { id: h.id, actor, reason })
  db.prepare(`UPDATE stock_hold SET state='CONSUMED', released_at=datetime('now','localtime') WHERE id=?`).run(h.id)
  db.prepare(`INSERT INTO custody_event (tag_id, kind, from_state, to_state, actor, reason, doc_type, doc_id, created_at)
    VALUES (?,'HOLD_CONSUMED','ACTIVE','CONSUMED',?,?,?,?,datetime('now','localtime'))`).run(
    h.tag_id, actor || '', reason || '', h.source_type || '', h.source_id)
}

function createReservation({ customer_id, customer_name, tag_id, expires_at, advance_id, actor, business_date }) {
  const db = get()
  if (!tag_id) throw new Error('A tag is required')
  if (!customer_id && !customer_name?.trim()) throw new Error('A customer is required')
  const expiry = expiryOf(expires_at)
  const tx = db.transaction(() => {
    sweepReservations(actor)
    availableTag(db, tag_id)
    let name = String(customer_name || '').trim()
    if (customer_id && !name) name = db.prepare(`SELECT name FROM party WHERE id=?`).get(customer_id)?.name || ''
    const id = db.prepare(`INSERT INTO reservation
      (customer_id, customer_name, tag_id, status, expires_at, advance_id, created_at, updated_at)
      VALUES (?,?,?, 'ACTIVE', ?, ?, datetime('now','localtime'), datetime('now','localtime'))`).run(
      customer_id || null, name, tag_id, expiry, advance_id || null).lastInsertRowid
    holds.placeHold(db, { tag_id, kind: 'RESERVATION', source_type: 'reservation', source_id: id, actor, reason: 'customer reservation', expires_at: expiry })
    audit.record(db, { actor, operation: 'RESERVATION.CREATE', entity: 'reservation', entity_id: id, business_date })
    return db.prepare(`SELECT * FROM reservation WHERE id=?`).get(id)
  })
  return tx()
}

// FULFILLED: the customer is buying it — the hold is consumed and the piece can
// be billed. RELEASED/EXPIRED: back on the counter for anyone.
function setReservation({ id, status, actor, business_date }) {
  const db = get()
  if (!['FULFILLED', 'RELEASED', 'EXPIRED'].includes(status)) throw new Error('Unknown reservation state')
  const tx = db.transaction(() => {
    const r = db.prepare(`SELECT * FROM reservation WHERE id=?`).get(id)
    if (!r) throw new Error('Reservation not found')
    if (r.status !== 'ACTIVE') throw new Error(`Reservation is already ${r.status}`)
    db.prepare(`UPDATE reservation SET status=?, updated_at=datetime('now','localtime') WHERE id=?`).run(status, id)
    endHold(db, 'RESERVATION', id, status === 'FULFILLED', actor, `reservation ${status.toLowerCase()}`)
    audit.record(db, { actor, operation: `RESERVATION.${status}`, entity: 'reservation', entity_id: id, business_date })
    return db.prepare(`SELECT * FROM reservation WHERE id=?`).get(id)
  })
  return tx()
}

function sweepReservations(actor) {
  const db = get()
  const due = db.prepare(`SELECT id FROM reservation WHERE status='ACTIVE'
    AND expires_at IS NOT NULL AND expires_at <> '' AND expires_at <= datetime('now','localtime')`).all()
  // Expire the reservations first so their holds are ended through the same
  // path; the generic sweep then only catches holds with no reservation row.
  if (due.length) {
    db.transaction(() => {
      for (const r of due) setReservation({ id: r.id, status: 'EXPIRED', actor: actor || 'system' })
    })()
  }
  holds.sweepExpired(db, actor || 'system')
  return due.length
}

function listReservations({ status, customer_id, search, page, pageSize } = {}) {
  const db = get()
  sweepReservations('system')
  const clauses = []
  const args = {}
  if (status) { clauses.push('r.status=@status'); args.status = status }
  if (customer_id) { clauses.push('r.customer_id=@cid'); args.cid = customer_id }
  if (String(search || '').trim()) {
    clauses.push(`(r.customer_name LIKE @q ESCAPE '\\' OR ts.tag LIKE @q ESCAPE '\\' OR i.name LIKE @q ESCAPE '\\')`)
    args.q = likeOf(search)
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''
  const from = `FROM reservation r LEFT JOIN tag_stock ts ON ts.id=r.tag_id LEFT JOIN item i ON i.id=ts.item_id`
  const total = db.prepare(`SELECT COUNT(*) n ${from} ${where}`).get(args).n
  const pg = pageOf({ total, page, pageSize })
  const rows = db.prepare(`SELECT r.*, ts.tag, ts.net_wt, i.name item_name ${from}
    ${where} ORDER BY r.id DESC LIMIT @limit OFFSET @offset`).all({ ...args, limit: pg.pageSize, offset: pg.offset })
  return { rows, page: pg.page, pageSize: pg.pageSize, total }
}

// Outbound memo: shop-owned piece to external custody; stays owned, unavailable.
// Inbound memo: supplier-owned custody items; excluded from owned valuation.
const MEMO_OUTCOMES = { OUT: ['RETURNED', 'SOLD'], IN: ['RETURNED', 'ACQUIRED'] }

function issueMemo({ direction, tag_id, counterparty, custodian, due_date, actor, business_date }) {
  const db = get()
  if (!MEMO_OUTCOMES[direction]) throw new Error('Memo direction must be IN or OUT')
  if (!String(counterparty || '').trim()) throw new Error(direction === 'OUT' ? 'Who is taking the piece is required' : 'Supplier is required')
  if (due_date && !/^\d{4}-\d{2}-\d{2}$/.test(due_date)) throw new Error('Due date must be a date')
  const tx = db.transaction(() => {
    let id
    if (direction === 'OUT') {
      if (!tag_id) throw new Error('A tag is required for an outbound memo')
      availableTag(db, tag_id)
      id = db.prepare(`INSERT INTO memo_doc
        (direction, tag_id, counterparty, custodian, status, due_date, created_at, updated_at)
        VALUES ('OUT',?,?,?, 'ISSUED',?,datetime('now','localtime'),datetime('now','localtime'))`).run(
        tag_id, counterparty.trim(), custodian || 'customer', due_date || null).lastInsertRowid
      holds.placeHold(db, { tag_id, kind: 'MEMO', source_type: 'memo', source_id: id, actor, reason: 'outbound approval stock' })
    } else {
      id = db.prepare(`INSERT INTO memo_doc
        (direction, tag_id, counterparty, custodian, status, due_date, created_at, updated_at)
        VALUES ('IN', NULL, ?, ?, 'ISSUED', ?, datetime('now','localtime'), datetime('now','localtime'))`).run(
        counterparty.trim(), custodian || 'shop', due_date || null).lastInsertRowid
    }
    audit.record(db, { actor, operation: direction === 'OUT' ? 'MEMO.ISSUE' : 'MEMO.INBOUND', entity: 'memo', entity_id: id, business_date })
    return db.prepare(`SELECT * FROM memo_doc WHERE id=?`).get(id)
  })
  return tx()
}

function closeMemo({ id, outcome, actor, business_date }) {
  const db = get()
  const tx = db.transaction(() => {
    const m = db.prepare(`SELECT * FROM memo_doc WHERE id=?`).get(id)
    if (!m) throw new Error('Memo not found')
    if (m.status !== 'ISSUED') throw new Error(`Memo is already ${m.status}`)
    if (!MEMO_OUTCOMES[m.direction]?.includes(outcome)) throw new Error(`An ${m.direction === 'OUT' ? 'outbound' : 'inbound'} memo closes as ${MEMO_OUTCOMES[m.direction].join(' or ')}`)
    db.prepare(`UPDATE memo_doc SET status=?, updated_at=datetime('now','localtime') WHERE id=?`).run(outcome, id)
    // SOLD ends the hold as consumed so the piece can be billed to the customer;
    // RETURNED puts it back on the counter.
    if (m.direction === 'OUT' && m.tag_id) endHold(db, 'MEMO', id, outcome === 'SOLD', actor, `memo ${outcome.toLowerCase()}`)
    // INBOUND acquire/sell conversions go through purchase/tagging — this
    // records the decision; ownership changes only via those workflows (T11).
    audit.record(db, { actor, operation: `MEMO.${outcome}`, entity: 'memo', entity_id: id, business_date })
    return db.prepare(`SELECT * FROM memo_doc WHERE id=?`).get(id)
  })
  return tx()
}

function listMemos({ direction, status, search, page, pageSize } = {}) {
  const db = get()
  const clauses = []
  const args = {}
  if (direction) { clauses.push('m.direction=@dir'); args.dir = direction }
  if (status) { clauses.push('m.status=@status'); args.status = status }
  if (String(search || '').trim()) {
    clauses.push(`(m.counterparty LIKE @q ESCAPE '\\' OR ts.tag LIKE @q ESCAPE '\\' OR i.name LIKE @q ESCAPE '\\')`)
    args.q = likeOf(search)
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''
  const from = `FROM memo_doc m LEFT JOIN tag_stock ts ON ts.id=m.tag_id LEFT JOIN item i ON i.id=ts.item_id`
  const total = db.prepare(`SELECT COUNT(*) n ${from} ${where}`).get(args).n
  const pg = pageOf({ total, page, pageSize })
  const rows = db.prepare(`SELECT m.*, ts.tag, ts.net_wt, i.name item_name,
      CASE WHEN m.status='ISSUED' AND m.due_date IS NOT NULL AND m.due_date < date('now','localtime') THEN 1 ELSE 0 END overdue
    ${from} ${where} ORDER BY m.id DESC LIMIT @limit OFFSET @offset`).all({ ...args, limit: pg.pageSize, offset: pg.offset })
  return { rows, page: pg.page, pageSize: pg.pageSize, total }
}

module.exports = { createReservation, setReservation, sweepReservations, listReservations, issueMemo, closeMemo, listMemos, MEMO_OUTCOMES }
