/**
 * Realistic demo dataset for a jewellery shop.
 * Shared by the feature test (test/full.cjs) and the `npm run demo` seeder,
 * so what you click through is exactly what the tests exercise.
 */

const d = (offsetDays = 0) => {
  const t = new Date()
  t.setDate(t.getDate() + offsetDays)
  return t.toISOString().slice(0, 10)
}

function seed(api) {
  const out = { dates: { today: d(0) } }

  // ── Company ──────────────────────────────────────────────────────────
  api.company.save({
    ...api.company.read(),
    name: 'Parivar Jewellers',
    address: '142 Laxmi Road, Pune 411002',
    phone: '020-2445 8890',
    gstin: '27ABCDE1234F1Z5',
    state: 'Maharashtra',
    bank_name: 'HDFC Bank',
    account_no: '50100123456789',
    branch: 'Laxmi Road',
    ifsc: 'HDFC0001234',
  })

  // ── Masters ──────────────────────────────────────────────────────────
  const groups = api.itemGroup.list()
  const G = (n) => groups.find((g) => g.name === n)
  const g22 = G('22K Gold'), g18 = G('18K Gold'), gSil = G('Silver')

  api.design.save({ name: 'Antique' })
  api.design.save({ name: 'Filigree' })
  const designs = api.design.list()

  const mkItem = (name, g, uom = 'GRAM', mode = 'WEIGHT') =>
    api.item.save({
      name, item_type_id: g.item_type_id, item_group_id: g.id,
      design_id: designs[0]?.id ?? null, weight_mode: mode, uom,
      hsn: '7113', image: '',
    })

  out.items = {
    ring: mkItem('Ring', g22),
    chain: mkItem('Chain', g22),
    bangle: mkItem('Bangle', g18),
    necklace: mkItem('Necklace', g22),
    payal: mkItem('Payal', gSil),
    coin: mkItem('Coin', g22, 'PCS', 'QTY'),
  }

  // ── Tagged stock ─────────────────────────────────────────────────────
  api.tagStock.saveBatch({ itemId: out.items.ring, rows: [
    { gross_wt: 10.000, purity: 91.6, mkg_per_gm: 300, hallmark_charges: 45, location: 'Shop' },
    { gross_wt: 12.000, purity: 91.6, mkg_per_gm: 300, hallmark_charges: 45, location: 'Shop' },
    { gross_wt: 15.000, purity: 91.6, mkg_per_gm: 280, hallmark_charges: 45, location: 'Shop' },
  ]})
  api.tagStock.saveBatch({ itemId: out.items.chain, rows: [
    { gross_wt: 24.500, purity: 91.6, mkg_per_gm: 220, hallmark_charges: 45, location: 'Shop' },
    { gross_wt: 31.200, purity: 91.6, mkg_per_gm: 210, hallmark_charges: 45, location: 'Locker' },
  ]})
  api.tagStock.saveBatch({ itemId: out.items.bangle, rows: [
    { gross_wt: 18.400, stone_wt: 1.200, purity: 75, mkg_per_gm: 420, hallmark_charges: 45 },
    { gross_wt: 22.750, stone_wt: 2.050, purity: 75, mkg_per_gm: 420, hallmark_charges: 45 },
  ]})
  api.tagStock.saveBatch({ itemId: out.items.necklace, rows: [
    { gross_wt: 45.300, stone_wt: 3.100, black_beads: 0.400, purity: 91.6, mkg_per_gm: 350, hallmark_charges: 45 },
  ]})
  api.tagStock.saveBatch({ itemId: out.items.payal, rows: [
    { gross_wt: 82.000, purity: 92.5, mkg_per_gm: 18 },
  ]})
  api.tagStock.saveBatch({ itemId: out.items.coin, rows: [
    { gross_wt: 10.000, purity: 99.9, qty: 5, mkg_per_gm: 0 },
  ]})

  // ── Parties ──────────────────────────────────────────────────────────
  out.customers = {
    sandip: api.party.save({
      party_type: 'CUSTOMER', name: 'Sandip Jain', area: 'Kothrud', city: 'Pune',
      district: 'Pune', mobile: '9767211065', whatsapp: '9767211065',
      email: 'sandip@example.com', pan: 'ABCPJ1234K', birth_date: '1985-04-12',
      opening_balance: 9500, opening_dr_cr: 'Dr', loyalty_enabled: 1,
      metals: [{ metal: 'Gold', weight: 5, dr_cr: 'Dr' }],
    }),
    amit: api.party.save({
      party_type: 'CUSTOMER', name: 'Amit Patel', area: 'Baner', city: 'Pune',
      mobile: '9822011223', opening_balance: 0, opening_dr_cr: 'Dr', metals: [],
    }),
    priya: api.party.save({
      party_type: 'CUSTOMER', name: 'Priya Deshmukh', area: 'Aundh', city: 'Pune',
      mobile: '9890455667', opening_balance: 2400, opening_dr_cr: 'Cr', metals: [],
    }),
    rekha: api.party.save({
      party_type: 'CUSTOMER', name: 'Rekha Shah', area: 'Camp', city: 'Pune',
      mobile: '9811223344', opening_balance: 0, opening_dr_cr: 'Dr', metals: [],
    }),
  }
  out.suppliers = {
    mahavir: api.party.save({
      party_type: 'SUPPLIER', name: 'Mahavir Gold', city: 'Mumbai',
      gstin: '27MAHAV5678G1Z2', mobile: '9820011223', metals: [],
    }),
  }
  out.karagir = api.party.save({
    party_type: 'KARAGIR', name: 'Chetan Kapila', city: 'Pune', mobile: '9765001122', metals: [],
  })
  out.refinery = api.party.save({
    party_type: 'REFINERY', name: 'Shree Refinery', city: 'Mumbai', metals: [],
  })

  return out
}

module.exports = { seed, d }
