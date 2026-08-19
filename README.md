# Parivar Jewellery ERP

Offline Windows desktop ERP for a jewellery retail shop — item creation, tagging/barcode,
CRM, sales invoicing with old-gold exchange, purchase, receipts, stock and khata reports.

Feature set and calculations are reverse-engineered from the Manabh Jewellery Desktop ERP
demo video; see [`docs/VIDEO-SPEC.md`](docs/VIDEO-SPEC.md) for the screen-by-screen source
of truth. The **flows and numbers** match the original; the **interface** is rebuilt to be
simpler and modern.

---

## Running it

```bash
npm install       # builds the native SQLite module for Electron
npm run dev       # dev server + app with hot reload
```

To run the production build:

```bash
npm run build
npm start
```

To produce the shareable Windows installer:

```bash
npm run dist
```

This writes `release/Parivar-Jewellery-ERP-Setup-<version>.exe` (~88 MB) — a single
file you can send to anyone. It installs per-user (no admin rights needed), creates
desktop and Start-menu shortcuts, and bundles Electron, the app and the SQLite engine.
Nothing else needs installing on the target machine.

Uninstalling leaves the shop's data in place, so reinstalling or upgrading never
destroys the books.

<details>
<summary>Why <code>dist</code> is a script rather than a plain electron-builder call</summary>

electron-builder downloads a "winCodeSign" toolkit to sign the exe and to run `rcedit`,
which stamps the icon onto it. That archive contains macOS symlinks, and Windows refuses
to extract symlinks unless **Developer Mode** is on or the build runs **as administrator**
— so a plain `electron-builder --win` fails on a standard Windows box with
`Cannot create symbolic link: A required privilege is not held by the client`.

`scripts/make-installer.cjs` sidesteps it: build unpacked → stamp the icon with rcedit
directly → package the installer from the prepared folder. Same output, no elevation.
</details>

### User manual

A complete 25-page manual for shop staff lives at
[`docs/Parivar-Jewellery-ERP-Manual.pdf`](docs/Parivar-Jewellery-ERP-Manual.pdf) —
setup, daily billing, old-gold exchange, purchase and metal exchange, karagir orders,
refining, gold schemes, stock verification, khata reports, backup, shortcuts, every
formula, troubleshooting and a glossary of trade terms.

```bash
npm run manual     # regenerate the PDF from docs/manual.html
```

Edit `docs/manual.html` and re-run to update it. It renders through the same print
engine the app uses for invoices.

### Demo data

```bash
npm run demo              # loads a demo shop into the real database
npm run demo -- --force   # wipe and reseed (backs the old file up first)
npm start
```

Gives you 6 items, 6 tagged pieces in stock, 4 customers, 3 sales bills (one with
old-gold exchange), a purchase, refining out and in, an open karagir order, receipts
and payments, and a gold-scheme member two instalments in — so every screen and
report has something real in it.

### Tests

```bash
npm run test:all
```

