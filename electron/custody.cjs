// T11 — reservations + approval/memo stock. Reuses stock_hold (T05) so two
// reservations can never lock the same piece; expiry uses backend time and is
// enforced on read AND on sale save.
const { get } = require('./db.cjs')
const holds = require('./availability.cjs')
const audit = require('./audit.cjs')

function createReservation({ customer_id, customer_name, tag_id, expires_at, advance_id, actor, business_date }) {
  const db = get()
  if (!tag_id) throw new Error('A tag is required')
  if (!customer_id && !customer_name?.trim()) throw new Error('A customer is required')
  const tx = db.transaction(() => {
    holds.sweepExpired(db, 'system')
    const tag = db.prepare(`SELECT * FROM tag_stock WHERE id=?`).get(tag_id)
    if (!tag || tag.status !== 'IN_STOCK') throw new Error('Tag is not in stock')
    const id = db.prepare(`INSERT INTO reservation
      (customer_id, customer_name, tag_id, status, expires_at, advance_id, created_at, updated_at)
      VALUES (?,?,?, 'ACTIVE', ?, ?, datetime('now','localtime'), datetime('now','localtime'))`).run(
      customer_id || null, customer_name || '', tag_id, expires_at || null, advance_id || null).lastInsertRowid
    holds.placeHold(db, { tag_id, kind: 'RESERVATION', source_type: 'reservation', source_id: id, actor, reason: 'customer reservation', expires_at })
    audit.record(db, { actor, operation: 'RESERVATION.CREATE', entity: 'reservation', entity_id: id, business_date })
    return db.prepare(`SELECT * FROM reservation WHERE id=?`).get(id)
  })
  return tx()
}

function setReservation({ id, status, actor, business_date }) {
  const db = get()
  const tx = db.transaction(() => {
    const r = db.prepare(`SELECT * FROM reservation WHERE id=?`).get(id)
    if (!r) throw new Error('Reservation not found')
    if (r.status !== 'ACTIVE') throw new Error(`Reservation is ${r.status}`)
    if (!['FULFILLED', 'RELEASED', 'EXPIRED'].includes(status)) throw new Error('Unknown reservation state')
    db.prepare(`UPDATE reservation SET status=?, updated_at=datetime('now','localtime') WHERE id=?`).run(status, id)
    const h = db.prepare(`SELECT * FROM stock_hold WHERE kind='RESERVATION' AND source_id=? AND state='ACTIVE'`).get(id)
    if (h) {
      if (status === 'FULFILLED') db.prepare(`UPDATE stock_hold SET state='CONSUMED' WHERE id=?`).run(h.id)
      else db.prepare(`UPDATE stock_hold SET state='RELEASED', released_at=datetime('now','localtime') WHERE id=?`).run(h.id)
    }
    audit.record(db, { actor, operation: `RESERVATION.${status}`, entity: 'reservation', entity_id: id, business_date })
    return db.prepare(`SELECT * FROM reservation WHERE id=?`).get(id)
  })
  return tx()
}

function sweepReservations(actor) {
  const db = get()
  holds.sweepExpired(db, actor)
  const rows = db.prepare(`SELECT * FROM reservation WHERE status='ACTIVE'
    AND expires_at IS NOT NULL AND expires_at <> '' AND expires_at <= datetime('now','localtime')`).all()
  for (const r of rows) {
    try { setReservation({ id: r.id, status: 'EXPIRED', actor: actor || 'system' }) } catch { /* keep sweeping */ }
  }
  return rows.length
}

function listReservations({ status, customer_id, page, pageSize } = {}) {
  const db = get()
  sweepReservations('system')
  const clauses = []
  const args = {}
  if (status) { clauses.push('status=@status'); args.status = status }
  if (customer_id) { clauses.push('customer_id=@cid'); args.cid = customer_id }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''
  const total = db.prepare(`SELECT COUNT(*) n FROM reservation ${where}`).get(args).n
  const size = Math.max(10, Math.min(200, Math.trunc(Number(pageSize)) || 50))
  const pg = Math.max(1, Math.min(Math.max(1, Math.ceil(total / size)), Math.trunc(Number(page)) || 1))
  const rows = db.prepare(`SELECT r.*, ts.tag FROM reservation r LEFT JOIN tag_stock ts ON ts.id=r.tag_id
    ${where} ORDER BY r.id DESC LIMIT @limit OFFSET @offset`).all({ ...args, limit: size, offset: (pg - 1) * size })
  return { rows, page: pg, pageSize: size, total }
}

