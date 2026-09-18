import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Icon } from '../lib/icons'
import {
  Autocomplete, Check, Confirm, Field, Input, Modal, Segmented, Select,
  useAction, useAsync,
} from '../lib/ui'
import { num, saleTotals } from '../lib/calc'
import { drcr, money, todayISO, wt } from '../lib/format'
import { buildInvoice, billMessage, pdfInvoice, printInvoice } from '../lib/printing'
import { GridSettingsButton, Rate10Cell, useGridCols, type GridCol } from '../lib/grid'

const OVER_SETTLED = 'Settling more metal than is owed — check the Balance Weight rows.'

const blankItem = () => ({
  tag: '', tag_stock_id: null as number | null, item_id: null as number | null,
  // Set when the line is a loose weight-wise item (mani, fuli). Such a line is
  // priced in rupees per gram and settles no metal, so the totals treat it like
  // a stone rather than like gold.
  is_loose: 0,
  // An untagged line can say which purchase invoice it was sold out of, so
  // the weight comes off that invoice's labels tally. '' = the loose pool.
  purchase_id: '' as any,
  item_name: '', hsn: '', qty: '', gross_wt: '', purity: '', stone_wt: '',
  stone_rate: '', diamond_wt: '', diamond_rate: '',
  net_wt: '', rate_per_gm: '', mkg_per_gm: '', mkg_pct: '', hallmark_charges: '', huid: '',
})

const blankUrd = () => ({
  name: 'Old Gold', description: '', gross_wt: '', net_wt: '',
  purity: '', rate: '',
})

const blankHead = () => ({
  id: null as number | null,
  prefix: 'COM', bill_no: '', manual_no: '',
  bill_date: todayISO(), due_date: '',
  party_id: null as number | null, party_name: '', address: '', mobile: '', area: '',
  state: 'Maharashtra', salesman: '',
  is_credit: 0, payment_mode: 'Cash',
  gst_not_required: 0, weightwise: 0,
  gst_pct: 3, bill_discount: 0, making_discount: 0, other_amount: 0,
  manual_urd_amount: 0, tcs_pct: 0, amount_received: 0, loyalty_redeem: 0,
  gss_id: '', gss_rate: '', gss_redeem: '', gss_return: '',
  making_disc_pct: '',
})

const PAY_MODES = ['Cash', 'UPI', 'Card', 'NEFT', 'Cheque', 'Bank']

/* The billing grid's columns, in their shipped order. A shop that never sells
   diamonds can hide those two and get a narrower bill; the tag and item columns
   stay, because without them a line identifies nothing. */
const ITEM_COLS: GridCol[] = [
  { key: 'tag', label: 'Tag', width: 100, fixed: true },
  { key: 'item_name', label: 'Item', width: 180, fixed: true },
  // Only meaningful on a hand-typed (untagged) metal line: which purchase it
  // was sold out of. A tagged piece already knows its purchase.
  { key: 'purchase_id', label: 'From Purchase', width: 150 },
  { key: 'qty', label: 'Qty', width: 54 },
  { key: 'gross_wt', label: 'Gross Wt', width: 78 },
  { key: 'purity', label: 'Purity', width: 66 },
  { key: 'stone_wt', label: 'Stone Wt', width: 70 },
  { key: 'stone_rate', label: 'Stone Rate', width: 74 },
  // Diamond is not typed on the bill. A tagged piece still carries its own
  // diamond weight and rate, still deducted from the net weight and charged on
  // top of the metal — the counter just does not key it in, so the columns are
  // gone rather than merely hidden.
  { key: 'net_wt', label: 'Net Wt', width: 78 },
  // Rates are quoted per ten grams at the counter, so that is what gets typed.
  // The figure is divided by ten before it reaches the line — everything stored,
  // printed and reported stays per gram.
  { key: 'rate_per_gm', label: 'Rate/10Gm', width: 92, lockLabel: true },
  // Making is quoted as a percentage of the metal value at the counter. A piece
  // tagged with a per-gram making figure still charges on it when no percentage
  // is entered — that figure is set on the tag, not on the bill.
  { key: 'mkg_pct', label: 'Mkg %', width: 66 },
  { key: 'mkg_amount', label: 'Mkg Amt', width: 86 },
  { key: 'total_amount', label: 'Amount', width: 96 },
  { key: 'item_total', label: 'Line Total', width: 96 },
]

