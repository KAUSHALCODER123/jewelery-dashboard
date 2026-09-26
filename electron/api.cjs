/**
 * All database operations, exposed to the renderer over IPC as `api.<channel>(payload)`.
 * Every write that touches more than one table runs inside a transaction.
 */
const { get, nextDocNo, peekDocNo } = require('./db.cjs')
const calc = require('./calc.cjs')

const num = calc.num
const today = () => new Date().toISOString().slice(0, 10)

/* ───────────────────────────── Company / settings ───────────────────────────── */

const company = {
  read: () => get().prepare(`SELECT * FROM company WHERE id = 1`).get(),
  save: (p) => {
    const db = get()
    const cur = db.prepare(`SELECT * FROM company WHERE id = 1`).get()
    const next = { ...cur, ...p, id: 1 }
    db.prepare(
      `UPDATE company SET name=@name, address=@address, phone=@phone, gstin=@gstin,
       state=@state, bank_name=@bank_name, account_no=@account_no, ifsc=@ifsc,
       branch=@branch, logo=@logo, fy_start=@fy_start, fy_end=@fy_end,
       declaration=@declaration WHERE id = 1`
    ).run(next)
    return next
  },
}

const settings = {
  all: () => {
    const rows = get().prepare(`SELECT key, value FROM settings`).all()
    return Object.fromEntries(rows.map((r) => [r.key, r.value]))
  },
  set: ({ key, value }) => {
    get()
      .prepare(
        `INSERT INTO settings (key, value) VALUES (?,?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`
      )
      .run(key, String(value))
    return true
  },
}

/* ───────────────────────────── Simple masters ───────────────────────────── */

function simpleMaster(table) {
  return {
    list: () => get().prepare(`SELECT * FROM ${table} ORDER BY name`).all(),
    save: (p) => {
      const db = get()
      if (p.id) {
        db.prepare(`UPDATE ${table} SET name = ? WHERE id = ?`).run(p.name, p.id)
        return p.id
      }
      const r = db.prepare(`INSERT INTO ${table} (name) VALUES (?)`).run(p.name)
      return r.lastInsertRowid
    },
    remove: ({ id }) => {
      get().prepare(`DELETE FROM ${table} WHERE id = ?`).run(id)
      return true
    },
  }
}

const itemType = simpleMaster('item_type')
const design = simpleMaster('design')

const itemGroup = {
  list: () =>
    get()
      .prepare(
        `SELECT g.*, t.name AS type_name
         FROM item_group g LEFT JOIN item_type t ON t.id = g.item_type_id
         ORDER BY g.name`
      )
      .all(),
  save: (p) => {
    const db = get()
    if (p.id) {
      db.prepare(
        `UPDATE item_group SET name=@name, item_type_id=@item_type_id, purity=@purity WHERE id=@id`
      ).run(p)
      return p.id
    }
    return db
      .prepare(
        `INSERT INTO item_group (name, item_type_id, purity) VALUES (@name, @item_type_id, @purity)`
      )
      .run(p).lastInsertRowid
  },
  remove: ({ id }) => {
    get().prepare(`DELETE FROM item_group WHERE id = ?`).run(id)
    return true
  },
}

/* ─────────────────────────── Branches & transfers ───────────────────────────
   A branch IS a location. `tag_stock.location` already records where a piece is,
   so a transfer moves that field and writes a document saying who moved what and
   when. Keeping a second per-branch stock ledger would let two places disagree
   about where one physical ring is; this way there is only ever one answer.

   Only pieces still IN_STOCK can move, and a piece can only be sent from where
   it actually is — a transfer that could move a sold piece, or move it from the
   wrong branch, would silently invent stock at the destination.               */

const branch = {
  list: () => get().prepare(`SELECT * FROM branch ORDER BY is_main DESC, name`).all(),

  save: (p) => {
    const db = get()
    const name = String(p.name ?? '').trim()
    if (!name) throw new Error('Branch name is required')
    if (p.id) {
      const old = db.prepare(`SELECT name FROM branch WHERE id = ?`).get(p.id)
      db.prepare(`UPDATE branch SET name=?, address=?, is_main=? WHERE id=?`)
        .run(name, p.address ?? '', p.is_main ? 1 : 0, p.id)
      // Pieces carry the branch NAME, so renaming a branch has to carry them
      // along or they would all appear to be somewhere that no longer exists.
      if (old && old.name !== name) {
        db.prepare(`UPDATE tag_stock SET location = ? WHERE location = ?`).run(name, old.name)
        db.prepare(`UPDATE stock_transfer SET from_branch = ? WHERE from_branch = ?`).run(name, old.name)
        db.prepare(`UPDATE stock_transfer SET to_branch = ? WHERE to_branch = ?`).run(name, old.name)
      }
      return p.id
    }
    return db.prepare(`INSERT INTO branch (name, address, is_main) VALUES (?,?,?)`)
      .run(name, p.address ?? '', p.is_main ? 1 : 0).lastInsertRowid
  },

  remove: ({ id }) => {
    const db = get()
    const b = db.prepare(`SELECT name FROM branch WHERE id = ?`).get(id)
    if (!b) return true
    const held = db.prepare(`SELECT COUNT(*) c FROM tag_stock WHERE location = ? AND status = 'IN_STOCK'`)
      .get(b.name).c
    if (held) throw new Error(`${b.name} still holds ${held} piece(s) — move them first.`)
    db.prepare(`DELETE FROM branch WHERE id = ?`).run(id)
    return true
  },

  /** Pieces on hand at each branch, for the transfer screen and the stock report. */
  stock: () =>
    get().prepare(
      `SELECT COALESCE(NULLIF(TRIM(location),''),'(unassigned)') AS branch,
              COUNT(*) AS pieces,
              ROUND(SUM(gross_wt),3) AS gross_wt, ROUND(SUM(final_wt),3) AS fine_wt,
              ROUND(SUM(final_wt * purchase_rate),2) AS cost_value
       FROM tag_stock WHERE status = 'IN_STOCK'
       GROUP BY branch ORDER BY branch`
    ).all(),
}

const stockTransfer = {
  list: ({ from, to } = {}) =>
    get().prepare(
      `SELECT t.*, (SELECT COUNT(*) FROM stock_transfer_item i WHERE i.transfer_id = t.id) AS pieces
       FROM stock_transfer t
       WHERE (@from = '' OR t.transfer_date >= @from) AND (@to = '' OR t.transfer_date <= @to)
       ORDER BY t.transfer_date DESC, t.id DESC`
    ).all({ from: from ?? '', to: to ?? '' }),

  read: ({ id }) => {
    const db = get()
    const t = db.prepare(`SELECT * FROM stock_transfer WHERE id = ?`).get(id)
    if (!t) return null
    t.items = db.prepare(
      `SELECT i.*, ts.status, it.name AS item_name, ts.gross_wt, ts.final_wt, ts.location
       FROM stock_transfer_item i
       JOIN tag_stock ts ON ts.id = i.tag_stock_id
       JOIN item it ON it.id = ts.item_id
       WHERE i.transfer_id = ? ORDER BY i.id`
    ).all(id)
    return t
  },

  save: (p) => {
    const db = get()
    const tx = db.transaction(() => {
      const from_branch = String(p.from_branch ?? '').trim()
      const to_branch = String(p.to_branch ?? '').trim()
      if (!from_branch || !to_branch) throw new Error('Choose both branches')
      if (from_branch === to_branch) throw new Error('The two branches are the same')
      // A piece scanned twice is still one piece. Without this the document
      // would claim two were moved and the count would be wrong for ever.
      const tags = [...new Set((p.tags || []).map((t) => String(t).trim()).filter(Boolean))]
      if (!tags.length) throw new Error('Scan at least one tag to transfer')

      const rows = []
      for (const tag of tags) {
        const ts = db.prepare(`SELECT * FROM tag_stock WHERE tag = ? COLLATE NOCASE`).get(tag)
        if (!ts) throw new Error(`${tag} is not a known tag`)
        if (ts.status !== 'IN_STOCK') throw new Error(`${tag} is not in stock — it cannot be moved`)
        if ((ts.location || '') !== from_branch) {
          throw new Error(`${tag} is at ${ts.location || '(unassigned)'}, not ${from_branch}`)
        }
        rows.push(ts)
      }

      const doc_no = p.doc_no || nextDocNo('TRANSFER', 'TR')
      const id = db.prepare(
        `INSERT INTO stock_transfer (doc_no, transfer_date, from_branch, to_branch, remarks)
         VALUES (?,?,?,?,?)`
      ).run(doc_no, p.transfer_date || today(), from_branch, to_branch, p.remarks ?? '').lastInsertRowid

      const ins = db.prepare(
        `INSERT INTO stock_transfer_item (transfer_id, tag_stock_id, tag, from_location)
         VALUES (?,?,?,?)`
      )
      const move = db.prepare(`UPDATE tag_stock SET location = ? WHERE id = ?`)
      for (const ts of rows) {
        ins.run(id, ts.id, ts.tag, ts.location || '')
        move.run(to_branch, ts.id)
      }
      return { id, doc_no, moved: rows.length }
    })
    return tx()
  },

  /**
   * Undo a transfer, putting every piece back where it came from.
   *
   * Only if the piece is still where this document left it. If a later transfer
   * has since moved it on, undoing this one would teleport it backwards past a
   * document that is still standing — so the later one has to go first.
   */
  remove: ({ id }) => {
    const db = get()
    const tx = db.transaction(() => {
      const doc = db.prepare(`SELECT * FROM stock_transfer WHERE id = ?`).get(id)
      if (!doc) return true
      const items = db.prepare(`SELECT * FROM stock_transfer_item WHERE transfer_id = ?`).all(id)
      for (const i of items) {
        const ts = db.prepare(`SELECT tag, location, status FROM tag_stock WHERE id = ?`).get(i.tag_stock_id)
        if (!ts || ts.status !== 'IN_STOCK') continue
        if ((ts.location || '') !== doc.to_branch) {
          const later = db.prepare(
            `SELECT t.doc_no FROM stock_transfer_item x
             JOIN stock_transfer t ON t.id = x.transfer_id
             WHERE x.tag_stock_id = ? AND t.id > ? ORDER BY t.id LIMIT 1`
          ).get(i.tag_stock_id, id)
          throw new Error(
            later
              ? `${ts.tag} has since been moved by ${later.doc_no} — undo that one first.`
              : `${ts.tag} is no longer at ${doc.to_branch}, so this cannot be undone.`
          )
        }
      }
      const back = db.prepare(`UPDATE tag_stock SET location = ? WHERE id = ? AND status = 'IN_STOCK'`)
      for (const i of items) back.run(i.from_location, i.tag_stock_id)
      db.prepare(`DELETE FROM stock_transfer WHERE id = ?`).run(id)
      return true
    })
    return tx()
  },
}

/* ─────────────────────────── Grid Settings ───────────────────────────
   The column chooser behind every grid's `GS` button — which columns show, in
   what order, under what heading and at what width. The spec calls it a shared
   component rather than a per-screen feature, so it is one table and one hook.

   Stored preferences are RECONCILED against the columns the code actually has:
   a saved column the code has dropped is discarded, and a column added since the
   preference was saved appears at the end rather than vanishing. Otherwise a
   release that adds a column would hide it from everyone who had ever opened
   the chooser.                                                                 */

const gridPref = {
  read: ({ key }) => {
    const row = get().prepare(`SELECT config FROM grid_pref WHERE grid_key = ?`).get(key)
    if (!row) return []
    try {
      const v = JSON.parse(row.config)
      return Array.isArray(v) ? v : []
    } catch {
      return []   // a corrupt preference is not worth failing a screen over
    }
  },

  save: ({ key, config }) => {
    if (!key) throw new Error('Grid key is required')
    const clean = (Array.isArray(config) ? config : []).map((c) => ({
      key: String(c.key),
      label: c.label == null ? '' : String(c.label),
      width: Math.max(0, num(c.width)),
      visible: c.visible === false ? false : true,
    }))
    get()
      .prepare(
        `INSERT INTO grid_pref (grid_key, config) VALUES (?,?)
         ON CONFLICT (grid_key) DO UPDATE SET config = excluded.config`
      )
      .run(key, JSON.stringify(clean))
    return true
  },

  reset: ({ key }) => {
    get().prepare(`DELETE FROM grid_pref WHERE grid_key = ?`).run(key)
    return true
  },

  all: () => get().prepare(`SELECT * FROM grid_pref ORDER BY grid_key`).all(),
}

/* ─────────────────── Making Master / Wastage Master ───────────────────
   Default making charges and wastage percentages, so the shop types them once
   instead of on every tag, bill and purchase. A rule sits on an item or on an
   item group; the item's own rule wins, exactly as a specific price overrides a
   list price.

   Defaults are applied in the FORMS, not on save. A making charge of zero is a
   real answer — a shop does give making free — so the engine must never quietly
   substitute a master value for a nil the user meant. The form seeds the field,
   the user sees the number, and what they leave there is what is stored.       */

const rateMaster = {
  KINDS: ['MAKING', 'WASTAGE'],

  list: ({ kind } = {}) =>
    get()
      .prepare(
        `SELECT r.*,
                CASE r.scope WHEN 'ITEM' THEN i.name ELSE g.name END AS ref_name,
                CASE r.scope WHEN 'ITEM' THEN ig.name ELSE gt.name END AS ref_detail
         FROM rate_master r
         LEFT JOIN item       i  ON r.scope = 'ITEM'  AND i.id = r.ref_id
         LEFT JOIN item_group ig ON ig.id = i.item_group_id
         LEFT JOIN item_group g  ON r.scope = 'GROUP' AND g.id = r.ref_id
         LEFT JOIN item_type  gt ON gt.id = g.item_type_id
         WHERE (@kind = '' OR r.kind = @kind)
         ORDER BY r.kind, r.scope DESC, ref_name`
      )
      .all({ kind: kind ?? '' }),

  save: (p) => {
    const db = get()
    if (!rateMaster.KINDS.includes(p.kind)) throw new Error('Unknown rate type')
    if (!['ITEM', 'GROUP'].includes(p.scope)) throw new Error('Choose an item or a group')
    if (!p.ref_id) throw new Error(p.scope === 'ITEM' ? 'Select an item' : 'Select an item group')
    const row = {
      kind: p.kind, scope: p.scope, ref_id: p.ref_id,
      per_gram: num(p.per_gram), flat: p.kind === 'MAKING' ? num(p.flat) : 0,
    }
    if (row.per_gram < 0 || row.flat < 0) throw new Error('A rate cannot be negative')
    if (row.kind === 'WASTAGE' && row.per_gram > 100) throw new Error('Wastage cannot exceed 100%')
    // One rule per target: saving the same target again replaces it rather than
    // leaving two rules with no way to tell which one applies.
    db.prepare(
      `INSERT INTO rate_master (kind, scope, ref_id, per_gram, flat)
       VALUES (@kind,@scope,@ref_id,@per_gram,@flat)
       ON CONFLICT (kind, scope, ref_id)
       DO UPDATE SET per_gram = excluded.per_gram, flat = excluded.flat`
    ).run(row)
    return db
      .prepare(`SELECT id FROM rate_master WHERE kind=? AND scope=? AND ref_id=?`)
      .get(row.kind, row.scope, row.ref_id).id
  },

  remove: ({ id }) => {
    get().prepare(`DELETE FROM rate_master WHERE id = ?`).run(id)
    return true
  },

  /**
   * The defaults that apply to one item, and where each came from — the forms
   * show the source so a surprising number can be traced to the rule that set it.
   */
  resolve: ({ itemId }) => {
    const db = get()
    const out = {
      making_per_gram: 0, making_flat: 0, making_from: '',
      wastage_pct: 0, wastage_from: '',
    }
    if (!itemId) return out
    const item = db
      .prepare(
        `SELECT i.id, i.item_group_id, g.name AS group_name
         FROM item i LEFT JOIN item_group g ON g.id = i.item_group_id WHERE i.id = ?`
      )
      .get(itemId)
    if (!item) return out

    // 'ITEM' sorts after 'GROUP', so DESC puts the item's own rule first.
    const pick = (kind) =>
      db
        .prepare(
          `SELECT * FROM rate_master
           WHERE kind = @kind
             AND ((scope = 'ITEM' AND ref_id = @item)
               OR (scope = 'GROUP' AND ref_id = @group))
           ORDER BY scope DESC LIMIT 1`
        )
        .get({ kind, item: item.id, group: item.item_group_id ?? 0 })

    const mk = pick('MAKING')
    if (mk) {
      out.making_per_gram = num(mk.per_gram)
      out.making_flat = num(mk.flat)
      out.making_from = mk.scope === 'ITEM' ? 'this item' : item.group_name || 'its group'
    }
    const ws = pick('WASTAGE')
    if (ws) {
      out.wastage_pct = num(ws.per_gram)
      out.wastage_from = ws.scope === 'ITEM' ? 'this item' : item.group_name || 'its group'
    }
    return out
  },
}

/* ───────────────────────────── Item master ───────────────────────────── */

const item = {
  list: ({ search } = {}) => {
    const where = search ? `WHERE i.name LIKE '%' || @search || '%'` : ''
    return get()
      .prepare(
        `SELECT i.*, t.name AS type_name, g.name AS group_name, g.purity AS group_purity,
                d.name AS design_name,
                (SELECT COUNT(*) FROM tag_stock ts
                  WHERE ts.item_id = i.id AND ts.status = 'IN_STOCK') AS in_stock_count,
                (SELECT COALESCE(SUM(ts.gross_wt), 0) FROM tag_stock ts
                  WHERE ts.item_id = i.id AND ts.status = 'IN_STOCK') AS in_stock_gross,
                (SELECT COALESCE(SUM(ts.net_wt), 0) FROM tag_stock ts
                  WHERE ts.item_id = i.id AND ts.status = 'IN_STOCK') AS in_stock_net,
                (SELECT COALESCE(SUM(CASE WHEN s.direction = 'IN' THEN s.gross_wt
                                          ELSE -s.gross_wt END), 0)
                   FROM item_stock s WHERE s.item_id = i.id) AS loose_wt
         FROM item i
         LEFT JOIN item_type  t ON t.id = i.item_type_id
         LEFT JOIN item_group g ON g.id = i.item_group_id
         LEFT JOIN design     d ON d.id = i.design_id
         ${where}
         ORDER BY i.name`
      )
      .all({ search: search ?? '' })
  },

  save: (p) => {
    const db = get()
    const tag_prefix =
      (p.tag_prefix || p.name || '').replace(/[^A-Za-z]/g, '').slice(0, 3).toUpperCase()
    const row = { reorder_level: 0, stock_mode: 'TAG', ...p, tag_prefix }
    if (row.stock_mode !== 'LOOSE_WT') row.stock_mode = 'TAG'
    if (p.id) {
      // How an item is stocked decides where its stock LIVES — tag_stock for a
      // tagged piece, item_stock for a lot. Flipping it once either table has
      // rows would strand them: the pieces would vanish from the tag grid, or a
      // lot's grams would stop being counted, with no document to explain it.
      const was = db.prepare(`SELECT stock_mode FROM item WHERE id = ?`).get(p.id)?.stock_mode
      if (was && was !== row.stock_mode) {
        const held = db.prepare(`SELECT COUNT(*) c FROM tag_stock WHERE item_id = ?`).get(p.id).c
          + db.prepare(`SELECT COUNT(*) c FROM item_stock WHERE item_id = ?`).get(p.id).c
        if (held) {
          throw new Error(
            'Cannot change how this item is stocked: it already has stock against it. ' +
            'Clear the stock first, or create a new item.'
          )
        }
      }
      db.prepare(
        `UPDATE item SET name=@name, item_type_id=@item_type_id, item_group_id=@item_group_id,
         design_id=@design_id, weight_mode=@weight_mode, stock_mode=@stock_mode, uom=@uom,
         hsn=@hsn, tag_prefix=@tag_prefix, image=@image, reorder_level=@reorder_level
         WHERE id=@id`
      ).run(row)
      return p.id
    }
    return db
      .prepare(
        `INSERT INTO item (name, item_type_id, item_group_id, design_id, weight_mode, stock_mode,
         uom, hsn, tag_prefix, image, reorder_level)
         VALUES (@name, @item_type_id, @item_group_id, @design_id, @weight_mode, @stock_mode,
         @uom, @hsn, @tag_prefix, @image, @reorder_level)`
      )
      .run(row).lastInsertRowid
  },

  remove: ({ id }) => {
    const db = get()
    const used = db
      .prepare(`SELECT COUNT(*) c FROM tag_stock WHERE item_id = ?`)
      .get(id).c
    if (used) throw new Error('Cannot delete: this item already has stock tags.')
    const moved = db
      .prepare(`SELECT COUNT(*) c FROM item_stock WHERE item_id = ?`)
      .get(id).c
    if (moved) throw new Error('Cannot delete: this item already has weight movements.')
    db.prepare(`DELETE FROM item WHERE id = ?`).run(id)
    return true
  },
}

/* ───────────────────────────── Tagged stock / barcode ───────────────────────────── */

/** Next free tag for an item, e.g. RIN00004. */
function makeTag(db, itemId) {
  const it = db.prepare(`SELECT name, tag_prefix FROM item WHERE id = ?`).get(itemId)
  const prefix =
    (it?.tag_prefix || it?.name || 'ITM').replace(/[^A-Za-z]/g, '').slice(0, 3).toUpperCase()
  const rows = db
    .prepare(`SELECT tag FROM tag_stock WHERE tag LIKE ? || '%'`)
    .all(prefix)
  let max = 0
  for (const r of rows) {
    const n = parseInt(String(r.tag).slice(prefix.length), 10)
    if (Number.isFinite(n) && n > max) max = n
  }
  return `${prefix}${String(max + 1).padStart(5, '0')}`
}

const tagStock = {
  list: ({ status, search, itemId, printed, ids } = {}) => {
    const clauses = []
    // Exactly these pieces � used to print labels straight after a save.
    if (Array.isArray(ids)) {
      clauses.push(ids.length ? `ts.id IN (${ids.map((id) => Number(id) || 0).join(',')})` : '0')
    }
    if (status && status !== 'ALL') clauses.push(`ts.status = @status`)
    if (itemId) clauses.push(`ts.item_id = @itemId`)
    if (search) clauses.push(`(ts.tag LIKE '%'||@search||'%' OR i.name LIKE '%'||@search||'%')`)
    // "Not Printed Only" — reprint protection, so a label is not run twice.
    if (printed === 'NO') clauses.push(`COALESCE(ts.label_printed_at,'') = ''`)
    if (printed === 'YES') clauses.push(`COALESCE(ts.label_printed_at,'') <> ''`)
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''
    return get()
      .prepare(
        `SELECT ts.*, i.name AS item_name, g.name AS group_name, i.uom,
                pu.invoice_no AS purchase_no
         FROM tag_stock ts
         JOIN item i ON i.id = ts.item_id
         LEFT JOIN item_group g ON g.id = i.item_group_id
         LEFT JOIN purchase pu ON pu.id = ts.purchase_id
         ${where}
         ORDER BY ts.tag`
      )
      .all({ status: status ?? '', search: search ?? '', itemId: itemId ?? 0 })
  },

  nextTag: ({ itemId }) => makeTag(get(), itemId),

  /**
   * Record that labels were printed. Called after the print dialog, so a sheet
   * the user cancelled is not counted — the whole point of "Not Printed Only" is
   * that it lists what still needs a label, and marking on open would empty it.
   */
  markPrinted: ({ ids, copies = 1 }) => {
    const db = get()
    const stamp = new Date().toISOString().slice(0, 19).replace('T', ' ')
    const n = Math.max(1, num(copies))
    const tx = db.transaction(() => {
      const up = db.prepare(
        `UPDATE tag_stock SET label_printed_at = ?, label_print_count = label_print_count + ?
         WHERE id = ?`
      )
      for (const id of ids || []) up.run(stamp, n, id)
      return { marked: (ids || []).length, at: stamp }
    })
    return tx()
  },

  /** Undo a mark — the printer jammed and the labels never came out. */
  clearPrinted: ({ ids }) => {
    const db = get()
    const tx = db.transaction(() => {
      const up = db.prepare(
        `UPDATE tag_stock SET label_printed_at = '', label_print_count = 0 WHERE id = ?`
      )
      for (const id of ids || []) up.run(id)
      return { cleared: (ids || []).length }
    })
    return tx()
  },

  /** Bulk-save the barcode grid. Rows without an id are inserted with a fresh tag. */
  saveBatch: ({ itemId, rows }) => {
    const db = get()
    const tx = db.transaction(() => {
      const out = []
      const metal = itemMetal(db, itemId)
      const DEFAULTS = {
        gross_wt: 0, black_beads: 0, bag_wt: 0, stone_wt: 0, stone_rate: 0, diamond_wt: 0,
        diamond_rate: 0, purity: 0, mkg_per_gm: 0,
        hallmark_charges: 0, purchase_rate: 0, huid: '', gst_pct: 3, qty: 0,
        location: 'Shop', category: '', salesman: '', shelf_tray: '', size: '',
      }
      for (const raw of rows) {
        const net = calc.netWeight(raw)
        const final_wt = calc.fineWeight(net, raw.purity)
        const r = { ...DEFAULTS, ...raw, item_id: itemId, net_wt: net, final_wt }
        r.entry_date = r.entry_date || today()

        let tagId
        if (r.id) {
          db.prepare(
            `UPDATE tag_stock SET gross_wt=@gross_wt, black_beads=@black_beads, bag_wt=@bag_wt,
             stone_wt=@stone_wt,
             stone_rate=@stone_rate, diamond_wt=@diamond_wt, diamond_rate=@diamond_rate,
             net_wt=@net_wt, purity=@purity, final_wt=@final_wt, mkg_per_gm=@mkg_per_gm,
             hallmark_charges=@hallmark_charges, purchase_rate=@purchase_rate,
             huid=@huid, gst_pct=@gst_pct, qty=@qty, location=@location,
             category=@category, salesman=@salesman, shelf_tray=@shelf_tray, size=@size
             WHERE id=@id`
          ).run(r)
          tagId = r.id
        } else {
          r.tag = r.tag || makeTag(db, itemId)
          tagId = db
            .prepare(
              `INSERT INTO tag_stock (tag, item_id, gross_wt, black_beads, bag_wt, stone_wt,
               stone_rate, diamond_wt, diamond_rate, net_wt, purity, final_wt, mkg_per_gm,
               hallmark_charges,
               purchase_rate, huid, gst_pct, qty, location, category, salesman, shelf_tray, size,
               entry_date)
               VALUES (@tag,@item_id,@gross_wt,@black_beads,@bag_wt,@stone_wt,@stone_rate,@diamond_wt,
               @diamond_rate,@net_wt,@purity,@final_wt,
               @mkg_per_gm,@hallmark_charges,@purchase_rate,@huid,@gst_pct,@qty,@location,
               @category,@salesman,@shelf_tray,@size,@entry_date)`
            )
            .run(r).lastInsertRowid
        }

        // Tagging a piece brings metal INTO stock — post it so the day book and
        // stock position see the inflow, not just the sale's outflow.
        db.prepare(`DELETE FROM loose_stock WHERE doc_type='OPENING' AND doc_id=?`).run(tagId)
        db.prepare(
          `INSERT INTO loose_stock (metal, gross_wt, net_wt, fine_wt, doc_type, doc_id, doc_no,
           direction, is_tagged, entry_date) VALUES (?,?,?,?,'OPENING',?,?,'IN',1,?)`
        ).run(metal, num(r.gross_wt), num(r.net_wt), num(r.final_wt), tagId, r.tag || '', r.entry_date)

        out.push(tagId)
      }
      return out
    })
    return tx()
  },

  /**
   * Correct pieces in place from the Stock Report grid.
   *
   * Only pieces still IN_STOCK may be touched: a sold piece's weights and purity
   * are already priced on a bill, so silently rewriting them here would leave the
   * invoice and the stock disagreeing with no trace of which was right. Correct
   * the bill instead.
   *
   * Net and fine weight are always recomputed rather than accepted from the grid,
   * and the metal inflow booked when the tag was made is re-posted to match, so a
   * correction moves the stock position instead of only the printed row.
   */
  updateRows: ({ rows }) => {
    const db = get()
    const EDITABLE = [
      'gross_wt', 'black_beads', 'bag_wt', 'stone_wt', 'stone_rate', 'diamond_wt', 'diamond_rate',
      'purity', 'mkg_per_gm', 'hallmark_charges', 'purchase_rate', 'qty',
      'huid', 'location', 'category', 'salesman', 'shelf_tray', 'size',
    ]
    const tx = db.transaction(() => {
      let updated = 0
      for (const raw of rows || []) {
        if (!raw?.id) continue
        const cur = db.prepare(`SELECT * FROM tag_stock WHERE id = ?`).get(raw.id)
        if (!cur) throw new Error(`Tag ${raw.tag || raw.id} no longer exists`)
        if (cur.status === 'SOLD') {
          throw new Error(`${cur.tag} has been sold — edit the bill it is on, not the stock report.`)
        }
        const r = { ...cur }
        for (const k of EDITABLE) if (raw[k] !== undefined) r[k] = raw[k]
        r.net_wt = calc.netWeight(r)
        r.final_wt = calc.fineWeight(r.net_wt, r.purity)

        db.prepare(
          `UPDATE tag_stock SET gross_wt=@gross_wt, black_beads=@black_beads, bag_wt=@bag_wt,
           stone_wt=@stone_wt,
           stone_rate=@stone_rate, diamond_wt=@diamond_wt, diamond_rate=@diamond_rate,
           net_wt=@net_wt, purity=@purity, final_wt=@final_wt, mkg_per_gm=@mkg_per_gm,
           hallmark_charges=@hallmark_charges, purchase_rate=@purchase_rate, qty=@qty,
           huid=@huid, location=@location, category=@category, salesman=@salesman,
           shelf_tray=@shelf_tray, size=@size WHERE id=@id`
        ).run(r)

        db.prepare(`DELETE FROM loose_stock WHERE doc_type='OPENING' AND doc_id=?`).run(r.id)
        db.prepare(
          `INSERT INTO loose_stock (metal, gross_wt, net_wt, fine_wt, doc_type, doc_id, doc_no,
           direction, is_tagged, entry_date) VALUES (?,?,?,?,'OPENING',?,?,'IN',1,?)`
        ).run(itemMetal(db, r.item_id), num(r.gross_wt), num(r.net_wt), num(r.final_wt),
              r.id, r.tag, r.entry_date || today())
        updated++
      }
      return { updated }
    })
    return tx()
  },

  remove: ({ id }) => {
    const db = get()
    const row = db.prepare(`SELECT status FROM tag_stock WHERE id = ?`).get(id)
    if (row?.status === 'SOLD') throw new Error('Cannot delete a tag that has been sold.')
    // A transfer document names this piece. Deleting the tag would break the
    // foreign key and surface as a bare "FOREIGN KEY constraint failed"; say
    // which document is in the way instead.
    const onTransfer = db.prepare(
      `SELECT t.doc_no FROM stock_transfer_item i
       JOIN stock_transfer t ON t.id = i.transfer_id
       WHERE i.tag_stock_id = ? ORDER BY t.id LIMIT 1`
    ).get(id)
    if (onTransfer) {
      throw new Error(
        `This piece is on transfer ${onTransfer.doc_no} — delete that transfer first.`
      )
    }
    db.prepare(`DELETE FROM loose_stock WHERE doc_type='OPENING' AND doc_id=?`).run(id)
    db.prepare(`DELETE FROM tag_stock WHERE id = ?`).run(id)
    return true
  },

  /** Look up a tag for the sales grid (by tag code, exact). */
  findByTag: ({ tag }) =>
    get()
      .prepare(
        `SELECT ts.*, i.name AS item_name, i.hsn, g.name AS group_name
         FROM tag_stock ts JOIN item i ON i.id = ts.item_id
         LEFT JOIN item_group g ON g.id = i.item_group_id
         WHERE ts.tag = ? COLLATE NOCASE`
      )
      .get(tag),

  /** Type-ahead for the sales grid: "Ring : 22K Gold : RIN00001 : 10.000 : 10.000". */
  search: ({ q, includeSold = false }) =>
    get()
      .prepare(
        `SELECT ts.id, ts.tag, ts.gross_wt, ts.net_wt, ts.stone_wt, ts.purity,
                ts.mkg_per_gm, ts.hallmark_charges, ts.huid, ts.qty, ts.location, ts.status,
                i.id AS item_id, i.name AS item_name, i.hsn, g.name AS group_name
         FROM tag_stock ts JOIN item i ON i.id = ts.item_id
         LEFT JOIN item_group g ON g.id = i.item_group_id
         WHERE (i.name LIKE '%'||@q||'%' OR ts.tag LIKE '%'||@q||'%')
           AND (@includeSold = 1 OR ts.status = 'IN_STOCK')
         ORDER BY i.name, ts.tag LIMIT 50`
      )
      .all({ q: q ?? '', includeSold: includeSold ? 1 : 0 }),
}

/* ─────────────────────── Loose weight-wise items (mani, fuli) ───────────────────────
   Goods the shop buys and sells by the gram out of a common lot rather than as
   tagged pieces. 100 g of mani comes in, 10 g goes out on a bill, 90 g is left.

   Kept apart from loose metal on purpose: these grams are beads, not gold, so
   they must never reach a fine-weight khata or a metal valuation. */

