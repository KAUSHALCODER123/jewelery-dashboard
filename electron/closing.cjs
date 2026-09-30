// T08 — daily closing + manual payment settlement matching.
// Matching links existing movements; it never posts a second receipt.
//
// Expected cash is the Cash Book's closing for the day — the same ledger the
// cash book, day book and trial balance read — so the three can never disagree.
const { get } = require('./db.cjs')
const audit = require('./audit.cjs')

const DENOMINATIONS = [2000, 500, 200, 100, 50, 20, 10, 5, 2, 1]

function cashBook(business_date) {
  // Lazy: api.cjs requires erp.cjs, which requires this file.
  return require('./api.cjs').reports.cashBook({ from: business_date, to: business_date })
}

function expectedCash(_db, business_date) {
  const cb = cashBook(business_date)
  if (!cb) return { opening: 0, cashIn: 0, cashOut: 0, expected: 0, entries: [] }
  return {
    opening: cb.opening, cashIn: cb.totalDebit, cashOut: cb.totalCredit,
    expected: cb.closing, entries: cb.rows,
  }
}

/**
 * Everything the day's figures rest on: every ledger posting dated that day
 * (a new, edited or deleted bill, receipt, purchase or return changes the
 * count, the sums or the highest id) and the cash carried in from before it.
 */
function fingerprint(db, business_date) {
  const day = db.prepare(`SELECT COUNT(*) n, COALESCE(SUM(debit),0) dr, COALESCE(SUM(credit),0) cr,
    COALESCE(MAX(id),0) last FROM ledger_entry WHERE entry_date=?`).get(business_date)
  const opening = cashBook(business_date)?.opening ?? 0
  return JSON.stringify({ ...day, dr: Math.round(day.dr * 100), cr: Math.round(day.cr * 100), opening: Math.round(opening * 100) })
}

function sessionRow(db, id) {
  const s = db.prepare(`SELECT * FROM closing_session WHERE id=?`).get(id)
  if (!s) throw new Error('Closing session not found')
  return s
}

function open({ business_date, branch, actor }) {
  const db = get()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(business_date || '')) throw new Error('Business date is required')
  // One close per day: a day already closed (or in progress) opens as it is.
  const ex = db.prepare(`SELECT id FROM closing_session
    WHERE business_date=? AND COALESCE(branch,'')=COALESCE(?, '') ORDER BY id DESC LIMIT 1`).get(business_date, branch || null)
  if (ex) return read({ id: ex.id })
  const exp = expectedCash(db, business_date)
  const id = db.prepare(`INSERT INTO closing_session
    (business_date, branch, state_or_status, status, revision, source_fingerprint, expected_cash, counted_cash, variance, created_at, updated_at)
    VALUES (?,?, 'DRAFT','DRAFT', 1, ?, ?, NULL, NULL, datetime('now','localtime'), datetime('now','localtime'))`).run(
    business_date, branch || null, fingerprint(db, business_date), exp.expected).lastInsertRowid
  audit.record(db, { actor, operation: 'CLOSING.OPEN', entity: 'closing', entity_id: id, business_date })
  return read({ id })
}

/** Non-cash money received that day (bank, card, UPI) — what a settlement is matched against. */
function nonCash(db, business_date, session_id) {
  return db.prepare(`
    SELECT l.doc_type, l.doc_id, l.doc_no, a.name AS account, SUM(l.debit) AS amount,
           COALESCE((SELECT SUM(m.amount) FROM settlement_match m
                      WHERE m.source_type = l.doc_type AND m.source_id = l.doc_id), 0) AS matched,
           COALESCE((SELECT SUM(m.amount) FROM settlement_match m
                      WHERE m.session_id = @sid AND m.source_type = l.doc_type AND m.source_id = l.doc_id), 0) AS matched_here
    FROM ledger_entry l JOIN account a ON a.id = l.account_id
    WHERE l.entry_date = @date AND a.acc_type = 'Bank' AND l.debit > 0 AND l.doc_id IS NOT NULL
    GROUP BY l.doc_type, l.doc_id, l.doc_no, a.name
    ORDER BY l.doc_type, l.doc_no`).all({ date: business_date, sid: session_id })
}

