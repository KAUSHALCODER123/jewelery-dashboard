// T05 — append-only application audit. Written inside the caller's
// transaction so a failed mutation leaves neither a posting nor a success audit.
const { get } = require('./db.cjs')

function record(db, { actor, operation, entity, entity_id, business_date, reason, before, after, correlation }) {
  try {
    db.prepare(`INSERT INTO audit_event
      (actor, operation, entity, entity_id, business_date, event_time, reason, before_json, after_json, correlation_id)
      VALUES (?,?,?,?,?,datetime('now','localtime'),?,?,?,?)`).run(
      actor || '', operation || '', entity || '', entity_id == null ? null : Number(entity_id) || null,
      business_date || null, reason || '',
      before == null ? null : JSON.stringify(before).slice(0, 8000),
      after == null ? null : JSON.stringify(after).slice(0, 8000),
      correlation || null,
    )
  } catch { /* audit must never break the mutation itself */ }
}

function list({ entity, entity_id, operation, from, to, page, pageSize } = {}) {
  const db = get()
  const clauses = []
  const args = {}
  if (entity) { clauses.push('entity=@entity'); args.entity = entity }
  if (entity_id != null && entity_id !== '') { clauses.push('entity_id=@entity_id'); args.entity_id = Number(entity_id) }
  if (operation) { clauses.push('operation=@operation'); args.operation = operation }
  if (from) { clauses.push('date(event_time)>=@from'); args.from = from }
  if (to) { clauses.push('date(event_time)<=@to'); args.to = to }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''
  const total = db.prepare(`SELECT COUNT(*) n FROM audit_event ${where}`).get(args).n
  const size = Math.max(10, Math.min(200, Math.trunc(Number(pageSize)) || 50))
  const pg = Math.max(1, Math.min(Math.max(1, Math.ceil(total / size)), Math.trunc(Number(page)) || 1))
  const rows = db.prepare(`SELECT * FROM audit_event ${where}
    ORDER BY id DESC LIMIT @limit OFFSET @offset`).all({ ...args, limit: size, offset: (pg - 1) * size })
  return { rows, page: pg, pageSize: size, total }
}

module.exports = { record, list }
