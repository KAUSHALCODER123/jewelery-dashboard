// ERP plan integration module (T01–T15). Keeps new domain APIs in one place so
// shared-file integration (api.cjs / main.cjs / preload) stays serializable.
const { get } = require('./db.cjs')
const calc = require('./calc.cjs')
const inventory = require('./inventory.cjs')
const audit = require('./audit.cjs')
const approvals = require('./approvals.cjs')
const availability = require('./availability.cjs')
const parkedBills = require('./parkedBills.cjs')
const stockCounts = require('./stockCounts.cjs')
const closing = require('./closing.cjs')
const repairs = require('./repairs.cjs')
const custody = require('./custody.cjs')
const hallmarking = require('./hallmarking.cjs')
const catalogue = require('./catalogue.cjs')

const num = calc.num

function paginate({ total, page, pageSize }) {
  const size = Math.max(10, Math.min(200, Math.trunc(Number(pageSize)) || 50))
  const pages = Math.max(1, Math.ceil(total / size) || 1)
  const pg = Math.max(1, Math.min(pages, Math.trunc(Number(page)) || 1))
  return { page: pg, pageSize: size, offset: (pg - 1) * size, total }
}

// Which tables carry a status column. The schema cannot change under a
// running app, so this is asked once per table rather than once per page.
const statusCols = new Map()
const hasStatus = (db, table) => {
  if (!statusCols.has(table))
    statusCols.set(table, db.prepare(`PRAGMA table_info(${table})`).all().some(c => c.name === 'status'))
  return statusCols.get(table)
}

// Generic document pager: shared predicate → count and totals → page.
function docPage({ table, dateCol, searchCols, extraWhere, params = {}, totalsCol }) {
  const db = get()
  const clauses = []
  const args = {}
  if (params.from) { clauses.push(`${dateCol}>=@from`); args.from = params.from }
  if (params.to) { clauses.push(`${dateCol}<=@to`); args.to = params.to }
  // Only applied when the table actually carries a status column.
  if (params.status && params.status !== 'ALL' && hasStatus(db, table)) {
    clauses.push(`status=@status`); args.status = params.status
  }
  if (params.search?.trim()) {
    clauses.push(`(${searchCols.map(c => `${c} LIKE '%'||@search||'%'`).join(' OR ')})`)
    args.search = params.search.trim()
  }
  if (extraWhere) clauses.push(extraWhere)
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''
  // One pass gives both the count the pager needs and the totals row.
  const agg = db.prepare(`SELECT COUNT(*) n, ${totalsCol ? `COALESCE(SUM(${totalsCol}),0)` : '0'} v FROM ${table} ${where}`).get(args)
  const pg = paginate({ total: agg.n, page: params.page, pageSize: params.pageSize })
  const rows = db.prepare(`SELECT * FROM ${table} ${where}
    ORDER BY ${dateCol} DESC, id DESC LIMIT @limit OFFSET @offset`).all({ ...args, limit: pg.pageSize, offset: pg.offset })
  return { rows, ...pg, totals: totalsCol ? agg : undefined }
}

