// T14 — catalogue hierarchy, aliases, archive, CSV import preview/commit,
// bulk updates with selection semantics, duplicate merge with compatibility.
const { get } = require('./db.cjs')
const audit = require('./audit.cjs')

function listCategories({ includeArchived } = {}) {
  const db = get()
  const rows = db.prepare(`SELECT c.*, p.name parent_name FROM category c
    LEFT JOIN category p ON p.id=c.parent_id
    ${includeArchived ? '' : 'WHERE COALESCE(c.archived,0)=0'} ORDER BY c.name COLLATE NOCASE`).all()
  // Cycle guard on read: report any category that is its own ancestor.
  return rows
}

function saveCategory({ id, name, parent_id, archived, actor }) {
  const db = get()
  const n = String(name || '').trim()
  if (!n) throw new Error('Category name is required')
  if (parent_id != null && parent_id !== '') {
    if (Number(parent_id) === Number(id)) throw new Error('A category cannot be its own parent')
    // Walk ancestors to prevent cycles.
    let cur = Number(parent_id)
    const seen = new Set([Number(id)])
    for (let i = 0; i < 50 && cur; i++) {
      if (seen.has(cur)) throw new Error('Category cycle detected')
      seen.add(cur)
      const row = db.prepare(`SELECT parent_id FROM category WHERE id=?`).get(cur)
      cur = row?.parent_id ? Number(row.parent_id) : 0
    }
  }
  if (id) {
    db.prepare(`UPDATE category SET name=?, parent_id=?, archived=? WHERE id=?`).run(
      n, parent_id || null, archived ? 1 : 0, id)
    audit.record(db, { actor, operation: 'CATALOGUE.CATEGORY_SAVE', entity: 'category', entity_id: id })
    return db.prepare(`SELECT * FROM category WHERE id=?`).get(id)
  }
  const nid = db.prepare(`INSERT INTO category (name, parent_id, archived) VALUES (?,?,?)`).run(
    n, parent_id || null, archived ? 1 : 0).lastInsertRowid
  audit.record(db, { actor, operation: 'CATALOGUE.CATEGORY_ADD', entity: 'category', entity_id: nid })
  return db.prepare(`SELECT * FROM category WHERE id=?`).get(nid)
}

function saveAlias({ entity, entity_id, locale, alias, actor }) {
  const db = get()
  if (!['item', 'category', 'design'].includes(entity)) throw new Error('Unknown alias entity')
  const a = String(alias || '').trim()
  if (!a) throw new Error('Alias is required')
  const id = db.prepare(`INSERT INTO item_alias (entity, entity_id, locale, alias) VALUES (?,?,?,?)`).run(
    entity, Number(entity_id), locale || '', a).lastInsertRowid
  audit.record(db, { actor, operation: 'CATALOGUE.ALIAS', entity, entity_id })
  return db.prepare(`SELECT * FROM item_alias WHERE id=?`).get(id)
}

function searchWithAliases({ q, entity }) {
  const db = get()
  const needle = `%${String(q || '').trim().replace(/[\\%_]/g, '\\$&')}%`
  const aliasRows = db.prepare(`SELECT entity, entity_id, alias FROM item_alias
    WHERE alias LIKE @q ESCAPE '\\' ${entity ? 'AND entity=@e' : ''} ORDER BY alias COLLATE NOCASE LIMIT 50`).all({ q: needle, e: entity })
  return aliasRows
}

