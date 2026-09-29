# Manabh Jewellery Desktop ERP v3.0 — Reverse-engineered spec from demo video

Source: https://youtu.be/-gYkaKPE7DM (24:11, Hindi demo). Frames sampled every 8s.
This document is the source of truth for replicating screens, fields and flows.

> **See also [`VIDEO-SPEC-2.md`](VIDEO-SPEC-2.md)** — eight later feature-specific videos
> covering Weightwise billing, Account cum Stock Display, Stock Cash Settlement, returns,
> the full karigar pipeline, gold-scheme redemption and the item costing sheet. It also
> lists corrections to this file (see its §15). Where the two disagree, part 2 wins — it
> was taken from denser frame sampling of longer, single-topic demos.
>
> Note: the last ~4 minutes of *this* video (20:50–24:10) are a **different product**,
> *Manabh Moneylending ERP v5.0* (gold loan / pawn broking), not covered by this spec.

---

## 0. Shell / Chrome

**Window title:** `Manabh Jewellery Desktop ERP Ver 3.0 Lic To :Demo`

**Menu bar (top):**
`Master | Transaction | Accounts | Stock Report | Account Report | Ledgers | MIS Report | Gold Scheme | Messanger | Backup | Setting | About Us`

**Quick-launch toolbar (2nd row):**
`Item Creation | Barcode | Sales Invoice | Purchase | Refinery In | New Order | Account | Stock Report | Day Book | Debtors | USB Backup | A/C Master`

**Home body:** `Company Name : Demo`, `Welcome User : a`, centered logo.

**Status bar:** `Financial Year : 01/Apr/2022 - 31/Mar/2023` | copyright | Offline/Online indicator.

Screens open as **MDI child windows** (floating panels) over the home body, each with its
own title bar + close (X), tab strip, and a bottom row of action buttons.

---

## 1. Item Master  (toolbar: Item Creation)

Title: `Item Master`. Tabs: **Create Item** | **Opening Stock**

| Field | Type | Req | Notes |
|---|---|---|---|
| Item Name | text | * | has `V` (view/list) side button |
| Item Type | dropdown | * | e.g. Gold, Silver, Platinum, Stone. `N` = new/add |
| Item Group | dropdown | * | e.g. 22K Gold, 18K Gold. `N` = new/add |
| Design | dropdown | | `N` = new/add |
| Weight / Qty | dropdown | * | `WeightWise` \| `QuantityWise` |
| UOM | dropdown | * | GRAM, CARAT, PCS |

Checkbox top: `Dont View List`
Buttons: `Save | Delete | Cancel | Close | H | Add Image | URD Master | YouTube`

**Item Group master values seen:**
14K Gold, 18K Gold, 21K Gold, 22K Gold, 23K Gold, 24K Gold, Old Gold:24K Gold,
Old Silver:Silver, Platinum:Platinum, Ring:22K Gold, Silver:Silver, Stone:Stone, Tops:23K Gold

---

## 2. Barcode Creation  (toolbar: Barcode)

Title: `Barcode Creation`
Tabs: **Multiple Barcode Opening Stock** | **Stock Transfer Loose to Barcode** | **Barcode Printing**

Header: `Select Item` (+ `V` lookup, `Show` button), date range `From` / `To`.
Hint text: `Press F6 for Attachment`

**Grid columns:**
`Sr.No. | Tag | GrossWt | NetWt | Purity | Black.B | StoneWt | FinalWt | Mkg/Gm | HallM.Charges | HUID | GST`
(row delete via red `X` in first column)

**Footer totals:** `Gross Wt | Net Wt | Attach wt | Fine | Qty`

Buttons: `Save | Delete | Clear | Close | Print Barcode | GS | Create Single Barcode`

### Calculations (confirmed from video)
- **Tag** auto-generated: first 3 letters of item name + 5-digit serial → `RIN00001`, `RIN00002`, `RIN00003`
- **NetWt** = GrossWt − StoneWt − Black.B  (10.000 gross, 0 stone → 10.000 net)
- **FinalWt (fine)** = NetWt × Purity / 100 → `10.000 × 91.6% = 9.160` ✓
  - `12.000 × 91.6% = 10.992` ✓ ; `15.000 × 91.6% = 13.740` ✓
- **Footer Fine** = Σ FinalWt → `9.160 + 10.992 + 13.740 = 33.892` ✓
- **Footer Gross/Net** = Σ column → `10+12+15 = 37.000` ✓

---

## 3. Loose And Tag Item Stock Report

Title: `Loose And Tag Item Stock Report`
Controls: `Select Type` (Item Name), `Format` (Loose And Tag), `Show All Items`,
`Select Details` (filter by item group), `Select Type`.
Checkbox: `Don't Show URD Item`

