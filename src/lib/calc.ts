/**
 * Renderer-side copy of the jewellery math, used for live preview as the user types.
 * The main process re-computes everything in electron/calc.cjs before writing to the
 * database — that file is authoritative. Keep the two in sync.
 */

export const r2 = (n: any) => Math.round((Number(n) || 0) * 100) / 100
export const r3 = (n: any) => Math.round((Number(n) || 0) * 1000) / 1000
export const num = (n: any) => (Number.isFinite(Number(n)) ? Number(n) : 0)

/** Physical quantities can never be negative — see electron/calc.cjs. */
export const nn = (n: any) => Math.max(0, num(n))

export function netWeight(l: any) {
  // Stones, beads, diamonds and the bag the piece sits in are not metal, so they
  // all come out before per-gram pricing — a piece is weighed IN its pouch, and
  // leaving bag_wt in would charge gold rates for plastic. All default to 0, so
  // plain pieces net exactly as before.
  return r3(Math.max(0,
    nn(l.gross_wt) - nn(l.stone_wt) - nn(l.black_beads) - nn(l.diamond_wt) - nn(l.bag_wt)))
}

export function fineWeight(net: any, purity: any) {
  return r3(nn(net) * (nn(purity) / 100))
}

export function saleLine(line: any) {
  const net = line.net_wt != null && line.net_wt !== '' ? nn(line.net_wt) : netWeight(line)
  const basis = nn(line.qty) > 0 && net === 0 ? nn(line.qty) : net
  const total_amount = r2(basis * nn(line.rate_per_gm))
  // Making can be charged three ways, in order of precedence: a rupee figure
  // typed straight onto the line, a percentage of the metal value, or a rate per
  // gram. A percentage tracks the gold rate, which is how most shops quote it.
  const mkg_amount =
    line.mkg_amount != null && line.mkg_amount !== ''
      ? r2(Math.max(0, num(line.mkg_amount)))
      : nn(line.mkg_pct) > 0
        ? r2(total_amount * nn(line.mkg_pct) / 100)
        : r2(basis * nn(line.mkg_per_gm))
  const stone_amount = r2(nn(line.stone_wt) * nn(line.stone_rate))
  const diamond_amount = r2(nn(line.diamond_wt) * nn(line.diamond_rate))
  const item_total = r2(
    total_amount + stone_amount + diamond_amount + mkg_amount + nn(line.hallmark_charges))
  return { ...line, net_wt: r3(net), total_amount, mkg_amount, stone_amount, diamond_amount, item_total }
}

export function urdLine(line: any) {
  const net = line.net_wt != null && line.net_wt !== '' ? nn(line.net_wt) : netWeight(line)
  const final_wt = fineWeight(net, line.purity)
  return { ...line, net_wt: r3(net), final_wt, amount: r2(final_wt * nn(line.rate)) }
}

/**
 * Weightwise settlement, one row per metal. Mirrors electron/calc.cjs — the two
 * must agree, or the live preview will disagree with the saved bill.
 * See docs/VIDEO-SPEC-2.md section 1.
 */
export function metalSettlement(lines: any[], urdLines: any[], rows: any[]) {
  const fine = new Map<string, any>()
  const add = (metal: string, key: string, v: number) => {
    const m = fine.get(metal) || { metal, sold: 0, urd: 0 }
    m[key] += v
    fine.set(metal, m)
  }
  // A loose item (mani, fuli) is weighed in grams but it is not metal, so it
  // owes nothing in fine weight - it is paid for in rupees like a stone.
  for (const l of lines) {
    if (l.is_loose) continue
    add(l.metal || 'Gold', 'sold', fineWeight(l.net_wt, l.purity))
  }
  for (const u of urdLines) add(u.metal || 'Gold', 'urd', nn(u.final_wt))

  const byMetal = new Map((rows || []).map((r: any) => [r.metal || 'Gold', r]))
  for (const k of byMetal.keys()) if (!fine.has(k)) fine.set(k, { metal: k, sold: 0, urd: 0 })

  return [...fine.values()].map((m: any) => {
    const row: any = byMetal.get(m.metal) || {}
    const fine_wt = r3(m.sold - m.urd)
    const balance_wt =
      row.balance_wt === '' || row.balance_wt == null ? fine_wt : r3(num(row.balance_wt))
    const rate_per_gm = nn(row.rate_per_gm)
    return {
      metal: m.metal,
      fine_sold: r3(m.sold),
      fine_urd: r3(m.urd),
      fine_wt,
      balance_wt,
      rate_per_gm,
      amount: r2(balance_wt * rate_per_gm),
      pending_wt: r3(fine_wt - balance_wt),
    }
  })
}

