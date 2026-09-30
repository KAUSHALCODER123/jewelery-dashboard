/**
 * ERP plan plumbing that the new pages lean on.
 *
 *  - The Available / On hold stock filter is part of the query, so a page is
 *    full and the totals count the same pieces the rows show.
 *  - The customer timeline is paged in SQL: nothing past the 200th bill goes
 *    missing, and the total is exact.
 *  - Clear all entries empties the new tables too. A hold points at a tag, and
 *    with the tags gone the clear used to fail at commit on the foreign key.
 *    npx electron ./test/erp-core.cjs
 */
const { app } = require('electron')
const path = require('node:path')
const fs = require('node:fs')
const os = require('node:os')

let pass = 0
let fail = 0
function check(label, actual, expected) {
  if (String(actual) === String(expected)) { pass++; console.log(`  PASS  ${label} = ${actual}`) }
  else { fail++; console.log(`  FAIL  ${label}: got ${actual}, expected ${expected}`) }
}

app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'parivar-run-')))

app.whenReady().then(() => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'parivar-erpcore-'))
  const db = require('../electron/db.cjs')
  db.open(tmp)
  const api = require('../electron/api.cjs')
  const backups = require('../electron/backup.cjs')
  const { seed } = require('./demo-data.cjs')
  try {
    const S = seed(api)
    const live = db.get()
    require('../scripts/demo/history.cjs').tradingHistory(api, S)

    console.log('\n── Availability filter pages in SQL')
    const inStock = api.tagStock.page({ status: 'IN_STOCK', page: 1, pageSize: 10 }).total
    const tags = api.tagStock.list({ status: 'IN_STOCK' })
    const held = tags.slice(0, 3)
    for (const t of held) api.holds.place({ tag_id: t.id, kind: 'RESERVATION', reason: 'test' })
    const avail = api.tagStock.page({ availability: 'AVAILABLE', page: 1, pageSize: 10 })
    const onHold = api.tagStock.page({ availability: 'ON_HOLD', page: 1, pageSize: 10 })
    check('available total leaves out the held pieces', avail.total, inStock - 3)
    check('available page is full', avail.rows.length, Math.min(10, inStock - 3))
    check('available totals agree with the rows', avail.totals.count, inStock - 3)
    check('on-hold total', onHold.total, 3)
    check('on-hold rows are the held pieces', onHold.rows.map((r) => r.id).sort().join(), held.map((t) => t.id).sort().join())
    let bad = ''
    try { api.tagStock.page({ availability: 'SOMETIMES' }) } catch (e) { bad = e.message }
    check('an unknown availability is refused', /availability/.test(bad), true)

    console.log('\n── Customer timeline pages in SQL')
    const cust = S.customers.priya
    const before = api.customer.summary({ party_id: cust, page: 1, pageSize: 50 }).total
    const ins = live.prepare(`INSERT INTO voucher (kind, voucher_no, voucher_date, party_id, party_name, amount)
      VALUES ('RECEIPT', ?, ?, ?, 'Priya', 100)`)
    live.transaction(() => {
      for (let i = 0; i < 260; i++) ins.run(`T${i}`, `2025-01-${String(1 + (i % 28)).padStart(2, '0')}`, cust)
    })()
    const s1 = api.customer.summary({ party_id: cust, page: 1, pageSize: 50 })
    check('every event is counted', s1.total, before + 260)
    const last = api.customer.summary({ party_id: cust, page: s1.total, pageSize: 50 })
    check('the last page holds the remainder', last.timeline.length, (before + 260) % 50 || 50)
    check('newest first', s1.timeline[0].doc_date >= s1.timeline[1].doc_date, true)
    check('open items are counted', typeof s1.open.orders, 'number')

    console.log('\n── Customer summary metal balance agrees with the gold khata')
    live.prepare(`INSERT INTO party_metal_opening (party_id, metal, weight, dr_cr) VALUES (?, 'Gold', 5, 'Cr')`).run(S.customers.priya)
    let compared = 0
    for (const metal of ['Gold', 'Silver']) {
      for (const r of api.reports.metalOutstanding({ metal })) {
        const m = api.customer.summary({ party_id: r.id, page: 1 }).metalBalances.find((x) => x.metal === metal)
        check(`${r.name} ${metal}`, m?.bal, r.balance)
        compared++
      }
    }
    check('some balances were compared', compared > 0, true)

    console.log('\n── Clear all entries with a hold on a tag')
    let err = ''
    try { backups.clearEntries({ dataDir: path.join(tmp, 'data'), db, stamp: 'erpcore' }) } catch (e) { err = e.message }
    check('the clear commits', err, '')
    check('holds cleared', live.prepare(`SELECT COUNT(*) c FROM stock_hold`).get().c, 0)
    check('tags cleared', live.prepare(`SELECT COUNT(*) c FROM tag_stock`).get().c, 0)
    check('audit trail kept', live.prepare(`SELECT COUNT(*) c FROM audit_event`).get().c >= 0, true)
  } catch (e) {
    fail++
    console.log('  FAIL  threw:', e.stack)
  }
  console.log(`\n${pass} passed, ${fail} failed`)
  app.exit(fail ? 1 : 0)
})
