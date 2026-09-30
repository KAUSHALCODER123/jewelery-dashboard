// T05 — central saleability / custody helper. Additive holds, never an
// overloaded tag_stock.status. Used by lookup AND final sale save, transfers,
// adjustments, melting and returns.
const { get } = require('./db.cjs')

const SELLABLE_STATUS = new Set(['IN_STOCK'])

function holdsFor(db, tagId) {
  try {
    const has = db.prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name='stock_hold'`).get()
    if (!has) return []
    return db.prepare(`SELECT * FROM stock_hold WHERE tag_id=? AND state='ACTIVE'`).all(tagId)
  } catch { return [] }
}

// One backend helper: a shop tag is available only when its status permits
// sale AND it has no active conflicting hold. Customer repairs and supplier
// memo goods are separate custody identities (T10/T11), never saleable here.
function availability(db, tagRow) {
  if (!tagRow) return { saleable: false, reason: 'NOT_FOUND' }
  if (!SELLABLE_STATUS.has(tagRow.status)) return { saleable: false, reason: tagRow.status }
  const holds = holdsFor(db, tagRow.id)
  if (holds.length) {
    return { saleable: false, reason: 'ON_HOLD', holds: holds.map(h => ({ kind: h.kind, source: h.source_type })) }
  }
  return { saleable: true, reason: 'AVAILABLE' }
}

function assertSaleable(db, tagRow) {
  const a = availability(db, tagRow)
  if (!a.saleable) {
    const t = tagRow.tag || `#${tagRow.id}`
    throw new Error(`Tag ${t} cannot be sold (${a.reason})`)
  }
  return true
}

function placeHold(db, { tag_id, kind, source_type, source_id, actor, reason, expires_at }) {
  if (!tag_id) throw new Error('Hold needs a tag')
  if (!kind) throw new Error('Hold needs a kind')
  // Unique active-hold constraint: overlapping holds on the same tag conflict.
  const existing = db.prepare(
    `SELECT * FROM stock_hold WHERE tag_id=? AND kind=? AND state='ACTIVE'`).get(tag_id, kind)
  if (existing) throw new Error(`Tag already has an active ${kind} hold`)
  const id = db.prepare(`INSERT INTO stock_hold
    (tag_id, kind, source_type, source_id, state, actor, reason, expires_at, created_at)
    VALUES (?,?,?,?,'ACTIVE',?,?,?,datetime('now','localtime'))`).run(
    tag_id, kind, source_type || '', source_id == null ? null : Number(source_id),
    actor || '', reason || '', expires_at || null).lastInsertRowid
  db.prepare(`INSERT INTO custody_event (tag_id, kind, from_state, to_state, actor, reason, doc_type, doc_id, created_at)
    VALUES (?,'HOLD_PLACED','','ACTIVE',?,?,?, ?,datetime('now','localtime'))`).run(
    tag_id, actor || '', reason || '', source_type || '', source_id == null ? null : Number(source_id))
  return db.prepare(`SELECT * FROM stock_hold WHERE id=?`).get(id)
}

function releaseHold(db, { id, actor, reason }) {
  const h = db.prepare(`SELECT * FROM stock_hold WHERE id=?`).get(id)
  if (!h) throw new Error('Hold not found')
  if (h.state !== 'ACTIVE') throw new Error(`Hold is already ${h.state}`)
  db.prepare(`UPDATE stock_hold SET state='RELEASED', released_at=datetime('now','localtime') WHERE id=?`).run(id)
  db.prepare(`INSERT INTO custody_event (tag_id, kind, from_state, to_state, actor, reason, doc_type, doc_id, created_at)
    VALUES (?,'HOLD_RELEASED','ACTIVE','RELEASED',?,?,?, ?,datetime('now','localtime'))`).run(
    h.tag_id, actor || '', reason || '', h.source_type || '', h.source_id)
  return true
}

// Expired holds stop blocking even if the app was closed at expiry time. Two
// set-based statements: log every expiring hold, then expire them all. It runs
// inside a bill's save, so a failure must fail the save, not be swallowed.
const DUE = `state='ACTIVE' AND expires_at IS NOT NULL AND expires_at <> ''
  AND expires_at <= datetime('now','localtime')`
function sweepExpired(db, actor) {
  db.prepare(`INSERT INTO custody_event (tag_id, kind, from_state, to_state, actor, reason, doc_type, doc_id, created_at)
    SELECT tag_id, 'HOLD_EXPIRED', 'ACTIVE', 'EXPIRED', ?, 'expiry', source_type, source_id, datetime('now','localtime')
    FROM stock_hold WHERE ${DUE}`).run(actor || 'system')
  return db.prepare(`UPDATE stock_hold SET state='EXPIRED', released_at=datetime('now','localtime') WHERE ${DUE}`).run().changes
}

module.exports = { availability, assertSaleable, placeHold, releaseHold, sweepExpired, holdsFor }
