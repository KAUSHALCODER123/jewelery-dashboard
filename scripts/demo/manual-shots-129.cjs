/**
 * Screenshots of the 1.29 screens for the Shop Owner's Manual (docs/shots).
 * Same recorder as the tour; each beat with `shot` saves docs/shots/<name>.png.
 *
 *   npm run build
 *   set TOUR_SCENES=scripts/demo/manual-shots-129.cjs
 *   set TOUR_DIR=demo/manual-shots-129
 *   npx electron scripts/demo/tour.cjs
 *
 * The shop is seeded with work already in progress, so no screen is empty.
 */
const b = (at, cap, js, extra = {}) => ({ at, cap, js, ...extra })

function seedMore(api, S, ids) {
  const today = ids.today
  const tags = api.tagStock.list({ status: 'IN_STOCK' })
  const kar = S.karagir
  // Repairs at different steps.
  const r1 = api.repairs.create({ customer_id: S.customers.priya, description: 'Gold chain — broken clasp', gross_wt: 18.4, net_wt: 18.4, requested_work: 'Replace clasp', estimate: 450, promised_date: today })
  api.repairs.transition({ id: r1.id, to: 'ASSESSED' })
  api.repairs.transition({ id: r1.id, to: 'ASSIGNED', karigar_id: kar })
  api.repairs.create({ customer_id: S.customers.rekha, description: 'Bangle pair — polish', gross_wt: 32.1, net_wt: 32.1, requested_work: 'Polish and clean', estimate: 600 })
  const r3 = api.repairs.create({ customer_name: 'Walk-in: Suresh', description: 'Ring resizing', gross_wt: 5.2, net_wt: 5.2, requested_work: 'Size 16 to 18', estimate: 250 })
  api.repairs.transition({ id: r3.id, to: 'ASSESSED' })
  // A hallmarking batch away at the centre.
  const hb = api.hallmark.create({ centre: 'Pune Assaying & Hallmarking Centre', tag_ids: tags.slice(0, 2).map((t) => t.id) })
  api.hallmark.dispatch({ id: hb.id })
  api.hallmark.create({ centre: 'Pune Assaying & Hallmarking Centre', tag_ids: [tags[2].id] })
  // A reservation and an approval memo.
  api.reservations.create({ customer_id: S.customers.priya, tag_id: tags[3].id, expires_at: new Date(Date.now() + 10 * 864e5).toISOString().slice(0, 10) })
  api.memos.issue({ direction: 'OUT', tag_id: tags[4].id, counterparty: 'Rekha Shah', custodian: 'customer', due_date: today })
  // A stock count part-way through.
  const sc = api.stockCount.create({ scope: {} })
  for (const t of api.tagStock.list({ status: 'IN_STOCK' }).slice(0, 3)) api.stockCount.scan({ session_id: sc.id, raw: t.tag })
  api.stockCount.scan({ session_id: sc.id, raw: 'OLD00017' })
  // Today counted.
  const cl = api.closing.open({ business_date: today })
  api.closing.saveCounts({ session_id: cl.id, counts: [{ denomination: 500, qty: 48 }, { denomination: 200, qty: 4 }, { denomination: 100, qty: 1 }], other: 40 })
  // Catalogue: categories and other names.
  const c1 = api.catalogue.saveCategory({ name: 'Bridal' })
  api.catalogue.saveCategory({ name: 'Bridal Necklace Sets', parent_id: c1.id ?? c1 })
  api.catalogue.saveCategory({ name: 'Daily Wear' })
  const neck = api.item.list({ search: 'Necklace' })[0]
  if (neck) api.catalogue.saveAlias({ entity: 'item', entity_id: neck.id, alias: 'Haar' })
  // A parked bill.
  const t = api.tagStock.list({ status: 'IN_STOCK' }).find((x) => /Ring/.test(x.item_name))
  api.parked.park({ draft: { head: { prefix: 'COM', bill_date: today, party_name: 'Amit Patel', party_id: S.customers.amit },
    items: t ? [{ tag: t.tag, tag_stock_id: t.id, item_id: t.item_id, item_name: t.item_name, gross_wt: t.gross_wt, net_wt: t.net_wt, purity: t.purity, rate_per_gm: 6200 }] : [],
    urds: [], metals: [], payments: [] } })
  return {}
}

const clickText = (re) => `const b=[...document.querySelectorAll('button')].find(x=>${re}.test(x.textContent.trim())); if(b){__t.cursorAt(b); b.click()}`

const scenes = [
  { id: 'closing', hold: 2, beats: [
    b(0, null, `__t.nav('Daily Closing')`),
    b(2, null, clickText('/^Open Close/')),
    b(4, null, `__t.scrollTo(0)`, { shot: 'closing' }),
  ] },
  { id: 'stockcount', hold: 2, beats: [
    b(0, null, `__t.nav('Stock Verification')`),
    b(3, null, `__t.scrollTo(0)`, { shot: 'stock-count' }),
  ] },
  { id: 'reservations', hold: 2, beats: [
    b(0, null, `__t.nav('Reservations / Memos')`),
    b(3, null, `__t.scrollTo(0)`, { shot: 'reservations' }),
  ] },
  { id: 'repairs', hold: 2, beats: [
    b(0, null, `__t.nav('Repairs')`),
    b(3, null, `__t.scrollTo(0)`, { shot: 'repairs' }),
  ] },
  { id: 'hallmarking', hold: 2, beats: [
    b(0, null, `__t.nav('Hallmarking')`),
    b(3, null, `__t.scrollTo(0)`, { shot: 'hallmarking' }),
  ] },
  { id: 'catalogue', hold: 2, beats: [
    b(0, null, `__t.nav('Catalogue')`),
    b(3, null, `__t.scrollTo(0)`, { shot: 'catalogue' }),
  ] },
  { id: 'parked', hold: 2, beats: [
    b(0, null, `__t.nav('Sales Invoice')`),
    b(2.5, null, clickText('/^Parked/')),
    b(4, null, '', { shot: 'parked-bills' }),
  ] },
  { id: 'customer', hold: 2, beats: [
    b(0, null, `__t.nav('Customers')`),
    b(2, null, `const tr=[...document.querySelectorAll('table.data tbody tr')].find(t=>/Priya/.test(t.textContent)); const x=tr&&tr.querySelector('button[title="Customer summary"]'); if(x){__t.cursorAt(x); x.click()}`),
    b(4, null, `__t.scrollTo(0)`, { shot: 'customer-summary' }),
  ] },
  { id: 'stockfilters', hold: 2, beats: [
    b(0, null, `__t.nav('Stock Report')`),
    b(3, null, `__t.scrollTo(0)`, { shot: 'stock-filters' }),
  ] },
]

module.exports = { scenes, parts: { 1: scenes.map((s) => s.id) }, seedMore }
