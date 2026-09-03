/**
 * Jewellery money/weight math — authoritative copy (main process recomputes on save).
 * KEEP IN SYNC with src/lib/calc.ts, which is the renderer's live-preview copy.
 *
 * All formulas verified frame-by-frame against the demo video (docs/VIDEO-SPEC.md):
 *   net    = gross - stone - blackBeads
 *   fine   = net * purity/100          10.000 @ 91.6% -> 9.160
 *   goods  = net * ratePerGm           12.000 * 4590  -> 55080.00
 *   making = net * mkgPerGm            12.000 * 300   -> 3600.00
 *   bill   = goods + making + hallmark -> 58680.00
 *   gst    = bill * 3%                 -> 1760.40   (total 60440.40)
 *   urd    = fine * rate               3.000 @ 80% = 2.400 * 4500 -> 10800.00
 *   net bal= total - urd - received    60440.40 - 10800 -> 49640.40
 */

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100
const r3 = (n) => Math.round((Number(n) || 0) * 1000) / 1000
const num = (n) => (Number.isFinite(Number(n)) ? Number(n) : 0)

/**
 * Physical quantities — weights, purity, rates, counts — can never be negative.
 * A stray minus sign must not be able to produce a negative bill, so every such
 * field is floored at zero before it reaches the arithmetic.
 */
const nn = (n) => Math.max(0, num(n))

/** Net weight after deducting everything that is not metal. */
function netWeight({ gross_wt, stone_wt, black_beads, diamond_wt, bag_wt }) {
  // Stones, beads, diamonds and the bag the piece sits in are not metal, so they
  // all come out before the piece is priced per gram. A piece is weighed IN its
  // pouch, so leaving bag_wt in would charge the customer gold rates for plastic.
  // Every one of these defaults to 0, so a plain piece nets exactly as before.
  return r3(Math.max(0,
    nn(gross_wt) - nn(stone_wt) - nn(black_beads) - nn(diamond_wt) - nn(bag_wt)))
}

/** Fine (pure metal) weight. */
function fineWeight(net, purity) {
  return r3(nn(net) * (nn(purity) / 100))
}

/** Compute one sale line. Returns the line with derived fields filled in. */
function saleLine(line) {
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
  // Stone and diamond are priced in their own right — weight × rate — on top of
  // the metal. Both default to 0, so a plain gold piece is unaffected.
  const stone_amount = r2(nn(line.stone_wt) * nn(line.stone_rate))
  const diamond_amount = r2(nn(line.diamond_wt) * nn(line.diamond_rate))
  const item_total = r2(
    total_amount + stone_amount + diamond_amount + mkg_amount + nn(line.hallmark_charges))
  return { ...line, net_wt: r3(net), total_amount, mkg_amount, stone_amount, diamond_amount, item_total }
}

/** Compute one URD (old gold bought from customer) line. */
function urdLine(line) {
  const net = line.net_wt != null && line.net_wt !== '' ? nn(line.net_wt) : netWeight(line)
  const final_wt = fineWeight(net, line.purity)
  return { ...line, net_wt: r3(net), final_wt, amount: r2(final_wt * nn(line.rate)) }
}

/**
 * Weightwise ("metal basis") settlement, one row per metal.
 *
 * The customer is not billed for the metal in rupees per line. Instead the metal
 * they take, less the old gold they hand over, is a fine-weight debt:
 *
 *     fine_wt = fine sold  -  fine taken in as old gold
 *
 * They settle as much of that as they like now (`balance_wt`) at an agreed rate,
 * and whatever is left stays owed AS METAL — `pending_wt`. That pending weight is
 * the whole point of the mode: it is a metal receivable, not a money balance, and
 * must never be collapsed into one.
 *
 * Making and hallmarking are labour, not metal, so they stay on the money side of
 * the bill and are charged in full regardless of how the metal is settled.
 */
