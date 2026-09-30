// T12 — hallmarking batches. Pieces away carry a HALLMARK hold and cannot be
// sold; fees post once via existing voucher mechanisms (recorded reference).
//
// A piece's outcome moves PENDING → DISPATCHED → RETURNED | FAILED | REWORK.
// RETURNED and FAILED pieces are back in the shop and their hold is released.
// REWORK pieces are still at the centre: they keep the hold, stay outstanding,
// and are received again later — so a batch closes only when nothing is out.
const { get } = require('./db.cjs')
const holds = require('./availability.cjs')
const audit = require('./audit.cjs')

const STATES = ['PREPARED', 'DISPATCHED', 'PARTIAL', 'CLOSED', 'CANCELLED']
const OUTSTANDING = ['PENDING', 'DISPATCHED', 'REWORK']
const HUID = /^[A-Z0-9]{6}$/

function event(db, id, from, to, actor, note) {
  db.prepare(`INSERT INTO hallmark_event (batch_id, from_state, to_state, actor, note, created_at)
    VALUES (?,?,?,?,?,datetime('now','localtime'))`).run(id, from, to, actor || '', note || '')
}

function create({ centre, tag_ids, actor, business_date }) {
  const db = get()
  const name = String(centre || '').trim()
  if (!name) throw new Error('Assaying centre is required')
  const ids = [...new Set((tag_ids || []).map(Number).filter(Boolean))]
  if (!ids.length) throw new Error('At least one tag is required')
  const tagQ = db.prepare(`SELECT * FROM tag_stock WHERE id=?`)
  // A piece already on an open batch (prepared, or still out at a centre) cannot join another.
  const openQ = db.prepare(`SELECT b.id FROM hallmark_item i JOIN hallmark_batch b ON b.id=i.batch_id
    WHERE i.tag_id=? AND b.status IN ('PREPARED','DISPATCHED','PARTIAL')
      AND i.outcome IN ('PENDING','DISPATCHED','REWORK') LIMIT 1`)
  return db.transaction(() => {
    for (const tid of ids) {
      const tag = tagQ.get(tid)
      const a = holds.availability(db, tag)
      if (!a.saleable) throw new Error(`Tag ${tag?.tag || '#' + tid} is not available (${a.reason})`)
      const open = openQ.get(tid)
      if (open) throw new Error(`Tag ${tag.tag} is already on hallmark batch #${open.id}`)
    }
    const bid = db.prepare(`INSERT INTO hallmark_batch (centre, status, created_at, updated_at)
      VALUES (?, 'PREPARED', datetime('now','localtime'), datetime('now','localtime'))`).run(name).lastInsertRowid
    const ins = db.prepare(`INSERT INTO hallmark_item (batch_id, tag_id, outcome) VALUES (?,?, 'PENDING')`)
    for (const tid of ids) ins.run(bid, tid)
    event(db, bid, '', 'PREPARED', actor, `${ids.length} pieces`)
    audit.record(db, { actor, operation: 'HALLMARK.CREATE', entity: 'hallmark', entity_id: bid, business_date })
    return read({ id: bid })
  })()
}

function read({ id }) {
  const db = get()
  const head = db.prepare(`SELECT * FROM hallmark_batch WHERE id=?`).get(id)
  if (!head) return null
  head.items = db.prepare(`SELECT hi.*, ts.tag, ts.huid AS tag_huid, ts.net_wt, ts.gross_wt, ts.status AS tag_status,
      i.name AS item_name
    FROM hallmark_item hi
    LEFT JOIN tag_stock ts ON ts.id=hi.tag_id
    LEFT JOIN item i ON i.id=ts.item_id
    WHERE hi.batch_id=? ORDER BY hi.id`).all(id)
  head.events = db.prepare(`SELECT * FROM hallmark_event WHERE batch_id=? ORDER BY id`).all(id)
  return head
}

function list({ status, page, pageSize } = {}) {
  const db = get()
  const where = status ? `WHERE b.status=@status` : ''
  const args = status ? { status } : {}
  const total = db.prepare(`SELECT COUNT(*) n FROM hallmark_batch b ${where}`).get(args).n
  const size = Math.max(10, Math.min(200, Math.trunc(Number(pageSize)) || 50))
  const pg = Math.max(1, Math.min(Math.max(1, Math.ceil(total / size)), Math.trunc(Number(page)) || 1))
  const rows = db.prepare(`SELECT b.*,
      (SELECT COUNT(*) FROM hallmark_item i WHERE i.batch_id=b.id) pieces,
      (SELECT COUNT(*) FROM hallmark_item i WHERE i.batch_id=b.id AND i.outcome IN ('PENDING','DISPATCHED','REWORK')) outstanding
    FROM hallmark_batch b ${where} ORDER BY b.id DESC LIMIT @limit OFFSET @offset`).all(
    { ...args, limit: size, offset: (pg - 1) * size })
  return { rows, page: pg, pageSize: size, total }
}