| Suite | What it covers | Assertions |
|---|---|---|
| `npm test` | Video parity — replays the demo recording's exact transaction | 77 |
| `npm run test:full` | Every module incl. edit, delete, reversal and guard paths | 147 |
| `npm run test:flows` | Real UI driven by clicks and keystrokes, verified in the DB | 121 |
| `npm run test:auth` | Login, roles, permissions, staff management | 50 |
| `npm run test:gdrive` | Drive config, token encryption, owner-only guards | 26 |
| `npm run test:hunt` | Adversarial edge cases and abuse | 25 |
| `npm run test:backup` | Backup inspection, restore, rollback and bad-file refusal | 22 |
| `npm run test:weightwise` | Metal-basis billing, pending weight, making on top | 33 |
| `npm run test:acstock` | Combined statement + metal-for-cash settlement | 46 |
| `npm run test:returns` | Returns across stock, money and metal; shop expenses | 31 |
| `npm run test:karagir` | Job-work metal reconciliation, TDS, order tracking | 37 |
| `npm run test:books` | Trial Balance foots, P&L, Balance Sheet balances | 24 |
| `npm run test:orderbooking` | Separate karagir date; old gold at booking, no double-count | 20 |
| `npm run test:rated` | Diamond & stone priced out of the metal; GST; tag carries rates | 22 |
| `npm run test:multimetal` | Gold/Silver/Platinum apart through tag, bill, return, purchase, karagir, settlement | 21 |
| `npm run test:outstanding` | Debtor / creditor lists, money and by metal weight | 18 |
| `npm run test:registers` | Cash Book running balance, Journal, Sales/Purchase registers foot | 18 |
| `npm run test:gst` | GSTR-1/2 CGST-SGST-IGST split, B2B/B2C, GSTR-3B, HSN, TCS/TDS | 27 |
| `npm run test:stockmaster` | Category/salesman/shelf/size on tags; group-by; reorder alert | 19 |
| `npm run test:loyalty` | Points earned, redeemed, capped; balance derived from the bills | 16 |
| `npm run test:gssweight` | Four scheme types, gram accrual, redemption onto a bill after GST | 76 |
| `npm run test:stockedit` | In-place stock correction, sold-piece guard, weighted purity | 24 |
| `npm run test:ratemaster` | Making/Wastage defaults per item & group, item beats group | 32 |
| `npm run test:gridcard` | Grid column prefs, barcode reprint guard, card fees, making % | 35 |
| `npm run test:misreports` | Scheme merge, scheme reports, MIS pack, branch transfers | 56 |
| `npm run test:daybook` | Gross/net/fine per metal, multi-bank, receipts by mode | 39 |
| `npm run test:bugfixes` | Regressions for six bugs found by an adversarial pass | 28 |
| `npm run test:shopmonth` | A whole trading month, reconciled twelve ways | 63 |
| `npm run test:shopstress` | The awkward days — rate moves, renegotiated bills, bounced cheques | 39 |
| `npm run test:shopyear` | A year of trading; conservation of metal; books foot after every document | 35 |
| `npm run test:changeover` | The parallel-run check reports differences, and blanks as unchecked | 28 |
| `npm run test:changeoverday` | A real shop migrating: opening balances, a month, then reconcile | 44 |
| `npm run test:faults` | Power cuts, corrupt backups, restore round-trip — the books never come out wrong | 31 |
| `npm run test:parse` | CSV / paste column mapping for the tag grid | 23 |
| `npm run test:ui` | Every screen renders, fails on any console error | 18 screens |
| `npm run test:layout` | Every screen checked for overflow and clipping | 48 screens |

The parity suite pins a single business date rather than using the system clock —
some records (tag entry dates, scheme receipts) default to *today*, so mixing the two
made the day-book assertions fall out of range as soon as the machine's date moved on.

`test/full.cjs` is the feature matrix: company, masters, tagged stock, CRM, four
sale variants (cash, credit with old gold, edit, GST-exempt with discounts and TCS),
purchase with wastage, refining both directions, order-to-invoice, receipts and
payments, gold scheme, all six reports, the print payload, guard rails, and that
deleting a document fully reverses its stock and ledger postings.

`test/shopmonth.cjs` and `test/shopstress.cjs` are the ones that matter most. Every other
suite checks a function against a number I chose; these run a **real month of trading** —
bullion bought on credit, metal to the goldsmith and back, tagging, counter sales, credit
sales with old gold, a metal-basis wholesale bill, an order with an advance, a saving
scheme, a return, refining, supplier payments, the electricity bill — and then check that
the books **agree with themselves**:

- the trial balance foots and the balance sheet balances
- every party closes where their own statement says
- the customers add up to Sundry Debtors, the suppliers to Sundry Creditors
- cash and bank agree across the cash book, the trial balance and the day book
- GST on the bills equals GST on the return, and inter-state is IGST-only
- the stock report's fine weight equals the pieces actually in the trays
- the goldsmith's metal balance equals issued less received less wastage
- deleting a bill returns every one of those figures to where it was

`test/shopyear.cjs` goes further and runs a **year**, because some things only break over
one: it checks the books foot after *every single document* rather than only at year end,
and that metal is **conserved** — every gram that came in is still on a shelf, owed by
someone, or sent away.

Nothing in these three trusts a number because it was typed into a test. Between them they
found four real accounting bugs that every other suite had passed over for a dozen
releases: account opening balances never reaching the books, the cash book closing
somewhere else again, a purchase return priced on raw weight instead of fine, and closing
stock ignoring untagged metal.

`test/bugfixes.cjs` pins six defects an adversarial pass turned up after the last feature
round, each reproduced as the scenario that exposed it: bag weight priced as gold, the Day
Book reporting two different opening balances for one account, a bare foreign-key error when
deleting a tagged piece named on a transfer, a piece counted twice when scanned twice,
undoing an old transfer teleporting a piece past a later one, and a card fee charged on a
credit bill where no card was ever presented.

`test/hunt.cjs` is the adversarial pass — double-selling one piece, melting something
already sold, negative weights, editing a bill to drop a line, deleting a refining entry,
month-end date rollover, collecting a row the member never owes, and a check that every
party ledger still balances afterwards. It found five real bugs on its first run.

