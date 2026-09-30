// Read-only discovery queries. Legacy array APIs remain available for callers
// that explicitly need a complete result (exports, stock verification, labels).
// T01: validated shared page contract, extended structured filters, exact-tag
// lookup distinct from substring search, audited metal derivation, selective
// facets. Totals always cover ALL matching rows, never just the visible page.
const { get } = require('./db.cjs')
const GROUP = `CASE WHEN g.id IS NULL OR ABS(g.purity-ts.purity)<0.05 THEN g.name ELSE COALESCE(
 (SELECT g2.name FROM item_group g2 WHERE g2.item_type_id=g.item_type_id
 AND ABS(g2.purity-ts.purity)<0.05 AND g2.name NOT LIKE 'Old %' ORDER BY g2.id LIMIT 1),g.name) END`
const FROM = `FROM tag_stock ts JOIN item i ON i.id=ts.item_id
 LEFT JOIN item_group g ON g.id=i.item_group_id LEFT JOIN item_type t ON t.id=i.item_type_id
 LEFT JOIN design d ON d.id=i.design_id LEFT JOIN purchase pu ON pu.id=ts.purchase_id
 LEFT JOIN party sup ON sup.id=pu.party_id`
const literal = v => `%${String(v).trim().replace(/[\\%_]/g, '\\$&')}%`
const ALLOWED_SORT = new Set(['tag', 'name', 'weight', 'newest', 'oldest', 'tray'])
const ALLOWED_GROUP_BY = new Set(['item', 'group', 'location', 'category', 'salesman', 'shelf'])

function bad(msg) { const e = new Error(msg); e.code = 'INVALID_FILTER'; throw e }

function numOrUndef(v, label) {
  if (v === '' || v == null) return undefined
  const n = Number(v)
  if (!Number.isFinite(n) || n < 0) bad(`${label} must be a positive number or zero`)
  return n
}

function dateOrUndef(v, label) {
  if (v === '' || v == null) return undefined
  const s = String(v).slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) bad(`${label} must be YYYY-MM-DD`)
  return s
}