const looseItem = {
  /**
   * Every LOOSE_WT item with its running weight balance, whether or not it has
   * ever moved — an item at zero still has to be visible, otherwise a shop that
   * has sold out cannot tell the item apart from one it never created.
   */
  balances: ({ search } = {}) => {
    const db = get()
    const where = search ? `AND i.name LIKE '%' || @search || '%'` : ''
    return db.prepare(
      `SELECT i.id, i.name, i.uom, g.name AS group_name,
              COALESCE(SUM(CASE WHEN s.direction = 'IN'  THEN s.gross_wt ELSE 0 END), 0) AS in_wt,
              COALESCE(SUM(CASE WHEN s.direction = 'OUT' THEN s.gross_wt ELSE 0 END), 0) AS out_wt,
              COALESCE(SUM(CASE WHEN s.direction = 'IN'  THEN s.gross_wt
                                ELSE -s.gross_wt END), 0) AS balance_wt
       FROM item i
       LEFT JOIN item_group g ON g.id = i.item_group_id
       LEFT JOIN item_stock s ON s.item_id = i.id
       WHERE i.stock_mode = 'LOOSE_WT' ${where}
       GROUP BY i.id
       ORDER BY i.name`
    ).all({ search: search ?? '' }).map((r) => ({
      ...r,
      in_wt: calc.r3(r.in_wt),
      out_wt: calc.r3(r.out_wt),
      balance_wt: calc.r3(r.balance_wt),
    }))
  },

  /** Every movement of one loose item, oldest first, with a running balance. */
  ledger: ({ item_id, from, to }) => {
    const db = get()
    const clauses = ['item_id = @item_id']
    if (from) clauses.push('entry_date >= @from')
    if (to) clauses.push('entry_date <= @to')
    const rows = db.prepare(
      `SELECT * FROM item_stock WHERE ${clauses.join(' AND ')}
       ORDER BY entry_date, id`
    ).all({ item_id, from: from ?? '', to: to ?? '' })
    let bal = 0
    return rows.map((r) => {
      bal += r.direction === 'IN' ? r.gross_wt : -r.gross_wt
      return { ...r, balance_wt: calc.r3(bal) }
    })
  },

  /**
   * Weight already on hand the day the shop starts using the software. Re-running
   * it for an item replaces that item's opening rather than adding a second one,
   * so a corrected figure does not double the lot.
   */
  opening: ({ item_id, gross_wt, rate, entry_date, remark }) => {
    const db = get()
    if (!isLooseItem(db, item_id)) {
      throw new Error('Opening weight can only be set on a weight-wise (loose) item.')
    }
    const wt = num(gross_wt)
    if (wt < 0) throw new Error('Opening weight cannot be negative.')
    // Correcting the opening downwards must not leave the lot owing weight it has
    // already billed out. 40 g opening with 30 g sold cannot be corrected to 25.
    const opened = db.prepare(
      `SELECT COALESCE(SUM(gross_wt),0) v FROM item_stock
       WHERE doc_type = 'OPENING' AND item_id = ?`).get(item_id).v
    const after = calc.r3(looseOnHand(db, item_id) - opened + wt)
    if (after < 0) {
      throw new Error(
        `An opening of ${wt} g would leave ${after} g on hand — ` +
        `more has already gone out on documents than that.`
      )
    }
    db.prepare(`DELETE FROM item_stock WHERE doc_type = 'OPENING' AND item_id = ?`).run(item_id)
    postItemStock(db, {
      item_id, gross_wt: wt, rate: num(rate), amount: calc.r2(wt * num(rate)),
      doc_type: 'OPENING', doc_no: 'OPENING', direction: 'IN',
      remark: remark ?? '', entry_date: entry_date || today(),
    })
    return true
  },

  /**
   * A manual correction after a physical count — the lot weighed 88 g when the
   * books said 90 g. Booked as its own movement so the shortage stays visible
   * instead of being edited into a purchase.
   */
  adjust: ({ item_id, gross_wt, remark, entry_date }) => {
    const db = get()
    if (!isLooseItem(db, item_id)) {
      throw new Error('Only a weight-wise (loose) item can be adjusted by weight.')
    }
    const diff = num(gross_wt)
    if (!diff) throw new Error('Enter how much weight to add or remove.')
    // A count can find a shortage, but it cannot find less than nothing — a
    // correction that takes the lot below zero is a typo, not a shortage.
    const onHand = looseOnHand(db, item_id)
    if (diff < 0 && Math.abs(diff) > onHand) {
      throw new Error(`Only ${onHand} g is on hand — a shortage of ${Math.abs(diff)} g cannot be booked.`)
    }
    postItemStock(db, {
      item_id, gross_wt: Math.abs(diff),
      doc_type: 'ADJUST', doc_no: 'ADJUST', direction: diff > 0 ? 'IN' : 'OUT',
      remark: remark ?? '', entry_date: entry_date || today(),
    })
    return true
  },
}

/* ───────────────────────────── Loose (untagged) metal ─────────────────────────────
   Bars, scrap and metal back from the refiner sit here until they are made into
   pieces. Turning loose metal into tagged stock must MOVE the weight, not add it
   — otherwise buying 100 g and then tagging 100 g of ornaments would read as 200 g. */

const looseStock = {
  /**
   * Opening loose metal — bullion, scrap and old gold already in the safe on the
   * day the shop moves onto this software.
   *
   * Tagged pieces have always had a way in (the tag grid); loose metal did not,
   * which left a shop switching over with a choice between entering its bullion
   * as a fake purchase — inventing a supplier liability that does not exist —
   * or leaving it off the books entirely. Neither is acceptable, so this is the
   * one supported route.
   *
   * It is deliberately NOT a purchase: nobody is owed for it, and it must not
   * touch anyone's khata. It is stock the shop already owns.
   */
  opening: (p) => {
    const db = get()
    const metal = METAL_TYPES.has(p.metal) ? p.metal : 'Gold'
    const fine = num(p.fine_wt)
    if (fine <= 0) throw new Error('Enter the fine weight of the metal on hand')
    const gross = num(p.gross_wt) || fine
    const net = num(p.net_wt) || gross
    if (net < fine - 0.0005) {
      throw new Error('Fine weight cannot exceed net weight')
    }
    const tx = db.transaction(() => {
      // One opening row per metal, replaced on re-entry rather than added to —
      // a shop correcting the figure it typed on day one must not end up with
      // both attempts on the books.
      db.prepare(
        `DELETE FROM loose_stock WHERE doc_type = 'OPENING' AND doc_no = ? AND metal = ?`
      ).run('OPENING-LOOSE', metal)
      db.prepare(
        `INSERT INTO loose_stock (metal, gross_wt, net_wt, fine_wt, doc_type, doc_no,
         direction, is_urd, is_tagged, entry_date)
         VALUES (?,?,?,?,'OPENING','OPENING-LOOSE','IN',0,0,?)`
      ).run(metal, gross, net, fine, p.entry_date || today())
      return { metal, fine_wt: calc.r3(fine) }
    })
    return tx()
  },

  /** What was entered as opening loose metal, per metal. */
  openingBalances: () =>
    get().prepare(
      `SELECT metal, gross_wt, net_wt, fine_wt, entry_date FROM loose_stock
       WHERE doc_type = 'OPENING' AND doc_no = 'OPENING-LOOSE' ORDER BY metal`
    ).all(),

  /** How much loose metal is on hand, and where it came from. */
  summary: ({ metal = 'Gold' } = {}) => {
    const db = get()
    const bal = (where, params = {}) =>
      db.prepare(
        `SELECT COALESCE(SUM(CASE WHEN direction='IN' THEN fine_wt ELSE -fine_wt END),0) fine,
                COALESCE(SUM(CASE WHEN direction='IN' THEN gross_wt ELSE -gross_wt END),0) gross
         FROM loose_stock WHERE metal = @metal AND ${where}`
      ).get({ metal, ...params })

    const loose = bal(`is_tagged = 0 AND is_urd = 0`)
    const urd = bal(`is_tagged = 0 AND is_urd = 1`)
    const tagged = bal(`is_tagged = 1`)

    const sources = db
      .prepare(
        `SELECT doc_type,
                COALESCE(SUM(CASE WHEN direction='IN' THEN fine_wt ELSE -fine_wt END),0) fine
         FROM loose_stock WHERE metal = ? AND is_tagged = 0
         GROUP BY doc_type HAVING ABS(fine) > 0.0005 ORDER BY fine DESC`
      )
      .all(metal)

    return {
      metal,
      loose_fine: calc.r3(loose.fine),
      loose_gross: calc.r3(loose.gross),
      urd_fine: calc.r3(urd.fine),
      tagged_fine: calc.r3(tagged.fine),
      available_fine: calc.r3(loose.fine + urd.fine),
      total_fine: calc.r3(loose.fine + urd.fine + tagged.fine),
      sources: sources.map((s) => ({ ...s, fine: calc.r3(s.fine) })),
    }
  },

  /** Every loose movement, newest first — the audit trail behind the figure. */
  ledger: ({ metal = 'Gold', from, to } = {}) =>
    get()
      .prepare(
        `SELECT * FROM loose_stock
         WHERE metal = @metal AND is_tagged = 0
           AND (@from = '' OR entry_date >= @from) AND (@to = '' OR entry_date <= @to)
         ORDER BY entry_date DESC, id DESC LIMIT 200`
      )
      .all({ metal, from: from ?? '', to: to ?? '' }),

  /**
   * Turn loose metal into tagged pieces.
   * Creates the tags and books the same fine weight OUT of the loose pool, so the
   * shop's total metal is unchanged — it has only changed form.
   */
  convert: ({ itemId, rows, entry_date, allowOverdraw = false, purchaseId = null }) => {
    const db = get()
    const tx = db.transaction(() => {
      if (!itemId) throw new Error('Choose which item these pieces are')
      const filled = (rows || []).filter((r) => num(r.gross_wt) > 0 || num(r.qty) > 0)
      if (!filled.length) throw new Error('Enter at least one piece')

      // The pool is per metal: silver payal come out of the silver pool, not
      // the gold one.
      const metal = itemMetal(db, itemId)
      // 'ALL' spreads the batch over every open purchase of this metal, oldest
      // invoice first, so a day's labelling clears the backlog in the order it
      // arrived without picking each invoice by hand.
      const fromAll = purchaseId === 'ALL'
      const purchase = purchaseId && !fromAll
        ? db.prepare(`SELECT id, invoice_no, metal FROM purchase WHERE id = ?`).get(purchaseId)
        : null
      if (purchaseId && !fromAll && !purchase) throw new Error('That purchase no longer exists')
      if (purchase && purchase.metal !== metal) {
        throw new Error(
          `${purchase.invoice_no} is a ${purchase.metal} purchase — these pieces are ${metal}.`
        )
      }
      const openPurchases = fromAll
        ? db.prepare(
            `SELECT id, invoice_no, invoice_date, metal FROM purchase
             WHERE metal = ? ORDER BY invoice_date, id`
          ).all(metal)
          .map((p) => ({ ...p, left: purchaseTally(db, p.id).pending_net }))
          .filter((p) => p.left > 0.005)
        : []
      if (fromAll && !openPurchases.length) {
        throw new Error(`No ${metal} purchase has metal waiting to be labelled.`)
      }

      const before = looseStock.summary({ metal })
      const needed = calc.r3(
        filled.reduce((s, r) => s + calc.fineWeight(calc.netWeight(r), r.purity), 0)
      )
      if (!allowOverdraw && needed > before.available_fine + 0.0005) {
        throw new Error(
          `Only ${before.available_fine.toFixed(3)} g of loose metal is available, ` +
          `but these pieces need ${needed.toFixed(3)} g.`
        )
      }

      const date = entry_date || today()
      // The conversion date belongs on the pieces too, not just on the metal
      // movement. Dating them today instead would restart their age clock, so a
      // piece converted last year would read as new stock in the ageing report.
      const ids = tagStock.saveBatch({
        itemId, rows: filled.map((r) => ({ ...r, entry_date: r.entry_date || date })),
      })

      // Mark the new tags as having come from loose stock — and from which
      // purchase, so the invoice can tally its weight against its labels.
      const mark = db.prepare(
        `UPDATE tag_stock SET source = 'PURCHASE', purchase_id = ? WHERE id = ?`
      )
      // From all purchases: each piece goes to the oldest invoice that still has
      // room for its net weight; when none has room, to the one with the most
      // left, so the overrun is flagged on a single invoice rather than spread.
      const used = []
      const pieceNet = filled.map((r) => calc.r3(calc.netWeight(r)))
      ids.forEach((id, i) => {
        let pu = purchase
        if (fromAll) {
          const net = pieceNet[i]
          pu = openPurchases.find((p) => p.left + 0.005 >= net)
            || openPurchases.reduce((best, p) => (!best || p.left > best.left ? p : best), null)
          pu.left = calc.r3(pu.left - net)
          if (!used.includes(pu)) used.push(pu)
        }
        mark.run(pu ? pu.id : null, id)
      })
      const tallies = fromAll
        ? used.map((p) => ({ id: p.id, invoice_no: p.invoice_no, ...purchaseTally(db, p.id) }))
        : []

      // Take the same weight out of the loose pool.
      const gross = calc.r3(filled.reduce((s, r) => s + num(r.gross_wt), 0))
      const net = calc.r3(filled.reduce((s, r) => s + calc.netWeight(r), 0))
      db.prepare(
        `INSERT INTO loose_stock (metal, gross_wt, net_wt, fine_wt, doc_type, doc_id, doc_no,
         direction, is_tagged, entry_date)
         VALUES (?,?,?,?,'CONVERT',?,?,'OUT',0,?)`
      ).run(metal, gross, net, needed, ids[0] ?? null,
            purchase ? `${ids.length} tags · ${purchase.invoice_no}`
              : fromAll ? `${ids.length} tags · ${used.map((p) => p.invoice_no).join(', ')}`
              : `${ids.length} tags`, date)

      const after = looseStock.summary({ metal })
      return {
        created: ids.length,
        ids,
        metal,
        tally: purchase ? purchaseTally(db, purchase.id) : null,
        /** From all purchases: the tally of every invoice the batch touched. */
        tallies,
        fine_converted: needed,
        loose_before: before.available_fine,
        loose_after: after.available_fine,
        tags: db
          .prepare(`SELECT tag FROM tag_stock WHERE id IN (${ids.map(() => '?').join(',')})`)
          .all(...ids)
          .map((t) => t.tag),
      }
    })
    return tx()
  },
}

/* ───────────────────────────── Parties (CRM) ───────────────────────────── */

const party = {
  list: ({ type, search } = {}) => {
    const clauses = []
    if (type && type !== 'ALL') clauses.push(`p.party_type = @type`)
    if (search)
      clauses.push(`(p.name LIKE '%'||@search||'%' OR p.mobile LIKE '%'||@search||'%')`)
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''
    return get()
      .prepare(
        `SELECT p.*,
           p.opening_balance * (CASE p.opening_dr_cr WHEN 'Dr' THEN 1 ELSE -1 END)
           + COALESCE((SELECT SUM(l.debit - l.credit) FROM ledger_entry l
                        WHERE l.party_id = p.id), 0) AS balance
         FROM party p ${where} ORDER BY p.name`
      )
      .all({ type: type ?? '', search: search ?? '' })
  },

  read: ({ id }) => {
    const db = get()
    const p = db.prepare(`SELECT * FROM party WHERE id = ?`).get(id)
    if (!p) return null
    p.metals = db.prepare(`SELECT * FROM party_metal_opening WHERE party_id = ?`).all(id)
    p.balance = party.balance({ id }).balance
    return p
  },

  /** Running money balance (positive = customer owes us, "Dr"). */
  balance: ({ id }) => {
    const db = get()
    const p = db
      .prepare(`SELECT opening_balance, opening_dr_cr FROM party WHERE id = ?`)
      .get(id)
    if (!p) return { balance: 0 }
    const opening = num(p.opening_balance) * (p.opening_dr_cr === 'Dr' ? 1 : -1)
    const moved =
      db
        .prepare(
          `SELECT COALESCE(SUM(debit - credit), 0) AS v FROM ledger_entry WHERE party_id = ?`
        )
        .get(id).v || 0
    return { balance: calc.r2(opening + moved) }
  },

  /**
   * Fine-weight balance for a party (the gold khata).
   * Positive = the party owes us metal (Dr), mirroring the money convention.
   *   balance = opening + Σ(metal we gave them) − Σ(metal they gave us)
   */
  metalBalance: ({ id, metal = 'Gold' }) => {
    const db = get()
    const op = db
      .prepare(
        `SELECT COALESCE(SUM(weight * (CASE dr_cr WHEN 'Dr' THEN 1 ELSE -1 END)), 0) v
         FROM party_metal_opening WHERE party_id = ? AND metal = ?`
      )
      .get(id, metal).v || 0
    const moved = db
      .prepare(
        `SELECT COALESCE(SUM(fine_out - fine_in), 0) v FROM metal_entry
         WHERE party_id = ? AND metal = ?`
      )
      .get(id, metal).v || 0
    return { balance: calc.r3(op + moved), metal }
  },

  /**
   * Loyalty point balance — derived from the party's bills (earned − redeemed)
   * plus any opening on the party. Derived, not a stored counter, so an edited or
   * deleted bill self-corrects with nothing to reverse.
   */
  loyaltyBalance: ({ id }) => {
    const db = get()
    const p = db.prepare(`SELECT loyalty_enabled, loyalty_points FROM party WHERE id = ?`).get(id)
    if (!p) return { balance: 0, enabled: false }
    const moved = db.prepare(
      `SELECT COALESCE(SUM(loyalty_earned - loyalty_redeemed),0) v FROM sale WHERE party_id = ?`
    ).get(id).v
    return { balance: calc.r2(num(p.loyalty_points) + num(moved)), enabled: !!p.loyalty_enabled }
  },

  save: (p) => {
    const db = get()
    // Callers (quick-create forms, imports) may send only a few fields — fill the rest
    // so the named-parameter statements below always bind.
    const DEFAULTS = {
      party_type: 'CUSTOMER', name: '', district: '', taluka: '', city: '', area: '',
      address: '', whatsapp: '', mobile: '', birth_date: '', anniversary: '', email: '',
      ref_name: '', aadhaar: '', pan: '', gstin: '', state: 'Maharashtra', regi_number: '',
      opening_balance: 0, opening_dr_cr: 'Dr', loyalty_enabled: 0, show_in_purchase: 0,
      photo: '',
    }
    const tx = db.transaction(() => {
      let id = p.id
      const row = { ...DEFAULTS, ...p, id: p.id ?? null }
      row.opening_balance = num(row.opening_balance)
      row.loyalty_enabled = row.loyalty_enabled ? 1 : 0
      row.show_in_purchase = row.show_in_purchase ? 1 : 0
      if (id) {
        db.prepare(
          `UPDATE party SET party_type=@party_type, name=@name, district=@district, taluka=@taluka,
           city=@city, area=@area, address=@address, whatsapp=@whatsapp, mobile=@mobile,
           birth_date=@birth_date, anniversary=@anniversary, email=@email, ref_name=@ref_name,
           aadhaar=@aadhaar, pan=@pan, gstin=@gstin, state=@state, regi_number=@regi_number,
           opening_balance=@opening_balance, opening_dr_cr=@opening_dr_cr,
           loyalty_enabled=@loyalty_enabled, show_in_purchase=@show_in_purchase, photo=@photo
           WHERE id=@id`
        ).run(row)
      } else {
        id = db
          .prepare(
            `INSERT INTO party (party_type, name, district, taluka, city, area, address, whatsapp,
             mobile, birth_date, anniversary, email, ref_name, aadhaar, pan, gstin, state,
             regi_number, opening_balance, opening_dr_cr, loyalty_enabled, show_in_purchase, photo)
             VALUES (@party_type,@name,@district,@taluka,@city,@area,@address,@whatsapp,@mobile,
             @birth_date,@anniversary,@email,@ref_name,@aadhaar,@pan,@gstin,@state,@regi_number,
             @opening_balance,@opening_dr_cr,@loyalty_enabled,@show_in_purchase,@photo)`
          )
          .run(row).lastInsertRowid
      }
      db.prepare(`DELETE FROM party_metal_opening WHERE party_id = ?`).run(id)
      const ins = db.prepare(
        `INSERT INTO party_metal_opening (party_id, metal, weight, dr_cr) VALUES (?,?,?,?)`
      )
      for (const m of p.metals || []) {
        if (num(m.weight) !== 0) ins.run(id, m.metal, num(m.weight), m.dr_cr || 'Dr')
      }
      return id
    })
    return tx()
  },

  remove: ({ id }) => {
    const db = get()
    const used = db
      .prepare(`SELECT COUNT(*) c FROM ledger_entry WHERE party_id = ?`)
      .get(id).c
    if (used) throw new Error('Cannot delete: this party already has transactions.')
    db.prepare(`DELETE FROM party WHERE id = ?`).run(id)
    return true
  },
}

/* ───────────────────────────── Accounts & series ───────────────────────────── */

const account = {
  list: () => get().prepare(`SELECT * FROM account ORDER BY code`).all(),
  save: (p) => {
    const db = get()
    // Only the name is worth insisting on — a code is generated, and the rest
    // have sane defaults, so adding "Electricity" is a one-field job.
    const row = {
      code: null, acc_type: 'Expense', acc_group: '',
      opening_balance: 0, opening_dr_cr: 'Dr',
      is_card_swap: 0, card_pct_customer: 0, card_pct_shop: 0,
      ...p,
      name: String(p.name ?? '').trim(),
      opening_balance: num(p.opening_balance),
    }
    if (!row.name) throw new Error('Account name is required.')
    if (!row.code) row.code = account.nextCode()
    // Card-swipe settings only mean anything on a bank account.
    row.is_card_swap = row.acc_group === 'Bank Accounts' && row.is_card_swap ? 1 : 0
    row.card_pct_customer = row.is_card_swap ? num(row.card_pct_customer) : 0
    row.card_pct_shop = row.is_card_swap ? num(row.card_pct_shop) : 0
    if (row.card_pct_customer < 0 || row.card_pct_shop < 0) {
      throw new Error('A card charge cannot be negative')
    }
    if (row.card_pct_customer + row.card_pct_shop > 100) {
      throw new Error('Card charges cannot exceed 100%')
    }
    // Exactly one account can be the card-swap account, or a bill would have to
    // guess which rate applied.
    if (row.is_card_swap) {
      db.prepare(`UPDATE account SET is_card_swap = 0 WHERE id <> COALESCE(?, -1)`).run(row.id ?? null)
    }

    if (row.id) {
      db.prepare(
        `UPDATE account SET code=@code, name=@name, acc_type=@acc_type, acc_group=@acc_group,
         opening_balance=@opening_balance, opening_dr_cr=@opening_dr_cr,
         is_card_swap=@is_card_swap, card_pct_customer=@card_pct_customer,
         card_pct_shop=@card_pct_shop WHERE id=@id`
      ).run(row)
      return row.id
    }
    return db
      .prepare(
        `INSERT INTO account (code, name, acc_type, acc_group, opening_balance, opening_dr_cr,
         is_card_swap, card_pct_customer, card_pct_shop)
         VALUES (@code,@name,@acc_type,@acc_group,@opening_balance,@opening_dr_cr,
         @is_card_swap,@card_pct_customer,@card_pct_shop)`
      )
      .run(row).lastInsertRowid
  },
  nextCode: () => {
    const row = get()
      .prepare(`SELECT MAX(CAST(code AS INTEGER)) m FROM account WHERE code GLOB '[0-9]*'`)
      .get()
    return String((row?.m || 100) + 1)
  },
}

const series = {
  list: ({ docType } = {}) =>
    docType
      ? get().prepare(`SELECT * FROM voucher_series WHERE doc_type = ? ORDER BY id`).all(docType)
      : get().prepare(`SELECT * FROM voucher_series ORDER BY doc_type, id`).all(),
  peek: ({ docType, prefix }) => peekDocNo(docType, prefix),
  save: (p) => {
    const db = get()
    if (p.id) {
      db.prepare(`UPDATE voucher_series SET prefix=@prefix, label=@label WHERE id=@id`).run(p)
      return p.id
    }
    return db
      .prepare(
        `INSERT INTO voucher_series (doc_type, prefix, label) VALUES (@doc_type,@prefix,@label)`
      )
      .run(p).lastInsertRowid
  },
}

/* ───────────────────────────── Ledger posting helpers ───────────────────────────── */

function postLedger(db, e) {
  db.prepare(
    `INSERT INTO ledger_entry (entry_date, party_id, account_id, doc_type, doc_id, doc_no,
     manual_no, particulars, debit, credit)
     VALUES (@entry_date,@party_id,@account_id,@doc_type,@doc_id,@doc_no,@manual_no,
     @particulars,@debit,@credit)`
  ).run({
    manual_no: '', party_id: null, account_id: null, debit: 0, credit: 0, doc_no: '', ...e,
  })
}

function clearPostings(db, docType, docId) {
  db.prepare(`DELETE FROM ledger_entry WHERE doc_type = ? AND doc_id = ?`).run(docType, docId)
  db.prepare(`DELETE FROM metal_entry  WHERE doc_type = ? AND doc_id = ?`).run(docType, docId)
  db.prepare(`DELETE FROM loose_stock  WHERE doc_type = ? AND doc_id = ?`).run(docType, docId)
  db.prepare(`DELETE FROM item_stock   WHERE doc_type = ? AND doc_id = ?`).run(docType, docId)
}

const accountIdByName = (db, name) =>
  db.prepare(`SELECT id FROM account WHERE name = ?`).get(name)?.id ?? null

/**
 * The metal of a stock item — Gold, Silver, Platinum — read from its item type
 * (item → item_group → item_type). Defaults to 'Gold' for a line with no item
 * behind it (a hand-typed row) so single-metal behaviour is unchanged.
 */
const METAL_TYPES = new Set(['Gold', 'Silver', 'Platinum'])
/**
 * Is this item stocked by weight out of a common lot rather than tagged piece by
 * piece? Mani, fuli and dori are bought as 100 g and sold as 10 g — they have no
 * piece identity to tag, and their grams are beads, not metal.
 */
function isLooseItem(db, itemId) {
  if (!itemId) return false
  return db.prepare(`SELECT stock_mode FROM item WHERE id = ?`).get(itemId)?.stock_mode
    === 'LOOSE_WT'
}

/** How many grams of a loose item are on hand right now. */
function looseOnHand(db, itemId) {
  return calc.r3(db.prepare(
    `SELECT COALESCE(SUM(CASE WHEN direction = 'IN' THEN gross_wt ELSE -gross_wt END), 0) v
     FROM item_stock WHERE item_id = ?`
  ).get(itemId).v)
}

/**
 * Move weight of a loose item in or out. One row per movement — the balance is
 * always a sum over item_stock, so nothing has to keep a running total honest.
 * Silently ignores a line with no weight so an empty grid row books nothing.
 */
function postItemStock(db, e) {
  const gross = num(e.gross_wt)
  if (!e.item_id || !gross) return
  db.prepare(
    `INSERT INTO item_stock (item_id, gross_wt, qty, rate, amount, doc_type, doc_id, doc_no,
     direction, remark, entry_date)
     VALUES (@item_id,@gross_wt,@qty,@rate,@amount,@doc_type,@doc_id,@doc_no,@direction,
     @remark,@entry_date)`
  ).run({
    qty: 0, rate: 0, amount: 0, doc_id: null, doc_no: '', remark: '', ...e, gross_wt: gross,
  })
}

function itemMetal(db, itemId) {
  if (!itemId) return 'Gold'
  const t = db.prepare(
    `SELECT it.name FROM item i
     JOIN item_group g ON g.id = i.item_group_id
     JOIN item_type it ON it.id = g.item_type_id
     WHERE i.id = ?`
  ).get(itemId)?.name
  return METAL_TYPES.has(t) ? t : 'Gold'
}

/**
 * Which money account a payment lands in.
 *
 * Only physical cash goes in the drawer. A card swipe, a UPI transfer, NEFT or a
 * cheque all settle into the bank, whatever the form calls them — and the Day
 * Book's per-account balances are only meaningful if that holds. Vouchers and
 * scheme receipts always worked this way; sales treated everything except the
 * literal word "Bank" as cash, which put card takings in the drawer while the
 * swipe fee they generated came out of the bank.
 */
const CASH_MODES = new Set(['Cash', ''])
const moneyAccountFor = (db, mode) =>
  accountIdByName(db, CASH_MODES.has(mode ?? '') ? 'Cash Account' : 'Bank Account')

/**
 * The accounting books — Trial Balance, Trading & P&L, Balance Sheet — derived
 * from the source documents. docs/VIDEO-SPEC-2.md §5.
 *
 * WHY DERIVE INSTEAD OF READING A DOUBLE-ENTRY LEDGER: this app keeps a
 * single-entry money ledger. Only cash/bank, the GSS liability, the expense
 * heads (via vouchers) and the parties get real `ledger_entry` rows; the income
 * and direct-expense heads (Sales, Purchase, Old Gold, GST…) live only as the
 * *particulars* text on the party's leg. So the books are synthesised here from
 * the documents that generated those legs. Every rupee a document moved still
 * has a home on both sides, so a correctly built statement foots to the paisa;
 * whatever does not (chiefly party opening balances carried forward against
 * proprietor's capital) is surfaced as an explicit balancing line rather than
 * hidden.
 *
 * Figures accumulate income/expense over [from, to]; balances are struck as-on
 * `to`. Metal is deliberately excluded — gold has its own weight statement
 * (Account cum Stock); folding grams into rupees would corrupt both.
 */
function computeBooks(db, { from, to, openingStock = 0 } = {}) {
  const p = { from: from || '1900-01-01', to: to || '2999-12-31' }
  const asOn = p.to
  const one = (sql) => db.prepare(sql).get(p)

  // ── income & direct-cost documents over the period ──
  const sales = one(
    `SELECT COALESCE(SUM(bill_amount),0) goods, COALESCE(SUM(gst_amount),0) gst,
            COALESCE(SUM(tcs_amount),0) tcs, COALESCE(SUM(other_amount),0) other,
            COALESCE(SUM(bill_discount+making_discount),0) discount,
            COALESCE(SUM(urd_amount),0) urd
     FROM sale WHERE bill_date BETWEEN @from AND @to`)
  const salesRet = one(
    `SELECT COALESCE(SUM(bill_amount),0) goods, COALESCE(SUM(gst_amount),0) gst
     FROM sale_return WHERE return_date BETWEEN @from AND @to`)
  const settle = one(
    `SELECT COALESCE(SUM(amount),0) goods, COALESCE(SUM(gst_amount),0) gst
     FROM stock_settlement WHERE settle_date BETWEEN @from AND @to`)
  const purch = one(
    `SELECT COALESCE(SUM(purchase_amount),0) goods, COALESCE(SUM(gst_amount),0) gst
     FROM purchase WHERE invoice_date BETWEEN @from AND @to`)
  const purchRet = one(
    `SELECT COALESCE(SUM(bill_amount),0) goods, COALESCE(SUM(gst_amount),0) gst
     FROM purchase_return WHERE return_date BETWEEN @from AND @to`)
  const refine = one(
    `SELECT COALESCE(SUM(bill_amount),0) charges, COALESCE(SUM(gst_amount),0) gst
     FROM refinery WHERE invoice_date BETWEEN @from AND @to`)
  const karagir = one(
    `SELECT COALESCE(SUM(labour_amount),0) labour, COALESCE(SUM(tds_amount),0) tds
     FROM karagir_receive WHERE receive_date BETWEEN @from AND @to`)
  // Old gold bought on its own bill, with no sale against it.
  const urdBills = one(
    `SELECT COALESCE(SUM(purchase_amount - discount + other_amount),0) amt
     FROM urd_bill WHERE bill_date BETWEEN @from AND @to`)

  // ── trading heads (net of returns) ──
  const salesRevenue = calc.r2(num(sales.goods) + num(settle.goods) - num(salesRet.goods))
  const purchases = calc.r2(num(purch.goods) - num(purchRet.goods))
  const oldGold = calc.r2(num(sales.urd) + num(urdBills.amt))
  const discountAllowed = calc.r2(num(sales.discount))
  const otherCharges = calc.r2(num(sales.other))

  // GST: what we collected on sales less what we paid on buys — a net liability.
  const gstOutput = calc.r2(num(sales.gst) + num(settle.gst) - num(salesRet.gst))
  const gstInput = calc.r2(num(purch.gst) - num(purchRet.gst) + num(refine.gst))
  const gstPayable = calc.r2(gstOutput - gstInput)
  const tcsPayable = calc.r2(num(sales.tcs))
  const tdsPayable = calc.r2(num(karagir.tds))

  // ── real account balances as-on `to` ──
  // The account's OPENING BALANCE is part of the balance, not decoration. A shop
  // that starts with 5,00,000 in the drawer and 20,00,000 in the bank really has
  // it; leaving it out understated cash everywhere and could show a bank that had
  // been drawn on as a *negative debit* on the trial balance, which is not a
  // thing. The trial balance still footed without it — capital is a plug, so the
  // omission cancelled on both sides — which is exactly why this survived until a
  // full month with real opening balances was run through it.
  const acct = db.prepare(
    `SELECT a.id, a.name, a.acc_type,
            COALESCE(SUM(CASE WHEN l.entry_date <= @asOn THEN l.debit - l.credit END),0)
              + CASE WHEN a.opening_dr_cr = 'Dr' THEN a.opening_balance ELSE -a.opening_balance END
              AS bal
     FROM account a LEFT JOIN ledger_entry l ON l.account_id = a.id
     GROUP BY a.id`).all({ asOn })
  const acctBal = (name) => calc.r2(acct.find((a) => a.name === name)?.bal || 0)
  const cash = acctBal('Cash Account')
  const bank = acctBal('Bank Account')
  const gss = calc.r2(-acctBal('Gold Saving Scheme')) // credits → positive liability

  // Indirect/shop expenses: any Expense-type account that took voucher postings
  // in the period. Purchase & Old Gold never get an account_id row, so they can
  // never double-count here.
  const expenseHeads = db.prepare(
    `SELECT a.name, COALESCE(SUM(l.debit - l.credit),0) amt
     FROM account a JOIN ledger_entry l ON l.account_id = a.id
     WHERE a.acc_type = 'Expense' AND l.entry_date BETWEEN @from AND @to
     GROUP BY a.id HAVING amt <> 0 ORDER BY a.name`).all(p)
    .map((r) => ({ name: r.name, amount: calc.r2(r.amt) }))
  const shopExpenses = calc.r2(expenseHeads.reduce((s, r) => s + r.amount, 0))

  // ── debtors / creditors as-on `to` (money side only) ──
  const parties = db.prepare(
    `SELECT p.id, p.name,
            p.opening_balance * (CASE p.opening_dr_cr WHEN 'Dr' THEN 1 ELSE -1 END)
            + COALESCE((SELECT SUM(l.debit - l.credit) FROM ledger_entry l
                        WHERE l.party_id = p.id AND l.entry_date <= @asOn), 0) AS bal
     FROM party p`).all({ asOn })
  const debtors = parties.filter((r) => num(r.bal) > 0.009)
    .map((r) => ({ name: r.name, amount: calc.r2(r.bal) }))
  const creditors = parties.filter((r) => num(r.bal) < -0.009)
    .map((r) => ({ name: r.name, amount: calc.r2(-r.bal) }))
  const debtorTotal = calc.r2(debtors.reduce((s, r) => s + r.amount, 0))
  const creditorTotal = calc.r2(creditors.reduce((s, r) => s + r.amount, 0))

  // Closing stock at COST (fine grams × what we paid per gram). Same basis as
  // the Stock Report's "Value at Cost" so the two screens never disagree.
  // This reads CURRENT inventory, not stock reconstructed as-on a past date, so
  // it is exact for a period ending today and approximate for history.
  const taggedStock = calc.r2(db.prepare(
    `SELECT COALESCE(SUM(final_wt * purchase_rate),0) v
     FROM tag_stock WHERE status = 'IN_STOCK'`).get().v)

  // LOOSE metal counts too. Bullion bought and not yet made up, and old gold
  // taken in and not yet melted, are stock sitting in the safe — leaving them
  // out treated every such purchase as a pure expense with no asset against it,
  // so a shop holding bullion at year end showed a loss it had not made and a
  // balance sheet short by the same amount. It balanced either way, because
  // capital is a plug, which is why a month where everything bought got tagged
  // and sold never showed it.
  //
  // Valued at the weighted average of what metal actually cost this period —
  // purchases and old gold together, over the fine weight they brought in. A
  // period that bought nothing has no basis to value on and contributes 0,
  // reported separately rather than guessed at.
  const looseFine = calc.r3(db.prepare(
    `SELECT COALESCE(SUM(CASE WHEN direction='IN' THEN fine_wt ELSE -fine_wt END),0) v
     FROM loose_stock WHERE is_tagged = 0`).get().v)
  const fineBought = calc.r3(db.prepare(
    `SELECT COALESCE(SUM(pi.fine_plus_wastage),0) v
     FROM purchase_item pi JOIN purchase p2 ON p2.id = pi.purchase_id
     WHERE p2.invoice_date BETWEEN @from AND @to`).get(p).v)
  const fineUrd = calc.r3(db.prepare(
    `SELECT COALESCE(SUM(u.final_wt),0) v
     FROM sale_urd u
     LEFT JOIN sale s2 ON s2.id = u.sale_id
     LEFT JOIN urd_bill b2 ON b2.id = u.urd_bill_id
     WHERE COALESCE(s2.bill_date, b2.bill_date) BETWEEN @from AND @to`).get(p).v)
  const fineAcquired = calc.r3(fineBought + fineUrd)
  const avgMetalCost = fineAcquired > 0
    ? calc.r2((purchases + oldGold) / fineAcquired) : 0
  const looseStockValue = calc.r2(Math.max(0, looseFine) * avgMetalCost)

  const closingStock = calc.r2(taggedStock + looseStockValue)
  const openStock = calc.r2(openingStock)

  // ── Trading & Profit / Loss ──
  const grossProfit = calc.r2(
    (salesRevenue + otherCharges + closingStock) - (openStock + purchases + oldGold))
  const refiningCharges = calc.r2(num(refine.charges))
  const karagirLabour = calc.r2(num(karagir.labour))
  const indirectExpenses = calc.r2(shopExpenses + refiningCharges + karagirLabour + discountAllowed)
  const netProfit = calc.r2(grossProfit - indirectExpenses)

  return {
    range: p,
    salesRevenue, purchases, oldGold, discountAllowed, otherCharges,
    gstOutput, gstInput, gstPayable, tcsPayable, tdsPayable,
    cash, bank, gss, expenseHeads, shopExpenses, refiningCharges, karagirLabour,
    debtors, creditors, debtorTotal, creditorTotal,
    openStock, closingStock, grossProfit, indirectExpenses, netProfit,
    taggedStock, looseStockValue, looseFine, avgMetalCost,
  }
}

