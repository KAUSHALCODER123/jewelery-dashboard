/**
 * Full feature test. Exercises every module against the demo dataset,
 * including edit, delete, reversal and guard paths — not just happy paths.
 *
 *   npm run test:full
 */
const { app } = require('electron')
const path = require('node:path')
const fs = require('node:fs')
const os = require('node:os')
const { seed, d } = require('./demo-data.cjs')

let pass = 0, fail = 0, section = ''
const failures = []

const check = (label, actual, expected, tol = 0.005) => {
  const ok = typeof expected === 'number'
    ? Math.abs(Number(actual) - expected) <= tol
    : String(actual) === String(expected)
  if (ok) { pass++; console.log(`   ok   ${label}  =  ${actual}`) }
  else {
    fail++; failures.push(`${section} → ${label}: got ${actual}, expected ${expected}`)
    console.log(`   FAIL ${label}: got ${actual}, expected ${expected}`)
  }
}

const ok = (label, cond) => check(label, cond ? 'yes' : 'no', 'yes')

/** Assert that an operation is rejected (guard rails). */
const rejects = (label, fn) => {
  try { fn(); fail++; failures.push(`${section} → ${label}: expected rejection`); console.log(`   FAIL ${label}: expected a rejection`) }
  catch { pass++; console.log(`   ok   ${label}  =  rejected`) }
}

const head = (t) => { section = t; console.log(`\n── ${t} ${'─'.repeat(Math.max(0, 58 - t.length))}`) }

// Give each run its own Chromium profile — otherwise two test processes
// fight over the same cache directory and the slower one flakes.
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'parivar-run-')))