function dispatch({ id, actor, business_date }) {
  const db = get()
  return db.transaction(() => {
    const b = db.prepare(`SELECT * FROM hallmark_batch WHERE id=?`).get(id)
    if (!b) throw new Error('Batch not found')
    if (b.status !== 'PREPARED') throw new Error(`Batch is ${b.status}`)
    const items = db.prepare(`SELECT hi.id AS item_id, ts.id, ts.tag, ts.status FROM hallmark_item hi
      JOIN tag_stock ts ON ts.id=hi.tag_id WHERE hi.batch_id=?`).all(id)
    const mark = db.prepare(`UPDATE hallmark_item SET outcome='DISPATCHED' WHERE id=?`)
    for (const it of items) {
      // Sold or reserved since the batch was prepared: it cannot leave the shop.
      holds.assertSaleable(db, it)
      holds.placeHold(db, { tag_id: it.id, kind: 'HALLMARK', source_type: 'hallmark', source_id: id, actor, reason: 'sent for hallmarking' })
      mark.run(it.item_id)
    }
    db.prepare(`UPDATE hallmark_batch SET status='DISPATCHED', updated_at=datetime('now','localtime') WHERE id=?`).run(id)
    event(db, id, 'PREPARED', 'DISPATCHED', actor)
    audit.record(db, { actor, operation: 'HALLMARK.DISPATCH', entity: 'hallmark', entity_id: id, business_date })
    return read({ id })
  })()
}

/** A prepared batch has not left the shop, so it can simply be called off. */
function cancel({ id, actor, business_date }) {
  const db = get()
  return db.transaction(() => {
    const b = db.prepare(`SELECT * FROM hallmark_batch WHERE id=?`).get(id)
    if (!b) throw new Error('Batch not found')
    if (b.status !== 'PREPARED') throw new Error('Only a batch that has not been dispatched can be cancelled')
    db.prepare(`UPDATE hallmark_batch SET status='CANCELLED', updated_at=datetime('now','localtime') WHERE id=?`).run(id)
    event(db, id, 'PREPARED', 'CANCELLED', actor)
    audit.record(db, { actor, operation: 'HALLMARK.CANCEL', entity: 'hallmark', entity_id: id, business_date })
    return read({ id })
  })()
}

function receive({ id, receipts, actor, business_date }) {
  // receipts: [{tag_id, outcome: RETURNED|FAILED|REWORK, huid, return_wt}]
  const db = get()
  const itemQ = db.prepare(`SELECT hi.*, ts.tag, ts.huid AS tag_huid FROM hallmark_item hi
    JOIN tag_stock ts ON ts.id=hi.tag_id WHERE hi.batch_id=? AND hi.tag_id=?`)
  const dupQ = db.prepare(`SELECT tag FROM tag_stock WHERE huid=? COLLATE NOCASE AND id<>?`)
  const holdQ = db.prepare(`SELECT id FROM stock_hold WHERE kind='HALLMARK' AND source_id=? AND tag_id=? AND state='ACTIVE'`)
  const setItem = db.prepare(`UPDATE hallmark_item SET outcome=?, huid=COALESCE(?, huid), return_wt=COALESCE(?, return_wt) WHERE id=?`)
  const setHuid = db.prepare(`UPDATE tag_stock SET huid=? WHERE id=?`)
  return db.transaction(() => {
    const b = db.prepare(`SELECT * FROM hallmark_batch WHERE id=?`).get(id)
    if (!b) throw new Error('Batch not found')
    if (!['DISPATCHED', 'PARTIAL'].includes(b.status)) throw new Error(`Batch is ${b.status}`)
    if (!receipts?.length) throw new Error('Nothing to receive')

    // Check every line before writing any of them.
    const seen = new Set()
    const lines = receipts.map((r) => {
      const it = itemQ.get(id, r.tag_id)
      if (!it) throw new Error(`Tag #${r.tag_id} is not in this batch`)
      if (!['DISPATCHED', 'REWORK'].includes(it.outcome)) throw new Error(`Tag ${it.tag} is already ${it.outcome.toLowerCase()}`)
      if (!['RETURNED', 'FAILED', 'REWORK'].includes(r.outcome)) throw new Error('Unknown hallmark outcome')
      const huid = r.outcome === 'RETURNED' ? String(r.huid || '').trim().toUpperCase() : ''
      if (huid) {
        if (!HUID.test(huid)) throw new Error(`HUID for ${it.tag} must be 6 letters or digits`)
        if (seen.has(huid)) throw new Error(`HUID ${huid} is entered twice`)
        seen.add(huid)
        const dup = dupQ.get(huid, r.tag_id)
        if (dup) throw new Error(`HUID ${huid} is already on ${dup.tag} — check the centre's report`)
      } else if (r.outcome === 'RETURNED' && !it.tag_huid) {
        throw new Error(`Enter the HUID the centre gave ${it.tag}`)
      }
      const rw = r.return_wt === '' || r.return_wt == null ? null : Number(r.return_wt)
      if (rw != null && !(rw >= 0)) throw new Error(`Return weight for ${it.tag} must be a number`)
      return { it, r, huid, rw }
    })

    for (const { it, r, huid, rw } of lines) {
      setItem.run(r.outcome, huid || null, rw, it.id)
      if (huid) setHuid.run(huid, r.tag_id)
      if (r.outcome !== 'REWORK') {
        const h = holdQ.get(id, r.tag_id)
        if (h) holds.releaseHold(db, { id: h.id, actor, reason: `hallmark ${r.outcome.toLowerCase()}` })
      }
    }
    const left = db.prepare(`SELECT COUNT(*) n FROM hallmark_item WHERE batch_id=? AND outcome IN (${OUTSTANDING.map(() => '?').join(',')})`)
      .get(id, ...OUTSTANDING).n
    const next = left === 0 ? 'CLOSED' : 'PARTIAL'
    db.prepare(`UPDATE hallmark_batch SET status=?, updated_at=datetime('now','localtime') WHERE id=?`).run(next, id)
    event(db, id, b.status, next, actor, `${lines.length} received`)
    audit.record(db, { actor, operation: 'HALLMARK.RECEIVE', entity: 'hallmark', entity_id: id, business_date })
    return read({ id })
  })()
}

module.exports = { create, read, list, dispatch, cancel, receive, STATES }
