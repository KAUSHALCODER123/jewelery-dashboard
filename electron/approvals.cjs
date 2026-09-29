// T05 — approval requests: requested → approved/rejected/cancelled.
// Execution checks entity version + exact proposed payload hash; approval and
// mutation commit atomically via the caller's transaction.
const crypto = require('node:crypto')
const { get } = require('./db.cjs')

const hash = (v) => crypto.createHash('sha256').update(JSON.stringify(v ?? null)).digest('hex')

function request({ action, entity, entity_id, payload, version, requester, reason, business_date }) {
  const db = get()
  if (!action || !entity) throw new Error('Approval needs an action and entity')
  const id = db.prepare(`INSERT INTO approval_request
    (action, entity, entity_id, payload_json, payload_hash, target_version, status, requester, reason, business_date, requested_at)
    VALUES (?,?,?,?,?,?, 'REQUESTED',?,?,?,datetime('now','localtime'))`).run(
    action, entity, entity_id == null ? null : Number(entity_id) || null,
    JSON.stringify(payload ?? null).slice(0, 12000), hash(payload),
    version == null ? null : Number(version),
    requester || '', reason || '', business_date || null,
  ).lastInsertRowid
  return db.prepare(`SELECT * FROM approval_request WHERE id=?`).get(id)
}

function decide({ id, approve, reviewer, note }) {
  const db = get()
  const tx = db.transaction(() => {
    const r = db.prepare(`SELECT * FROM approval_request WHERE id=?`).get(id)
    if (!r) throw new Error('Approval request not found')
    if (r.status !== 'REQUESTED') throw new Error(`Request is already ${r.status}`)
    if (reviewer && r.requester && String(reviewer).toLowerCase() === String(r.requester).toLowerCase()) {
      const cfg = db.prepare(`SELECT value FROM settings WHERE key='approval_no_self'`).get()
      if (!cfg || cfg.value !== '0') throw new Error('Self-approval is not allowed')
    }
    db.prepare(`UPDATE approval_request SET status=?, reviewer=?, review_note=?,
      decided_at=datetime('now','localtime') WHERE id=?`).run(
      approve ? 'APPROVED' : 'REJECTED', reviewer || '', note || '', id)
    return db.prepare(`SELECT * FROM approval_request WHERE id=?`).get(id)
  })
  return tx()
}

function cancel({ id, actor }) {
  const db = get()
  const r = db.prepare(`SELECT * FROM approval_request WHERE id=?`).get(id)
  if (!r) throw new Error('Approval request not found')
  if (r.status !== 'REQUESTED') throw new Error(`Request is already ${r.status}`)
  db.prepare(`UPDATE approval_request SET status='CANCELLED', reviewer=?, decided_at=datetime('now','localtime') WHERE id=?`).run(actor || '', id)
  return true
}

// Verify an approval is still valid for the current entity version + payload.
function checkValid(db, { id, entity, entity_id, payload, version }) {
  const r = db.prepare(`SELECT * FROM approval_request WHERE id=?`).get(id)
  if (!r) throw new Error('Approval request not found')
  if (r.status !== 'APPROVED') throw new Error('Approval is not in APPROVED state')
  if (r.entity !== entity || Number(r.entity_id) !== Number(entity_id)) throw new Error('Approval target mismatch')
  if (r.payload_hash !== hash(payload)) throw new Error('Proposed payload changed — approval no longer valid')
  if (r.target_version != null && version != null && Number(r.target_version) !== Number(version)) {
    throw new Error('Entity changed since approval — re-request approval')
  }
  return r
}

function markExecuted(db, id) {
  db.prepare(`UPDATE approval_request SET status='EXECUTED', decided_at=COALESCE(decided_at, datetime('now','localtime')) WHERE id=?`).run(id)
}

function list({ status, entity, page, pageSize } = {}) {
  const db = get()
  const clauses = []
  const args = {}
  if (status) { clauses.push('status=@status'); args.status = status }
  if (entity) { clauses.push('entity=@entity'); args.entity = entity }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''
  const total = db.prepare(`SELECT COUNT(*) n FROM approval_request ${where}`).get(args).n
  const size = Math.max(10, Math.min(200, Math.trunc(Number(pageSize)) || 50))
  const pg = Math.max(1, Math.min(Math.max(1, Math.ceil(total / size)), Math.trunc(Number(page)) || 1))
  const rows = db.prepare(`SELECT * FROM approval_request ${where}
    ORDER BY id DESC LIMIT @limit OFFSET @offset`).all({ ...args, limit: size, offset: (pg - 1) * size })
  return { rows, page: pg, pageSize: size, total }
}

module.exports = { request, decide, cancel, checkValid, markExecuted, list, hash }
