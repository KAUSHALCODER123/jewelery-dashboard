// T06 — persistent parked bills (drafts). Parking allocates no bill number,
// posts no ledger, reserves no stock. Finalize goes through normal sale.save.
const { get } = require('./db.cjs')
const audit = require('./audit.cjs')

const SCHEMA_VERSION = 1

function list({ owner, status, page, pageSize } = {}) {
  const db = get()
  const clauses = []
  const args = {}
  if (owner) { clauses.push('owner=@owner'); args.owner = owner }
  if (status) { clauses.push('status=@status'); args.status = status }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''
  const total = db.prepare(`SELECT COUNT(*) n FROM parked_bill ${where}`).get(args).n
  const size = Math.max(10, Math.min(200, Math.trunc(Number(pageSize)) || 50))
  const pg = Math.max(1, Math.min(Math.max(1, Math.ceil(total / size)), Math.trunc(Number(page)) || 1))
  const rows = db.prepare(`SELECT * FROM parked_bill ${where}
    ORDER BY updated_at DESC, id DESC LIMIT @limit OFFSET @offset`).all({ ...args, limit: size, offset: (pg - 1) * size })
  return { rows: rows.map(r => ({ ...r, draft: JSON.parse(r.draft_json || '{}') })), page: pg, pageSize: size, total }
}

function read({ id }) {
  const db = get()
  const r = db.prepare(`SELECT * FROM parked_bill WHERE id=?`).get(id)
  if (!r) return null
  return { ...r, draft: JSON.parse(r.draft_json || '{}') }
}

function park({ id, owner, branch, draft, revision, actor, business_date }) {
  const db = get()
  if (!draft || typeof draft !== 'object') throw new Error('Draft payload is required')
  // Never persist secrets.
  const clean = JSON.parse(JSON.stringify(draft))
  delete clean.password; delete clean.token; delete clean.secret
  const tx = db.transaction(() => {
    if (id) {
      const cur = db.prepare(`SELECT * FROM parked_bill WHERE id=?`).get(id)
      if (!cur) throw new Error('Parked bill not found')
      if (cur.status !== 'PARKED') throw new Error(`Draft is ${cur.status}`)
      if (revision != null && Number(revision) !== Number(cur.revision)) {
        throw new Error('Draft changed elsewhere — reload before saving')
      }
      db.prepare(`UPDATE parked_bill SET draft_json=?, revision=revision+1,
        updated_at=datetime('now','localtime') WHERE id=?`).run(JSON.stringify(clean).slice(0, 60000), id)
      audit.record(db, { actor, operation: 'PARKED_BILL.UPDATE', entity: 'parked_bill', entity_id: id, business_date })
      return read({ id })
    }
    const key = `park-${Date.now()}-${Math.floor(Math.random() * 1e6)}`
    const nid = db.prepare(`INSERT INTO parked_bill
      (owner, branch, schema_version, draft_json, revision, status, idempotency_key, created_at, updated_at)
      VALUES (?,?,?,?,?, 'PARKED', ?, datetime('now','localtime'), datetime('now','localtime'))`).run(
      owner || actor || '', branch || null, SCHEMA_VERSION, JSON.stringify(clean).slice(0, 60000), 1, key).lastInsertRowid
    audit.record(db, { actor, operation: 'PARKED_BILL.PARK', entity: 'parked_bill', entity_id: nid, business_date })
    return read({ id: nid })
  })
  return tx()
}

function discard({ id, actor, business_date }) {
  const db = get()
  const cur = db.prepare(`SELECT * FROM parked_bill WHERE id=?`).get(id)
  if (!cur) throw new Error('Parked bill not found')
  if (cur.status !== 'PARKED') throw new Error(`Draft is ${cur.status}`)
  // Discarding a draft changes no money or stock — status flip only.
  db.prepare(`UPDATE parked_bill SET status='DISCARDED', updated_at=datetime('now','localtime') WHERE id=?`).run(id)
  audit.record(db, { actor, operation: 'PARKED_BILL.DISCARD', entity: 'parked_bill', entity_id: id, business_date })
  return true
}

function markConverted(db, { id, saleId, key }) {
  db.prepare(`UPDATE parked_bill SET status='CONVERTED', sale_id=?, idempotency_key=?,
    updated_at=datetime('now','localtime') WHERE id=?`).run(saleId, key || null, id)
}

module.exports = { list, read, park, discard, markConverted, SCHEMA_VERSION }