/* ───────────────────────────── Sales ───────────────────────────── */

const sale = {
  list: ({ from, to, search } = {}) => {
    const clauses = []
    if (from) clauses.push(`s.bill_date >= @from`)
    if (to) clauses.push(`s.bill_date <= @to`)
    if (search)
      clauses.push(`(s.bill_no LIKE '%'||@search||'%' OR s.party_name LIKE '%'||@search||'%')`)
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''
    return get()
      .prepare(`SELECT s.* FROM sale s ${where} ORDER BY s.bill_date DESC, s.id DESC LIMIT 500`)
      .all({ from: from ?? '', to: to ?? '', search: search ?? '' })
  },

  read: ({ id }) => {
    const db = get()
    const head = db.prepare(`SELECT * FROM sale WHERE id = ?`).get(id)
    if (!head) return null
    head.items = db
      .prepare(`SELECT * FROM sale_item WHERE sale_id = ? ORDER BY line_no`)
      .all(id)
      .map((l) => ({ ...l, is_loose: isLooseItem(db, l.item_id) ? 1 : 0 }))
    head.urds = db
      .prepare(`SELECT * FROM sale_urd WHERE sale_id = ? ORDER BY line_no`)
      .all(id)
    head.metals = db
      .prepare(`SELECT * FROM sale_metal WHERE sale_id = ? ORDER BY metal`)
      .all(id)
    head.payments = db
      .prepare(`SELECT * FROM sale_payment WHERE sale_id = ? ORDER BY line_no`)
      .all(id)
    return head
  },

  /**
   * Create or update a sale bill.
   * Side effects: consumes a bill number, marks sold tags, posts money + metal ledgers,
   * and books the old gold (URD) into loose stock.
   */
  save: (payload) => {
    const db = get()
    const tx = db.transaction(() => {
      const { head } = payload
      // Stamp each line with its metal (from the item type) so weightwise
      // settlement and the metal ledger below split Gold / Silver / Platinum
      // correctly. A hand-typed line with no item resolves to Gold.
      const items = (payload.items || []).map((l) => {
        // The item master has the only say. A caller may tell us a line IS loose
        // (a hand-typed line with no item behind it cannot be), but it may not
        // tell us one is NOT — a stale flag left behind by editing over a picked
        // item would otherwise take beads off the shelf without moving the lot,
        // and put their grams on the gold khata.
        const is_loose = isLooseItem(db, l.item_id) || !!l.is_loose
        return {
          ...l,
          is_loose: is_loose ? 1 : 0,
          // A loose line is beads, not metal. Leaving it stamped 'Gold' would put
          // its grams into the weightwise settlement and the metal khata — and so
          // would a purity, which is what turns net weight into fine weight
          // everywhere downstream. Beads have neither.
          purity: is_loose ? 0 : l.purity,
          metal: is_loose ? '' : (l.metal || itemMetal(db, l.item_id)),
        }
      })

      let id = head.id

      // ── loyalty: resolve how many points this bill redeems (capped to the
      // customer's available balance and to the bill's own value) before the
      // authoritative totals, so the discount flows through GST like any other.
      const setNum = (k, d) => {
        const v = db.prepare(`SELECT value FROM settings WHERE key = ?`).get(k)?.value
        return v == null ? d : num(v)
      }
      const earnPct = setNum('loyalty_earn_pct', 0)
      const redeemValue = setNum('loyalty_redeem_value', 1) || 1
      const party0 = head.party_id
        ? db.prepare(`SELECT loyalty_enabled, loyalty_points FROM party WHERE id = ?`).get(head.party_id)
        : null
      let loyalty_redeemed = 0
      if (party0 && num(head.loyalty_redeem) > 0) {
        const prior = db.prepare(
          `SELECT COALESCE(SUM(loyalty_earned - loyalty_redeemed),0) v
           FROM sale WHERE party_id = ? AND id <> ?`).get(head.party_id, id ?? -1).v
        const available = num(party0.loyalty_points) + num(prior)
        const t0 = calc.saleTotals({ ...head, loyalty_discount: 0 }, items,
          payload.urds || [], payload.metals || []).totals
        const capRs = Math.max(0, t0.bill_amount - num(head.bill_discount) - num(head.making_discount))
        loyalty_redeemed = Math.max(0, Math.min(
          num(head.loyalty_redeem), available, Math.floor(capRs / redeemValue)))
      }
      head.loyalty_discount = calc.r2(loyalty_redeemed * redeemValue)

      // ── Gold Saving Scheme redemption ──
      // Two different things can come off a bill, and they land in different
      // places: an 'On Making' waiver is a discount, so it goes in before tax,
      // while the scheme's rupee (or gram) balance is money already banked as a
      // liability, so it settles the bill after tax.
      head.gss_amount = 0
      head.gss_weight = 0
      head.gss_return = num(head.gss_return)
      if (head.gss_id) {
        const acct = db.prepare(`SELECT * FROM gss_account WHERE id = ?`).get(head.gss_id)
        if (!acct) throw new Error('Scheme account not found')
        if (head.party_id && acct.party_id !== head.party_id) {
          throw new Error('That scheme belongs to a different customer')
        }
        const bal = gss.balance({
          id: head.gss_id, as_of: head.bill_date || today(),
          rate: num(head.gss_rate), exclude_sale_id: id ?? null,
        })

        // The making waiver is a discount, so it must be in before GST is taken.
        if (bal.making_disc_pct > 0) {
          const mk = calc.saleTotals({ ...head, making_discount: 0 }, items,
            payload.urds || [], payload.metals || []).totals.making_amount
          const waiver = calc.r2(mk * bal.making_disc_pct / 100)
          head.making_discount = calc.r2(Math.min(mk, num(head.making_discount) + waiver))
        }

        if (bal.weighted && num(head.gss_rate) <= 0) {
          throw new Error(`Enter the ${bal.metal} rate to value this scheme balance`)
        }
        // What the bill can absorb, once old gold and cash taken are allowed for.
        const t1 = calc.saleTotals({ ...head, gss_amount: 0 }, items,
          payload.urds || [], payload.metals || []).totals
        const payable = Math.max(0, calc.r2(
          t1.total_amount - t1.urd_amount - t1.amount_received))
        const wantAll = head.gss_redeem == null || head.gss_redeem === ''
        const asked = wantAll ? bal.redeem_value : num(head.gss_redeem)
        const applied = calc.r2(Math.max(0, Math.min(asked, bal.redeem_value, payable)))

        head.gss_amount = applied
        // Anything left over stays on the account for next time unless the
        // customer asks for it back in cash.
        head.gss_return = calc.r2(Math.max(0, Math.min(
          num(head.gss_return), calc.r2(bal.redeem_value - applied))))
        // Grams this bill consumes — both what it spent and what it handed back,
        // since either way those grams have left the account.
        head.gss_weight = bal.weighted
          ? calc.r3((applied + head.gss_return) / num(head.gss_rate)) : 0
      }

      // ── Card-swipe charges ──
      // The bank takes a percentage of a card payment. The shop decides how much
      // of that to pass on: the customer's share is added to the bill, the shop's
      // share is an expense it absorbs. Both are derived from the account marked
      // as the card-swap account, so changing the rate never rewrites old bills.
      head.card_charge_customer = 0
      head.card_charge_shop = 0
      // On a split bill only the card leg goes through the terminal, so that leg
      // alone is what the bank charges on — the cash half of a half-and-half
      // payment must not attract a swipe fee.
      const cardLeg = (payload.payments || [])
        .filter((p) => String(p.mode || '') === 'Card')
        .reduce((a, p) => a + Math.max(0, num(p.amount)), 0)
      const isSplit = (payload.payments || []).some((p) => num(p.amount) > 0)
      if (isSplit ? cardLeg > 0 : head.payment_mode === 'Card') {
        const card = db
          .prepare(`SELECT * FROM account WHERE is_card_swap = 1 ORDER BY id LIMIT 1`)
          .get()
        if (card) {
          const t0 = calc.saleTotals({ ...head, card_charge_customer: 0 }, items,
            payload.urds || [], payload.metals || []).totals
          // The fee is on what actually goes through the terminal. On a credit
          // bill nothing is swiped yet, so there is nothing for the bank to take
          // a cut of — charging a fee there would bill the customer for a card
          // they never presented.
          const swiped = isSplit
            ? cardLeg
            : num(head.amount_received) > 0
              ? num(head.amount_received)
              : head.is_credit
                ? 0
                : Math.max(0, t0.total_amount - t0.urd_amount - num(head.gss_amount))
          head.card_charge_customer = calc.r2(swiped * num(card.card_pct_customer) / 100)
          head.card_charge_shop = calc.r2(swiped * num(card.card_pct_shop) / 100)
        }
      }

      const computed = calc.saleTotals(
        head, items, payload.urds || [], payload.metals || []
      )
      const t = computed.totals
      // Points earned: a percentage of the bill's goods value, for members only.
      const loyalty_earned = party0 && party0.loyalty_enabled
        ? calc.r2(t.bill_amount * earnPct / 100) : 0

      let bill_no = head.bill_no

      if (id) {
        clearPostings(db, 'SALE', id)
        db.prepare(`UPDATE tag_stock SET status='IN_STOCK', sold_doc='' WHERE sold_doc = ?`)
          .run(`SALE:${id}`)
        db.prepare(`DELETE FROM sale_item WHERE sale_id = ?`).run(id)
        db.prepare(`DELETE FROM sale_urd  WHERE sale_id = ?`).run(id)
        db.prepare(`DELETE FROM sale_metal WHERE sale_id = ?`).run(id)
        db.prepare(`DELETE FROM sale_payment WHERE sale_id = ?`).run(id)
      } else {
        bill_no = nextDocNo('SALE', head.prefix || 'COM')
      }

      const row = {
        manual_no: '', due_date: '', party_id: null, party_name: '', address: '', mobile: '',
        area: '', state: 'Maharashtra', salesman: '', is_credit: 0, payment_mode: 'Cash',
        gst_not_required: 0, weightwise: 0, manual_urd_amount: 0, gss_id: null,
        // Set only when the money on this bill reached the books on an EARLIER
        // document — an order advance. The bill still shows it as received, so
        // the customer's balance is right, but the cash leg is not posted again:
        // it belongs to the day the customer actually paid, not to today.
        advance_posted: 0,
        ...head,
        bill_no,
        prefix: head.prefix || 'COM',
        bill_date: head.bill_date || today(),
        ...t,
        loyalty_earned, loyalty_redeemed,
      }
      row.is_credit = row.is_credit ? 1 : 0
      row.gst_not_required = row.gst_not_required ? 1 : 0
      row.weightwise = row.weightwise ? 1 : 0

      // ── how the money was tendered ──
      // Blank rows are the grid's normal resting state, so they are dropped
      // rather than treated as a zero-rupee payment. What survives has to add up
      // to what the bill says was received: a split that does not foot would put
      // money in the drawer the bill never took, and the shop would find it only
      // at closing time with no way to tell which bill was wrong.
      const splits = (payload.payments || [])
        .map((s) => ({
          mode: String(s.mode || 'Cash'),
          amount: calc.r2(Math.max(0, num(s.amount))),
          ref: String(s.ref || ''),
        }))
        .filter((s) => s.amount > 0)
      if (splits.length) {
        const tendered = calc.r2(splits.reduce((a, s) => a + s.amount, 0))
        if (Math.abs(tendered - t.amount_received) > 0.01) {
          throw new Error(
            `The payment split comes to ₹${tendered.toFixed(2)} but the bill shows ` +
            `₹${t.amount_received.toFixed(2)} received. Make the two agree before saving.`
          )
        }
        // With a split, the bill's single mode names the largest leg, so lists
        // and filters that show one mode per bill still show the main one.
        row.payment_mode = splits.reduce((a, s) => (s.amount > a.amount ? s : a)).mode
      }

      if (id) {
        db.prepare(
          `UPDATE sale SET manual_no=@manual_no, bill_date=@bill_date, due_date=@due_date,
           party_id=@party_id, party_name=@party_name, address=@address, mobile=@mobile,
           area=@area, state=@state, salesman=@salesman, is_credit=@is_credit,
           payment_mode=@payment_mode, gst_not_required=@gst_not_required, weightwise=@weightwise,
           goods_amount=@goods_amount, making_amount=@making_amount, hallmark_amount=@hallmark_amount,
           bill_amount=@bill_amount, gst_pct=@gst_pct, gst_amount=@gst_amount,
           bill_discount=@bill_discount, making_discount=@making_discount, other_amount=@other_amount,
           urd_amount=@urd_amount, manual_urd_amount=@manual_urd_amount, tcs_pct=@tcs_pct,
           tcs_amount=@tcs_amount, total_amount=@total_amount, amount_received=@amount_received,
           net_balance=@net_balance, loyalty_earned=@loyalty_earned,
           loyalty_redeemed=@loyalty_redeemed, loyalty_discount=@loyalty_discount,
           gss_id=@gss_id, gss_amount=@gss_amount, gss_weight=@gss_weight,
           gss_rate=@gss_rate, gss_return=@gss_return,
           card_charge_customer=@card_charge_customer, card_charge_shop=@card_charge_shop,
           making_disc_pct=@making_disc_pct WHERE id=@id`
        ).run(row)
      } else {
        id = db
          .prepare(
            `INSERT INTO sale (prefix, bill_no, manual_no, bill_date, due_date, party_id, party_name,
             address, mobile, area, state, salesman, is_credit, payment_mode, gst_not_required,
             weightwise, goods_amount, making_amount, hallmark_amount, bill_amount, gst_pct,
             gst_amount, bill_discount, making_discount, other_amount, urd_amount, manual_urd_amount,
             tcs_pct, tcs_amount, total_amount, amount_received, net_balance,
             loyalty_earned, loyalty_redeemed, loyalty_discount,
             gss_id, gss_amount, gss_weight, gss_rate, gss_return,
             card_charge_customer, card_charge_shop, making_disc_pct)
             VALUES (@prefix,@bill_no,@manual_no,@bill_date,@due_date,@party_id,@party_name,
             @address,@mobile,@area,@state,@salesman,@is_credit,@payment_mode,@gst_not_required,
             @weightwise,@goods_amount,@making_amount,@hallmark_amount,@bill_amount,@gst_pct,
             @gst_amount,@bill_discount,@making_discount,@other_amount,@urd_amount,
             @manual_urd_amount,@tcs_pct,@tcs_amount,@total_amount,@amount_received,@net_balance,
             @loyalty_earned,@loyalty_redeemed,@loyalty_discount,
             @gss_id,@gss_amount,@gss_weight,@gss_rate,@gss_return,
             @card_charge_customer,@card_charge_shop,@making_disc_pct)`
          )
          .run(row).lastInsertRowid
      }

      // ── line items + stock consumption ──
      const insItem = db.prepare(
        `INSERT INTO sale_item (sale_id, line_no, tag, tag_stock_id, item_id, item_name, hsn, qty,
         gross_wt, purity, stone_wt, stone_rate, stone_amount, diamond_wt, diamond_rate,
         diamond_amount, net_wt, rate_per_gm, mkg_per_gm, mkg_pct, mkg_amount, total_amount,
         hallmark_charges, huid, item_total, purchase_id)
         VALUES (@sale_id,@line_no,@tag,@tag_stock_id,@item_id,@item_name,@hsn,@qty,@gross_wt,
         @purity,@stone_wt,@stone_rate,@stone_amount,@diamond_wt,@diamond_rate,@diamond_amount,
         @net_wt,@rate_per_gm,@mkg_per_gm,@mkg_pct,@mkg_amount,@total_amount,
         @hallmark_charges,@huid,@item_total,@purchase_id)`
      )
      computed.items.forEach((l, i) => {
        // A tag_stock_id that names no piece would trip the line's foreign key
        // and surface as a bare "FOREIGN KEY constraint failed". Catch it here
        // so the shopkeeper is told which line is wrong, in words they can act
        // on, rather than a database error.
        if (l.tag_stock_id) {
          const known = db.prepare(`SELECT 1 FROM tag_stock WHERE id = ?`).get(l.tag_stock_id)
          if (!known) {
            throw new Error(
              `Line ${i + 1} (${l.item_name || l.tag || 'item'}) points at a tag that does not exist. ` +
              'Re-scan the piece.'
            )
          }
        }
        // An untagged line can name the purchase it was sold out of, so the
        // metal comes off that invoice's tally instead of just the loose pool.
        // Only a hand-typed metal line can: a tagged piece already belongs to
        // its purchase, and beads were never waiting for a label.
        const purchase_id = !l.tag_stock_id && !l.is_loose ? (num(l.purchase_id) || null) : null
        if (purchase_id) {
          const pu = db.prepare(`SELECT id, invoice_no, metal FROM purchase WHERE id = ?`).get(purchase_id)
          if (!pu) throw new Error(`Line ${i + 1}: that purchase no longer exists.`)
          if (pu.metal !== (l.metal || 'Gold')) {
            throw new Error(
              `Line ${i + 1}: ${pu.invoice_no} is a ${pu.metal} purchase — this line is ${l.metal || 'Gold'}.`
            )
          }
          const left = purchaseTally(db, purchase_id).pending_net
          if (num(l.net_wt) > left + 0.005) {
            throw new Error(
              `Line ${i + 1}: only ${left.toFixed(3)} g of ${pu.invoice_no} is still unlabelled — ` +
              `this line takes ${num(l.net_wt).toFixed(3)} g.`
            )
          }
        }
        insItem.run({
          tag: '', tag_stock_id: null, item_id: null, hsn: '', qty: 0, gross_wt: 0, purity: 0,
          stone_wt: 0, stone_rate: 0, stone_amount: 0, diamond_wt: 0, diamond_rate: 0,
          diamond_amount: 0, rate_per_gm: 0, mkg_per_gm: 0, mkg_pct: 0,
          hallmark_charges: 0, huid: '',
          ...l, sale_id: id, line_no: i + 1, purchase_id,
          // The grid clears the making fields to '' when the other one is used.
          // Those are REAL columns, so coerce rather than store an empty string.
          mkg_per_gm: num(l.mkg_per_gm), mkg_pct: num(l.mkg_pct),
        })
        // A loose item leaves the lot by weight — 10 g off the 100 g of mani.
        // There is no tag to mark sold, so this row IS the stock movement.
        if (l.is_loose) {
          const onHand = looseOnHand(db, l.item_id)
          if (num(l.gross_wt) > onHand) {
            throw new Error(
              `Line ${i + 1}: only ${onHand} g of ${l.item_name || 'this item'} is in stock — ` +
              `the bill takes ${num(l.gross_wt)} g.`
            )
          }
          postItemStock(db, {
            item_id: l.item_id, gross_wt: num(l.gross_wt), qty: num(l.qty),
            rate: num(l.rate_per_gm), amount: num(l.total_amount),
            doc_type: 'SALE', doc_id: id, doc_no: bill_no, direction: 'OUT',
            entry_date: row.bill_date,
          })
        }
        // Metal sold before it was ever tagged — a piece billed by hand out of
        // bought stock. It has no tag to flip, so this row is the stock
        // movement: the grams leave the loose pool, or the pool would go on
        // showing them on the shelf after they walked out with the customer.
        if (!l.tag_stock_id && !l.is_loose && num(l.net_wt) > 0) {
          db.prepare(
            `INSERT INTO loose_stock (metal, gross_wt, net_wt, fine_wt, doc_type, doc_id, doc_no,
             direction, is_tagged, entry_date) VALUES (?,?,?,?,'SALE',?,?,'OUT',0,?)`
          ).run(l.metal || 'Gold', num(l.gross_wt), num(l.net_wt),
                calc.fineWeight(num(l.net_wt), l.purity), id, bill_no, row.bill_date)
        }
        if (l.tag_stock_id) {
          // A physical piece can only be sold once. If it is no longer in stock the
          // UPDATE matches nothing — refuse the bill rather than silently double-sell.
          const res = db.prepare(
            `UPDATE tag_stock SET status='SOLD', sold_doc=? WHERE id=? AND status='IN_STOCK'`
          ).run(`SALE:${id}`, l.tag_stock_id)
          if (res.changes === 0) {
            const cur = db
              .prepare(`SELECT tag, status FROM tag_stock WHERE id = ?`)
              .get(l.tag_stock_id)
            throw new Error(
              cur
                ? `Tag ${cur.tag} is not in stock (${cur.status.toLowerCase().replace('_', ' ')}) — it cannot be billed again.`
                : 'That tagged piece no longer exists.'
            )
          }
          const ts = db
            .prepare(`SELECT final_wt FROM tag_stock WHERE id = ?`)
            .get(l.tag_stock_id)
          db.prepare(
            `INSERT INTO loose_stock (metal, gross_wt, net_wt, fine_wt, doc_type, doc_id, doc_no,
             direction, is_tagged, entry_date) VALUES (?,?,?,?,'SALE',?,?,'OUT',1,?)`
          ).run(l.metal || 'Gold', num(l.gross_wt), num(l.net_wt), num(ts?.final_wt), id, bill_no, row.bill_date)
        }
      })

      // ── old gold received from the customer ──
      const insUrd = db.prepare(
        `INSERT INTO sale_urd (sale_id, line_no, code, name, description, gross_wt, net_wt,
         purity, final_wt, rate, amount)
         VALUES (@sale_id,@line_no,@code,@name,@description,@gross_wt,@net_wt,@purity,@final_wt,
         @rate,@amount)`
      )
      computed.urds.forEach((u, i) => {
        insUrd.run({
          code: `MO${i + 1}`, name: 'Old Gold', description: '', gross_wt: 0, purity: 0, rate: 0,
          ...u, sale_id: id, line_no: i + 1,
        })
        db.prepare(
          `INSERT INTO loose_stock (metal, gross_wt, net_wt, fine_wt, doc_type, doc_id, doc_no,
           direction, is_urd, entry_date) VALUES ('Gold',?,?,?,'SALE',?,?,'IN',1,?)`
        ).run(num(u.gross_wt), num(u.net_wt), num(u.final_wt), id, bill_no, row.bill_date)
      })

      // ── weightwise settlement, one row per metal ──
      const insMetal = db.prepare(
        `INSERT INTO sale_metal (sale_id, metal, fine_sold, fine_urd, fine_wt,
         balance_wt, rate_per_gm, amount, pending_wt)
         VALUES (@sale_id,@metal,@fine_sold,@fine_urd,@fine_wt,
         @balance_wt,@rate_per_gm,@amount,@pending_wt)`
      )
      if (row.weightwise) {
        computed.metals.forEach((m) => insMetal.run({ ...m, sale_id: id }))
      }

      const insPay = db.prepare(
        `INSERT INTO sale_payment (sale_id, line_no, mode, amount, ref)
         VALUES (@sale_id,@line_no,@mode,@amount,@ref)`
      )
      splits.forEach((s, i) => insPay.run({ ...s, sale_id: id, line_no: i + 1 }))

      // ── money ledger (matches the demo's Account Display exactly) ──
      if (row.party_id) {
        const netSale = calc.r2(t.total_amount - t.urd_amount)
        if (netSale !== 0) {
          postLedger(db, {
            entry_date: row.bill_date, party_id: row.party_id, doc_type: 'SALE', doc_id: id,
            doc_no: bill_no, manual_no: row.manual_no || '',
            particulars: 'Sales Account', debit: netSale,
          })
        }
        if (t.amount_received > 0 && !row.advance_posted) {
          postLedger(db, {
            entry_date: row.bill_date, party_id: row.party_id, doc_type: 'SALE', doc_id: id,
            doc_no: bill_no, particulars: 'Cash Account', credit: t.amount_received,
          })
        }
        // Scheme money settles the customer's bill exactly like cash would.
        if (t.gss_amount > 0) {
          postLedger(db, {
            entry_date: row.bill_date, party_id: row.party_id, doc_type: 'SALE', doc_id: id,
            doc_no: bill_no, particulars: 'Gold Saving Scheme', credit: t.gss_amount,
          })
        }
      }
      // Money in, split by how it was tendered. A bill settled one way keeps a
      // single leg on the bill's own payment_mode; a split posts one leg per
      // mode, so the cash drawer and the bank each move by what actually
      // reached them instead of the whole bill landing in one of them.
      if (t.amount_received > 0 && !row.advance_posted) {
        for (const s of splits.length ? splits : [{ mode: row.payment_mode, amount: t.amount_received, ref: '' }]) {
          postLedger(db, {
            entry_date: row.bill_date, account_id: moneyAccountFor(db, s.mode),
            doc_type: 'SALE', doc_id: id, doc_no: bill_no,
            particulars: splits.length
              ? `${row.party_name || 'Counter Sale'} — ${s.mode}${s.ref ? ` (${s.ref})` : ''}`
              : (row.party_name || 'Counter Sale'),
            debit: s.amount,
          })
        }
      }
      // Redeeming releases the deposit the shop was holding: the liability falls
      // by everything the bill consumed, and any part handed back leaves the till.
      if (t.gss_amount + t.gss_return > 0) {
        postLedger(db, {
          entry_date: row.bill_date, account_id: accountIdByName(db, 'Gold Saving Scheme'),
          doc_type: 'SALE', doc_id: id, doc_no: bill_no,
          particulars: `${row.party_name || 'Customer'} — scheme redeemed`,
          debit: calc.r2(t.gss_amount + t.gss_return),
        })
      }
      // The shop's slice of the swipe fee is a real cost — it must reach the P&L,
      // so it posts to an expense head and out of the bank, like any other fee.
      if (t.card_charge_shop > 0) {
        postLedger(db, {
          entry_date: row.bill_date, account_id: accountIdByName(db, 'Card Charges'),
          doc_type: 'SALE', doc_id: id, doc_no: bill_no,
          particulars: `Card swipe on ${bill_no}`, debit: t.card_charge_shop,
        })
        postLedger(db, {
          entry_date: row.bill_date, account_id: accountIdByName(db, 'Bank Account'),
          doc_type: 'SALE', doc_id: id, doc_no: bill_no,
          particulars: 'Card swipe charges', credit: t.card_charge_shop,
        })
      }
      if (t.gss_return > 0) {
        postLedger(db, {
          entry_date: row.bill_date,
          account_id: moneyAccountFor(db, row.payment_mode),
          doc_type: 'SALE', doc_id: id, doc_no: bill_no,
          particulars: `${row.party_name || 'Customer'} — scheme balance returned`,
          credit: t.gss_return,
        })
      }

      // ── metal (fine weight) ledger, one row per metal ──
      // fine_out: what we handed the customer, split by the piece's metal.
      // fine_in : old gold (always gold) plus, on a weightwise bill, the part
      //           settled in cash — which has been paid for in rupees and so
      //           comes off the metal owed, leaving exactly the pending weight.
      const byMetal = new Map()
      const bump = (metal, key, v) => {
        const m = byMetal.get(metal) || { fine_in: 0, fine_out: 0 }
        m[key] += v
        byMetal.set(metal, m)
      }
      for (const l of computed.items) bump(l.metal || 'Gold', 'fine_out', calc.fineWeight(l.net_wt, l.purity))
      for (const u of computed.urds) bump('Gold', 'fine_in', num(u.final_wt))
      if (row.weightwise) {
        for (const m of computed.metals) bump(m.metal || 'Gold', 'fine_in', num(m.balance_wt))
      }
      if (row.party_id) {
        const ins = db.prepare(
          `INSERT INTO metal_entry (entry_date, party_id, metal, doc_type, doc_id, doc_no,
           particulars, fine_in, fine_out) VALUES (?,?,?,'SALE',?,?,?,?,?)`
        )
        for (const [metal, m] of byMetal) {
          if (calc.r3(m.fine_in) === 0 && calc.r3(m.fine_out) === 0) continue
          ins.run(row.bill_date, row.party_id, metal, id, bill_no,
                  row.weightwise ? 'Sale bill (weightwise)' : 'Sale bill',
                  calc.r3(m.fine_in), calc.r3(m.fine_out))
        }
      }

      return { id, bill_no }
    })
    return tx()
  },

  remove: ({ id }) => {
    const db = get()
    const tx = db.transaction(() => {
      clearPostings(db, 'SALE', id)
      db.prepare(`UPDATE tag_stock SET status='IN_STOCK', sold_doc='' WHERE sold_doc = ?`)
        .run(`SALE:${id}`)
      // Cancelling the bill an order became un-delivers the order, so it can be
      // billed again. Its advance is untouched — that money was received on the
      // order and never belonged to the bill. Left as DELIVERED the order would
      // be a dead end: no bill, and toInvoice refusing to make another one.
      db.prepare(
        `UPDATE order_booking SET status='RECEIVED', sale_id=NULL WHERE sale_id = ?`
      ).run(id)
      db.prepare(`DELETE FROM sale WHERE id = ?`).run(id)
      return true
    })
    return tx()
  },

  /** Everything the invoice print template needs, in one call. */
  forPrint: ({ id }) => {
    const db = get()
    const head = sale.read({ id })
    if (!head) return null
    const comp = company.read()
    const p = head.party_id ? db.prepare(`SELECT * FROM party WHERE id=?`).get(head.party_id) : null
    const pending = head.party_id ? party.balance({ id: head.party_id }).balance : 0
    return {
      company: comp,
      sale: head,
      party: p,
      pending_balance: pending,
      amount_in_words: calc.amountInWords(head.total_amount - head.urd_amount),
    }
  },
}

/* ───────────────────────── Old gold purchase (URD bill) ───────────────────────── */

/**
 * A customer sells old gold with nothing bought against it.
 *
 * The lines are the very same `sale_urd` rows a sale bill carries — keyed on
 * `urd_bill_id` instead of `sale_id` — so the URD stock, the Day Book's old
 * gold position and the Old Gold report all see both kinds in one place, and
 * nothing downstream has to know which way the metal came in.
 *
 * Money is the mirror of a sale: the shop owes the customer the bill's value,
 * pays some or all of it now out of cash or bank, and whatever is left sits on
 * the customer's khata as a credit (a negative balance), where a receipt
 * voucher or their next purchase clears it.
 */
