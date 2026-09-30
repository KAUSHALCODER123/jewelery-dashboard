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
const CLOSED = ['DELIVERED', 'CANCELLED']

/** The editable intake fields, cleaned the same way for create and update. */
function fields(p) {
  if (!String(p.customer_name || '').trim() && !p.customer_id) throw new Error('Customer is required')
  return {
    customer_id: Number(p.customer_id) || null, customer_name: String(p.customer_name || '').trim(),
    description: p.description || '', gross_wt: Number(p.gross_wt) || 0, net_wt: Number(p.net_wt) || 0,
    stone_details: p.stone_details || '', damage: p.damage || '', requested_work: p.requested_work || '',
    estimate: Number(p.estimate) || 0, promised_date: p.promised_date || null, karigar_id: Number(p.karigar_id) || null,
  }
}

function create(p = {}) {
  const db = get()
  const f = fields(p)
  return db.transaction(() => {
    const id = db.prepare(`INSERT INTO repair_job
      (customer_id, customer_name, description, gross_wt, net_wt, stone_details, damage, requested_work,
       estimate, promised_date, karigar_id, status, created_at, updated_at)
      VALUES (@customer_id, @customer_name, @description, @gross_wt, @net_wt, @stone_details, @damage, @requested_work,
       @estimate, @promised_date, @karigar_id, 'RECEIVED', datetime('now','localtime'), datetime('now','localtime'))`).run(f).lastInsertRowid
    db.prepare(`INSERT INTO repair_event (job_id, from_state, to_state, actor, note, created_at)
      VALUES (?,'','RECEIVED',?,'intake',datetime('now','localtime'))`).run(id, p.actor || '')
    audit.record(db, { actor: p.actor, operation: 'REPAIR.INTAKE', entity: 'repair', entity_id: id, business_date: p.business_date })
    return read({ id })
  })()
}

/** Correct the intake details. A delivered or cancelled job is history and stays as it was. */
function update(p = {}) {
  const db = get()
  const f = fields(p)
  return db.transaction(() => {
    const cur = db.prepare(`SELECT * FROM repair_job WHERE id=?`).get(p.id)
    if (!cur) throw new Error('Repair job not found')
    if (CLOSED.includes(cur.status)) throw new Error(`A ${cur.status.toLowerCase()} repair cannot be edited`)
    db.prepare(`UPDATE repair_job SET customer_id=@customer_id, customer_name=@customer_name, description=@description,
      gross_wt=@gross_wt, net_wt=@net_wt, stone_details=@stone_details, damage=@damage, requested_work=@requested_work,
      estimate=@estimate, promised_date=@promised_date, karigar_id=@karigar_id, updated_at=datetime('now','localtime')
      WHERE id=@id`).run({ ...f, id: cur.id })
    audit.record(db, { actor: p.actor, operation: 'REPAIR.EDIT', entity: 'repair', entity_id: cur.id,
      business_date: p.business_date, before: cur, after: f })
    return read({ id: cur.id })
  })()
}

const SELECT = `SELECT r.*, COALESCE(NULLIF(c.name,''), r.customer_name) customer_label, k.name karigar_name
  FROM repair_job r LEFT JOIN party c ON c.id=r.customer_id LEFT JOIN party k ON k.id=r.karigar_id`

function read({ id }) {
  const db = get()
  const head = db.prepare(`${SELECT} WHERE r.id=?`).get(id)
  if (!head) return null
  head.events = db.prepare(`SELECT * FROM repair_event WHERE job_id=? ORDER BY id`).all(id)
  head.attachments = db.prepare(`SELECT id, file_id, file_name, mime, size, created_at FROM repair_attachment WHERE job_id=? ORDER BY id`).all(id)
  return head
}

function list({ status, customer_id, overdue, search, page, pageSize } = {}) {
  const db = get()
  const clauses = []
  const args = {}
  if (status === 'OPEN') clauses.push(`r.status NOT IN ('DELIVERED','CANCELLED')`)
  else if (status) { clauses.push('r.status=@status'); args.status = status }
  if (customer_id) { clauses.push('r.customer_id=@cid'); args.cid = customer_id }
  if (overdue) clauses.push(`r.promised_date <> '' AND r.promised_date < date('now','localtime') AND r.status NOT IN ('DELIVERED','CANCELLED')`)
  const q = String(search || '').trim()
  if (q) {
    args.like = `%${q.replace(/[\\%_]/g, '\\$&')}%`
    args.qid = Number(q.replace(/^#/, '')) || -1
    clauses.push(`(r.id=@qid OR r.customer_name LIKE @like ESCAPE '\\' OR c.name LIKE @like ESCAPE '\\'
      OR r.description LIKE @like ESCAPE '\\')`)
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''
  const total = db.prepare(`SELECT COUNT(*) n FROM repair_job r LEFT JOIN party c ON c.id=r.customer_id ${where}`).get(args).n
  const size = Math.max(10, Math.min(200, Math.trunc(Number(pageSize)) || 50))
  const pg = Math.max(1, Math.min(Math.max(1, Math.ceil(total / size)), Math.trunc(Number(page)) || 1))
  // Open jobs first, the soonest promise at the top; jobs with no promise date after those that have one.
  const rows = db.prepare(`${SELECT} ${where}
    ORDER BY CASE WHEN r.status IN ('DELIVERED','CANCELLED') THEN 1 ELSE 0 END,
      COALESCE(r.promised_date,'') = '', r.promised_date, r.id DESC
    LIMIT @limit OFFSET @offset`).all({ ...args, limit: size, offset: (pg - 1) * size })
  return { rows, page: pg, pageSize: size, total }
}

function transition({ id, to, actor, note, karigar_id, business_date }) {
  const db = get()
  return db.transaction(() => {
    const cur = db.prepare(`SELECT * FROM repair_job WHERE id=?`).get(id)
    if (!cur) throw new Error('Repair job not found')
    if (!STATES.includes(to)) throw new Error('Unknown repair state')
    if (!NEXT[cur.status]?.includes(to)) throw new Error(`Cannot move ${cur.status} → ${to}`)
    const karigar = Number(karigar_id) || cur.karigar_id || null
    if (to === 'ASSIGNED' && !karigar) throw new Error('Choose the karigar the job is assigned to')
    db.prepare(`UPDATE repair_job SET status=?, karigar_id=?, updated_at=datetime('now','localtime') WHERE id=?`)
      .run(to, karigar, id)
    db.prepare(`INSERT INTO repair_event (job_id, from_state, to_state, actor, note, created_at)
      VALUES (?,?,?,?,?,datetime('now','localtime'))`).run(id, cur.status, to, actor || '', note || '')
    audit.record(db, { actor, operation: `REPAIR.${to}`, entity: 'repair', entity_id: id, business_date, reason: note })
    return read({ id })
  })()
}

// Records metadata for a file already held in managed storage. Nothing in the
// app stores the file itself yet, so the Repairs page does not offer uploads.
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

module.exports = { create, update, read, list, transition, addAttachment, STATES, NEXT }