export function saleTotals(head: any, items: any[], urds: any[], metals?: any[]) {
  const lines = (items || []).map(saleLine)
  const urdLines = (urds || []).map(urdLine)
  const weightwise = !!head.weightwise
  const metalRows = weightwise ? metalSettlement(lines, urdLines, metals || []) : []

  // Stone and diamond value is paid in rupees regardless of how the metal is
  // priced, so it is added in both branches (weightwise settles metal in grams
  // but the stones are still cash).
  const stone_diamond = r2(lines.reduce((s, l) => s + num(l.stone_amount) + num(l.diamond_amount), 0))
  // Loose items settle in rupees on both kinds of bill for the same reason as
  // stones: no metal changed hands, so a weightwise bill has nothing to net them
  // against and dropping them here would hand the beads over free.
  const loose_amount = r2(lines.reduce((s, l) => s + (l.is_loose ? num(l.total_amount) : 0), 0))
  const goods_amount = weightwise
    ? r2(metalRows.reduce((s, m) => s + m.amount, 0) + stone_diamond + loose_amount)
    : r2(lines.reduce((s, l) => s + num(l.total_amount), 0) + stone_diamond)
  const making_amount = r2(lines.reduce((s, l) => s + num(l.mkg_amount), 0))
  const hallmark_amount = r2(lines.reduce((s, l) => s + num(l.hallmark_charges), 0))
  const bill_amount = r2(goods_amount + making_amount + hallmark_amount)

  const bill_discount = num(head.bill_discount)
  // Making discount can be given in rupees or as a percentage of the making
  // charged. Both are allowed at once and add up, but never past the making
  // itself — a discount larger than the charge would be a rebate on metal.
  const making_discount = r2(Math.min(
    making_amount,
    num(head.making_discount) + making_amount * num(head.making_disc_pct) / 100
  ))
  const loyalty_discount = num(head.loyalty_discount)
  const taxable = r2(Math.max(0, bill_amount - bill_discount - making_discount - loyalty_discount))

  const gst_pct = head.gst_not_required ? 0 : num(head.gst_pct)
  const gst_amount = r2(taxable * (gst_pct / 100))

  // A card-swipe fee passed on to the customer is part of what they owe, so it
  // rides with Other Charges — after tax, because it is a bank fee and not
  // consideration for the goods.
  const card_charge_customer = num(head.card_charge_customer)
  const other_amount = num(head.other_amount)
  const tcs_pct = num(head.tcs_pct)
  const tcs_amount = r2((taxable + gst_amount) * (tcs_pct / 100))
  const total_amount = r2(taxable + gst_amount + other_amount + tcs_amount + card_charge_customer)

  // Weightwise: the old gold is already netted off in fine weight, so its rupee
  // value must not be credited a second time here.
  const urd_amount = weightwise
    ? 0
    : r2(urdLines.reduce((s, l) => s + num(l.amount), 0) + num(head.manual_urd_amount))
  const amount_received = num(head.amount_received)
  // A saving-scheme balance is money the shop already holds as a liability, not
  // a discount — so it settles the bill after tax. Redeeming 6,000 against a
  // 52,000 bill with 1,560 GST leaves 47,560 to pay, and the GST still stands.
  const gss_amount = num(head.gss_amount)
  const net_balance = r2(total_amount - urd_amount - amount_received - gss_amount)

  return {
    items: lines,
    urds: urdLines,
    metals: metalRows,
    totals: {
      weightwise: weightwise ? 1 : 0,
      pending_wt: r3(metalRows.reduce((s, m) => s + m.pending_wt, 0)),
      goods_amount,
      stone_amount: r2(lines.reduce((s, l) => s + num(l.stone_amount), 0)),
      diamond_amount: r2(lines.reduce((s, l) => s + num(l.diamond_amount), 0)),
      making_amount, hallmark_amount, bill_amount,
      bill_discount, making_discount, loyalty_discount, gst_pct, gst_amount,
      other_amount, tcs_pct, tcs_amount, total_amount,
      making_disc_pct: num(head.making_disc_pct),
      card_charge_customer, card_charge_shop: num(head.card_charge_shop),
      urd_amount, amount_received, net_balance,
      gss_amount, gss_weight: r3(head.gss_weight), gss_rate: num(head.gss_rate),
      gss_return: num(head.gss_return),
      total_gross_wt: r3(lines.reduce((s, l) => s + num(l.gross_wt), 0)),
      total_net_wt: r3(lines.reduce((s, l) => s + num(l.net_wt), 0)),
      total_qty: r3(lines.reduce((s, l) => s + num(l.qty), 0)),
    },
  }
}

