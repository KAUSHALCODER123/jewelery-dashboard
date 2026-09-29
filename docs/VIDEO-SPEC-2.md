# Manabh Jewellery ERP v3.0 — spec part 2, from the eight feature videos

Companion to [`VIDEO-SPEC.md`](VIDEO-SPEC.md), which was built from the single 24-minute
overview demo. These eight shorter videos each walk one flow properly, so they expose
screens, tabs, fields and arithmetic the overview skipped entirely.

| # | Video | Length | ID |
|---|---|---|---|
| 1 | Waightwise Jewel | 1:43 | `MbG1X9kKwbo` |
| 2 | Stock Report Jewel | 5:27 | `hWBwODdHRfY` |
| 3 | Purchase Invoice Jewel | 7:53 | `00ImNHZjJP0` |
| 4 | New Order Booking Jewel | 6:03 | `_FKbB8YdaG0` |
| 5 | Item Creation Jewel | 6:06 | `7R4V768CgVU` |
| 6 | GST Report Jewel | 1:56 | `-iL4crxMz5c` |
| 7 | GSS | 4:42 | `O9m8__5oKl0` |
| 8 | Accoutn Master Jewl | 1:22 | `emWP1sEP_T0` |

**Evidence note.** Every field list and number below is read off the video frames.
The auto-generated captions on these videos — both the English translations and the Hindi
originals — are corrupted ASR (the model hallucinated "सब्सक्राइब करें" over the
background music) and were **not** used as a source. Do not trust them if you re-check
this work; sample frames instead.

---

## 1. Weightwise billing and the Balance Weight tab

The `Weightwise` checkbox on the Sales Invoice header is not cosmetic — it switches the
bill into **metal-basis trading** and adds a third tab beside `Sales Invoice` and
`URD Purchase`:

```
Sales Invoice | URD Purchase | Balance Weight
```

It also adds a `Design` column to the sales line grid.

### Balance Weight grid

`Item Type | QTY | GrossWt | NetWt | Purity | FinWt | Fin+Wast | Balance Wt | Rate/Gm | Amount | PendingWt | SGST1P5Amount | CGST1P5Amount`

One row per metal type (Gold, Silver, …), aggregating the whole bill.

### Worked example from the video

```
Sales line : Ring   QTY 3   GrossWt 15.000   purity 100.00   NetWt 15.000
URD line   : Old Gold  Gross 6  Net 6  Pur.Purity 100  Final.WT 6.000

Balance Weight row (Gold):
  GrossWt 9.000   NetWt 9.000   Purity 100.00   FinWt 9.000   Fin+Wast 9
```

So **`FinWt` on this tab = fine sold − fine taken in as old gold** (15 − 6 = 9). This is
the net metal the customer owes.

The operator then types into `Balance Wt` how much of that 9 g is being **settled now**:

| Balance Wt entered | Rate/Gm | Amount | PendingWt | Bill Amount | GST | Net Balance |
|---|---|---|---|---|---|---|
| `5` | 5000 | 25,000.00 | **4.000** | 25000.00 | 750.00 | 25750.00 |
| `9` | 5000 | 45,000.00 | **0.000** | 45000.00 | 1350.00 | 46350.00 |

- `Amount = Balance Wt × Rate/Gm`
- `PendingWt = FinWt − Balance Wt`
- GST is charged on `Amount` only (1.5 % SGST + 1.5 % CGST shown per row)

`PendingWt` is a **metal receivable carried against the customer** — the customer has paid
rupees for 5 g and still owes 4 g of fine gold. It is not a money balance and must not be
collapsed into one.

### Why this matters downstream

This is what the following existing UI hangs off, all of which we currently have no data
to populate:

- `Show Pending Weight` checkbox on the Book Display / Debtors screen
- `Debitors List (Weight)` and `Creditors List (weight)` in the Ledgers menu
- the `Weight Details` grid (metal + Credit/Debit) on Customer and Supplier masters

### Our status — built

`sale.weightwise` now drives a **Balance Weight** card on the Sales Invoice, backed by a
`sale_metal` row per metal. The money side comes from the settlement instead of the line
rate; the old gold is netted in fine weight and is *not* also deducted in rupees; and the
unsettled `pending_wt` posts to `metal_entry`, so it shows on the customer's gold khata
rather than being folded into the money balance.

One decision the video could not settle: making charges are **added on top in cash**, not
converted to metal. The demo left making at zero, so both readings fitted; labour is
charged in rupees regardless of how the metal is settled, and with making at zero this
reproduces the demo's numbers exactly (25,000 / 750 / 25,750 and 45,000 with 4.000 g
pending). Covered by `test/weightwise.cjs`.

---

## 2. Account cum Stock Display — one statement, money *and* metal

A tab present on **Sales Invoice**, **Purchase Invoice** and **Refinery**. Filters:
`Party Name`, `Item Type` (e.g. `IT0001 : Gold`), date range. Buttons:
`Show | Export | Print | Cancel | Close | H | GS`.

### Grid

`Bill No | Date | Transaction | FinWt | Mkg | Wastage | WstgAmt | Rate | Amount | Rece Amt | In/Out | Bal Amt | Bal Wt`

### Worked example (supplier "Sangam Gold", metal = Gold)

```
Bill No  Date        Transaction            FinWt  Mkg  Wastage  Rate  Amount   Rece Amt  In/Out  Bal Amt      Bal Wt
   0                 OPENING STOCK          -100                                                  20000 Cr    100.000 Cr
  MI1    01/May/2022 Material In             200    4                          0          IN                   204 Cr
  MI2    01/May/2022 Material In              20             5000  103000      50000      IN       53000         20 Cr
  MO1    01/May/2022 Material Out            150                               0          OUT                   150 Dr
  SO1    01/May/2022 Stock Cash Settlement   100                     500000               OUT      500000       100 Dr
  VP1    01/May/2022 Voucher Payment                                  30000    0          OUT       30000
   c                 CLOSING STOCK            30                     573000    50000              543000 Cr    74.000 Cr
```