export default function SalesInvoice({ go, saleId }: { go: (n: string, p?: any) => void; saleId?: number }) {
  const run = useAction()
  const grid = useGridCols('sale.items', ITEM_COLS)
  const cols = grid.cols
  const [head, setHead] = useState<any>(blankHead())
  const [items, setItems] = useState<any[]>([blankItem()])
  const [urds, setUrds] = useState<any[]>([])
  // Weightwise settlement, keyed by metal. Only what the user typed lives here;
  // the weights are always derived from the lines.
  const [metals, setMetals] = useState<any[]>([])
  // Empty = the bill was settled a single way, on head.payment_mode.
  const [payments, setPayments] = useState<any[]>([])
  const [busy, setBusy] = useState(false)
  const [confirmDel, setConfirmDel] = useState(false)
  const [custQuery, setCustQuery] = useState('')
  const [custBalance, setCustBalance] = useState<number | null>(null)
  const [loyalty, setLoyalty] = useState<{ balance: number; enabled: boolean } | null>(null)
  const [redeemValue, setRedeemValue] = useState(1)
  // The customer's open saving schemes, and the balance on the one being spent.
  const [schemes, setSchemes] = useState<any[]>([])
  const [gssBal, setGssBal] = useState<any>(null)
  // The bank's card-swipe rates, if an account is marked as the card account.
  const [cardAcc, setCardAcc] = useState<any>(null)
  const [showUrd, setShowUrd] = useState(false)
  const [newCust, setNewCust] = useState<any>(null)
  // Reverse calculation: the figure the customer named, and what the fit did.
  const [targetAmount, setTargetAmount] = useState('')
  const [fitNote, setFitNote] = useState('')

  const series = useAsync(() => window.api.series.list({ docType: 'SALE' }), [])
  // Purchases with metal still unlabelled — what an untagged line can be sold
  // out of. Reloaded after a save, since the bill just took some of it.
  const openPurchases = useAsync(() => window.api.purchase.openForTagging(), [])

  // Load an existing bill, or reserve the next number for a fresh one.
  useEffect(() => {
    let alive = true
    if (saleId) {
      window.api.sale.read({ id: saleId }).then((s: any) => {
        if (!alive || !s) return
        // Re-open with the points this bill already spent, so editing it does not
        // silently drop the redemption.
        setHead({
          ...blankHead(), ...s, loyalty_redeem: s.loyalty_redeemed || 0,
          // Re-open with what this bill already took from the scheme, so editing
          // it does not silently drop the redemption either.
          gss_redeem: s.gss_amount || '',
        })
        setItems(s.items?.length ? s.items : [blankItem()])
        setUrds(s.urds || [])
        setMetals(s.metals || [])
        setPayments(s.payments || [])
        setShowUrd((s.urds || []).length > 0)
        setCustQuery(s.party_name || '')
        if (s.party_id) {
          window.api.party.balance({ id: s.party_id }).then((b) => alive && setCustBalance(b.balance))
          window.api.party.loyaltyBalance({ id: s.party_id }).then((l) => alive && setLoyalty(l))
          window.api.gss.accounts({ party_id: s.party_id, closed: 0 })
            .then((a) => alive && setSchemes(a))
        }
      })
    } else {
      window.api.series.peek({ docType: 'SALE', prefix: head.prefix }).then((n) => {
        if (alive) setHead((h: any) => ({ ...h, bill_no: n }))
      })
    }
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saleId, head.prefix])

  // One point is worth `redeemValue` rupees; the shop sets that in Settings.
  useEffect(() => {
    window.api.settings.all().then((s: any) =>
      setRedeemValue(Number(s?.loyalty_redeem_value) || 1))
    window.api.account.list().then((as: any[]) =>
      setCardAcc(as.find((a) => a.is_card_swap) || null))
  }, [])

  // Points the customer is spending, capped at their balance; the rupee value of
  // those points is fed to the totals as a discount (the backend re-checks it).
  const redeemPts = Math.max(0, Math.min(num(head.loyalty_redeem), loyalty?.balance ?? 0))
  const loyaltyDiscount = redeemPts * redeemValue

  // What the chosen scheme is worth, valued at the rate typed on the bill.
  useEffect(() => {
    let alive = true
    if (!head.gss_id) { setGssBal(null); return }
    window.api.gss
      .balance({
        id: Number(head.gss_id), as_of: head.bill_date,
        rate: num(head.gss_rate), exclude_sale_id: head.id ?? null,
      })
      .then((b) => alive && setGssBal(b))
    return () => { alive = false }
  }, [head.gss_id, head.gss_rate, head.bill_date, head.id])

  // ── how the money was tendered ──
  // Declared above the totals because the card leg of a split decides the swipe
  // fee, which is part of what the bill comes to.
  const splitOn = payments.length > 0
  const splitTotal = payments.reduce((s, p) => s + num(p.amount), 0)
  // Rounded before comparing: two legs of 1/3 each can never foot to the paisa.
  const splitDiff = Math.round((splitTotal - num(head.amount_received)) * 100) / 100
  const cardSwiped = payments
    .filter((p) => p.mode === 'Card')
    .reduce((s, p) => s + Math.max(0, num(p.amount)), 0)
  const setPayRow = (i: number, patch: any) =>
    setPayments((rows) => rows.map((r, ix) => (ix === i ? { ...r, ...patch } : r)))

  // Mirrors the engine: an 'On Making' waiver is a discount and goes in before
  // tax, while the scheme's balance settles the bill after it. Both are re-derived
  // on save — this is only so the summary agrees with what will be stored.
  const computeWith = useCallback((rows: any[]) => {
    const base = { ...head, loyalty_discount: loyaltyDiscount, gss_amount: 0 }
    if (gssBal?.making_disc_pct > 0) {
      const mk = saleTotals({ ...base, making_discount: 0 }, rows, urds, metals).totals.making_amount
      base.making_discount = Math.min(mk, num(head.making_discount) + mk * gssBal.making_disc_pct / 100)
    }
    const t0 = saleTotals(base, rows, urds, metals).totals
    let gss_amount = 0
    if (head.gss_id && gssBal) {
      const payable = Math.max(0, t0.total_amount - t0.urd_amount - t0.amount_received)
      const asked = head.gss_redeem === '' || head.gss_redeem == null
        ? gssBal.redeem_value : num(head.gss_redeem)
      gss_amount = Math.max(0, Math.min(asked, gssBal.redeem_value, payable))
    }
    // Mirrors the engine's card-fee rule: the bank charges on what actually goes
    // through the terminal, and the customer's share is added to the bill.
    // On a split bill only the card leg is swiped, so only that leg is charged.
    let card_charge_customer = 0
    if (cardSwiped > 0 && cardAcc) {
      card_charge_customer = cardSwiped * num(cardAcc.card_pct_customer) / 100
    } else if (!splitOn && head.payment_mode === 'Card' && cardAcc) {
      const swiped = num(head.amount_received) > 0
        ? num(head.amount_received)
        : Math.max(0, t0.total_amount - t0.urd_amount - gss_amount)
      card_charge_customer = swiped * num(cardAcc.card_pct_customer) / 100
    }
    return saleTotals({ ...base, gss_amount, card_charge_customer }, rows, urds, metals)
  }, [head, urds, metals, loyaltyDiscount, gssBal, cardAcc, splitOn, cardSwiped])

  const computed = useMemo(() => computeWith(items), [computeWith, items])
  const t = computed.totals
  // Shown so the customer's share of the swipe fee is visible before saving; the
  // engine re-derives both shares from the account when the bill is written.
  const cardPct = (splitOn ? cardSwiped > 0 : head.payment_mode === 'Card')
    ? num(cardAcc?.card_pct_customer) : 0
  const cardFee = t.card_charge_customer
  // Same half-and-half the printed invoice uses.
  const halfPct = (num(t.gst_pct) / 2).toFixed(2).replace(/\.?0+$/, '')
  const gssReturn = Math.max(0, Math.min(
    num(head.gss_return), (gssBal?.redeem_value ?? 0) - t.gss_amount))

  // Settling more metal than is owed would post a negative debt to the gold
  // khata, which is meaningless — block the save rather than write it.
  const overSettled = !!head.weightwise && computed.metals.some((m: any) => m.pending_wt < 0)

  const metalRow = (metal: string) => metals.find((m) => m.metal === metal) || {}
  const setMetalRow = (metal: string, patch: any) =>
    setMetals((rows) =>
      rows.some((r) => r.metal === metal)
        ? rows.map((r) => (r.metal === metal ? { ...r, ...patch } : r))
        : [...rows, { metal, ...patch }]
    )

  const setItem = (i: number, patch: any) => {
    setItems((rows) => {
      const next = rows.map((r, ix) => (ix === i ? { ...r, ...patch } : r))
      const last = next[next.length - 1]
      if (last && (last.item_name || num(last.gross_wt) > 0)) next.push(blankItem())
      return next
    })
  }

  const setUrdRow = (i: number, patch: any) => {
    setUrds((rows) => {
      const next = rows.map((r, ix) => (ix === i ? { ...r, ...patch } : r))
      const last = next[next.length - 1]
      if (last && (num(last.gross_wt) > 0)) next.push(blankUrd())
      return next
    })
  }

  /** Fill a line from a scanned/selected stock tag. */
  const applyTag = (i: number, ts: any) => {
    setItem(i, {
      tag: ts.tag, tag_stock_id: ts.id, item_id: ts.item_id, purchase_id: '',
      item_name: ts.item_name, hsn: ts.hsn || '',
      gross_wt: ts.gross_wt, stone_wt: ts.stone_wt, net_wt: ts.net_wt,
      stone_rate: ts.stone_rate || '', diamond_wt: ts.diamond_wt || '',
      diamond_rate: ts.diamond_rate || '',
      purity: ts.purity, mkg_per_gm: ts.mkg_per_gm,
      hallmark_charges: ts.hallmark_charges, huid: ts.huid, qty: ts.qty || 0,
    })
    // The piece's own making rate is the truth — it was set when the piece was
    // tagged and priced. Only fall back to the Making Master when the tag has
    // none, which is the case for goods tagged before the master existed.
    if (!num(ts.mkg_per_gm) && ts.item_id) {
      window.api.rateMaster.resolve({ itemId: ts.item_id }).then((m: any) => {
        if (num(m?.making_per_gram) > 0) setItem(i, { mkg_per_gm: m.making_per_gram })
      })
    }
  }

  /**
   * Fill a line from a loose weight-wise item. There is no piece to scan — the
   * shopkeeper types how many grams of the lot the customer is taking, so only
   * the identity and the rate come from the master and the weight stays blank.
   */
  const applyLoose = (i: number, it: any) => {
    setItem(i, {
      tag: '', tag_stock_id: null, item_id: it.id, is_loose: 1, purchase_id: '',
      item_name: it.name, hsn: it.hsn || '',
      gross_wt: '', stone_wt: '', diamond_wt: '', net_wt: '',
      // Beads carry no purity: their grams are not metal and must not become
      // fine weight on a weight-wise bill.
      purity: 0, mkg_per_gm: '', mkg_pct: '', hallmark_charges: '', huid: '', qty: '',
    })
  }

  const pickCustomer = async (p: any) => {
    setHead((h: any) => ({
      ...h, party_id: p.id, party_name: p.name,
      address: p.address || '', mobile: p.mobile || p.whatsapp || '',
      area: p.area || '', state: p.state || h.state,
    }))
    setCustQuery(p.name)
    const b = await window.api.party.balance({ id: p.id })
    setCustBalance(b.balance)
    const l = await window.api.party.loyaltyBalance({ id: p.id })
    setLoyalty(l)
    const s = await window.api.gss.accounts({ party_id: p.id, closed: 0 })
    setSchemes(s)
    // A scheme belongs to one customer, so changing customer clears the choice.
    setHead((h: any) => ({ ...h, loyalty_redeem: 0, gss_id: '', gss_redeem: '', gss_return: '' }))
  }

  /**
   * Reverse calculation — the counter quotes a round figure and works backwards.
   *
   * "Make it ₹1,50,000" with the rate already on the line leaves exactly one
   * thing free: the making. So solve for the making percentage that lands the
   * bill total on the asked figure, and write it onto every priced line.
   *
   * The total is linear in that percentage, so two probes fix the line and a
   * third absorbs the paisa rounding along the way. Any per-line making already
   * keyed in rupees is cleared — it takes precedence over the percentage in the
   * engine, and leaving it would make the fitted figure a lie.
   */
  const fitMakingToTarget = () => run(async () => {
    setFitNote('')
    const target = num(targetAmount)
    if (!(target > 0)) throw new Error('Enter the amount the bill must come to')
    const priced = items.filter((r) => r.item_name && (num(r.gross_wt) > 0 || num(r.qty) > 0))
    if (!priced.length) throw new Error('Add at least one item before fitting the making')

    const trial = (pct: number) =>
      items.map((r) => ({ ...r, mkg_pct: pct, mkg_amount: '' }))
    const totalAt = (pct: number) => computeWith(trial(pct)).totals.total_amount

    const at0 = totalAt(0)
    if (at0 > target + 0.005) {
      throw new Error(
        `Metal, stones and tax alone come to ₹${money(at0)}. ` +
        `₹${money(target)} cannot be reached by making charges — lower the rate or give a discount.`
      )
    }
    const at100 = totalAt(100)
    if (at100 <= at0 + 0.005) {
      throw new Error('These lines carry no metal value, so a making percentage changes nothing')
    }
    let pct = (target - at0) / (at100 - at0) * 100
    // Two secant steps: enough for the rounding the engine does per line.
    for (let i = 0; i < 2; i++) {
      const here = totalAt(pct)
      if (Math.abs(here - target) < 0.005) break
      const nudge = pct + 1
      const slope = totalAt(nudge) - here
      if (Math.abs(slope) < 1e-9) break
      pct += (target - here) / slope
    }
    // Six decimals, not three: the engine rounds each line's making to the
    // paisa, and on a lakh-rupee bill a thousandth of a percent is worth more
    // than that — round the percentage prettily and the total misses the figure
    // the customer was quoted. The tidy number goes in the note instead.
    pct = Math.max(0, Math.round(pct * 1e6) / 1e6)
    const landed = totalAt(pct)
    setItems(trial(pct))
    setFitNote(
      `Making set to ${(Math.round(pct * 100) / 100).toFixed(2)}% — ` +
      `the bill comes to ₹${money(landed)}`
    )
  })

  const validate = () => {
    const filled = items.filter((r) => r.item_name && (num(r.gross_wt) > 0 || num(r.qty) > 0))
    if (!filled.length) throw new Error('Add at least one item to the bill')
    if (head.is_credit && !head.party_id) throw new Error('A credit bill needs a customer')
    if (splitOn && splitDiff !== 0) {
      throw new Error(
        `The payment split comes to ₹${money(splitTotal)} but the bill shows ` +
        `₹${money(num(head.amount_received))} received. Make the two agree before saving.`
      )
    }
    return filled
  }

  const doSave = async () => {
    setBusy(true)
    const res = await run(async () => {
      const filled = validate()
      return window.api.sale.save({
        head: {
          ...head, party_name: head.party_name || custQuery,
          gss_id: head.gss_id ? Number(head.gss_id) : null,
        },
        items: filled,
        urds: urds.filter((u) => num(u.gross_wt) > 0),
        metals: head.weightwise ? computed.metals : [],
        payments: payments.filter((p) => num(p.amount) > 0),
      })
    }, 'Bill saved')
    setBusy(false)
    return res
  }

  const saveOnly = async () => {
    const res = await doSave()
    if (res) go('sales.new', { id: res.id })
  }

  const savePrint = async () => {
    const res = head.id ? { id: head.id } : await doSave()
    if (!res) return
    if (!head.id) {
      // Newly created — re-fetch so the print carries the reserved bill number.
      await print(res.id)
      go('sales.new', { id: res.id })
    } else {
      await doSave()
      await print(head.id)
    }
  }

  const print = async (id: number) => { await printInvoice(id) }

  /** Open WhatsApp with a plain-text summary of this bill. */
  const whatsapp = async () => {
    const id = head.id ?? (await doSave())?.id
    if (!id) return
    const b = await buildInvoice(id)
    if (!b) return
    const mobile = head.mobile || b.data.party?.whatsapp || b.data.party?.mobile
    const res = await window.api.send.whatsapp({ mobile, text: billMessage(b.data) })
    if (!res?.ok) run(async () => { throw new Error(res?.error || 'Could not open WhatsApp') })
  }

  const savePdf = async () => {
    const res = head.id ? { id: head.id } : await doSave()
    if (!res) return
    await pdfInvoice(res.id)
  }

  const remove = async () => {
    setConfirmDel(false)
    const ok = await run(() => window.api.sale.remove({ id: head.id }), 'Bill deleted')
    if (ok !== undefined) go('sales')
  }

  const reset = () => {
    setHead(blankHead()); setItems([blankItem()]); setUrds([]); setMetals([])
    setPayments([]); setShowUrd(false)
    setCustQuery(''); setCustBalance(null); setLoyalty(null); go('sales.new')
  }

  const bal = custBalance != null ? drcr(custBalance) : null

  return (
    <div>
      {/* ── Customer & bill header ─────────────────────────── */}
      <div className="card" style={{ marginBottom: 14 }}>
        <div className="card-body">
          <div className="form-grid cols-4">
            <Field label="Customer" className="span-2"
              hint={head.party_id ? undefined : 'Leave blank for a cash counter sale'}>
              <div className="row" style={{ gap: 6 }}>
                <Autocomplete
                  className="grow"
                  value={custQuery}
                  placeholder="Type a name to search…"
                  onText={(s) => {
                    setCustQuery(s)
                    setHead((h: any) => ({ ...h, party_name: s, party_id: null }))
                    setCustBalance(null)
                  }}
                  onPick={pickCustomer}
                  fetch={(q) => window.api.party.list({ type: 'CUSTOMER', search: q })}
                  render={(p: any) => (
                    <span>
                      <b>{p.name}</b>
                      {p.mobile ? <span className="muted"> · {p.mobile}</span> : null}
                      {p.area ? <span className="muted"> · {p.area}</span> : null}
                    </span>
                  )}
                />
                <button className="btn btn-icon" title="New customer"
                  onClick={() => setNewCust({ name: custQuery, mobile: '', area: '', address: '' })}>
                  <Icon.plus />
                </button>
              </div>
            </Field>

            <Field label="Mobile">
              <Input value={head.mobile} inputMode="numeric"
                onChange={(e) => setHead({ ...head, mobile: e.target.value })} />
            </Field>

            <Field label="Area">
              <Input value={head.area} onChange={(e) => setHead({ ...head, area: e.target.value })} />
            </Field>

            <Field label="Series">
              <Select value={head.prefix} disabled={!!head.id}
                // An estimate is a quotation, not a tax invoice, so it carries no
                // GST by default. The box below stays editable for the odd case.
                onChange={(v) => {
                  const s = (series.data || []).find((x: any) => x.prefix === v)
                  const estimate = /estimate/i.test(`${v} ${s?.label || ''}`)
                  setHead({ ...head, prefix: v, gst_not_required: estimate ? 1 : 0 })
                }}
                options={(series.data || []).map((s: any) => ({ value: s.prefix, label: `${s.prefix} — ${s.label}` }))} />
            </Field>

            <Field label="Bill No">
              <Input readOnly value={head.bill_no} className="mono" />
            </Field>

            <Field label="Bill Date">
              <Input type="date" value={head.bill_date}
                onChange={(e) => setHead({ ...head, bill_date: e.target.value })} />
            </Field>

            <Field label="Payment">
              <Segmented value={head.is_credit ? 'credit' : 'cash'}
                onChange={(v) => setHead({ ...head, is_credit: v === 'credit' ? 1 : 0 })}
                options={[{ value: 'cash', label: 'Cash' }, { value: 'credit', label: 'Credit' }]} />
            </Field>
          </div>

          {(bal && bal.side) || head.party_id ? (
            <div className="row" style={{ marginTop: 12, gap: 10 }}>
              {bal && bal.side && (
                <span className={`balance-flag ${bal.cls}`}>
                  Previous balance ₹{bal.text} {bal.side}
                </span>
              )}
              {head.party_id && (
                <button className="btn btn-ghost btn-sm" onClick={() => go('ledger', { partyId: head.party_id })}>
                  <Icon.ledger /> View khata
                </button>
              )}
            </div>
          ) : null}
        </div>
      </div>

      {/* ── Items ──────────────────────────────────────────── */}
      <div className="card" style={{ marginBottom: 14 }}>
        <div className="card-head">
          <span className="card-title">Items</span>
          <span className="hint" style={{ marginLeft: 'auto', marginRight: 8 }}>
            Scan or type a tag / item name — weights fill in automatically
          </span>
          <GridSettingsButton onClick={grid.open} />
        </div>
        {grid.settings}
        <div className="card-body flush">
          <div className="table-wrap" style={{ maxHeight: 330 }}>
            <table className="grid-edit">
              <thead>
                <tr>
                  <th style={{ width: 28 }}></th>
                  {cols.map((c) => (
                    <th key={c.key}
                      style={{
                        width: c.width || undefined,
                        textAlign: c.key === 'tag' || c.key === 'item_name' ? 'left' : 'right',
                      }}>{c.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {computed.items.map((r: any, i: number) => (
                  <tr key={i}>
                    <td className="cell-del"
                      onClick={() => setItems((rs) => (rs.length > 1 ? rs.filter((_, ix) => ix !== i) : [blankItem()]))}>
                      <Icon.close width={13} height={13} />
                    </td>
                    {cols.map((c) => {
                      switch (c.key) {
                        case 'tag': return (
                          <td key={c.key}>
                            <input className="mono" value={r.tag} placeholder="scan"
                              onChange={(e) => setItem(i, { tag: e.target.value })}
                              onKeyDown={async (e) => {
                                if (e.key !== 'Enter') return
                                const found = await window.api.tagStock.findByTag({ tag: (e.target as HTMLInputElement).value })
                                if (found && found.status === 'IN_STOCK') applyTag(i, found)
                              }} />
                          </td>
                        )
                        // Which purchase an untagged line came out of. Blank on a
                        // tagged piece (it already belongs to its purchase) and on
                        // a loose lot (beads never wait for a label).
                        case 'purchase_id': return (
                          <td key={c.key}>
                            {r.tag_stock_id || r.is_loose ? (
                              <input readOnly value={r.tag_stock_id ? 'tagged' : ''} />
                            ) : (
                              <select value={r.purchase_id || ''}
                                onChange={(e) => setItem(i, { purchase_id: e.target.value })}>
                                <option value="">Loose pool</option>
                                {(openPurchases.data || []).map((p: any) => (
                                  <option key={p.id} value={String(p.id)}>
                                    {p.invoice_no} · {wt(p.pending_net)} g left · {p.metal}
                                  </option>
                                ))}
                              </select>
                            )}
                          </td>
                        )
                        case 'item_name': return (
                          <td key={c.key} style={{ position: 'relative' }}>
                            <ItemCell row={r} onPick={(ts) => applyTag(i, ts)}
                              onPickLoose={(it) => applyLoose(i, it)}
                              // Typing over a picked item unpicks it. item_id has
                              // to go with the tag: a stale one left behind still
                              // points at a real piece or lot.
                              onText={(s) => setItem(i, {
                                item_name: s, tag: '', tag_stock_id: null,
                                item_id: null, is_loose: 0,
                              })} />
                          </td>
                        )
                        // Weight changes invalidate the net weight so it re-derives.
                        case 'gross_wt': case 'stone_wt': case 'diamond_wt': return (
                          <NumCell key={c.key} v={r[c.key]} on={(v) => setItem(i, { [c.key]: v, net_wt: '' })} />
                        )
                        // Rate is typed per ten grams; the line keeps per gram.
                        case 'rate_per_gm': return (
                          <Rate10Cell key={c.key} v={r.rate_per_gm}
                            on={(v) => setItem(i, { rate_per_gm: v })} />
                        )
                        // A percentage overrides whatever per-gram making the
                        // tag carried — the two must never both be charged.
                        case 'mkg_pct': return (
                          <NumCell key={c.key} v={r.mkg_pct}
                            on={(v) => setItem(i, { mkg_pct: v, mkg_per_gm: '', mkg_amount: '' })} />
                        )
                        case 'mkg_amount': case 'total_amount': case 'item_total': return (
                          <td key={c.key}>
                            <input className="right" readOnly
                              style={c.key === 'item_total' ? { fontWeight: 600 } : undefined}
                              value={r[c.key] ? money(r[c.key]) : ''} />
                          </td>
                        )
                        default: return (
                          <NumCell key={c.key} v={r[c.key]} on={(v) => setItem(i, { [c.key]: v })} />
                        )
                      }
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* ── Old gold (URD) ─────────────────────────────────── */}
      <div className="card" style={{ marginBottom: 14 }}>
        <div className="card-head">
          <span className="card-title">Old Gold Received (URD)</span>
          {t.urd_amount > 0 && <span className="badge badge-gold">₹{money(t.urd_amount)}</span>}
          <button className="btn btn-ghost btn-sm" style={{ marginLeft: 'auto' }}
            onClick={() => { setShowUrd((v) => !v); if (!urds.length) setUrds([blankUrd()]) }}>
            {showUrd ? 'Hide' : 'Add old gold'}
          </button>
        </div>
        {showUrd && (
          <div className="card-body flush">
            <div className="table-wrap">
              <table className="grid-edit">
                <thead>
                  <tr>
                    <th style={{ width: 28 }}></th>
                    <th style={{ width: 130 }}>Name</th>
                    <th style={{ minWidth: 150 }}>Description</th>
                    <th style={{ width: 84, textAlign: 'right' }}>Gross Wt</th>
                    <th style={{ width: 84, textAlign: 'right' }}>Net Wt</th>
                    <th style={{ width: 76, textAlign: 'right' }}>Purity %</th>
                    <th style={{ width: 88, textAlign: 'right' }}>Rate</th>
                    <th style={{ width: 104, textAlign: 'right' }}>Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {computed.urds.map((u: any, i: number) => (
                    <tr key={i}>
                      <td className="cell-del" onClick={() => setUrds((rs) => rs.filter((_, ix) => ix !== i))}>
                        <Icon.close width={13} height={13} />
                      </td>
                      <td><input value={u.name} onChange={(e) => setUrdRow(i, { name: e.target.value })} /></td>
                      <td><input value={u.description} onChange={(e) => setUrdRow(i, { description: e.target.value })} /></td>
                      <NumCell v={u.gross_wt} on={(v) => setUrdRow(i, { gross_wt: v, net_wt: v })} />
                      <NumCell v={u.net_wt} on={(v) => setUrdRow(i, { net_wt: v })} />
                      <NumCell v={u.purity} on={(v) => setUrdRow(i, { purity: v })} />
                      {/* Fine weight is still what the old gold is priced, stocked
                          and posted to the metal khata on — it is just not shown. */}
                      <NumCell v={u.rate} on={(v) => setUrdRow(i, { rate: v })} />
                      <td><input className="right" readOnly style={{ fontWeight: 600 }}
                        value={u.amount ? money(u.amount) : ''} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* ── Balance Weight (weight-wise bills only) ─────────── */}
      {!!head.weightwise && (
        <div className="card" style={{ marginBottom: 14 }}>
          <div className="card-head">
            <span className="card-title">Balance Weight</span>
            {t.pending_wt > 0 && (
              <span className="badge badge-gold">{wt(t.pending_wt)} g still owed</span>
            )}
          </div>
          <div className="card-body flush">
            <p className="small muted" style={{ padding: '10px 14px 0' }}>
              The metal sold, less the old gold taken in, is owed as fine weight. Enter how
              much of it is being settled in cash now — the rest stays owed as metal and
              shows on the customer's gold khata.
            </p>
            <div className="table-wrap">
              <table className="grid-edit">
                <thead>
                  <tr>
                    <th style={{ width: 90 }}>Metal</th>
                    <th style={{ width: 92, textAlign: 'right' }}>Fine Sold</th>
                    <th style={{ width: 92, textAlign: 'right' }}>Old Gold</th>
                    <th style={{ width: 96, textAlign: 'right' }}>Metal Owed</th>
                    <th style={{ width: 100, textAlign: 'right' }}>Settle Now</th>
                    <th style={{ width: 96, textAlign: 'right' }}>Rate/Gm</th>
                    <th style={{ width: 112, textAlign: 'right' }}>Amount</th>
                    <th style={{ width: 100, textAlign: 'right' }}>Pending Wt</th>
                  </tr>
                </thead>
                <tbody>
                  {computed.metals.map((m: any) => (
                    <tr key={m.metal}>
                      <td><input readOnly value={m.metal} /></td>
                      <td><input className="right" readOnly value={wt(m.fine_sold)} /></td>
                      <td><input className="right" readOnly value={wt(m.fine_urd)} /></td>
                      <td><input className="right" readOnly style={{ fontWeight: 600 }}
                        value={wt(m.fine_wt)} /></td>
                      <NumCell v={metalRow(m.metal).balance_wt ?? ''}
                        on={(v) => setMetalRow(m.metal, { balance_wt: v })} />
                      <NumCell v={metalRow(m.metal).rate_per_gm ?? ''}
                        on={(v) => setMetalRow(m.metal, { rate_per_gm: v })} />
                      <td><input className="right" readOnly style={{ fontWeight: 600 }}
                        value={m.amount ? money(m.amount) : ''} /></td>
                      <td><input className="right" readOnly
                        style={{ fontWeight: 600, color: m.pending_wt > 0 ? 'var(--gold-ink)' : undefined }}
                        value={wt(m.pending_wt)} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {t.pending_wt < 0 && (
              <p className="small" style={{ padding: '8px 14px', color: 'var(--danger)' }}>
                Settling more than is owed. Reduce “Settle Now” to {wt(computed.metals[0]?.fine_wt)} g or less.
              </p>
            )}
          </div>
        </div>
      )}

      {/* ── Payment & totals ───────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 380px', gap: 14, alignItems: 'start' }}>
        <div className="card">
          <div className="card-head"><span className="card-title">Payment & Adjustments</span></div>
          <div className="card-body">
            <div className="form-grid cols-2">
              <Field label="Amount Received (₹)">
                <Input className="right" inputMode="decimal" value={head.amount_received || ''}
                  onChange={(e) => setHead({ ...head, amount_received: e.target.value })} />
              </Field>
              <Field label="Payment Mode"
                hint={splitOn ? 'Set by the largest leg of the split' : undefined}>
                <Select value={head.payment_mode} disabled={splitOn}
                  onChange={(v) => setHead({ ...head, payment_mode: v })}
                  options={PAY_MODES.map((m) => ({ value: m, label: m }))} />
              </Field>

              {/* ── Split payment ───────────────────────────────────
                  Half in UPI and half in cash is an ordinary counter event, and
                  booking the lot against one mode leaves the drawer wrong. The
                  legs must add up to what the bill says was received. */}
              <div className="span-2">
                <label className="row" style={{ gap: 8, alignItems: 'center', cursor: 'pointer' }}>
                  <input type="checkbox" checked={splitOn}
                    onChange={(e) => setPayments(e.target.checked
                      ? [{ mode: head.payment_mode || 'Cash', amount: head.amount_received || '', ref: '' }]
                      : [])} />
                  <span className="small">Split this payment across modes</span>
                </label>
              </div>
              {splitOn && (
                <div className="span-2">
                  <table className="grid-edit">
                    <thead>
                      <tr>
                        <th style={{ width: 28 }}></th>
                        <th style={{ width: 110 }}>Mode</th>
                        <th style={{ width: 110, textAlign: 'right' }}>Amount</th>
                        <th>Reference</th>
                      </tr>
                    </thead>
                    <tbody>
                      {payments.map((p, i) => (
                        <tr key={i}>
                          <td className="cell-del"
                            onClick={() => setPayments((rs) => rs.filter((_, ix) => ix !== i))}>
                            <Icon.close width={13} height={13} />
                          </td>
                          <td>
                            <Select value={p.mode || 'Cash'}
                              onChange={(v) => setPayRow(i, { mode: v })}
                              options={PAY_MODES.map((m) => ({ value: m, label: m }))} />
                          </td>
                          <NumCell v={p.amount} on={(v) => setPayRow(i, { amount: v })} />
                          <td>
                            <input value={p.ref || ''} placeholder="UPI ref / cheque no."
                              onChange={(e) => setPayRow(i, { ref: e.target.value })} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <div className="row" style={{ justifyContent: 'space-between', padding: '8px 2px' }}>
                    <button type="button" className="btn btn-ghost btn-sm"
                      onClick={() => setPayments((rs) => [...rs, { mode: 'Cash', amount: '', ref: '' }])}>
                      Add a mode
                    </button>
                    <span className={`small ${splitDiff === 0 ? 'muted' : 'strong debit'}`}>
                      {splitDiff === 0
                        ? `Tendered ₹${money(splitTotal)} — agrees with the bill`
                        : `Tendered ₹${money(splitTotal)} against ₹${money(num(head.amount_received))} received — ` +
                          `₹${money(Math.abs(splitDiff))} ${splitDiff > 0 ? 'over' : 'short'}`}
                    </span>
                  </div>
                </div>
              )}
              {/* ── Reverse calculation ─────────────────────────────
                  "Make it ₹1,50,000." Weight and rate are already on the line,
                  so the making is the only thing left to move — fit it, and the
                  bill lands on the figure with GST and everything else intact. */}
              <div className="span-2">
                <div className="row" style={{ gap: 8, alignItems: 'flex-end' }}>
                  <Field label="Bill Should Come To (₹)" className="grow"
                    hint="Fits the making so the total lands on this figure">
                    <Input className="right" inputMode="decimal" value={targetAmount}
                      placeholder="e.g. 150000"
                      onChange={(e) => { setTargetAmount(e.target.value); setFitNote('') }} />
                  </Field>
                  <button type="button" className="btn" style={{ marginBottom: 2 }}
                    onClick={fitMakingToTarget} disabled={!(num(targetAmount) > 0)}>
                    <Icon.balance /> Fit Making
                  </button>
                </div>
                {fitNote && <p className="small ok" style={{ margin: '2px 2px 6px' }}>{fitNote}</p>}
              </div>
              <Field label="Bill Discount (₹)">
                <Input className="right" inputMode="decimal" value={head.bill_discount || ''}
                  onChange={(e) => setHead({ ...head, bill_discount: e.target.value })} />
              </Field>
              <Field label="Making Discount (₹)">
                <Input className="right" inputMode="decimal" value={head.making_discount || ''}
                  onChange={(e) => setHead({ ...head, making_discount: e.target.value })} />
              </Field>
              <Field label="Making Discount (%)" hint="Of the making charged; adds to the rupee figure">
                <Input className="right" inputMode="decimal" value={head.making_disc_pct || ''}
                  onChange={(e) => setHead({ ...head, making_disc_pct: e.target.value })} />
              </Field>
              {loyalty?.enabled && (
                <Field label="Redeem Points"
                  hint={`${loyalty.balance} available · ₹${redeemValue} each${redeemPts > 0 ? ` → ₹${money(loyaltyDiscount)} off` : ''}`}>
                  <Input className="right" inputMode="decimal" value={head.loyalty_redeem || ''}
                    onChange={(e) => setHead({ ...head, loyalty_redeem: e.target.value })} />
                </Field>
              )}
              <Field label="Other Charges (₹)">
                <Input className="right" inputMode="decimal" value={head.other_amount || ''}
                  onChange={(e) => setHead({ ...head, other_amount: e.target.value })} />
              </Field>

              {/* ── Gold Saving Scheme ──────────────────────────────
                  Scheme money is a deposit the shop already holds, so it comes
                  off after GST — unlike loyalty points, which discount the bill. */}
              {schemes.length > 0 && (
                <>
                  <Field label="Saving Scheme" className="span-2"
                    hint={gssBal
                      ? gssBal.weighted
                        ? `${gssBal.balance_weight.toFixed(3)} g ${gssBal.metal}${
                            num(head.gss_rate) > 0 ? ` · worth ₹${money(gssBal.redeem_value)}` : ' · enter a rate'}`
                        : `₹${money(gssBal.balance_amount)} available${
                            gssBal.making_disc_pct > 0 ? ` · ${gssBal.making_disc_pct}% making waived` : ''}`
                      : 'Spend a matured scheme on this bill'}>
                    <Select value={head.gss_id || ''} placeholder="No scheme"
                      onChange={(v) => setHead({ ...head, gss_id: v, gss_redeem: '', gss_return: '' })}
                      options={[{ value: '', label: 'No scheme' }].concat(
                        schemes.map((s: any) => ({
                          value: String(s.id),
                          label: `${s.gs_no} — ${s.scheme_name} (${s.scheme_type})`,
                        }))
                      )} />
                  </Field>
                  {head.gss_id && gssBal?.weighted && (
                    <Field label={`${gssBal.metal} Rate (₹/g)`} required
                      hint="Values the grams on the account today">
                      <Input className="right" inputMode="decimal" value={head.gss_rate || ''}
                        onChange={(e) => setHead({ ...head, gss_rate: e.target.value })} />
                    </Field>
                  )}
                  {head.gss_id && (
                    <Field label="Scheme Amount (₹)" hint="Blank spends as much as the bill allows">
                      <Input className="right" inputMode="decimal" value={head.gss_redeem ?? ''}
                        onChange={(e) => setHead({ ...head, gss_redeem: e.target.value })} />
                    </Field>
                  )}
                  {head.gss_id && gssBal && gssBal.redeem_value - t.gss_amount > 0.005 && (
                    <Field label="Return in Cash (₹)" className="span-2"
                      hint={`₹${money(gssBal.redeem_value - t.gss_amount)} would otherwise stay on the account`}>
                      <Input className="right" inputMode="decimal" value={head.gss_return || ''}
                        onChange={(e) => setHead({ ...head, gss_return: e.target.value })} />
                    </Field>
                  )}
                </>
              )}
              <Field label="GST %">
                <Input className="right" inputMode="decimal" value={head.gst_pct}
                  disabled={!!head.gst_not_required}
                  onChange={(e) => setHead({ ...head, gst_pct: e.target.value })} />
              </Field>
              <Field label="Salesman">
                <Input value={head.salesman} onChange={(e) => setHead({ ...head, salesman: e.target.value })} />
              </Field>
              <Field label="Manual Bill No">
                <Input value={head.manual_no} onChange={(e) => setHead({ ...head, manual_no: e.target.value })} />
              </Field>
              <div className="span-2 row wrap" style={{ gap: 16 }}>
                <Check label="GST not required" checked={!!head.gst_not_required}
                  onChange={(b) => setHead({ ...head, gst_not_required: b ? 1 : 0 })} />
                <Check label="Weight-wise bill" checked={!!head.weightwise}
                  onChange={(b) => setHead({ ...head, weightwise: b ? 1 : 0 })} />
              </div>
            </div>
          </div>
        </div>

        <div className="card" style={{ position: 'sticky', top: 0 }}>
          <div className="card-head"><span className="card-title">Bill Summary</span></div>
          <div className="card-body">
            <div className="totals">
              <Row k="Goods Amount" v={money(t.goods_amount)} />
              {t.stone_amount > 0 && <Row k="Stone Amount" v={money(t.stone_amount)} />}
              {t.diamond_amount > 0 && <Row k="Diamond Amount" v={money(t.diamond_amount)} />}
              {t.loyalty_discount > 0 && (
                <Row k={`Loyalty Discount (${redeemPts} pts)`} v={`− ${money(t.loyalty_discount)}`} />
              )}
              <Row k="Making Amount" v={money(t.making_amount)} />
              {t.hallmark_amount > 0 && <Row k="Hallmark" v={money(t.hallmark_amount)} />}
              <Row k="Bill Amount" v={money(t.bill_amount)} cls="sep" />
              {(t.bill_discount > 0 || t.making_discount > 0) &&
                <Row k="Discount" v={`− ${money(t.bill_discount + t.making_discount)}`} />}
              {/* Split on screen the way it is split on the printed bill: a 3%
                  sale is CGST 1.5% and SGST 1.5%, never one 3% line. */}
              {t.gst_amount > 0 && <>
                <Row k={`CGST @ ${halfPct}%`} v={money(t.gst_amount / 2)} />
                <Row k={`SGST @ ${halfPct}%`} v={money(t.gst_amount / 2)} />
              </>}
              {t.other_amount > 0 && <Row k="Other" v={money(t.other_amount)} />}
              {cardPct > 0 && (
                <Row k={`Card Charges (${cardPct}%${splitOn ? ` on ${money(cardSwiped)} swiped` : ''})`}
                  v={money(cardFee)} />
              )}
              <Row k="Total" v={`₹${money(t.total_amount)}`} cls="grand" />
              {t.urd_amount > 0 && <Row k="Less: Old Gold" v={`− ${money(t.urd_amount)}`} cls="credit" />}
              {t.amount_received > 0 && <Row k="Received" v={`− ${money(t.amount_received)}`} cls="credit" />}
              {t.gss_amount > 0 && (
                <Row
                  k={gssBal?.weighted
                    ? `GSS Amount (${(t.gss_amount / num(head.gss_rate)).toFixed(3)} g)`
                    : 'GSS Amount'}
                  v={`− ${money(t.gss_amount)}`} cls="credit" />
              )}
              <Row k="Balance Due" v={`₹${money(t.net_balance)}`} cls="grand debit" />
              {gssReturn > 0 && (
                <Row k="Extra GSS Return" v={`₹${money(gssReturn)}`} cls="credit" />
              )}
            </div>

            <div className="divider" />
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <span className="small muted">Total weight</span>
              <span className="small strong num">{wt(t.total_net_wt)} g net</span>
            </div>
          </div>
        </div>
      </div>

      {/* ── Actions ────────────────────────────────────────── */}
      <div className="sticky-actions">
        {head.id && <span className="badge badge-info">Editing {head.bill_no}</span>}
        <button className="btn" onClick={reset}><Icon.plus /> New Bill</button>
        <span className="spacer" />
        {head.id && (
          <button className="btn btn-danger" onClick={() => setConfirmDel(true)}>
            <Icon.trash /> Delete
          </button>
        )}
        <button className="btn" onClick={whatsapp} title="Send on WhatsApp">
          <Icon.whatsapp /> WhatsApp
        </button>
        <button className="btn" onClick={savePdf}><Icon.download /> PDF</button>
        <button className="btn" onClick={saveOnly} disabled={busy || overSettled}
          title={overSettled ? OVER_SETTLED : undefined}>
          {busy ? <span className="spinner" /> : <Icon.save />} Save
        </button>
        <button className="btn btn-primary" onClick={savePrint} disabled={busy || overSettled}
          title={overSettled ? OVER_SETTLED : undefined}>
          <Icon.print /> Save & Print
        </button>
      </div>

      {confirmDel && (
        <Confirm title="Delete this bill?"
          message="Sold tags will return to stock and all ledger postings will be reversed."
          onConfirm={remove} onCancel={() => setConfirmDel(false)} />
      )}

      {newCust && (
        <QuickCustomer draft={newCust} onClose={() => setNewCust(null)}
          onSaved={async (id, name) => {
            setNewCust(null)
            const p = await window.api.party.read({ id })
            await pickCustomer(p)
          }} />
      )}
    </div>
  )
}

/* ── small pieces ─────────────────────────────────────────── */

function Row({ k, v, cls = '' }: { k: string; v: string; cls?: string }) {
  return (
    <div className={`total-row ${cls}`}>
      <span className="k">{k}</span>
      <span className="v num">{v}</span>
    </div>
  )
}

function NumCell({ v, on }: { v: any; on: (v: string) => void }) {
  return (
    <td>
      <input className="right" inputMode="decimal" value={v ?? ''}
        onChange={(e) => {
          const t = e.target.value
          if (t !== '' && !/^\d*\.?\d*$/.test(t)) return
          on(t)
        }}
        onFocus={(e) => e.target.select()} />
    </td>
  )
}

/** Item name cell with stock-aware type-ahead. */
function ItemCell({ row, onPick, onPickLoose, onText }: {
  row: any; onPick: (ts: any) => void; onPickLoose: (it: any) => void; onText: (s: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [list, setList] = useState<any[]>([])
  const [active, setActive] = useState(0)
  const box = useRef<HTMLDivElement>(null)

  // Two kinds of thing can go on a line: a tagged piece, which is one physical
  // ornament, and a loose item like mani, which is a lot the customer buys a few
  // grams out of. They come from different tables but the shopkeeper types one
  // name, so both are offered in the same list and tagged with `loose`.
  useEffect(() => {
    if (!open) return
    let alive = true
    const t = setTimeout(() => {
      const q = row.item_name || ''
      Promise.all([
        window.api.tagStock.search({ q }).catch(() => []),
        window.api.looseItem.balances({ search: q }).catch(() => []),
      ]).then(([tags, loose]) => {
        if (!alive) return
        setList([
          ...(loose || []).map((it: any) => ({ ...it, loose: true })),
          ...(tags || []),
        ])
        setActive(0)
      })
    }, 160)
    return () => { alive = false; clearTimeout(t) }
  }, [row.item_name, open])

  useEffect(() => {
    const h = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [])

  return (
    <div ref={box} style={{ position: 'relative' }}>
      <input
        value={row.item_name}
        placeholder="Item name…"
        onChange={(e) => { onText(e.target.value); setOpen(true) }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (!open || !list.length) return
          if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(a + 1, list.length - 1)) }
          if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)) }
          if (e.key === 'Enter') {
            e.preventDefault()
            const hit = list[active]
            if (hit) (hit.loose ? onPickLoose : onPick)(hit)
            setOpen(false)
          }
          if (e.key === 'Escape') setOpen(false)
        }}
      />
      {open && list.length > 0 && (
        <div className="ac-list">
          {list.map((ts, i) => (
            <button key={`${ts.loose ? 'L' : 'T'}${ts.id}`} type="button" className="ac-item"
              data-active={i === active} onMouseEnter={() => setActive(i)}
              onClick={() => { (ts.loose ? onPickLoose : onPick)(ts); setOpen(false) }}>
              {ts.loose ? (
                <>
                  <b>{ts.name}</b>
                  <span className="muted"> · {ts.group_name}</span>
                  <span className="badge badge-mute"> loose </span>
                  <span className="muted"> · {wt(ts.balance_wt)}g in stock</span>
                </>
              ) : (
                <>
                  <b>{ts.item_name}</b>
                  <span className="muted"> · {ts.group_name}</span>
                  <span className="mono"> · {ts.tag}</span>
                  <span className="muted"> · {wt(ts.gross_wt)}g gross / {wt(ts.net_wt)}g net · {ts.purity}%</span>
                </>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

/** Minimal inline customer create, so billing never stalls. */
export function QuickCustomer({ draft, onClose, onSaved }: {
  draft: any; onClose: () => void; onSaved: (id: number, name: string) => void
}) {
  const [f, setF] = useState(draft)
  const run = useAction()
  const save = async () => {
    if (!f.name.trim()) return run(async () => { throw new Error('Name is required') })
    const id = await run(
      () => window.api.party.save({
        party_type: 'CUSTOMER', name: f.name, mobile: f.mobile, whatsapp: f.mobile,
        area: f.area, address: f.address, state: 'Maharashtra',
        opening_balance: 0, opening_dr_cr: 'Dr', metals: [],
      }),
      'Customer created'
    )
    if (id) onSaved(Number(id), f.name)
  }
  return (
    <Modal title="New Customer" onClose={onClose}
      footer={<><span className="spacer" /><button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" onClick={save}><Icon.save /> Save & use</button></>}>
      <div className="form-grid cols-2">
        <Field label="Name" required className="span-2">
          <Input autoFocus value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
        </Field>
        <Field label="Mobile"><Input value={f.mobile} inputMode="numeric"
          onChange={(e) => setF({ ...f, mobile: e.target.value })} /></Field>
        <Field label="Area"><Input value={f.area} onChange={(e) => setF({ ...f, area: e.target.value })} /></Field>
        <Field label="Address" className="span-2"><Input value={f.address}
          onChange={(e) => setF({ ...f, address: e.target.value })} /></Field>
      </div>
    </Modal>
  )
}