const docs = {
  salePage: (p = {}) => docPage({ table: 'sale', dateCol: 'bill_date', searchCols: ['bill_no', 'party_name', 'mobile'], params: p, totalsCol: 'total_amount' }),
  urdPage: (p = {}) => docPage({ table: 'urd_bill', dateCol: 'bill_date', searchCols: ['bill_no', 'party_name'], params: p, totalsCol: 'amount_given' }),
  purchasePage: (p = {}) => docPage({ table: 'purchase', dateCol: 'invoice_date', searchCols: ['invoice_no', 'party_name'], params: p, totalsCol: 'bill_amount' }),
  refineryPage: (p = {}) => docPage({ table: 'refinery', dateCol: 'invoice_date', searchCols: ['invoice_no', 'party_name'], params: p, totalsCol: 'bill_amount' }),
  orderPage: (p = {}) => docPage({ table: 'order_booking', dateCol: 'order_date', searchCols: ['order_no', 'party_name'], params: p, totalsCol: 'total_amount' }),
  voucherPage: (p = {}) => docPage({ table: 'voucher', dateCol: 'voucher_date', searchCols: ['voucher_no', 'party_name', 'narration'], params: p, totalsCol: 'amount' }),
  saleReturnPage: (p = {}) => docPage({ table: 'sale_return', dateCol: 'return_date', searchCols: ['return_no', 'party_name'], params: p, totalsCol: 'total_amount' }),
  purchaseReturnPage: (p = {}) => docPage({ table: 'purchase_return', dateCol: 'return_date', searchCols: ['return_no', 'party_name'], params: p, totalsCol: 'total_amount' }),
  settlementPage: (p = {}) => docPage({ table: 'stock_settlement', dateCol: 'settle_date', searchCols: ['settle_no', 'party_name'], params: p, totalsCol: 'bill_amount' }),
}

// Ranked billing search with paging (T03): exact tag/HUID first, then
// substring, stable id tie-break. Preserves loose-item lookup on the caller.
function tagSearchPaged({ q, includeSold = false, page, pageSize } = {}) {
  const db = get()
  const needle = String(q || '').trim()
  if (!needle) return { rows: [], page: 1, pageSize: 50, total: 0 }
  const like = `%${needle.replace(/[\\%_]/g, '\\$&')}%`
  const where = `(ts.tag LIKE @like ESCAPE '\\' OR ts.huid LIKE @like ESCAPE '\\' OR i.name LIKE @like ESCAPE '\\')
    AND (@inc = 1 OR ts.status='IN_STOCK')`
  const total = db.prepare(`SELECT COUNT(*) n FROM tag_stock ts JOIN item i ON i.id=ts.item_id WHERE ${where}`).get({ like, inc: includeSold ? 1 : 0 }).n
  const pg = paginate({ total, page, pageSize })
  const rows = db.prepare(`SELECT ts.id, ts.tag, ts.gross_wt, ts.net_wt, ts.stone_wt, ts.purity,
      ts.mkg_per_gm, ts.hallmark_charges, ts.huid, ts.qty, ts.location, ts.status,
      i.id AS item_id, i.name AS item_name, i.hsn
    FROM tag_stock ts JOIN item i ON i.id=ts.item_id
    WHERE ${where}
    ORDER BY CASE WHEN ts.tag=@exact COLLATE NOCASE OR ts.huid=@exact COLLATE NOCASE THEN 0 ELSE 1 END,
      i.name COLLATE NOCASE, ts.tag COLLATE NOCASE, ts.id
    LIMIT @limit OFFSET @offset`).all({ like, inc: includeSold ? 1 : 0, exact: needle, limit: pg.pageSize, offset: pg.offset })
  return { rows, ...pg }
}