Grid: `No | Tag | Item Name | Item Group | Gross Wt | ... | Net Wt | Purity | Final Wt | Show Attch | HUID`
with a black **Total** row.

Buttons: `Show | Print | Export | Cancel | Close | Filter | GS | Update | Save`

---

## 4. Sales Invoice  (toolbar: Sales Invoice)  ← the core screen

Title: `Sales Invoice`
Tabs: **Customer** | **Sales Bill** | **URD Purchase** | **Receipt** | **Accout Display** | **Account cum Stock Display**

### Header block
Left: `Customer Name` (+ `V` `N` `P` buttons = View / New / Photo), `Address`, `Mobile`, `Area`
Middle: `Select Prefix` (COM), `Bill No` (COM1), `Bill Date`, `Due Date`, `Payment Mode` (Cash Payment)
Right: `State` (Maharashtra), `Salesman`, `Manual No`
Radios: `( ) Cash  ( ) Credit`
Checkboxes: `GST Not Required`, `Weightwise`

### Line-item grid — tabs: `Sales Invoice` | `URD Purchase`
`Tag | ItemName | QTY | GrossWt | purity | StoneWt | NetWt | Rate/Gm | Mkg/Gm | MkgAmt | TotalAmount | ItemTotal | HallM.Charges | HUID`

### Footer — payment (bottom-left)
`Payment Type | Amount | Bank Name | Payment No | Date`

### Footer — receipt (bottom-middle)
`By Cash | Payment Type | Amount | Bank Name | Cheque No | Detail`

### Footer — balance (bottom-middle-right)
`Other | Amt Received | Net Balance | Ajusted Amt` (+ `Chanqe` button) | `URD BillNo`

### Footer — totals (bottom-right)
`Bill Amount | GST | (2 unlabelled) | GST+BillAmount | Bill Discount | Making-Discount | URD Amount | Manual URD Amt | TCS Tax %`

Buttons: `Save | Modify | Delete | Print | (WhatsApp) | Cancel | Close | GS | Retail`

---

---

## 5. Customer Master  (Sales Invoice → Customer tab)

Fields, in on-screen order: `Name*` (V lookup), `District`, `Taluka`, `City`, `Area*`,
`Address`, `Whatsapp Mobile No`, `Mobile No`, `Birth Date` (checkbox + date),
`Anniversary` (checkbox + date), `Email`, `Ref.Name`, `AdharCardNo`, `Pancard No`, `GST No`

Right panel: `Opening Balance` + `Debit/Credit` dropdown.
**Weight Details** grid: `Type Name` (Gold / Stone / Silver / Platinum) | `Weight` | `Credit/Debit`.
Photo box with `Add` / `Remove`.
Checkboxes: `Loyalty Point`, `Show in Purchase`.
Buttons: `Save | Delete | Print | Cancel | Close | H | Update MobileNo`

---

## 6. URD Purchase (old gold in)

Grid: `No | Name | Description | Gross.WT | Net.Wt | Pur.Purity | Final.WT | Rate | Amount`

- `Final.WT = Net.Wt × Purity / 100` → 3.000 @ 80% = **2.400**
- `Amount = Final.WT × Rate` → 2.400 × 4500 = **10,800.00**
- Row codes auto-generate `MO1`, `MO2`, …

The standalone tab adds `ByHand`, `Prefix` (O), `Bill No` (O1), `Urd Purchase On Rate`,
and totals `Purchase Amount | Sub Tax | Discount | Other | GST | Amount Given | Net Balance`.

---

## 7. Receipt tab

`Reciept No` (VR1) · `Manual No` · `Reciept Date` · `Credit Account` + party ·
`Amount` · `Receipt` (narration) · `Payment Type` · `Bank Name` · `No` · `Date`

Buttons: `Save | Modify | Delete | Print | WhatsApp | Cancel | Close | H | New Customer`,
plus `GSS Receipt` and `New Order Advance`.
Live balance shown in red, e.g. `59140.00 Dr` → after a 30,000 receipt → `29140.00 Dr`.

---

## 8. Account Display (khata)

Two-column T-format ledger split by a red rule.
Dr side: `Date | Particulars | R.No | ManualNo | Rs.`
Cr side: `Date | Particulars. | V.No | ManualNo | Rs..`
Ends with `To Balance b/d`. Totals are highlighted on both sides and always equal.
Buttons: `Show | Print | Export | Cancel | Close | H | One Column Display | WhatsApp | Gmail`

**Worked example from the video** — this is the parity test in `test/e2e.cjs`:

```
Dr                                     Cr
01/Apr  Opening Balance      9,500.00  24/Apr  Cash Account VR1  30,000.00
24/Apr  Sales Account COM1  49,640.00          By Balance c/d    29,140.00
        Total               59,140.00          Total             59,140.00
```

Note the sale is posted **net of the old gold**: 60,440.40 − 10,800 = 49,640.

---

