// T06 — persistent parked bills (drafts). Parking allocates no bill number,
// posts no ledger, reserves no stock. A parked bill becomes a sale only through
// finalize(), which runs the normal sale.save and marks the draft converted in
// the same transaction — so a draft can be billed once, however often Save is
// pressed or however many counters resume it.
const { get } = require('./db.cjs')
const audit = require('./audit.cjs')

const SCHEMA_VERSION = 1
// A bill with a hundred lines is ~60 KB. Refuse rather than cut: a truncated
// draft is invalid JSON and would take the whole list down with it.
const MAX_DRAFT = 512 * 1024

function parse(r) {
  let draft = {}
  try { draft = JSON.parse(r.draft_json || '{}') } catch { draft = { unreadable: true } }
  return { ...r, draft }
}

function summary(r) {
  const d = parse(r).draft
  const items = Array.isArray(d.items) ? d.items : []
  return {
    ...r, draft_json: undefined,
    party_name: d.head?.party_name || '', lines: items.length,
    gross_wt: items.reduce((s, i) => s + (Number(i.gross_wt) || 0), 0),
    item_names: [...new Set(items.map((i) => i.item_name).filter(Boolean))].slice(0, 4).join(', '),
  }
}

function list({ owner, status = 'PARKED', page, pageSize } = {}) {
  const db = get()
  const clauses = []
  const args = {}
  if (owner) { clauses.push('owner=@owner'); args.owner = owner }
  if (status && status !== 'ALL') { clauses.push('status=@status'); args.status = status }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''
  const total = db.prepare(`SELECT COUNT(*) n FROM parked_bill ${where}`).get(args).n
  const size = Math.max(10, Math.min(200, Math.trunc(Number(pageSize)) || 50))
  const pg = Math.max(1, Math.min(Math.max(1, Math.ceil(total / size)), Math.trunc(Number(page)) || 1))
  const rows = db.prepare(`SELECT * FROM parked_bill ${where}
    ORDER BY updated_at DESC, id DESC LIMIT @limit OFFSET @offset`).all({ ...args, limit: size, offset: (pg - 1) * size })
  // The list shows who and what, not the whole draft.
  return { rows: rows.map(summary), page: pg, pageSize: size, total }
}

function read({ id }) {
  const r = get().prepare(`SELECT * FROM parked_bill WHERE id=?`).get(id)
  return r ? parse(r) : null
}

function serialise(draft) {
  if (!draft || typeof draft !== 'object') throw new Error('Draft payload is required')
  const clean = JSON.parse(JSON.stringify(draft))
  // Never persist secrets.
  delete clean.password; delete clean.token; delete clean.secret
  const json = JSON.stringify(clean)
  if (json.length > MAX_DRAFT) throw new Error('This bill is too large to park — save it instead')
  return json
}

function park({ id, owner, branch, draft, revision, actor, business_date }) {
  const db = get()
  const json = serialise(draft)
  const tx = db.transaction(() => {
    if (id) {
      const cur = db.prepare(`SELECT * FROM parked_bill WHERE id=?`).get(id)
      if (!cur) throw new Error('Parked bill not found')
      if (cur.status !== 'PARKED') throw new Error(`This parked bill was already ${cur.status.toLowerCase()}`)
      if (revision != null && Number(revision) !== Number(cur.revision)) {
        throw new Error('This parked bill was changed on another counter — reopen it from the parked list')
      }
      db.prepare(`UPDATE parked_bill SET draft_json=?, revision=revision+1,
        updated_at=datetime('now','localtime') WHERE id=?`).run(json, id)
      audit.record(db, { actor, operation: 'PARKED_BILL.UPDATE', entity: 'parked_bill', entity_id: id, business_date })
      return id
    }
    const nid = db.prepare(`INSERT INTO parked_bill
      (owner, branch, schema_version, draft_json, revision, status, created_at, updated_at)
      VALUES (?,?,?,?,1, 'PARKED', datetime('now','localtime'), datetime('now','localtime'))`).run(
      owner || actor || '', branch || null, SCHEMA_VERSION, json).lastInsertRowid
    audit.record(db, { actor, operation: 'PARKED_BILL.PARK', entity: 'parked_bill', entity_id: nid, business_date })
    return nid
  })
  return read({ id: tx() })
}

function discard({ id, actor, business_date }) {
  const db = get()
  const cur = db.prepare(`SELECT * FROM parked_bill WHERE id=?`).get(id)
  if (!cur) throw new Error('Parked bill not found')
  if (cur.status !== 'PARKED') throw new Error(`This parked bill was already ${cur.status.toLowerCase()}`)
  // Discarding a draft changes no money or stock — status flip only.
  db.prepare(`UPDATE parked_bill SET status='DISCARDED', updated_at=datetime('now','localtime') WHERE id=?`).run(id)
  audit.record(db, { actor, operation: 'PARKED_BILL.DISCARD', entity: 'parked_bill', entity_id: id, business_date })
  return true
}

function markConverted(db, { id, saleId, key }) {
  db.prepare(`UPDATE parked_bill SET status='CONVERTED', sale_id=?, idempotency_key=?,
    updated_at=datetime('now','localtime') WHERE id=?`).run(saleId, key || null, id)
}

/**
 * Bill a parked draft. `sale` is the same payload sale.save takes. Returns the
 * sale ({ id, bill_no }); a draft that was already billed returns that bill
 * again with `already: true` instead of making a second one.
 */
function finalize({ id, revision, sale, actor, business_date }) {
  const db = get()
  const tx = db.transaction(() => {
    const cur = db.prepare(`SELECT * FROM parked_bill WHERE id=?`).get(id)
    if (!cur) throw new Error('Parked bill not found')
    if (cur.status === 'CONVERTED' && cur.sale_id) {
      const s = db.prepare(`SELECT id, bill_no FROM sale WHERE id=?`).get(cur.sale_id)
      if (s) return { ...s, already: true }
    }
    if (cur.status !== 'PARKED') throw new Error(`This parked bill was already ${cur.status.toLowerCase()}`)
    if (revision != null && Number(revision) !== Number(cur.revision)) {
      throw new Error('This parked bill was changed on another counter — reopen it from the parked list')
    }
    if (sale?.head?.id) throw new Error('A parked bill can only become a new bill')
    // Lazy: api.cjs requires erp.cjs, which requires this file.
    const res = require('./api.cjs').sale.save(sale)
    markConverted(db, { id, saleId: res.id, key: `parked-${id}-r${cur.revision}` })
    audit.record(db, { actor, operation: 'PARKED_BILL.CONVERT', entity: 'parked_bill', entity_id: id, business_date, after: { sale_id: res.id } })
    return res
  })
  return tx()
}

module.exports = { list, read, park, discard, finalize, markConverted, SCHEMA_VERSION }
