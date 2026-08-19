/**
 * Loads the demo shop into the REAL application database so you can open the
 * app and click through every screen with data already in it.
 *
 *   npm run demo            refuses if the database already has data
 *   npm run demo -- --force wipes existing data first
 */
const { app } = require('electron')
const path = require('node:path')
const fs = require('node:fs')
const { seed, d } = require('../test/demo-data.cjs')

const FORCE = process.argv.includes('--force')

app.whenReady().then(() => {
  const dbmod = require('../electron/db.cjs')
  dbmod.open(app.getPath('userData'))
  const db = dbmod.get()
  const api = require('../electron/api.cjs')

  const counts = {
    items: db.prepare('SELECT COUNT(*) c FROM item').get().c,
    parties: db.prepare('SELECT COUNT(*) c FROM party').get().c,
    sales: db.prepare('SELECT COUNT(*) c FROM sale').get().c,
  }
  const hasData = counts.items || counts.parties || counts.sales

  if (hasData && !FORCE) {
    console.log('\nThe database already contains data:')
    console.log(`  items: ${counts.items}   parties: ${counts.parties}   sales: ${counts.sales}`)
    console.log(`  at ${path.join(app.getPath('userData'), 'data', 'parivar.db')}`)
    console.log('\nRefusing to overwrite it. Re-run with --force to wipe and reseed:')
    console.log('  npm run demo -- --force\n')
    process.exit(2)
  }

  if (hasData && FORCE) {
    // Back the file up before wiping — losing a shop's books would be unforgivable.
    const src = path.join(app.getPath('userData'), 'data', 'parivar.db')
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
    const backup = src.replace(/\.db$/, `.before-demo-${stamp}.db`)
    db.pragma('wal_checkpoint(TRUNCATE)')
    fs.copyFileSync(src, backup)
    console.log('backed up existing database to\n  ' + backup)

    const tables = [
      'ledger_entry', 'metal_entry', 'loose_stock',
      'sale_item', 'sale_urd', 'sale', 'urd_bill',
      'purchase_item', 'purchase', 'refinery_item', 'refinery',
      'order_item', 'order_booking', 'voucher',
      'gss_receipt', 'gss_account', 'gss_scheme',
      'tag_stock', 'party_metal_opening', 'party', 'item',
      'design', 'expense', 'metal_rate',
    ]
    db.exec('PRAGMA foreign_keys = OFF')
    for (const t of tables) db.exec(`DELETE FROM ${t}`)
    db.exec(`DELETE FROM sqlite_sequence`)
    db.exec(`UPDATE voucher_series SET next_no = 1`)
    db.exec('PRAGMA foreign_keys = ON')
    console.log('cleared previous data')
  }

  const S = seed(api)
  const today = d(0)
  const tags = api.tagStock.list({ status: 'IN_STOCK' })
  const T = (code) => tags.find((x) => x.tag === code)

  // ── A credit sale with old gold exchanged (the video's scenario) ──
  api.sale.save({
    head: { prefix: 'COM', bill_date: d(-6), party_id: S.customers.sandip,
            party_name: 'Sandip Jain', mobile: '9767211065', area: 'Kothrud',
            is_credit: 1, gst_pct: 3, amount_received: 0 },
    items: [{ tag: T('RIN00002').tag, tag_stock_id: T('RIN00002').id, item_id: S.items.ring,
              item_name: 'Ring', hsn: '7113', gross_wt: 12, purity: 91.6, stone_wt: 0,
              net_wt: 12, rate_per_gm: 4590, mkg_per_gm: 300, hallmark_charges: 45 }],
    urds: [{ name: 'Old Gold', description: 'chain', gross_wt: 3, net_wt: 3, purity: 80, rate: 4500 }],
  })

  // ── A fully-paid cash sale ──
  api.sale.save({
    head: { prefix: 'COM', bill_date: d(-3), party_id: S.customers.amit, party_name: 'Amit Patel',
            mobile: '9822011223', is_credit: 0, gst_pct: 3, amount_received: 125000 },
    items: [{ tag: T('CHA00001').tag, tag_stock_id: T('CHA00001').id, item_id: S.items.chain,
              item_name: 'Chain', hsn: '7113', gross_wt: 24.5, purity: 91.6, stone_wt: 0,
              net_wt: 24.5, rate_per_gm: 4590, mkg_per_gm: 220, hallmark_charges: 45 }],
    urds: [],
  })

  // ── A part-paid sale ──
  api.sale.save({
    head: { prefix: 'COM', bill_date: d(-1), party_id: S.customers.rekha, party_name: 'Rekha Shah',
            mobile: '9811223344', is_credit: 1, gst_pct: 3, amount_received: 25000,
            bill_discount: 1000 },
    items: [{ tag: T('BAN00001').tag, tag_stock_id: T('BAN00001').id, item_id: S.items.bangle,
              item_name: 'Bangle', hsn: '7113', gross_wt: 18.4, purity: 75, stone_wt: 1.2,
              net_wt: 17.2, rate_per_gm: 3800, mkg_per_gm: 420, hallmark_charges: 45 }],
    urds: [],
  })

  // ── Purchase from the supplier, with wastage ──
  api.purchase.save({
    head: { prefix: 'MI', invoice_date: d(-8), party_id: S.suppliers.mahavir,
            party_name: 'Mahavir Gold', is_credit: 1, gst_pct: 3, paid_amount: 500000 },
    items: [{ item_name: 'Gold Bar', qty: 0, gross_wt: 175, black_beads: 0, stone_wt: 0,
              net_wt: 175, purity: 99.5, rate: 6000, wastage_pct: 2, hallmark_charges: 0 }],
  })

  // ── A metal-for-metal exchange: give fine bar, take ornaments back ──
  api.purchase.save({
    head: { prefix: 'MI', invoice_date: d(-7), party_id: S.suppliers.mahavir,
            party_name: 'Mahavir Gold', is_credit: 1, gst_pct: 0, paid_amount: 0,
            remark: 'Metal exchange — fine bar against ornaments' },
    items: [
      { direction: 'IN', item_name: 'Ornaments', qty: 0, gross_wt: 100, black_beads: 0,
        stone_wt: 0, net_wt: 100, purity: 91.6, rate: 6000, wastage_pct: 0, hallmark_charges: 0 },
      { direction: 'OUT', item_name: 'Fine Bar', qty: 0, gross_wt: 95, black_beads: 0,
        stone_wt: 0, net_wt: 95, purity: 99.5, rate: 6000, wastage_pct: 0, hallmark_charges: 0 },
    ],
  })

  // ── Refining: scrap out, pure back ──
  api.refinery.save({
    head: { prefix: 'MO', invoice_date: d(-5), direction: 'OUT', party_id: S.refinery,
            party_name: 'Shree Refinery', gst_pct: 0, paid_amount: 0 },
    items: [{ tag: T('RIN00003').tag, item_id: S.items.ring, item_name: 'Ring',
              gross_wt: 15, stone_wt: 0, net_wt: 15, purity: 91.6, rate_per_gm: 0,
              gross_wastage: 0.25 }],
  })
  api.refinery.save({
    head: { prefix: 'MO', invoice_date: d(-2), direction: 'IN', party_id: S.refinery,
            party_name: 'Shree Refinery', gst_pct: 0, paid_amount: 1500 },
    items: [{ item_name: 'Pure Gold', gross_wt: 13.5, stone_wt: 0, net_wt: 13.5,
              purity: 100, rate_per_gm: 6000, gross_wastage: 0 }],
  })

  // ── An open karagir order ──
  api.order.save({
    head: { prefix: 'NO', order_date: d(-4), delivery_date: d(12),
            party_id: S.customers.priya, party_name: 'Priya Deshmukh',
            karagir_id: S.karagir, status: 'ISSUED', discount: 0, advance_amount: 10000 },
    items: [{ item_name: 'Necklace Set', qty: 1, gross_wt: 38, stone_wt: 2, net_wt: 36,
              purity: 91.6, rate_per_gm: 4590, mkg_per_gm: 380, hallmark_charges: 45 }],
  })

  // ── Money movements ──
  api.voucher.save({ kind: 'RECEIPT', voucher_date: d(-2), party_id: S.customers.sandip,
    party_name: 'Sandip Jain', amount: 30000, payment_type: 'Cash', narration: 'Part payment' })
  api.voucher.save({ kind: 'PAYMENT', voucher_date: d(-1), party_id: S.suppliers.mahavir,
    party_name: 'Mahavir Gold', amount: 200000, payment_type: 'NEFT',
    bank_name: 'HDFC Bank', ref_no: 'UTR8891277' })

  // ── Gold saving scheme with a few instalments collected ──
  const schemeId = api.gss.saveScheme({
    name: '11 + 1 Gold Plan', scheme_type: 'On Amount', period_unit: 'Months',
    total_periods: 12, paying_periods: 11, bonus_periods: 1,
    monthly_amount: 2000, maturity_bonus: 2000,
  })
  const gsa = api.gss.assign({ scheme_id: schemeId, party_id: S.customers.sandip,
    start_date: d(-70) })
  const acc = api.gss.readAccount({ id: gsa.id })
  api.gss.receive({ receipt_id: acc.receipts[0].id, amount: 2000, received_date: d(-70) })
  api.gss.receive({ receipt_id: acc.receipts[1].id, amount: 2000, received_date: d(-40) })

  const dash = api.reports.dashboard()
  console.log('\nDemo shop loaded into ' + path.join(app.getPath('userData'), 'data', 'parivar.db'))
  console.log(`  items          ${api.item.list().length}`)
  console.log(`  tags in stock  ${api.tagStock.list({ status: 'IN_STOCK' }).length}`)
  console.log(`  customers      ${api.party.list({ type: 'CUSTOMER' }).length}`)
  console.log(`  sales bills    ${api.sale.list({}).length}`)
  console.log(`  purchases      ${api.purchase.list({}).length} (one is a metal exchange)`)
  const mgold = api.party.metalBalance({ id: S.suppliers.mahavir })
  console.log(`  supplier gold  ${mgold.balance.toFixed(3)} g fine ${mgold.balance >= 0 ? 'Dr' : 'Cr'}`)
  console.log(`  refining       ${api.refinery.list({}).length}`)
  console.log(`  orders         ${api.order.list({}).length}`)
  console.log(`  scheme members ${api.gss.accounts({}).length}`)
  console.log(`  stock in hand  ${dash.stock.fine.toFixed(3)} g fine over ${dash.stock.pieces} pieces`)
  console.log(`  receivable     Rs. ${dash.receivable.toFixed(2)}`)
  console.log('\nStart the app with:  npm start\n')
  process.exit(0)
})
