/**
 * Stock-master fields and reorder levels — docs/VIDEO-SPEC-2.md §7, gaps #16 & #15.
 *
 * A tagged piece can carry a category, salesman, shelf/tray and size; the stock
 * report can group by any of them. An item can carry a reorder level, and the
 * reorder alert flags items whose in-stock count has fallen below it.
 *    npm run test:stockmaster
 */
const { app } = require('electron')
const path = require('node:path')
const fs = require('node:fs')
const os = require('node:os')

const DAY = '2026-07-21'

let pass = 0
let fail = 0

function check(label, actual, expected, tol = 0.005) {
  const ok =
    typeof expected === 'number'
      ? Math.abs(Number(actual) - expected) <= tol
      : String(actual) === String(expected)
  if (ok) { pass++; console.log(`  PASS  ${label} = ${actual}`) }
  else { fail++; console.log(`  FAIL  ${label}: got ${actual}, expected ${expected}`) }
}
const head = (t) => console.log(`\n── ${t} ${'─'.repeat(Math.max(0, 46 - t.length))}`)

app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'parivar-run-')))

app.whenReady().then(() => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'parivar-sm-'))
  const db = require('../electron/db.cjs')
  db.open(tmp)
  const api = require('../electron/api.cjs')

  const g = (name) => api.itemGroup.list().find((x) => x.name === name)

  try {
    head('1. An item with a reorder level')
    const g22 = g('22K Gold')
    const itemId = api.item.save({
      name: 'Ladies Ring', item_type_id: g22.item_type_id, item_group_id: g22.id,
      design_id: null, weight_mode: 'WEIGHT', uom: 'GRAM', hsn: '7113', image: '',
      reorder_level: 5,
    })
    const it = api.item.list().find((x) => x.id === itemId)
    check('reorder level saved on the item', it.reorder_level, 5)

    head('2. Tag two pieces with the new attributes')
    api.tagStock.saveBatch({
      itemId,
      rows: [
        { gross_wt: 8, purity: 91.6, entry_date: DAY, category: 'Ladies', salesman: 'Ravi', shelf_tray: 'A1', size: '14' },
        { gross_wt: 9, purity: 91.6, entry_date: DAY, category: 'Ladies', salesman: 'Ravi', shelf_tray: 'A1', size: '16' },
      ],
    })
    const tags = api.tagStock.list({ status: 'IN_STOCK' })
    check('two pieces in stock', tags.length, 2)
    check('category stored', tags[0].category, 'Ladies')
    check('salesman stored', tags[0].salesman, 'Ravi')
    check('shelf/tray stored', tags[0].shelf_tray, 'A1')
    check('size stored per piece', tags.map((t) => t.size).sort().join(','), '14,16')

    head('3. The stock report can group by the new fields')
    const byCat = api.reports.stock({ status: 'IN_STOCK', groupBy: 'category' })
    check('one category group', byCat.groups.length, 1)
    check('group key is the category', byCat.groups[0].key, 'Ladies')
    check('both pieces in it', byCat.groups[0].count, 2)
    const byShelf = api.reports.stock({ status: 'IN_STOCK', groupBy: 'shelf' })
    check('grouped by shelf/tray', byShelf.groups[0].key, 'A1')
    const bySalesman = api.reports.stock({ status: 'IN_STOCK', groupBy: 'salesman' })
    check('grouped by salesman', bySalesman.groups[0].key, 'Ravi')

    head('4. Reorder alert flags the shortfall')
    // 2 in stock, level 5 → short 3.
    let alert = api.reports.reorder()
    check('the item is below its level', alert.length, 1)
    check('it is the ladies ring', alert[0].name, 'Ladies Ring')
    check('short by three', alert[0].short, 3)
    check('in-stock count reported', alert[0].in_stock, 2)

    head('5. Restocking clears the alert')
    api.tagStock.saveBatch({
      itemId,
      rows: [
        { gross_wt: 8, purity: 91.6, entry_date: DAY, category: 'Ladies' },
        { gross_wt: 8, purity: 91.6, entry_date: DAY, category: 'Ladies' },
        { gross_wt: 8, purity: 91.6, entry_date: DAY, category: 'Ladies' },
      ],
    })
    check('now five in stock', api.tagStock.list({ status: 'IN_STOCK' }).length, 5)
    alert = api.reports.reorder()
    check('no longer below reorder level', alert.length, 0)

    head('6. Items with no level set are never flagged')
    const other = api.item.save({
      name: 'Gents Chain', item_type_id: g22.item_type_id, item_group_id: g22.id,
      design_id: null, weight_mode: 'WEIGHT', uom: 'GRAM', hsn: '7113', image: '',
    })
    check('default reorder level is zero', api.item.list().find((x) => x.id === other).reorder_level, 0)
    // No stock at all, but no level set → not an alert.
    check('unset item not in the alert', api.reports.reorder().length, 0)
  } catch (e) {
    fail++
    console.log('  ERROR', e && e.stack ? e.stack : e)
  }

  console.log(`\n${pass} passed, ${fail} failed`)
  app.exit(fail ? 1 : 0)
})