const urd = {
  list: ({ from, to, search } = {}) => {
    const clauses = []
    if (from) clauses.push(`b.bill_date >= @from`)
    if (to) clauses.push(`b.bill_date <= @to`)
    if (search)
      clauses.push(`(b.bill_no LIKE '%'||@search||'%' OR b.party_name LIKE '%'||@search||'%')`)
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''
    return get()
      .prepare(
        `SELECT b.*,
                (b.purchase_amount - b.discount + b.other_amount) AS total_amount,
                (SELECT COALESCE(SUM(u.gross_wt),0) FROM sale_urd u WHERE u.urd_bill_id = b.id) gross_wt,
                (SELECT COALESCE(SUM(u.net_wt),0)   FROM sale_urd u WHERE u.urd_bill_id = b.id) net_wt,
                (SELECT COALESCE(SUM(u.final_wt),0) FROM sale_urd u WHERE u.urd_bill_id = b.id) fine_wt,
                (SELECT COUNT(*) FROM sale_urd u WHERE u.urd_bill_id = b.id) lines
         FROM urd_bill b ${where} ORDER BY b.bill_date DESC, b.id DESC LIMIT 500`
      )
      .all({ from: from ?? '', to: to ?? '', search: search ?? '' })
  },

  read: ({ id }) => {
    const db = get()
    const head = db.prepare(`SELECT * FROM urd_bill WHERE id = ?`).get(id)
    if (!head) return null
    head.total_amount = calc.r2(
      num(head.purchase_amount) - num(head.discount) + num(head.other_amount))
    head.urds = db
      .prepare(`SELECT * FROM sale_urd WHERE urd_bill_id = ? ORDER BY line_no`)
      .all(id)
    return head
  },

  /**
   * Create or update an old gold bill. Side effects: consumes a bill number,
   * books the metal into URD loose stock, and posts the money and metal ledgers.
   */
  save: (payload) => {
    const db = get()
    const tx = db.transaction(() => {
      const head = payload.head || {}
      const computed = calc.urdTotals(head, payload.urds || [])
      const t = computed.totals
      if (!computed.urds.length) {
        throw new Error('Add at least one old gold line with a weight, purity and rate')
      }
      if (t.amount_given > t.total_amount + 0.005) {
        throw new Error(
          `Paying ₹${t.amount_given.toFixed(2)} on a bill worth ₹${t.total_amount.toFixed(2)} — ` +
          'the customer is owed less than that.'
        )
      }
      // A balance has to sit on somebody's khata. With no customer on the bill
      // there is nobody to owe, so it must be settled on the spot.
      if (!head.party_id && Math.abs(t.net_balance) >= 0.005) {
        throw new Error('Select a customer to leave a balance on their khata, or pay the bill in full.')
      }

      let id = head.id
      let bill_no = head.bill_no
      if (id) {
        clearPostings(db, 'URD', id)
        db.prepare(`DELETE FROM sale_urd WHERE urd_bill_id = ?`).run(id)
      } else {
        bill_no = nextDocNo('URD', head.prefix || 'O')
      }

      const row = {
        manual_no: '', party_id: null, party_name: '', by_hand: '', address: '', mobile: '',
        state: 'Maharashtra', narration: '',
        ...head,
        prefix: head.prefix || 'O',
        bill_no,
        bill_date: head.bill_date || today(),
        payment_mode: head.payment_mode || 'Cash',
        is_credit: t.net_balance > 0.005 ? 1 : 0,
        purchase_amount: t.purchase_amount, sub_tax: 0, discount: t.discount,
        other_amount: t.other_amount, gst_amount: 0,
        amount_given: t.amount_given, net_balance: t.net_balance,
      }

      if (id) {
        db.prepare(
          `UPDATE urd_bill SET manual_no=@manual_no, bill_date=@bill_date, party_id=@party_id,
           party_name=@party_name, by_hand=@by_hand, address=@address, mobile=@mobile,
           state=@state, is_credit=@is_credit, purchase_amount=@purchase_amount,
           sub_tax=@sub_tax, discount=@discount, other_amount=@other_amount,
           gst_amount=@gst_amount, amount_given=@amount_given, net_balance=@net_balance,
           payment_mode=@payment_mode, narration=@narration WHERE id=@id`
        ).run(row)
      } else {
        id = db
          .prepare(
            `INSERT INTO urd_bill (prefix, bill_no, manual_no, bill_date, party_id, party_name,
             by_hand, address, mobile, state, is_credit, purchase_amount, sub_tax, discount,
             other_amount, gst_amount, amount_given, net_balance, payment_mode, narration)
             VALUES (@prefix,@bill_no,@manual_no,@bill_date,@party_id,@party_name,@by_hand,
             @address,@mobile,@state,@is_credit,@purchase_amount,@sub_tax,@discount,
             @other_amount,@gst_amount,@amount_given,@net_balance,@payment_mode,@narration)`
          )
          .run(row).lastInsertRowid
      }

      // ── the metal, line by line, into URD loose stock ──
      const insUrd = db.prepare(
        `INSERT INTO sale_urd (sale_id, urd_bill_id, line_no, code, name, description, gross_wt,
         net_wt, purity, final_wt, rate, amount)
         VALUES (NULL,@urd_bill_id,@line_no,@code,@name,@description,@gross_wt,@net_wt,@purity,
         @final_wt,@rate,@amount)`
      )
      computed.urds.forEach((u, i) => {
        insUrd.run({
          code: `MO${i + 1}`, name: 'Old Gold', description: '', gross_wt: 0, purity: 0, rate: 0,
          ...u, urd_bill_id: id, line_no: i + 1,
        })
        db.prepare(
          `INSERT INTO loose_stock (metal, gross_wt, net_wt, fine_wt, doc_type, doc_id, doc_no,
           direction, is_urd, entry_date) VALUES ('Gold',?,?,?,'URD',?,?,'IN',1,?)`
        ).run(num(u.gross_wt), num(u.net_wt), num(u.final_wt), id, bill_no, row.bill_date)
      })

      // ── money ──
      // The customer's khata: we owe them the bill (credit), and what we handed
      // over comes back off it (debit). A fully paid bill nets to nothing but
      // still shows both legs, so the ledger reads as what actually happened.
      if (row.party_id) {
        postLedger(db, {
          entry_date: row.bill_date, party_id: row.party_id, doc_type: 'URD', doc_id: id,
          doc_no: bill_no, manual_no: row.manual_no || '',
          particulars: 'Old Gold Purchase', credit: t.total_amount,
        })
        if (t.amount_given > 0) {
          postLedger(db, {
            entry_date: row.bill_date, party_id: row.party_id, doc_type: 'URD', doc_id: id,
            doc_no: bill_no,
            particulars: CASH_MODES.has(row.payment_mode) ? 'Cash Account' : 'Bank Account',
            debit: t.amount_given,
          })
        }
      }
      // Money out of the drawer or the bank.
      if (t.amount_given > 0) {
        postLedger(db, {
          entry_date: row.bill_date, account_id: moneyAccountFor(db, row.payment_mode),
          doc_type: 'URD', doc_id: id, doc_no: bill_no,
          particulars: `${row.party_name || 'Old gold purchase'} — old gold`,
          credit: t.amount_given,
        })
      }

      // ── metal: the customer handed us gold ──
      if (row.party_id && t.total_fine_wt > 0) {
        db.prepare(
          `INSERT INTO metal_entry (entry_date, party_id, metal, doc_type, doc_id, doc_no,
           particulars, fine_in, fine_out) VALUES (?,?,'Gold','URD',?,?,?,?,0)`
        ).run(row.bill_date, row.party_id, id, bill_no, 'Old gold purchase', t.total_fine_wt)
      }

      return { id, bill_no }
    })
    return tx()
  },

  remove: ({ id }) => {
    const db = get()
    const tx = db.transaction(() => {
      clearPostings(db, 'URD', id)
      db.prepare(`DELETE FROM sale_urd WHERE urd_bill_id = ?`).run(id)
      db.prepare(`DELETE FROM urd_bill WHERE id = ?`).run(id)
      return true
    })
    return tx()
  },

  /** Everything the old gold bill print needs, in one call. */
  forPrint: ({ id }) => {
    const db = get()
    const bill = urd.read({ id })
    if (!bill) return null
    return {
      company: company.read(),
      bill,
      party: bill.party_id ? db.prepare(`SELECT * FROM party WHERE id=?`).get(bill.party_id) : null,
      pending_balance: bill.party_id ? party.balance({ id: bill.party_id }).balance : 0,
      amount_in_words: calc.amountInWords(bill.total_amount),
    }
  },
}

/* ───────────────────────────── Purchase ───────────────────────────── */

/**
 * Purchase ↔ label tally.
 *
 * What the invoice brought in (the Material-In metal lines) against the tagged
 * pieces that were made from it. Loose weight-wise items (mani, fuli) are left
 * out of the bought side: they are never labelled, they are sold by the gram.
 *
 * The decision is taken on NET weight — gross carries stones and beads that a
 * piece may or may not be weighed with, and fine carries the supplier's
 * wastage, which the tags never do.
 */
function purchaseTally(db, id) {
  const bought = db.prepare(
    `SELECT COUNT(*) lines,
            COALESCE(SUM(pi.gross_wt),0) gross, COALESCE(SUM(pi.net_wt),0) net,
            COALESCE(SUM(pi.fine_plus_wastage),0) fine
     FROM purchase_item pi LEFT JOIN item i ON i.id = pi.item_id
     WHERE pi.purchase_id = ? AND pi.direction = 'IN'
       AND COALESCE(i.stock_mode, 'TAG') <> 'LOOSE_WT'`
  ).get(id)
  const tagged = db.prepare(
    `SELECT COUNT(*) pieces,
            COALESCE(SUM(gross_wt),0) gross, COALESCE(SUM(net_wt),0) net,
            COALESCE(SUM(final_wt),0) fine,
            COALESCE(SUM(CASE WHEN status = 'SOLD' THEN 1 ELSE 0 END),0) sold
     FROM tag_stock WHERE purchase_id = ?`
  ).get(id)
  // Metal sold untagged straight off this invoice — a bill line that named the
  // purchase it came from. It never got a label, but it has left the shop, so
  // it is no longer waiting for one.
  const soldLoose = db.prepare(
    `SELECT COUNT(*) lines,
            COALESCE(SUM(gross_wt),0) gross, COALESCE(SUM(net_wt),0) net,
            COALESCE(SUM(net_wt * purity / 100),0) fine
     FROM sale_item WHERE purchase_id = ? AND tag_stock_id IS NULL`
  ).get(id)
  const pending_gross = calc.r3(bought.gross - tagged.gross - soldLoose.gross)
  const pending_net = calc.r3(bought.net - tagged.net - soldLoose.net)
  const status = bought.net <= 0.0005
    ? 'NONE'
    : Math.abs(pending_net) <= 0.005 ? 'TALLIED'
    : pending_net > 0 ? 'PENDING' : 'OVER'
  return {
    bought_lines: bought.lines,
    bought_gross: calc.r3(bought.gross), bought_net: calc.r3(bought.net),
    bought_fine: calc.r3(bought.fine),
    tagged_pieces: tagged.pieces, tagged_sold: tagged.sold,
    tagged_gross: calc.r3(tagged.gross), tagged_net: calc.r3(tagged.net),
    tagged_fine: calc.r3(tagged.fine),
    sold_loose_lines: soldLoose.lines,
    sold_loose_gross: calc.r3(soldLoose.gross), sold_loose_net: calc.r3(soldLoose.net),
    sold_loose_fine: calc.r3(soldLoose.fine),
    pending_gross, pending_net, status,
  }
}

const purchase = {
  list: ({ from, to, search } = {}) => {
    const clauses = []
    if (from) clauses.push(`p.invoice_date >= @from`)
    if (to) clauses.push(`p.invoice_date <= @to`)
    if (search) clauses.push(`(p.invoice_no LIKE '%'||@search||'%' OR p.party_name LIKE '%'||@search||'%')`)
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''
    const db = get()
    // Weight on the register, not just money: gross / net / fine of what came
    // in, and what the invoice has been labelled up to.
    return db
      .prepare(
        `SELECT p.*,
                (SELECT COALESCE(SUM(gross_wt),0) FROM purchase_item
                  WHERE purchase_id = p.id AND direction = 'IN') AS in_gross_wt,
                (SELECT COALESCE(SUM(net_wt),0) FROM purchase_item
                  WHERE purchase_id = p.id AND direction = 'IN') AS in_net_wt,
                (SELECT COALESCE(SUM(fine_plus_wastage),0) FROM purchase_item
                  WHERE purchase_id = p.id AND direction = 'IN') AS in_fine_wt,
                (SELECT COALESCE(SUM(fine_plus_wastage),0) FROM purchase_item
                  WHERE purchase_id = p.id AND direction = 'OUT') AS out_fine_wt
         FROM purchase p ${where} ORDER BY p.invoice_date DESC, p.id DESC LIMIT 500`
      )
      .all({ from: from ?? '', to: to ?? '', search: search ?? '' })
      .map((r) => ({ ...r, tally: purchaseTally(db, r.id) }))
  },

  /** The tally for one invoice, plus the pieces made from it. */
  tally: ({ id }) => {
    const db = get()
    return {
      ...purchaseTally(db, id),
      tags: db.prepare(
        `SELECT ts.id, ts.tag, ts.gross_wt, ts.net_wt, ts.purity, ts.final_wt, ts.status,
                ts.entry_date, i.name AS item_name
         FROM tag_stock ts JOIN item i ON i.id = ts.item_id
         WHERE ts.purchase_id = ? ORDER BY ts.tag`
      ).all(id),
      loose_sales: db.prepare(
        `SELECT si.id, si.item_name, si.gross_wt, si.net_wt, si.purity,
                s.bill_no, s.bill_date, s.party_name
         FROM sale_item si JOIN sale s ON s.id = si.sale_id
         WHERE si.purchase_id = ? AND si.tag_stock_id IS NULL
         ORDER BY s.bill_date, s.id, si.line_no`
      ).all(id),
    }
  },

  /**
   * Purchases that still have metal waiting to be labelled — what the tag
   * screen offers when pieces are made "from a purchase". Newest first.
   */
  openForTagging: ({ metal } = {}) => {
    const db = get()
    return db
      .prepare(
        `SELECT id, invoice_no, invoice_date, party_name, metal FROM purchase
         ${metal ? 'WHERE metal = @metal' : ''}
         ORDER BY invoice_date DESC, id DESC LIMIT 300`
      )
      .all({ metal: metal ?? '' })
      .map((p) => ({ ...p, ...purchaseTally(db, p.id) }))
      .filter((p) => p.status === 'PENDING' || p.status === 'OVER')
  },

  read: ({ id }) => {
    const db = get()
    const head = db.prepare(`SELECT * FROM purchase WHERE id = ?`).get(id)
    if (!head) return null
    head.tally = purchaseTally(db, id)
    // is_loose is not stored — it belongs to the item master, which can only have
    // one answer — but the screen needs it to price the line the same way the
    // save did, so it is derived on the way out.
    head.items = db
      .prepare(`SELECT * FROM purchase_item WHERE purchase_id = ? ORDER BY line_no`)
      .all(id)
      .map((l) => ({ ...l, is_loose: isLooseItem(db, l.item_id) ? 1 : 0 }))
    return head
  },

  save: (payload) => {
    const db = get()
    const tx = db.transaction(() => {
      const { head } = payload
      // Stamp the loose lines before the totals are taken. The purchase screen
      // seeds a line's purity from the item's group, so a bead line arrives
      // carrying 91.6 unless it is marked here — and that purity is what would
      // otherwise price it and push it onto the supplier's gold khata.
      const lines = (payload.items || []).map((l) => ({
        ...l, is_loose: isLooseItem(db, l.item_id) ? 1 : 0,
      }))
      const computed = calc.purchaseTotals(head, lines)
      const t = computed.totals

      let id = head.id
      let invoice_no = head.invoice_no
      if (id) {
        clearPostings(db, 'PURCHASE', id)
        db.prepare(`DELETE FROM purchase_item WHERE purchase_id = ?`).run(id)
      } else {
        invoice_no = nextDocNo('PURCHASE', head.prefix || 'MI')
      }

      const row = {
        manual_no: '', party_id: null, party_name: '', remark: '', state: 'Maharashtra',
        is_credit: 1, gst_not_required: 0, metal: 'Gold',
        ...head, invoice_no, prefix: head.prefix || 'MI',
        invoice_date: head.invoice_date || today(), ...t,
      }
      row.is_credit = row.is_credit ? 1 : 0
      row.gst_not_required = row.gst_not_required ? 1 : 0

      if (id) {
        db.prepare(
          `UPDATE purchase SET manual_no=@manual_no, invoice_date=@invoice_date, party_id=@party_id,
           party_name=@party_name, remark=@remark, state=@state, metal=@metal, is_credit=@is_credit,
           gst_not_required=@gst_not_required, purchase_amount=@purchase_amount, discount=@discount,
           return_amount=@return_amount, gst_pct=@gst_pct, gst_amount=@gst_amount, sub_tax=@sub_tax,
           tcs_pct=@tcs_pct, tcs_amount=@tcs_amount, bill_amount=@bill_amount,
           paid_amount=@paid_amount, paid_fine_wt=@paid_fine_wt, paid_fine_rate=@paid_fine_rate,
           paid_fine_amount=@paid_fine_amount, net_balance=@net_balance WHERE id=@id`
        ).run(row)
      } else {
        id = db
          .prepare(
            `INSERT INTO purchase (prefix, invoice_no, manual_no, invoice_date, party_id, party_name,
             remark, state, metal, is_credit, gst_not_required, purchase_amount, discount, return_amount,
             gst_pct, gst_amount, sub_tax, tcs_pct, tcs_amount, bill_amount, paid_amount,
             paid_fine_wt, paid_fine_rate, paid_fine_amount, net_balance)
             VALUES (@prefix,@invoice_no,@manual_no,@invoice_date,@party_id,@party_name,@remark,
             @state,@metal,@is_credit,@gst_not_required,@purchase_amount,@discount,@return_amount,@gst_pct,
             @gst_amount,@sub_tax,@tcs_pct,@tcs_amount,@bill_amount,@paid_amount,
             @paid_fine_wt,@paid_fine_rate,@paid_fine_amount,@net_balance)`
          )
          .run(row).lastInsertRowid
      }

      const insItem = db.prepare(
        `INSERT INTO purchase_item (purchase_id, line_no, direction, item_id, item_name, qty,
         gross_wt, black_beads, stone_wt, net_wt, purity, rate, amount, wastage_pct,
         fine_plus_wastage, hallmark_charges, hallmark_amount, huid)
         VALUES (@purchase_id,@line_no,@direction,@item_id,@item_name,@qty,@gross_wt,@black_beads,
         @stone_wt,@net_wt,@purity,@rate,@amount,@wastage_pct,@fine_plus_wastage,
         @hallmark_charges,@hallmark_amount,@huid)`
      )
      computed.items.forEach((l, i) => {
        insItem.run({
          direction: 'IN', item_id: null, qty: 0, gross_wt: 0, black_beads: 0, stone_wt: 0,
          purity: 0, rate: 0, wastage_pct: 0, hallmark_charges: 0, hallmark_amount: 0, huid: '',
          ...l, purchase_id: id, line_no: i + 1,
        })
        // Mani bought as a 100 g lot is stocked against the item, by weight. It is
        // not metal, so it must not also land in loose_stock — that would add
        // beads to the shop's gold position.
        if (isLooseItem(db, l.item_id)) {
          postItemStock(db, {
            item_id: l.item_id, gross_wt: num(l.gross_wt), qty: num(l.qty),
            rate: num(l.rate), amount: num(l.amount),
            doc_type: 'PURCHASE', doc_id: id, doc_no: invoice_no,
            direction: l.direction === 'OUT' ? 'OUT' : 'IN',
            entry_date: row.invoice_date,
          })
        } else {
          db.prepare(
            `INSERT INTO loose_stock (metal, gross_wt, net_wt, fine_wt, doc_type, doc_id, doc_no,
             direction, entry_date) VALUES (?,?,?,?,'PURCHASE',?,?,?,?)`
          ).run(row.metal, num(l.gross_wt), num(l.net_wt), num(l.fine_plus_wastage), id, invoice_no,
                l.direction === 'OUT' ? 'OUT' : 'IN', row.invoice_date)
        }
      })

      if (row.party_id) {
        // In a metal exchange the bill can swing negative — we handed back more
        // value than we took in, so the supplier owes us. Post it on the right side.
        if (t.bill_amount >= 0) {
          postLedger(db, {
            entry_date: row.invoice_date, party_id: row.party_id, doc_type: 'PURCHASE',
            doc_id: id, doc_no: invoice_no, particulars: 'Purchase Account',
            credit: t.bill_amount,
          })
        } else {
          postLedger(db, {
            entry_date: row.invoice_date, party_id: row.party_id, doc_type: 'PURCHASE',
            doc_id: id, doc_no: invoice_no, particulars: 'Material Returned',
            debit: Math.abs(t.bill_amount),
          })
        }
        if (t.paid_amount > 0) {
          postLedger(db, {
            entry_date: row.invoice_date, party_id: row.party_id, doc_type: 'PURCHASE',
            doc_id: id, doc_no: invoice_no, particulars: 'Cash Account', debit: t.paid_amount,
          })
        }
        // Paid in fine metal: the value comes off what we owe, exactly as cash
        // would. The grams themselves are posted below — on the gold khata and
        // out of the loose pool — so this is the money leg only.
        if (t.paid_fine_amount > 0) {
          postLedger(db, {
            entry_date: row.invoice_date, party_id: row.party_id, doc_type: 'PURCHASE',
            doc_id: id, doc_no: invoice_no,
            particulars: `Paid in fine ${t.paid_fine_wt.toFixed(3)} g @ ${t.paid_fine_rate}`,
            debit: t.paid_fine_amount,
          })
        }
      }
      if (t.paid_amount > 0) {
        postLedger(db, {
          entry_date: row.invoice_date, account_id: accountIdByName(db, 'Cash Account'),
          doc_type: 'PURCHASE', doc_id: id, doc_no: invoice_no,
          particulars: row.party_name || 'Purchase', credit: t.paid_amount,
        })
      }
      if (t.paid_fine_wt > 0) {
        // The metal handed over leaves the shop's loose pool of that metal.
        db.prepare(
          `INSERT INTO loose_stock (metal, gross_wt, net_wt, fine_wt, doc_type, doc_id, doc_no,
           direction, entry_date) VALUES (?,?,?,?,'PURCHASE',?,?,'OUT',?)`
        ).run(row.metal, t.paid_fine_wt, t.paid_fine_wt, t.paid_fine_wt, id, invoice_no,
              row.invoice_date)
      }

      // ── Metal (fine weight) khata ──
      // fine_in  = metal that came into the shop from this party
      // fine_out = metal the shop handed to them
      if (row.party_id && (t.in_fine_wt || t.out_fine_wt)) {
        db.prepare(
          `INSERT INTO metal_entry (entry_date, party_id, metal, doc_type, doc_id, doc_no,
           particulars, fine_in, fine_out) VALUES (?,?,?,'PURCHASE',?,?,?,?,?)`
        ).run(row.invoice_date, row.party_id, row.metal, id, invoice_no,
              t.is_exchange ? 'Metal exchange' : 'Purchase',
              t.in_fine_wt, t.out_fine_wt)
      }
      // Fine given as payment is its own line on the khata, so the supplier's
      // statement reads "purchase 100 g, paid 60 g" rather than a single net.
      if (row.party_id && t.paid_fine_wt > 0) {
        db.prepare(
          `INSERT INTO metal_entry (entry_date, party_id, metal, doc_type, doc_id, doc_no,
           particulars, fine_in, fine_out) VALUES (?,?,?,'PURCHASE',?,?,?,0,?)`
        ).run(row.invoice_date, row.party_id, row.metal, id, invoice_no,
              'Paid in fine', t.paid_fine_wt)
      }

      return { id, invoice_no, tally: purchaseTally(db, id) }
    })
    return tx()
  },

  remove: ({ id }) => {
    const db = get()
    const tx = db.transaction(() => {
      clearPostings(db, 'PURCHASE', id)
      db.prepare(`DELETE FROM purchase WHERE id = ?`).run(id)
      return true
    })
    return tx()
  },
}

/* ───────────────────────────── Refining ─────────────────────────────
   OUT = scrap/old metal sent to the refiner (leaves our stock).
   IN  = refined pure metal received back (enters our stock).
   The money side is the refiner's charges, posted against their account. */

const refinery = {
  list: ({ from, to, direction } = {}) => {
    const clauses = []
    if (from) clauses.push(`r.invoice_date >= @from`)
    if (to) clauses.push(`r.invoice_date <= @to`)
    if (direction && direction !== 'ALL') clauses.push(`r.direction = @direction`)
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''
    return get()
      .prepare(
        `SELECT r.*,
           COALESCE((SELECT SUM(i.fine_wt)  FROM refinery_item i WHERE i.refinery_id = r.id), 0) AS total_fine_wt,
           COALESCE((SELECT SUM(i.gross_wt) FROM refinery_item i WHERE i.refinery_id = r.id), 0) AS total_gross_wt
         FROM refinery r ${where}
         ORDER BY r.invoice_date DESC, r.id DESC LIMIT 500`
      )
      .all({ from: from ?? '', to: to ?? '', direction: direction ?? '' })
  },

  read: ({ id }) => {
    const db = get()
    const head = db.prepare(`SELECT * FROM refinery WHERE id = ?`).get(id)
    if (!head) return null
    head.items = db
      .prepare(`SELECT * FROM refinery_item WHERE refinery_id = ? ORDER BY line_no`)
      .all(id)
    return head
  },

  save: (payload) => {
    const db = get()
    const tx = db.transaction(() => {
      const { head } = payload
      const computed = calc.refineryTotals(head, payload.items || [])
      const t = computed.totals

      let id = head.id
      let invoice_no = head.invoice_no
      if (id) {
        clearPostings(db, 'REFINERY', id)
        db.prepare(`DELETE FROM refinery_item WHERE refinery_id = ?`).run(id)
      } else {
        invoice_no = nextDocNo('REFINERY', head.prefix || 'MO')
      }

      const row = {
        manual_no: '', party_id: null, party_name: '', remark: '', state: 'Maharashtra',
        is_credit: 1, direction: 'OUT', metal: 'Gold',
        ...head, invoice_no, prefix: head.prefix || 'MO',
        invoice_date: head.invoice_date || today(), ...t,
      }
      row.is_credit = row.is_credit ? 1 : 0

      if (id) {
        db.prepare(
          `UPDATE refinery SET manual_no=@manual_no, invoice_date=@invoice_date, direction=@direction,
           party_id=@party_id, party_name=@party_name, remark=@remark, state=@state, metal=@metal,
           is_credit=@is_credit, bill_amount=@bill_amount, discount=@discount, sub_tax=@sub_tax,
           gst_amount=@gst_amount, paid_amount=@paid_amount, net_balance=@net_balance WHERE id=@id`
        ).run(row)
      } else {
        id = db
          .prepare(
            `INSERT INTO refinery (prefix, invoice_no, manual_no, invoice_date, direction, party_id,
             party_name, remark, state, metal, is_credit, bill_amount, discount, sub_tax, gst_amount,
             paid_amount, net_balance)
             VALUES (@prefix,@invoice_no,@manual_no,@invoice_date,@direction,@party_id,@party_name,
             @remark,@state,@metal,@is_credit,@bill_amount,@discount,@sub_tax,@gst_amount,@paid_amount,
             @net_balance)`
          )
          .run(row).lastInsertRowid
      }

      const insItem = db.prepare(
        `INSERT INTO refinery_item (refinery_id, line_no, tag, item_id, item_name, qty, gross_wt,
         black_beads, stone_wt, net_wt, purity, fine_wt, rate_per_gm, amount, gross_wastage)
         VALUES (@refinery_id,@line_no,@tag,@item_id,@item_name,@qty,@gross_wt,@black_beads,
         @stone_wt,@net_wt,@purity,@fine_wt,@rate_per_gm,@amount,@gross_wastage)`
      )
      const dir = row.direction === 'IN' ? 'IN' : 'OUT'
      computed.items.forEach((l, i) => {
        insItem.run({
          tag: '', item_id: null, qty: 0, gross_wt: 0, black_beads: 0, stone_wt: 0,
          purity: 0, rate_per_gm: 0, gross_wastage: 0,
          ...l, refinery_id: id, line_no: i + 1,
        })
        // Sending a tagged piece for melting takes it out of the tagged pool;
        // loose scrap sent out comes from the loose pool.
        db.prepare(
          `INSERT INTO loose_stock (metal, gross_wt, net_wt, fine_wt, doc_type, doc_id, doc_no,
           direction, is_tagged, entry_date) VALUES (?,?,?,?,'REFINERY',?,?,?,?,?)`
        ).run(row.metal, num(l.gross_wt), num(l.net_wt), num(l.fine_wt), id, invoice_no, dir,
              dir === 'OUT' && l.tag ? 1 : 0, row.invoice_date)

        // A tag sent for melting leaves the tagged-stock pool for good — but only
        // if it is actually in stock. Melting something already sold would create
        // metal out of nothing.
        if (dir === 'OUT' && l.tag) {
          const res = db.prepare(
            `UPDATE tag_stock SET status='MELTED', sold_doc=? WHERE tag=? AND status='IN_STOCK'`
          ).run(`REFINERY:${id}`, l.tag)
          if (res.changes === 0) {
            const cur = db.prepare(`SELECT status FROM tag_stock WHERE tag = ?`).get(l.tag)
            if (cur) {
              throw new Error(
                `Tag ${l.tag} is not in stock (${cur.status.toLowerCase().replace('_', ' ')}) — it cannot be sent for refining.`
              )
            }
          }
        }
      })

      if (row.party_id) {
        const fine = calc.r3(computed.items.reduce((s, l) => s + num(l.fine_wt), 0))
        db.prepare(
          `INSERT INTO metal_entry (entry_date, party_id, metal, doc_type, doc_id, doc_no,
           particulars, fine_in, fine_out) VALUES (?,?,?,'REFINERY',?,?,?,?,?)`
        ).run(row.invoice_date, row.party_id, row.metal, id, invoice_no,
              dir === 'OUT' ? 'Sent for refining' : 'Received from refining',
              dir === 'IN' ? fine : 0, dir === 'OUT' ? fine : 0)

        if (t.bill_amount !== 0) {
          postLedger(db, {
            entry_date: row.invoice_date, party_id: row.party_id, doc_type: 'REFINERY',
            doc_id: id, doc_no: invoice_no, manual_no: row.manual_no,
            particulars: 'Refining Charges', credit: t.bill_amount,
          })
        }
        if (t.paid_amount > 0) {
          postLedger(db, {
            entry_date: row.invoice_date, party_id: row.party_id, doc_type: 'REFINERY',
            doc_id: id, doc_no: invoice_no, particulars: 'Cash Account', debit: t.paid_amount,
          })
        }
      }
      if (t.paid_amount > 0) {
        postLedger(db, {
          entry_date: row.invoice_date, account_id: accountIdByName(db, 'Cash Account'),
          doc_type: 'REFINERY', doc_id: id, doc_no: invoice_no,
          particulars: row.party_name || 'Refining', credit: t.paid_amount,
        })
      }

      return { id, invoice_no }
    })
    return tx()
  },

  remove: ({ id }) => {
    const db = get()
    const tx = db.transaction(() => {
      clearPostings(db, 'REFINERY', id)
      db.prepare(`UPDATE tag_stock SET status='IN_STOCK', sold_doc='' WHERE sold_doc = ?`)
        .run(`REFINERY:${id}`)
      db.prepare(`DELETE FROM refinery WHERE id = ?`).run(id)
      return true
    })
    return tx()
  },
}

/* ───────────────────────────── Karagir orders ───────────────────────────── */