Two running balances side by side: **`Bal Amt` in rupees and `Bal Wt` in fine grams**,
each carrying its own Dr/Cr. Every document type posts into the same statement —
purchases, purchase returns, cash settlements and payment vouchers.

The party header echoes both live:

```
Cr 20000.00        Gold : 100 Cr   Stone : 0   Silver : 0   Platinum : 0
```

### Our status — built

**Ledger → Money + Gold** (`reports.accountCumStock`). The money and metal ledgers are
merged **by document**, so a bill that moves both appears as one row rather than as two
unrelated lines in two screens, with `Amount` / `Received` / `Fine Wt` / `In-Out` and a
running `Balance ₹` and `Balance g` each carrying its own Dr/Cr.

Opening balances fold in both sides (`party.opening_balance` and `party_metal_opening`),
and a `from` date rolls everything before it into the opening row. Covered by
`test/acstock.cjs`, which asserts the two closing balances independently reconcile with
`party.balance` and `party.metalBalance`.

Still missing versus the original: the `Mkg`, `Wastage` and `WstgAmt` columns (we do not
carry per-document making/wastage on the party statement), and the ability to pick a metal
other than Gold — see the note in §14.

---

## 3. Stock Cash Settlement

Sixth tab on the Purchase Invoice. This is the bridge that lets a metal balance be closed
out in rupees (or the reverse) — without it, a `Bal Wt` can never be settled.

Header: `Supplier Name` (+ `A` `N` `P`), `Manual No`, `InvoiceNo` (own series, `SO1`),
`Transaction Flow` (**In / Out**), `Cash`/`Credit` radios, `State`, `Date`,
`GST Not Required`.

Grid: `ItemGroup | ItemType | GrossWeight | NetWeight | Purity | FinWt | Rate/Gm | Making/Gm | Making Amt | Amount`

Totals: `GST`, `GST Amount`, `Bill Amount`, `Paid Amount`.

Worked row from the video: `24K Gold | Gold | 100 | 100 | 100 | 100.000 | 5000 | | 0.00 | 500000.00`
— 100 g of fine gold settled at ₹5000/g = ₹5,00,000, posting as `SO1 … OUT` in the
Account cum Stock Display above.

### Our status — built

**Receipts & Payments → Metal Settlement** (`stockSettlement`, series `SO`). Picking a
party pre-fills the direction and weight from their outstanding gold balance, so the
common case — closing out exactly what is owed — is one click.

Metal moves one way and money the other: `OUT` posts `fine_out` and credits the party
(we now owe rupees instead of metal); `IN` posts `fine_in` and debits them. The video's
case reproduces — a supplier owed 100 g Cr, settled at ₹5,000/g, ends with 0 g and
₹5,00,000 Cr. Covered by `test/acstock.cjs` §7–9.

**Simplifications against the original.** The original's grid takes several item-group
lines per settlement; ours is one metal at one rate, which covers closing out a balance.
And it settles the *account* only — physical stock is untouched, because the metal itself
already moved on its own purchase / sale / refining document. If that reading is wrong,
the fix is a `loose_stock` posting in `stockSettlement.save`.

---

## 4. Returns are first-class documents

### Purchase Return

Its own screen, own series (`Invoice Prefix MO`, `Invoice No MO1`, `MO2`), reached from
the Purchase area.

Header: `Supplier Name` (V N P), `Remark`, `Cash`/`Credit`, `Invoice No`, `Invoice Prefix`,
`Invoice Date`, `Manual No`, `State`, `GST Not Required`, `Download URD Item`.

Grid: `Tag | ItemName | QTY | Gross Wt | Black.B | StoneWt | Net Wt | Purity | FinWt | RatePerGn | Amount | Gross+Wast`

Totals: `GST | MGST | TDS | Net Balance` and `Bill Amount | Discount | Sub Tax | Paid Amount`

It posts into the party statement as **`Material Out`**.

### Sales Return

Not demoed directly, but confirmed to exist by two independent sightings:
- `Total Sales Return` and `Total Purchase Return` rows in the Day Book
- `Sales Return Book` and `Purchase Return Book` in the Ledgers menu

### Our status — engine built, screen not yet

`saleReturn` / `purchaseReturn` (series `SR` / `PR`), exposed over IPC and covered by
`test/returns.cjs`. A return is a **new dated document**, never an edit or a deletion:
the original bill stays exactly as printed, and stock, money and metal all reverse on the
day the goods actually came back. A returned tagged piece goes back to `IN_STOCK`; undoing
the return puts it back to `SOLD`. Day Book gained `sales_return` and `purchase_return`
totals, which the video has and we were missing.

The prefixes differ from the original by necessity: it uses `MO` for purchase return, but
`MO` is already the refinery-out series here.

Both documents have a screen: **Returns** in the sidebar, with a Sales / Purchase toggle.
Picking the original bill in the modal pulls its lines straight in, so nothing is retyped;
leaving it blank allows a hand-entered return.

---

## 5. Ledgers menu — the full accounting suite

Complete contents, read off the open menu:

```
Account Display                    Ctrl+F9
Debitors | Creditors List (Rs)
Debitors  List (Weight)
Creditors List (weight)
Journal Report
─────────────────────────────
GST R1 Report (Sales)
GST R1 By HSNCode
GST R2 By HSNCode
GST R2
GST R3B Report
TCS Report
─────────────────────────────
TDS Report
Day Book                           Ctrl+F10
Cash Book
Sales Book                         Ctrl+F11
Sales Return Book
Purchase Book
Purchase Return Book
Journal Book
─────────────────────────────
Trial Balance
Trading And PL Account
Balance Sheet
```

