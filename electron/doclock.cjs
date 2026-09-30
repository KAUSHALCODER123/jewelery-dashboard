/**
 * Two locks on saved money and stock documents, decided by the shop owner.
 *
 *  1. Same-day rule. Staff (any role but the owner) may edit or delete a saved
 *     document only on the day it is dated. The owner may change any day.
 *  2. Period lock. Once a day's Daily Closing is LOCKED, nothing dated that day
 *     may be created, edited or deleted, by anyone. The owner reopens the
 *     closing to allow changes again.
 *
 * The checks wrap the exported api methods (see install() at the bottom of
 * api.cjs), so they hold for the renderer, the phone view and parked bills
 * alike — anything enforced only in the page can be bypassed from devtools.
 * With nobody signed in (scripts, tests) the same-day rule has no staff to
 * apply to; the period lock applies regardless.
 */
const { get } = require('./db.cjs')
const { session } = require('./auth.cjs')

const pad = (n) => String(n).padStart(2, '0')
/** Today on the shop's clock (the pages date documents the same way). */
function localToday() {
  const d = new Date()
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}
/** The date api.cjs stamps on a document saved without one. */
const apiToday = () => new Date().toISOString().slice(0, 10)

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
function dmy(iso) {
  const [y, m, d] = String(iso || '').slice(0, 10).split('-')
  return y && m && d ? `${d}/${MONTHS[Number(m) - 1] ?? m}/${y}` : String(iso || '')
}

const head = (p) => (p && p.head) || {}
const flat = (p) => p || {}

/** Each kind of document: where it lives, its own date, and what a payload calls it. */
const DOCS = {
  sale:            { table: 'sale',             col: 'bill_date',    noun: 'bill',            fields: head },
  urd:             { table: 'urd_bill',         col: 'bill_date',    noun: 'old-gold bill',   fields: head },
  purchase:        { table: 'purchase',         col: 'invoice_date', noun: 'purchase',        fields: head },
  refinery:        { table: 'refinery',         col: 'invoice_date', noun: 'refinery entry',  fields: head },
  order:           { table: 'order_booking',    col: 'order_date',   noun: 'order',           fields: head },
  voucher:         { table: 'voucher',          col: 'voucher_date', noun: 'voucher',         fields: flat },
  saleReturn:      { table: 'sale_return',      col: 'return_date',  noun: 'return',          fields: head },
  purchaseReturn:  { table: 'purchase_return',  col: 'return_date',  noun: 'return',          fields: head },
  stockSettlement: { table: 'stock_settlement', col: 'settle_date',  noun: 'settlement',      fields: flat },
  karagirIssue:    { table: 'karagir_issue',    col: 'issue_date',   noun: 'karagir issue',   fields: flat },
  karagirReceive:  { table: 'karagir_receive',  col: 'receive_date', noun: 'karagir receipt', fields: flat },
}

/** api group → method → [what it does, which kind of document]. */
const METHODS = {
  sale: { save: ['save', 'sale'], remove: ['remove', 'sale'] },
  urd: { save: ['save', 'urd'], remove: ['remove', 'urd'] },
  purchase: { save: ['save', 'purchase'], remove: ['remove', 'purchase'] },
  refinery: { save: ['save', 'refinery'], remove: ['remove', 'refinery'] },
  order: { save: ['save', 'order'], remove: ['remove', 'order'] },
  voucher: { save: ['save', 'voucher'], remove: ['remove', 'voucher'] },
  saleReturn: { save: ['save', 'saleReturn'], remove: ['remove', 'saleReturn'] },
  purchaseReturn: { save: ['save', 'purchaseReturn'], remove: ['remove', 'purchaseReturn'] },
  stockSettlement: { save: ['save', 'stockSettlement'], remove: ['remove', 'stockSettlement'] },
  karagir: {
    issue: ['save', 'karagirIssue'], removeIssue: ['remove', 'karagirIssue'],
    receive: ['save', 'karagirReceive'], removeReceive: ['remove', 'karagirReceive'],
  },
}

/** Is this date inside a LOCKED Daily Closing? */
function isClosed(date) {
  if (!date) return false
  return !!get().prepare(
    `SELECT 1 FROM closing_session WHERE business_date = ? AND status = 'LOCKED' LIMIT 1`
  ).get(String(date).slice(0, 10))
}

function assertOpen(date) {
  if (isClosed(date)) {
    throw new Error(`${dmy(date)} is closed in Daily Closing — the owner must reopen it first.`)
  }
}

const isStaff = () => {
  const u = session.get()
  return !!u && u.role !== 'owner'
}

function storedDate(kind, id) {
  const d = DOCS[kind]
  if (!d || !id) return null
  const row = get().prepare(`SELECT ${d.col} AS dt FROM ${d.table} WHERE id = ?`).get(id)
  return row ? String(row.dt || '').slice(0, 10) : null
}

/**
 * Throw if the signed-in user may not make this change. `action` is 'save'
 * (create or edit) or 'remove'; `payload` is exactly what the api method takes.
 */
function assertChange(kind, action, payload) {
  const d = DOCS[kind]
  if (!d) return
  const f = action === 'remove' ? flat(payload) : d.fields(payload)
  const was = storedDate(kind, f.id)
  if (was) {
    if (isStaff() && was !== localToday()) {
      throw new Error(`Only the owner can change a ${d.noun} from an earlier day.`)
    }
    assertOpen(was)
  }
  // The day it lands on after saving must be open too (a new document, or an
  // edit that moves one onto another date).
  if (action === 'save') assertOpen(f[d.col] || apiToday())
}

/** For the pages: may the signed-in user edit or delete this saved document? */
function check({ kind, id } = {}) {
  try {
    const was = storedDate(kind, id)
    if (!was) return { editable: true, reason: '' }
    assertChange(kind, 'remove', { id })
    return { editable: true, reason: '' }
  } catch (e) {
    return { editable: false, reason: e.message }
  }
}

/** Wrap the exported api's document methods with the checks. Called once from api.cjs. */
function install(api) {
  for (const [group, methods] of Object.entries(METHODS)) {
    if (!api[group]) continue
    const wrapped = { ...api[group] }
    for (const [name, [action, kind]] of Object.entries(methods)) {
      const fn = api[group][name]
      if (typeof fn !== 'function') continue
      wrapped[name] = (payload) => {
        assertChange(kind, action, payload)
        return fn(payload)
      }
    }
    // Turning an order into a bill makes a new bill on its own date.
    if (group === 'order' && typeof api.order.toInvoice === 'function') {
      const toInvoice = api.order.toInvoice
      wrapped.toInvoice = (payload) => {
        assertOpen((payload && payload.bill_date) || apiToday())
        return toInvoice(payload)
      }
    }
    api[group] = wrapped
  }
  api.locks = { check }
  return api
}

module.exports = { install, check, assertChange, assertOpen, isClosed, localToday, DOCS }