function where(p) {
  const c = [], args = {}
  const add = (key, sql, value) => { c.push(sql); args[key] = value }
  if (p.status && p.status !== 'ALL') {
    if (!['IN_STOCK', 'SOLD', 'ISSUED', 'MELTED'].includes(p.status)) bad('Unknown stock status')
    add('status', 'ts.status=@status', p.status)
  }
  // Availability (T01/T05): IN_STOCK rows are saleable unless a hold says
  // otherwise. It is part of the predicate, not a filter after LIMIT, so pages
  // stay full and the totals count the same pieces the rows show.
  if (p.availability === 'AVAILABLE' || p.availability === 'ON_HOLD') {
    c.push(`ts.status='IN_STOCK' AND ${p.availability === 'ON_HOLD' ? '' : 'NOT '}EXISTS
      (SELECT 1 FROM stock_hold h WHERE h.tag_id=ts.id AND h.state='ACTIVE')`)
  } else if (p.availability !== undefined && p.availability !== '' && p.availability !== null && p.availability !== 'ALL') {
    bad('Unknown availability filter')
  }
  if (p.search?.trim()) add('search', `(${['ts.tag', 'ts.huid', 'i.name', 'g.name', 'd.name', 'ts.category', 'ts.shelf_tray', 'ts.size', 'ts.location'].map(k => `${k} LIKE @search ESCAPE '\\'`).join(' OR ')})`, literal(p.search))
  for (const [key, col] of Object.entries({ itemId: 'ts.item_id', typeId: 'i.item_type_id', designId: 'i.design_id', metal: 't.name', category: 'ts.category', location: 'ts.location', shelf_tray: 'ts.shelf_tray', size: 'ts.size' })) {
    if (p[key] !== undefined && p[key] !== '' && p[key] !== null) add(key, `${col}=@${key}`, p[key])
  }
  if (p.group) add('group', `(${GROUP})=@group`, p.group)
  const minW = numOrUndef(p.minWeight, 'Minimum weight')
  const maxW = numOrUndef(p.maxWeight, 'Maximum weight')
  const minP = numOrUndef(p.minPurity, 'Minimum purity')
  const maxP = numOrUndef(p.maxPurity, 'Maximum purity')
  if (minW !== undefined) add('minWeight', 'ts.net_wt>=@minWeight', minW)
  if (maxW !== undefined) add('maxWeight', 'ts.net_wt<=@maxWeight', maxW)
  if (minP !== undefined) add('minPurity', 'ts.purity>=@minPurity', minP)
  if (maxP !== undefined) add('maxPurity', 'ts.purity<=@maxPurity', maxP)
  if (minW !== undefined && maxW !== undefined && minW > maxW) bad('Minimum weight must not exceed maximum weight')
  if (minP !== undefined && maxP !== undefined && minP > maxP) bad('Minimum purity must not exceed maximum purity')
  // T01 extensions: supplier (purchase party), purchase batch, entry-date window.
  if (p.supplierId !== undefined && p.supplierId !== '' && p.supplierId !== null) {
    const sid = Number(p.supplierId)
    if (!Number.isFinite(sid)) bad('Supplier filter must be a valid id')
    add('supplierId', 'pu.party_id=@supplierId', sid)
  }
  if (p.purchaseId !== undefined && p.purchaseId !== '' && p.purchaseId !== null) {
    const pid = Number(p.purchaseId)
    if (!Number.isFinite(pid)) bad('Purchase batch filter must be a valid id')
    add('purchaseId', 'ts.purchase_id=@purchaseId', pid)
  }
  const ef = dateOrUndef(p.entryFrom, 'Entry from date')
  const et = dateOrUndef(p.entryTo, 'Entry to date')
  if (ef) add('entryFrom', 'ts.entry_date>=@entryFrom', ef)
  if (et) add('entryTo', 'ts.entry_date<=@entryTo', et)
  if (ef && et && ef > et) bad('Entry from date must not be after entry to date')
  if (p.huid === 'MISSING') c.push("TRIM(COALESCE(ts.huid,''))=''")
  else if (p.huid === 'PRESENT') c.push("TRIM(COALESCE(ts.huid,''))<>''")
  else if (p.huid !== undefined && p.huid !== '' && p.huid !== null) bad('Unknown HUID filter')
  if (p.printed === 'NO') c.push("COALESCE(ts.label_printed_at,'')=''")
  else if (p.printed === 'YES') c.push("COALESCE(ts.label_printed_at,'')<>''")
  else if (p.printed !== undefined && p.printed !== '' && p.printed !== null) bad('Unknown printed filter')
  if (p.sort !== undefined && p.sort !== '' && p.sort !== null && !ALLOWED_SORT.has(p.sort)) bad('Unknown sort field')
  if (p.groupBy !== undefined && p.groupBy !== '' && p.groupBy !== null && p.groupBy !== 'none' && !ALLOWED_GROUP_BY.has(p.groupBy)) bad('Unknown groupBy')
  return { sql: c.length ? ` WHERE ${c.join(' AND ')}` : '', args }
}
function paging(p, total) {
  const pageSize = Math.max(10, Math.min(200, Math.trunc(Number(p.pageSize)) || 50))
  const pages = Math.max(1, Math.ceil(total / pageSize) || 1)
  const page = Math.max(1, Math.min(pages, Math.trunc(Number(p.page)) || 1))
  return { page, pageSize, offset: (page - 1) * pageSize, total }
}
const sums = `COUNT(*) count, COALESCE(SUM(ts.gross_wt),0) gross_wt,
 COALESCE(SUM(ts.net_wt),0) net_wt, COALESCE(SUM(ts.final_wt),0) final_wt,
 COALESCE(SUM(ROUND(ts.final_wt*ts.purchase_rate,2)),0) cost_value,
 COALESCE(SUM(ROUND(ts.stone_wt*ts.stone_rate,2)),0) stone_amount,
 COALESCE(SUM(ROUND(ts.diamond_wt*ts.diamond_rate,2)),0) diamond_amount,
 COALESCE(SUM(CASE WHEN ts.purchase_rate<=0 THEN 1 ELSE 0 END),0) uncosted`