## 9. Purchase Invoice

Tabs: **Supplier** | **Purchase Bill** | **Payment** | **Accout Display** | **Account cum Stock Display** | **Stock Cash Settlement**

Header: `Supplier Name` (V N P), `Remark`, `Cash/Credit`, `Invoice Prefix` (MI),
`Invoice Date`, `Invoice No` (MI1), `Manual No`, `State`, `Download URD Item`,
`GST Not Required`, `Weightwise`

Sub-tabs: **Material In** | **Material out**

Grid: `Itemname | QTY | GrossWt | Black.B | StoneWt | NetWt | Purity | Rate | Amount | Wastage% | Fin + Wastage | HallM.Charges | HallM.Amt | HUID`

Running strip: `Balance Wgt :- GrsWgt - <n>   NetWgt - <n>   FinWgt - <n>`

Totals: `Purchase Amt. | Discount | Return Amt. | Bill Amount | Sub Tax | TCS Tax % | TCS Tax Amt`
Tax block: `GST | HGST | MGST | TDS`, then `Paid Amount`, `Net Balance`

---

## 10. Refinery  (toolbar: Refinery In)

Tabs: **New Refinery** | **Refinry In** | **Refinery Out** | **Account cum Stock Display**

Header: `Refinery Name` (V N P), `Remark`, `Cash/Credit`, `Invoice No` (MO1),
`Invoice Prefix` (MO), `Invoice Date`, `Manual No`, `State`, `GST Not Required`

Grid: `Tag | ItemName | QTY | Gross Wt | Black.B | StoneWt | Net Wt | Purity | FinWt | RatePerGn | Amount | Gross+Wast`

Totals: `GST | MGST | TDS | Net Balance` and `Bill Amount | Discount | Sub Tax | Paid Amount`

---

## 11. New Order Booking (karagir)

Tabs: **New Order Booking** | **Sumbit Order to Karagir** | **Issue Material to Karagir** | **Receive Order from Karagir** | **New Order Sales Invoice**

Booking grid: `Tag | Item.Name | GrossWt | Black.Beats | StoneWt | NetWt | Purity | FinWt | Mkg/Gm | MkgAmt | HallM.Charges | Rate/Gm | Amount | HallM.Amt | Picture`

Receive grid: `Tag | Item Name | Qty | GrsWt | Less | Black.B | StoneWt | DiamondWt | Netwt | Purity | Final.wt | Rate/Gm | Wastage% | Wastage/GM | Amt`

Hints shown on screen: `Press F3 To Clear Current Row`, `* Below payment details are for Karagir`
Totals: `Total Amount | Discount | TDS | Final Amount | Paid Amount | Pending Amount`

---

## 12. Day Book

Range `From`/`To`, filter checkboxes (`Select All`, `Sales`, `Purchase`, `Karagir IN`,
`Customer IN`, …), toggles `Show DR/CR Amount Excluding GSS` and `Show Amount Including GST`.

Row heads: Total Sales · Total Purchase · Total Purchase Return · Total Karagir In ·
Total Karagir Out · Total Customer In · Total Customer Out · Total Refinery In ·
Total Refinery Out · Total Old Purchase · Total New Order · Total Stock Settlement IN ·
Total Stock Settlement OUT · Voucher Payment · Voucher Receipt · Customer Repair In/Out ·
Karagir Repair In · GSS Receive Amount · Total Sales Return

Columns: `Cash | Credit | Cheque/DD | Card + NEFT Amount | JRL Entry`

Right panel **Cash And Bank Accounts** — `Account Name | Opening | Closing`:

- Stock Details: Gold **33.892 → 22.900**, Platinum, Silver, Stone
- URD Stock Details: Gold **0.000 → 2.400**
- Cash Account **0.00 Cr → 30000.00 Dr**
- Today Received Details: Cash / NEFT-RTGS / UPI / Card

These three figures are asserted in the parity test.

---

## 13. Verify Barcode Stock — "Check Tag Item" (physical stock audit)

Search box + `Select Type` + `Show` / `Grid Setting` / `Barcode Stock Check`.

Grid: `No | Tag | Item Name | Item Group | Gross.Wt | Net.Wt | Purity | Final Wt | Qty | Location | Making/GM`

**Row colouring is the whole point:** scanned/verified rows turn **green**, rows not
scanned turn **red** — the red ones are physically missing from the shop.

---

## 14. Gold Saving Scheme

**Create scheme:** `Scheme Code` (GSS1) · `Scheme Name` · `Scheme Type` (On Amount) ·
`Scheme Type(D/M/Y)` (Months) · `Total Scheme Months` (12) · `Customer's Months` (11) ·
`Maturity Months` (1) · `Customer's Monthly Amount(Rs)` (1000) · `Maturity Amount(Rs)`