So the original is a genuine double-entry system that closes into a Trial Balance, a
Trading & P&L account and a Balance Sheet.

### Our status

We have Account Display (Ledger), Day Book, and — as of gap #7 — the three closing
statements: **Trial Balance, Trading & P&L, and Balance Sheet** (Reports → Accounting
Books; `reports.trialBalance` / `profitAndLoss` / `balanceSheet`).

The original is genuine double-entry. **Ours is not** — this app keeps a single-entry
money ledger, where only cash/bank, the scheme liability, the expense heads (via
vouchers) and the parties get real `ledger_entry` rows; the income and direct-cost heads
(Sales, Purchase, Old Gold, GST) exist only as the *particulars* text on the party's leg.
So the books are **derived** in `computeBooks()` from the source documents that generated
those legs. Every rupee a document moved has a home on both sides, so the Trial Balance
foots and the Balance Sheet balances; whatever is genuinely un-booked (proprietor's
capital carried forward) is shown as an explicit balancing line. Two known simplifications:
closing stock is valued at cost from *current* inventory (exact for a period ending today,
approximate for history), and metal is excluded by design (gold has its own weight
statement). Verified by `test/books.cjs` (foots + balances) and `test/flows.cjs`
(both agree on screen with live data).

Still **not built**: cash book, the four day-books, journal, weight-based debtor/creditor
lists, R2/R3B/HSN GST variants, and the TCS/TDS reports. `reports.gstRegister` (R1) exists
in `electron/api.cjs` with no screen.

---

## 6. GST R1 (B2B) register

`Type` (Sales) · TAX checkboxes (`SGST1P5`, `CGST1P5`) · `From` / `To`
Buttons: `Show | Export | Clear | Print | Close | Menubar`, plus Gmail and WhatsApp icons.

Grid: `date | InvoiceNo | Transaction | Party Name | GST Amt | Taxable Value | Invoice Value | GSTN/UIN | Place Of Supply | E-CommerceGSTIN | CessAmont | Rate | Reverse Charge | Invoice Type | ManualNo | PanCardNo | Qty | Netwt | CardAmt | ChequeAmt | NEFTAmt | CashAmt | RateAmt | Grosswgt | MkgGm | MkgAmt`
(columns beyond `Place Of Supply` are toggled on via Grid Setting)

Totals row across GST Amt / Taxable Value / Invoice Value.

**Export dialog is universal across the app:** `Word | Excel | Tabular PDF | NonTabular PDF`,
a `Browse` location picker and a filename prompt.

---

## 7. Item Master → Opening Stock — the costing sheet

`VIDEO-SPEC.md` recorded the `Create Item` tab only. The **Opening Stock** tab is a much
larger per-piece sheet:

**Left column**
`L00001` (auto loose code) · `Item Name` (V lookup) · `Gross Weight` · `Net Weight` ·
`Black Beets` · `Stone` · **`Diamond`** · **`Bag Wt`** · `Purity` · `Final Weight` · `Qty` ·
**`Size`** · `Making Gram` (dropdown) · **`Making Discount %`** · **`Total Bag Wt`**

**Right column**
**`Stone Rate`** · **`Diamond Rate`** · **`Fix Rate`** · **`Purchase Rate`** ·
**`Reorder`** · `HUID` · `HallM_Charges` · `HSN Code` · `Description` · **`Category`** ·
**`Salesman`** · **`Location`** (`Shop`, + `N` to add) · **`Shelf Tray`**

Worked: `Gross 200 → Net 200.000, Purity 91.6 → Final Weight 183.200` ✓

### `Purchase Rate` is the keystone

It is the per-piece cost. Without it there is no Profit Report, no Purity Profit Report and
no stock valuation — which is exactly why our MIS menu can't be built today.

### Diamond is a first-class rated component

`DiamondWt`, `DiamondRate`, `DiamondAmt` appear in the Grid Setting column list of the
Barcode grid, the Loose And Tag Stock Report and the karagir Receive grid. Stone likewise
has `StoneRate` / `StoneAmt`.