/**
 * A gold rate is quoted per gram of 995 fine, so a gold line is valued against
 * that basis rather than against pure metal. Silver and platinum rates are
 * quoted per gram outright, so they divide by 100. Keep in step with
 * electron/calc.cjs — the two must agree or the preview will disagree with the
 * saved bill.
 */
export const GOLD_RATE_PURITY = 99.5
export const rateBasis = (metal?: string) => (!metal || metal === 'Gold' ? GOLD_RATE_PURITY : 100)

export function purchaseLine(line: any, metal?: string) {
  const net = line.net_wt != null && line.net_wt !== '' ? nn(line.net_wt) : netWeight(line)
  // A loose item (mani, fuli) is bought by the gram at a flat rate, not on a
  // metal touch basis: 100 g at 35 is 3,500. Running it through the touch would
  // both misprice it and — worse — put 100 g of beads on the supplier's gold
  // khata, so it carries no fine weight at all.
  if (line.is_loose) {
    return {
      ...line,
      net_wt: r3(net),
      fine_plus_wastage: 0,
      amount: r2(net * nn(line.rate)),
      hallmark_amount: r2(nn(line.qty) * nn(line.hallmark_charges)),
    }
  }
  // Wastage is added to the touch, not levied on the fine weight: 91.6 + 8 = 99.6.
  const touch = nn(line.purity) + nn(line.wastage_pct)
  const fine_plus_wastage = r3(net * touch / 100)
  return {
    ...line,
    net_wt: r3(net),
    fine_plus_wastage,
    amount: r2(net * touch * nn(line.rate) / rateBasis(metal)),
    hallmark_amount: r2(nn(line.qty) * nn(line.hallmark_charges)),
  }
}

/* ── Refining: value follows the FINE weight the refiner settles on ── */

export function refineryLine(line: any) {
  const net = line.net_wt != null && line.net_wt !== '' ? nn(line.net_wt) : netWeight(line)
  const fine_wt = fineWeight(net, line.purity)
  return {
    ...line,
    net_wt: r3(net),
    fine_wt,
    amount: r2(fine_wt * nn(line.rate_per_gm)),
    gross_wastage: r3(nn(line.gross_wastage)),
  }
}

export function refineryTotals(head: any, items: any[]) {
  const lines = (items || []).map(refineryLine)
  const goods = r2(lines.reduce((s, l) => s + num(l.amount), 0))
  const discount = num(head.discount)
  const taxable = r2(goods - discount)
  const gst_amount = r2(taxable * (num(head.gst_pct) / 100))
  const bill_amount = r2(taxable + gst_amount + num(head.sub_tax))
  const paid_amount = num(head.paid_amount)
  return {
    items: lines,
    totals: {
      goods_amount: goods, discount, gst_pct: num(head.gst_pct), gst_amount,
      sub_tax: num(head.sub_tax), bill_amount, paid_amount,
      net_balance: r2(bill_amount - paid_amount),
      total_gross_wt: r3(lines.reduce((s, l) => s + num(l.gross_wt), 0)),
      total_net_wt: r3(lines.reduce((s, l) => s + num(l.net_wt), 0)),
      total_fine_wt: r3(lines.reduce((s, l) => s + num(l.fine_wt), 0)),
      total_wastage: r3(lines.reduce((s, l) => s + num(l.gross_wastage), 0)),
    },
  }
}

/* ── Karagir orders: priced like a sale, settled with an advance ── */

export function orderLine(line: any) {
  const l = saleLine(line)
  return { ...l, fine_wt: fineWeight(l.net_wt, l.purity) }
}

