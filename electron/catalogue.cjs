// T14 — catalogue hierarchy, aliases, archive, CSV import preview/commit,
// duplicate merge with compatibility.
const { get } = require('./db.cjs')
const audit = require('./audit.cjs')

const ALIAS_ENTITIES = { item: 'item', category: 'category', design: 'design' }

function listCategories({ includeArchived, search } = {}) {
  const db = get()
  const clauses = []
  const args = {}
  if (!includeArchived) clauses.push('COALESCE(c.archived,0)=0')
  if (String(search || '').trim()) {
    clauses.push(`(c.name LIKE @q ESCAPE '\\' OR p.name LIKE @q ESCAPE '\\')`)
    args.q = `%${String(search).trim().replace(/[\\%_]/g, '\\$&')}%`
  }
  return db.prepare(`SELECT c.*, p.name parent_name,
      (SELECT COUNT(*) FROM tag_stock t WHERE t.category=c.name AND t.status='IN_STOCK') in_stock
    FROM category c LEFT JOIN category p ON p.id=c.parent_id
    ${clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''} ORDER BY c.name COLLATE NOCASE`).all(args)
}

function saveCategory({ id, name, parent_id, archived, actor }) {
  const db = get()
  const n = String(name || '').trim()
  if (!n) throw new Error('Category name is required')
  const pid = parent_id == null || parent_id === '' ? null : Number(parent_id)
  if (pid != null) {
    if (id && pid === Number(id)) throw new Error('A category cannot be its own parent')
    const parentOf = db.prepare(`SELECT id, parent_id FROM category WHERE id=?`)
    if (!parentOf.get(pid)) throw new Error('Parent category not found')
    // Walk ancestors: moving a category under one of its own descendants is a cycle.
    const seen = new Set([Number(id) || 0])
    for (let cur = pid, i = 0; cur && i < 100; i++) {
      if (seen.has(cur)) throw new Error('That parent is inside this category — it would make a loop')
      seen.add(cur)
      cur = parentOf.get(cur)?.parent_id || 0
    }
  }
  const clash = db.prepare(`SELECT id FROM category WHERE name=? COLLATE NOCASE AND id<>?`).get(n, Number(id) || 0)
  if (clash) throw new Error(`A category named "${n}" already exists`)
  if (id) {
    const old = db.prepare(`SELECT * FROM category WHERE id=?`).get(id)
    if (!old) throw new Error('Category not found')
    db.transaction(() => {
      db.prepare(`UPDATE category SET name=?, parent_id=?, archived=? WHERE id=?`).run(n, pid, archived ? 1 : 0, id)
      // Tags carry the category as text; a rename must follow them or they drop out of it.
      if (old.name !== n) db.prepare(`UPDATE tag_stock SET category=? WHERE category=?`).run(n, old.name)
      audit.record(db, { actor, operation: 'CATALOGUE.CATEGORY_SAVE', entity: 'category', entity_id: id })
    })()
    return db.prepare(`SELECT * FROM category WHERE id=?`).get(id)
  }
  const nid = db.prepare(`INSERT INTO category (name, parent_id, archived) VALUES (?,?,?)`).run(n, pid, archived ? 1 : 0).lastInsertRowid
  audit.record(db, { actor, operation: 'CATALOGUE.CATEGORY_ADD', entity: 'category', entity_id: nid })
  return db.prepare(`SELECT * FROM category WHERE id=?`).get(nid)
}

function assertEntity(db, entity, entityId) {
  const table = ALIAS_ENTITIES[entity]
  if (!table) throw new Error('Alias must belong to an item, category or design')
  if (!db.prepare(`SELECT 1 FROM ${table} WHERE id=?`).get(Number(entityId))) throw new Error(`No ${entity} with id ${entityId}`)
}

function saveAlias({ entity, entity_id, locale, alias, actor }) {
  const db = get()
  const a = String(alias || '').trim()
  if (!a) throw new Error('Alias is required')
  assertEntity(db, entity, entity_id)
  const dup = db.prepare(`SELECT * FROM item_alias WHERE entity=? AND entity_id=? AND alias=? COLLATE NOCASE`).get(entity, Number(entity_id), a)
  if (dup) return dup
  const id = db.prepare(`INSERT INTO item_alias (entity, entity_id, locale, alias) VALUES (?,?,?,?)`).run(
    entity, Number(entity_id), String(locale || '').trim(), a).lastInsertRowid
  audit.record(db, { actor, operation: 'CATALOGUE.ALIAS', entity, entity_id })
  return db.prepare(`SELECT * FROM item_alias WHERE id=?`).get(id)
}

function removeAlias({ id, actor }) {
  const db = get()
  const row = db.prepare(`SELECT * FROM item_alias WHERE id=?`).get(id)
  if (!row) throw new Error('Alias not found')
  db.prepare(`DELETE FROM item_alias WHERE id=?`).run(id)
  audit.record(db, { actor, operation: 'CATALOGUE.ALIAS_REMOVE', entity: row.entity, entity_id: row.entity_id, reason: row.alias })
  return true
}