const order = {
  list: ({ from, to, status, search } = {}) => {
    const clauses = []
    if (from) clauses.push(`order_date >= @from`)
    if (to) clauses.push(`order_date <= @to`)
    if (status && status !== 'ALL') clauses.push(`status = @status`)
    if (search) clauses.push(`(order_no LIKE '%'||@search||'%' OR party_name LIKE '%'||@search||'%')`)
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''
    return get()
      .prepare(
        `SELECT o.*, k.name AS karagir_name FROM order_booking o
         LEFT JOIN party k ON k.id = o.karagir_id
         ${where} ORDER BY o.order_date DESC, o.id DESC LIMIT 500`
      )
      .all({ from: from ?? '', to: to ?? '', status: status ?? '', search: search ?? '' })
  },

  read: ({ id }) => {
    const db = get()
    const head = db.prepare(`SELECT * FROM order_booking WHERE id = ?`).get(id)
    if (!head) return null
    head.items = db
      .prepare(`SELECT * FROM order_item WHERE order_id = ? ORDER BY line_no`)
      .all(id)
    head.urds = db
      .prepare(`SELECT * FROM order_urd WHERE order_id = ? ORDER BY line_no`)
      .all(id)
    return head
  },

  save: (payload) => {
    const db = get()
    const tx = db.transaction(() => {
      const { head } = payload
      if (!head.party_id) throw new Error('An order needs a customer.')
      const computed = calc.orderTotals(head, payload.items || [], payload.urds || [])
      const t = computed.totals

      let id = head.id
      let order_no = head.order_no
      if (id) {
        clearPostings(db, 'ORDER', id)
        db.prepare(`DELETE FROM order_item WHERE order_id = ?`).run(id)
        db.prepare(`DELETE FROM order_urd WHERE order_id = ?`).run(id)
      } else {
        order_no = nextDocNo('ORDER', head.prefix || 'NO')
      }

      const row = {
        delivery_date: '', karagir_date: '', party_id: null, party_name: '',
        karagir_id: null, remark: '', status: 'BOOKED',
        ...head, order_no, prefix: head.prefix || 'NO',
        order_date: head.order_date || today(),
        total_amount: t.total_amount,
        advance_amount: t.advance_amount,
        balance_amount: t.balance_amount,
      }

      if (id) {
        db.prepare(
          `UPDATE order_booking SET order_date=@order_date, delivery_date=@delivery_date,
           karagir_date=@karagir_date, party_id=@party_id, party_name=@party_name,
           karagir_id=@karagir_id, remark=@remark, status=@status, total_amount=@total_amount,
           advance_amount=@advance_amount, balance_amount=@balance_amount WHERE id=@id`
        ).run(row)
      } else {
        id = db
          .prepare(
            `INSERT INTO order_booking (prefix, order_no, order_date, delivery_date, karagir_date,
             party_id, party_name, karagir_id, remark, status, total_amount, advance_amount,
             balance_amount)
             VALUES (@prefix,@order_no,@order_date,@delivery_date,@karagir_date,@party_id,
             @party_name,@karagir_id,@remark,@status,@total_amount,@advance_amount,@balance_amount)`
          )
          .run(row).lastInsertRowid
      }

      // Old gold handed in at booking. Store the lines, then post the metal to
      // the customer's gold khata and into loose (URD) stock — the same legs a
      // sale URD would post, so on conversion nothing double-counts.
      const insUrd = db.prepare(
        `INSERT INTO order_urd (order_id, line_no, item_name, gross_wt, less_wt, net_wt,
         purity, final_wt, rate, amount)
         VALUES (@order_id,@line_no,@item_name,@gross_wt,@less_wt,@net_wt,@purity,
         @final_wt,@rate,@amount)`
      )
      ;(computed.urds || []).forEach((u, i) => {
        insUrd.run({
          item_name: 'Old Gold', less_wt: 0, ...u,
          order_id: id, line_no: i + 1,
        })
      })
      const urdFine = calc.r3((computed.urds || []).reduce((s, u) => s + num(u.final_wt), 0))
      if (row.party_id && urdFine > 0) {
        db.prepare(
          `INSERT INTO metal_entry (entry_date, party_id, metal, doc_type, doc_id, doc_no,
           particulars, fine_in, fine_out) VALUES (?,?,'Gold','ORDER',?,?,?,?,0)`
        ).run(row.order_date, row.party_id, id, order_no, 'Old gold at booking', urdFine)
        db.prepare(
          `INSERT INTO loose_stock (metal, gross_wt, net_wt, fine_wt, doc_type, doc_id,
           doc_no, direction, is_urd, entry_date)
           VALUES ('Gold',?,?,?,'ORDER',?,?,'IN',1,?)`
        ).run(
          calc.r3((computed.urds || []).reduce((s, u) => s + num(u.gross_wt), 0)),
          calc.r3((computed.urds || []).reduce((s, u) => s + num(u.net_wt), 0)),
          urdFine, id, order_no, row.order_date
        )
      }

      const insItem = db.prepare(
        `INSERT INTO order_item (order_id, line_no, tag, item_id, item_name, qty, gross_wt,
         black_beads, stone_wt, net_wt, purity, fine_wt, mkg_per_gm, mkg_amount,
         hallmark_charges, rate_per_gm, amount, picture)
         VALUES (@order_id,@line_no,@tag,@item_id,@item_name,@qty,@gross_wt,@black_beads,
         @stone_wt,@net_wt,@purity,@fine_wt,@mkg_per_gm,@mkg_amount,@hallmark_charges,
         @rate_per_gm,@amount,@picture)`
      )
      computed.items.forEach((l, i) => {
        insItem.run({
          tag: '', item_id: null, qty: 0, gross_wt: 0, black_beads: 0, stone_wt: 0,
          purity: 0, mkg_per_gm: 0, hallmark_charges: 0, rate_per_gm: 0, picture: '',
          ...l, amount: l.total_amount, order_id: id, line_no: i + 1,
        })
      })

      // Only the advance touches the money ledger — the order itself is not a sale
      // until it is delivered and converted to an invoice.
      if (row.party_id && t.advance_amount > 0) {
        postLedger(db, {
          entry_date: row.order_date, party_id: row.party_id, doc_type: 'ORDER', doc_id: id,
          doc_no: order_no, particulars: 'Order Advance', credit: t.advance_amount,
        })
        postLedger(db, {
          entry_date: row.order_date, account_id: accountIdByName(db, 'Cash Account'),
          doc_type: 'ORDER', doc_id: id, doc_no: order_no,
          particulars: `Advance — ${row.party_name}`, debit: t.advance_amount,
        })
      }

      return { id, order_no }
    })
    return tx()
  },

  setStatus: ({ id, status }) => {
    get().prepare(`UPDATE order_booking SET status = ? WHERE id = ?`).run(status, id)
    return true
  },

  remove: ({ id }) => {
    const db = get()
    const tx = db.transaction(() => {
      // Once it is invoiced the order still carries the advance receipt — the
      // bill counts on it and never posted a copy. Deleting the order here would
      // take that money off the books and leave the customer owing the advance
      // all over again. Cancel the bill first.
      const o = db.prepare(`SELECT status FROM order_booking WHERE id = ?`).get(id)
      if (o && o.status === 'DELIVERED') {
        throw new Error('This order has already been invoiced — delete the bill first.')
      }
      clearPostings(db, 'ORDER', id)
      db.prepare(`DELETE FROM order_booking WHERE id = ?`).run(id)
      return true
    })
    return tx()
  },

  /** Turn a received order into a sales bill, carrying the advance across. */
  toInvoice: ({ id, bill_date }) => {
    const db = get()
    const o = order.read({ id })
    if (!o) throw new Error('Order not found')
    if (o.status === 'DELIVERED') throw new Error('This order has already been invoiced')

    const res = sale.save({
      head: {
        prefix: 'COM', bill_date: bill_date || today(),
        party_id: o.party_id, party_name: o.party_name,
        is_credit: 1, gst_pct: 3, amount_received: o.advance_amount,
        // The advance is already on the books, dated the day it was taken. The
        // bill shows it as received so the customer's balance comes out right,
        // but it must not be booked into the till a second time.
        advance_posted: 1,
        manual_no: `Order ${o.order_no}`,
      },
      items: o.items.map((l) => ({
        tag: l.tag, item_id: l.item_id, item_name: l.item_name, qty: l.qty,
        gross_wt: l.gross_wt, purity: l.purity, stone_wt: l.stone_wt, net_wt: l.net_wt,
        rate_per_gm: l.rate_per_gm, mkg_per_gm: l.mkg_per_gm,
        hallmark_charges: l.hallmark_charges,
      })),
      // Old gold taken at booking carries onto the bill as its URD lines, so the
      // customer's final balance already reflects the metal they handed in.
      urds: (o.urds || []).map((u) => ({
        item_name: u.item_name, gross_wt: u.gross_wt, net_wt: u.net_wt,
        purity: u.purity, rate: u.rate,
      })),
    })

    // Old gold taken at booking has been carried onto the bill as URD lines, and
    // the bill has just booked it into stock and onto the customer's gold khata.
    // The order's copies of those legs have to go, or the metal counts twice.
    db.prepare(`DELETE FROM metal_entry WHERE doc_type = 'ORDER' AND doc_id = ?`).run(id)
    db.prepare(`DELETE FROM loose_stock WHERE doc_type = 'ORDER' AND doc_id = ?`).run(id)
    // The order's MONEY postings STAY. They carry the advance on the date the
    // customer paid it; deleting them and letting the invoice re-post the same
    // money would move a receipt from (say) July into September, quietly
    // changing a cash book and a day book that were already closed and printed.
    // The invoice does not credit it again — see `advance_posted` above — so the
    // customer is credited exactly once, on the right day.
    db.prepare(`UPDATE order_booking SET status='DELIVERED', sale_id=? WHERE id = ?`)
      .run(res.id, id)
    return res
  },
}

/* ───────────────────────────── Receipts / payments ───────────────────────────── */

const voucher = {
  list: ({ kind, from, to } = {}) => {
    const clauses = []
    if (kind) clauses.push(`kind = @kind`)
    if (from) clauses.push(`voucher_date >= @from`)
    if (to) clauses.push(`voucher_date <= @to`)
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''
    return get()
      .prepare(`SELECT * FROM voucher ${where} ORDER BY voucher_date DESC, id DESC LIMIT 500`)
      .all({ kind: kind ?? '', from: from ?? '', to: to ?? '' })
  },

  save: (p) => {
    const db = get()
    const tx = db.transaction(() => {
      const kind = p.kind || 'RECEIPT'
      const prefix = p.prefix || (kind === 'RECEIPT' ? 'VR' : 'VP')
      let id = p.id
      let voucher_no = p.voucher_no

      if (id) clearPostings(db, kind, id)
      else voucher_no = nextDocNo(kind, prefix)

      const row = {
        manual_no: '', narration: '', payment_type: 'Cash', bank_name: '', ref_no: '',
        // A voucher against an expense head has no party at all, so these must
        // default rather than being assumed present.
        ref_date: '', account_id: null, party_id: null, party_name: '', ...p,
        kind, prefix, voucher_no, voucher_date: p.voucher_date || today(),
        amount: num(p.amount),
      }

      if (id) {
        db.prepare(
          `UPDATE voucher SET manual_no=@manual_no, voucher_date=@voucher_date, party_id=@party_id,
           party_name=@party_name, account_id=@account_id, amount=@amount, narration=@narration,
           payment_type=@payment_type, bank_name=@bank_name, ref_no=@ref_no, ref_date=@ref_date
           WHERE id=@id`
        ).run(row)
      } else {
        id = db
          .prepare(
            `INSERT INTO voucher (kind, prefix, voucher_no, manual_no, voucher_date, party_id,
             party_name, account_id, amount, narration, payment_type, bank_name, ref_no, ref_date)
             VALUES (@kind,@prefix,@voucher_no,@manual_no,@voucher_date,@party_id,@party_name,
             @account_id,@amount,@narration,@payment_type,@bank_name,@ref_no,@ref_date)`
          )
          .run(row).lastInsertRowid
      }

      const isReceipt = kind === 'RECEIPT'
      const cashId =
        moneyAccountFor(db, row.payment_type)

      // Every voucher has two sides. One is always cash or bank; the other is
      // either a party OR a head from the chart of accounts — which is how shop
      // expenses are recorded: a payment against an Expense account. That is the
      // only route by which an expense can reach the cash book and the P&L.
      if (!row.party_id && row.account_id) {
        postLedger(db, {
          entry_date: row.voucher_date, account_id: row.account_id, doc_type: kind,
          doc_id: id, doc_no: voucher_no, manual_no: row.manual_no,
          particulars: row.narration || (isReceipt ? 'Receipt' : 'Payment'),
          debit: isReceipt ? 0 : row.amount,
          credit: isReceipt ? row.amount : 0,
        })
      }

      if (row.party_id) {
        postLedger(db, {
          entry_date: row.voucher_date, party_id: row.party_id, doc_type: kind, doc_id: id,
          doc_no: voucher_no, manual_no: row.manual_no,
          particulars: isReceipt ? 'Cash Account' : 'Cash Account',
          credit: isReceipt ? row.amount : 0,
          debit: isReceipt ? 0 : row.amount,
        })
      }
      postLedger(db, {
        entry_date: row.voucher_date, account_id: cashId, doc_type: kind, doc_id: id,
        doc_no: voucher_no, particulars: row.party_name || row.narration || kind,
        debit: isReceipt ? row.amount : 0,
        credit: isReceipt ? 0 : row.amount,
      })

      return { id, voucher_no }
    })
    return tx()
  },

  remove: ({ id }) => {
    const db = get()
    const tx = db.transaction(() => {
      const v = db.prepare(`SELECT kind FROM voucher WHERE id = ?`).get(id)
      if (v) clearPostings(db, v.kind, id)
      db.prepare(`DELETE FROM voucher WHERE id = ?`).run(id)
      return true
    })
    return tx()
  },
}

/* ─────────────────────── Karagir job work (KI / KR) ───────────────────────
   Metal goes to a goldsmith and comes back as finished pieces. The gap between
   the two, less the wastage agreed, is unaccounted metal — this reconciliation is
   the loss-prevention control of the trade, and it is the reason the karagir sits
   on the same metal ledger as every other party.                              */

const karagir = {
  /** Everything issued to and received from one goldsmith, with the shortfall. */
  ledger: ({ karagirId, from, to } = {}) => {
    const db = get()
    const range = { karagirId: karagirId ?? 0, from: from ?? '', to: to ?? '' }
    const where = (col) =>
      `WHERE (@karagirId = 0 OR karagir_id = @karagirId)
       AND (@from = '' OR ${col} >= @from) AND (@to = '' OR ${col} <= @to)`

    const issues = db
      .prepare(`SELECT * FROM karagir_issue ${where('issue_date')} ORDER BY issue_date, id`)
      .all(range)
    const receipts = db
      .prepare(`SELECT * FROM karagir_receive ${where('receive_date')} ORDER BY receive_date, id`)
      .all(range)

    const issued = calc.r3(issues.reduce((s, r) => s + num(r.fine_wt), 0))
    const received = calc.r3(receipts.reduce((s, r) => s + num(r.fine_wt), 0))
    const wastage = calc.r3(receipts.reduce((s, r) => s + num(r.wastage_wt), 0))
    return {
      issues,
      receipts,
      totals: {
        issued, received, wastage,
        // Positive = metal the goldsmith still holds or cannot account for.
        outstanding: calc.r3(issued - received - wastage),
        labour: calc.r2(receipts.reduce((s, r) => s + num(r.final_amount), 0)),
        paid: calc.r2(receipts.reduce((s, r) => s + num(r.paid_amount), 0)),
        pending: calc.r2(receipts.reduce((s, r) => s + num(r.pending_amount), 0)),
      },
    }
  },

  issue: (p) => {
    const db = get()
    const tx = db.transaction(() => {
      let id = p.id
      let issue_no = p.issue_no
      if (id) clearPostings(db, 'KARAGIR_ISSUE', id)
      else issue_no = nextDocNo('KARAGIR_ISSUE', p.prefix || 'KI')

      const net = p.net_wt != null && p.net_wt !== ''
        ? Math.max(0, num(p.net_wt))
        : calc.r3(Math.max(0, num(p.gross_wt) - num(p.less_wt)))
      const fine_wt = calc.fineWeight(net, p.purity)
      const row = {
        order_id: null, sub_order_no: '', karagir_name: '', item_name: '', description: '',
        qty: 0, gross_wt: 0, less_wt: 0, purity: 0, wastage_pct: 0, remark: '', metal: 'Gold',
        ...p, prefix: p.prefix || 'KI', issue_no,
        issue_date: p.issue_date || today(), net_wt: net, fine_wt,
      }

      if (id) {
        db.prepare(
          `UPDATE karagir_issue SET issue_date=@issue_date, order_id=@order_id,
           sub_order_no=@sub_order_no, karagir_id=@karagir_id, karagir_name=@karagir_name,
           item_name=@item_name, description=@description, qty=@qty, gross_wt=@gross_wt,
           less_wt=@less_wt, net_wt=@net_wt, purity=@purity, fine_wt=@fine_wt, metal=@metal,
           wastage_pct=@wastage_pct, remark=@remark WHERE id=@id`
        ).run(row)
      } else {
        id = db.prepare(
          `INSERT INTO karagir_issue (prefix, issue_no, issue_date, order_id, sub_order_no,
           karagir_id, karagir_name, item_name, description, qty, gross_wt, less_wt, net_wt,
           purity, fine_wt, wastage_pct, remark, metal)
           VALUES (@prefix,@issue_no,@issue_date,@order_id,@sub_order_no,@karagir_id,
           @karagir_name,@item_name,@description,@qty,@gross_wt,@less_wt,@net_wt,@purity,
           @fine_wt,@wastage_pct,@remark,@metal)`
        ).run(row).lastInsertRowid
      }

      if (fine_wt > 0) {
        // The metal has left the shop and is now the goldsmith's to answer for.
        db.prepare(
          `INSERT INTO loose_stock (metal, gross_wt, net_wt, fine_wt, doc_type, doc_id, doc_no,
           direction, entry_date) VALUES (?,?,?,?,'KARAGIR_ISSUE',?,?,'OUT',?)`
        ).run(row.metal, num(row.gross_wt), net, fine_wt, id, issue_no, row.issue_date)
        db.prepare(
          `INSERT INTO metal_entry (entry_date, party_id, metal, doc_type, doc_id, doc_no,
           particulars, fine_in, fine_out) VALUES (?,?,?,'KARAGIR_ISSUE',?,?,?,0,?)`
        ).run(row.issue_date, row.karagir_id, row.metal, id, issue_no, 'Material issued', fine_wt)
      }
      if (row.order_id) {
        db.prepare(`UPDATE order_booking SET status='ISSUED' WHERE id = ? AND status='BOOKED'`)
          .run(row.order_id)
      }
      return { id, issue_no }
    })
    return tx()
  },

  receive: (p) => {
    const db = get()
    const tx = db.transaction(() => {
      let id = p.id
      let receive_no = p.receive_no
      if (id) clearPostings(db, 'KARAGIR_RECEIVE', id)
      else receive_no = nextDocNo('KARAGIR_RECEIVE', p.prefix || 'KR')

      const net = p.net_wt != null && p.net_wt !== ''
        ? Math.max(0, num(p.net_wt))
        : calc.r3(Math.max(0,
            num(p.gross_wt) - num(p.less_wt) - num(p.stone_wt) - num(p.diamond_wt)))
      const fine_wt = calc.fineWeight(net, p.purity)
      const wastage_pct = Math.max(0, num(p.wastage_pct))
      const wastage_wt = calc.r3(fine_wt * (wastage_pct / 100))

      const labour_amount = p.labour_amount != null && p.labour_amount !== ''
        ? calc.r2(Math.max(0, num(p.labour_amount)))
        : calc.r2(net * Math.max(0, num(p.rate_per_gm)))
      const discount = Math.max(0, num(p.discount))
      const tds_pct = Math.max(0, num(p.tds_pct))
      const taxable = calc.r2(labour_amount - discount)
      const tds_amount = calc.r2(taxable * (tds_pct / 100))
      const final_amount = calc.r2(taxable - tds_amount)
      const paid_amount = Math.max(0, num(p.paid_amount))
      const pending_amount = calc.r2(final_amount - paid_amount)

      const row = {
        order_id: null, sub_order_no: '', karagir_name: '', item_name: '', qty: 0,
        gross_wt: 0, less_wt: 0, stone_wt: 0, diamond_wt: 0, purity: 0,
        rate_per_gm: 0, remark: '', metal: 'Gold',
        ...p, prefix: p.prefix || 'KR', receive_no,
        receive_date: p.receive_date || today(),
        net_wt: net, fine_wt, wastage_pct, wastage_wt,
        labour_amount, discount, tds_pct, tds_amount, final_amount,
        paid_amount, pending_amount,
      }

      if (id) {
        db.prepare(
          `UPDATE karagir_receive SET receive_date=@receive_date, order_id=@order_id,
           sub_order_no=@sub_order_no, karagir_id=@karagir_id, karagir_name=@karagir_name,
           item_name=@item_name, qty=@qty, gross_wt=@gross_wt, less_wt=@less_wt,
           stone_wt=@stone_wt, diamond_wt=@diamond_wt, net_wt=@net_wt, purity=@purity,
           fine_wt=@fine_wt, wastage_pct=@wastage_pct, wastage_wt=@wastage_wt, metal=@metal,
           rate_per_gm=@rate_per_gm, labour_amount=@labour_amount, discount=@discount,
           tds_pct=@tds_pct, tds_amount=@tds_amount, final_amount=@final_amount,
           paid_amount=@paid_amount, pending_amount=@pending_amount, remark=@remark
           WHERE id=@id`
        ).run(row)
      } else {
        id = db.prepare(
          `INSERT INTO karagir_receive (prefix, receive_no, receive_date, order_id,
           sub_order_no, karagir_id, karagir_name, item_name, qty, gross_wt, less_wt,
           stone_wt, diamond_wt, net_wt, purity, fine_wt, wastage_pct, wastage_wt,
           rate_per_gm, labour_amount, discount, tds_pct, tds_amount, final_amount,
           paid_amount, pending_amount, remark, metal)
           VALUES (@prefix,@receive_no,@receive_date,@order_id,@sub_order_no,@karagir_id,
           @karagir_name,@item_name,@qty,@gross_wt,@less_wt,@stone_wt,@diamond_wt,@net_wt,
           @purity,@fine_wt,@wastage_pct,@wastage_wt,@rate_per_gm,@labour_amount,@discount,
           @tds_pct,@tds_amount,@final_amount,@paid_amount,@pending_amount,@remark,@metal)`
        ).run(row).lastInsertRowid
      }

      if (fine_wt > 0) {
        db.prepare(
          `INSERT INTO loose_stock (metal, gross_wt, net_wt, fine_wt, doc_type, doc_id, doc_no,
           direction, entry_date) VALUES (?,?,?,?,'KARAGIR_RECEIVE',?,?,'IN',?)`
        ).run(row.metal, num(row.gross_wt), net, fine_wt, id, receive_no, row.receive_date)
      }
      // The goldsmith is relieved of what came back AND of the agreed wastage;
      // anything still standing on the ledger is metal they have not accounted for.
      const relieved = calc.r3(fine_wt + wastage_wt)
      if (relieved > 0) {
        db.prepare(
          `INSERT INTO metal_entry (entry_date, party_id, metal, doc_type, doc_id, doc_no,
           particulars, fine_in, fine_out) VALUES (?,?,?,'KARAGIR_RECEIVE',?,?,?,?,0)`
        ).run(row.receive_date, row.karagir_id, row.metal, id, receive_no, 'Order received', relieved)
      }
      // Labour is money we owe the goldsmith.
      if (final_amount !== 0) {
        postLedger(db, {
          entry_date: row.receive_date, party_id: row.karagir_id,
          doc_type: 'KARAGIR_RECEIVE', doc_id: id, doc_no: receive_no,
          particulars: 'Making charges', credit: final_amount,
        })
      }
      if (paid_amount > 0) {
        postLedger(db, {
          entry_date: row.receive_date, party_id: row.karagir_id,
          doc_type: 'KARAGIR_RECEIVE', doc_id: id, doc_no: receive_no,
          particulars: 'Cash Account', debit: paid_amount,
        })
        postLedger(db, {
          entry_date: row.receive_date, account_id: accountIdByName(db, 'Cash Account'),
          doc_type: 'KARAGIR_RECEIVE', doc_id: id, doc_no: receive_no,
          particulars: row.karagir_name || 'Karagir', credit: paid_amount,
        })
      }
      if (row.order_id) {
        db.prepare(
          `UPDATE order_booking SET status='RECEIVED' WHERE id = ? AND status IN ('BOOKED','ISSUED')`
        ).run(row.order_id)
      }
      return { id, receive_no }
    })
    return tx()
  },

  removeIssue: ({ id }) => {
    const db = get()
    const tx = db.transaction(() => {
      clearPostings(db, 'KARAGIR_ISSUE', id)
      db.prepare(`DELETE FROM karagir_issue WHERE id = ?`).run(id)
      return true
    })
    return tx()
  },

  removeReceive: ({ id }) => {
    const db = get()
    const tx = db.transaction(() => {
      clearPostings(db, 'KARAGIR_RECEIVE', id)
      db.prepare(`DELETE FROM karagir_receive WHERE id = ?`).run(id)
      return true
    })
    return tx()
  },
}

/* ─────────────────────────── Returns (SR / PR) ───────────────────────────
   A return is a NEW dated document, never an edit or a deletion of the original
   bill. Once a bill has been printed and reported, unwinding it by deleting it
   rewrites history; a return reverses stock, money and metal on the day the goods
   actually came back, which is what the books should show.                    */

/** Shared line maths — a returned line is valued exactly as it was sold. */
/**
 * One line of a PURCHASE return.
 *
 * A purchase is priced on fine weight plus wastage (see calc.purchaseLine), so a
 * purchase return must be priced the same way or the supplier's account never
 * clears: buying 100 g at 99.5% and returning all of it priced on the raw 100 g
 * would leave the supplier owing us money for goods we simply handed back.
 *
 * A SALE return is different and correctly uses `returnLine` below — a retail
 * sale prices the net weight, so its return does too.
 */
function purchaseReturnLine(l, metal) {
  const net = l.net_wt != null && l.net_wt !== '' ? Math.max(0, num(l.net_wt)) : calc.netWeight(l)
  // Beads go back priced by the gram, exactly as they came in, and carry no fine
  // weight — see purchaseLine.
  if (l.is_loose) {
    return {
      ...l,
      net_wt: calc.r3(net), final_wt: 0, fine_plus_wastage: 0, purity: 0,
      total_amount: calc.r2(
        num(l.qty) > 0 && net === 0
          ? num(l.qty) * Math.max(0, num(l.rate_per_gm))
          : net * Math.max(0, num(l.rate_per_gm))),
      mkg_amount: calc.r2(Math.max(0, num(l.mkg_amount))),
    }
  }
  const fine = calc.fineWeight(net, l.purity)
  const touch = Math.max(0, num(l.purity)) + Math.max(0, num(l.wastage_pct))
  const fine_plus_wastage = calc.r3(net * touch / 100)
  const qtyWise = num(l.qty) > 0 && net === 0
  const rate = Math.max(0, num(l.rate_per_gm))
  return {
    ...l,
    net_wt: calc.r3(net),
    final_wt: fine,
    fine_plus_wastage,
    // Weight-wise rows carry the same 995 rate basis the purchase was priced on;
    // a quantity-wise row is a flat per-piece rate, so it takes no basis at all.
    total_amount: calc.r2(qtyWise
      ? num(l.qty) * rate
      : net * touch * rate / calc.rateBasis(metal)),
    mkg_amount: calc.r2(Math.max(0, num(l.mkg_amount))),
  }
}

function returnLine(l) {
  const net = l.net_wt != null && l.net_wt !== '' ? Math.max(0, num(l.net_wt)) : calc.netWeight(l)
  const final_wt = calc.fineWeight(net, l.purity)
  const basis = num(l.qty) > 0 && net === 0 ? num(l.qty) : net
  const mkg_amount = l.mkg_amount != null && l.mkg_amount !== ''
    ? calc.r2(Math.max(0, num(l.mkg_amount)))
    : calc.r2(basis * Math.max(0, num(l.mkg_per_gm)))
  return {
    ...l,
    net_wt: calc.r3(net), final_wt,
    total_amount: calc.r2(basis * Math.max(0, num(l.rate_per_gm))),
    mkg_amount,
  }
}

const saleReturn = {
  list: ({ from, to, search } = {}) => {
    const clauses = []
    if (from) clauses.push(`return_date >= @from`)
    if (to) clauses.push(`return_date <= @to`)
    if (search) clauses.push(`(return_no LIKE '%'||@search||'%' OR party_name LIKE '%'||@search||'%')`)
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''
    return get()
      .prepare(`SELECT * FROM sale_return ${where} ORDER BY return_date DESC, id DESC LIMIT 500`)
      .all({ from: from ?? '', to: to ?? '', search: search ?? '' })
  },

  read: ({ id }) => {
    const db = get()
    const head = db.prepare(`SELECT * FROM sale_return WHERE id = ?`).get(id)
    if (!head) return null
    head.items = db
      .prepare(`SELECT * FROM sale_return_item WHERE return_id = ? ORDER BY line_no`).all(id)
    return head
  },

  save: (p) => {
    const db = get()
    const tx = db.transaction(() => {
      const h = p.head || {}
      const lines = (p.items || []).map(returnLine)
        .map((l) => {
          // Beads coming back are beads, not metal. Stamping one 'Gold' would
          // credit the customer's fine-weight khata and drop the grams into the
          // loose metal pool, neither of which ever happened.
          const is_loose = isLooseItem(db, l.item_id)
          return {
            ...l, is_loose: is_loose ? 1 : 0,
            purity: is_loose ? 0 : l.purity, final_wt: is_loose ? 0 : l.final_wt,
            metal: is_loose ? '' : (l.metal || itemMetal(db, l.item_id)),
          }
        })

      const goods_amount = calc.r2(lines.reduce((s, l) => s + num(l.total_amount), 0))
      const making_amount = calc.r2(lines.reduce((s, l) => s + num(l.mkg_amount), 0))
      const bill_amount = calc.r2(goods_amount + making_amount)
      const gst_pct = num(h.gst_pct)
      const gst_amount = calc.r2(bill_amount * (gst_pct / 100))
      const total_amount = calc.r2(bill_amount + gst_amount)
      const refund_amount = Math.max(0, num(h.refund_amount))

      let id = h.id
      let return_no = h.return_no
      if (id) {
        clearPostings(db, 'SALERET', id)
        // Put back whatever the previous version of this document had taken.
        for (const old of db.prepare(
          `SELECT tag_stock_id FROM sale_return_item WHERE return_id = ?`).all(id)) {
          if (old.tag_stock_id) {
            db.prepare(`UPDATE tag_stock SET status='SOLD' WHERE id = ?`).run(old.tag_stock_id)
          }
        }
        db.prepare(`DELETE FROM sale_return_item WHERE return_id = ?`).run(id)
      } else {
        return_no = nextDocNo('SALERET', h.prefix || 'SR')
      }

      const row = {
        manual_no: '', party_name: '', against_sale_id: null, against_bill_no: '', reason: '',
        ...h, prefix: h.prefix || 'SR', return_no,
        return_date: h.return_date || today(),
        goods_amount, making_amount, gst_pct, gst_amount, bill_amount,
        total_amount, refund_amount,
      }

      if (id) {
        db.prepare(
          `UPDATE sale_return SET manual_no=@manual_no, return_date=@return_date,
           party_id=@party_id, party_name=@party_name, against_sale_id=@against_sale_id,
           against_bill_no=@against_bill_no, reason=@reason, goods_amount=@goods_amount,
           making_amount=@making_amount, gst_pct=@gst_pct, gst_amount=@gst_amount,
           bill_amount=@bill_amount, total_amount=@total_amount, refund_amount=@refund_amount
           WHERE id=@id`
        ).run(row)
      } else {
        id = db.prepare(
          `INSERT INTO sale_return (prefix, return_no, manual_no, return_date, party_id,
           party_name, against_sale_id, against_bill_no, reason, goods_amount, making_amount,
           gst_pct, gst_amount, bill_amount, total_amount, refund_amount)
           VALUES (@prefix,@return_no,@manual_no,@return_date,@party_id,@party_name,
           @against_sale_id,@against_bill_no,@reason,@goods_amount,@making_amount,
           @gst_pct,@gst_amount,@bill_amount,@total_amount,@refund_amount)`
        ).run(row).lastInsertRowid
      }

      const insItem = db.prepare(
        `INSERT INTO sale_return_item (return_id, line_no, tag, tag_stock_id, item_id,
         item_name, qty, gross_wt, stone_wt, net_wt, purity, final_wt, rate_per_gm,
         mkg_per_gm, mkg_amount, total_amount)
         VALUES (@return_id,@line_no,@tag,@tag_stock_id,@item_id,@item_name,@qty,@gross_wt,
         @stone_wt,@net_wt,@purity,@final_wt,@rate_per_gm,@mkg_per_gm,@mkg_amount,@total_amount)`
      )
      let fineBack = 0
      lines.forEach((l, i) => {
        insItem.run({
          tag: '', tag_stock_id: null, item_id: null, item_name: '', qty: 0,
          gross_wt: 0, stone_wt: 0, purity: 0, rate_per_gm: 0, mkg_per_gm: 0,
          ...l, return_id: id, line_no: i + 1,
        })
        // A tagged piece coming back becomes sellable again.
        if (l.tag_stock_id) {
          db.prepare(`UPDATE tag_stock SET status='IN_STOCK', sold_doc='' WHERE id = ?`)
            .run(l.tag_stock_id)
        }
        // A loose item has no tag to flip back — the weight itself is the stock,
        // so the grams have to go back into the lot or they are lost for good.
        if (l.is_loose) {
          postItemStock(db, {
            item_id: l.item_id, gross_wt: num(l.gross_wt), qty: num(l.qty),
            rate: num(l.rate_per_gm), amount: num(l.total_amount),
            doc_type: 'SALERET', doc_id: id, doc_no: return_no, direction: 'IN',
            entry_date: row.return_date,
          })
        }
        fineBack += num(l.final_wt)
      })

      // Stock: the metal is physically back on the shelf, split by its metal.
      // A tagged piece goes back on its shelf; an untagged one back to the
      // loose pool it was sold out of.
      const retByMetal = new Map()
      for (const l of lines) {
        if (l.is_loose) continue
        const key = `${l.metal || 'Gold'}|${l.tag_stock_id ? 1 : 0}`
        const m = retByMetal.get(key) ||
          { metal: l.metal || 'Gold', tagged: l.tag_stock_id ? 1 : 0, gross: 0, net: 0, fine: 0 }
        m.gross += num(l.gross_wt); m.net += num(l.net_wt); m.fine += num(l.final_wt)
        retByMetal.set(key, m)
      }
      const insLooseRet = db.prepare(
        `INSERT INTO loose_stock (metal, gross_wt, net_wt, fine_wt, doc_type, doc_id, doc_no,
         direction, is_tagged, entry_date) VALUES (?,?,?,?,'SALERET',?,?,'IN',?,?)`
      )
      for (const m of retByMetal.values()) {
        if (calc.r3(m.fine) <= 0) continue
        insLooseRet.run(m.metal, calc.r3(m.gross), calc.r3(m.net), calc.r3(m.fine),
          id, return_no, m.tagged, row.return_date)
      }

      if (row.party_id) {
        // Money: the customer owes us less.
        if (total_amount !== 0) {
          postLedger(db, {
            entry_date: row.return_date, party_id: row.party_id, doc_type: 'SALERET',
            doc_id: id, doc_no: return_no, manual_no: row.manual_no,
            particulars: 'Sales Return', credit: total_amount,
          })
        }
        if (refund_amount > 0) {
          postLedger(db, {
            entry_date: row.return_date, party_id: row.party_id, doc_type: 'SALERET',
            doc_id: id, doc_no: return_no, particulars: 'Cash Account', debit: refund_amount,
          })
        }
        // Metal: they handed it back — one row per metal.
        const insMetalRet = db.prepare(
          `INSERT INTO metal_entry (entry_date, party_id, metal, doc_type, doc_id, doc_no,
           particulars, fine_in, fine_out) VALUES (?,?,?,'SALERET',?,?,?,?,0)`
        )
        for (const m of retByMetal.values()) {
          if (calc.r3(m.fine) <= 0) continue
          insMetalRet.run(row.return_date, row.party_id, m.metal, id, return_no,
            'Sales Return', calc.r3(m.fine))
        }
      }
      if (refund_amount > 0) {
        postLedger(db, {
          entry_date: row.return_date, account_id: accountIdByName(db, 'Cash Account'),
          doc_type: 'SALERET', doc_id: id, doc_no: return_no,
          particulars: row.party_name || 'Sales Return', credit: refund_amount,
        })
      }

      return { id, return_no }
    })
    return tx()
  },

  remove: ({ id }) => {
    const db = get()
    const tx = db.transaction(() => {
      for (const l of db.prepare(
        `SELECT tag_stock_id FROM sale_return_item WHERE return_id = ?`).all(id)) {
        // Undoing the return puts the piece back to sold — it never came back.
        if (l.tag_stock_id) {
          db.prepare(`UPDATE tag_stock SET status='SOLD' WHERE id = ?`).run(l.tag_stock_id)
        }
      }
      clearPostings(db, 'SALERET', id)
      db.prepare(`DELETE FROM sale_return WHERE id = ?`).run(id)
      return true
    })
    return tx()
  },
}