function read({ id }) {
  const db = get()
  const head = db.prepare(`SELECT * FROM closing_session WHERE id=?`).get(id)
  if (!head) return null
  head.counts = db.prepare(`SELECT * FROM closing_count WHERE session_id=? ORDER BY denomination IS NULL, denomination DESC`).all(id)
  head.matches = db.prepare(`SELECT m.*, p.provider, p.provider_ref, p.net, p.settle_date
    FROM settlement_match m LEFT JOIN payment_settlement p ON p.id = m.settlement_id
    WHERE m.session_id=? ORDER BY m.id`).all(id)
  head.expected = expectedCash(db, head.business_date)
  head.non_cash = nonCash(db, head.business_date, id)
  // Live, so a bill entered after counting shows up at once.
  head.live_variance = head.counted_cash == null ? null
    : Math.round((head.counted_cash - head.expected.expected) * 100) / 100
  head.stale = fingerprint(db, head.business_date) !== head.source_fingerprint
  head.denominations = DENOMINATIONS
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

function writeTotals(db, s) {
  const counted = db.prepare(`SELECT COALESCE(SUM(amount),0) v FROM closing_count WHERE session_id=?`).get(s.id).v
  const exp = expectedCash(db, s.business_date).expected
  db.prepare(`UPDATE closing_session SET counted_cash=?, expected_cash=?, variance=?,
    updated_at=datetime('now','localtime') WHERE id=?`).run(counted, exp, Math.round((counted - exp) * 100) / 100, s.id)
}

/**
 * The whole cash count in one go: notes and coins by denomination, plus any
 * loose amount counted without a denomination. Replaces the previous count.
 */
function saveCounts({ session_id, counts, other, actor, business_date }) {
  const db = get()
  const tx = db.transaction(() => {
    const s = sessionRow(db, session_id)
    if (s.status !== 'DRAFT') throw new Error(`Closing is ${s.status} — reopen it to recount`)
    db.prepare(`DELETE FROM closing_count WHERE session_id=?`).run(session_id)
    const ins = db.prepare(`INSERT INTO closing_count (session_id, denomination, qty, amount) VALUES (?,?,?,?)`)
    for (const c of Array.isArray(counts) ? counts : []) {
      const d = Number(c.denomination), q = Math.trunc(Number(c.qty))
      if (!(d > 0)) throw new Error('Denomination must be positive')
      if (!(q >= 0)) throw new Error('Note / coin count cannot be negative')
      if (q) ins.run(session_id, d, q, Math.round(d * q * 100) / 100)
    }
    const o = Number(other) || 0
    if (o < 0) throw new Error('Other cash cannot be negative')
    if (o) ins.run(session_id, null, 1, Math.round(o * 100) / 100)
    writeTotals(db, s)
    // Counting is done against the figures on screen: a recount takes in any
    // bill entered since the close was opened.
    db.prepare(`UPDATE closing_session SET source_fingerprint=? WHERE id=?`).run(fingerprint(db, s.business_date), session_id)
    audit.record(db, { actor, operation: 'CLOSING.COUNT', entity: 'closing', entity_id: session_id, business_date: s.business_date || business_date })
  })
  tx()
  return read({ id: session_id })
}

/** One line of the count (kept for older callers; saveCounts is the batch form). */
function saveCount({ session_id, denomination, qty, amount, actor, business_date }) {
  const db = get()
  const tx = db.transaction(() => {
    const s = sessionRow(db, session_id)
    if (s.status !== 'DRAFT') throw new Error(`Closing is ${s.status} — reopen it to recount`)
    if (denomination) {
      db.prepare(`DELETE FROM closing_count WHERE session_id=? AND denomination=?`).run(session_id, denomination)
      db.prepare(`INSERT INTO closing_count (session_id, denomination, qty, amount) VALUES (?,?,?,?)`).run(
        session_id, denomination, Number(qty) || 0, (Number(denomination) || 0) * (Number(qty) || 0))
    } else {
      db.prepare(`DELETE FROM closing_count WHERE session_id=? AND denomination IS NULL`).run(session_id)
      db.prepare(`INSERT INTO closing_count (session_id, denomination, qty, amount) VALUES (?,?,?,?)`).run(
        session_id, null, 1, Number(amount) || 0)
    }
    writeTotals(db, s)
    audit.record(db, { actor, operation: 'CLOSING.COUNT', entity: 'closing', entity_id: session_id, business_date })
  })
  tx()
  return read({ id: session_id })
}

/**
 * Manual settlement matching: a provider's settlement (card batch, UPI payout)
 * allocated to the day's non-cash receipts it pays out. Allocations name a
 * ledger document (source_type = doc_type, source_id = doc_id) and can never
 * exceed what that document actually received into the bank.
 */
function matchSettlement({ session_id, settlement_ref, provider, fees, allocations, actor, business_date }) {
  const db = get()
  const tx = db.transaction(() => {
    const s = sessionRow(db, session_id)
    if (s.status !== 'DRAFT' && s.status !== 'SUBMITTED') throw new Error(`Closing is ${s.status}`)
    const ref = String(settlement_ref || '').trim()
    if (!ref) throw new Error('Provider reference / UTR is required')
    const allocs = Array.isArray(allocations) ? allocations.filter((a) => Number(a.amount) > 0) : []
    if (!allocs.length) throw new Error('Allocate the settlement to at least one receipt')
    if (db.prepare(`SELECT 1 FROM payment_settlement WHERE provider_ref=?`).get(ref)) {
      throw new Error('This provider reference is already matched')
    }
    const open = new Map(nonCash(db, s.business_date, session_id).map((r) => [`${r.doc_type}:${r.doc_id}`, r]))
    let total = 0
    for (const a of allocs) {
      const src = open.get(`${a.source_type}:${Number(a.source_id)}`)
      if (!src) throw new Error(`${a.source_type} #${a.source_id} is not a non-cash receipt of ${s.business_date}`)
      if (Number(a.amount) > src.amount - src.matched + 0.005) {
        throw new Error(`${src.doc_no || a.source_type}: only ₹${(src.amount - src.matched).toFixed(2)} is left to match`)
      }
      total += Number(a.amount)
    }
    const fee = Math.max(0, Number(fees) || 0)
    const sid = db.prepare(`INSERT INTO payment_settlement
      (provider, provider_ref, settle_date, gross, fees, net, created_at)
      VALUES (?,?,?,?,?,?,datetime('now','localtime'))`).run(
      String(provider || '').trim(), ref, s.business_date, total, fee, Math.round((total - fee) * 100) / 100).lastInsertRowid
    const ins = db.prepare(`INSERT INTO settlement_match
      (session_id, settlement_id, source_type, source_id, amount) VALUES (?,?,?,?,?)`)
    for (const a of allocs) ins.run(session_id, sid, a.source_type, Number(a.source_id), Number(a.amount))
    audit.record(db, { actor, operation: 'CLOSING.MATCH', entity: 'closing', entity_id: session_id, business_date })
    return sid
  })
  tx()
  return read({ id: session_id })
}

function submit({ id, actor, business_date }) {
  const db = get()
  const tx = db.transaction(() => {
    const s = sessionRow(db, id)
    if (s.status !== 'DRAFT') throw new Error(`Closing is ${s.status}`)
    if (s.counted_cash == null) throw new Error('Count the cash before submitting')
    // Sign-off cannot silently absorb a changed source set.
    if (fingerprint(db, s.business_date) !== s.source_fingerprint) {
      throw new Error('Entries for this day changed since the close was opened — reopen and recount')
    }
    writeTotals(db, s)
    db.prepare(`UPDATE closing_session SET status='SUBMITTED', updated_at=datetime('now','localtime') WHERE id=?`).run(id)
    audit.record(db, { actor, operation: 'CLOSING.SUBMIT', entity: 'closing', entity_id: id, business_date })
  })
  tx()
  return read({ id })
}

function approve({ id, actor, note, business_date }) {
  const db = get()
  const s = sessionRow(db, id)
  if (s.status !== 'SUBMITTED') throw new Error(`Closing is ${s.status}`)
  if (fingerprint(db, s.business_date) !== s.source_fingerprint) throw new Error('Entries for this day changed — reopen and recount')
  if (Math.abs(Number(s.variance) || 0) >= 0.01 && !String(note || '').trim()) {
    throw new Error('Explain the variance in the approval note')
  }
  db.prepare(`UPDATE closing_session SET status='LOCKED', approved_by=?, approve_note=?,
    updated_at=datetime('now','localtime') WHERE id=?`).run(actor || '', note || '', id)
  audit.record(db, { actor, operation: 'CLOSING.LOCK', entity: 'closing', entity_id: id, business_date, reason: note })
  return read({ id })
}

function reopen({ id, actor, reason, business_date }) {
  const db = get()
  const s = sessionRow(db, id)
  if (s.status !== 'LOCKED' && s.status !== 'SUBMITTED') throw new Error(`Closing is ${s.status}`)
  if (!reason?.trim()) throw new Error('A reason is required to reopen a close')
  db.prepare(`UPDATE closing_session SET status='DRAFT', revision=revision+1,
    source_fingerprint=?, reopen_reason=?, updated_at=datetime('now','localtime') WHERE id=?`).run(
    fingerprint(db, s.business_date), reason.trim(), id)
  writeTotals(db, s)
  audit.record(db, { actor, operation: 'CLOSING.REOPEN', entity: 'closing', entity_id: id, business_date, reason })
  return read({ id })
}

module.exports = { open, read, list, saveCount, saveCounts, matchSettlement, submit, approve, reopen, expectedCash, DENOMINATIONS }
