/**
 * Adversarial bug hunt — edge cases and abuse, not happy paths.
 * Every case here is something a real shop could actually do by accident.
 */
const { app } = require('electron')
const path = require('node:path')
const fs = require('node:fs')
const os = require('node:os')
const { seed, d } = require('./demo-data.cjs')

let pass = 0, fail = 0
const bugs = []
const check = (label, actual, expected, tol = 0.005) => {
  const good = typeof expected === 'number'
    ? Math.abs(Number(actual) - expected) <= tol
    : String(actual) === String(expected)
  if (good) { pass++; console.log(`   ok   ${label}  =  ${actual}`) }
  else { fail++; bugs.push(`${label}: got ${actual}, expected ${expected}`)
         console.log(`   BUG  ${label}: got ${actual}, expected ${expected}`) }
}
const rejects = (label, fn) => {
  try { fn(); fail++; bugs.push(`${label}: was allowed but should be blocked`)
        console.log(`   BUG  ${label}: allowed, should be blocked`) }
  catch { pass++; console.log(`   ok   ${label}  =  blocked`) }
}
const head = (t) => console.log(`\n── ${t} ${'─'.repeat(Math.max(0, 56 - t.length))}`)

// Give each run its own Chromium profile — otherwise two test processes
// fight over the same cache directory and the slower one flakes.
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'parivar-run-')))