**Assign to customer:** `G.S. No` · `Manual No` · `Customer Name` · `Scheme Name` ·
`Start Date` · `Maturity Date` · `Scheme Duration` + `Interest` · `Monthly Amount` ·
`Benifit After Maturity` · `Remarks` · `Close GSS`.
Shows `Total Benifit : 1 X 1000.00 = 1000.00` and `Amount After Maturity : 1220.00`,
with a 12-row **Receipts Structure** grid (No | Date | Amount).

**GSS Receipt:** `G.S. No` · `G.S. Receipt No` · `Receipt Date` · `Receipt Amount` ·
`Payment Type` · recent-receipts grid carrying `Pending` / `Interest` statuses.

---

## 15. Menus (complete)

**Master:** Item Creation `Ctrl+I` · Barcode `Ctrl+B` · New Customer `Ctrl+C` ·
New Supplier `Ctrl+S` · New Karagir `Ctrl+K` · New Refinary `Ctrl+R` · Loyalty Master ·
Employee Master · Account Master `Ctrl+A` · Making Master · GST Master · User Master ·
Other Master ▸ · Company Creation · Log Off `Ctrl+L` · Exit `Ctrl+E`

**Stock Report:** Stock Report `Ctrl+F4` · Master Reports · Stock Valuation · Stock Transfer ▸ ·
Barcode Creation Report `Ctrl+F5` · Verify Barcode Stock `Ctrl+F6` · New Order Reports ▸ ·
Repair In Reports ▸ · Stock Transfer Report ▸ · Less Stock Transfer Report ·
Sales Approval ▸ · Stock In/Out Report

**MIS Report:** Non Moving Item List · Non Ordering Customers · Top Selling Item List ·
Top Selling Area List · Purity Profit Report · URD Purity Profit Report ·
Refinary Profit Loss Report · Reorder Level · Reorder Report Designwise ·
Sales Purchase Flow · Profit Report · Due Date Report · Counter Sale ▸

**Gold Scheme:** Create Gold Saving Scheme · Assign Scheme To Customer `Shift+F5` ·
Receive Scheme Amount `Shift+F6` · Gold Saving Sales Invoice `Shift+F7` · plus 10 reports

**Messanger:** WhatsApp · Text SMS · Email
**Backup:** Backup Media dialog → Default Location / USB Drive / Google Drive

---

## 16. Account Master

`Account Code` (auto, e.g. 105) · `Account Name` · `Account Type` · `Account Group` ·
`Opening Balance` + Debit/Credit

---

## 17. GST R1 (B2B) register

`Type` (Sales) · TAX checkboxes (`SGST1P5`, `CGST1P5`) · `From` / `To`

Grid: `date | InvoiceNo | Transaction | Party Name | GST Amt | Taxable Value | Invoice Value | GSTN/UIN | Place Of Supply`

---

## 18. Report Builder (bill designer)

Banded canvas — **Header / Body / Footer** with a ruler, plus a field tree
(`Self Master`, `Header`, `Body`, `Footer`, `Special Field`, `Formula Field`).

Toolbar: `Select Report` · `Format Name` · `Show | Save | Font | Clear | Set Formula | Format Section | Ver.Line | Hor.Line | TextField | Page Setup | Close | Preview`

Page size A4, 11.69 × 8.27 inch. Fields are draggable, colour-pickable placeholders bound
to names like `txt_customername`, `txt_billNo`, `TotalGr`, `PendBal`.

---

## 19. Printed TAX INVOICE layout

```
                     <Company Name>
                     Contact No.:            GST No:
                      TAX INVOICE
 ---------------------------------+-------------------------
 Name    : Sandip Jain            | Bill No: COM1
 Address :                        | Date   : 4/24/2022
 Phone   : 9767211065             | Payment Mode: CREDIT
 GST No  :                        |
 ---------------------------------+-------------------------
 NO | Item Name | HSN | Purity | HUID | Qty | Gr.Wt  | Nt.Wt  | Rate    | Mkg% | Amount
  1 | Ring      |     | 91.60  |      |  0  | 12.000 | 12.000 | 4590.00 | 0.00 | 58680.00
                                      Total|   12   |   12
 -----------------------------------------------------------
 AmountInWords: Rs. Fourty Nine Thousand Six Hundred Fourty Only

                                       Making Amt:       3600.00
 By Cheque: 0  By NEFT: 0  By Card/UPI: Basic Amt:       58680.00
                                        CGST 1.5% / SGST 1.5%
 Bank Details:                          Discount:              0
   Bank Name:      Account No:           Other Amount:          0
   Branch:         IFSC Code:            Total Amount:      60440
 <declaration text>                      Old PurchaseAmt:  10800.00
                                         Cash Received:        0.00
 Customer Sign | Pending Balance: 59140 | Balance:         49640.00
```

Reproduced in `src/print/invoice.ts`.