Screenshots: `electron ./test/shots-live.cjs` writes `test/shots-live/`.
**Treat the images as a rough guide only** — on some GPUs `capturePage()` returns a stale
compositor frame, so a screenshot can show the previous screen (or even a previously
closed window). The DOM assertions in the test suites are the reliable signal.

---

## Stack

| Layer | Choice |
|---|---|
| Shell | Electron 33 |
| UI | React 18 + Vite, hand-rolled CSS design system |
| Data | SQLite via `better-sqlite3`, synchronous, fully offline |
| IPC | `contextBridge` only — no node integration in the renderer |

### Expenses

There is no expense screen, by design. An expense head is an account in the chart of
accounts (**Settings → Accounts → New Account**, type *Expense*), and money is spent
against it with a **Payment** voucher in Receipts & Payments. That is the only route by
which an expense reaches the cash book, the day book and — when it is built — the P&L.

A `expense` table used to exist, unused. It modelled expenses outside the ledger, so
nothing posted to it could ever appear in any of those. It is dropped on upgrade.

The database lives in `%APPDATA%/Parivar Jewellery ERP/data/parivar.db`.
**Settings → Data & Backup** writes a portable copy anywhere you choose, and restores one.

Restore is owner-only and deliberately two-step. Choosing a file **reads** it first and
shows what it holds — shop name, customer / stock / bill counts, last ledger date — beside
the same figures for the live books, so it is clear what is about to be replaced. A file
that is not a database, or is a database but not this app's, or is damaged, is refused at
that point rather than half-way through the swap.

On confirmation the current books are copied to `data/pre-restore-<stamp>.db` before
anything is overwritten, so restoring the wrong file is itself recoverable. The stale
write-ahead log is removed — left behind, SQLite would replay it over the restored file
and corrupt it — and the app restarts, because every module is holding rows read from a
database that no longer exists.

---

## Layout

```
electron/
  main.cjs       Window, IPC registration, printing, backup
  preload.cjs    contextBridge surface (the only renderer↔main channel)
  db.cjs         Connection, schema bootstrap, seed data, doc numbering
  schema.sql     Full relational schema
  calc.cjs       Jewellery maths — AUTHORITATIVE (re-run on every save)
  api.cjs        All queries and transactional writes
src/
  lib/calc.ts    Renderer mirror of calc.cjs, for live preview only
  lib/ui.tsx     Toasts, fields, autocomplete, modals, async hooks
  pages/         One file per screen
  print/         A4 tax-invoice HTML template
test/e2e.cjs     Video-parity verification
```

### Two copies of the maths — on purpose

`src/lib/calc.ts` recomputes totals as the user types so the summary updates instantly.
`electron/calc.cjs` recomputes them again inside the save transaction and **that result is
what gets stored** — the renderer is never trusted with financial values. The two files
must be kept in sync; both carry a header comment saying so.

---

## Core calculations

All verified frame-by-frame against the demo:

```
net       = gross − stone − black beads − diamond
fine      = net × purity / 100          10.000 g @ 91.6%  → 9.160 g
goods     = net × rate/gm  + stone + dia 12.000 × 4590     → 55,080.00
making    = net × making/gm             12.000 × 300      →  3,600.00
bill      = goods + making + hallmark                     → 58,680.00
GST       = bill × 3%                                     →  1,760.40
total                                                     → 60,440.40
old gold  = (net × purity%) × rate      3 g @ 80% × 4500  → 10,800.00
balance   = total − old gold − received                   → 49,640.40

stone     amount = stone wt × stone rate  2 g × 500        →  1,000.00
diamond   amount = dia wt   × dia rate    1 g × 10,000     → 10,000.00
refining  amount = fine × rate/gm       (fine weight drives the settlement)
purchase  fine+wastage = net × purity% × (1 + wastage%)
```

Stones and diamonds come **out of the metal weight** — they are not gold, so the fine-weight
khata never counts them — and are charged in their own right at their own rate, as part of
goods (so GST applies). A tagged piece stores `stone_rate` / `diamond_wt` / `diamond_rate`
and the bill fills them in on scan. A plain gold piece, both rates 0, is priced exactly as
before.

Tags auto-number from the first three letters of the item name: `Ring` → `RIN00001`.

### Metal-for-metal exchange

A purchase is not always a cash buy. The Purchase Invoice has **Material In** and
**Material Out** tabs: hand the supplier fine metal against the ornaments you take,
and only the difference settles in money. The *Balance Wgt* strip shows in/out/balance
for gross, net and fine, and the bill is allowed to swing negative when you have given
more value than you received — that posts as a debit, meaning the supplier owes you.

