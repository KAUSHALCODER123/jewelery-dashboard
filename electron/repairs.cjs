// T10 — customer repair register. Customer articles are a separate custody
// identity: never saleable shop stock, never loose_stock metal.
const { get } = require('./db.cjs')
const audit = require('./audit.cjs')

const STATES = ['RECEIVED', 'ASSESSED', 'ASSIGNED', 'IN_PROGRESS', 'READY', 'DELIVERED', 'CANCELLED']
const NEXT = {
  RECEIVED: ['ASSESSED', 'CANCELLED'], ASSESSED: ['ASSIGNED', 'CANCELLED'],
  ASSIGNED: ['IN_PROGRESS', 'CANCELLED'], IN_PROGRESS: ['READY', 'CANCELLED'],
  READY: ['DELIVERED', 'CANCELLED'], DELIVERED: [], CANCELLED: [],
}

function create({ customer_id, customer_name, description, gross_wt, net_wt, stone_details, damage, requested_work, estimate, promised_date, actor, business_date }) {
  const db = get()
  if (!customer_name?.trim() && !customer_id) throw new Error('Customer is required')
  const tx = db.transaction(() => {
    const id = db.prepare(`INSERT INTO repair_job
      (customer_id, customer_name, description, gross_wt, net_wt, stone_details, damage, requested_work,
       estimate, promised_date, status, created_at, updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?, 'RECEIVED', datetime('now','localtime'), datetime('now','localtime'))`).run(
      customer_id || null, customer_name || '', description || '', Number(gross_wt) || 0, Number(net_wt) || 0,
      stone_details || '', damage || '', requested_work || '', Number(estimate) || 0, promised_date || null).lastInsertRowid
    db.prepare(`INSERT INTO repair_event (job_id, from_state, to_state, actor, note, created_at)
      VALUES (?,'','RECEIVED',?,'intake',datetime('now','localtime'))`).run(id, actor || '')
    audit.record(db, { actor, operation: 'REPAIR.INTAKE', entity: 'repair', entity_id: id, business_date })
    return read({ id })
  })
  return tx()
}

function read({ id }) {
  const db = get()
  const head = db.prepare(`SELECT * FROM repair_job WHERE id=?`).get(id)
  if (!head) return null
  head.events = db.prepare(`SELECT * FROM repair_event WHERE job_id=? ORDER BY id`).all(id)
  head.attachments = db.prepare(`SELECT id, file_id, file_name, mime, size, created_at FROM repair_attachment WHERE job_id=? ORDER BY id`).all(id)
  return head
}

function list({ status, customer_id, overdue, page, pageSize } = {}) {
  const db = get()
  const clauses = []
  const args = {}
  if (status) { clauses.push('status=@status'); args.status = status }
  if (customer_id) { clauses.push('customer_id=@cid'); args.cid = customer_id }
  if (overdue) { clauses.push(`promised_date <> '' AND promised_date < date('now','localtime') AND status NOT IN ('DELIVERED','CANCELLED')`) }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''
  const total = db.prepare(`SELECT COUNT(*) n FROM repair_job ${where}`).get(args).n
  const size = Math.max(10, Math.min(200, Math.trunc(Number(pageSize)) || 50))
  const pg = Math.max(1, Math.min(Math.max(1, Math.ceil(total / size)), Math.trunc(Number(page)) || 1))
  const rows = db.prepare(`SELECT * FROM repair_job ${where}
    ORDER BY CASE WHEN status IN ('DELIVERED','CANCELLED') THEN 1 ELSE 0 END, promised_date, id DESC
    LIMIT @limit OFFSET @offset`).all({ ...args, limit: size, offset: (pg - 1) * size })
  return { rows, page: pg, pageSize: size, total }
}

function transition({ id, to, actor, note, karigar_id, business_date }) {
  const db = get()
  const tx = db.transaction(() => {
    const cur = db.prepare(`SELECT * FROM repair_job WHERE id=?`).get(id)
    if (!cur) throw new Error('Repair job not found')
    if (!STATES.includes(to)) throw new Error('Unknown repair state')
    if (!NEXT[cur.status]?.includes(to)) throw new Error(`Cannot move ${cur.status} → ${to}`)
    db.prepare(`UPDATE repair_job SET status=?, karigar_id=COALESCE(?, karigar_id),
      updated_at=datetime('now','localtime') WHERE id=?`).run(to, karigar_id || null, id)
    db.prepare(`INSERT INTO repair_event (job_id, from_state, to_state, actor, note, created_at)
      VALUES (?,?,?,?,?,datetime('now','localtime'))`).run(id, cur.status, to, actor || '', note || '')
    audit.record(db, { actor, operation: `REPAIR.${to}`, entity: 'repair', entity_id: id, business_date })
    return read({ id })
  })
  return tx()
}

function addAttachment({ job_id, file_id, file_name, mime, size, actor }) {
  const db = get()
  if (!/^[\w\-.]{1,64}$/.test(file_id || '')) throw new Error('Invalid managed file id')
  if ((Number(size) || 0) > 8 * 1024 * 1024) throw new Error('Attachment exceeds 8 MB')
  if (!/^(image\/jpeg|image\/png|image\/webp|application\/pdf)$/.test(mime || '')) throw new Error('Only JPG, PNG, WebP or PDF attachments')
  db.prepare(`INSERT INTO repair_attachment (job_id, file_id, file_name, mime, size, created_at)
    VALUES (?,?,?,?,?,datetime('now','localtime'))`).run(job_id, file_id, file_name || '', mime, Number(size) || 0)
  audit.record(db, { actor, operation: 'REPAIR.ATTACH', entity: 'repair', entity_id: job_id })
  return true
}

module.exports = { create, read, list, transition, addAttachment, STATES }