function stock(p = {}) {
  const db = get(), f = where(p)
  const totals = db.prepare(`SELECT ${sums} ${FROM} ${f.sql}`).get(f.args)
  const groupCol = { item: 'i.name', group: GROUP, location: 'ts.location', category: 'ts.category', salesman: 'ts.salesman', shelf: 'ts.shelf_tray' }[p.groupBy]
  const grouped = groupCol ? `SELECT COALESCE(NULLIF(${groupCol},''),'—') AS key, ${sums} ${FROM} ${f.sql} GROUP BY key` : null
  const count = grouped ? db.prepare(`SELECT COUNT(*) n FROM (${grouped})`).get(f.args).n : totals.count
  const pg = paging(p, count)
  const limit = p.page == null ? '' : ' LIMIT @limit OFFSET @offset'
  const args = p.page == null ? f.args : { ...f.args, limit: pg.pageSize, offset: pg.offset }
  if (grouped) {
    const groups = db.prepare(`${grouped} ORDER BY key COLLATE NOCASE${limit}`).all(args)
      .map(g => ({ ...g, purity: g.net_wt > 0 ? g.final_wt / g.net_wt * 100 : 0 }))
    return { rows: [], groups, totals, ...pg }
  }
  const sort = { tag: 'ts.tag COLLATE NOCASE', name: 'i.name COLLATE NOCASE', weight: 'ts.net_wt', newest: 'ts.entry_date DESC', oldest: 'ts.entry_date', tray: 'ts.shelf_tray COLLATE NOCASE' }[p.sort] || 'ts.tag COLLATE NOCASE'
  // Exact tag/HUID matches rank first, then the requested sort with ID tie-break.
  const exact = p.search?.trim() ? 'CASE WHEN ts.tag=@exact COLLATE NOCASE OR ts.huid=@exact COLLATE NOCASE THEN 0 ELSE 1 END, ' : ''
  if (exact) args.exact = p.search.trim()
  const rows = db.prepare(`SELECT ts.*, i.name item_name, i.hsn, i.uom, t.name metal,
    ${GROUP} group_name, d.name design_name, pu.invoice_no purchase_no, sup.name supplier_name,
    CASE WHEN t.name IS NULL OR t.name NOT IN ('Gold','Silver','Platinum','Diamond','Stone')
      THEN 1 ELSE 0 END metal_unknown,
    ROUND(ts.final_wt*ts.purchase_rate,2) cost_value,
    ROUND(ts.stone_wt*ts.stone_rate,2) stone_amount,
    ROUND(ts.diamond_wt*ts.diamond_rate,2) diamond_amount
    ${FROM} ${f.sql} ORDER BY ${exact}${sort}, ts.id${limit}`).all(args)
  return { rows, groups: [], totals, ...pg }
}
// Exact identifier lookup, distinct from broad substring search (T01).
function exactLookup({ tag, huid }) {
  const db = get()
  const t = String(tag || '').trim()
  const h = String(huid || '').trim()
  if (!t && !h) bad('Provide a tag or HUID for exact lookup')
  const rows = db.prepare(`SELECT ts.*, i.name item_name, t.name metal ${FROM}
    WHERE (ts.tag=@t COLLATE NOCASE AND @t<>'') OR (ts.huid=@h COLLATE NOCASE AND @h<>'')
    ORDER BY ts.id LIMIT 5`).all({ t, h })
  return rows
}
function facets(keys) {
  const db = get(), out = {}
  const allowed = ['category', 'location', 'shelf_tray', 'size']
  const want = Array.isArray(keys) && keys.length ? keys.filter(k => allowed.includes(k)) : allowed
  for (const key of want) {
    try {
      out[key] = db.prepare(
        `SELECT DISTINCT ${key} value FROM tag_stock WHERE TRIM(COALESCE(${key},''))<>'' ORDER BY ${key} COLLATE NOCASE LIMIT 500`).all().map(r => r.value)
    } catch { out[key] = [] }
  }
  return out
}
function items(p = {}) {
  const db = get(), c = [], args = {}
  for (const key of ['item_type_id', 'item_group_id', 'design_id', 'stock_mode']) {
    if (p[key]) { c.push(`i.${key}=@${key}`); args[key] = p[key] }
  }
  if (p.search?.trim()) { c.push(`(i.name LIKE @q ESCAPE '\\' OR g.name LIKE @q ESCAPE '\\' OR d.name LIKE @q ESCAPE '\\' OR i.tag_prefix LIKE @q ESCAPE '\\')`); args.q = literal(p.search) }
  const from = 'FROM item i LEFT JOIN item_type t ON t.id=i.item_type_id LEFT JOIN item_group g ON g.id=i.item_group_id LEFT JOIN design d ON d.id=i.design_id'
  const filter = c.length ? ` WHERE ${c.join(' AND ')}` : ''
  const total = db.prepare(`SELECT COUNT(*) n ${from}${filter}`).get(args).n, pg = paging(p, total)
  const rows = db.prepare(`SELECT i.*, t.name type_name, g.name group_name, d.name design_name,
    (SELECT COUNT(*) FROM tag_stock s WHERE s.item_id=i.id AND s.status='IN_STOCK') in_stock_count,
    (SELECT COALESCE(SUM(gross_wt),0) FROM tag_stock s WHERE s.item_id=i.id AND s.status='IN_STOCK') in_stock_gross,
    (SELECT COALESCE(SUM(net_wt),0) FROM tag_stock s WHERE s.item_id=i.id AND s.status='IN_STOCK') in_stock_net,
    (SELECT COALESCE(SUM(CASE WHEN direction='IN' THEN gross_wt ELSE -gross_wt END),0) FROM item_stock s WHERE s.item_id=i.id) loose_wt
    ${from}${filter} ORDER BY i.name COLLATE NOCASE,i.id LIMIT @limit OFFSET @offset`).all({ ...args, limit: pg.pageSize, offset: pg.offset })
  return { rows, ...pg }
}
module.exports = { stock, facets, items, exactLookup, where }