export function orderTotals(head: any, items: any[], urds?: any[]) {
  const lines = (items || []).map(orderLine)
  const urdLines = (urds || []).map(urdLine)
  const goods_amount = r2(lines.reduce((s, l) => s + num(l.total_amount), 0))
  const making_amount = r2(lines.reduce((s, l) => s + num(l.mkg_amount), 0))
  const hallmark_amount = r2(lines.reduce((s, l) => s + num(l.hallmark_charges), 0))
  const gross = r2(goods_amount + making_amount + hallmark_amount)
  const discount = num(head.discount)
  const total_amount = r2(gross - discount)
  const urd_amount = r2(urdLines.reduce((s, l) => s + num(l.amount), 0))
  const advance_amount = num(head.advance_amount)
  return {
    items: lines,
    urds: urdLines,
    totals: {
      goods_amount, making_amount, hallmark_amount, discount, total_amount, urd_amount,
      advance_amount, balance_amount: r2(total_amount - advance_amount - urd_amount),
      total_gross_wt: r3(lines.reduce((s, l) => s + num(l.gross_wt), 0)),
      total_net_wt: r3(lines.reduce((s, l) => s + num(l.net_wt), 0)),
      total_fine_wt: r3(lines.reduce((s, l) => s + num(l.fine_wt), 0)),
      total_urd_fine: r3(urdLines.reduce((s, l) => s + num(l.final_wt), 0)),
    },
  }
}

export function purchaseTotals(head: any, items: any[]) {
  const lines = (items || []).map((l) => purchaseLine(l, head?.metal))
  const ins = lines.filter((l) => l.direction !== 'OUT')
  const outs = lines.filter((l) => l.direction === 'OUT')

  const sum = (rows: any[], key: string) => r3(rows.reduce((s, l) => s + num(l[key]), 0))
  const sum2 = (rows: any[], key: string) => r2(rows.reduce((s, l) => s + num(l[key]), 0))

  const in_gross = sum(ins, 'gross_wt'), out_gross = sum(outs, 'gross_wt')
  const in_net = sum(ins, 'net_wt'), out_net = sum(outs, 'net_wt')
  const in_fine = sum(ins, 'fine_plus_wastage'), out_fine = sum(outs, 'fine_plus_wastage')

  const purchase_amount = sum2(ins, 'amount')
  const hallmark = sum2(ins, 'hallmark_amount')
  const discount = num(head.discount)
  const return_amount = sum2(outs, 'amount')
  const taxable = r2(purchase_amount + hallmark - discount - return_amount)
  const gst_pct = head.gst_not_required ? 0 : num(head.gst_pct)
  const gst_amount = r2(taxable * (gst_pct / 100))
  const tcs_pct = num(head.tcs_pct)
  const tcs_amount = r2((taxable + gst_amount) * (tcs_pct / 100))
  const bill_amount = r2(taxable + gst_amount + num(head.sub_tax) + tcs_amount)
  const paid_amount = num(head.paid_amount)
  // Settled in fine metal: grams handed over at a rate, valued like cash paid.
  const paid_fine_wt = r3(nn(head.paid_fine_wt))
  const paid_fine_rate = nn(head.paid_fine_rate)
  const paid_fine_amount = r2(paid_fine_wt * paid_fine_rate)
  return {
    items: lines,
    totals: {
      purchase_amount, discount, return_amount, gst_pct, gst_amount,
      tcs_pct, tcs_amount, sub_tax: num(head.sub_tax), bill_amount, paid_amount,
      paid_fine_wt, paid_fine_rate, paid_fine_amount,
      net_balance: r2(bill_amount - paid_amount - paid_fine_amount),
      total_gross_wt: r3(in_gross + out_gross),
      total_net_wt: r3(in_net + out_net),
      total_fine_wt: in_fine,
      in_gross_wt: in_gross, in_net_wt: in_net, in_fine_wt: in_fine,
      out_gross_wt: out_gross, out_net_wt: out_net, out_fine_wt: out_fine,
      balance_gross_wt: r3(in_gross - out_gross),
      balance_net_wt: r3(in_net - out_net),
      balance_fine_wt: r3(in_fine - out_fine),
      // Fine still owed to the supplier after the metal handed over as payment —
      // negative when we gave them more than we took in.
      fine_due_wt: r3(in_fine - out_fine - paid_fine_wt),
      is_exchange: outs.length > 0,
    },
  }
}