// T09 — corrected dashboard: tagged stock split by metal; loose pools separate;
// today's money separates invoiced sales, collections, refunds, cash and
// unsettled digital; alerts carry real routes with matching predicates.
function dashboardV2({ business_date } = {}) {
  const db = get()
  const t = business_date || new Date().toISOString().slice(0, 10)
  const monthStart = t.slice(0, 8) + '01'
  const todaySales = db.prepare(`SELECT COALESCE(SUM(total_amount),0) v, COUNT(*) n FROM sale WHERE bill_date=?`).get(t)
  const monthSales = db.prepare(`SELECT COALESCE(SUM(total_amount),0) v, COUNT(*) n FROM sale WHERE bill_date>=?`).get(monthStart)
  const collections = db.prepare(`SELECT COALESCE(SUM(amount),0) v, COUNT(*) n FROM voucher WHERE voucher_date=? AND kind='RECEIPT'`).get(t)
  const refunds = db.prepare(`SELECT COALESCE(SUM(refund_amount),0) v, COUNT(*) n FROM sale_return WHERE return_date=?`).get(t)
  // Money taken today: what bills received beyond an order advance (that was
  // taken, and counted, on the day of the booking), plus advances booked today.
  const cashIn = db.prepare(`SELECT
      COALESCE((SELECT SUM(s.amount_received - COALESCE(
        (SELECT SUM(o.advance_amount) FROM order_booking o WHERE o.sale_id = s.id), 0))
        FROM sale s WHERE s.bill_date = @t), 0)
      + COALESCE((SELECT SUM(advance_amount) FROM order_booking WHERE order_date = @t), 0) AS v`).get({ t })
  // Tagged stock by metal — never a mixed-metal fine-weight headline.
  let byMetal = []
  try {
    byMetal = db.prepare(`SELECT COALESCE(t.name,'Unknown') metal, COUNT(*) pieces,
        COALESCE(SUM(ts.gross_wt),0) gross, COALESCE(SUM(ts.net_wt),0) net, COALESCE(SUM(ts.final_wt),0) fine
      FROM tag_stock ts JOIN item i ON i.id=ts.item_id LEFT JOIN item_type t ON t.id=i.item_type_id
      WHERE ts.status='IN_STOCK' GROUP BY metal ORDER BY metal`).all()
  } catch { byMetal = [] }
  const loose = db.prepare(`SELECT COALESCE(SUM(CASE WHEN direction='IN' THEN net_wt ELSE -net_wt END),0) net,
      COALESCE(SUM(CASE WHEN direction='IN' THEN fine_wt ELSE -fine_wt END),0) fine
    FROM loose_stock`).get()
  const overdueOrders = db.prepare(`SELECT COUNT(*) n FROM order_booking
    WHERE status NOT IN ('DELIVERED','CANCELLED') AND delivery_date<>'' AND delivery_date<?`).get(t).n
  const parked = (() => { try { return db.prepare(`SELECT COUNT(*) n FROM parked_bill WHERE status='PARKED'`).get().n } catch { return 0 } })()
  const approvalsOpen = (() => { try { return db.prepare(`SELECT COUNT(*) n FROM approval_request WHERE status='REQUESTED'`).get().n } catch { return 0 } })()
  const repairsOpen = (() => { try { return db.prepare(`SELECT COUNT(*) n FROM repair_job WHERE status NOT IN ('DELIVERED','CANCELLED')`).get().n } catch { return 0 } })()
  const hallmarkAway = (() => { try { return db.prepare(`SELECT COUNT(*) n FROM hallmark_batch WHERE status IN ('DISPATCHED','PARTIAL')`).get().n } catch { return 0 } })()
  const receivable = db.prepare(`SELECT COALESCE(SUM(bal),0) v FROM (
      SELECT p.opening_balance * (CASE p.opening_dr_cr WHEN 'Dr' THEN 1 ELSE -1 END)
        + COALESCE((SELECT SUM(l.debit-l.credit) FROM ledger_entry l WHERE l.party_id=p.id),0) AS bal
      FROM party p WHERE p.party_type='CUSTOMER') WHERE bal > 0`).get()
  const recent = db.prepare(`SELECT id, bill_no, bill_date, party_name, total_amount FROM sale ORDER BY id DESC LIMIT 8`).all()
  return {
    business_date: t, todaySales, monthSales, collections, refunds, cashSales: cashIn,
    stockByMetal: byMetal,
    loose: { net: num(loose?.net), fine: num(loose?.fine) },
    receivable: calc.r2(receivable.v),
    customers: db.prepare(`SELECT COUNT(*) c FROM party WHERE party_type='CUSTOMER'`).get().c,
    recent,
    alerts: [
      { key: 'orders_overdue', count: overdueOrders, route: 'orders', params: { status: 'BOOKED', overdue: 1 } },
      { key: 'parked_bills', count: parked, route: 'sales.new', params: { parked: 1 } },
      { key: 'approvals_open', count: approvalsOpen, route: 'approvals', params: {} },
      { key: 'repairs_open', count: repairsOpen, route: 'repairs', params: {} },
      { key: 'hallmark_away', count: hallmarkAway, route: 'hallmarking', params: {} },
    ],
  }
}