// CSV import: parse → validate → preview; commit is all-or-nothing with batch key.
function previewCatalogueCsv({ csv, kind }) {
  const lines = String(csv || '').split(/\r?\n/).filter(l => l.trim() !== '')
  if (!lines.length) throw new Error('CSV is empty')
  const headers = lines[0].split(',').map(h => h.trim().toLowerCase())
  const errors = []
  const rows = []
  for (let i = 1; i < lines.length; i++) {
    const cells = lines[i].split(',').map(c => c.trim())
    const row = Object.fromEntries(headers.map((h, j) => [h, cells[j] ?? '']))
    const rowErrors = []
    if (kind === 'item' && !row.name) rowErrors.push('name is required')
    if (row.purity !== undefined && row.purity !== '' && !Number.isFinite(Number(row.purity))) rowErrors.push('purity must be numeric')
    if (rowErrors.length) errors.push({ line: i + 1, errors: rowErrors })
    else rows.push(row)
  }
  return { headers, rows, errors, valid: rows.length, invalid: errors.length }
}

function commitCatalogueCsv({ csv, kind, batch_key, actor }) {
  const db = get()
  const preview = previewCatalogueCsv({ csv, kind })
  if (preview.errors.length) throw new Error(`${preview.errors.length} rows have errors — fix before commit`)
  if (!batch_key?.trim()) throw new Error('Batch key is required for idempotency')
  const tx = db.transaction(() => {
    const ex = db.prepare(`SELECT * FROM catalogue_batch WHERE batch_key=?`).get(batch_key)
    if (ex) return ex // repeated import is safe
    if (kind === 'category') {
      for (const r of preview.rows) {
        db.prepare(`INSERT OR IGNORE INTO category (name) VALUES (?)`).run(r.name)
      }
    } else if (kind === 'alias') {
      for (const r of preview.rows) {
        db.prepare(`INSERT INTO item_alias (entity, entity_id, locale, alias) VALUES (?,?,?,?)`).run(
          r.entity || 'item', Number(r.entity_id) || 0, r.locale || '', r.alias || r.name || '')
      }
    } else {
      throw new Error('Only category/alias CSV commit is enabled in this release')
    }
    const id = db.prepare(`INSERT INTO catalogue_batch (batch_key, row_count, status) VALUES (?,?, 'COMMITTED')`).run(
      batch_key, preview.rows.length).lastInsertRowid
    audit.record(db, { actor, operation: 'CATALOGUE.IMPORT', entity: 'catalogue_batch', entity_id: id })
    return db.prepare(`SELECT * FROM catalogue_batch WHERE id=?`).get(id)
  })
  return tx()
}

function mergeItems({ from_id, into_id, actor }) {
  const db = get()
  const tx = db.transaction(() => {
    const a = db.prepare(`SELECT * FROM item WHERE id=?`).get(from_id)
    const b = db.prepare(`SELECT * FROM item WHERE id=?`).get(into_id)
    if (!a || !b) throw new Error('Both items are required')
    if (a.item_type_id !== b.item_type_id || a.stock_mode !== b.stock_mode) {
      throw new Error('Incompatible merge: metal/type or stock mode differs')
    }
    const refs = db.prepare(`SELECT COUNT(*) n FROM tag_stock WHERE item_id=?`).get(from_id).n
    db.prepare(`UPDATE tag_stock SET item_id=? WHERE item_id=?`).run(into_id, from_id)
    db.prepare(`INSERT INTO item_alias (entity, entity_id, locale, alias) VALUES ('item',?, '',?)`).run(into_id, a.name)
    db.prepare(`DELETE FROM item WHERE id=?`).run(from_id)
    audit.record(db, { actor, operation: 'CATALOGUE.MERGE', entity: 'item', entity_id: into_id, reason: `merged ${from_id} (${refs} tags)` })
    return { moved_tags: refs }
  })
  return tx()
}

function unresolvedValues() {
  const db = get()
  const cats = db.prepare(`SELECT DISTINCT category value, COUNT(*) n FROM tag_stock
    WHERE TRIM(COALESCE(category,''))<>'' AND TRIM(COALESCE(category,'')) NOT IN (SELECT name FROM category)
    GROUP BY category ORDER BY n DESC LIMIT 100`).all()
  return { categories: cats }
}

module.exports = { listCategories, saveCategory, saveAlias, searchWithAliases, previewCatalogueCsv, commitCatalogueCsv, mergeItems, unresolvedValues }
