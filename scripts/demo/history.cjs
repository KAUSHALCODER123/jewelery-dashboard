/**
 * The seeded shop's trading history, shared by every recorder. See the
 * comment on tradingHistory for why it lives here and not in demo-data.
 */
/**
 * A fortnight of trading.
 *
 * The shared seed lays out masters and stock but books no documents, so every
 * report in it reads empty — a Day Book with nothing in it and a GST return of
 * ₹0.00 sell nothing to anybody. This gives the shop a past: bills, a purchase,
 * money collected, metal at the goldsmith and at the refiner. It lives here
 * rather than in test/demo-data.cjs because the tests depend on that file's
 * counts being exactly what they are.
 */
function tradingHistory(api, S) {
  const day = (back) => {
    const t = new Date(); t.setDate(t.getDate() - back)
    return t.toISOString().slice(0, 10)
  }
  const tagsFor = (name) => api.tagStock.list({ status: 'IN_STOCK', search: name })
  const bill = (back, party_id, party_name, tag, rate, mkg, opts = {}) => {
    if (!tag) return
    api.sale.save({
      head: {
        prefix: 'COM', bill_date: day(back), party_id, party_name,
        state: 'Maharashtra', gst_pct: 3, payment_mode: 'Cash', ...opts,
      },
      items: [{
        tag: tag.tag, tag_stock_id: tag.id, item_id: tag.item_id, item_name: tag.item_name,
        qty: tag.qty, gross_wt: tag.gross_wt, purity: tag.purity,
        stone_wt: tag.stone_wt, stone_rate: tag.stone_rate, net_wt: tag.net_wt,
        rate_per_gm: rate, mkg_per_gm: mkg, hallmark_charges: 45,
      }],
    })
  }

  // What each piece cost the shop, per fine gram. Without it the Stock Report
  // values the whole tray at zero and says so on screen — which is not what a
  // shopkeeper is being told he will see.
  api.tagStock.updateRows({
    rows: api.tagStock.list({ status: 'IN_STOCK' })
      .map((t) => ({ id: t.id, purchase_rate: 6050 })),
  })

  // Metal in from the bullion dealer, on credit.
  api.purchase.save({
    head: {
      prefix: 'MI', invoice_date: day(12), party_id: S.suppliers.mahavir,
      party_name: 'Mahavir Gold', metal: 'Gold', state: 'Maharashtra',
      gst_pct: 3, is_credit: 1, paid_amount: 0,
    },
    items: [{ item_name: 'Bullion', direction: 'IN', gross_wt: 250, net_wt: 250,
              purity: 99.5, rate: 61500, wastage_pct: 0 }],
  })

  // Three bills across the fortnight, one of them today so the Day Book and the
  // dashboard have something to show.
  bill(9, S.customers.priya, 'Priya Deshmukh', tagsFor('Chain')[0], 6180, 220)
  bill(4, S.customers.rekha, 'Rekha Shah', tagsFor('Bangle')[0], 4720, 420,
    { is_credit: 1, amount_received: 20000 })
  bill(0, S.customers.amit, 'Amit Patel', tagsFor('Payal')[0], 92, 18)

  // Money collected against an old balance.
  // Inside the last day or two, because the Receipts screen opens on the
  // current month — a receipt dated before that would leave the list empty
  // while the voice is talking about collecting money.
  api.voucher.save({
    kind: 'RECEIPT', voucher_date: day(1), party_id: S.customers.sandip,
    party_name: 'Sandip Jain', amount: 5000, payment_type: 'Cash',
    narration: 'Against old balance',
  })
  api.voucher.save({
    kind: 'RECEIPT', voucher_date: day(0), party_id: S.customers.rekha,
    party_name: 'Rekha Shah', amount: 12000, payment_type: 'UPI',
    narration: 'Part payment',
  })

  // Metal with the goldsmith, and scrap at the refiner.
  api.karagir.issue({
    issue_date: day(8), karagir_id: S.karagir, karagir_name: 'Chetan Kapila',
    item_name: 'Chain', gross_wt: 120, less_wt: 0, net_wt: 120, purity: 100,
    wastage_pct: 0, metal: 'Gold',
  })
  api.karagir.receive({
    receive_date: day(2), karagir_id: S.karagir, karagir_name: 'Chetan Kapila',
    item_name: 'Chain', gross_wt: 117, less_wt: 0, stone_wt: 0, diamond_wt: 0,
    net_wt: 117, purity: 100, wastage_pct: 2, rate_per_gm: 260,
    tds_pct: 0, paid_amount: 0, metal: 'Gold',
  })
  api.refinery.save({
    // Both legs inside the current month: the Refining screen opens on
    // month-to-date, and a scrap-out dated before it would show "Fine Sent Out
    // 0.000 g" while the voice explains sending scrap away.
    head: { prefix: 'MO', invoice_date: day(2), direction: 'OUT',
            party_id: S.refinery, party_name: 'Shree Refinery', gst_pct: 0,
            paid_amount: 0, metal: 'Gold' },
    items: [{ item_name: 'Scrap', gross_wt: 42, stone_wt: 0, net_wt: 42,
              purity: 86, rate_per_gm: 0, gross_wastage: 0 }],
  })
  api.refinery.save({
    head: { prefix: 'MI', invoice_date: day(1), direction: 'IN',
            party_id: S.refinery, party_name: 'Shree Refinery', gst_pct: 0,
            paid_amount: 0, metal: 'Gold' },
    items: [{ item_name: 'Pure Gold', gross_wt: 35.8, stone_wt: 0, net_wt: 35.8,
              purity: 99.5, rate_per_gm: 0, gross_wastage: 0 }],
  })
}

module.exports = { tradingHistory }
