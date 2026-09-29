// T12 — hallmarking batches. Pieces away carry a HALLMARK hold and cannot be
// sold; fees post once via existing voucher mechanisms (recorded reference).
const { get } = require('./db.cjs')
const holds = require('./availability.cjs')
const audit = require('./audit.cjs')

const STATES = ['PREPARED', 'DISPATCHED', 'PARTIAL', 'CLOSED', 'CANCELLED']

function create({ centre, tag_ids, actor, business_date }) {
  const db = get()
  const ids = [...new Set((tag_ids || []).map(Number).filter(Boolean))]
  if (!ids.length) throw new Error('At least one tag is required')
  const tx = db.transaction(() => {
    const bid = db.prepare(`INSERT INTO hallmark_batch
      (centre, status, created_at, updated_at) VALUES (?, 'PREPARED', datetime('now','localtime'), datetime('now','localtime'))`).run(
      centre || '').lastInsertRowid
    const ins = db.prepare(`INSERT INTO hallmark_item (batch_id, tag_id, outcome) VALUES (?,?, 'PENDING')`)
    for (const tid of ids) {
      const tag = db.prepare(`SELECT * FROM tag_stock WHERE id=?`).get(tid)
      if (!tag || tag.status !== 'IN_STOCK') throw new Error(`Tag #${tid} is not in stock`)
      ins.run(bid, tid)
    }
    audit.record(db, { actor, operation: 'HALLMARK.CREATE', entity: 'hallmark', entity_id: bid, business_date })
    return read({ id: bid })
  })
  return tx()
}

function read({ id }) {
  const db = get()
  const head = db.prepare(`SELECT * FROM hallmark_batch WHERE id=?`).get(id)
  if (!head) return null
  head.items = db.prepare(`SELECT hi.*, ts.tag, ts.huid FROM hallmark_item hi
    LEFT JOIN tag_stock ts ON ts.id=hi.tag_id WHERE hi.batch_id=? ORDER BY hi.id`).all(id)
  head.events = db.prepare(`SELECT * FROM hallmark_event WHERE batch_id=? ORDER BY id`).all(id)
  return head
}

function list({ status, page, pageSize } = {}) {
  const db = get()
  const where = status ? `WHERE status=@status` : ''
  const total = db.prepare(`SELECT COUNT(*) n FROM hallmark_batch ${where}`).get(status ? { status } : {}).n
  const size = Math.max(10, Math.min(200, Math.trunc(Number(pageSize)) || 50))
  const pg = Math.max(1, Math.min(Math.max(1, Math.ceil(total / size)), Math.trunc(Number(page)) || 1))
  const rows = db.prepare(`SELECT b.*, (SELECT COUNT(*) FROM hallmark_item i WHERE i.batch_id=b.id) pieces
    FROM hallmark_batch b ${where} ORDER BY b.id DESC LIMIT @limit OFFSET @offset`).all(
    { ...(status ? { status } : {}), limit: size, offset: (pg - 1) * size })
  return { rows, page: pg, pageSize: size, total }
}

function dispatch({ id, actor, business_date }) {
  const db = get()
  const tx = db.transaction(() => {
    const b = db.prepare(`SELECT * FROM hallmark_batch WHERE id=?`).get(id)
    if (!b) throw new Error('Batch not found')
    if (b.status !== 'PREPARED') throw new Error(`Batch is ${b.status}`)
    const items = db.prepare(`SELECT * FROM hallmark_item WHERE batch_id=?`).all(id)
    for (const it of items) {
      holds.placeHold(db, { tag_id: it.tag_id, kind: 'HALLMARK', source_type: 'hallmark', source_id: id, actor, reason: 'sent for hallmarking' })
      db.prepare(`UPDATE hallmark_item SET outcome='DISPATCHED' WHERE id=?`).run(it.id)
    }
    db.prepare(`UPDATE hallmark_batch SET status='DISPATCHED', updated_at=datetime('now','localtime') WHERE id=?`).run(id)
    db.prepare(`INSERT INTO hallmark_event (batch_id, from_state, to_state, actor, note, created_at)
      VALUES (?, 'PREPARED','DISPATCHED', ?, '', datetime('now','localtime'))`).run(id, actor || '')
    audit.record(db, { actor, operation: 'HALLMARK.DISPATCH', entity: 'hallmark', entity_id: id, business_date })
    return read({ id })
  })
  return tx()
}

function receive({ id, receipts, actor, business_date }) {
  // receipts: [{tag_id, outcome: RETURNED|FAILED|REWORK, huid, return_wt}]
  const db = get()
  const tx = db.transaction(() => {
    const b = db.prepare(`SELECT * FROM hallmark_batch WHERE id=?`).get(id)
    if (!b) throw new Error('Batch not found')
    if (!['DISPATCHED', 'PARTIAL'].includes(b.status)) throw new Error(`Batch is ${b.status}`)
    for (const r of receipts || []) {
      const it = db.prepare(`SELECT * FROM hallmark_item WHERE batch_id=? AND tag_id=?`).get(id, r.tag_id)
      if (!it) throw new Error(`Tag #${r.tag_id} is not in this batch`)
      if (!['RETURNED', 'FAILED', 'REWORK'].includes(r.outcome)) throw new Error('Unknown hallmark outcome')
      db.prepare(`UPDATE hallmark_item SET outcome=?, huid=COALESCE(?, huid), return_wt=COALESCE(?, return_wt) WHERE id=?`).run(
        r.outcome, r.huid || null, r.return_wt == null ? null : Number(r.return_wt), it.id)
      if (r.huid) {
        const dup = db.prepare(`SELECT id FROM tag_stock WHERE huid=? COLLATE NOCASE AND id<>?`).get(String(r.huid).trim(), r.tag_id)
        if (dup) throw new Error(`HUID ${r.huid} already exists on another piece — flagged for investigation`)
        db.prepare(`UPDATE tag_stock SET huid=? WHERE id=?`).run(String(r.huid).trim(), r.tag_id)
      }
      if (r.outcome !== 'REWORK') {
        const h = db.prepare(`SELECT * FROM stock_hold WHERE kind='HALLMARK' AND source_id=? AND tag_id=? AND state='ACTIVE'`).get(id, r.tag_id)
        if (h) db.prepare(`UPDATE stock_hold SET state='RELEASED', released_at=datetime('now','localtime') WHERE id=?`).run(h.id)
      }
    }
    const pending = db.prepare(`SELECT COUNT(*) n FROM hallmark_item WHERE batch_id=? AND outcome IN ('PENDING','DISPATCHED')`).get(id).n
    const returned = db.prepare(`SELECT COUNT(*) n FROM hallmark_item WHERE batch_id=? AND outcome='RETURNED'`).get(id).n
    const next = pending === 0 ? 'CLOSED' : returned > 0 ? 'PARTIAL' : b.status
    db.prepare(`UPDATE hallmark_batch SET status=?, updated_at=datetime('now','localtime') WHERE id=?`).run(next, id)
    db.prepare(`INSERT INTO hallmark_event (batch_id, from_state, to_state, actor, note, created_at)
      VALUES (?,?,?,?,?,datetime('now','localtime'))`).run(id, b.status, next, actor || '', `${(receipts || []).length} items received`)
    audit.record(db, { actor, operation: 'HALLMARK.RECEIVE', entity: 'hallmark', entity_id: id, business_date })
    return read({ id })
  })
  return tx()
}

module.exports = { create, read, list, dispatch, receive, STATES }