app.whenReady().then(() => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'parivar-full-'))
  const db = require('../electron/db.cjs')
  db.open(tmp)
  const api = require('../electron/api.cjs')
  const today = d(0)

  try {
    head('1. Company & settings')
    const S = seed(api)
    const co = api.company.read()
    check('company name saved', co.name, 'Parivar Jewellers')
    check('GSTIN saved', co.gstin, '27ABCDE1234F1Z5')
    api.settings.set({ key: 'gst_pct', value: '3' })
    check('setting round-trips', api.settings.all().gst_pct, '3')

    head('2. Item master')
    const items = api.item.list()
    check('items created', items.length, 6)
    check('tag prefix from name', items.find(i => i.name === 'Necklace').tag_prefix, 'NEC')
    check('quantity-wise item mode', items.find(i => i.name === 'Coin').weight_mode, 'QTY')
    check('search filters', api.item.list({ search: 'ban' }).length, 1)
    check('item groups seeded', api.itemGroup.list().length, 12)
    // 24K down to 9K, so a shop selling light-karat lines has a group for it
    // without having to create one by hand.
    for (const [name, purity] of [['21K Gold', 87.5], ['9K Gold', 37.5]]) {
      const g = api.itemGroup.list().find((x) => x.name === name)
      check(`${name} seeded at its purity`, g && g.purity, purity)
    }
    check('designs created', api.design.list().length, 2)

    head('3. Tagged stock')
    const stock = api.tagStock.list({ status: 'IN_STOCK' })
    check('total tags', stock.length, 10)
    const t = (tag) => stock.find(x => x.tag === tag)
    check('RIN00001 fine (10 @ 91.6%)', t('RIN00001').final_wt, 9.16)
    check('BAN00001 net (18.4 - 1.2 stone)', t('BAN00001').net_wt, 17.2)
    check('BAN00001 fine (17.2 @ 75%)', t('BAN00001').final_wt, 12.9)
    // Necklace deducts both stone and black beads
    check('NEC00001 net (45.3 - 3.1 - 0.4)', t('NEC00001').net_wt, 41.8)
    check('PAY00001 fine (82 @ 92.5%)', t('PAY00001').final_wt, 75.85)
    check('findByTag works', api.tagStock.findByTag({ tag: 'CHA00001' }).gross_wt, 24.5)
    check('findByTag is case-insensitive', api.tagStock.findByTag({ tag: 'cha00001' })?.tag, 'CHA00001')
    check('type-ahead search', api.tagStock.search({ q: 'chain' }).length, 2)
    check('locker item recorded', t('CHA00002').location, 'Locker')

    const totalFine = stock.reduce((s, r) => s + r.final_wt, 0)
    check('opening fine weight', totalFine, 9.16 + 10.992 + 13.74 + 22.442 + 28.5792 + 12.9 + 15.525 + 38.2888 + 75.85 + 9.99, 0.01)

    head('4. Customers / CRM')
    const cust = api.party.list({ type: 'CUSTOMER' })
    check('customers created', cust.length, 4)
    check('opening Dr balance', api.party.balance({ id: S.customers.sandip }).balance, 9500)
    check('opening Cr balance is negative', api.party.balance({ id: S.customers.priya }).balance, -2400)
    const sandip = api.party.read({ id: S.customers.sandip })
    check('metal opening stored', sandip.metals[0].weight, 5)
    check('loyalty flag stored', sandip.loyalty_enabled, 1)
    check('search by mobile', api.party.list({ type: 'CUSTOMER', search: '98904' }).length, 1)
    check('suppliers separate', api.party.list({ type: 'SUPPLIER' }).length, 1)

    head('5. Sales — cash counter sale, no customer')
    const cashSale = api.sale.save({
      head: { prefix: 'COM', bill_date: today, party_name: 'Walk-in', is_credit: 0,
              gst_pct: 3, amount_received: 30000 },
      items: [{ tag: 'RIN00001', tag_stock_id: t('RIN00001').id, item_id: S.items.ring,
                item_name: 'Ring', hsn: '7113', gross_wt: 10, purity: 91.6, stone_wt: 0,
                net_wt: 10, rate_per_gm: 4590, mkg_per_gm: 300, hallmark_charges: 45 }],
      urds: [],
    })
    check('bill number', cashSale.bill_no, 'COM1')
    const cs = api.sale.read({ id: cashSale.id })
    check('goods (10 x 4590)', cs.goods_amount, 45900)
    check('making (10 x 300)', cs.making_amount, 3000)
    check('hallmark carried', cs.hallmark_amount, 45)
    check('bill amount', cs.bill_amount, 48945)
    check('GST 3%', cs.gst_amount, 1468.35)
    check('total', cs.total_amount, 50413.35)
    check('balance after 30000', cs.net_balance, 20413.35)
    check('tag marked sold', api.tagStock.list({ status: 'IN_STOCK' }).length, 9)

    head('6. Sales — credit sale with old gold (video parity)')
    const credit = api.sale.save({
      head: { prefix: 'COM', bill_date: today, party_id: S.customers.sandip,
              party_name: 'Sandip Jain', is_credit: 1, gst_pct: 3, amount_received: 0 },
      items: [{ tag: 'RIN00002', tag_stock_id: t('RIN00002').id, item_id: S.items.ring,
                item_name: 'Ring', hsn: '7113', gross_wt: 12, purity: 91.6, stone_wt: 0,
                net_wt: 12, rate_per_gm: 4590, mkg_per_gm: 300, hallmark_charges: 0 }],
      urds: [{ name: 'Old Gold', description: 'chain', gross_wt: 3, net_wt: 3, purity: 80, rate: 4500 }],
    })
    const cr = api.sale.read({ id: credit.id })
    check('bill amount', cr.bill_amount, 58680)
    check('GST', cr.gst_amount, 1760.4)
    check('total', cr.total_amount, 60440.4)
    check('old gold fine (3 @ 80%)', cr.urds[0].final_wt, 2.4)
    check('old gold value', cr.urd_amount, 10800)
    check('net balance', cr.net_balance, 49640.4)
    check('customer khata = 9500 + 49640.40',
      api.party.balance({ id: S.customers.sandip }).balance, 59140.4)

    head('7. Sales — modify an existing bill')
    api.sale.save({
      head: { ...cr, id: cr.id, amount_received: 20000 },
      items: cr.items,
      urds: cr.urds,
    })
    const mod = api.sale.read({ id: credit.id })
    check('bill number unchanged on edit', mod.bill_no, 'COM2')
    check('received updated', mod.amount_received, 20000)
    check('balance recalculated', mod.net_balance, 29640.4)
    check('khata re-posted, not doubled',
      api.party.balance({ id: S.customers.sandip }).balance, 59140.4 - 20000)
    check('still only one tag consumed by this bill',
      api.tagStock.list({ status: 'SOLD' }).length, 2)

    head('8. Sales — GST-exempt, discounts and TCS')
    const exempt = api.sale.save({
      head: { prefix: 'ESM', bill_date: today, party_id: S.customers.amit, party_name: 'Amit Patel',
              is_credit: 1, gst_not_required: 1, gst_pct: 3, bill_discount: 500,
              making_discount: 200, other_amount: 100, tcs_pct: 1, amount_received: 0 },
      items: [{ tag: 'BAN00001', tag_stock_id: t('BAN00001').id, item_id: S.items.bangle,
                item_name: 'Bangle', gross_wt: 18.4, purity: 75, stone_wt: 1.2, net_wt: 17.2,
                rate_per_gm: 3800, mkg_per_gm: 420, hallmark_charges: 45 }],
      urds: [],
    })
    const ex = api.sale.read({ id: exempt.id })
    check('estimate series used', ex.bill_no, 'ESM1')
    check('goods (17.2 x 3800)', ex.goods_amount, 65360)
    check('making (17.2 x 420)', ex.making_amount, 7224)
    check('bill amount', ex.bill_amount, 72629)
    check('GST suppressed', ex.gst_amount, 0)
    // taxable = 72629 - 500 - 200 = 71929 ; TCS 1% = 719.29 ; + other 100
    check('TCS on discounted base', ex.tcs_amount, 719.29)
    check('total', ex.total_amount, 72748.29)

    head('9. Purchase — with wastage')
    const pur = api.purchase.save({
      head: { prefix: 'MI', invoice_date: today, party_id: S.suppliers.mahavir,
              party_name: 'Mahavir Gold', is_credit: 1, gst_pct: 3, paid_amount: 50000 },
      items: [{ item_name: 'Gold Bar', qty: 0, gross_wt: 175, black_beads: 0, stone_wt: 0,
                net_wt: 175, purity: 99.5, rate: 6000, wastage_pct: 2, hallmark_charges: 0 }],
    })
    check('purchase no', pur.invoice_no, 'MI1')
    const pu = api.purchase.read({ id: pur.id })
    // touch = 99.5 + 2 wastage = 101.5 ; fine = 175 x 101.5% = 177.625
    // amount = 175 x 101.5 x 6000 / 99.5  (a gold rate is quoted per gram of 995)
    check('fine + wastage', pu.items[0].fine_plus_wastage, 177.625, 0.002)
    check('purchase amount', pu.purchase_amount, 1071105.53, 30)
    check('GST 3%', pu.gst_amount, 32133.17, 1)
    check('balance after 50000 paid', pu.net_balance, pu.bill_amount - 50000)
    check('supplier is a creditor (Cr)',
      api.party.balance({ id: S.suppliers.mahavir }).balance < 0, true)

    head('9b. Purchase — metal-for-metal exchange')
    // Give the supplier 95 g of 99.5% fine, take back 100 g of 91.6% ornaments.
    // Only the difference settles in money.
    const ex2 = api.purchase.save({
      head: { prefix: 'MI', invoice_date: today, party_id: S.suppliers.mahavir,
              party_name: 'Mahavir Gold', is_credit: 1, gst_pct: 0, paid_amount: 0 },
      items: [
        { direction: 'IN', item_name: 'Ornaments', gross_wt: 100, net_wt: 100,
          purity: 91.6, rate: 6000, wastage_pct: 0 },
        { direction: 'OUT', item_name: 'Fine Bar', gross_wt: 95, net_wt: 95,
          purity: 99.5, rate: 6000, wastage_pct: 0 },
      ],
    })
    const xp = api.purchase.read({ id: ex2.id })
    const xIn = xp.items.find(l => l.direction === 'IN')
    const xOut = xp.items.find(l => l.direction === 'OUT')
    check('material in fine (100 @ 91.6%)', xIn.fine_plus_wastage, 91.6)
    check('material out fine (95 @ 99.5%)', xOut.fine_plus_wastage, 94.525)
    check('purchase amount is the IN side only', xp.purchase_amount, 552361.81, 0.05)
    check('return amount is the OUT side', xp.return_amount, 570000, 0.05)
    // We handed over more fine than we took, so the supplier owes us the difference.
    check('bill swings negative on an exchange', xp.bill_amount, -17638.19, 0.05)

    const mb = api.party.metalBalance({ id: S.suppliers.mahavir })
    // Earlier cash purchase brought 177.625 g fine IN; this one 91.6 in / 94.525 out.
    check('supplier gold khata (out − in)', mb.balance,
      94.525 - 91.6 - 177.625, 0.01)

    const gk = api.reports.metalLedger({ partyId: S.suppliers.mahavir, metal: 'Gold', from: '', to: '' })
    check('gold khata Dr side has the metal we gave', gk.drTotal, 94.525, 0.01)
    check('gold khata Cr side has the metal we received', gk.crTotal, 91.6 + 177.625, 0.01)
    check('gold khata closing side', gk.closingSide, 'Cr')
    check('metal outstanding lists the supplier',
      api.reports.metalOutstanding({ metal: 'Gold' }).some(r => r.id === S.suppliers.mahavir), true)

    api.purchase.remove({ id: ex2.id })
    check('deleting the exchange reverses the gold khata',
      api.party.metalBalance({ id: S.suppliers.mahavir }).balance, -177.625, 0.01)

    head('9c. Loose metal → tags (Stock Transfer Loose to Barcode)')
    // Buying loose metal and then tagging pieces made from it must not double the stock.
    const beforeAll = api.reports.dayBook({ from: today, to: today }).stock.gold_closing
    const ls0 = api.looseStock.summary({ metal: 'Gold' })
    ok('loose metal is on hand after the purchases', ls0.available_fine > 0)
    // The day book reports gold and URD old gold on separate lines, as the original
    // does — so its gold figure is loose + tagged, without URD.
    check('loose + tagged equals the day book gold figure',
      ls0.loose_fine + ls0.tagged_fine, beforeAll, 0.01)
    check('URD is counted separately', ls0.total_fine, beforeAll + ls0.urd_fine, 0.01)
    ok('old gold is available to convert too', ls0.available_fine >= ls0.loose_fine)

    const kadaGroup = api.itemGroup.list().find((x) => x.name === '22K Gold')
    const kadaItem = api.item.save({
      name: 'Kada', item_type_id: kadaGroup.item_type_id, item_group_id: kadaGroup.id,
      design_id: null, weight_mode: 'WEIGHT', uom: 'GRAM', hsn: '7113', image: '',
    })
    const melt = api.looseStock.convert({
      itemId: kadaItem,
      rows: [
        { gross_wt: 20, purity: 91.6, mkg_per_gm: 300 },
        { gross_wt: 25, purity: 91.6, mkg_per_gm: 300 },
      ],
    })
    check('two tags created', melt.created, 2)
    check('tag numbering follows the item', melt.tags[0], 'KAD00001')
    // 20 @ 91.6% = 18.320 ; 25 @ 91.6% = 22.900
    check('fine weight taken from loose', melt.fine_converted, 41.22)
    check('loose reduced by exactly that', melt.loose_before - melt.loose_after, 41.22)
    check('total stock unchanged — metal only changed form',
      api.reports.dayBook({ from: today, to: today }).stock.gold_closing, beforeAll, 0.01)
    const dbSplit = api.reports.dayBook({ from: today, to: today }).stock
    check('day book splits tagged and loose',
      dbSplit.tagged_closing + dbSplit.loose_closing, dbSplit.gold_closing, 0.01)

    const ls1 = api.looseStock.summary({ metal: 'Gold' })
    check('tagged pool grew', ls1.tagged_fine, ls0.tagged_fine + 41.22, 0.01)
    check('loose + tagged still equals the gold figure',
      ls1.loose_fine + ls1.tagged_fine, beforeAll, 0.01)

    rejects('cannot convert more than is on hand', () => api.looseStock.convert({
      itemId: kadaItem, rows: [{ gross_wt: 100000, purity: 91.6 }],
    }))
    rejects('conversion needs an item', () => api.looseStock.convert({
      itemId: null, rows: [{ gross_wt: 5, purity: 91.6 }],
    }))
    rejects('conversion needs at least one piece', () => api.looseStock.convert({
      itemId: kadaItem, rows: [],
    }))
    ok('loose ledger records the movement',
      api.looseStock.ledger({}).some((r) => r.doc_type === 'CONVERT'))

    head('10. Refining — send out and receive back')
    const stockBefore = api.reports.dayBook({ from: today, to: today }).stock.gold_closing
    const refOut = api.refinery.save({
      head: { prefix: 'MO', invoice_date: today, direction: 'OUT', party_id: S.refinery,
              party_name: 'Shree Refinery', gst_pct: 0, paid_amount: 0 },
      items: [{ tag: 'RIN00003', item_id: S.items.ring, item_name: 'Ring', gross_wt: 15,
                stone_wt: 0, net_wt: 15, purity: 91.6, rate_per_gm: 0, gross_wastage: 0.25 }],
    })
    check('refinery doc no', refOut.invoice_no, 'MO1')
    check('fine sent (15 @ 91.6%)', api.refinery.read({ id: refOut.id }).items[0].fine_wt, 13.74)
    check('melted tag left stock',
      api.tagStock.list({ status: 'IN_STOCK' }).some(x => x.tag === 'RIN00003'), false)
    check('stock reduced by fine sent',
      api.reports.dayBook({ from: today, to: today }).stock.gold_closing, stockBefore - 13.74, 0.01)

    api.refinery.save({
      head: { prefix: 'MO', invoice_date: today, direction: 'IN', party_id: S.refinery,
              party_name: 'Shree Refinery', gst_pct: 0, paid_amount: 1500 },
      items: [{ item_name: 'Pure Gold', gross_wt: 13.5, stone_wt: 0, net_wt: 13.5,
                purity: 100, rate_per_gm: 6000, gross_wastage: 0 }],
    })
    check('stock restored on receipt',
      api.reports.dayBook({ from: today, to: today }).stock.gold_closing, stockBefore - 13.74 + 13.5, 0.01)

    head('11. Karagir order → invoice')
    const ord = api.order.save({
      head: { prefix: 'NO', order_date: today, delivery_date: d(20),
              party_id: S.customers.rekha, party_name: 'Rekha Shah',
              karagir_id: S.karagir, status: 'BOOKED', discount: 0, advance_amount: 5000 },
      items: [{ item_name: 'Bangle Pair', qty: 2, gross_wt: 20, stone_wt: 0, net_wt: 20,
                purity: 91.6, rate_per_gm: 4590, mkg_per_gm: 250, hallmark_charges: 45 }],
    })
    check('order no', ord.order_no, 'NO1')
    const o = api.order.read({ id: ord.id })
    check('order goods (20 x 4590)', o.items[0].amount, 91800)
    check('order total', o.total_amount, 96845)
    check('balance after advance', o.balance_amount, 91845)
    check('advance credited to customer',
      api.party.balance({ id: S.customers.rekha }).balance, -5000)
    check('karagir linked', api.order.list({}).find(x => x.id === ord.id).karagir_name, 'Chetan Kapila')

    api.order.setStatus({ id: ord.id, status: 'ISSUED' })
    api.order.setStatus({ id: ord.id, status: 'RECEIVED' })
    check('status advanced', api.order.read({ id: ord.id }).status, 'RECEIVED')

    const conv = api.order.toInvoice({ id: ord.id })
    check('order became a bill', conv.bill_no, 'COM3')
    check('order marked delivered', api.order.read({ id: ord.id }).status, 'DELIVERED')
    const inv = api.sale.read({ id: conv.id })
    check('advance carried onto bill', inv.amount_received, 5000)
    check('bill total incl GST', inv.total_amount, 99750.35)
    check('customer charged once (not double-credited)',
      api.party.balance({ id: S.customers.rekha }).balance, 99750.35 - 5000)
    rejects('cannot invoice the same order twice', () => api.order.toInvoice({ id: ord.id }))

    head('12. Receipts & payments')
    const vr = api.voucher.save({ kind: 'RECEIPT', voucher_date: today,
      party_id: S.customers.sandip, party_name: 'Sandip Jain', amount: 30000, payment_type: 'Cash' })
    check('receipt no', vr.voucher_no, 'VR1')
    check('khata reduced by receipt',
      api.party.balance({ id: S.customers.sandip }).balance, 59140.4 - 20000 - 30000)

    const vp = api.voucher.save({ kind: 'PAYMENT', voucher_date: today,
      party_id: S.suppliers.mahavir, party_name: 'Mahavir Gold', amount: 100000,
      payment_type: 'NEFT', bank_name: 'HDFC', ref_no: 'UTR998877' })
    check('payment no', vp.voucher_no, 'VP1')
    check('receipts listed', api.voucher.list({ kind: 'RECEIPT' }).length, 1)
    check('payments listed', api.voucher.list({ kind: 'PAYMENT' }).length, 1)

    head('13. Gold saving scheme')
    const schemeId = api.gss.saveScheme({ name: '11 + 1 Gold Plan', total_periods: 12,
      paying_periods: 11, bonus_periods: 1, monthly_amount: 2000, maturity_bonus: 2000 })
    const gsa = api.gss.assign({ scheme_id: schemeId, party_id: S.customers.priya, start_date: today })
    check('G.S. no', gsa.gs_no, 'GS1')
    const acc = api.gss.readAccount({ id: gsa.id })
    check('12 instalments scheduled', acc.receipts.length, 12)
    check('maturity value (2000 x 11 + 2000)', acc.maturity_value, 24000)
    check('bonus row flagged', acc.receipts[11].status, 'INTEREST')

    const khataBefore = api.party.balance({ id: S.customers.priya }).balance
    api.gss.receive({ receipt_id: acc.receipts[0].id, amount: 2000 })
    api.gss.receive({ receipt_id: acc.receipts[1].id, amount: 2000 })
    check('two instalments collected', api.gss.readAccount({ id: gsa.id }).paid_amount, 4000)
    check('scheme money kept off the trading khata',
      api.party.balance({ id: S.customers.priya }).balance, khataBefore)
    api.gss.unreceive({ receipt_id: acc.receipts[1].id })
    check('undo reverses collection', api.gss.readAccount({ id: gsa.id }).paid_amount, 2000)
    api.gss.closeAccount({ id: gsa.id, closed: 1 })
    check('account closed', api.gss.accounts({ closed: 1 }).length, 1)

    head('14. Reports')
    const stk = api.reports.stock({ status: 'IN_STOCK', groupBy: 'group' })
    ok('stock groups produced', stk.groups.length > 0)
    check('group totals equal row totals',
      stk.groups.reduce((s, g) => s + g.final_wt, 0),
      stk.rows.reduce((s, r) => s + r.final_wt, 0), 0.01)

    const led = api.reports.ledger({ partyId: S.customers.sandip, from: '', to: '' })
    check('ledger balances (Dr total = Cr total)', led.grandTotal, Math.max(led.drTotal, led.crTotal))
    check('ledger closing matches balance',
      led.closingSide === 'Dr' ? led.closing : -led.closing,
      api.party.balance({ id: S.customers.sandip }).balance)

    const dbk = api.reports.dayBook({ from: today, to: today })
    ok('day book returns sales', dbk.sales.n >= 3)
    ok('day book cash position', typeof dbk.cash.closing === 'number')

    const outstanding = api.reports.outstanding({ type: 'CUSTOMER' })
    ok('outstanding lists debtors', outstanding.length > 0)

    const gstr = api.reports.gstRegister({ from: today, to: today })
    ok('GST register has taxed bills only', gstr.every(r => r.gst_amount > 0))
    check('GST register invoice no has no double prefix', /^COM\d+$/.test(gstr[0].invoice_no), true)

    const dash = api.reports.dashboard()
    ok('dashboard totals positive', dash.todaySales.v > 0)
    check('dashboard bill no clean', /^COM\d+$/.test(dash.recent[0].bill_no), true)
    ok('dashboard stock non-negative', dash.stock.fine >= 0)

    head('15. Print payload')
    const pr = api.sale.forPrint({ id: credit.id })
    check('company on payload', pr.company.name, 'Parivar Jewellers')
    check('party on payload', pr.party.name, 'Sandip Jain')
    check('bill no clean', pr.sale.bill_no, 'COM2')
    ok('amount in words rendered', /^Rs\. .+ Only$/.test(pr.amount_in_words))
    check('amount in words value', pr.amount_in_words,
      'Rs. Fourty Nine Thousand Six Hundred Fourty and Fourty Paise Only')

    head('16. Guard rails')
    rejects('cannot delete an item that has stock', () => api.item.remove({ id: S.items.ring }))
    rejects('cannot delete a party with transactions', () => api.party.remove({ id: S.customers.sandip }))
    rejects('cannot delete a sold tag', () => api.tagStock.remove({ id: t('RIN00001').id }))
    rejects('cannot delete a scheme in use', () => api.gss.removeScheme({ id: schemeId }))
    rejects('cannot re-receive a collected instalment',
      () => api.gss.receive({ receipt_id: acc.receipts[0].id, amount: 2000 }))

    head('17. Deletion reverses everything')
    const beforeDel = api.party.balance({ id: S.customers.sandip }).balance
    const stockBeforeDel = api.tagStock.list({ status: 'IN_STOCK' }).length
    api.sale.remove({ id: credit.id })
    check('tag returned to stock', api.tagStock.list({ status: 'IN_STOCK' }).length, stockBeforeDel + 1)
    check('khata reversed', api.party.balance({ id: S.customers.sandip }).balance,
      beforeDel - (49640.4 - 20000))

    const purBal = api.party.balance({ id: S.suppliers.mahavir }).balance
    api.purchase.remove({ id: pur.id })
    ok('purchase reversal moved supplier balance',
      api.party.balance({ id: S.suppliers.mahavir }).balance !== purBal)

    api.voucher.remove({ id: vr.id })
    check('receipt reversal', api.party.balance({ id: S.customers.sandip }).balance,
      beforeDel - (49640.4 - 20000) + 30000)

    head('18. Numbering continues correctly after deletes')
    const after = api.sale.save({
      head: { prefix: 'COM', bill_date: today, party_name: 'Walk-in', is_credit: 0, gst_pct: 3 },
      items: [{ item_name: 'Loose sale', gross_wt: 1, purity: 91.6, net_wt: 1, rate_per_gm: 4590 }],
      urds: [],
    })
    check('numbers never reused', after.bill_no, 'COM4')
    check('sale without a tag still saves', api.sale.read({ id: after.id }).goods_amount, 4590)

  } catch (e) {
    fail++
    failures.push(`${section} → UNCAUGHT: ${e.message}`)
    console.error('\nUNCAUGHT in', section, '\n', e.stack || e.message)
  }

  console.log('\n' + '='.repeat(64))
  console.log(`  ${pass} passed, ${fail} failed`)
  if (failures.length) {
    console.log('\n  Failures:')
    failures.forEach((f) => console.log('   - ' + f))
  }
  console.log('='.repeat(64))
  process.exit(fail ? 1 : 0)
})
