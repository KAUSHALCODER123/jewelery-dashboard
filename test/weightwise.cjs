/**
 * Weightwise ("metal basis") billing — docs/VIDEO-SPEC-2.md §1.
 *
 * Replays the Waightwise demo: 15 g sold, 6 g of old gold taken in, 9 g owed,
 * part of it settled in cash and the rest carried as a METAL receivable.
 *    npm run test:weightwise
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
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'parivar-ww-'))
  const db = require('../electron/db.cjs')
  db.open(tmp)
  const api = require('../electron/api.cjs')
  const calc = require('../electron/calc.cjs')

  try {
    head('1. Settlement arithmetic (video: 15 - 6 = 9)')
    const items = [{ net_wt: 15, purity: 100, rate_per_gm: 0, mkg_per_gm: 0 }]
    const urds = [{ net_wt: 6, purity: 100, rate: 0 }]

    let m = calc.metalSettlement(
      items.map(calc.saleLine), urds.map(calc.urdLine), [{ metal: 'Gold', balance_wt: 5, rate_per_gm: 5000 }]
    )[0]
    check('fine sold', m.fine_sold, 15)
    check('fine taken as old gold', m.fine_urd, 6)
    check('metal owed (15 - 6)', m.fine_wt, 9)
    check('settled now', m.balance_wt, 5)
    check('amount (5 x 5000)', m.amount, 25000)
    check('pending metal (9 - 5)', m.pending_wt, 4)

    head('2. Settling the whole balance leaves nothing owed')
    m = calc.metalSettlement(
      items.map(calc.saleLine), urds.map(calc.urdLine), [{ metal: 'Gold', balance_wt: 9, rate_per_gm: 5000 }]
    )[0]
    check('amount (9 x 5000)', m.amount, 45000)
    check('pending metal', m.pending_wt, 0)

    head('3. Blank balance defaults to settling in full')
    m = calc.metalSettlement(
      items.map(calc.saleLine), urds.map(calc.urdLine), [{ metal: 'Gold', rate_per_gm: 5000 }]
    )[0]
    check('balance defaults to the full amount owed', m.balance_wt, 9)
    check('nothing left pending', m.pending_wt, 0)

    head('4. Bill totals — video showed 25,000 / 750 / 25,750')
    const partyId = api.party.save({
      party_type: 'CUSTOMER', name: 'Sachin Patil', state: 'Maharashtra', metals: [],
    })
    const g22 = api.itemGroup.list().find((g) => g.name === '22K Gold')
    const itemId = api.item.save({
      name: 'Ring', item_type_id: g22.item_type_id, item_group_id: g22.id,
      design_id: null, weight_mode: 'WEIGHT', uom: 'GRAM', hsn: '7113', image: '',
    })

    const mkSale = (balance_wt, extra = {}) => api.sale.save({
      head: {
        prefix: 'COM', bill_date: DAY, party_id: partyId, party_name: 'Sachin Patil',
        state: 'Maharashtra', is_credit: 1, payment_mode: 'Cash', gst_pct: 3,
        weightwise: 1, bill_discount: 0, making_discount: 0, other_amount: 0,
        manual_urd_amount: 0, tcs_pct: 0, amount_received: 0, ...extra,
      },
      items: [{
        item_id: itemId, item_name: 'Ring', hsn: '7113', qty: 3,
        gross_wt: 15, purity: 100, stone_wt: 0, net_wt: 15,
        rate_per_gm: 0, mkg_per_gm: extra.mkg_per_gm || 0, hallmark_charges: 0,
      }],
      urds: [{ name: 'Old Gold', gross_wt: 6, net_wt: 6, purity: 100, rate: 0 }],
      metals: [{ metal: 'Gold', balance_wt, rate_per_gm: 5000 }],
    })

    const s1 = api.sale.read({ id: mkSale(5).id })
    check('bill amount', s1.bill_amount, 25000)
    check('GST @ 3%', s1.gst_amount, 750)
    check('total', s1.total_amount, 25750)
    check('old gold NOT deducted again in rupees', s1.urd_amount, 0)
    check('settlement row saved', s1.metals.length, 1)
    check('pending weight stored', s1.metals[0].pending_wt, 4)

    head('5. The pending weight is a metal debt, not a money one')
    check('money owed', api.party.balance({ id: partyId }).balance, 25750)
    check('metal owed (grams)', api.party.metalBalance({ id: partyId }).balance, 4)

    head('6. Making is charged in cash on top of the metal')
    const s2 = api.sale.read({ id: mkSale(9, { mkg_per_gm: 300 }).id })
    // 9 x 5000 = 45,000 metal  +  15 x 300 = 4,500 making  =  49,500
    check('goods (metal settled)', s2.goods_amount, 45000)
    check('making (15 x 300)', s2.making_amount, 4500)
    check('bill amount', s2.bill_amount, 49500)
    check('GST @ 3%', s2.gst_amount, 1485)
    check('total', s2.total_amount, 50985)
    check('nothing left owed as metal', s2.metals[0].pending_wt, 0)

    head('7. The bill carries the pending weight to the printer')
    const pr = api.sale.forPrint({ id: mkSale(5).id })
    check('print payload flags weightwise', pr.sale.weightwise, 1)
    check('print payload carries pending metal', pr.sale.metals[0].pending_wt, 4)

    head('8. A normal bill is untouched by any of this')
    const s3 = api.sale.read({
      id: api.sale.save({
        head: {
          prefix: 'COM', bill_date: DAY, party_id: partyId, party_name: 'Sachin Patil',
          state: 'Maharashtra', is_credit: 1, payment_mode: 'Cash', gst_pct: 3,
          weightwise: 0, bill_discount: 0, making_discount: 0, other_amount: 0,
          manual_urd_amount: 0, tcs_pct: 0, amount_received: 0,
        },
        items: [{
          item_id: itemId, item_name: 'Ring', hsn: '7113', qty: 0,
          gross_wt: 12, purity: 91.6, stone_wt: 0, net_wt: 12,
          rate_per_gm: 4590, mkg_per_gm: 300, hallmark_charges: 0,
        }],
        urds: [{ name: 'Old Gold', gross_wt: 3, net_wt: 3, purity: 80, rate: 4500 }],
      }).id,
    })
    check('goods still from the line rate', s3.goods_amount, 55080)
    check('old gold still deducted in rupees', s3.urd_amount, 10800)
    check('net balance', s3.net_balance, 49640.4)
    check('no settlement rows written', s3.metals.length, 0)

    head('9. Deleting a weightwise bill gives the metal back')
    const before = api.party.metalBalance({ id: partyId }).balance
    const doomed = mkSale(2)
    check('metal owed rises by the unsettled part',
      api.party.metalBalance({ id: partyId }).balance, before + 7)
    api.sale.remove({ id: doomed.id })
    check('metal owed restored on delete',
      api.party.metalBalance({ id: partyId }).balance, before)
    check('settlement rows removed with the bill',
      db.get().prepare(`SELECT COUNT(*) c FROM sale_metal WHERE sale_id = ?`).get(doomed.id).c, 0)
  } catch (e) {
    fail++
    console.error('\nUNCAUGHT:', e.stack || e.message)
  }

  console.log(`\n${'═'.repeat(50)}`)
  console.log(`${pass} passed, ${fail} failed`)
  console.log('═'.repeat(50))
  process.exit(fail ? 1 : 0)
})