const purchaseReturn = {
  list: ({ from, to, search } = {}) => {
    const clauses = []
    if (from) clauses.push(`return_date >= @from`)
    if (to) clauses.push(`return_date <= @to`)
    if (search) clauses.push(`(return_no LIKE '%'||@search||'%' OR party_name LIKE '%'||@search||'%')`)
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''
    return get()
      .prepare(`SELECT * FROM purchase_return ${where} ORDER BY return_date DESC, id DESC LIMIT 500`)
      .all({ from: from ?? '', to: to ?? '', search: search ?? '' })
  },

  read: ({ id }) => {
    const db = get()
    const head = db.prepare(`SELECT * FROM purchase_return WHERE id = ?`).get(id)
    if (!head) return null
    head.items = db
      .prepare(`SELECT * FROM purchase_return_item WHERE return_id = ? ORDER BY line_no`).all(id)
    return head
  },

  save: (p) => {
    const db = get()
    const tx = db.transaction(() => {
      const h = p.head || {}
      const lines = (p.items || [])
        .map((l) => ({ ...l, is_loose: isLooseItem(db, l.item_id) ? 1 : 0 }))
        .map((l) => purchaseReturnLine(l, h.metal))

      const goods_amount = calc.r2(lines.reduce((s, l) => s + num(l.total_amount), 0))
      const bill_amount = goods_amount
      const gst_pct = num(h.gst_pct)
      const gst_amount = calc.r2(bill_amount * (gst_pct / 100))
      const total_amount = calc.r2(bill_amount + gst_amount)
      const received_amount = Math.max(0, num(h.received_amount))

      let id = h.id
      let return_no = h.return_no
      if (id) {
        clearPostings(db, 'PURRET', id)
        db.prepare(`DELETE FROM purchase_return_item WHERE return_id = ?`).run(id)
      } else {
        return_no = nextDocNo('PURRET', h.prefix || 'PR')
      }

      // The returned metal follows the original purchase's metal; failing that,
      // whatever the caller passed, else Gold.
      const origMetal = h.against_purchase_id
        ? db.prepare(`SELECT metal FROM purchase WHERE id = ?`).get(h.against_purchase_id)?.metal
        : null
      const row = {
        manual_no: '', party_name: '', against_purchase_id: null, against_invoice_no: '',
        reason: '', ...h, metal: origMetal || h.metal || 'Gold',
        prefix: h.prefix || 'PR', return_no,
        return_date: h.return_date || today(),
        goods_amount, gst_pct, gst_amount, bill_amount, total_amount, received_amount,
      }

      if (id) {
        db.prepare(
          `UPDATE purchase_return SET manual_no=@manual_no, return_date=@return_date,
           party_id=@party_id, party_name=@party_name, metal=@metal,
           against_purchase_id=@against_purchase_id,
           against_invoice_no=@against_invoice_no, reason=@reason, goods_amount=@goods_amount,
           gst_pct=@gst_pct, gst_amount=@gst_amount, bill_amount=@bill_amount,
           total_amount=@total_amount, received_amount=@received_amount WHERE id=@id`
        ).run(row)
      } else {
        id = db.prepare(
          `INSERT INTO purchase_return (prefix, return_no, manual_no, return_date, party_id,
           party_name, metal, against_purchase_id, against_invoice_no, reason, goods_amount,
           gst_pct, gst_amount, bill_amount, total_amount, received_amount)
           VALUES (@prefix,@return_no,@manual_no,@return_date,@party_id,@party_name,@metal,
           @against_purchase_id,@against_invoice_no,@reason,@goods_amount,@gst_pct,
           @gst_amount,@bill_amount,@total_amount,@received_amount)`
        ).run(row).lastInsertRowid
      }

      const insItem = db.prepare(
        `INSERT INTO purchase_return_item (return_id, line_no, item_id, item_name, qty, gross_wt,
         stone_wt, net_wt, purity, final_wt, rate_per_gm, total_amount)
         VALUES (@return_id,@line_no,@item_id,@item_name,@qty,@gross_wt,@stone_wt,@net_wt,@purity,
         @final_wt,@rate_per_gm,@total_amount)`
      )
      let fineOut = 0
      lines.forEach((l, i) => {
        insItem.run({
          item_id: null, item_name: '', qty: 0, gross_wt: 0, stone_wt: 0, purity: 0,
          rate_per_gm: 0, ...l, return_id: id, line_no: i + 1,
        })
        // Beads going back to the supplier leave the lot by weight. There is no
        // tag to retire, so this row IS the stock movement — and the shop cannot
        // send back more than it is holding.
        if (l.is_loose) {
          const onHand = looseOnHand(db, l.item_id)
          if (num(l.gross_wt) > onHand) {
            throw new Error(
              `Line ${i + 1}: only ${onHand} g of ${l.item_name || 'this item'} is in stock — ` +
              `the return sends back ${num(l.gross_wt)} g.`
            )
          }
          postItemStock(db, {
            item_id: l.item_id, gross_wt: num(l.gross_wt), qty: num(l.qty),
            rate: num(l.rate_per_gm), amount: num(l.total_amount),
            doc_type: 'PURRET', doc_id: id, doc_no: return_no, direction: 'OUT',
            entry_date: row.return_date,
          })
        }
        fineOut += num(l.final_wt)
      })

      // Stock: the metal leaves the shop. Loose lines are excluded — their grams
      // are beads and were never in the metal pool to begin with.
      const metalLines = lines.filter((l) => !l.is_loose)
      if (fineOut > 0) {
        db.prepare(
          `INSERT INTO loose_stock (metal, gross_wt, net_wt, fine_wt, doc_type, doc_id, doc_no,
           direction, entry_date) VALUES (?,?,?,?,'PURRET',?,?,'OUT',?)`
        ).run(
          row.metal,
          calc.r3(metalLines.reduce((s, l) => s + num(l.gross_wt), 0)),
          calc.r3(metalLines.reduce((s, l) => s + num(l.net_wt), 0)),
          calc.r3(fineOut), id, return_no, row.return_date
        )
      }

      if (row.party_id) {
        // Money: we owe the supplier less.
        if (total_amount !== 0) {
          postLedger(db, {
            entry_date: row.return_date, party_id: row.party_id, doc_type: 'PURRET',
            doc_id: id, doc_no: return_no, manual_no: row.manual_no,
            particulars: 'Purchase Return', debit: total_amount,
          })
        }
        if (received_amount > 0) {
          postLedger(db, {
            entry_date: row.return_date, party_id: row.party_id, doc_type: 'PURRET',
            doc_id: id, doc_no: return_no, particulars: 'Cash Account', credit: received_amount,
          })
        }
        // Metal: it went back to them.
        if (fineOut > 0) {
          db.prepare(
            `INSERT INTO metal_entry (entry_date, party_id, metal, doc_type, doc_id, doc_no,
             particulars, fine_in, fine_out) VALUES (?,?,?,'PURRET',?,?,?,0,?)`
          ).run(row.return_date, row.party_id, row.metal, id, return_no, 'Purchase Return', calc.r3(fineOut))
        }
      }
      if (received_amount > 0) {
        postLedger(db, {
          entry_date: row.return_date, account_id: accountIdByName(db, 'Cash Account'),
          doc_type: 'PURRET', doc_id: id, doc_no: return_no,
          particulars: row.party_name || 'Purchase Return', debit: received_amount,
        })
      }

      return { id, return_no }
    })
    return tx()
  },

  remove: ({ id }) => {
    const db = get()
    const tx = db.transaction(() => {
      clearPostings(db, 'PURRET', id)
      db.prepare(`DELETE FROM purchase_return WHERE id = ?`).run(id)
      return true
    })
    return tx()
  },
}

/* ─────────────────────── Stock Cash Settlement (SO) ───────────────────────
   Converts a party's METAL balance into a MONEY balance, or the reverse. Without
   it a fine-weight balance can never be closed out — you could owe a supplier
   100 g forever with no document that turns it into rupees.

   Metal moves one way and money the other, always:
     OUT — metal leaves us for the party  → they owe us less metal, we owe money
     IN  — metal comes to us              → we owe less metal, they owe us money

   It settles the ACCOUNT, not the shelf. The metal itself moved earlier on a
   purchase, sale or refining document, so physical stock is untouched here. */

const stockSettlement = {
  list: ({ partyId, from, to } = {}) => {
    const clauses = []
    if (partyId) clauses.push(`party_id = @partyId`)
    if (from) clauses.push(`settle_date >= @from`)
    if (to) clauses.push(`settle_date <= @to`)
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''
    return get()
      .prepare(`SELECT * FROM stock_settlement ${where}
                ORDER BY settle_date DESC, id DESC LIMIT 500`)
      .all({ partyId: partyId ?? 0, from: from ?? '', to: to ?? '' })
  },

  read: ({ id }) => get().prepare(`SELECT * FROM stock_settlement WHERE id = ?`).get(id),

  save: (p) => {
    const db = get()
    const tx = db.transaction(() => {
      let id = p.id
      let settle_no = p.settle_no
      if (id) clearPostings(db, 'SETTLE', id)
      else settle_no = nextDocNo('SETTLE', p.prefix || 'SO')

      const fine_wt = Math.max(0, num(p.fine_wt))
      const rate_per_gm = Math.max(0, num(p.rate_per_gm))
      const making_amount = Math.max(0, num(p.making_amount))
      const amount = calc.r2(fine_wt * rate_per_gm + making_amount)
      const gst_pct = Math.max(0, num(p.gst_pct))
      const gst_amount = calc.r2(amount * (gst_pct / 100))
      const bill_amount = calc.r2(amount + gst_amount)

      const row = {
        manual_no: '', narration: '', party_name: '', metal: 'Gold', ...p,
        prefix: p.prefix || 'SO', settle_no,
        settle_date: p.settle_date || today(),
        direction: p.direction === 'IN' ? 'IN' : 'OUT',
        fine_wt, rate_per_gm, making_amount, amount,
        gst_pct, gst_amount, bill_amount,
        paid_amount: Math.max(0, num(p.paid_amount)),
      }

      if (id) {
        db.prepare(
          `UPDATE stock_settlement SET manual_no=@manual_no, settle_date=@settle_date,
           party_id=@party_id, party_name=@party_name, metal=@metal, direction=@direction,
           fine_wt=@fine_wt, rate_per_gm=@rate_per_gm, making_amount=@making_amount,
           amount=@amount, gst_pct=@gst_pct, gst_amount=@gst_amount, bill_amount=@bill_amount,
           paid_amount=@paid_amount, narration=@narration WHERE id=@id`
        ).run(row)
      } else {
        id = db.prepare(
          `INSERT INTO stock_settlement (prefix, settle_no, manual_no, settle_date, party_id,
           party_name, metal, direction, fine_wt, rate_per_gm, making_amount, amount,
           gst_pct, gst_amount, bill_amount, paid_amount, narration)
           VALUES (@prefix,@settle_no,@manual_no,@settle_date,@party_id,@party_name,@metal,
           @direction,@fine_wt,@rate_per_gm,@making_amount,@amount,@gst_pct,@gst_amount,
           @bill_amount,@paid_amount,@narration)`
        ).run(row).lastInsertRowid
      }

      const isOut = row.direction === 'OUT'
      if (row.party_id) {
        // Metal: OUT means we handed it over, which is a debit in fine weight.
        if (fine_wt > 0) {
          db.prepare(
            `INSERT INTO metal_entry (entry_date, party_id, metal, doc_type, doc_id, doc_no,
             particulars, fine_in, fine_out) VALUES (?,?,?, 'SETTLE',?,?,?,?,?)`
          ).run(row.settle_date, row.party_id, row.metal, id, settle_no,
                'Stock Cash Settlement', isOut ? 0 : fine_wt, isOut ? fine_wt : 0)
        }
        // Money moves the opposite way to the metal.
        if (bill_amount !== 0) {
          postLedger(db, {
            entry_date: row.settle_date, party_id: row.party_id, doc_type: 'SETTLE',
            doc_id: id, doc_no: settle_no, manual_no: row.manual_no,
            particulars: 'Stock Cash Settlement',
            debit: isOut ? 0 : bill_amount,
            credit: isOut ? bill_amount : 0,
          })
        }
        if (row.paid_amount > 0) {
          postLedger(db, {
            entry_date: row.settle_date, party_id: row.party_id, doc_type: 'SETTLE',
            doc_id: id, doc_no: settle_no, particulars: 'Cash Account',
            debit: isOut ? row.paid_amount : 0,
            credit: isOut ? 0 : row.paid_amount,
          })
        }
      }
      if (row.paid_amount > 0) {
        postLedger(db, {
          entry_date: row.settle_date, account_id: accountIdByName(db, 'Cash Account'),
          doc_type: 'SETTLE', doc_id: id, doc_no: settle_no,
          particulars: row.party_name || 'Stock Cash Settlement',
          debit: isOut ? 0 : row.paid_amount,
          credit: isOut ? row.paid_amount : 0,
        })
      }

      return { id, settle_no }
    })
    return tx()
  },

  remove: ({ id }) => {
    const db = get()
    const tx = db.transaction(() => {
      clearPostings(db, 'SETTLE', id)
      db.prepare(`DELETE FROM stock_settlement WHERE id = ?`).run(id)
      return true
    })
    return tx()
  },
}

/* ───────────────────────────── Gold Saving Scheme ─────────────────────────────
   A member pays a fixed amount for N periods; the shop adds a bonus period at
   maturity. Deposits are a liability, so they post to the "Gold Saving Scheme"
   account rather than the member's trading khata.

     amount after maturity = monthly × paying_periods + maturity_bonus
     (video: 20 × 11 + 1000 = 1220)

   Four scheme types differ in *what the member accumulates*:

     On Amount    fixed rupees in, rupee balance out.
     On Making    fixed rupees in, rupee balance out, plus a making-charge
                  waiver at redemption instead of a rupee bonus.
     On Weight    fixed rupees in, converted to grams at the rate on the day of
                  payment — the balance is grams, so the member is hedged.
     Weight Wise  fixed grams in; the member pays what those grams cost that
                  day, so the rupees vary and the grams do not.

   Balances are DERIVED from the received instalments (see `balance` below)
   rather than kept as a running total, so undoing or deleting a receipt
   self-corrects with nothing to reverse.                                       */

const GSS_TYPES = ['On Amount', 'On Making', 'On Weight', 'Weight Wise']
/** True when the scheme accrues grams rather than rupees. */
const isWeightScheme = (t) => t === 'On Weight' || t === 'Weight Wise'

/** Add whole months to a yyyy-mm-dd date, clamping to the end of short months. */
function addMonths(iso, n) {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number)
  const total = (m - 1) + n
  const ny = y + Math.floor(total / 12)
  const nm = (total % 12 + 12) % 12
  const last = new Date(Date.UTC(ny, nm + 1, 0)).getUTCDate()
  const nd = Math.min(d, last)
  const p = (x) => String(x).padStart(2, '0')
  return `${ny}-${p(nm + 1)}-${p(nd)}`
}

/** Add n periods of the scheme's unit (Days / Months / Years) to a date. */
function addPeriods(iso, n, unit) {
  if (unit === 'Years') return addMonths(iso, n * 12)
  if (unit !== 'Days') return addMonths(iso, n)
  const t = new Date(`${iso.slice(0, 10)}T00:00:00Z`)
  t.setUTCDate(t.getUTCDate() + n)
  return t.toISOString().slice(0, 10)
}

const gss = {
  /* ── Scheme templates ── */
  schemes: () => get().prepare(`SELECT * FROM gss_scheme ORDER BY code`).all(),

  types: () => GSS_TYPES.slice(),

  saveScheme: (p) => {
    const db = get()
    const row = {
      scheme_type: 'On Amount', period_unit: 'Months', total_periods: 12,
      paying_periods: 11, bonus_periods: 1, monthly_amount: 0, maturity_bonus: 0,
      metal: 'Gold', monthly_weight: 0, bonus_weight: 0, making_disc_pct: 0,
      ...p,
    }
    if (!GSS_TYPES.includes(row.scheme_type)) throw new Error('Unknown scheme type')
    if (!['Days', 'Months', 'Years'].includes(row.period_unit)) row.period_unit = 'Months'
    if (row.id) {
      db.prepare(
        `UPDATE gss_scheme SET name=@name, scheme_type=@scheme_type, period_unit=@period_unit,
         total_periods=@total_periods, paying_periods=@paying_periods, bonus_periods=@bonus_periods,
         monthly_amount=@monthly_amount, maturity_bonus=@maturity_bonus, metal=@metal,
         monthly_weight=@monthly_weight, bonus_weight=@bonus_weight,
         making_disc_pct=@making_disc_pct WHERE id=@id`
      ).run(row)
      return row.id
    }
    if (!row.code) {
      const n = db.prepare(`SELECT COUNT(*) c FROM gss_scheme`).get().c
      row.code = `GSS${n + 1}`
    }
    return db
      .prepare(
        `INSERT INTO gss_scheme (code, name, scheme_type, period_unit, total_periods,
         paying_periods, bonus_periods, monthly_amount, maturity_bonus, metal,
         monthly_weight, bonus_weight, making_disc_pct)
         VALUES (@code,@name,@scheme_type,@period_unit,@total_periods,@paying_periods,
         @bonus_periods,@monthly_amount,@maturity_bonus,@metal,@monthly_weight,
         @bonus_weight,@making_disc_pct)`
      )
      .run(row).lastInsertRowid
  },

  removeScheme: ({ id }) => {
    const db = get()
    const used = db.prepare(`SELECT COUNT(*) c FROM gss_account WHERE scheme_id = ?`).get(id).c
    if (used) throw new Error('Cannot delete: members are enrolled in this scheme.')
    db.prepare(`DELETE FROM gss_scheme WHERE id = ?`).run(id)
    return true
  },

  /* ── Member accounts ── */
  accounts: ({ search, closed, party_id } = {}) => {
    const clauses = []
    if (search) clauses.push(`(a.gs_no LIKE '%'||@search||'%' OR p.name LIKE '%'||@search||'%')`)
    if (closed === 0 || closed === 1) clauses.push(`a.closed = @closed`)
    if (party_id) clauses.push(`a.party_id = @party_id`)
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''
    return get()
      .prepare(
        `SELECT a.*, p.name AS party_name, p.mobile, s.name AS scheme_name, s.code AS scheme_code,
           (SELECT COALESCE(SUM(r.amount),0) FROM gss_receipt r
             WHERE r.gss_id = a.id AND r.status = 'RECEIVED') AS paid_amount,
           (SELECT COALESCE(SUM(r.weight),0) FROM gss_receipt r
             WHERE r.gss_id = a.id AND r.status = 'RECEIVED') AS paid_weight,
           (SELECT COUNT(*) FROM gss_receipt r
             WHERE r.gss_id = a.id AND r.status = 'RECEIVED') AS paid_count,
           (SELECT COUNT(*) FROM gss_receipt r
             WHERE r.gss_id = a.id AND r.status = 'PENDING' AND r.due_date <= date('now','localtime')) AS overdue_count
         FROM gss_account a
         JOIN party p ON p.id = a.party_id
         JOIN gss_scheme s ON s.id = a.scheme_id
         ${where} ORDER BY a.id DESC`
      )
      .all({ search: search ?? '', closed: closed ?? -1, party_id: party_id ?? 0 })
  },

  readAccount: ({ id }) => {
    const db = get()
    const a = db
      .prepare(
        `SELECT a.*, p.name AS party_name, p.mobile, s.name AS scheme_name, s.code AS scheme_code
         FROM gss_account a JOIN party p ON p.id = a.party_id
         JOIN gss_scheme s ON s.id = a.scheme_id WHERE a.id = ?`
      )
      .get(id)
    if (!a) return null
    a.receipts = db
      .prepare(`SELECT * FROM gss_receipt WHERE gss_id = ? ORDER BY due_date, id`)
      .all(id)
    const paid = a.receipts.filter((r) => r.status === 'RECEIVED')
    a.paid_amount = calc.r2(paid.reduce((s, r) => s + num(r.amount), 0))
    a.paid_weight = calc.r3(paid.reduce((s, r) => s + num(r.weight), 0))
    a.weighted = isWeightScheme(a.scheme_type)
    a.expected_amount = a.scheme_type === 'Weight Wise'
      ? 0 : calc.r2(num(a.monthly_amount) * num(a.paying_periods))
    a.expected_weight = a.scheme_type === 'Weight Wise'
      ? calc.r3(num(a.monthly_weight) * num(a.paying_periods)) : 0
    a.maturity_value = calc.r2(a.expected_amount + num(a.maturity_bonus))
    a.maturity_weight = a.weighted
      ? calc.r3(a.expected_weight + num(a.bonus_weight)) : 0
    Object.assign(a, gss.balance({ id }))
    return a
  },

  /**
   * What the member can actually spend, derived from the received instalments
   * rather than a stored total — so undoing a receipt or deleting the account
   * self-corrects with nothing to reverse.
   *
   * The shop's benefit only counts once the account has matured and every
   * paying instalment is in; a member who stops halfway gets back what they
   * put in, not the bonus they did not earn.
   */
  balance: ({ id, as_of, rate, exclude_sale_id } = {}) => {
    const db = get()
    const a = db.prepare(`SELECT * FROM gss_account WHERE id = ?`).get(id)
    if (!a) return null
    const paid = db
      .prepare(
        `SELECT COALESCE(SUM(amount),0) amt, COALESCE(SUM(weight),0) wt, COUNT(*) n
         FROM gss_receipt WHERE gss_id = ? AND status = 'RECEIVED'`
      )
      .get(id)
    // What earlier bills already took out. Excluding the bill being edited keeps
    // a re-save from double-counting its own previous redemption.
    const spent = db
      .prepare(
        `SELECT COALESCE(SUM(gss_amount + gss_return),0) amt, COALESCE(SUM(gss_weight),0) wt
         FROM sale WHERE gss_id = ? AND id <> ?`
      )
      .get(id, exclude_sale_id ?? -1)

    const weighted = isWeightScheme(a.scheme_type)
    const on = as_of || today()
    const complete = num(paid.n) >= num(a.paying_periods)
    const matured = complete && on >= a.maturity_date
    const benefit_amount = matured && !weighted ? num(a.maturity_bonus) : 0
    const benefit_weight = matured && weighted ? num(a.bonus_weight) : 0

    const balance_amount = calc.r2(num(paid.amt) + benefit_amount - num(spent.amt))
    const balance_weight = calc.r3(num(paid.wt) + benefit_weight - num(spent.wt))
    // A gram balance is only worth rupees at a rate. Callers that know today's
    // rate pass it in; those that do not get 0 and must ask before redeeming.
    const redeem_value = weighted
      ? calc.r2(balance_weight * num(rate))
      : balance_amount

    return {
      scheme_type: a.scheme_type, metal: a.metal, weighted,
      paid_count: num(paid.n), paying_periods: num(a.paying_periods),
      paid_amount: calc.r2(paid.amt), paid_weight: calc.r3(paid.wt),
      benefit_amount, benefit_weight, complete, matured,
      spent_amount: calc.r2(spent.amt), spent_weight: calc.r3(spent.wt),
      making_disc_pct: a.scheme_type === 'On Making' && matured ? num(a.making_disc_pct) : 0,
      balance_amount, balance_weight, redeem_value,
      closed: !!a.closed, maturity_date: a.maturity_date,
    }
  },

  /** Enrol a member and generate the full instalment schedule. */
  assign: (p) => {
    const db = get()
    const tx = db.transaction(() => {
      const scheme = db.prepare(`SELECT * FROM gss_scheme WHERE id = ?`).get(p.scheme_id)
      if (!scheme) throw new Error('Select a scheme')
      if (!p.party_id) throw new Error('Select a customer')

      const start_date = p.start_date || today()
      const duration = num(p.duration) || scheme.total_periods
      const paying = num(p.paying_periods) || scheme.paying_periods
      const monthly = num(p.monthly_amount) || scheme.monthly_amount
      const bonus = p.maturity_bonus != null ? num(p.maturity_bonus) : num(scheme.maturity_bonus)
      // The scheme's terms are frozen onto the account: editing the template
      // later must not rewrite what an existing member signed up for.
      const scheme_type = p.scheme_type || scheme.scheme_type || 'On Amount'
      const period_unit = p.period_unit || scheme.period_unit || 'Months'
      const weighted = isWeightScheme(scheme_type)
      const monthly_weight = p.monthly_weight != null ? num(p.monthly_weight) : num(scheme.monthly_weight)
      const bonus_weight = p.bonus_weight != null ? num(p.bonus_weight) : num(scheme.bonus_weight)

      if (scheme_type === 'Weight Wise' && monthly_weight <= 0) {
        throw new Error('A Weight Wise scheme needs grams per instalment')
      }

      const row = {
        manual_no: '', remarks: '', interest: 0, ...p,
        gs_no: p.gs_no || nextDocNo('GSS', 'GS'),
        scheme_id: scheme.id,
        start_date,
        maturity_date: p.maturity_date || addPeriods(start_date, duration, period_unit),
        duration, paying_periods: paying,
        monthly_amount: monthly, maturity_bonus: bonus,
        closed: 0,
        scheme_type, period_unit,
        metal: p.metal || scheme.metal || 'Gold',
        monthly_weight, bonus_weight,
        making_disc_pct: p.making_disc_pct != null
          ? num(p.making_disc_pct) : num(scheme.making_disc_pct),
      }

      const id = db
        .prepare(
          `INSERT INTO gss_account (gs_no, manual_no, scheme_id, party_id, start_date,
           maturity_date, duration, paying_periods, interest, monthly_amount, maturity_bonus,
           remarks, closed, scheme_type, period_unit, metal, monthly_weight, bonus_weight,
           making_disc_pct)
           VALUES (@gs_no,@manual_no,@scheme_id,@party_id,@start_date,@maturity_date,@duration,
           @paying_periods,@interest,@monthly_amount,@maturity_bonus,@remarks,@closed,
           @scheme_type,@period_unit,@metal,@monthly_weight,@bonus_weight,@making_disc_pct)`
        )
        .run(row).lastInsertRowid

      // Instalment schedule: `paying` rows one period apart, then the shop's
      // bonus row(s). A Weight Wise row carries grams and no rupees — what it
      // will cost is not knowable until the day it is paid.
      const ins = db.prepare(
        `INSERT INTO gss_receipt (gss_id, receipt_no, due_date, amount, weight, status)
         VALUES (?,?,?,?,?,?)`
      )
      for (let i = 0; i < duration; i++) {
        const isBonus = i >= paying
        const amount = isBonus
          ? (weighted ? 0 : bonus)
          : (scheme_type === 'Weight Wise' ? 0 : monthly)
        const weight = isBonus
          ? (weighted ? bonus_weight : 0)
          : (scheme_type === 'Weight Wise' ? monthly_weight : 0)
        ins.run(
          id, String(i + 1), addPeriods(start_date, i, period_unit),
          amount, weight,
          isBonus ? 'INTEREST' : 'PENDING'
        )
      }
      return { id, gs_no: row.gs_no }
    })
    return tx()
  },

  /** Record money against one scheduled instalment. */
  receive: (p) => {
    const db = get()
    const tx = db.transaction(() => {
      const r = db.prepare(`SELECT * FROM gss_receipt WHERE id = ?`).get(p.receipt_id)
      if (!r) throw new Error('Instalment not found')
      if (r.status === 'RECEIVED') throw new Error('This instalment is already received')
      // The maturity row is the shop's own contribution — the member never pays it.
      if (r.status === 'INTEREST') {
        throw new Error('That row is the shop benefit at maturity, not a member instalment.')
      }

      const acct = db.prepare(`SELECT * FROM gss_account WHERE id = ?`).get(r.gss_id)
      const party = db.prepare(`SELECT name FROM party WHERE id = ?`).get(acct.party_id)
      const receipt_no = nextDocNo('GSSRCT', 'GR')
      const received_date = p.received_date || today()

      // Weight schemes convert between rupees and grams at the rate on the day
      // the instalment is paid. Which side is fixed depends on the type: On
      // Weight fixes the rupees, Weight Wise fixes the grams.
      const rate = num(p.rate)
      let amount = num(p.amount) || num(r.amount)
      let weight = 0
      if (isWeightScheme(acct.scheme_type)) {
        if (rate <= 0) throw new Error(`Enter the ${acct.metal || 'Gold'} rate per gram for this instalment`)
        if (acct.scheme_type === 'Weight Wise') {
          weight = num(p.weight) || num(r.weight) || num(acct.monthly_weight)
          if (weight <= 0) throw new Error('Enter the grams for this instalment')
          amount = calc.r2(weight * rate)
        } else {
          if (amount <= 0) throw new Error('Enter the amount for this instalment')
          weight = calc.r3(amount / rate)
        }
      }

      db.prepare(
        `UPDATE gss_receipt SET receipt_no=?, manual_no=?, received_date=?, amount=?,
         weight=?, rate=?, payment_type=?, bank_name=?, ref_no=?, status='RECEIVED' WHERE id=?`
      ).run(receipt_no, p.manual_no || '', received_date, amount, weight, rate,
            p.payment_type || 'Cash', p.bank_name || '', p.ref_no || '', r.id)

      postLedger(db, {
        entry_date: received_date, account_id: accountIdByName(db, 'Gold Saving Scheme'),
        doc_type: 'GSS', doc_id: r.id, doc_no: receipt_no,
        particulars: `${party?.name ?? ''} — ${acct.gs_no}`, credit: amount,
      })
      postLedger(db, {
        entry_date: received_date,
        account_id: moneyAccountFor(db, p.payment_type),
        doc_type: 'GSS', doc_id: r.id, doc_no: receipt_no,
        particulars: `GSS ${acct.gs_no}`, debit: amount,
      })

      return { receipt_no }
    })
    return tx()
  },

  /** Undo a received instalment. */
  unreceive: ({ receipt_id }) => {
    const db = get()
    const tx = db.transaction(() => {
      const r = db.prepare(`SELECT * FROM gss_receipt WHERE id = ?`).get(receipt_id)
      if (!r) throw new Error('Instalment not found')
      clearPostings(db, 'GSS', receipt_id)
      const acct = db
        .prepare(`SELECT monthly_amount, monthly_weight, scheme_type FROM gss_account WHERE id = ?`)
        .get(r.gss_id)
      // Put the row back to what the schedule said, not to what was paid: a
      // Weight Wise row owes grams, every other type owes rupees.
      const wise = acct?.scheme_type === 'Weight Wise'
      db.prepare(
        `UPDATE gss_receipt SET receipt_no='', received_date='', status='PENDING',
         amount=?, weight=?, rate=0 WHERE id=?`
      ).run(
        wise ? 0 : (num(acct?.monthly_amount) || r.amount),
        wise ? (num(acct?.monthly_weight) || r.weight) : 0,
        receipt_id
      )
      return true
    })
    return tx()
  },

  /**
   * Merge one member account into another — the video's "Merging of Gold Saving
   * Scheme". A member holding two cards wants one.
   *
   * The instalments MOVE rather than being summed into a total: the receipts are
   * the evidence of what was paid and when, and a merge that collapsed them into
   * one figure would destroy the audit trail and the gram-by-gram rate history a
   * weight scheme depends on. Their ledger postings are untouched for the same
   * reason — the money was really taken on those dates.
   */
  merge: ({ from_id, into_id }) => {
    const db = get()
    const tx = db.transaction(() => {
      if (!from_id || !into_id || from_id === into_id) {
        throw new Error('Choose two different accounts')
      }
      const a = db.prepare(`SELECT * FROM gss_account WHERE id = ?`).get(from_id)
      const b = db.prepare(`SELECT * FROM gss_account WHERE id = ?`).get(into_id)
      if (!a || !b) throw new Error('Account not found')
      if (a.party_id !== b.party_id) {
        throw new Error('Both accounts must belong to the same customer')
      }
      if (a.scheme_type !== b.scheme_type) {
        throw new Error(
          `Cannot merge a ${a.scheme_type} account into a ${b.scheme_type} one — ` +
          'they accrue different things.'
        )
      }
      if (a.metal !== b.metal) throw new Error('The two accounts are in different metals')
      // A bill has already spent from the source; moving it would leave that bill
      // pointing at an account whose receipts have gone.
      const spent = db.prepare(`SELECT COUNT(*) c FROM sale WHERE gss_id = ?`).get(from_id).c
      if (spent) throw new Error('That account has already been redeemed on a bill')

      const moved = db.prepare(
        `UPDATE gss_receipt SET gss_id = ? WHERE gss_id = ? AND status = 'RECEIVED'`
      ).run(into_id, from_id).changes
      // Unpaid rows are the source's own schedule and mean nothing on the target,
      // which has a schedule of its own.
      db.prepare(`DELETE FROM gss_receipt WHERE gss_id = ?`).run(from_id)
      db.prepare(
        `UPDATE gss_account SET closed = 1,
         remarks = TRIM(COALESCE(remarks,'') || ' Merged into ' || ?) WHERE id = ?`
      ).run(b.gs_no, from_id)
      return { moved, into: b.gs_no }
    })
    return tx()
  },

  closeAccount: ({ id, closed = 1 }) => {
    get().prepare(`UPDATE gss_account SET closed = ? WHERE id = ?`).run(closed ? 1 : 0, id)
    return true
  },

  removeAccount: ({ id }) => {
    const db = get()
    const tx = db.transaction(() => {
      const rs = db.prepare(`SELECT id FROM gss_receipt WHERE gss_id = ?`).all(id)
      for (const r of rs) clearPostings(db, 'GSS', r.id)
      db.prepare(`DELETE FROM gss_account WHERE id = ?`).run(id)
      return true
    })
    return tx()
  },
}

/* ───────────────────────────── Reports ───────────────────────────── */