**Built (gap #11):** the sales bill and the tag grid now carry `stone_rate`, `diamond_wt`
and `diamond_rate`. Stones and diamonds are taken OUT of the metal weight (they are not
gold, so the fine-weight khata never counts them) and charged in their own right —
`stone_amount = stone_wt × stone_rate`, `diamond_amount = diamond_wt × diamond_rate` — as
part of goods, so GST applies. A plain gold piece, with both rates at 0, is priced exactly
as before. A tagged piece stores its rates and the bill picks them up on scan. Verified by
`test/rated.cjs`. Still absent: `DiamondAmt`/`StoneAmt` as columns on the *stock report*
(the values exist per line; the report shows metal cost only).

### Item Category Master (design master)

Opened from the `N` beside `Design`:
`Design Name` (V) · `Item Name` (A) · `Description` · **`Reorder`** (unit dropdown `Q`/… + value)

So reorder level is set per design as well as per piece.

---

## 8. Barcode Creation — the parts we missed

Confirmed tabs: `Multiple Barcode Opening Stock` | `Stock Transfer Loose to Barcode` | `Barcode Printing`

### Barcode Printing tab

`Select Type` · `Select` (item) · `Show` · **`Option: Not Printed Only`** ·
**`StockPrint`** checkbox · `Select All` · `From` / `To` ·
grid `Check | Tag | Item Name | Gr. Wt. | Qty | Net Wt. | Purity | Fn. Wt. | MakingPercent` ·
`Format` (`Format1`…) · **`No. of Print`** · `Print | Cancel | Close | Export | GS`

"Not Printed Only" — reprint protection, so a tag isn't labelled twice.

### Grid Setting is a universal pattern — built

Every grid in the application has a `GS` button opening a column chooser:
`Name | H.Text | H.Width | Visible` with `Set Default` / `Reset` and up/down reorder arrows.
It appears on the Barcode grid, Sales Invoice grid, Stock Report, GST R1, Check Tag Item —
everywhere. Treat it as a shared component, not a per-screen feature.

**Built** as `src/lib/grid.tsx`: a grid declares its columns once, calls `useGridCols(key,
cols)`, and gets the `Columns` button, the chooser (`Name | H.Text | H.Width | Visible`
with up/down arrows and *Reset to Default*), and the persisted layout. Wired into the
**billing grid**, the **tag entry grid** and the **stock report**.

The preference is *reconciled* with the code's columns on every read: a saved column the
code has dropped is discarded, and a column added since the preference was saved is
appended rather than silently missing — otherwise shipping a new column would hide it from
everyone who had ever opened the chooser. Columns a grid cannot work without (the tag, the
item) are offered but not hideable.

**`Not Printed Only`** is on the tagged-stock list. A label is marked printed *after* the
print dialog returns, not when it opens — marking on open would empty the filter for a sheet
the user cancelled, which is the one thing the filter exists to prevent. The copy count
accumulates across reprints, and a jammed run can be un-marked.

---

## 9. Stock reporting

### Loose And Tag Item Stock Report

`Select Type`: `Item Name` | `Tag` | `Item Type` | **`Item Name Total`** (summary mode)
`Format`: `Loose And Tag` | `Tag` | `Loose`
plus `Show All Items`, `Select Details` (filter by group/item), a `Per` field,
`Don't Show URD Item`.

Buttons: `Show | Print | Export | Cancel | Close | Filter | GS |` **`Update`** `|` **`Save`**
— the grid is **editable in place** and saved back.

In `Item Name Total` mode rows collapse to one per item with a weighted purity
(e.g. Ring 305.800 gross / 302.610 fine → purity shown as 99.022).

**Built.** `Item Name Total` is the `Item Name Total` option in the group-by picker; the
weighted purity is derived as `fine ÷ net × 100` — *net*, not gross, because fine weight is
a percentage of net, which is also why the demo's 302.610 against 305.800 gross reads as
99.022 rather than 98.957. Averaging the per-piece percentages was rejected: it would let a
1 g scrap ring count as much as a 50 g chain. `StoneAmt` and `DiamondAmt` are on both the
detail and summary grids.

**`Update` / `Save`** — the detail grid becomes editable with *Edit Stock*. Gross, stone,
purity, cost and location are typed in place; net and fine are **recomputed by the engine**
rather than accepted from the grid, and the metal inflow booked when the tag was made is
re-posted so the stock position moves with the correction. Only pieces still `IN_STOCK` may
be edited — a sold piece's weights are already priced on a bill, so rewriting them here
would leave the invoice and the stock silently disagreeing. The whole save is one
transaction, so a refused row takes the rest of the batch back with it.
Verified by `test/stockedit.cjs` and `test/flows.cjs` §9d (which drives the real grid).

### Master Report

Tabs: `Master Item Report` | `Party Master Report` | **`Wastage Master Report`** |
**`Making Master Report`**

This confirms a **Making Master** and a **Wastage Master** exist (default making and
wastage rates per item / group), matching `Making Master` in the Master menu.

**Built** as **Settings → Making & Wastage**. A rule is set against an item or an item
group; the item's own rule wins over its group's, and the resolver reports *which* rule it
used so a surprising number can be traced. Making carries both a per-gram rate and a flat
per-piece charge; wastage is a single percentage, capped at 100%.

The one design decision worth recording: **defaults are read by the forms, never applied on
save.** A making charge of zero is a real answer — shops do give making free — so an engine
that substituted a master value for a nil would be unable to tell "not entered" from
"deliberately none", and would quietly rewrite bills. The tag grid, the bill line and the
purchase line each seed their field and show the number; what the user leaves there is what
is stored. A tagged piece's own making rate always wins over the master, since it was set
when the piece was priced; the master only fills in where the tag has none.

Verified by `test/ratemaster.cjs` (32 assertions) and `test/flows.cjs` §12b, which creates a
rule through the Settings screen and then watches it seed the real tag grid.

### Day Book — richer than recorded

Right panel `Cash And Bank Accounts` carries, per metal (Gold, Platinum, Silver, Stone),
**three** opening/closing pairs:

```
Gold :-      Opening    Closing
  Gross Wt   492.100    540.300
  Net Wt     492.100    540.100
  Final Wt   467.564    517.412
```

then `URD Stock Details`, then **multiple bank accounts** (`Cash Account`, `SBI Bank`, …),
then `Today Received Details :` Cash / NEFT-RTGS / UPI / Card.

Below the summary, expandable **Sales** and **Purchase** sections list every document:
`Date | Invoice No | Cash/Credit | Particulars | ItemName | Amount | Grosswt | NetWeight | Rate | Making | Advance | Balances | NEFT/Cheque | GSTAmt | CashAmt`

**Built.** The right-hand panel now carries, per metal, the three opening/closing pairs the
original shows — `Gross Wt`, `Net Wt`, `Final Wt` — then the same block for URD stock, then
**every** cash and bank account with its own opening and closing, then `Today Received
Details` split by payment mode across both bills and receipt vouchers.

Showing all three weights is not decoration. Gross is what is physically on the shelf, net
is that less stones, fine is the pure metal in it. A shop counting its trays counts **gross**,
so a book reporting only fine could never be reconciled against the count it is meant to
check. The single `stock.gold_*` fine pair is still returned unchanged, so anything already
reading it keeps working.

Widening this exposed a real inconsistency and fixed it: a sale treated every payment mode
except the literal word `Bank` as cash, so **card takings landed in the drawer while the
swipe fee they generated came out of the bank**. Vouchers and scheme receipts had always
routed correctly. All four now share one `moneyAccountFor` helper — only physical cash goes
in the drawer; card, UPI, NEFT and cheque settle into the bank. Per-account balances are
only meaningful if that holds.

Verified by `test/daybook.cjs` (39 assertions) and `test/flows.cjs`, which reads the panel
off the real screen.

---

## 10. New Order Booking — the full karagir pipeline

Six tabs:

```
New Order Booking | Sumbit Order to Karagir | Issue Material to Karagir |
Receive Order from Karagir | New Order Sales Invoice | New Order Report
```

### 10.1 New Order Booking

Header: `Customer Name` (V, h) · `Address` · `Ph.No` · `Area` · `Remark` ·
`Bill Type` (`N`) · `Bill No` (`N3`) · `Bill Date` · **`Delivery Date`** ·
`Manual No` · `State` · `Weightwise` · `GST Not Required`

Sub-tabs: **`New Order`** and **`URD Purchase`** — old gold can be taken **at booking
time**, before anything is made.

Order grid: `Tag | Item.Name | GrossWt | Black.Beats | StoneWt | NetWt | Purity | FinWt | Mkg/Gm | MkgAmt | HallM.Charges | Rate/Gm | Amount | HallM.Amt | Picture | HUID | Wastage% | WastagePerGram | GrossPlusWast | Net+Wast |` **`SubOrderNo`** `| SGST1P5Amount | CGST1P5Amount`

Payment block: `Cheque No | Cheque Date | Details | Amount in Cash | Payment Type (Cheque/DD/NEFT-RTGS/UPIPayment) | Cheque Amount | Bank Name`
Totals: `Tax | Sub Tax | Bank Amt |` **`Advance Amt`** `| Other Amt | Amount | Bill Discount | Total Discount |` **`URD Amount`** `| Cash Amount |` **`Balance Amount`**

Worked: order ₹54,590 (incl. ₹1,590 tax) − ₹10,800 URD = ₹43,790 balance; then ₹20,000
cash advance → ₹34,590.

### 10.2 Sub-orders

`SubOrderNo` splits one customer order into `N4/1`, `N4/2`, … Each sub-order is submitted
to a karagir independently.

### 10.3 Sumbit Order to Karagir

`Customer Name` (V P) · **`Karagir Name`** (V) · `Address` · `Ph.No` · `Remark` ·
`Bill No` · `Bill Date` · **`Delivery Date`**

The karagir's delivery date is **separate from the customer's** — in the video the customer
is promised 31/May while the karagir is due 16/May.

Grid: `Tag | Item Name | Description | Qty | GrsWt | Black.B | StoneWt | Netwt | Purity | Finwt | Rate | Amount | Picture | SubOrderNo`
Hint: `Press F3 To Clear Current Row`. Footer: `Total Amount`, `Payment Detail`.

### 10.4 Issue Material to Karagir

Grid: `Tag | Item Name | Description | Qty | GrsWt |` **`Less`** `| Netwt | Purity | Finwt | Rate | Amount |` **`Wastage%`** `|` **`Wastage/GM`**

This is the metal handed over — the debit side of karagir accountability.

### 10.5 Receive Order from Karagir

`Receive Date`. Grid: `Tag | Item Name | Qty | GrsWt | Less | Black.B | StoneWt |` **`DiamondWt`** `| Netwt | Purity | Final.wt | Rate/Gm | Wastage% | Wastage/GM | Amt`

Labelled block: `* Below payment details are for Karagir` —
`By Cash | Payment Type | By Cheque | Bank Name | Cheque No | Cheque Date | Details`
Totals: `Total Amount | Discount |` **`TDS`** `|` **`Final Amount | Paid Amount | Pending Amount`**

`Pending Amount` is the karagir payable. Issue vs receive is where wastage is reconciled.

### 10.6 New Order Sales Invoice

A full invoice carrying the order across: `Select Prefix (COM) | Bill No | Bill Date |
Salesman | State | Manual No | Weightwise`, sub-tabs `Wholesale Sales` / `URD Purchase`.

Totals include `Bill Amount | Bill Discount | Total Discount | URD Amt |` **`Amount Given`**
(the advance) `| Sub Tax | GST | GST+BillAmount | Amt Received | Net Balance |`
**`Loyalty Point`** `|` **`Loyalty Discount`** (checkbox) `| Making - Discount | URD BillNo | Manual Urd Amt`

**Loyalty is a real earn-and-redeem flow** — points display on the bill and a checkbox
converts them into a discount.

### 10.7 New Order Report

`From Date` / `To Date` · status filter (`Pending`) · party-type filter (`Customer`) ·
search box · `Show | Cancle | Close | Print | Export` ·
checkbox **`Show Previous Year Order`**

Grid: `SrNo | Date | Customer Name |` **`Delivery_Date`** `|` **`Remaning Days`** `| Order No | SubOrderNo |` **`Submit To Karagir`** `|` **`Receive`** `|` **`Sales Status`**

Status values render in red when pending. One row per sub-order.

### Our status — engine built, screen not yet

`karagir.issue` / `karagir.receive` / `karagir.ledger` (series `KI` / `KR`) plus
`reports.orderTracking`, covered by `test/karagir.cjs`.

The reconciliation that matters is there:

```
shortfall = fine issued − fine received − wastage allowed
```

Issuing metal debits the goldsmith's `metal_entry` and takes the weight out of shop stock;
receiving relieves him of what came back **plus the agreed wastage**, so anything still
standing on his ledger is metal he has not accounted for. Labour posts as money owed, with
discount, TDS and a pending amount. `sub_order_no` is carried on both documents.

`reports.orderTracking` gives the counter view: customer, karagir, delivery date,
`remaining_days` and an `overdue` flag, with fine issued / received / outstanding per order.

The screen is **Orders → Karagir Job Work**: pick a goldsmith and see issued / received /
wastage / still-with-karagir / labour-pending as tiles, the two document lists below, and
an order tracking table with days-left and overdue highlighting.

**Built (gap #10):** the order now carries a **Karagir Date** separate from the customer's
Delivery Date — tracking shows each order's karagir days-left and flags a piece *karagir-
overdue* before the customer's own promise is at risk. **Old gold at booking** is captured
on an order grid; it pays the balance down like a second advance, posts to the customer's
gold khata immediately (held under the `ORDER` doc, not the money ledger), and carries onto
the invoice on conversion with the metal reversed-and-reposted so nothing double-counts.
Verified by `test/orderbooking.cjs`.

---

## 11. Gold Saving Scheme — four scheme types and a redemption invoice

### Create scheme

`Scheme Code` (GSS1) · `Scheme Name` ·
**`Scheme Type`: `On Amount` | `On Weight` | `On Making` | `Weight Wise`** ·
**`Scheme Type(D/M/Y)`: `Days` | `Months` | `Years`** ·
`Total Scheme Months` (label follows the D/M/Y choice — becomes `Total Scheme Days`) ·
`Customer's Months` · `Maturity Months` · `Customer's Monthly Amount(Rs)` · `Maturity Amount(Rs)`

Worked: Total 3, Customer's 2, Maturity 1.

### Assign scheme to customer

`G.S. No` · `Manual No` · `Customer Name` (V N) · `Scheme Name` (V) · `Start Date` ·
`Maturity Date` · `Scheme Duration` = `Months` + **`Interest Months`** ·
`Monthly Amount` · `Benifit After Maturity` · `Remarks` · `Close GSS` ·
link **`Print Account Statement`**

Displays `Total Benifit : 1 X 1000.00 = 1000.00` and `Amount After Maturity : 1400.00`.

**Receipts Structure grid: `No | Date |` `Amount` *and* `Weight`** — weight-based schemes
accrue grams, not rupees.

### GSS Receipt

`G.S. No` · `G.S. Receipt No` · `Receipt Date` · `Receipt Amount` · `Payment Type` ·
`Cheque Amt` · `Bank Name` · `Cheque No`, with a `Recent Receipts` grid carrying
`Pending` / `Interest` statuses per instalment. Buttons include `PrintGS` and WhatsApp.

### Gold Saving Sales Invoice (Shift+F7) — the redemption bill

A dedicated invoice for spending a matured scheme. Header shows the customer's running
balance (`36590.00 Dr`). Sub-tabs `Wholesale Sales` / `URD Purchase`.

Dedicated block **`Gold Saving Scheme details`**:
`On Amount : In Months : In Months` · `Amount Given by Cust` (4000.00) · `Benefit Amount` (2000.00)

Totals: `Bill Amount | OldPurchaseAmt |` **`GSS Amount`** `| GST | Other | Amt Received |
GST+BillAmount |` **`Extra GSS Return Amt`** `| URD BillNo | Manual URD Amt | Net Balance`

Worked: bill 52,000 + GST 1,560 = 53,560 − GSS 6,000 = **47,560** net.

### Gold Scheme menu (complete)

```
Create Gold Saving Scheme
Assign Scheme To Customer        Shift+F5
Receive Scheme Amount            Shift+F6
Gold Saving Sales Invoice        Shift+F7
─────────────────────────────
Scheme Master Report
Scheme Allocated Report
Scheme Amount Pending Report
Scheme Amount Received Report
Scheme Sales Report
Scheme Sales Report(BillWise)
Scheme Detail Report
Scheme Short Report
GSS Pending Report
Merging of Gold Saving Scheme
```

### Our status

**Built.** All four scheme types, with `Days` / `Months` / `Years` periods:

| Type | Fixed each period | Balance accrues in | Shop's benefit |
|---|---|---|---|
| `On Amount` | rupees | rupees | rupees at maturity |
| `On Making` | rupees | rupees | a making-charge waiver % |
| `On Weight` | rupees | **grams**, at the rate on the day paid | grams |
| `Weight Wise` | **grams** | grams | grams |

The receipts grid carries both `Amount` and `Weight`, and a weight scheme asks for the
metal rate on each receipt so the conversion stays auditable after the rate moves.

**Redemption** is on the ordinary sales invoice rather than a separate Shift+F7 screen:
pick the customer's scheme, and the balance settles the bill. Two things can come off,
and they land in different places — an `On Making` waiver is a *discount*, so it goes in
before GST, while the scheme balance is money the shop already holds as a liability, so it
settles the bill *after* GST. The spec's worked example holds: 52,000 + 1,560 GST = 53,560,
less a 6,000 scheme balance = **47,560** net. Any leftover stays on the account for next
time, or can be handed back as `Extra GSS Return Amt` in cash.

Balances are **derived** from the received instalments less what bills have spent, so
undoing a receipt, editing a bill or deleting one self-corrects with nothing to reverse.
The shop's maturity benefit is only counted once every paying instalment is in *and* the
maturity date has passed — a member who stops halfway gets back what they put in.

Verified by `test/gssweight.cjs` (76 assertions).

**Merging** — Members → *Merge Cards*. The received instalments MOVE to the surviving
card rather than being summed into a total: they are the evidence of what was paid and
when, and a weight scheme's gram balance depends on the rate recorded on each one. Unpaid
rows belong to the closed card's own schedule and are dropped. A merge is refused across
customers, across scheme types or metals, and for an account a bill has already spent from.

**The ten scheme reports** are `reports.schemeReport({kind})` — master, allocated, pending,
received and scheme sales — surfaced as **MIS & Scheme Reports → Gold Scheme Reports**. They
are one call with a `kind` rather than ten near-identical queries, so a change to how a
balance is derived cannot fix one report and miss another.

---

## 12. Account Master and how expenses actually work

`Account Code` (auto, 108, 109, 110…) · `Account Name` (V) · `Account Type` ·
`Account Group` · `Opening Balance` + `Debit`/`Credit`

When `Account Group = Bank Accounts`, an extra block appears:

```
Card Charges   [ ] Card Swap Account
   For Customer in %  [    ]
   For Us in %        [    ]
```

— card-swipe fee handling, split between what's passed to the customer and what the shop
absorbs.

**Built.** Tick `Card swap account` on an account whose group is `Bank Accounts` and set the
two percentages. On a bill paid by `Card`, the fee is charged on what actually goes through
the terminal — and on a credit bill with nothing received, nothing has, so there is no fee;
billing one would charge the customer for a card they never presented. the customer's share is **added to the bill after GST** (it is a bank fee, not
consideration for the goods, so it must not inflate the taxable value), and the shop's share
posts to a dedicated `Card Charges` expense head so the cost of taking cards is visible in
the P&L rather than buried in sundries. Only one account can be the card account — otherwise
a bill would have to guess which rate applied.

Observed values: `Account Type` = `Assets`, `Expense`, … ; `Account Group` = `Bank Accounts`, …
Examples created in the video: `SBI Bank` (Assets / Bank Accounts / 2500 Debit) and
`Tea Exp` (Expense).

### The expense pattern — important

**There is no expense-entry screen.** An expense head is created here as an
`Account Type = Expense` account, and money is spent against it with a **Voucher Payment**
(the `Payment` tab, series `VP1`, with `Debit Account`, `Amount`, `Payment Type`,
`Bank Name`, `No`, `Date`, and a **`DD Comission`** field). It then flows into Cash Book,
Day Book and the Trading & P&L account automatically.

The corrupted Hindi captions for this video are mostly noise, but two fragments survive
and corroborate the frames: `कस्टमर सप्लायर खैरागढ अकाउंट` (customer / supplier / karagir
accounts) and `लाइट बिल पे क्लिक करके` (clicking on *electricity bill*).

### Our status — built

Settings → Accounts is writable (owner only), and a Payment voucher can be raised against
an expense head instead of a party: **Receipts & Payments → Payments → an expense head**.
The voucher posts a debit to the head and a credit to cash, so it reaches the cash book and
the day book exactly as the original does.

The unused `expense` table has been dropped — it modelled expenses outside the ledger, so
nothing posted to it could ever have appeared in any report. `migrate()` drops it on
upgrade.

---

## 13. Purchase Invoice — additions to spec part 1

Tabs confirmed: `Supplier | Purchase Bill | Payment | Accout Display | Account cum Stock Display | Stock Cash Settlement`

### Supplier master

`Supplier Name` (V) · `Address` · `City` · `GST No` · `Mobile` · `Birth Date` ·
`Anniversary` · `Email` · `AdharCardNo` · `Select Item` ·
`Opening Balance` + Credit/Debit · **`REGI. Number`** ·
**`Weight Details`** grid (`Item Type` Gold/Stone/Silver | `Weight` | `Credit/Debit`) ·
photo box with `Add` / `Remove`

### Live dual balance in the bill header

```
Cr 20000.00      Gold : 100 Cr   Stone : 0   Silver : 0   Platinum : 0
```

Rupee balance and per-metal balance shown together, updating as lines are entered.
`Balance Wgt :- GrsWgt - 200   NetWgt - 200   FinWgt - 200` runs under the grid.

### Payment tab (Voucher Payment)

`VP1` · `Manual No` · `Date` · `Debit Account` + party · `Amount` · `Payment Type` ·
`Payment Details` · `Bank Name` · `No` + **`DD Comission`** · `Date` ·
button **`Close GSS Payment`**

---

## 14. Consolidated gap list

Ordered by build value, highest first.

| # | Gap | Where it shows | Our status |
|---|---|---|---|
| 1 | Weightwise billing + `PendingWt` metal receivable | §1 | **done** — Balance Weight card on the invoice, pending weight posts to the gold khata |
| 2 | `Account cum Stock Display` — money+metal one statement | §2 | **done** — Ledger → *Money + Gold* |
| 3 | `purchase_rate` (cost) on stock → profit, valuation, MIS | §7 | **done** — `Cost/Gm` on the tag grid, `Value at Cost` on the Stock Report |
| 4 | Stock Cash Settlement (metal ↔ cash) | §3 | **done** — Receipts → *Metal Settlement* |
| 5 | Sales Return + Purchase Return documents | §4 | **done** — *Returns* page |
| 6 | Karagir issue/receive reconciliation, sub-orders, tracking report | §10 | **done** — Orders → *Karagir Job Work*; incl. separate karagir date + old gold at booking |
| 7 | Accounting books → Trial Balance, Trading & P&L, Balance Sheet | §5 | **done** — Reports → *Accounting Books* (derived from the single-entry ledger; foots & balances) |
| 8 | GSS weight schemes + redemption invoice | §11 | **done** — all four scheme types, Days/Months/Years, gram accrual, and redemption onto a bill (after GST) with cash return |
| 9 | Loyalty earn + `Loyalty Discount` on bill | §10.6 | **done** — members earn a % of goods; points redeem as a pre-tax discount; balance derived from the bills |
| 10 | Expense via Account Master + Voucher Payment | §12 | **done** — Settings → Accounts, spent via Payments |
| 11 | Diamond & stone as rated components | §7 | **done** — `StoneRate`/`DiamondWt`/`DiamondRate` on the bill and tag grid; priced out of the metal, GST applies |
| 12 | Making Master / Wastage Master defaults | §9 | **done** — Settings → *Making & Wastage*; per item or per group, item wins; seeds the tag grid, bill line and purchase line |
| 13 | Cash Book, Journal, Sales/Purchase Books | §5 | **done** — Reports → *Cash Book & Registers* (Cash/Bank Book, Journal, Sales/Return & Purchase/Return registers) |
| 14 | Debtor/Creditor lists **by weight** | §5 | **done** — Reports → *Outstanding*, Money (₹) or Metal (g fine, per metal) |
| 15 | Reorder level (per piece and per design) | §7 | **done** — `reorder_level` on the item; Stock Report *Reorder alert* when in-stock count drops below it |
| 16 | Location / Shelf Tray / Category / Salesman / Size on stock | §7 | **done** — all on the tag grid; Stock Report groups by Category / Salesman / Shelf |
| 17 | Card swipe charges on bank accounts | §12 | **done** — `Card Swap Account` on a bank account, split customer/shop %; the shop's share posts to a `Card Charges` expense head |
| 18 | Grid Setting column chooser (shared component) | §8 | **done** — one shared `useGridCols` hook + `Columns` button on the billing grid, tag grid and stock report |
| 19 | Barcode `Not Printed Only` + copies | §8 | **done** — labels marked printed *after* the print dialog, with a copy count and an un-mark for a jammed run |
| 20 | Editable stock report + `Item Name Total` mode | §9 | **done** — *Edit Stock* corrects pieces in place (in-stock only, weights re-derived, metal position re-posted); `Item Name Total` collapses per item with a weighted purity |
| 21 | Day Book: gross/net/fine per metal, multi-bank | §9 | **done** — three weight pairs per metal, a URD block, every cash/bank account, and `Today Received Details` split by payment mode |
| 22 | GST R2 / R3B / HSN-wise, TCS, TDS reports | §5, §6 | **done** — Reports → *GST Reports* (GSTR-1/2 with CGST/SGST/IGST split, GSTR-3B, HSN summary, TCS/TDS) |
| 23 | Export to Word / Excel / PDF | §6 | **done** — every report exports CSV, Excel (.xls) and Word (.doc); invoices already did PDF |

### Multi-metal foundation

Not a single numbered row — foundational plumbing behind the per-metal panels the demo
shows (`Gold : 100 Cr  Stone : 0  Silver : 0  Platinum : 0`). Every piece now has a metal,
read from its item type (Gold / Silver / Platinum). It carries **end to end across every
flow**:

- **Retail** (tag, sale, sale return): the metal is read from the item type. Tagging posts
  loose stock in the piece's metal; a bill that mixes metals posts one metal-ledger row *per
  metal* (gold owed is gold, silver owed is silver, never folded); a return reverses only
  that metal.
- **Loose / pure-metal flows** (purchase, refining, karagir issue & receive, cash
  settlement): each document has a **Metal** chooser — Gold / Silver / Platinum — since the
  metal there isn't always tied to a stock item. All postings honour it.
- **Reports & UI**: `metalLedger` / `accountCumStock` / `metalOutstanding` take a metal, and
  the Ledger screen has a Gold / Silver / Platinum selector. The Day Book's gold line filters
  to gold rather than summing every metal.

A hand-typed line with no stock item resolves to Gold, so single-metal shops are unchanged.
Verified by `test/multimetal.cjs` (retail + purchase + karagir + settlement in silver).
Only **purchase return** still defaults to Gold — a small symmetric follow-up.

---

## 14b. Everything else that was outstanding

**Making Discount %** sits beside the rupee figure on the bill; both are allowed at once and
add up, capped at the making actually charged — a discount larger than the charge would be a
rebate on metal wearing a making label. **Bag Weight** is a column on the tag grid.

**Bag Weight is deducted from net weight**, not merely stored — a piece is weighed in its
pouch, so leaving it in would charge gold rates for plastic. It stacks with stones, beads and
diamonds; every one of them defaults to 0, so a plain piece nets exactly as before.

**Multi-branch stock transfer** — *Branches & Transfer*. A branch **is** a location: a tagged
piece already records where it is, so a transfer moves that field and writes a document
saying who moved what and when. There is deliberately no second per-branch stock ledger,
because two ledgers can disagree about where one physical ring is and then neither can be
trusted. A transfer is refused for a piece that is sold, unknown, or not actually at the
branch it is being sent from; renaming a branch carries its stock and its documents along; and
a piece scanned twice on one document still moves once.

Deleting a transfer puts every piece back where it came from — but only if the piece is still
where that document left it. If a later transfer has since moved it on, undoing the older one
would drag the piece backwards past a document that still stands, so the later one has to go
first. For the same reason, deleting a tagged piece named on a transfer is refused by name
rather than surfacing as a raw foreign-key error.

**The MIS pack** — *MIS & Scheme Reports*: non-moving stock with its age and value, quiet
customers with their last bill and lifetime value, top items, top areas, and purity profit.
Profit is at **cost**, from `purchase_rate`; pieces sold with no cost recorded are excluded
from the margin and reported as a separate count, because treating them as costing nothing
would read as pure profit.

**Export** — every report offers CSV, **Excel** (`.xls`) and **Word** (`.doc`) from one
shared button. Both Office formats are HTML tables with the right MIME type and extension,
which Word and Excel open natively; that is a deliberate choice over bundling a spreadsheet
writer into a fully-offline app for a file the shop opens, glances at and prints. Excel shows
a "different format than specified" prompt on open; the file itself is correct.

---

## 15. Corrections to spec part 1

- §4 of `VIDEO-SPEC.md` lists the Sales Invoice line grid without `Design`; that column
  appears when `Weightwise` is on.
- §11 (New Order Booking) lists five tabs; there are **six** — `New Order Report` was
  missed, as were `SubOrderNo`, the URD sub-tab at booking, and the separate karagir
  delivery date.
- §14 (Gold Saving Scheme) describes amount schemes only; there are four scheme types and
  a `Weight` column in the receipts structure. It also omits that the `GSS Amount` on the
  redemption bill is deducted *after* GST — the worked example (53,560 − 6,000 = 47,560)
  only balances if the tax is charged on the full bill first.
- §16 (Account Master) omits the Card Charges block.
- The `Opening Stock` tab of Item Master was recorded as a tab name only; §7 above documents it.