// Outbound memo: shop-owned piece to external custody; stays owned, unavailable.
// Inbound memo: supplier-owned custody items; excluded from owned valuation.
function issueMemo({ direction, tag_id, counterparty, custodian, due_date, actor, business_date }) {
  const db = get()
  const tx = db.transaction(() => {
    if (direction === 'OUT') {
      const tag = db.prepare(`SELECT * FROM tag_stock WHERE id=?`).get(tag_id)
      if (!tag || tag.status !== 'IN_STOCK') throw new Error('Tag is not in stock')
      const id = db.prepare(`INSERT INTO memo_doc
        (direction, tag_id, counterparty, custodian, status, due_date, created_at, updated_at)
        VALUES ('OUT',?,?,?,?, 'ISSUED',?,datetime('now','localtime'),datetime('now','localtime'))`).run(
        tag_id, counterparty || '', custodian || 'customer', due_date || null).lastInsertRowid
      holds.placeHold(db, { tag_id, kind: 'MEMO', source_type: 'memo', source_id: id, actor, reason: 'outbound approval stock' })
      audit.record(db, { actor, operation: 'MEMO.ISSUE', entity: 'memo', entity_id: id, business_date })
      return db.prepare(`SELECT * FROM memo_doc WHERE id=?`).get(id)
    }
    if (direction === 'IN') {
      if (!counterparty?.trim()) throw new Error('Supplier counterparty is required')
      const id = db.prepare(`INSERT INTO memo_doc
        (direction, tag_id, counterparty, custodian, status, due_date, created_at, updated_at)
        VALUES ('IN', NULL, ?, 'supplier', 'ISSUED', ?, datetime('now','localtime'), datetime('now','localtime'))`).run(
        counterparty, due_date || null).lastInsertRowid
      audit.record(db, { actor, operation: 'MEMO.INBOUND', entity: 'memo', entity_id: id, business_date })
      return db.prepare(`SELECT * FROM memo_doc WHERE id=?`).get(id)
    }
    throw new Error('Memo direction must be IN or OUT')
  })
  return tx()
}

function closeMemo({ id, outcome, actor, business_date }) {
  const db = get()
  const tx = db.transaction(() => {
    const m = db.prepare(`SELECT * FROM memo_doc WHERE id=?`).get(id)
    if (!m) throw new Error('Memo not found')
    if (m.status !== 'ISSUED' && m.status !== 'PARTIAL') throw new Error(`Memo is ${m.status}`)
    if (!['RETURNED', 'SOLD', 'ACQUIRED', 'PARTIAL'].includes(outcome)) throw new Error('Unknown memo outcome')
    db.prepare(`UPDATE memo_doc SET status=?, updated_at=datetime('now','localtime') WHERE id=?`).run(outcome, id)
    if (m.direction === 'OUT' && m.tag_id) {
      const h = db.prepare(`SELECT * FROM stock_hold WHERE kind='MEMO' AND source_id=? AND state='ACTIVE'`).get(id)
      if (h) db.prepare(`UPDATE stock_hold SET state=? WHERE id=?`).run(outcome === 'PARTIAL' ? 'ACTIVE' : outcome === 'SOLD' ? 'CONSUMED' : 'RELEASED', h.id)
    }
    // INBOUND acquire/sell conversions must go through purchase/tagging — this
    // records the decision; ownership changes only via those workflows (T11).
    audit.record(db, { actor, operation: `MEMO.${outcome}`, entity: 'memo', entity_id: id, business_date })
    return db.prepare(`SELECT * FROM memo_doc WHERE id=?`).get(id)
  })
  return tx()
}

function listMemos({ direction, status, page, pageSize } = {}) {
  const db = get()
  const clauses = []
  const args = {}
  if (direction) { clauses.push('direction=@dir'); args.dir = direction }
  if (status) { clauses.push('status=@status'); args.status = status }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''
  const total = db.prepare(`SELECT COUNT(*) n FROM memo_doc ${where}`).get(args).n
  const size = Math.max(10, Math.min(200, Math.trunc(Number(pageSize)) || 50))
  const pg = Math.max(1, Math.min(Math.max(1, Math.ceil(total / size)), Math.trunc(Number(page)) || 1))
  const rows = db.prepare(`SELECT m.*, ts.tag FROM memo_doc m LEFT JOIN tag_stock ts ON ts.id=m.tag_id
    ${where} ORDER BY m.id DESC LIMIT @limit OFFSET @offset`).all({ ...args, limit: size, offset: (pg - 1) * size })
  return { rows, page: pg, pageSize: size, total }
}

module.exports = { createReservation, setReservation, sweepReservations, listReservations, issueMemo, closeMemo, listMemos }
