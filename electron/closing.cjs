// T08 — daily closing + manual payment settlement matching.
// Matching links existing movements; it never posts a second receipt.
const { get } = require('./db.cjs')
const audit = require('./audit.cjs')

function fingerprint(db, business_date) {
  // Source-set fingerprint: counts + sums of authoritative event tables.
  const q = (sql, p) => { try { return db.prepare(sql).get(p) } catch { return {} } }
  const sale = q(`SELECT COUNT(*) n, COALESCE(SUM(total_amount),0) v FROM sale WHERE bill_date=?`, business_date)
  const vch = q(`SELECT COUNT(*) n, COALESCE(SUM(amount),0) v FROM voucher WHERE voucher_date=?`, business_date)
  const urd = q(`SELECT COUNT(*) n, COALESCE(SUM(amount_given),0) v FROM urd_bill WHERE bill_date=?`, business_date)
  return JSON.stringify({ sale, vch, urd })
}

function expectedCash(db, business_date) {
  // Approved opening cash + cash inflows − cash outflows within business date.
  // Purchases on credit do not reduce cash; non-cash old-gold exchange is not
  // a cash receipt. Voucher payment_type distinguishes cash legs.
  const cashIn = db.prepare(`SELECT COALESCE(SUM(amount),0) v FROM voucher
    WHERE voucher_date=? AND kind='RECEIPT' AND (payment_type='Cash' OR payment_type IS NULL OR payment_type='')`).get(business_date).v
  const cashOut = db.prepare(`SELECT COALESCE(SUM(amount),0) v FROM voucher
    WHERE voucher_date=? AND kind='PAYMENT' AND (payment_type='Cash' OR payment_type IS NULL OR payment_type='')`).get(business_date).v
  const cashSales = db.prepare(`SELECT COALESCE(SUM(amount_received),0) v FROM sale WHERE bill_date=?`).get(business_date).v
  const opening = db.prepare(`SELECT opening_balance v FROM account WHERE name='Cash Account'`).get()?.v || 0
  return { opening: Number(opening) || 0, cashIn: Number(cashIn) || 0, cashOut: Number(cashOut) || 0, cashSales: Number(cashSales) || 0, expected: (Number(opening) || 0) + (Number(cashIn) || 0) + (Number(cashSales) || 0) - (Number(cashOut) || 0) }
}

function open({ business_date, branch, actor }) {
  const db = get()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(business_date || '')) throw new Error('Business date is required')
  const ex = db.prepare(`SELECT * FROM closing_session WHERE business_date=? AND COALESCE(branch,'')=COALESCE(?, '') AND status IN ('DRAFT','SUBMITTED')`).get(business_date, branch || null)
  if (ex) return read({ id: ex.id })
  const exp = expectedCash(db, business_date)
  const fp = fingerprint(db, business_date)
  const id = db.prepare(`INSERT INTO closing_session
    (business_date, branch, state_or_status, status, revision, source_fingerprint, expected_cash, counted_cash, variance, created_at, updated_at)
    VALUES (?,?, 'DRAFT','DRAFT', 1, ?, ?, NULL, NULL, datetime('now','localtime'), datetime('now','localtime'))`).run(
    business_date, branch || null, fp, exp.expected).lastInsertRowid
  audit.record(db, { actor, operation: 'CLOSING.OPEN', entity: 'closing', entity_id: id, business_date })
  return read({ id })
}

function read({ id }) {
  const db = get()
  const head = db.prepare(`SELECT * FROM closing_session WHERE id=?`).get(id)
  if (!head) return null
  head.counts = db.prepare(`SELECT * FROM closing_count WHERE session_id=? ORDER BY id`).all(id)
  head.matches = db.prepare(`SELECT * FROM settlement_match WHERE session_id=? ORDER BY id`).all(id)
  head.expected = expectedCash(db, head.business_date)
  return head
}

function list({ from, to, status, page, pageSize } = {}) {
  const db = get()
  const clauses = []
  const args = {}
  if (from) { clauses.push('business_date>=@from'); args.from = from }
  if (to) { clauses.push('business_date<=@to'); args.to = to }
  if (status) { clauses.push('status=@status'); args.status = status }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''
  const total = db.prepare(`SELECT COUNT(*) n FROM closing_session ${where}`).get(args).n
  const size = Math.max(10, Math.min(200, Math.trunc(Number(pageSize)) || 50))
  const pg = Math.max(1, Math.min(Math.max(1, Math.ceil(total / size)), Math.trunc(Number(page)) || 1))
  const rows = db.prepare(`SELECT * FROM closing_session ${where}
    ORDER BY business_date DESC, id DESC LIMIT @limit OFFSET @offset`).all({ ...args, limit: size, offset: (pg - 1) * size })
  return { rows, page: pg, pageSize: size, total }
}