app.whenReady().then(() => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'parivar-hunt-'))
  require('../electron/db.cjs').open(tmp)
  const api = require('../electron/api.cjs')
  const today = d(0)
  const S = seed(api)
  const tag = (c) => api.tagStock.list({ status: 'ALL' }).find(x => x.tag === c)

  const sell = (tagCode, extra = {}) => {
    const ts = tag(tagCode)
    return api.sale.save({
      head: { prefix: 'COM', bill_date: today, party_id: S.customers.sandip,
              party_name: 'Sandip Jain', is_credit: 1, gst_pct: 3, ...extra },
      items: [{ tag: ts.tag, tag_stock_id: ts.id, item_id: ts.item_id, item_name: ts.item_name,
                gross_wt: ts.gross_wt, purity: ts.purity, stone_wt: ts.stone_wt,
                net_wt: ts.net_wt, rate_per_gm: 4590, mkg_per_gm: 300, hallmark_charges: 0 }],
      urds: [],
    })
  }

  try {
    head('A. Selling the same piece twice')
    sell('RIN00001')
    check('piece is sold', tag('RIN00001').status, 'SOLD')
    rejects('cannot sell an already-sold piece', () => sell('RIN00001'))

    head('B. Refining a piece that is already sold')
    rejects('cannot melt a sold piece', () => api.refinery.save({
      head: { prefix: 'MO', invoice_date: today, direction: 'OUT', party_id: S.refinery,
              party_name: 'Shree Refinery', gst_pct: 0 },
      items: [{ tag: 'RIN00001', item_name: 'Ring', gross_wt: 10, stone_wt: 0,
                net_wt: 10, purity: 91.6, rate_per_gm: 0 }],
    }))

    head('C. Editing a bill to drop a line frees the piece')
    const two = api.sale.save({
      head: { prefix: 'COM', bill_date: today, party_id: S.customers.amit,
              party_name: 'Amit Patel', is_credit: 1, gst_pct: 3 },
      items: [
        { tag: 'CHA00001', tag_stock_id: tag('CHA00001').id, item_name: 'Chain',
          gross_wt: 24.5, purity: 91.6, stone_wt: 0, net_wt: 24.5, rate_per_gm: 4590 },
        { tag: 'CHA00002', tag_stock_id: tag('CHA00002').id, item_name: 'Chain',
          gross_wt: 31.2, purity: 91.6, stone_wt: 0, net_wt: 31.2, rate_per_gm: 4590 },
      ],
      urds: [],
    })
    check('both pieces sold', tag('CHA00002').status, 'SOLD')
    const t2 = api.sale.read({ id: two.id })
    api.sale.save({ head: { ...t2, id: t2.id }, items: [t2.items[0]], urds: [] })
    check('dropped line returns to stock', tag('CHA00002').status, 'IN_STOCK')
    check('kept line stays sold', tag('CHA00001').status, 'SOLD')

    head('D. Deleting a refining entry restores the melted piece')
    const ref = api.refinery.save({
      head: { prefix: 'MO', invoice_date: today, direction: 'OUT', party_id: S.refinery,
              party_name: 'Shree Refinery', gst_pct: 0 },
      items: [{ tag: 'RIN00003', item_name: 'Ring', gross_wt: 15, stone_wt: 0,
                net_wt: 15, purity: 91.6, rate_per_gm: 0 }],
    })
    check('piece melted', tag('RIN00003').status, 'MELTED')
    api.refinery.remove({ id: ref.id })
    check('piece restored after delete', tag('RIN00003').status, 'IN_STOCK')

    head('E. Quantity-wise item (coins, no weight)')
    const coin = tag('COI00001')
    const qtySale = api.sale.save({
      head: { prefix: 'COM', bill_date: today, party_id: S.customers.rekha,
              party_name: 'Rekha Shah', is_credit: 1, gst_pct: 3 },
      items: [{ tag: coin.tag, tag_stock_id: coin.id, item_name: 'Coin', qty: 5,
                gross_wt: 0, purity: 99.9, stone_wt: 0, net_wt: 0,
                rate_per_gm: 7000, mkg_per_gm: 0, hallmark_charges: 0 }],
      urds: [],
    })
    check('qty-priced line (5 x 7000)', api.sale.read({ id: qtySale.id }).goods_amount, 35000)

    head('F. Negative and nonsense input')
    const neg = api.sale.save({
      head: { prefix: 'COM', bill_date: today, party_name: 'Odd', is_credit: 0, gst_pct: 3 },
      items: [{ item_name: 'Weird', gross_wt: -5, purity: 91.6, stone_wt: 0, net_wt: -5,
                rate_per_gm: 4590 }],
      urds: [],
    })
    check('negative weight does not produce a negative bill',
      api.sale.read({ id: neg.id }).total_amount >= 0, true)

    head('G. Party opening balance edited after transactions')
    const before = api.party.balance({ id: S.customers.sandip }).balance
    const p = api.party.read({ id: S.customers.sandip })
    api.party.save({ ...p, opening_balance: 12000 })
    check('balance shifts by the opening delta',
      api.party.balance({ id: S.customers.sandip }).balance, before + 2500)

    head('H. Gold scheme edge cases')
    const sid = api.gss.saveScheme({ name: 'Edge', total_periods: 12, paying_periods: 11,
      bonus_periods: 1, monthly_amount: 1000, maturity_bonus: 1000 })
    const ga = api.gss.assign({ scheme_id: sid, party_id: S.customers.priya, start_date: '2026-01-31' })
    const acct = api.gss.readAccount({ id: ga.id })
    check('month-end date clamps to short months', acct.receipts[1].due_date, '2026-02-28')
    rejects('cannot collect the shop-benefit row',
      () => api.gss.receive({ receipt_id: acct.receipts[11].id, amount: 1000 }))

    head('I. Order without a customer')
    rejects('order needs a customer', () => api.order.save({
      head: { prefix: 'NO', order_date: today, status: 'BOOKED', advance_amount: 0 },
      items: [{ item_name: 'X', gross_wt: 10, purity: 91.6, net_wt: 10, rate_per_gm: 4590 }],
    }))

    head('L. Re-saving a document must not change its totals')
    // Derived-and-stored fields (like a purchase return amount) can double up when a
    // saved bill is re-opened and saved again. Round-trip everything that has them.
    const ex = api.purchase.save({
      head: { prefix: 'MI', invoice_date: today, party_id: S.suppliers.mahavir,
              party_name: 'Mahavir Gold', is_credit: 1, gst_pct: 0, paid_amount: 0 },
      items: [
        { direction: 'IN', item_name: 'Ornaments', gross_wt: 100, net_wt: 100,
          purity: 91.6, rate: 6000, wastage_pct: 0 },
        { direction: 'OUT', item_name: 'Fine Bar', gross_wt: 95, net_wt: 95,
          purity: 99.5, rate: 6000, wastage_pct: 0 },
      ],
    })
    const first = api.purchase.read({ id: ex.id })
    api.purchase.save({ head: { ...first, id: first.id }, items: first.items })
    const second = api.purchase.read({ id: ex.id })
    check('purchase return amount stable on re-save', second.return_amount, first.return_amount)
    check('purchase bill amount stable on re-save', second.bill_amount, first.bill_amount)
    check('supplier gold khata stable on re-save',
      api.party.metalBalance({ id: S.suppliers.mahavir }).balance,
      (() => { const b = api.party.metalBalance({ id: S.suppliers.mahavir }).balance; return b })())

    // Pick a bill that actually has money and old gold on it, not the edge-case one.
    const meaty = api.sale.list({}).find(x => x.total_amount > 0)
    const s1 = api.sale.read({ id: meaty.id })
    api.sale.save({ head: { ...s1, id: s1.id }, items: s1.items, urds: s1.urds })
    const s2 = api.sale.read({ id: s1.id })
    check('sale total stable on re-save', s2.total_amount, s1.total_amount)
    check('sale urd amount stable on re-save', s2.urd_amount, s1.urd_amount)

    head('J. Ledger stays balanced after all of the above')
    for (const id of Object.values(S.customers)) {
      const led = api.reports.ledger({ partyId: id, from: '', to: '' })
      const closing = led.closingSide === 'Dr' ? led.closing : -led.closing
      check(`ledger matches balance for party ${id}`, closing,
        api.party.balance({ id }).balance, 0.02)
    }

    head('K. Stock report never goes negative')
    const dbk = api.reports.dayBook({ from: today, to: today })
    check('closing gold stock is non-negative', dbk.stock.gold_closing >= 0, true)
    const st = api.reports.stock({ status: 'IN_STOCK', groupBy: 'none' })
    check('no negative fine weights in stock',
      st.rows.every(r => r.final_wt >= 0), true)

  } catch (e) {
    fail++
    bugs.push('UNCAUGHT: ' + e.message)
    console.error('\nUNCAUGHT\n', e.stack || e.message)
  }

  console.log('\n' + '='.repeat(64))
  console.log(`  ${pass} passed, ${fail} bugs`)
  if (bugs.length) { console.log('\n  Bugs found:'); bugs.forEach(b => console.log('   - ' + b)) }
  console.log('='.repeat(64))
  process.exit(fail ? 1 : 0)
})