// T13 — one customer workspace. Reuses authoritative balances; the timeline is
// merged, ordered and paged in SQL so a customer with years of bills loses
// nothing and the total is exact. Money vs metal kept distinct.
const TIMELINE = `
  SELECT 'SALE' type, id, bill_no doc_no, bill_date doc_date, total_amount amount FROM sale WHERE party_id=@p
  UNION ALL SELECT 'VOUCHER', id, voucher_no, voucher_date, amount FROM voucher WHERE party_id=@p
  UNION ALL SELECT 'ORDER', id, order_no, order_date, total_amount FROM order_booking WHERE party_id=@p
  UNION ALL SELECT 'REPAIR', id, '', substr(created_at,1,10), estimate FROM repair_job WHERE customer_id=@p
  UNION ALL SELECT 'RESERVATION', id, '', substr(created_at,1,10), 0 FROM reservation WHERE customer_id=@p`
function customerSummary({ party_id, page, pageSize } = {}) {
  const db = get()
  const party = db.prepare(`SELECT * FROM party WHERE id=?`).get(party_id)
  if (!party) throw new Error('Customer not found')
  const p = { p: party_id }
  const moneyBal = db.prepare(`SELECT COALESCE(SUM(debit-credit),0) v FROM ledger_entry WHERE party_id=?`).get(party_id).v
  // Same sign and opening as reports.metalOutstanding: positive is Dr (fine
  // they owe the shop), so this screen never disagrees with the gold khata.
  const metals = db.prepare(`SELECT metal, ROUND(SUM(bal),3) bal FROM (
      SELECT metal, weight * (CASE dr_cr WHEN 'Dr' THEN 1 ELSE -1 END) bal FROM party_metal_opening WHERE party_id=@p
      UNION ALL SELECT metal, fine_out - fine_in FROM metal_entry WHERE party_id=@p)
    GROUP BY metal HAVING ABS(SUM(bal)) > 0.0005 ORDER BY metal`).all(p)
  const total = db.prepare(`SELECT COUNT(*) n FROM (${TIMELINE})`).get(p).n
  const pg = paginate({ total, page, pageSize: pageSize || 50 })
  const timeline = db.prepare(`SELECT * FROM (${TIMELINE}) ORDER BY doc_date DESC, id DESC LIMIT @limit OFFSET @offset`)
    .all({ ...p, limit: pg.pageSize, offset: pg.offset })
  const open = db.prepare(`SELECT
      (SELECT COUNT(*) FROM order_booking WHERE party_id=@p AND status NOT IN ('DELIVERED','CANCELLED')) orders,
      (SELECT COALESCE(SUM(advance_amount),0) FROM order_booking WHERE party_id=@p AND status NOT IN ('DELIVERED','CANCELLED')) advance,
      (SELECT COUNT(*) FROM gss_account WHERE party_id=@p AND closed=0) schemes,
      (SELECT COUNT(*) FROM repair_job WHERE customer_id=@p AND status NOT IN ('DELIVERED','CANCELLED')) repairs,
      (SELECT COUNT(*) FROM reservation WHERE customer_id=@p AND status='ACTIVE') reservations`).get(p)
  return {
    party, moneyBalance: calc.r2(Number(party.opening_balance) * (party.opening_dr_cr === 'Dr' ? 1 : -1) + Number(moneyBal)),
    metalBalances: metals, open, timeline, ...pg, total,
  }
}

module.exports = {
  docs, tagSearchPaged, dashboardV2, customerSummary,
  audit, approvals, availability, parkedBills, stockCounts, closing, repairs, custody, hallmarking, catalogue, inventory,
}