/** Aliases matching q (or matching the name they point at), with that name resolved. */
function searchWithAliases({ q, entity } = {}) {
  const db = get()
  const needle = `%${String(q || '').trim().replace(/[\\%_]/g, '\\$&')}%`
  return db.prepare(`SELECT a.id, a.entity, a.entity_id, a.locale, a.alias,
      CASE a.entity WHEN 'item' THEN i.name WHEN 'category' THEN c.name WHEN 'design' THEN d.name END target_name
    FROM item_alias a
    LEFT JOIN item i ON a.entity='item' AND i.id=a.entity_id
    LEFT JOIN category c ON a.entity='category' AND c.id=a.entity_id
    LEFT JOIN design d ON a.entity='design' AND d.id=a.entity_id
    WHERE (a.alias LIKE @q ESCAPE '\\' OR i.name LIKE @q ESCAPE '\\' OR c.name LIKE @q ESCAPE '\\' OR d.name LIKE @q ESCAPE '\\')
      ${entity ? 'AND a.entity=@e' : ''}
    ORDER BY a.alias COLLATE NOCASE LIMIT 200`).all({ q: needle, e: entity || null })
}

/** RFC-4180-ish: quoted fields may hold commas, doubled quotes and newlines. */
function parseCsv(text) {
  const rows = []
  let row = [], cell = '', quoted = false
  const s = String(text || '').replace(/^﻿/, '')
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]
    if (quoted) {
      if (ch === '"' && s[i + 1] === '"') { cell += '"'; i++ }
      else if (ch === '"') quoted = false
      else cell += ch
    } else if (ch === '"') quoted = true
    else if (ch === ',') { row.push(cell); cell = '' }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && s[i + 1] === '\n') i++
      row.push(cell); rows.push(row); row = []; cell = ''
    } else cell += ch
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row) }
  return rows.map(r => r.map(c => c.trim())).filter(r => r.some(c => c !== ''))
}

const CSV_KINDS = {
  category: { required: ['name'], columns: ['name', 'parent'] },
  alias: { required: ['entity', 'entity_id', 'alias'], columns: ['entity', 'entity_id', 'alias', 'locale'] },
}

// CSV import: parse → validate → preview; commit is all-or-nothing with a batch key.
function previewCatalogueCsv({ csv, kind }) {
  const db = get()
  const spec = CSV_KINDS[kind]
  if (!spec) throw new Error('Import kind must be category or alias')
  const table = parseCsv(csv)
  if (!table.length) throw new Error('CSV is empty')
  const headers = table[0].map(h => h.toLowerCase())
  const missing = spec.required.filter(c => !headers.includes(c))
  if (missing.length) throw new Error(`Missing column(s): ${missing.join(', ')}`)
  const exists = Object.fromEntries(Object.keys(ALIAS_ENTITIES).map(t => [t, db.prepare(`SELECT 1 FROM ${t} WHERE id=?`)]))
  const catByName = db.prepare(`SELECT id FROM category WHERE name=? COLLATE NOCASE`)
  const inFile = new Set()
  const errors = []
  const rows = []
  for (let i = 1; i < table.length; i++) {
    const row = Object.fromEntries(headers.map((h, j) => [h, table[i][j] ?? '']))
    row.line = i + 1
    const e = spec.required.filter(c => !row[c]).map(c => `${c} is required`)
    if (kind === 'category' && row.name) {
      const key = row.name.toLowerCase()
      if (inFile.has(key)) e.push('name repeats earlier in the file')
      inFile.add(key)
      if (row.parent && row.parent.toLowerCase() === key) e.push('a category cannot be its own parent')
      row.exists = !!catByName.get(row.name)
    }
    if (kind === 'alias' && row.entity) {
      if (!exists[row.entity]) e.push('entity must be item, category or design')
      else if (row.entity_id && !exists[row.entity].get(Number(row.entity_id))) e.push(`no ${row.entity} with id ${row.entity_id}`)
    }
    if (e.length) errors.push({ line: row.line, errors: e })
    else rows.push(row)
  }
  // A parent must already exist or be created by this same file.
  const ok = rows.filter(r => {
    if (kind !== 'category' || !r.parent || inFile.has(r.parent.toLowerCase()) || catByName.get(r.parent)) return true
    errors.push({ line: r.line, errors: [`parent "${r.parent}" not found`] })
    return false
  })
  errors.sort((x, y) => x.line - y.line)
  return { headers, rows: ok, errors, valid: ok.length, invalid: errors.length }
}