const reports = {
  /** Tag-wise stock, optionally grouped. Mirrors "Loose And Tag Item Stock Report". */
  stock: ({ status = 'IN_STOCK', groupBy = 'none', search } = {}) => {
    const db = get()
    // Valuation is at COST: fine weight × what we paid per fine gram. A piece with
    // no purchase_rate recorded contributes 0 and is counted in `uncosted`, so the
    // screen can say the total is partial instead of quietly understating it.
    const rows = tagStock.list({ status, search }).map((r) => ({
      ...r,
      cost_value: calc.r2(num(r.final_wt) * num(r.purchase_rate)),
      stone_amount: calc.r2(num(r.stone_wt) * num(r.stone_rate)),
      diamond_amount: calc.r2(num(r.diamond_wt) * num(r.diamond_rate)),
    }))
    const uncosted = rows.filter((r) => num(r.purchase_rate) <= 0).length

    // Loose lots (mani, fuli) hold real stock that no tag can represent, so they
    // are reported alongside the trays rather than inside them — a bead has no
    // fine weight and no tag, and folding it into the piece list would corrupt
    // both the count and the fine total the shop reconciles against.
    //
    // Costed at moving average: what the lot has cost in total, over what has
    // come into it. A lot bought at two prices values at the blend, which is what
    // is actually sitting in the box.
    //
    // Only what the shop ACQUIRED sets the cost. Goods coming back off a bill are
    // an inflow too, but at the price they were sold for — letting a return in
    // here would revalue the whole lot at retail. A correction carries no price
    // at all and would drag the average to nothing.
    // A lot is either on hand or it is not — there is no "sold" row to list, so
    // it only belongs on a view that is asking what the shop is holding.
    const loose = (status === 'SOLD' ? [] : looseItem.balances({ search }))
      .map((r) => {
        const paid = db.prepare(
          `SELECT COALESCE(SUM(amount),0) amt, COALESCE(SUM(gross_wt),0) wt
           FROM item_stock
           WHERE item_id = ? AND direction = 'IN'
             AND doc_type IN ('OPENING','PURCHASE')`
        ).get(r.id)
        const rate = num(paid.wt) > 0 ? num(paid.amt) / num(paid.wt) : 0
        return { ...r, cost_rate: calc.r2(rate), cost_value: calc.r2(num(r.balance_wt) * rate) }
      })
      .filter((r) => num(r.balance_wt) !== 0 || num(r.in_wt) !== 0)
    const looseTotals = {
      balance_wt: calc.r3(loose.reduce((s, r) => s + num(r.balance_wt), 0)),
      cost_value: calc.r2(loose.reduce((s, r) => s + num(r.cost_value), 0)),
      uncosted: loose.filter((r) => num(r.cost_rate) <= 0).length,
      count: loose.length,
    }

    const totals = {
      cost_value: calc.r2(rows.reduce((s, r) => s + r.cost_value, 0)),
      stone_amount: calc.r2(rows.reduce((s, r) => s + r.stone_amount, 0)),
      diamond_amount: calc.r2(rows.reduce((s, r) => s + r.diamond_amount, 0)),
      uncosted,
      count: rows.length,
      // What the shop is holding in total, trays and lots together. Kept as its
      // own figure so the piece valuation above still means only pieces.
      total_cost_value: calc.r2(
        rows.reduce((s, r) => s + r.cost_value, 0) + looseTotals.cost_value),
    }
    if (groupBy === 'none') return { rows, groups: [], totals, loose, looseTotals }

    const key = {
      item: 'item_name', group: 'group_name', location: 'location',
      category: 'category', salesman: 'salesman', shelf: 'shelf_tray',
    }[groupBy] || 'item_name'
    const map = new Map()
    for (const r of rows) {
      const k = r[key] || '—'
      const g = map.get(k) ||
        { key: k, qty: 0, gross_wt: 0, net_wt: 0, final_wt: 0, cost_value: 0,
          stone_amount: 0, diamond_amount: 0, uncosted: 0, count: 0 }
      g.count += 1
      g.qty += num(r.qty)
      g.gross_wt += num(r.gross_wt)
      g.net_wt += num(r.net_wt)
      g.final_wt += num(r.final_wt)
      g.cost_value += r.cost_value
      g.stone_amount += r.stone_amount
      g.diamond_amount += r.diamond_amount
      if (num(r.purchase_rate) <= 0) g.uncosted += 1
      map.set(k, g)
    }
    // Weighted purity: the purity the whole group would have if it were one
    // piece. Averaging the per-piece percentages would let a 1 g scrap ring
    // count as much as a 50 g chain, so it is derived from the weights instead.
    // Fine weight is a percentage of NET, not gross, so net is the denominator.
    const groups = [...map.values()].map((g) => ({
      ...g, gross_wt: calc.r3(g.gross_wt), net_wt: calc.r3(g.net_wt), final_wt: calc.r3(g.final_wt),
      cost_value: calc.r2(g.cost_value),
      stone_amount: calc.r2(g.stone_amount), diamond_amount: calc.r2(g.diamond_amount),
      purity: g.net_wt > 0 ? calc.r3((g.final_wt / g.net_wt) * 100) : 0,
    }))
    return { rows, groups, totals, loose, looseTotals }
  },

  /**
   * The Gold Scheme report pack. The demo's menu lists ten reports, but they are
   * four shapes over the same data — master, allocated, pending, received — plus
   * a sales view. They are one call with a `kind` rather than ten near-identical
   * queries, so a change to how a balance is derived cannot fix one and miss
   * another.
   */
  schemeReport: ({ kind = 'allocated', from, to } = {}) => {
    const db = get()
    const range = { from: from ?? '', to: to ?? '' }

    if (kind === 'master') {
      return {
        kind,
        rows: db.prepare(
          `SELECT s.*, (SELECT COUNT(*) FROM gss_account a WHERE a.scheme_id = s.id) AS members
           FROM gss_scheme s ORDER BY s.code`
        ).all(),
      }
    }

    if (kind === 'pending' || kind === 'received') {
      const paid = kind === 'received'
      return {
        kind,
        rows: db.prepare(
          `SELECT r.*, a.gs_no, a.scheme_type, a.metal, p.name AS party_name, p.mobile,
                  s.name AS scheme_name
           FROM gss_receipt r
           JOIN gss_account a ON a.id = r.gss_id
           JOIN party p ON p.id = a.party_id
           JOIN gss_scheme s ON s.id = a.scheme_id
           WHERE r.status = ${paid ? `'RECEIVED'` : `'PENDING'`}
             AND (@from = '' OR ${paid ? 'r.received_date' : 'r.due_date'} >= @from)
             AND (@to = '' OR ${paid ? 'r.received_date' : 'r.due_date'} <= @to)
           ORDER BY ${paid ? 'r.received_date DESC' : 'r.due_date'}, a.gs_no`
        ).all(range),
      }
    }

    if (kind === 'sales') {
      return {
        kind,
        rows: db.prepare(
          `SELECT sa.id, sa.bill_no, sa.bill_date, sa.party_name, sa.total_amount,
                  sa.gss_amount, sa.gss_weight, sa.gss_return, a.gs_no, a.scheme_type
           FROM sale sa JOIN gss_account a ON a.id = sa.gss_id
           WHERE (@from = '' OR sa.bill_date >= @from) AND (@to = '' OR sa.bill_date <= @to)
           ORDER BY sa.bill_date DESC, sa.id DESC`
        ).all(range),
      }
    }

    // 'allocated' — one line per member, with the balance derived the same way
    // the redemption path derives it.
    const accounts = db.prepare(
      `SELECT a.id FROM gss_account a
       WHERE (@from = '' OR a.start_date >= @from) AND (@to = '' OR a.start_date <= @to)
       ORDER BY a.id DESC`
    ).all(range)
    const rows = accounts.map((x) => {
      const a = gss.readAccount({ id: x.id })
      return {
        id: a.id, gs_no: a.gs_no, party_name: a.party_name, mobile: a.mobile,
        scheme_name: a.scheme_name, scheme_type: a.scheme_type, metal: a.metal,
        start_date: a.start_date, maturity_date: a.maturity_date,
        paying_periods: a.paying_periods, paid_count: a.paid_count,
        paid_amount: a.paid_amount, paid_weight: a.paid_weight,
        balance_amount: a.balance_amount, balance_weight: a.balance_weight,
        matured: a.matured, closed: a.closed,
        pending_count: Math.max(0, num(a.paying_periods) - num(a.paid_count)),
      }
    })
    return { kind, rows }
  },

  /**
   * MIS pack — the questions an owner asks that the day-to-day screens cannot
   * answer: what is not selling, who has stopped coming, what sells best, and
   * where the margin actually is.
   *
   * Profit here is at COST, from `purchase_rate`. Pieces with no cost recorded
   * are counted separately rather than treated as free stock, because a margin
   * that quietly assumed zero cost would read as pure profit.
   */
  mis: ({ from, to, days = 90 } = {}) => {
    const db = get()
    const range = { from: from ?? '', to: to ?? '' }
    const cutoff = db
      .prepare(`SELECT date('now','localtime',?) d`)
      .get(`-${Math.max(1, num(days))} days`).d

    // Non-moving: in stock, tagged before the cutoff, never sold.
    const nonMoving = db.prepare(
      `SELECT ts.tag, i.name AS item_name, g.name AS group_name, ts.entry_date,
              ts.gross_wt, ts.final_wt, ts.purchase_rate,
              ROUND(ts.final_wt * ts.purchase_rate, 2) AS cost_value,
              CAST(julianday('now','localtime') - julianday(ts.entry_date) AS INTEGER) AS age_days
       FROM tag_stock ts JOIN item i ON i.id = ts.item_id
       LEFT JOIN item_group g ON g.id = i.item_group_id
       WHERE ts.status = 'IN_STOCK' AND ts.entry_date <= ?
       ORDER BY ts.entry_date`
    ).all(cutoff)

    // Customers who bought once but not since the cutoff.
    const dormant = db.prepare(
      `SELECT p.id, p.name, p.mobile, MAX(s.bill_date) AS last_bill,
              COUNT(s.id) AS bills, ROUND(SUM(s.total_amount), 2) AS lifetime,
              CAST(julianday('now','localtime') - julianday(MAX(s.bill_date)) AS INTEGER) AS quiet_days
       FROM party p JOIN sale s ON s.party_id = p.id
       WHERE p.party_type = 'CUSTOMER'
       GROUP BY p.id HAVING MAX(s.bill_date) < ?
       ORDER BY lifetime DESC LIMIT 100`
    ).all(cutoff)

    const topItems = db.prepare(
      `SELECT si.item_name, COUNT(*) AS lines, ROUND(SUM(si.net_wt),3) AS net_wt,
              ROUND(SUM(si.item_total),2) AS amount
       FROM sale_item si JOIN sale s ON s.id = si.sale_id
       WHERE (@from = '' OR s.bill_date >= @from) AND (@to = '' OR s.bill_date <= @to)
       GROUP BY si.item_name ORDER BY amount DESC LIMIT 20`
    ).all(range)

    const topAreas = db.prepare(
      `SELECT COALESCE(NULLIF(TRIM(s.area),''),'(not recorded)') AS area,
              COUNT(*) AS bills, ROUND(SUM(s.total_amount),2) AS amount
       FROM sale s
       WHERE (@from = '' OR s.bill_date >= @from) AND (@to = '' OR s.bill_date <= @to)
       GROUP BY area ORDER BY amount DESC LIMIT 20`
    ).all(range)

    // Purity profit: what a sold piece fetched against what it cost. Only pieces
    // whose cost was recorded can contribute — the rest are reported as a count.
    const sold = db.prepare(
      `SELECT s.bill_no, s.bill_date, s.party_name, si.tag, si.item_name, si.net_wt,
              si.purity, si.item_total, ts.purchase_rate, ts.final_wt, ts.entry_date
       FROM sale_item si
       JOIN sale s ON s.id = si.sale_id
       JOIN tag_stock ts ON ts.id = si.tag_stock_id
       WHERE (@from = '' OR s.bill_date >= @from) AND (@to = '' OR s.bill_date <= @to)`
    ).all(range)
    const byPurity = new Map()
    let uncosted = 0
    for (const r of sold) {
      if (num(r.purchase_rate) <= 0) { uncosted++; continue }
      const k = `${calc.r2(num(r.purity))}%`
      const g = byPurity.get(k) || { purity: k, pieces: 0, revenue: 0, cost: 0 }
      g.pieces += 1
      g.revenue += num(r.item_total)
      g.cost += num(r.final_wt) * num(r.purchase_rate)
      byPurity.set(k, g)
    }
    /*
     * The same pieces, one row each — bought for this, sold for that. Purity
     * Profit answers "where is the margin"; this answers "what happened to this
     * necklace", which is the question asked when a single deal looks wrong.
     *
     * Days held is how long the shop's money sat in the piece. A fat margin on
     * something that took eleven months to move is not the same trade as a thin
     * one that turned over in a fortnight.
     */
    const itemProfit = sold
      .filter((r) => num(r.purchase_rate) > 0)
      .map((r) => {
        const cost = calc.r2(num(r.final_wt) * num(r.purchase_rate))
        const revenue = calc.r2(num(r.item_total))
        const held = db.prepare(`SELECT CAST(julianday(?) - julianday(?) AS INTEGER) d`)
          .get(r.bill_date, r.entry_date).d
        return {
          bill_no: r.bill_no, bill_date: r.bill_date, party_name: r.party_name || 'Cash',
          tag: r.tag || '', item_name: r.item_name,
          purity: calc.r2(num(r.purity)), fine_wt: calc.r3(num(r.final_wt)),
          cost_rate: calc.r2(num(r.purchase_rate)), cost, revenue,
          profit: calc.r2(revenue - cost),
          margin_pct: revenue > 0 ? calc.r2(((revenue - cost) / revenue) * 100) : 0,
          days_held: Math.max(0, num(held)),
        }
      })
      .sort((a, b) => b.profit - a.profit)

    const purityProfit = [...byPurity.values()]
      .map((g) => ({
        ...g, revenue: calc.r2(g.revenue), cost: calc.r2(g.cost),
        profit: calc.r2(g.revenue - g.cost),
        margin_pct: g.revenue > 0 ? calc.r2(((g.revenue - g.cost) / g.revenue) * 100) : 0,
      }))
      .sort((a, b) => b.profit - a.profit)

    return {
      range: { from: range.from, to: range.to, cutoff, days: num(days) },
      nonMoving, dormant, topItems, topAreas,
      purityProfit, itemProfit,
      uncostedSold: uncosted,
      nonMovingValue: calc.r2(nonMoving.reduce((s, r) => s + num(r.cost_value), 0)),
    }
  },

  /** Party ledger in the two-column Dr | Cr form the demo shows. */
  ledger: ({ partyId, from, to }) => {
    const db = get()
    const p = db.prepare(`SELECT * FROM party WHERE id = ?`).get(partyId)
    if (!p) return null

    const opening = num(p.opening_balance) * (p.opening_dr_cr === 'Dr' ? 1 : -1)
    const priorMoved = from
      ? db
          .prepare(
            `SELECT COALESCE(SUM(debit-credit),0) v FROM ledger_entry
             WHERE party_id = ? AND entry_date < ?`
          )
          .get(partyId, from).v
      : 0
    const openingBalance = calc.r2(opening + priorMoved)

    const entries = db
      .prepare(
        `SELECT * FROM ledger_entry WHERE party_id = @partyId
         AND (@from = '' OR entry_date >= @from) AND (@to = '' OR entry_date <= @to)
         ORDER BY entry_date, id`
      )
      .all({ partyId, from: from ?? '', to: to ?? '' })

    const debits = []
    const credits = []
    if (openingBalance >= 0)
      debits.push({ entry_date: from || p.created_at?.slice(0, 10), particulars: 'Opening Balance', amount: openingBalance })
    else
      credits.push({ entry_date: from || p.created_at?.slice(0, 10), particulars: 'Opening Balance', amount: -openingBalance })

    for (const e of entries) {
      if (num(e.debit) > 0)
        debits.push({ entry_date: e.entry_date, particulars: e.particulars, doc_no: e.doc_no, manual_no: e.manual_no, amount: num(e.debit) })
      if (num(e.credit) > 0)
        credits.push({ entry_date: e.entry_date, particulars: e.particulars, doc_no: e.doc_no, manual_no: e.manual_no, amount: num(e.credit) })
    }

    const drTotal = calc.r2(debits.reduce((s, r) => s + r.amount, 0))
    const crTotal = calc.r2(credits.reduce((s, r) => s + r.amount, 0))
    const closing = calc.r2(drTotal - crTotal)
    const grand = Math.max(drTotal, crTotal)

    return {
      party: p, debits, credits, drTotal, crTotal, grandTotal: grand,
      closing: Math.abs(closing),
      closingSide: closing >= 0 ? 'Dr' : 'Cr',
    }
  },

  /**
   * Gold khata — the same two-column Dr/Cr shape as the money ledger, but in
   * fine grams. Dr = metal we handed the party, Cr = metal they handed us.
   */
  /**
   * Account cum Stock Display — docs/VIDEO-SPEC-2.md §2.
   *
   * One statement per party carrying BOTH balances at once: rupees and fine
   * grams, each with its own Dr/Cr. Every document contributes a single row, so
   * a bill that moves money and metal together reads as one event rather than as
   * two unrelated lines in two separate screens.
   *
   * Sign convention matches party.balance / party.metalBalance throughout:
   * positive = the party owes us (Dr).
   */
  accountCumStock: ({ partyId, metal = 'Gold', from, to }) => {
    const db = get()
    const p = db.prepare(`SELECT * FROM party WHERE id = ?`).get(partyId)
    if (!p) return null
    const range = { partyId, metal, from: from ?? '', to: to ?? '' }

    // ── opening, money and metal ──
    const openAmt0 = num(p.opening_balance) * (p.opening_dr_cr === 'Dr' ? 1 : -1)
    const priorAmt = from
      ? db.prepare(
          `SELECT COALESCE(SUM(debit-credit),0) v FROM ledger_entry
           WHERE party_id = ? AND entry_date < ?`
        ).get(partyId, from).v
      : 0
    const openWt0 = db.prepare(
      `SELECT COALESCE(SUM(weight * (CASE dr_cr WHEN 'Dr' THEN 1 ELSE -1 END)), 0) v
       FROM party_metal_opening WHERE party_id = ? AND metal = ?`
    ).get(partyId, metal).v || 0
    const priorWt = from
      ? db.prepare(
          `SELECT COALESCE(SUM(fine_out - fine_in),0) v FROM metal_entry
           WHERE party_id = ? AND metal = ? AND entry_date < ?`
        ).get(partyId, metal, from).v
      : 0

    const opening = { amount: calc.r2(openAmt0 + priorAmt), weight: calc.r3(openWt0 + priorWt) }

    // ── merge the two ledgers by document ──
    // A document is identified by type+id where we have one; documents without an
    // id (rare, hand-made postings) fall back to their number so they still pair.
    const key = (e) => `${e.doc_type || ''}#${e.doc_id ?? e.doc_no ?? ''}`
    const rows = new Map()
    const touch = (e) => {
      const k = key(e)
      const r = rows.get(k) || {
        doc_type: e.doc_type, doc_no: e.doc_no || '', manual_no: e.manual_no || '',
        entry_date: e.entry_date, particulars: e.particulars || e.doc_type || '',
        amount: 0, received: 0, fine_out: 0, fine_in: 0, seq: rows.size,
      }
      // Keep the earliest date if the two ledgers disagree by a day.
      if (e.entry_date < r.entry_date) r.entry_date = e.entry_date
      rows.set(k, r)
      return r
    }

    for (const e of db.prepare(
      `SELECT * FROM ledger_entry WHERE party_id = @partyId
       AND (@from = '' OR entry_date >= @from) AND (@to = '' OR entry_date <= @to)
       ORDER BY entry_date, id`
    ).all(range)) {
      const r = touch(e)
      r.amount += num(e.debit)
      r.received += num(e.credit)
    }

    for (const e of db.prepare(
      `SELECT * FROM metal_entry WHERE party_id = @partyId AND metal = @metal
       AND (@from = '' OR entry_date >= @from) AND (@to = '' OR entry_date <= @to)
       ORDER BY entry_date, id`
    ).all(range)) {
      const r = touch(e)
      r.fine_out += num(e.fine_out)
      r.fine_in += num(e.fine_in)
    }

    // ── run both balances down the page ──
    let balAmt = opening.amount
    let balWt = opening.weight
    const out = [...rows.values()]
      .sort((a, b) => (a.entry_date < b.entry_date ? -1 : a.entry_date > b.entry_date ? 1 : a.seq - b.seq))
      .map((r) => {
        balAmt = calc.r2(balAmt + r.amount - r.received)
        balWt = calc.r3(balWt + r.fine_out - r.fine_in)
        const fine = calc.r3(r.fine_out - r.fine_in)
        return {
          doc_no: r.doc_no,
          manual_no: r.manual_no,
          entry_date: r.entry_date,
          particulars: r.particulars,
          amount: calc.r2(r.amount),
          received: calc.r2(r.received),
          fine_wt: Math.abs(fine),
          // Which way the metal moved: OUT = we gave it to them.
          in_out: fine > 0 ? 'OUT' : fine < 0 ? 'IN' : '',
          bal_amt: balAmt,
          bal_wt: balWt,
        }
      })

    return {
      party: p,
      metal,
      opening,
      rows: out,
      closing: { amount: balAmt, weight: balWt },
      totals: {
        amount: calc.r2(out.reduce((s, r) => s + r.amount, 0)),
        received: calc.r2(out.reduce((s, r) => s + r.received, 0)),
      },
    }
  },

  /**
   * Order tracking (docs/VIDEO-SPEC-2.md §10.7) — what is promised, to whom, by
   * when, and how far along it is. `remaining_days` is the number the counter
   * actually looks at; negative means the promise date has already passed.
   */
  orderTracking: ({ status, from, to, asOf } = {}) => {
    const db = get()
    const today0 = asOf || today()
    const rows = db.prepare(
      `SELECT o.*, p.name AS customer_name, k.name AS karagir_name
       FROM order_booking o
       LEFT JOIN party p ON p.id = o.party_id
       LEFT JOIN party k ON k.id = o.karagir_id
       WHERE (@status = '' OR o.status = @status)
         AND (@from = '' OR o.order_date >= @from)
         AND (@to = '' OR o.order_date <= @to)
       ORDER BY o.delivery_date, o.id`
    ).all({ status: status ?? '', from: from ?? '', to: to ?? '' })

    const dayMs = 86400000
    return rows.map((o) => {
      const issued = db.prepare(
        `SELECT COALESCE(SUM(fine_wt),0) v FROM karagir_issue WHERE order_id = ?`).get(o.id).v
      const received = db.prepare(
        `SELECT COALESCE(SUM(fine_wt),0) v FROM karagir_receive WHERE order_id = ?`).get(o.id).v
      const wastage = db.prepare(
        `SELECT COALESCE(SUM(wastage_wt),0) v FROM karagir_receive WHERE order_id = ?`).get(o.id).v
      const open = !['DELIVERED', 'CANCELLED'].includes(o.status)
      const daysTo = (d) => (d ? Math.round((Date.parse(d) - Date.parse(today0)) / dayMs) : null)
      const remaining = daysTo(o.delivery_date)
      const karagirRemaining = daysTo(o.karagir_date)
      return {
        ...o,
        fine_issued: calc.r3(issued),
        fine_received: calc.r3(received),
        wastage_wt: calc.r3(wastage),
        metal_outstanding: calc.r3(issued - received - wastage),
        remaining_days: remaining,
        overdue: remaining != null && remaining < 0 && open,
        // The karagir's own deadline — earlier than the customer's, so the shop
        // has slack. Overdue here flags a piece at risk before the customer sees it.
        karagir_remaining_days: karagirRemaining,
        karagir_overdue: karagirRemaining != null && karagirRemaining < 0 && open &&
                         o.status !== 'RECEIVED',
      }
    })
  },

  metalLedger: ({ partyId, metal = 'Gold', from, to }) => {
    const db = get()
    const p = db.prepare(`SELECT * FROM party WHERE id = ?`).get(partyId)
    if (!p) return null

    const opening0 = db
      .prepare(
        `SELECT COALESCE(SUM(weight * (CASE dr_cr WHEN 'Dr' THEN 1 ELSE -1 END)), 0) v
         FROM party_metal_opening WHERE party_id = ? AND metal = ?`
      )
      .get(partyId, metal).v || 0
    const prior = from
      ? db
          .prepare(
            `SELECT COALESCE(SUM(fine_out - fine_in), 0) v FROM metal_entry
             WHERE party_id = ? AND metal = ? AND entry_date < ?`
          )
          .get(partyId, metal, from).v
      : 0
    const opening = calc.r3(opening0 + prior)

    const entries = db
      .prepare(
        `SELECT * FROM metal_entry WHERE party_id = @partyId AND metal = @metal
         AND (@from = '' OR entry_date >= @from) AND (@to = '' OR entry_date <= @to)
         ORDER BY entry_date, id`
      )
      .all({ partyId, metal, from: from ?? '', to: to ?? '' })

    const debits = []   // metal given to the party
    const credits = []  // metal received from the party

    if (opening >= 0) debits.push({ entry_date: from || '', particulars: 'Opening Balance', weight: opening })
    else credits.push({ entry_date: from || '', particulars: 'Opening Balance', weight: -opening })

    for (const e of entries) {
      if (num(e.fine_out) > 0)
        debits.push({ entry_date: e.entry_date, particulars: e.particulars || e.doc_type, doc_no: e.doc_no, weight: num(e.fine_out) })
      if (num(e.fine_in) > 0)
        credits.push({ entry_date: e.entry_date, particulars: e.particulars || e.doc_type, doc_no: e.doc_no, weight: num(e.fine_in) })
    }

    const drTotal = calc.r3(debits.reduce((s, r) => s + r.weight, 0))
    const crTotal = calc.r3(credits.reduce((s, r) => s + r.weight, 0))
    const closing = calc.r3(drTotal - crTotal)

    return {
      party: p, metal, debits, credits, drTotal, crTotal,
      grandTotal: Math.max(drTotal, crTotal),
      closing: Math.abs(closing),
      closingSide: closing >= 0 ? 'Dr' : 'Cr',
    }
  },

  /** Every party carrying a non-zero metal balance. */
  metalOutstanding: ({ metal = 'Gold' } = {}) => {
    const db = get()
    const rows = db
      .prepare(
        `SELECT p.id, p.name, p.party_type, p.mobile,
           COALESCE((SELECT SUM(o.weight * (CASE o.dr_cr WHEN 'Dr' THEN 1 ELSE -1 END))
                     FROM party_metal_opening o WHERE o.party_id = p.id AND o.metal = @metal), 0)
           + COALESCE((SELECT SUM(m.fine_out - m.fine_in) FROM metal_entry m
                       WHERE m.party_id = p.id AND m.metal = @metal), 0) AS balance
         FROM party p ORDER BY p.name`
      )
      .all({ metal })
    return rows
      .map((r) => ({ ...r, balance: calc.r3(r.balance) }))
      .filter((r) => Math.abs(r.balance) > 0.0005)
  },

  /**
   * Debtor / creditor lists — docs/VIDEO-SPEC-2.md §5, gap #14.
   *
   * The same outstanding, read two ways: `money` (rupees, from the party ledger)
   * or `metal` (fine grams of a chosen metal, from the gold khata). Positive is a
   * debtor (they owe us, Dr); negative is a creditor (we owe them, Cr). Metal is
   * never converted to money — a weight list is genuinely a different statement.
   */
  outstandingList: ({ basis = 'money', metal = 'Gold' } = {}) => {
    const rows = basis === 'metal'
      ? reports.metalOutstanding({ metal }).map((r) => ({
          id: r.id, name: r.name, party_type: r.party_type, mobile: r.mobile, balance: r.balance,
        }))
      : party.list({}).filter((p) => Math.abs(num(p.balance)) > 0.009).map((p) => ({
          id: p.id, name: p.name, party_type: p.party_type, mobile: p.mobile,
          balance: calc.r2(p.balance),
        }))
    const round = basis === 'metal' ? calc.r3 : calc.r2
    const debtors = rows.filter((r) => r.balance > 0).sort((a, b) => b.balance - a.balance)
    const creditors = rows.filter((r) => r.balance < 0)
      .map((r) => ({ ...r, balance: -r.balance }))
      .sort((a, b) => b.balance - a.balance)
    return {
      basis, metal,
      debtors, creditors,
      debtorTotal: round(debtors.reduce((s, r) => s + r.balance, 0)),
      creditorTotal: round(creditors.reduce((s, r) => s + r.balance, 0)),
    }
  },

  /**
   * Cash / Bank Book — every movement through a money account with a running
   * balance, docs/VIDEO-SPEC-2.md §5. `account` is 'Cash Account' or
   * 'Bank Account'. Opening is the balance carried in from before the period.
   */
  cashBook: ({ from, to, account = 'Cash Account' } = {}) => {
    const db = get()
    const acc = db.prepare(
      `SELECT id, name, opening_balance, opening_dr_cr FROM account WHERE name = ?`
    ).get(account)
    if (!acc) return null
    const range = { from: from || '1900-01-01', to: to || '2999-12-31', acc: acc.id }
    // Opening carries in BOTH the account's own opening balance and everything
    // posted before the period. Leaving the former out made the cash book close
    // somewhere the trial balance and the day book did not.
    const openingSeed =
      num(acc.opening_balance) * (acc.opening_dr_cr === 'Cr' ? -1 : 1)
    const opening = openingSeed + db.prepare(
      `SELECT COALESCE(SUM(debit - credit),0) v FROM ledger_entry
       WHERE account_id = @acc AND entry_date < @from`).get(range).v
    const entries = db.prepare(
      `SELECT entry_date, particulars, doc_no, doc_type, debit, credit FROM ledger_entry
       WHERE account_id = @acc AND entry_date BETWEEN @from AND @to
       ORDER BY entry_date, id`).all(range)
    let bal = opening
    const rows = entries.map((e) => {
      bal += num(e.debit) - num(e.credit)
      return { ...e, balance: calc.r2(bal) }
    })
    return {
      account: acc.name,
      opening: calc.r2(opening),
      rows,
      totalDebit: calc.r2(entries.reduce((s, e) => s + num(e.debit), 0)),
      totalCredit: calc.r2(entries.reduce((s, e) => s + num(e.credit), 0)),
      closing: calc.r2(bal),
    }
  },

  /**
   * Journal — every ledger posting in the period, each on its natural side,
   * docs/VIDEO-SPEC-2.md §5. The head is the party or account the leg belongs to.
   */
  journal: ({ from, to } = {}) => {
    const db = get()
    const range = { from: from || '1900-01-01', to: to || '2999-12-31' }
    const rows = db.prepare(
      `SELECT l.entry_date, l.particulars, l.doc_no, l.doc_type, l.debit, l.credit,
              COALESCE(p.name, a.name, l.particulars) AS head
       FROM ledger_entry l
       LEFT JOIN party p ON p.id = l.party_id
       LEFT JOIN account a ON a.id = l.account_id
       WHERE l.entry_date BETWEEN @from AND @to
       ORDER BY l.entry_date, l.id`).all(range)
    return {
      rows,
      totalDebit: calc.r2(rows.reduce((s, r) => s + num(r.debit), 0)),
      totalCredit: calc.r2(rows.reduce((s, r) => s + num(r.credit), 0)),
    }
  },

  /**
   * Document register — Sales / Sales Return / Purchase / Purchase Return books,
   * docs/VIDEO-SPEC-2.md §5. Each row is one document with its taxable value, GST
   * and total; the foot carries the column totals.
   */
  register: ({ book = 'SALES', from, to } = {}) => {
    const db = get()
    const range = { from: from || '1900-01-01', to: to || '2999-12-31' }
    const specs = {
      SALES: { title: 'Sales Register', sql:
        `SELECT bill_date AS date, bill_no AS doc_no, party_name, bill_amount AS taxable,
                gst_amount, total_amount AS total FROM sale
         WHERE bill_date BETWEEN @from AND @to ORDER BY bill_date, id` },
      SALERETURN: { title: 'Sales Return Register', sql:
        `SELECT return_date AS date, return_no AS doc_no, party_name, bill_amount AS taxable,
                gst_amount, total_amount AS total FROM sale_return
         WHERE return_date BETWEEN @from AND @to ORDER BY return_date, id` },
      PURCHASE: { title: 'Purchase Register', sql:
        `SELECT invoice_date AS date, invoice_no AS doc_no, party_name, purchase_amount AS taxable,
                gst_amount, bill_amount AS total FROM purchase
         WHERE invoice_date BETWEEN @from AND @to ORDER BY invoice_date, id` },
      PURCHASERETURN: { title: 'Purchase Return Register', sql:
        `SELECT return_date AS date, return_no AS doc_no, party_name, bill_amount AS taxable,
                gst_amount, total_amount AS total FROM purchase_return
         WHERE return_date BETWEEN @from AND @to ORDER BY return_date, id` },
    }
    const spec = specs[book] || specs.SALES
    const rows = db.prepare(spec.sql).all(range)
    const sum = (k) => calc.r2(rows.reduce((s, r) => s + num(r[k]), 0))
    return {
      book, title: spec.title, rows,
      totals: { taxable: sum('taxable'), gst_amount: sum('gst_amount'), total: sum('total') },
    }
  },

  /**
   * Old Gold report — every piece of old gold the shop took in, whether on a
   * sale bill (exchanged against new jewellery) or on an old gold bill of its
   * own (bought outright), one row per line with the weights it was priced on.
   *
   * The totals are what the owner actually asks: how many grams of fine gold
   * came in, what was paid for it, and what that works out to per gram. The
   * stock strip is not period-bound — it is the URD gold sitting in the safe
   * right now, after whatever has been melted or converted out.
   */
  oldGold: ({ from, to, search } = {}) => {
    const db = get()
    const range = { from: from || '1900-01-01', to: to || '2999-12-31', search: search ?? '' }
    const rows = db.prepare(
      `SELECT u.id, u.name, u.description, u.gross_wt, u.net_wt, u.purity, u.final_wt,
              u.rate, u.amount,
              COALESCE(s.bill_date, b.bill_date)   AS date,
              COALESCE(s.bill_no, b.bill_no)       AS doc_no,
              COALESCE(s.party_name, b.party_name) AS party_name,
              CASE WHEN s.id IS NOT NULL THEN 'SALE' ELSE 'URD' END AS source,
              s.id AS sale_id, b.id AS urd_bill_id
       FROM sale_urd u
       LEFT JOIN sale s     ON s.id = u.sale_id
       LEFT JOIN urd_bill b ON b.id = u.urd_bill_id
       WHERE COALESCE(s.bill_date, b.bill_date) BETWEEN @from AND @to
         AND (@search = ''
              OR COALESCE(s.party_name, b.party_name) LIKE '%'||@search||'%'
              OR COALESCE(s.bill_no, b.bill_no) LIKE '%'||@search||'%')
       ORDER BY date, doc_no, u.line_no`
    ).all(range)

    const sum = (list, k) => list.reduce((a, r) => a + num(r[k]), 0)
    const tot = (list) => {
      const fine = calc.r3(sum(list, 'final_wt'))
      const amount = calc.r2(sum(list, 'amount'))
      return {
        lines: list.length,
        bills: new Set(list.map((r) => r.doc_no)).size,
        gross_wt: calc.r3(sum(list, 'gross_wt')),
        net_wt: calc.r3(sum(list, 'net_wt')),
        fine_wt: fine,
        amount,
        avg_rate: fine > 0 ? calc.r2(amount / fine) : 0,
      }
    }
    const byMonth = new Map()
    for (const r of rows) {
      const k = String(r.date).slice(0, 7)
      if (!byMonth.has(k)) byMonth.set(k, [])
      byMonth.get(k).push(r)
    }

    // URD gold in the safe right now, all time: taken in, gone out (melted,
    // converted, refined) and what is left.
    const stock = db.prepare(
      `SELECT COALESCE(SUM(CASE WHEN direction='IN'  THEN fine_wt  END),0) fine_in,
              COALESCE(SUM(CASE WHEN direction='OUT' THEN fine_wt  END),0) fine_out,
              COALESCE(SUM(CASE WHEN direction='IN'  THEN gross_wt END),0) gross_in,
              COALESCE(SUM(CASE WHEN direction='OUT' THEN gross_wt END),0) gross_out
       FROM loose_stock WHERE is_urd = 1 AND metal = 'Gold'`
    ).get()

    return {
      range: { from: range.from, to: range.to },
      rows,
      totals: tot(rows),
      bySource: {
        SALE: tot(rows.filter((r) => r.source === 'SALE')),
        URD: tot(rows.filter((r) => r.source === 'URD')),
      },
      byMonth: [...byMonth.entries()].map(([month, list]) => ({ month, ...tot(list) })),
      stock: {
        fine_in: calc.r3(stock.fine_in), fine_out: calc.r3(stock.fine_out),
        fine_on_hand: calc.r3(num(stock.fine_in) - num(stock.fine_out)),
        gross_in: calc.r3(stock.gross_in), gross_out: calc.r3(stock.gross_out),
        gross_on_hand: calc.r3(num(stock.gross_in) - num(stock.gross_out)),
      },
    }
  },

  /** Day Book — the daily cash/credit summary plus stock and cash positions. */
  dayBook: ({ from, to }) => {
    const db = get()
    const range = { from: from || today(), to: to || from || today() }

    const sales = db
      .prepare(
        `SELECT COALESCE(SUM(CASE WHEN is_credit=0 THEN total_amount END),0) cash,
                COALESCE(SUM(CASE WHEN is_credit=1 THEN total_amount END),0) credit,
                COALESCE(SUM(urd_amount),0) urd, COUNT(*) n
         FROM sale WHERE bill_date BETWEEN @from AND @to`
      )
      .get(range)

    const purchases = db
      .prepare(
        `SELECT COALESCE(SUM(CASE WHEN is_credit=0 THEN bill_amount END),0) cash,
                COALESCE(SUM(CASE WHEN is_credit=1 THEN bill_amount END),0) credit, COUNT(*) n
         FROM purchase WHERE invoice_date BETWEEN @from AND @to`
      )
      .get(range)

    // The video's Day Book carries return rows of its own; without them a day with
    // returns in it reads as more trade than actually happened.
    const salesReturn = db
      .prepare(
        `SELECT COALESCE(SUM(total_amount),0) amt, COALESCE(SUM(refund_amount),0) refunded,
                COUNT(*) n FROM sale_return WHERE return_date BETWEEN @from AND @to`
      )
      .get(range)

    const purchaseReturnT = db
      .prepare(
        `SELECT COALESCE(SUM(total_amount),0) amt, COALESCE(SUM(received_amount),0) received,
                COUNT(*) n FROM purchase_return WHERE return_date BETWEEN @from AND @to`
      )
      .get(range)

    const settlements = db
      .prepare(
        `SELECT COALESCE(SUM(bill_amount),0) amt, COALESCE(SUM(fine_wt),0) fine, COUNT(*) n
         FROM stock_settlement WHERE settle_date BETWEEN @from AND @to`
      )
      .get(range)

    // Old gold bought on its own bill. `paid` left the drawer or the bank today;
    // `credit` is what the customers are still owed for it.
    const urdBills = db
      .prepare(
        `SELECT COALESCE(SUM(purchase_amount - discount + other_amount),0) amt,
                COALESCE(SUM(amount_given),0) paid, COALESCE(SUM(net_balance),0) credit,
                COALESCE(SUM(purchase_amount),0) urd, COUNT(*) n
         FROM urd_bill WHERE bill_date BETWEEN @from AND @to`
      )
      .get(range)

    const receipts = db
      .prepare(
        `SELECT kind, COALESCE(SUM(amount),0) amt FROM voucher
         WHERE voucher_date BETWEEN @from AND @to GROUP BY kind`
      )
      .all(range)

    /**
     * Stock position in all three weights, per metal.
     *
     * The original shows Gross / Net / Final as separate opening-and-closing
     * pairs, not one fine figure: gross is what is physically on the shelf,
     * net is that less stones, and fine is the pure metal in it. A shop counting
     * its trays counts gross, so a book that only reports fine cannot be checked
     * against a physical count.
     */
    const weightsAt = (cutoff, cmp, isUrd) =>
      db
        .prepare(
          `SELECT metal,
                  COALESCE(SUM(CASE WHEN direction='IN' THEN gross_wt ELSE -gross_wt END),0) gross_wt,
                  COALESCE(SUM(CASE WHEN direction='IN' THEN net_wt   ELSE -net_wt   END),0) net_wt,
                  COALESCE(SUM(CASE WHEN direction='IN' THEN fine_wt  ELSE -fine_wt  END),0) fine_wt
           FROM loose_stock
           WHERE is_urd = @isUrd AND entry_date ${cmp} @cutoff
           GROUP BY metal`
        )
        .all({ cutoff, isUrd })

    /** Merge an opening and a closing snapshot into one row per metal. */
    const pairUp = (opening, closing) => {
      const seen = new Map()
      const put = (side, r) => {
        const m = seen.get(r.metal) || {
          metal: r.metal,
          opening: { gross_wt: 0, net_wt: 0, fine_wt: 0 },
          closing: { gross_wt: 0, net_wt: 0, fine_wt: 0 },
        }
        m[side] = {
          gross_wt: calc.r3(r.gross_wt), net_wt: calc.r3(r.net_wt), fine_wt: calc.r3(r.fine_wt),
        }
        seen.set(r.metal, m)
      }
      opening.forEach((r) => put('opening', r))
      closing.forEach((r) => put('closing', r))
      // Metals the shop actually deals in, in a stable order, so a metal that
      // only appears mid-period does not jump about between days.
      return [...seen.values()].sort(
        (a, b) => ['Gold', 'Silver', 'Platinum'].indexOf(a.metal) -
                  ['Gold', 'Silver', 'Platinum'].indexOf(b.metal)
      )
    }

    const metals = pairUp(
      weightsAt(range.from, '<', 0), weightsAt(range.to, '<=', 0)
    )
    const urdMetals = pairUp(
      weightsAt(range.from, '<', 1), weightsAt(range.to, '<=', 1)
    )
    const gold = metals.find((m) => m.metal === 'Gold')
    const urdGold = urdMetals.find((m) => m.metal === 'Gold')

    /**
     * Loose lots — mani, fuli, dori — opened and closed for the day, in grams.
     *
     * They cannot ride in the metal block above: that block is per metal and
     * every column of it is a metal weight, and beads have no fine weight to put
     * in the one column that matters there. So they get their own strip, per
     * item, which is the only way a shop counting its bead boxes can check the
     * day book against what is in front of it.
     */
    const looseAt = (cutoff, cmp) => new Map(db.prepare(
      `SELECT item_id, COALESCE(SUM(CASE WHEN direction='IN' THEN gross_wt
                                         ELSE -gross_wt END),0) wt
       FROM item_stock WHERE entry_date ${cmp} @cutoff GROUP BY item_id`
    ).all({ cutoff }).map((r) => [r.item_id, r.wt]))
    const looseOpen = looseAt(range.from, '<')
    const looseClose = looseAt(range.to, '<=')
    const looseItems = db
      .prepare(`SELECT id, name, uom FROM item WHERE stock_mode = 'LOOSE_WT' ORDER BY name`)
      .all()
      .map((i) => ({
        item_id: i.id, name: i.name, uom: i.uom,
        opening: calc.r3(looseOpen.get(i.id) || 0),
        closing: calc.r3(looseClose.get(i.id) || 0),
      }))
      // A lot that was empty all day tells the shopkeeper nothing and pushes the
      // rows that matter off the strip.
      .filter((r) => r.opening !== 0 || r.closing !== 0)

    /**
     * Every cash and bank account, not just "Cash Account". A shop with an SBI
     * terminal and a cash drawer needs both balances side by side; folding them
     * into one figure hides which of the two is actually short.
     */
    const moneyAccounts = db
      .prepare(
        `SELECT a.id, a.name, a.acc_type,
                COALESCE((SELECT SUM(e.debit - e.credit) FROM ledger_entry e
                          WHERE e.account_id = a.id AND e.entry_date < @from),0)
                  + CASE WHEN a.opening_dr_cr = 'Dr' THEN a.opening_balance ELSE -a.opening_balance END
                  AS opening,
                COALESCE((SELECT SUM(e.debit - e.credit) FROM ledger_entry e
                          WHERE e.account_id = a.id AND e.entry_date <= @to),0)
                  + CASE WHEN a.opening_dr_cr = 'Dr' THEN a.opening_balance ELSE -a.opening_balance END
                  AS closing
         FROM account a
         WHERE a.acc_type IN ('Cash','Bank') OR a.acc_group = 'Bank Accounts'
         ORDER BY a.acc_type DESC, a.code`
      )
      .all(range)
      .map((a) => ({
        ...a, opening: calc.r2(a.opening), closing: calc.r2(a.closing),
        movement: calc.r2(num(a.closing) - num(a.opening)),
      }))

    /**
     * "Today Received Details" — what came in, by how it was paid. Bills and
     * receipt vouchers both count; a day's takings are not only its invoices.
     */
    const byMode = new Map()
    const bump = (mode, v) => {
      const k = mode || 'Cash'
      byMode.set(k, calc.r2((byMode.get(k) || 0) + num(v)))
    }
    // A bill settled in more than one way is counted leg by leg — the split rows
    // are the truth for it, and its own payment_mode would otherwise book the
    // whole amount against the largest leg's mode alone.
    db.prepare(
      `SELECT s.payment_mode, COALESCE(SUM(s.amount_received),0) v FROM sale s
       WHERE s.bill_date BETWEEN @from AND @to AND s.amount_received > 0
         AND NOT EXISTS (SELECT 1 FROM sale_payment p WHERE p.sale_id = s.id)
       GROUP BY s.payment_mode`
    ).all(range).forEach((r) => bump(r.payment_mode, r.v))
    db.prepare(
      `SELECT p.mode, COALESCE(SUM(p.amount),0) v FROM sale_payment p
       JOIN sale s ON s.id = p.sale_id
       WHERE s.bill_date BETWEEN @from AND @to
       GROUP BY p.mode`
    ).all(range).forEach((r) => bump(r.mode, r.v))
    db.prepare(
      `SELECT payment_type, COALESCE(SUM(amount),0) v FROM voucher
       WHERE kind = 'RECEIPT' AND voucher_date BETWEEN @from AND @to
       GROUP BY payment_type`
    ).all(range).forEach((r) => bump(r.payment_type, r.v))
    const receivedBy = [...byMode.entries()]
      .map(([mode, amount]) => ({ mode, amount }))
      .filter((r) => Math.abs(r.amount) >= 0.005)
      .sort((a, b) => b.amount - a.amount)

    const stockOpening = gold?.opening.fine_wt ?? 0
    const stockClosing = gold?.closing.fine_wt ?? 0
    const urdOpening = urdGold?.opening.fine_wt ?? 0
    const urdClosing = urdGold?.closing.fine_wt ?? 0

    // The legacy single `cash` pair is taken from the same rows as the per-account
    // list above rather than recomputed. Computing it separately meant it ignored
    // the account's opening balance, so one payload could report two different
    // opening figures for the same Cash Account.
    const cashRow = moneyAccounts.find((a) => a.name === 'Cash Account')

    return {
      range,
      sales, purchases,
      sales_return: salesReturn,
      purchase_return: purchaseReturnT,
      urd_bills: urdBills,
      settlements,
      receipts: Object.fromEntries(receipts.map((r) => [r.kind, r.amt])),
      // Gross / net / fine opening and closing, one row per metal, plus the same
      // for old gold taken in. `stock.gold_*` below stays as the single fine pair
      // it always was, so anything already reading it keeps working.
      metals, urdMetals, looseItems, receivedBy, accounts: moneyAccounts,
      stock: {
        gold_opening: calc.r3(stockOpening), gold_closing: calc.r3(stockClosing),
        urd_opening: calc.r3(urdOpening), urd_closing: calc.r3(urdClosing),
        // Split of the closing figure: pieces with tags vs metal still loose.
        tagged_closing: calc.r3(
          db.prepare(
            `SELECT COALESCE(SUM(CASE WHEN direction='IN' THEN fine_wt ELSE -fine_wt END),0) v
             FROM loose_stock WHERE metal = 'Gold' AND is_tagged = 1 AND entry_date <= ?`
          ).get(range.to).v
        ),
        loose_closing: calc.r3(
          db.prepare(
            `SELECT COALESCE(SUM(CASE WHEN direction='IN' THEN fine_wt ELSE -fine_wt END),0) v
             FROM loose_stock WHERE metal = 'Gold' AND is_tagged = 0 AND is_urd = 0 AND entry_date <= ?`
          ).get(range.to).v
        ),
      },
      cash: { opening: cashRow?.opening ?? 0, closing: cashRow?.closing ?? 0 },
    }
  },

  /** Outstanding debtors / creditors. */
  outstanding: ({ type = 'CUSTOMER' } = {}) =>
    party.list({ type }).filter((p) => Math.abs(num(p.balance)) > 0.009),

  /**
   * Reorder alert — items whose in-stock piece count has fallen below their
   * reorder level, docs/VIDEO-SPEC-2.md §7 gap #15. Only items with a level set
   * (> 0) are watched; `short` is how many to make/buy to get back to the level.
   */
  /**
   * Changeover check — the shop's OLD books against this one, side by side.
   *
   * Every figure in this app has been verified against tests. That is not the
   * same as being right, and no amount of testing makes it the same. The only
   * thing that settles it is running both systems over the same period and
   * seeing whether they agree — so this exists to make that possible rather
   * than to make it unnecessary.
   *
   * The shop types what its current system says as on a date; this returns its
   * own figure beside it and the difference. Anything that does not match is
   * listed with where to look, because "the debtors are out by 4,300" is only
   * useful if you can find which customer.
   *
   * `expected` values are optional — a blank one is reported as "not checked"
   * rather than as agreement, because an unanswered question is not a pass.
   */
  reconcile: ({ as_on, expected = {} } = {}) => {
    const db = get()
    const asOn = as_on || today()
    const fy = db.prepare(`SELECT fy_start FROM company WHERE id = 1`).get()
    const from = fy?.fy_start || '1900-01-01'
    const b = computeBooks(db, { from, to: asOn })

    // Metal on hand, in fine grams — the number a physical count produces.
    const fineOnHand = calc.r3(db.prepare(
      `SELECT COALESCE(SUM(CASE WHEN direction='IN' THEN fine_wt ELSE -fine_wt END),0) v
       FROM loose_stock WHERE metal = 'Gold' AND entry_date <= ?`).get(asOn).v)

    const has = (k) => expected[k] !== undefined && expected[k] !== null && expected[k] !== ''
    const line = (key, label, ours, unit, where) => {
      const checked = has(key)
      const theirs = checked ? num(expected[key]) : null
      const diff = checked ? calc.r2(num(ours) - theirs) : null
      // A gram is worth thousands, so weights get a tighter tolerance than money.
      const tol = unit === 'g' ? 0.005 : 0.5
      return {
        key, label, unit,
        ours: unit === 'g' ? calc.r3(ours) : calc.r2(ours),
        theirs, difference: diff,
        status: !checked ? 'not checked' : Math.abs(diff) <= tol ? 'agrees' : 'differs',
        where,
      }
    }

    const rows = [
      line('cash', 'Cash in hand', b.cash, '₹',
        'Cash Book — check the opening balance on the account first'),
      line('bank', 'Bank balance', b.bank, '₹',
        'Cash Book, switched to Bank Account'),
      line('debtors', 'Customers owe us', b.debtorTotal, '₹',
        'Outstanding → Money. Compare customer by customer'),
      line('creditors', 'We owe suppliers', b.creditorTotal, '₹',
        'Outstanding → Money, creditor side'),
      line('stock_fine', 'Gold on hand', fineOnHand, 'g',
        'Stock Report for tagged pieces; the rest is loose metal in the safe'),
      line('stock_value', 'Stock at cost', b.closingStock, '₹',
        'Stock Report → Value at Cost. Pieces with no Cost/Gm are excluded'),
      line('gst', 'GST payable', b.gstPayable, '₹',
        'GST Reports → GSTR-3B'),
      line('scheme', 'Scheme deposits held', b.gss, '₹',
        'MIS & Scheme Reports → Allocated'),
    ]

    const checked = rows.filter((r) => r.status !== 'not checked')
    const differing = checked.filter((r) => r.status === 'differs')
    return {
      as_on: asOn, from,
      rows,
      checked: checked.length,
      agreeing: checked.length - differing.length,
      differing: differing.length,
      // The party lists come back too: a debtors difference is chased customer
      // by customer, and having to open another screen to do it loses the thread.
      debtors: b.debtors, creditors: b.creditors,
      // Flagged rather than buried — an unpriced piece silently drags stock value
      // down and is the most common reason the stock figure will not tie.
      uncostedPieces: db.prepare(
        `SELECT COUNT(*) c FROM tag_stock WHERE status = 'IN_STOCK' AND purchase_rate <= 0`
      ).get().c,
    }
  },

  reorder: () =>
    get().prepare(
      `SELECT i.id, i.name, g.name AS group_name, i.reorder_level,
              COALESCE((SELECT COUNT(*) FROM tag_stock ts
                        WHERE ts.item_id = i.id AND ts.status = 'IN_STOCK'), 0) AS in_stock
       FROM item i LEFT JOIN item_group g ON g.id = i.item_group_id
       WHERE i.reorder_level > 0
       ORDER BY i.name`
    ).all()
      .map((r) => ({ ...r, short: Math.max(0, r.reorder_level - r.in_stock) }))
      .filter((r) => r.in_stock < r.reorder_level),

  /** GSTR-1 style B2B register. */
  gstRegister: ({ from, to }) =>
    get()
      .prepare(
        // "transaction" is a reserved word in SQLite — it must stay quoted.
        `SELECT s.bill_date AS date, s.bill_no AS invoice_no, 'Sales' AS "transaction",
                s.party_name, s.gst_amount, s.bill_amount AS taxable_value,
                s.total_amount AS invoice_value, p.gstin, s.state AS place_of_supply
         FROM sale s LEFT JOIN party p ON p.id = s.party_id
         WHERE s.bill_date BETWEEN @from AND @to AND s.gst_amount > 0
         ORDER BY s.bill_date, s.id`
      )
      .all({ from: from || '1900-01-01', to: to || '2999-12-31' }),

  /**
   * GST returns — docs/VIDEO-SPEC-2.md §5/§6, gap #22.
   *
   * GSTR-1 (outward / sales) and GSTR-2 (inward / purchases): one row per
   * document, split into CGST + SGST for a supply inside the shop's own state
   * and IGST for an inter-state one (place of supply vs the company's state), and
   * grouped B2B (the party has a GSTIN) vs B2C.
   */
  gstReturn: ({ direction = 'OUT', from, to } = {}) => {
    const db = get()
    const range = { from: from || '1900-01-01', to: to || '2999-12-31' }
    const homeState = (company.read()?.state || '').trim().toLowerCase()
    const raw = direction === 'IN'
      ? db.prepare(
          `SELECT pu.invoice_date AS date, pu.invoice_no AS doc_no, pu.party_name,
                  pu.purchase_amount AS taxable, pu.gst_amount, pu.bill_amount AS total,
                  pu.state AS place_of_supply, p.gstin
           FROM purchase pu LEFT JOIN party p ON p.id = pu.party_id
           WHERE pu.invoice_date BETWEEN @from AND @to AND pu.gst_amount > 0
           ORDER BY pu.invoice_date, pu.id`).all(range)
      : db.prepare(
          `SELECT s.bill_date AS date, s.bill_no AS doc_no, s.party_name,
                  s.bill_amount AS taxable, s.gst_amount, s.total_amount AS total,
                  s.state AS place_of_supply, p.gstin
           FROM sale s LEFT JOIN party p ON p.id = s.party_id
           WHERE s.bill_date BETWEEN @from AND @to AND s.gst_amount > 0
           ORDER BY s.bill_date, s.id`).all(range)

    const rows = raw.map((r) => {
      const intra = (r.place_of_supply || '').trim().toLowerCase() === homeState
      const gst = num(r.gst_amount)
      return {
        ...r,
        taxable: calc.r2(r.taxable), gst_amount: calc.r2(gst), total: calc.r2(r.total),
        cgst: intra ? calc.r2(gst / 2) : 0,
        sgst: intra ? calc.r2(gst / 2) : 0,
        igst: intra ? 0 : calc.r2(gst),
        supply: intra ? 'Intra' : 'Inter',
        segment: r.gstin ? 'B2B' : 'B2C',
      }
    })
    const sub = (pred) => {
      const rs = rows.filter(pred)
      return {
        count: rs.length,
        taxable: calc.r2(rs.reduce((s, r) => s + r.taxable, 0)),
        gst: calc.r2(rs.reduce((s, r) => s + r.gst_amount, 0)),
      }
    }
    return {
      direction, rows,
      b2b: sub((r) => r.segment === 'B2B'),
      b2c: sub((r) => r.segment === 'B2C'),
      totals: {
        taxable: calc.r2(rows.reduce((s, r) => s + r.taxable, 0)),
        cgst: calc.r2(rows.reduce((s, r) => s + r.cgst, 0)),
        sgst: calc.r2(rows.reduce((s, r) => s + r.sgst, 0)),
        igst: calc.r2(rows.reduce((s, r) => s + r.igst, 0)),
        gst: calc.r2(rows.reduce((s, r) => s + r.gst_amount, 0)),
        total: calc.r2(rows.reduce((s, r) => s + r.total, 0)),
      },
    }
  },

  /**
   * GSTR-3B summary — output tax on sales, input tax credit on buys, and the net
   * cash payable. Same figures as the accounting books' GST line, laid out the
   * way the monthly return reads.
   */
  gstSummary: ({ from, to } = {}) => {
    const b = computeBooks(get(), { from, to })
    const net = calc.r2(b.gstOutput - b.gstInput)
    return {
      range: b.range,
      output_tax: b.gstOutput,
      input_tax: b.gstInput,
      net_payable: net > 0 ? net : 0,
      credit_carried: net < 0 ? -net : 0,
      tcs_collected: b.tcsPayable,
      tds_deducted: b.tdsPayable,
    }
  },

  /**
   * HSN-wise summary — sale lines grouped by HSN code, with taxable value and the
   * tax on it (apportioned from the bill's GST rate). Required in the GST return.
   */
  hsnSummary: ({ from, to } = {}) => {
    const db = get()
    const range = { from: from || '1900-01-01', to: to || '2999-12-31' }
    const rows = db.prepare(
      `SELECT COALESCE(NULLIF(i.hsn,''),'—') AS hsn,
              COUNT(*) AS lines,
              COALESCE(SUM(i.qty),0) AS qty,
              COALESCE(SUM(i.item_total),0) AS taxable,
              COALESCE(SUM(i.item_total * s.gst_pct / 100.0),0) AS tax
       FROM sale_item i JOIN sale s ON s.id = i.sale_id
       WHERE s.bill_date BETWEEN @from AND @to AND s.gst_not_required = 0
       GROUP BY hsn ORDER BY taxable DESC`).all(range)
    return {
      rows: rows.map((r) => ({
        hsn: r.hsn, lines: r.lines, qty: calc.r3(r.qty),
        taxable: calc.r2(r.taxable), tax: calc.r2(r.tax),
      })),
      totals: {
        taxable: calc.r2(rows.reduce((s, r) => s + num(r.taxable), 0)),
        tax: calc.r2(rows.reduce((s, r) => s + num(r.tax), 0)),
      },
    }
  },

  /**
   * TCS collected on sales and TDS deducted from karagir labour, docs §6 — the
   * amounts the shop has withheld and must deposit.
   */
  tcsTds: ({ from, to } = {}) => {
    const db = get()
    const range = { from: from || '1900-01-01', to: to || '2999-12-31' }
    const tcs = db.prepare(
      `SELECT bill_no AS doc_no, bill_date AS date, party_name, tcs_pct, tcs_amount AS amount
       FROM sale WHERE bill_date BETWEEN @from AND @to AND tcs_amount > 0
       ORDER BY bill_date, id`).all(range)
    const tds = db.prepare(
      `SELECT receive_no AS doc_no, receive_date AS date, karagir_name AS party_name,
              tds_pct, tds_amount AS amount
       FROM karagir_receive WHERE receive_date BETWEEN @from AND @to AND tds_amount > 0
       ORDER BY receive_date, id`).all(range)
    const sum = (rs) => calc.r2(rs.reduce((s, r) => s + num(r.amount), 0))
    return { tcs, tds, tcsTotal: sum(tcs), tdsTotal: sum(tds) }
  },

  /**
   * Trial Balance — every ledger head with its Dr or Cr balance, docs §5.
   *
   * Foots by construction: each document posted equal value to both sides, so
   * the only residual is proprietor's capital / opening differences, which is
   * shown as its own balancing line rather than swept under the rug.
   */
  trialBalance: ({ from, to } = {}) => {
    const b = computeBooks(get(), { from, to })
    const dr = []
    const cr = []
    const put = (side, name, amount) => {
      if (Math.abs(amount) < 0.005) return
      ;(side === 'Dr' ? dr : cr).push({ name, amount: calc.r2(amount) })
    }
    // assets
    put('Dr', 'Cash Account', b.cash)
    put('Dr', 'Bank Account', b.bank)
    put('Dr', 'Sundry Debtors', b.debtorTotal)
    // liabilities
    put('Cr', 'Sundry Creditors', b.creditorTotal)
    put('Cr', 'Gold Saving Scheme', b.gss)
    put(b.gstPayable >= 0 ? 'Cr' : 'Dr', 'GST Payable', Math.abs(b.gstPayable))
    put('Cr', 'TCS Payable', b.tcsPayable)
    put('Cr', 'TDS Payable', b.tdsPayable)
    // income
    put('Cr', 'Sales Account', b.salesRevenue)
    put('Cr', 'Other Charges', b.otherCharges)
    // direct + indirect expense
    put('Dr', 'Purchase Account', b.purchases)
    put('Dr', 'Old Gold Purchase', b.oldGold)
    put('Dr', 'Refining Charges', b.refiningCharges)
    put('Dr', 'Karagir Labour', b.karagirLabour)
    put('Dr', 'Discount Allowed', b.discountAllowed)
    b.expenseHeads.forEach((e) => put('Dr', e.name, e.amount))

    const drTotal = calc.r2(dr.reduce((s, r) => s + r.amount, 0))
    const crTotal = calc.r2(cr.reduce((s, r) => s + r.amount, 0))
    // Whatever is left over is capital brought forward / un-booked opening
    // differences. Park it on the light side so the two columns agree.
    const diff = calc.r2(drTotal - crTotal)
    if (Math.abs(diff) >= 0.005) {
      if (diff > 0) cr.push({ name: 'Capital / Opening Difference', amount: diff, balancing: true })
      else dr.push({ name: 'Capital / Opening Difference', amount: -diff, balancing: true })
    }
    const grand = calc.r2(Math.max(drTotal, crTotal))
    return { range: b.range, dr, cr, drTotal: grand, crTotal: grand, difference: diff }
  },

  /** Trading and Profit & Loss account for a period, docs §5. */
  profitAndLoss: ({ from, to, openingStock } = {}) => {
    const b = computeBooks(get(), { from, to, openingStock })
    // Trading account → Gross Profit
    const tradingDr = [
      { name: 'Opening Stock', amount: b.openStock },
      { name: 'Purchases', amount: b.purchases },
      { name: 'Old Gold Purchase', amount: b.oldGold },
    ].filter((r) => Math.abs(r.amount) >= 0.005)
    const tradingCr = [
      { name: 'Sales', amount: b.salesRevenue },
      { name: 'Other Charges', amount: b.otherCharges },
      { name: 'Closing Stock (at cost)', amount: b.closingStock },
    ].filter((r) => Math.abs(r.amount) >= 0.005)
    // Profit & Loss account → Net Profit
    const plDr = [
      { name: 'Refining Charges', amount: b.refiningCharges },
      { name: 'Karagir Labour', amount: b.karagirLabour },
      { name: 'Discount Allowed', amount: b.discountAllowed },
      ...b.expenseHeads,
    ].filter((r) => Math.abs(r.amount) >= 0.005)
    return {
      range: b.range,
      trading: { dr: tradingDr, cr: tradingCr, grossProfit: b.grossProfit },
      pl: { dr: plDr, indirectExpenses: b.indirectExpenses, netProfit: b.netProfit },
      grossProfit: b.grossProfit, netProfit: b.netProfit,
    }
  },

  /**
   * Balance Sheet as-on a date, docs §5. Capital is the balancing figure, so
   * the statement always agrees; the period's Net Profit is shown inside it so
   * the reader can see how much of that capital the business just earned.
   */
  balanceSheet: ({ from, to, openingStock } = {}) => {
    const b = computeBooks(get(), { from, to, openingStock })
    const assets = [
      { name: 'Cash Account', amount: b.cash },
      { name: 'Bank Account', amount: b.bank },
      { name: 'Sundry Debtors', amount: b.debtorTotal },
      { name: 'Closing Stock (at cost)', amount: b.closingStock },
    ]
    // A net GST *credit* (we paid more than we collected) is money owed back to
    // us — an asset — so it swaps sides.
    if (b.gstPayable < -0.005) assets.push({ name: 'GST Receivable', amount: -b.gstPayable })
    const assetRows = assets.filter((r) => Math.abs(r.amount) >= 0.005)
    const assetTotal = calc.r2(assetRows.reduce((s, r) => s + r.amount, 0))

    const outsideLiabs = [
      { name: 'Sundry Creditors', amount: b.creditorTotal },
      { name: 'Gold Saving Scheme deposits', amount: b.gss },
      { name: 'GST Payable', amount: b.gstPayable > 0.005 ? b.gstPayable : 0 },
      { name: 'TCS Payable', amount: b.tcsPayable },
      { name: 'TDS Payable', amount: b.tdsPayable },
    ].filter((r) => Math.abs(r.amount) >= 0.005)
    const outsideTotal = calc.r2(outsideLiabs.reduce((s, r) => s + r.amount, 0))
    // Capital is whatever makes the two sides meet. Of that, the period's profit
    // is called out separately.
    const capital = calc.r2(assetTotal - outsideTotal)
    const liabRows = [
      { name: 'Capital Account', amount: capital, note: `incl. period net profit ${b.netProfit.toFixed(2)}` },
      ...outsideLiabs,
    ]
    return {
      range: b.range,
      assets: assetRows, liabilities: liabRows,
      assetTotal, liabilityTotal: calc.r2(capital + outsideTotal),
      capital, netProfit: b.netProfit,
    }
  },

  /** Dashboard tiles. */
  dashboard: () => {
    const db = get()
    const t = today()
    const monthStart = t.slice(0, 8) + '01'
    const todaySales = db
      .prepare(`SELECT COALESCE(SUM(total_amount),0) v, COUNT(*) n FROM sale WHERE bill_date = ?`)
      .get(t)
    const monthSales = db
      .prepare(`SELECT COALESCE(SUM(total_amount),0) v, COUNT(*) n FROM sale WHERE bill_date >= ?`)
      .get(monthStart)
    const stock = db
      .prepare(
        `SELECT COUNT(*) pieces, COALESCE(SUM(gross_wt),0) gross, COALESCE(SUM(final_wt),0) fine
         FROM tag_stock WHERE status = 'IN_STOCK'`
      )
      .get()
    const receivable = db
      .prepare(
        `SELECT COALESCE(SUM(bal),0) v FROM (
           SELECT p.opening_balance * (CASE p.opening_dr_cr WHEN 'Dr' THEN 1 ELSE -1 END)
             + COALESCE((SELECT SUM(l.debit-l.credit) FROM ledger_entry l WHERE l.party_id=p.id),0) AS bal
           FROM party p WHERE p.party_type='CUSTOMER')
         WHERE bal > 0`
      )
      .get()
    const recent = db
      .prepare(
        `SELECT id, bill_no, bill_date, party_name, total_amount
         FROM sale ORDER BY id DESC LIMIT 8`
      )
      .all()
    return {
      todaySales, monthSales, stock,
      receivable: calc.r2(receivable.v),
      customers: db.prepare(`SELECT COUNT(*) c FROM party WHERE party_type='CUSTOMER'`).get().c,
      recent,
    }
  },
}

module.exports = {
  company, settings,
  itemType, itemGroup, design, item, rateMaster, gridPref, branch, stockTransfer,
  tagStock, looseStock, looseItem, party, account, series,
  sale, urd, purchase, refinery, order, voucher, stockSettlement,
  saleReturn, purchaseReturn, karagir, gss, reports,
  calc: {
    saleTotals: (p) => calc.saleTotals(p.head, p.items, p.urds, p.metals),
    urdTotals: (p) => calc.urdTotals(p.head, p.urds),
    amountInWords: ({ amount }) => calc.amountInWords(amount),
  },
}