function metalSettlement(lines, urdLines, rows) {
  const fine = new Map()
  const add = (metal, key, v) => {
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

  // A row the user has already filled in wins; anything else is derived.
  const byMetal = new Map((rows || []).map((r) => [r.metal || 'Gold', r]))
  for (const r of byMetal.keys()) if (!fine.has(r)) fine.set(r, { metal: r, sold: 0, urd: 0 })

  return [...fine.values()].map((m) => {
    const row = byMetal.get(m.metal) || {}
    const fine_wt = r3(m.sold - m.urd)
    // Default to settling the whole thing — the common case is no metal left owed.
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

/**
 * Roll a whole sale bill up from its lines.
 * `head` carries gst_pct, discounts, other_amount, tcs_pct, amount_received.
 * When `head.weightwise` is set, the metal side of the bill comes from
 * `metals` (see metalSettlement) instead of the per-line rate.
 */
function saleTotals(head, items, urds, metals) {
  const lines = (items || []).map(saleLine)
  const urdLines = (urds || []).map(urdLine)
  const weightwise = !!head.weightwise
  const metalRows = weightwise ? metalSettlement(lines, urdLines, metals) : []

  // Stone and diamond value is a cash component of the goods regardless of how
  // the metal is priced, so it is added in both branches — including weightwise,
  // where the metal settles in grams but the stones are still paid for in rupees.
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
  // Loyalty points redeemed knock rupees off before tax, like any other discount.
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

  // On a weightwise bill the old gold is already netted off in fine weight, so
  // deducting its rupee value here as well would credit the customer twice.
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
      making_amount,
      hallmark_amount,
      bill_amount,
      bill_discount,
      making_discount,
      loyalty_discount,
      gst_pct,
      gst_amount,
      other_amount,
      tcs_pct,
      tcs_amount,
      making_disc_pct: num(head.making_disc_pct),
      card_charge_customer,
      card_charge_shop: num(head.card_charge_shop),
      total_amount,
      urd_amount,
      amount_received,
      gss_amount,
      gss_weight: r3(head.gss_weight),
      gss_rate: num(head.gss_rate),
      gss_return: num(head.gss_return),
      net_balance,
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
 * src/lib/calc.ts — the two must agree or the preview will disagree with the
 * saved bill.
 */
const GOLD_RATE_PURITY = 99.5
const rateBasis = (metal) => (!metal || metal === 'Gold' ? GOLD_RATE_PURITY : 100)

/** Compute one purchase line (supplier material in), incl. wastage. */
function purchaseLine(line, metal) {
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
  const amount = r2(net * touch * nn(line.rate) / rateBasis(metal))
  const hallmark_amount = r2(nn(line.qty) * nn(line.hallmark_charges))
  return { ...line, net_wt: r3(net), fine_plus_wastage, amount, hallmark_amount }
}

/**
 * Roll up a purchase bill.
 *
 * A purchase can be a straight cash buy, or a **metal-for-metal exchange**: the shop
 * hands fine metal back to the supplier ("Material out") against the ornaments it
 * receives ("Material In"), and only the difference settles in money. So the two
 * directions are totalled separately, and the OUT side becomes the return amount.
 */
function purchaseTotals(head, items) {
  const lines = (items || []).map((l) => purchaseLine(l, head && head.metal))
  const ins = lines.filter((l) => l.direction !== 'OUT')
  const outs = lines.filter((l) => l.direction === 'OUT')

  const sum = (rows, key) => r3(rows.reduce((s, l) => s + num(l[key]), 0))
  const sum2 = (rows, key) => r2(rows.reduce((s, l) => s + num(l[key]), 0))

  const in_gross = sum(ins, 'gross_wt'), out_gross = sum(outs, 'gross_wt')
  const in_net = sum(ins, 'net_wt'), out_net = sum(outs, 'net_wt')
  const in_fine = sum(ins, 'fine_plus_wastage'), out_fine = sum(outs, 'fine_plus_wastage')

  const purchase_amount = sum2(ins, 'amount')
  const hallmark = sum2(ins, 'hallmark_amount')
  const discount = num(head.discount)
  // Metal returned to the supplier reduces what we owe. This is derived purely from
  // the Material-out lines — it must NOT also read head.return_amount, or re-opening
  // a saved bill would add the stored total to the lines and double it.
  const return_amount = sum2(outs, 'amount')
  const taxable = r2(purchase_amount + hallmark - discount - return_amount)
  const gst_pct = head.gst_not_required ? 0 : num(head.gst_pct)
  const gst_amount = r2(taxable * (gst_pct / 100))
  const tcs_pct = num(head.tcs_pct)
  const tcs_amount = r2((taxable + gst_amount) * (tcs_pct / 100))
  const bill_amount = r2(taxable + gst_amount + num(head.sub_tax) + tcs_amount)
  const paid_amount = num(head.paid_amount)
  return {
    items: lines,
    totals: {
      purchase_amount,
      discount,
      return_amount,
      gst_pct,
      gst_amount,
      tcs_pct,
      tcs_amount,
      sub_tax: num(head.sub_tax),
      bill_amount,
      paid_amount,
      net_balance: r2(bill_amount - paid_amount),
      total_gross_wt: r3(in_gross + out_gross),
      total_net_wt: r3(in_net + out_net),
      total_fine_wt: in_fine,
      // Metal-exchange settlement — the video's "Balance Wgt" strip.
      in_gross_wt: in_gross, in_net_wt: in_net, in_fine_wt: in_fine,
      out_gross_wt: out_gross, out_net_wt: out_net, out_fine_wt: out_fine,
      balance_gross_wt: r3(in_gross - out_gross),
      balance_net_wt: r3(in_net - out_net),
      balance_fine_wt: r3(in_fine - out_fine),
      is_exchange: outs.length > 0,
    },
  }
}

/* ─────────────────────────── Refining ───────────────────────────
   Metal sent to / received from a refiner. The line's value is driven by the
   FINE weight (what the refiner actually settles on), not the net weight.
     fine   = net × purity/100
     amount = fine × rate/gm
   `gross_wastage` is the extra gross weight the refiner charges as burn loss. */

function refineryLine(line) {
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

function refineryTotals(head, items) {
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
      goods_amount: goods,
      discount,
      gst_pct: num(head.gst_pct),
      gst_amount,
      sub_tax: num(head.sub_tax),
      bill_amount,
      paid_amount,
      net_balance: r2(bill_amount - paid_amount),
      total_gross_wt: r3(lines.reduce((s, l) => s + num(l.gross_wt), 0)),
      total_net_wt: r3(lines.reduce((s, l) => s + num(l.net_wt), 0)),
      total_fine_wt: r3(lines.reduce((s, l) => s + num(l.fine_wt), 0)),
      total_wastage: r3(lines.reduce((s, l) => s + num(l.gross_wastage), 0)),
    },
  }
}

/* ─────────────────────────── Karagir orders ───────────────────────────
   Priced exactly like a sale line (goods + making + hallmark); the difference
   is an advance is taken up front and the balance falls due on delivery. */

function orderLine(line) {
  const l = saleLine(line)
  return { ...l, fine_wt: fineWeight(l.net_wt, l.purity) }
}

function orderTotals(head, items, urds) {
  const lines = (items || []).map(orderLine)
  const urdLines = (urds || []).map(urdLine)
  const goods_amount = r2(lines.reduce((s, l) => s + num(l.total_amount), 0))
  const making_amount = r2(lines.reduce((s, l) => s + num(l.mkg_amount), 0))
  const hallmark_amount = r2(lines.reduce((s, l) => s + num(l.hallmark_charges), 0))
  const gross = r2(goods_amount + making_amount + hallmark_amount)
  const discount = num(head.discount)
  const total_amount = r2(gross - discount)
  // Old gold handed in at booking pays down the order like a second advance.
  const urd_amount = r2(urdLines.reduce((s, l) => s + num(l.amount), 0))
  const advance_amount = num(head.advance_amount)
  return {
    items: lines,
    urds: urdLines,
    totals: {
      goods_amount,
      making_amount,
      hallmark_amount,
      discount,
      total_amount,
      urd_amount,
      advance_amount,
      balance_amount: r2(total_amount - advance_amount - urd_amount),
      total_gross_wt: r3(lines.reduce((s, l) => s + num(l.gross_wt), 0)),
      total_net_wt: r3(lines.reduce((s, l) => s + num(l.net_wt), 0)),
      total_fine_wt: r3(lines.reduce((s, l) => s + num(l.fine_wt), 0)),
      total_urd_fine: r3(urdLines.reduce((s, l) => s + num(l.final_wt), 0)),
    },
  }
}

/** Indian-numbering amount in words, e.g. "Rs. Fourty Nine Thousand Six Hundred Fourty Only". */
const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine',
  'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen',
  'Seventeen', 'Eighteen', 'Nineteen']
const TENS = ['', '', 'Twenty', 'Thirty', 'Fourty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety']

function twoDigit(n) {
  if (n < 20) return ONES[n]
  const t = TENS[Math.floor(n / 10)]
  const o = ONES[n % 10]
  return o ? `${t} ${o}` : t
}

function amountInWords(amount) {
  let n = Math.floor(Math.abs(num(amount)))
  const paise = Math.round((Math.abs(num(amount)) - n) * 100)
  if (n === 0 && paise === 0) return 'Rs. Zero Only'

  const parts = []
  const crore = Math.floor(n / 10000000); n %= 10000000
  const lakh = Math.floor(n / 100000); n %= 100000
  const thousand = Math.floor(n / 1000); n %= 1000
  const hundred = Math.floor(n / 100); n %= 100

  if (crore) parts.push(`${twoDigit(crore)} Crore`)
  if (lakh) parts.push(`${twoDigit(lakh)} Lakh`)
  if (thousand) parts.push(`${twoDigit(thousand)} Thousand`)
  if (hundred) parts.push(`${ONES[hundred]} Hundred`)
  if (n) parts.push(twoDigit(n))

  let out = `Rs. ${parts.join(' ')}`
  if (paise) out += ` and ${twoDigit(paise)} Paise`
  return `${out} Only`
}

module.exports = {
  r2, r3, num, nn,
  netWeight, fineWeight, rateBasis, GOLD_RATE_PURITY,
  saleLine, urdLine, saleTotals, metalSettlement,
  purchaseLine, purchaseTotals,
  refineryLine, refineryTotals,
  orderLine, orderTotals,
  amountInWords,
}