function commitCatalogueCsv({ csv, kind, batch_key, actor }) {
  const db = get()
  if (!String(batch_key || '').trim()) throw new Error('Batch key is required for idempotency')
  const tx = db.transaction(() => {
    const ex = db.prepare(`SELECT * FROM catalogue_batch WHERE batch_key=?`).get(batch_key)
    if (ex) return { ...ex, repeated: true } // the same file twice is a no-op
    const preview = previewCatalogueCsv({ csv, kind })
    if (preview.errors.length) throw new Error(`${preview.errors.length} row(s) have errors — fix them before importing`)
    let added = 0
    if (kind === 'category') {
      const ins = db.prepare(`INSERT OR IGNORE INTO category (name) VALUES (?)`)
      const setParent = db.prepare(`UPDATE category SET parent_id=(SELECT id FROM category WHERE name=? COLLATE NOCASE)
        WHERE name=? COLLATE NOCASE AND parent_id IS NULL`)
      for (const r of preview.rows) added += ins.run(r.name).changes
      for (const r of preview.rows) if (r.parent) setParent.run(r.parent, r.name)
    } else {
      const dup = db.prepare(`SELECT 1 FROM item_alias WHERE entity=? AND entity_id=? AND alias=? COLLATE NOCASE`)
      const ins = db.prepare(`INSERT INTO item_alias (entity, entity_id, locale, alias) VALUES (?,?,?,?)`)
      for (const r of preview.rows) {
        if (dup.get(r.entity, Number(r.entity_id), r.alias)) continue
        ins.run(r.entity, Number(r.entity_id), r.locale || '', r.alias)
        added++
      }
    }
    const id = db.prepare(`INSERT INTO catalogue_batch (batch_key, row_count, status) VALUES (?,?, 'COMMITTED')`).run(
      batch_key, added).lastInsertRowid
    audit.record(db, { actor, operation: 'CATALOGUE.IMPORT', entity: 'catalogue_batch', entity_id: id, reason: `${kind}: ${added} added` })
    return { ...db.prepare(`SELECT * FROM catalogue_batch WHERE id=?`).get(id), repeated: false }
  })
  return tx()
}

/**
 * Fold a duplicate item into another. Every row in every table that points at
 * the item (stock, bills, purchases, orders, returns, refining, loose ledger)
 * is re-pointed first, found from the live schema so a column added by a later
 * migration is not missed; only then is the duplicate deleted. One transaction.
 */
function mergeItems({ from_id, into_id, actor }) {
  const db = get()
  from_id = Number(from_id); into_id = Number(into_id)
  if (!from_id || !into_id) throw new Error('Pick both items')
  if (from_id === into_id) throw new Error('An item cannot be merged into itself')
  const tx = db.transaction(() => {
    const a = db.prepare(`SELECT * FROM item WHERE id=?`).get(from_id)
    const b = db.prepare(`SELECT * FROM item WHERE id=?`).get(into_id)
    if (!a || !b) throw new Error('Both items must exist')
    if (a.item_type_id !== b.item_type_id || a.stock_mode !== b.stock_mode) {
      throw new Error('These items cannot be merged: metal type or stock mode differs')
    }
    const moved = {}
    const tables = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name NOT IN ('item','sqlite_sequence')`).all()
    for (const { name } of tables) {
      const refs = db.prepare(`PRAGMA foreign_key_list(${name})`).all()
        .filter(f => f.table === 'item' && (f.to || 'id') === 'id').map(f => f.from)
      if (!refs.includes('item_id') && db.prepare(`PRAGMA table_info(${name})`).all().some(c => c.name === 'item_id')) refs.push('item_id')
      for (const col of new Set(refs)) {
        const n = db.prepare(`UPDATE ${name} SET ${col}=? WHERE ${col}=?`).run(into_id, from_id).changes
        if (n) moved[name] = (moved[name] || 0) + n
      }
    }
    db.prepare(`UPDATE item_alias SET entity_id=? WHERE entity='item' AND entity_id=?`).run(into_id, from_id)
    saveAlias({ entity: 'item', entity_id: into_id, alias: a.name, actor })
    db.prepare(`DELETE FROM item WHERE id=?`).run(from_id)
    audit.record(db, { actor, operation: 'CATALOGUE.MERGE', entity: 'item', entity_id: into_id,
      reason: `merged #${from_id} ${a.name}`, before_json: JSON.stringify(a), after_json: JSON.stringify(moved) })
    return { moved, moved_tags: moved.tag_stock || 0 }
  })
  return tx()
}

function unresolvedValues() {
  const db = get()
  const cats = db.prepare(`SELECT category value, COUNT(*) n FROM tag_stock
    WHERE TRIM(COALESCE(category,''))<>'' AND category NOT IN (SELECT name FROM category)
    GROUP BY category ORDER BY n DESC LIMIT 100`).all()
  return { categories: cats }
}

module.exports = { listCategories, saveCategory, saveAlias, removeAlias, searchWithAliases, parseCsv, previewCatalogueCsv, commitCatalogueCsv, mergeItems, unresolvedValues }