Because the money side is only half the story, every party also has a **gold khata**:
Ledger → the `Money | Gold` switch. Same two-column Dr/Cr layout, but in fine grams.

```
Dr — Metal we gave them          Cr — Metal they gave us
14/Jul  Metal exchange  94.525   13/Jul  Purchase       177.608
                                 14/Jul  Metal exchange  91.600
                                 Balance 174.683 g fine Cr
```

Sales, purchases and refining all post to it. Old gold taken on a sale still settles in
rupees (the video's URD flow), not as metal.

### Loyalty points

Tick **Enable loyalty points** on a customer and every bill earns them points — a percentage
of the bill's goods value, set in **Settings → Company → Loyalty Programme** along with what a
point is worth in rupees. On a later bill a **Redeem Points** box appears showing their
balance; the points come off as a **pre-tax discount**, so GST is charged on what the customer
actually pays. Redemption is capped at the balance and at the bill's own value.

The balance is **derived** from the bills (earned − redeemed), not kept as a running counter —
so editing or deleting a bill self-corrects with nothing to unwind.

### Stock attributes & reorder alert

A tagged piece can carry a **Category** (Ladies/Gents), **Salesman**, **Shelf / Tray** and
**Size** — set once for a batch on the tag grid and stamped onto every piece. The Stock Report
groups by any of them (as well as Item, Group and Location). An item can carry a **Reorder
Level**; when its in-stock piece count falls below that, a red **Reorder alert** heads the
Stock Report listing exactly how many are short — so nothing quietly runs out.

### Making Master & Wastage Master

**Settings → Making & Wastage.** Set a default making charge (per gram, or a flat charge per
piece) and a default wastage percentage against an **item group** such as *22K Gold*, or
against a single **item** where it differs. The item's own rule wins over its group's, and
the form tells you which rule a number came from.

These seed three places: the making rate on new tag-grid rows, the making rate on a bill
line whose piece carries none, and the wastage on a purchase line.

**They seed forms; they never rewrite documents.** A making charge of zero is a real answer —
plenty of sales give making free — so an engine that filled in a master value for a blank
could not tell "not entered" from "deliberately none", and would silently change bills. The
number appears in the field where it can be seen and edited, and what you leave there is
what is saved. A tagged piece's own making rate always wins, because it was set when the
piece was priced.

### Opening metal in the safe

Tagged pieces have always had a way in — the tag grid. **Loose metal did not**, which left a
shop switching over with a choice between entering its bullion as a fake purchase (inventing
a supplier liability that does not exist) or leaving it off the books entirely.

**Tag & Barcode → Made from loose metal → Opening metal** records what is already in the
safe. It is not a purchase and touches nobody's khata. Entering the same metal again
replaces the figure rather than adding to it, so correcting a day-one typo cannot leave both
attempts on the books.

### Closing stock includes the metal in the safe

Closing stock is tagged pieces at their recorded cost **plus the loose pool** — bullion
bought and not yet made up, and old gold taken in and not yet melted. Leaving the loose
metal out turned every untagged purchase into a pure expense with no asset against it, so a
shop holding bullion at year end showed a loss it had not made. The books balanced either
way, because capital is a plug — which is exactly why only a year-long run with a realistic
buy-then-make cadence exposed it.

The loose pool is valued at the weighted average of what metal actually cost that period
(purchases and old gold together, over the fine weight they brought in). A period that
bought nothing has no basis to value on and contributes zero rather than a guess.

### Day Book

The right-hand panel carries three opening/closing pairs **per metal** — gross, net and fine
— then the same for old gold, then every cash and bank account, then what came in today split
by how it was paid.

All three weights matter: gross is what is physically on the shelf, net is that less stones,
fine is the pure metal in it. A shop counting its trays counts **gross**, so a book reporting
only fine could never be reconciled against the count it exists to check.

Only physical cash goes in the drawer — card, UPI, NEFT and cheque all settle into the bank.
That is what makes the two balances mean anything, and it is where the card-swipe fee comes
out of.

### Branches & stock transfer

**Branches & Transfer.** A branch **is** a location — a tagged piece already records where
it is, so a transfer moves that field and writes a document saying who moved what and when.
There is deliberately no second per-branch stock ledger: two ledgers can disagree about where
one physical ring is, and then neither can be trusted.

A transfer is refused for a piece that has been sold, is unknown, or is not actually at the
branch it is being sent from — any of those would invent stock at the destination. Deleting a
transfer puts every piece back where it came from, and renaming a branch carries its stock and
its documents along rather than orphaning them.

### MIS reports

**MIS & Scheme Reports.** Non-moving stock with its age and value at cost, customers who have
gone quiet, top selling items and areas, and **purity profit** — revenue against cost, per
purity band.

Profit is at **cost**, from the `Cost/Gm` recorded when the piece was tagged. Pieces sold
without a cost recorded are **excluded from the margin entirely** and reported as a separate
count, because counting them as costing nothing would read as pure profit. The same tab
carries the gold-scheme reports: scheme master, allocated members, pending and received
instalments, and scheme sales.

### Grid Settings & export

Every grid has a **Columns** button: rename a heading, set a width, hide a column, reorder,
or reset to default. It is one shared hook (`src/lib/grid.tsx`), on the billing grid, the tag
entry grid and the stock report. A saved layout is reconciled with the code's columns on every
read, so a column added in a later release appears rather than staying hidden from anyone who
had once opened the chooser.

**Export** offers CSV, **Excel** (`.xls`) and **Word** (`.doc`) everywhere. Both Office
formats are HTML tables carrying the right MIME type, which Word and Excel open natively —
chosen over bundling a spreadsheet writer into an offline app for a file the shop opens,
glances at and prints. Excel shows a "different format" prompt on open; the file is correct.

### Correcting stock after a count

The Stock Report's detail grid edits **in place**. Press **Edit Stock**, retype gross, stone,
purity, cost or location on any row, and press **Save**. Net and fine weight are recomputed
by the engine rather than taken from the grid, and the metal inflow booked when the tag was
made is re-posted, so a correction moves the metal on hand rather than only the printed row.

Only pieces still **in stock** can be edited. A sold piece's weights are already priced on a
bill, so rewriting them here would leave the invoice and the stock disagreeing with nothing
to say which was right — correct the bill instead. The whole save is one transaction: if any
row is refused, none of them are written.

**Item Name Total** collapses the report to one row per item with a **weighted purity** —
`fine ÷ net`, not the average of the per-piece percentages, which would let a 1 g scrap ring
count for as much as a 50 g chain. `StoneAmt` and `DiamondAmt` sit alongside the metal cost
on both the detail and summary grids.

### Bulk tagging

Entering stock one row at a time does not scale, so **Tag & Barcode** has four ways in:

- **Same for every piece** — purity, making/gm, hallmark and location applied to new rows,
  with *Apply to all rows* for existing ones
- **Duplicate ×N** — type one piece, stamp out ten more; each still gets its own tag
- **Paste from Excel** — copy a block of cells straight into the grid
- **CSV import** — with a downloadable template and a preview showing net and fine weight
  per row *before* anything is created

Nothing is written until Save, so the totals can always be checked against the physical
weighing first.

**Barcode labels**: tick pieces in the stock list → *Print labels*. Three label sizes
(jewellery tag roll, A4/65, A4/24), copies-per-piece, and a skip offset for part-used
sheets. Barcodes are **Code 128**, generated in `src/print/barcode.ts` — about sixty lines
of pattern table and a modulo-103 checksum, no dependency. They scan straight into the
Tag box on a sales bill.

### Loose metal vs tagged stock

Gold sits in the shop in two forms and the app keeps them apart: **tagged pieces**
(each with a tag number) and **loose metal** (bars, scrap, refinery returns, old gold).
Total stock is both; the Day Book reports the split.

`loose_stock` carries an `is_tagged` flag so the two pools can be read separately.
**Tag & Barcode** has a mode switch:

- **New stock** — first-time entry of what is already in the shop
- **From loose metal** — the pieces were made from bar or scrap already owned, so
  `looseStock.convert()` creates the tags *and* books the same fine weight out of the
  loose pool

This closes a genuine accounting hole. Before it existed, buying 100 g and then tagging
100 g of bangles made from it reported **200 g** — the metal was counted in both pools.
Now the weight moves rather than being added, and the conversion refuses to draw more
than is actually on hand.

### Google Drive backup

`Settings → Data & Backup`. Real OAuth 2.0 for installed apps — loopback redirect with
PKCE, consent in the user's own browser, never an embedded window.

- **Scope is `drive.file` only** — the app can touch nothing but the backup files it
  created, and that scope needs no Google verification review
- **Tokens are sealed with the OS keystore** (DPAPI on Windows) via `safeStorage` before
  they reach the database; if encryption is unavailable the app refuses to connect rather
  than write a credential in the clear
- **Owner-only**, enforced in the main process
- Keeps the newest 10 backups, prunes the rest

Requires a one-time Google Cloud OAuth client, which the user creates themselves — the
app ships an in-product guide. The step people miss: set the consent screen to
**In production**, or Google expires the grant every 7 days.

### Authentication and roles

The app opens on a sign-in screen. A fresh database bootstraps one account —
`admin` / `admin` — and the Users screen keeps warning until that password is changed.

| Role | May do |
|---|---|
| **Staff** | Billing, receipts, orders, stock entry, reports |
| **Manager** | + refining (melting metal), removing tags from stock |
| **Owner** | + staff logins, shop settings, deleting documents, backups |

Ported from the reference app — same three roles, the same `can(role, action)` matrix
and the same `admin`/`admin` bootstrap. Two things were changed on the way in:

- **Passwords use scrypt, not salted SHA-256.** SHA-256 is fast, which is the opposite
  of what a password hash wants; a stolen database file could be brute-forced quickly.
  scrypt is memory-hard and ships with Node, so it costs nothing here. The stored shape
  (`salt` + `password_hash`) is unchanged.
- **Permissions are enforced in the main process**, via `CHANNEL_PERMISSION` in
  `electron/main.cjs` — not only in the renderer. A check that lives only in the UI can
  be bypassed by anyone who opens developer tools.

`admin` can never be deleted or disabled, and you cannot disable your own login or drop
your own owner access — so the shop can never lock itself out.

### Input safety

Physical quantities — weights, purity, rates, counts — are floored at zero in both
copies of the maths (`nn()`), so a stray minus sign can never produce a negative bill.
The main process also refuses to bill or melt a piece that is not in stock, so the same
physical item cannot be sold twice.

### Money postings

A sale debits the customer with **total − old gold** (matching the original's ledger),
credits any amount received, and debits Cash. Every document's postings are keyed by
`(doc_type, doc_id)`, so editing or deleting one cleanly reverses and re-posts it —
including returning sold tags to stock.

---

## Keyboard

| Key | Action |
|---|---|
| `Ctrl K` | Command palette — jump to any screen or customer |
| `F2` | Sales Invoice |
| `F3` | Purchase |
| `F4` | Receipts |
| `F5` | Orders |
| `F6` | Item Creation |
| `F7` | Tag & Barcode |
| `F8` | Customers |
| `F9` | Refining |

In the invoice grid: type an item name or scan a tag, `↑`/`↓` to pick, `Enter` to fill.
Weights, purity and making rate populate from the tag automatically.

---

## Build note (Windows)

Node 24's own build config advertises the **ClangCL** toolset, which a default Visual
Studio install does not ship — `better-sqlite3` then fails to compile. `.npmrc` pins
`msvs_version=2022` / `clang=0` to force the normal MSVC toolset. npm prints an
"Unknown project config" warning for those two keys; it is harmless — node-gyp still
reads them.

Requires **Visual Studio 2022** with the C++ workload and the Windows 10/11 SDK.

---

## Implemented

Item master (types, groups, designs) · Tag & barcode stock entry · Customers and
suppliers with opening money + metal balances · Sales invoice with old-gold (URD)
exchange, **rated diamond & stone components**, GST, discounts and part payment ·
A4 tax invoice print + PDF export ·
Purchase with wastage and fine-weight tracking · Receipts and payments · Stock report
(tag-wise and grouped) · Day book · Two-column Dr/Cr khata · CSV export · Backup ·
Refining in/out · Karagir order booking · **Gold saving schemes (amount, making and
weight-based) with redemption onto a bill** ·
**Physical stock verification** · **Invoice designer** · **WhatsApp / SMS / email** ·
**Accounting books (Trial Balance · P&L · Balance Sheet)** · **multi-metal (Gold / Silver /
Platinum) khatas** · **Cash Book / Journal / registers** · **GST returns (GSTR-1/2/3B, HSN,
TCS/TDS)** · **Outstanding by money & weight** · **loyalty points** ·
**Making & Wastage masters** · **card-swipe charges** · **grid column chooser** ·
**barcode reprint protection** · **Excel / Word export** ·
**MIS pack (non-moving, quiet customers, top sellers, purity profit)** ·
**branches & stock transfer** · **per-metal Day Book**.

### Refining

`Send Out` moves metal from your stock to the refiner — tagged pieces are marked
`MELTED` and leave the tagged pool. `Receive` books the pure metal back in. Both sides
post to the refiner's fine-weight khata; the refiner's charges post to their money account.

### Orders

`BOOKED → ISSUED → RECEIVED → DELIVERED`. Only the advance touches the money ledger
while an order is open — the order is not revenue. On **Convert to Sales Bill**, the
advance posting is reversed off the order and re-recorded on the invoice as amount
received, so the customer is never credited twice.

An order carries **two deadlines** — the customer's *Delivery Date* and a tighter
*Karagir Date* — so the tracking report can flag a piece as karagir-overdue while there is
still slack before the customer's promise. **Old gold taken at booking** goes on its own
grid: it pays the balance down like a second advance and posts to the customer's gold khata
right away (held under the order, not the money ledger). On conversion it carries onto the
invoice as URD, with the booking-time metal leg reversed and re-posted by the sale so the
gold is never counted twice.

### Gold Saving Scheme

Define a scheme once, then enrol members. Enrolling generates the full instalment
schedule; the final row is the shop's benefit. Scheme money is a **liability**, so it
posts to a dedicated `Gold Saving Scheme` account and deliberately never touches the
member's trading khata.

Four scheme types, over `Days`, `Months` or `Years`:

| Type | Fixed each period | Balance accrues in | Shop's benefit |
|---|---|---|---|
| `On Amount` | rupees | rupees | rupees at maturity |
| `On Making` | rupees | rupees | a making-charge waiver % |
| `On Weight` | rupees | **grams**, at the rate on the day paid | grams |
| `Weight Wise` | **grams** | grams | grams |

The two weight types differ in which side of the conversion is fixed. `On Weight` fixes
the rupees and lets the grams follow that day's rate, so a member paying 6,000 a month
accrues more metal when gold is cheap. `Weight Wise` fixes the grams — a gram a month is
a gram a month, and the member pays whatever it costs. Either way the shop enters the
metal rate on each receipt, so the conversion stays auditable long after the rate moves.

**Redeeming a scheme.** Pick the customer's scheme on an ordinary sales invoice. Two
things can come off a bill and they land in different places: an `On Making` waiver is a
*discount*, so it goes in before GST, while the scheme balance is money the shop already
holds, so it settles the bill *after* GST — a 52,000 bill plus 1,560 GST is 53,560, less
a 6,000 scheme balance leaves **47,560** to pay, with the tax still charged in full.
Anything left over stays on the account for next time, or can be handed back in cash.

The balance is **derived** from the received instalments less what bills have spent, so
undoing a receipt, editing a bill or deleting one self-corrects with nothing to reverse.
The maturity benefit is only counted once every paying instalment is in *and* the maturity
date has passed — a member who stops halfway gets back what they put in, not a bonus they
did not earn.

### Physical Stock Verification

Scan every piece in the tray. Found rows go green, unscanned rows stay red — those are
physically missing. Tags scanned that aren't in stock are listed separately (already
sold, melted, or another branch). Nothing is written to the database; export the sheet
as CSV when the count is done.

### Invoice Designer

Settings → Invoice Design. Choose A4 or 3-inch thermal, set the title, accent colour and
footer note, and toggle any item column or section on and off. The preview pane runs the
**real print renderer**, so what you see is exactly what prints.

This replaces the original's drag-and-drop report builder. That canvas approach is
powerful but fragile; a configurable template covers the same practical need — changing
what appears on the bill — without a half-working editor.

### Multi-metal

Every piece has a metal — Gold, Silver or Platinum — read from its item type. The retail
path carries it end to end: **tagging** posts loose stock in the piece's metal; a **bill**
that mixes metals posts one fine-weight ledger row *per metal*, so gold owed stays gold and
silver owed stays silver — they are never folded into one figure; a **return** reverses only
that metal. The Ledger screen (Metal / Money + Metal) has a Gold / Silver / Platinum selector,
and `metalLedger` / `accountCumStock` / `metalOutstanding` all take a metal.

The **loose / pure-metal flows** — purchase, refining, karagir issue & receive, and cash
settlement — each carry a **Metal** dropdown (Gold / Silver / Platinum), since their metal
isn't always tied to a stock item; every posting honours it. A hand-typed line with no stock
item behind it resolves to Gold, so single-metal shops see no change. Only purchase *return*
still defaults to Gold — a small symmetric follow-up.

### Outstanding (debtors & creditors)

Reports → **Outstanding** lists who owes the shop and whom the shop owes, side by side with
running totals. A **Money (₹) / Metal (g)** toggle reads the same outstanding two ways: money
from the party ledger, or fine grams of a chosen metal (Gold / Silver / Platinum) from the
gold khata. Metal is never converted to rupees — a weight list is genuinely a different
statement, since gold owed is valued at whatever the rate is that day. Exports to CSV.

### GST Reports

Reports → **GST Reports** is the statutory return pack, over any date range. **GSTR-1**
(outward) and **GSTR-2** (inward) list each document and split the tax the right way — CGST +
SGST when the place of supply is the shop's own state, IGST when it crosses a state line —
and group **B2B** (party has a GSTIN) vs **B2C**. **GSTR-3B** nets output tax against input
credit to the cash payable (or credit carried forward), matching the GST line in the
Accounting Books. **HSN Summary** groups sales by HSN code with taxable value and tax.
**TCS / TDS** lists the tax collected on sales and withheld from karagir labour, ready to
deposit. Every view exports to CSV.

### Cash Book & Registers

Reports → **Cash Book & Registers** carries the transaction-listing books, over any date
range. **Cash / Bank Book** — every movement through the cash or bank account with a running
Dr/Cr balance and an opening carried in from before the period. **Journal** — every ledger
posting in date order, showing the head (party or account) and the Dr/Cr leg. **Sales &
Purchase Books** — a register per document type (Sales, Sales Return, Purchase, Purchase
Return) with taxable / GST / total columns and column totals. Each view exports to CSV. These
are read-backs of the same ledger and document tables the accounting books close from.

### Accounting Books

Reports → **Accounting Books** carries a Trial Balance, a Trading & Profit / Loss
account, and a Balance Sheet, over any date range (defaulting to the current April–March
financial year).

These are **derived**, not read from a double-entry ledger, because the app keeps a
single-entry money ledger: only cash/bank, the scheme liability, the expense heads and
the parties get real ledger rows, while the income and direct-cost heads (Sales,
Purchase, Old Gold, GST) live only as the *particulars* on the party's leg. The books
are rebuilt from the source documents that generated those legs. Because every rupee a
document moved still has a home on both sides, the Trial Balance foots to the paisa and
the Balance Sheet balances; whatever is genuinely un-booked (chiefly proprietor's capital
carried forward) is shown as its own labelled line rather than hidden. Capital on the
Balance Sheet is the balancing figure and openly carries the period's net profit.

Metal is deliberately kept out — gold has its own weight statement (Account cum Stock);
folding grams into rupees would corrupt both. Closing stock is valued at **cost** from
current inventory, matching the Stock Report's *Value at Cost*.

### Messaging

WhatsApp / SMS / email buttons hand a pre-filled URL to the OS default handler. The app
holds no credentials and sends nothing by itself — you still press send in whichever app
opens.

## Before you trust it — Changeover Check

Every figure here is verified against tests. **That is not the same as being right**, and no
amount of testing makes it the same. The only thing that settles it is running this beside
the books the shop already keeps, over the same period, and seeing whether the two agree.

`test/faults.cjs` injects the failures a market-stall PC actually suffers — a write that
throws half-way, the process vanishing as in a power cut, a truncated or garbage or foreign
backup file, a restore mid-month — and checks the one thing that must never give: the books
do not come out wrong. A failed write leaves nothing behind, a reopened database still
foots and passes an integrity check, a corrupt backup is refused rather than restored, a
real restore round-trips every figure, and the safety copy taken before a restore is itself
a valid book.

`test/changeoverday.cjs` runs the migration itself — a shop with nine customers owing, one
in credit, three suppliers owed, two customers owing *metal*, a goldsmith holding 180 g,
forty tagged pieces and bullion in the safe — enters that position, trades a month, and
reconciles against figures worked out by hand from the old books. Opening balances are the
paths a shop walks exactly once, which is why they rot unnoticed.

**Changeover Check** is the instrument for that. Enter what the existing system says as on a
date — cash, bank, debtors, creditors, gold on hand, stock at cost, GST, scheme deposits —
and it puts its own figure beside each one with the difference, the customer and supplier
lists to chase it through, and a note on where to look.

A blank box reports as **not checked**, never as agreement. An unanswered question is not a
pass, and a reconciliation screen that implies otherwise would be worse than none at all.

## Not yet built

The original was studied further through eight feature-specific demo videos; the
screen-by-screen findings are in [`docs/VIDEO-SPEC-2.md`](docs/VIDEO-SPEC-2.md), which is
the source of truth for this list.

Every gap listed in [`docs/VIDEO-SPEC-2.md`](docs/VIDEO-SPEC-2.md) §14 is now built.

User accounts, roles and permissions *are* built — see `src/pages/Users.tsx` and
`electron/auth.cjs`, with enforcement in the main process.
# jewelery-dashboard