function saveCount({ session_id, denomination, qty, amount, actor, business_date }) {
  const db = get()
  const s = db.prepare(`SELECT * FROM closing_session WHERE id=?`).get(session_id)
  if (!s) throw new Error('Closing session not found')
  if (s.status !== 'DRAFT') throw new Error(`Session is ${s.status}`)
  if (denomination) {
    db.prepare(`DELETE FROM closing_count WHERE session_id=? AND denomination=?`).run(session_id, denomination)
    db.prepare(`INSERT INTO closing_count (session_id, denomination, qty, amount) VALUES (?,?,?,?)`).run(
      session_id, denomination, Number(qty) || 0, (Number(denomination) || 0) * (Number(qty) || 0))
  } else {
    db.prepare(`DELETE FROM closing_count WHERE session_id=? AND denomination IS NULL`).run(session_id)
    db.prepare(`INSERT INTO closing_count (session_id, denomination, qty, amount) VALUES (?,?,?,?)`).run(
      session_id, null, 1, Number(amount) || 0)
  }
  const counted = db.prepare(`SELECT COALESCE(SUM(amount),0) v FROM closing_count WHERE session_id=?`).get(session_id).v
  const exp = expectedCash(db, s.business_date)
  db.prepare(`UPDATE closing_session SET counted_cash=?, variance=?-?, updated_at=datetime('now','localtime') WHERE id=?`).run(counted, counted, exp.expected, session_id)
  audit.record(db, { actor, operation: 'CLOSING.COUNT', entity: 'closing', entity_id: session_id, business_date })
  return read({ id: session_id })
}

// Manual settlement matching: allocate settlement net to source events.
function matchSettlement({ session_id, settlement_ref, provider, allocations, actor, business_date }) {
  const db = get()
  const tx = db.transaction(() => {
    const s = db.prepare(`SELECT * FROM closing_session WHERE id=?`).get(session_id)
    if (!s) throw new Error('Closing session not found')
    if (s.status !== 'DRAFT' && s.status !== 'SUBMITTED') throw new Error(`Session is ${s.status}`)
    const allocs = Array.isArray(allocations) ? allocations : []
    if (!allocs.length) throw new Error('At least one allocation is required')
    const dup = db.prepare(`SELECT 1 FROM payment_settlement WHERE provider_ref=?`).get(settlement_ref)
    if (dup) throw new Error('Duplicate provider reference — already matched')
    const total = allocs.reduce((t, a) => t + (Number(a.amount) || 0), 0)
    if (total <= 0) throw new Error('Allocation total must be positive')
    const sid = db.prepare(`INSERT INTO payment_settlement
      (provider, provider_ref, settle_date, gross, fees, net, created_at)
      VALUES (?,?,date('now','localtime'),?,?,?,datetime('now','localtime'))`).run(
      provider || '', settlement_ref, total, 0, total).lastInsertRowid
    const ins = db.prepare(`INSERT INTO settlement_match
      (session_id, settlement_id, source_type, source_id, amount) VALUES (?,?,?,?,?)`)
    for (const a of allocs) {
      if (!a.source_type || !a.source_id || !(Number(a.amount) > 0)) throw new Error('Each allocation needs source_type, source_id and a positive amount')
      ins.run(session_id, sid, a.source_type, Number(a.source_id), Number(a.amount))
    }
    audit.record(db, { actor, operation: 'CLOSING.MATCH', entity: 'closing', entity_id: session_id, business_date })
    return sid
  })
  return tx()
}

function submit({ id, actor, business_date }) {
  const db = get()
  const s = db.prepare(`SELECT * FROM closing_session WHERE id=?`).get(id)
  if (!s) throw new Error('Closing session not found')
  if (s.status !== 'DRAFT') throw new Error(`Session is ${s.status}`)
  // Sign-off cannot silently absorb a changed source set.
  const now = fingerprint(db, s.business_date)
  if (now !== s.source_fingerprint) throw new Error('Source documents changed since this close was opened — review before submitting')
  db.prepare(`UPDATE closing_session SET status='SUBMITTED', updated_at=datetime('now','localtime') WHERE id=?`).run(id)
  audit.record(db, { actor, operation: 'CLOSING.SUBMIT', entity: 'closing', entity_id: id, business_date })
  return read({ id })
}

function approve({ id, actor, note, business_date }) {
  const db = get()
  const s = db.prepare(`SELECT * FROM closing_session WHERE id=?`).get(id)
  if (!s) throw new Error('Closing session not found')
  if (s.status !== 'SUBMITTED') throw new Error(`Session is ${s.status}`)
  const now = fingerprint(db, s.business_date)
  if (now !== s.source_fingerprint) throw new Error('Source documents changed — reopen and recount')
  db.prepare(`UPDATE closing_session SET status='LOCKED', approved_by=?, approve_note=?, updated_at=datetime('now','localtime') WHERE id=?`).run(actor || '', note || '', id)
  audit.record(db, { actor, operation: 'CLOSING.LOCK', entity: 'closing', entity_id: id, business_date })
  return read({ id })
}

function reopen({ id, actor, reason, business_date }) {
  const db = get()
  const s = db.prepare(`SELECT * FROM closing_session WHERE id=?`).get(id)
  if (!s) throw new Error('Closing session not found')
  if (s.status !== 'LOCKED' && s.status !== 'SUBMITTED') throw new Error(`Session is ${s.status}`)
  if (!reason?.trim()) throw new Error('A reason is required to reopen a close')
  db.prepare(`UPDATE closing_session SET status='DRAFT', revision=revision+1,
    source_fingerprint=?, reopen_reason=?, updated_at=datetime('now','localtime') WHERE id=?`).run(
    fingerprint(db, s.business_date), reason, id)
  audit.record(db, { actor, operation: 'CLOSING.REOPEN', entity: 'closing', entity_id: id, business_date, reason })
  return read({ id })
}

module.exports = { open, read, list, saveCount, matchSettlement, submit, approve, reopen, expectedCash }
