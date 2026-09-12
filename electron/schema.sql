-- Parivar Jewellery ERP — SQLite schema
-- Modelled on the Manabh Jewellery Desktop ERP flows (see docs/VIDEO-SPEC.md)

PRAGMA foreign_keys = ON;

-- ─────────────────────────── Company / settings ───────────────────────────
CREATE TABLE IF NOT EXISTS company (
  id            INTEGER PRIMARY KEY CHECK (id = 1),
  name          TEXT NOT NULL DEFAULT 'Demo',
  address       TEXT DEFAULT '',
  phone         TEXT DEFAULT '',
  gstin         TEXT DEFAULT '',
  state         TEXT DEFAULT 'Maharashtra',
  bank_name     TEXT DEFAULT '',
  account_no    TEXT DEFAULT '',
  ifsc          TEXT DEFAULT '',
  branch        TEXT DEFAULT '',
  logo          TEXT DEFAULT '',
  fy_start      TEXT NOT NULL DEFAULT '2025-04-01',
  fy_end        TEXT NOT NULL DEFAULT '2026-03-31',
  declaration   TEXT DEFAULT 'I/We hereby certify that my/our registration certificate under the GST Act is in force on the date on which the sale of goods specified in this tax invoice is made by me/us and that the transaction of sale has been effected by me/us and it shall be accounted for in the turnover of sales while filing of return and the due tax, if any, payable shall be paid.'
);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT
);

-- ─────────────────────────── Item masters ───────────────────────────
CREATE TABLE IF NOT EXISTS item_type (
  id   INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS item_group (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT NOT NULL UNIQUE,
  item_type_id  INTEGER REFERENCES item_type(id),
  purity        REAL NOT NULL DEFAULT 91.6   -- default purity % for this group
);

CREATE TABLE IF NOT EXISTS design (
  id   INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE
);

-- ─────────────────────────── Grid Settings ───────────────────────────
-- Per-grid column preferences (visible, order, header text, width). One row per
-- grid, holding JSON, because the shape is a list the user reorders — normalising
-- it into a row per column buys nothing and makes reordering a rewrite of many
-- rows instead of one. Unknown keys in the JSON are ignored on read, so a column
-- removed from the code cannot resurrect itself from an old preference.
CREATE TABLE IF NOT EXISTS grid_pref (
  grid_key TEXT PRIMARY KEY,
  config   TEXT NOT NULL DEFAULT '[]'
);

-- ─────────────────────────── Branches & transfers ───────────────────────────
-- A branch IS a location: `tag_stock.location` already says where a piece is, so
-- a transfer moves that field and leaves a document behind saying who moved what,
-- when and to where. Modelling branches as a separate stock ledger would mean two
-- places could disagree about where one physical ring is.
CREATE TABLE IF NOT EXISTS branch (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  name    TEXT NOT NULL UNIQUE,
  address TEXT DEFAULT '',
  is_main INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS stock_transfer (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  doc_no        TEXT NOT NULL UNIQUE,
  transfer_date TEXT NOT NULL DEFAULT (date('now','localtime')),
  from_branch   TEXT NOT NULL,
  to_branch     TEXT NOT NULL,
  remarks       TEXT DEFAULT '',
  created_at    TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS stock_transfer_item (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  transfer_id   INTEGER NOT NULL REFERENCES stock_transfer(id) ON DELETE CASCADE,
  tag_stock_id  INTEGER NOT NULL REFERENCES tag_stock(id),
  tag           TEXT NOT NULL,
  -- Where the piece was before this document, so deleting it can put it back
  -- rather than guessing.
  from_location TEXT NOT NULL DEFAULT ''
);

-- ─────────────────── Making Master / Wastage Master ───────────────────
-- Default making charges and wastage percentages, so the same numbers are not
-- retyped on every tag, bill and purchase. A rule is set against either an item
-- or an item group; the item's own rule wins over its group's.
--
-- `scope` + `ref_id` rather than two nullable foreign keys: SQLite treats NULLs
-- as distinct, so a UNIQUE across nullable columns would happily allow two
-- "all gold rings" rules to exist at once.
CREATE TABLE IF NOT EXISTS rate_master (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  kind     TEXT NOT NULL CHECK (kind IN ('MAKING','WASTAGE')),
  scope    TEXT NOT NULL CHECK (scope IN ('ITEM','GROUP')),
  ref_id   INTEGER NOT NULL,
  per_gram REAL NOT NULL DEFAULT 0,   -- making ₹ per gram, or wastage %
  flat     REAL NOT NULL DEFAULT 0,   -- making only: flat ₹ per piece
  UNIQUE (kind, scope, ref_id)
);

CREATE TABLE IF NOT EXISTS item (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT NOT NULL,
  item_type_id  INTEGER REFERENCES item_type(id),
  item_group_id INTEGER REFERENCES item_group(id),
  design_id     INTEGER REFERENCES design(id),
  weight_mode   TEXT NOT NULL DEFAULT 'WEIGHT'  CHECK (weight_mode IN ('WEIGHT','QTY')),
  -- How the item is stocked.
  --   TAG      one barcode per physical piece (a ring, a payal) - see tag_stock.
  --   LOOSE_WT bought and sold by weight out of a common lot (mani, fuli, dori).
  --            No tag, no piece identity: 100 g comes in, 10 g goes out, 90 g is
  --            left. The running balance lives in item_stock, and the weight is
  --            NOT metal - it never touches loose_stock or a fine-weight khata.
  stock_mode    TEXT NOT NULL DEFAULT 'TAG'     CHECK (stock_mode IN ('TAG','LOOSE_WT')),
  uom           TEXT NOT NULL DEFAULT 'GRAM',
  hsn           TEXT DEFAULT '7113',
  tag_prefix    TEXT DEFAULT '',   -- auto-derived from first 3 letters of name
  image         TEXT DEFAULT '',
  reorder_level REAL NOT NULL DEFAULT 0,  -- keep at least this many pieces in stock
  is_urd        INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_item_name ON item(name);

-- ─────────────────────────── Tagged stock (barcode) ───────────────────────────
-- One row per physical piece. This IS the stock ledger for tagged goods.
CREATE TABLE IF NOT EXISTS tag_stock (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  tag               TEXT NOT NULL UNIQUE,
  -- Barcode reprint protection. Empty = never printed, which is what the
  -- "Not Printed Only" filter selects.
  label_printed_at  TEXT DEFAULT '',
  label_print_count INTEGER NOT NULL DEFAULT 0,
  item_id           INTEGER NOT NULL REFERENCES item(id),
  gross_wt          REAL NOT NULL DEFAULT 0,
  black_beads       REAL NOT NULL DEFAULT 0,
  bag_wt            REAL NOT NULL DEFAULT 0,   -- the pouch, excluded from net weight
  stone_wt          REAL NOT NULL DEFAULT 0,
  stone_rate        REAL NOT NULL DEFAULT 0,   -- carried onto the bill so a stone piece prices itself
  diamond_wt        REAL NOT NULL DEFAULT 0,
  diamond_rate      REAL NOT NULL DEFAULT 0,
  net_wt            REAL NOT NULL DEFAULT 0,
  purity            REAL NOT NULL DEFAULT 91.6,
  final_wt          REAL NOT NULL DEFAULT 0,   -- fine = net_wt * purity/100
  mkg_per_gm        REAL NOT NULL DEFAULT 0,
  hallmark_charges  REAL NOT NULL DEFAULT 0,
  -- What the piece COST, per gram of fine metal. Cost basis for valuation and
  -- profit; never shown to the customer. 0 = not recorded.
  purchase_rate     REAL NOT NULL DEFAULT 0,
  huid              TEXT DEFAULT '',
  gst_pct           REAL NOT NULL DEFAULT 3,
  qty               REAL NOT NULL DEFAULT 0,
  location          TEXT DEFAULT 'Shop',
  category          TEXT DEFAULT '',   -- e.g. Gents / Ladies / Kids
  salesman          TEXT DEFAULT '',
  shelf_tray        TEXT DEFAULT '',
  size              TEXT DEFAULT '',   -- ring / bangle size, free text
  source            TEXT NOT NULL DEFAULT 'OPENING'
                    CHECK (source IN ('OPENING','PURCHASE','ORDER','REFINERY','URD')),
  -- Which purchase invoice this piece was made from, when it was tagged out of
  -- bought metal. Lets a purchase tally its weight against the labels made.
  purchase_id       INTEGER REFERENCES purchase(id),
  status            TEXT NOT NULL DEFAULT 'IN_STOCK'
                    CHECK (status IN ('IN_STOCK','SOLD','ISSUED','MELTED')),
  sold_doc          TEXT DEFAULT '',
  entry_date        TEXT NOT NULL DEFAULT (date('now','localtime')),
  created_at        TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_tag_status ON tag_stock(status);
CREATE INDEX IF NOT EXISTS idx_tag_item   ON tag_stock(item_id);

-- Loose (untagged) metal stock, by item group. Moved by purchase / refining / URD.
CREATE TABLE IF NOT EXISTS loose_stock (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  item_group_id INTEGER REFERENCES item_group(id),
  metal         TEXT NOT NULL DEFAULT 'Gold',
  gross_wt      REAL NOT NULL DEFAULT 0,
  net_wt        REAL NOT NULL DEFAULT 0,
  fine_wt       REAL NOT NULL DEFAULT 0,
  doc_type      TEXT NOT NULL,
  doc_id        INTEGER,
  doc_no        TEXT DEFAULT '',
  direction     TEXT NOT NULL CHECK (direction IN ('IN','OUT')),
  is_urd        INTEGER NOT NULL DEFAULT 0,
  -- 1 = movement of a tagged piece, 0 = movement of loose (untagged) metal.
  -- Total stock is both; "loose available to tag" is only the zeros.
  is_tagged     INTEGER NOT NULL DEFAULT 0,
  entry_date    TEXT NOT NULL DEFAULT (date('now','localtime'))
);

-- Weight ledger for LOOSE_WT items (mani, fuli, dori). One row per movement, so
-- the balance is a sum and no document has to update a running total.
--
-- Deliberately separate from loose_stock: that table is *metal* - its grams roll
-- into the gold and silver khata and are valued at a fine rate. These items are
-- bought by weight but they are not metal, so mixing them there would inflate
-- the shop's fine-weight position with beads.
CREATE TABLE IF NOT EXISTS item_stock (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id    INTEGER NOT NULL REFERENCES item(id),
  gross_wt   REAL NOT NULL DEFAULT 0,
  qty        REAL NOT NULL DEFAULT 0,   -- pieces, when the shop also counts them
  rate       REAL NOT NULL DEFAULT 0,   -- per gram, on the document that moved it
  amount     REAL NOT NULL DEFAULT 0,
  doc_type   TEXT NOT NULL,             -- OPENING | PURCHASE | SALE | SALE_RETURN | ...
  doc_id     INTEGER,
  doc_no     TEXT DEFAULT '',
  direction  TEXT NOT NULL CHECK (direction IN ('IN','OUT')),
  remark     TEXT DEFAULT '',
  entry_date TEXT NOT NULL DEFAULT (date('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_item_stock_item ON item_stock(item_id);
CREATE INDEX IF NOT EXISTS idx_item_stock_doc  ON item_stock(doc_type, doc_id);


-- ─────────────────────────── Parties (CRM) ───────────────────────────
CREATE TABLE IF NOT EXISTS party (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  party_type       TEXT NOT NULL DEFAULT 'CUSTOMER'
                   CHECK (party_type IN ('CUSTOMER','SUPPLIER','KARAGIR','REFINERY')),
  name             TEXT NOT NULL,
  district         TEXT DEFAULT '',
  taluka           TEXT DEFAULT '',
  city             TEXT DEFAULT '',
  area             TEXT DEFAULT '',
  address          TEXT DEFAULT '',
  whatsapp         TEXT DEFAULT '',
  mobile           TEXT DEFAULT '',
  birth_date       TEXT DEFAULT '',
  anniversary      TEXT DEFAULT '',
  email            TEXT DEFAULT '',
  ref_name         TEXT DEFAULT '',
  aadhaar          TEXT DEFAULT '',
  pan              TEXT DEFAULT '',
  gstin            TEXT DEFAULT '',
  state            TEXT DEFAULT 'Maharashtra',
  regi_number      TEXT DEFAULT '',
  opening_balance  REAL NOT NULL DEFAULT 0,
  opening_dr_cr    TEXT NOT NULL DEFAULT 'Dr' CHECK (opening_dr_cr IN ('Dr','Cr')),
  loyalty_enabled  INTEGER NOT NULL DEFAULT 0,
  loyalty_points   REAL NOT NULL DEFAULT 0,
  show_in_purchase INTEGER NOT NULL DEFAULT 0,
  photo            TEXT DEFAULT '',
  created_at       TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_party_name ON party(name);
CREATE INDEX IF NOT EXISTS idx_party_type ON party(party_type);

-- Opening metal balance per party (Gold / Silver / Stone / Platinum)
CREATE TABLE IF NOT EXISTS party_metal_opening (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  party_id INTEGER NOT NULL REFERENCES party(id) ON DELETE CASCADE,
  metal    TEXT NOT NULL,
  weight   REAL NOT NULL DEFAULT 0,
  dr_cr    TEXT NOT NULL DEFAULT 'Dr' CHECK (dr_cr IN ('Dr','Cr'))
);

-- ─────────────────────────── Accounts ───────────────────────────
CREATE TABLE IF NOT EXISTS account (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  code            TEXT UNIQUE,
  name            TEXT NOT NULL UNIQUE,
  acc_type        TEXT DEFAULT 'Cash',
  acc_group       TEXT DEFAULT '',
  opening_balance REAL NOT NULL DEFAULT 0,
  opening_dr_cr   TEXT NOT NULL DEFAULT 'Dr' CHECK (opening_dr_cr IN ('Dr','Cr')),
  is_system       INTEGER NOT NULL DEFAULT 0,
  -- Card-swipe fee handling on a bank account. The fee is split: part passed on
  -- to the customer, part absorbed by the shop as an expense.
  is_card_swap      INTEGER NOT NULL DEFAULT 0,
  card_pct_customer REAL NOT NULL DEFAULT 0,
  card_pct_shop     REAL NOT NULL DEFAULT 0
);

-- Document numbering series, e.g. COM / ESM / Service / MI / MO / O / VR
CREATE TABLE IF NOT EXISTS voucher_series (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  doc_type TEXT NOT NULL,
  prefix   TEXT NOT NULL,
  next_no  INTEGER NOT NULL DEFAULT 1,
  label    TEXT DEFAULT '',
  UNIQUE (doc_type, prefix)
);

-- ─────────────────────────── Sales ───────────────────────────
CREATE TABLE IF NOT EXISTS sale (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  prefix             TEXT NOT NULL DEFAULT 'COM',
  bill_no            TEXT NOT NULL,
  manual_no          TEXT DEFAULT '',
  bill_date          TEXT NOT NULL,
  due_date           TEXT DEFAULT '',
  party_id           INTEGER REFERENCES party(id),
  party_name         TEXT DEFAULT '',
  address            TEXT DEFAULT '',
  mobile             TEXT DEFAULT '',
  area               TEXT DEFAULT '',
  state              TEXT DEFAULT 'Maharashtra',
  salesman           TEXT DEFAULT '',
  is_credit          INTEGER NOT NULL DEFAULT 0,
  payment_mode       TEXT DEFAULT 'Cash Payment',
  gst_not_required   INTEGER NOT NULL DEFAULT 0,
  weightwise         INTEGER NOT NULL DEFAULT 0,
  -- money
  goods_amount       REAL NOT NULL DEFAULT 0,  -- sum(total_amount)
  making_amount      REAL NOT NULL DEFAULT 0,  -- sum(mkg_amount)
  hallmark_amount    REAL NOT NULL DEFAULT 0,
  bill_amount        REAL NOT NULL DEFAULT 0,  -- goods + making + hallmark
  gst_pct            REAL NOT NULL DEFAULT 3,
  gst_amount         REAL NOT NULL DEFAULT 0,
  bill_discount      REAL NOT NULL DEFAULT 0,
  making_discount    REAL NOT NULL DEFAULT 0,
  other_amount       REAL NOT NULL DEFAULT 0,
  urd_amount         REAL NOT NULL DEFAULT 0,  -- old gold taken from customer
  manual_urd_amount  REAL NOT NULL DEFAULT 0,
  tcs_pct            REAL NOT NULL DEFAULT 0,
  tcs_amount         REAL NOT NULL DEFAULT 0,
  total_amount       REAL NOT NULL DEFAULT 0,  -- bill + gst - discounts + tcs
  amount_received    REAL NOT NULL DEFAULT 0,
  net_balance        REAL NOT NULL DEFAULT 0,
  loyalty_earned     REAL NOT NULL DEFAULT 0,   -- points this bill earned
  loyalty_redeemed   REAL NOT NULL DEFAULT 0,   -- points spent on this bill
  loyalty_discount   REAL NOT NULL DEFAULT 0,   -- rupee value of the redeemed points
  -- Gold Saving Scheme redemption. Unlike loyalty, a scheme balance is money the
  -- shop already holds as a liability, so it settles the bill AFTER tax rather
  -- than discounting the taxable value.
  gss_id             INTEGER REFERENCES gss_account(id),
  gss_amount         REAL NOT NULL DEFAULT 0,   -- scheme money applied to this bill
  gss_weight         REAL NOT NULL DEFAULT 0,   -- grams consumed (weight schemes)
  gss_rate           REAL NOT NULL DEFAULT 0,   -- rate used to value those grams
  gss_return         REAL NOT NULL DEFAULT 0,   -- leftover balance handed back in cash
  -- Card-swipe fee, split between what the customer pays and what the shop bears.
  card_charge_customer REAL NOT NULL DEFAULT 0,
  card_charge_shop     REAL NOT NULL DEFAULT 0,
  making_disc_pct      REAL NOT NULL DEFAULT 0,  -- making discount as a % of making
  created_at         TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  UNIQUE (prefix, bill_no)
);
CREATE INDEX IF NOT EXISTS idx_sale_date  ON sale(bill_date);
CREATE INDEX IF NOT EXISTS idx_sale_party ON sale(party_id);

CREATE TABLE IF NOT EXISTS sale_item (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  sale_id          INTEGER NOT NULL REFERENCES sale(id) ON DELETE CASCADE,
  line_no          INTEGER NOT NULL DEFAULT 1,
  tag              TEXT DEFAULT '',
  tag_stock_id     INTEGER REFERENCES tag_stock(id),
  item_id          INTEGER REFERENCES item(id),
  item_name        TEXT NOT NULL,
  hsn              TEXT DEFAULT '',
  qty              REAL NOT NULL DEFAULT 0,
  gross_wt         REAL NOT NULL DEFAULT 0,
  purity           REAL NOT NULL DEFAULT 0,
  stone_wt         REAL NOT NULL DEFAULT 0,
  stone_rate       REAL NOT NULL DEFAULT 0,   -- price per unit weight of the stone
  stone_amount     REAL NOT NULL DEFAULT 0,   -- stone_wt x stone_rate
  diamond_wt       REAL NOT NULL DEFAULT 0,   -- diamonds, out of the metal like stones
  diamond_rate     REAL NOT NULL DEFAULT 0,
  diamond_amount   REAL NOT NULL DEFAULT 0,   -- diamond_wt x diamond_rate
  net_wt           REAL NOT NULL DEFAULT 0,
  rate_per_gm      REAL NOT NULL DEFAULT 0,
  mkg_per_gm       REAL NOT NULL DEFAULT 0,
  -- Making charged as a percentage of the metal value (net_wt x rate_per_gm),
  -- the alternative to a flat per-gram figure. 0 = not used.
  mkg_pct          REAL NOT NULL DEFAULT 0,
  mkg_amount       REAL NOT NULL DEFAULT 0,
  total_amount     REAL NOT NULL DEFAULT 0,
  hallmark_charges REAL NOT NULL DEFAULT 0,
  huid             TEXT DEFAULT '',
  item_total       REAL NOT NULL DEFAULT 0
);

-- Old-gold / URD purchased from the customer inside a sale bill
CREATE TABLE IF NOT EXISTS sale_urd (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  sale_id     INTEGER REFERENCES sale(id) ON DELETE CASCADE,
  urd_bill_id INTEGER,
  line_no     INTEGER NOT NULL DEFAULT 1,
  code        TEXT DEFAULT '',
  name        TEXT NOT NULL DEFAULT 'Old Gold',
  description TEXT DEFAULT '',
  gross_wt    REAL NOT NULL DEFAULT 0,
  net_wt      REAL NOT NULL DEFAULT 0,
  purity      REAL NOT NULL DEFAULT 0,
  final_wt    REAL NOT NULL DEFAULT 0,  -- net_wt * purity/100
  rate        REAL NOT NULL DEFAULT 0,
  amount      REAL NOT NULL DEFAULT 0   -- final_wt * rate
);

-- How the money on a bill was actually tendered, when it came in more than one
-- way — half UPI and half cash, say. The bill's own `payment_mode` still names
-- the single mode used when there is no split, so an ordinary counter sale is
-- stored exactly as before and nothing here is written at all.
--
-- The rows must add up to the bill's `amount_received`; the save refuses them
-- otherwise, because a split that does not foot would put money in the drawer
-- that the bill never took.
CREATE TABLE IF NOT EXISTS sale_payment (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  sale_id  INTEGER NOT NULL REFERENCES sale(id) ON DELETE CASCADE,
  line_no  INTEGER NOT NULL DEFAULT 1,
  mode     TEXT NOT NULL DEFAULT 'Cash',
  amount   REAL NOT NULL DEFAULT 0,
  -- UPI reference, cheque number, last four digits of the card — whatever the
  -- shop needs to tie this leg back to its bank statement.
  ref      TEXT DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_sale_payment_sale ON sale_payment(sale_id);

-- ────────────── Karagir job work (docs/VIDEO-SPEC-2.md §10) ──────────────
-- Metal issued to a goldsmith and metal received back as finished pieces. This
-- reconciliation IS the loss-prevention control of the trade: what went out, what
-- came back, and how much was legitimately lost as wastage.
--
--   shortfall = fine issued - fine received - wastage allowed
--
-- A karagir's metal balance is kept on the same `metal_entry` ledger as everyone
-- else, so "what does this goldsmith hold of mine" is answerable at any moment.
CREATE TABLE IF NOT EXISTS karagir_issue (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  prefix        TEXT NOT NULL DEFAULT 'KI',
  issue_no      TEXT NOT NULL,
  issue_date    TEXT NOT NULL DEFAULT (date('now','localtime')),
  metal            TEXT NOT NULL DEFAULT 'Gold',
  order_id      INTEGER REFERENCES order_booking(id),
  sub_order_no  TEXT DEFAULT '',
  karagir_id    INTEGER NOT NULL REFERENCES party(id),
  karagir_name  TEXT DEFAULT '',
  item_name     TEXT DEFAULT '',
  description   TEXT DEFAULT '',
  qty           REAL NOT NULL DEFAULT 0,
  gross_wt      REAL NOT NULL DEFAULT 0,
  less_wt       REAL NOT NULL DEFAULT 0,
  net_wt        REAL NOT NULL DEFAULT 0,
  purity        REAL NOT NULL DEFAULT 0,
  fine_wt       REAL NOT NULL DEFAULT 0,
  wastage_pct   REAL NOT NULL DEFAULT 0,
  remark        TEXT DEFAULT '',
  created_at    TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  UNIQUE (prefix, issue_no)
);
CREATE INDEX IF NOT EXISTS idx_ki_karagir ON karagir_issue(karagir_id);

CREATE TABLE IF NOT EXISTS karagir_receive (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  prefix         TEXT NOT NULL DEFAULT 'KR',
  receive_no     TEXT NOT NULL,
  receive_date   TEXT NOT NULL DEFAULT (date('now','localtime')),
  metal            TEXT NOT NULL DEFAULT 'Gold',
  order_id       INTEGER REFERENCES order_booking(id),
  sub_order_no   TEXT DEFAULT '',
  karagir_id     INTEGER NOT NULL REFERENCES party(id),
  karagir_name   TEXT DEFAULT '',
  item_name      TEXT DEFAULT '',
  qty            REAL NOT NULL DEFAULT 0,
  gross_wt       REAL NOT NULL DEFAULT 0,
  less_wt        REAL NOT NULL DEFAULT 0,
  stone_wt       REAL NOT NULL DEFAULT 0,
  diamond_wt     REAL NOT NULL DEFAULT 0,
  net_wt         REAL NOT NULL DEFAULT 0,
  purity         REAL NOT NULL DEFAULT 0,
  fine_wt        REAL NOT NULL DEFAULT 0,
  wastage_pct    REAL NOT NULL DEFAULT 0,
  wastage_wt     REAL NOT NULL DEFAULT 0,   -- fine metal allowed as loss
  -- What the goldsmith is paid for the labour
  rate_per_gm    REAL NOT NULL DEFAULT 0,
  labour_amount  REAL NOT NULL DEFAULT 0,
  discount       REAL NOT NULL DEFAULT 0,
  tds_pct        REAL NOT NULL DEFAULT 0,
  tds_amount     REAL NOT NULL DEFAULT 0,
  final_amount   REAL NOT NULL DEFAULT 0,
  paid_amount    REAL NOT NULL DEFAULT 0,
  pending_amount REAL NOT NULL DEFAULT 0,
  remark         TEXT DEFAULT '',
  created_at     TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  UNIQUE (prefix, receive_no)
);
CREATE INDEX IF NOT EXISTS idx_kr_karagir ON karagir_receive(karagir_id);

-- ─────────────────────────── Returns (docs/VIDEO-SPEC-2.md §4) ───────────────────────────
-- Returns are their own documents, not edits to the original bill. Once a bill is
-- printed and reported, reversing it by deletion falsifies history; a return is a
-- new dated event that reverses stock, money and metal on the day it happens.
--
-- Series are SR / PR. The original uses MO for purchase return, but MO is already
-- the refinery-out series here, so the prefixes differ from the video by necessity.
CREATE TABLE IF NOT EXISTS sale_return (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  prefix          TEXT NOT NULL DEFAULT 'SR',
  return_no       TEXT NOT NULL,
  manual_no       TEXT DEFAULT '',
  return_date     TEXT NOT NULL DEFAULT (date('now','localtime')),
  party_id        INTEGER REFERENCES party(id),
  party_name      TEXT DEFAULT '',
  against_sale_id INTEGER REFERENCES sale(id),
  against_bill_no TEXT DEFAULT '',
  reason          TEXT DEFAULT '',
  goods_amount    REAL NOT NULL DEFAULT 0,
  making_amount   REAL NOT NULL DEFAULT 0,
  gst_pct         REAL NOT NULL DEFAULT 0,
  gst_amount      REAL NOT NULL DEFAULT 0,
  bill_amount     REAL NOT NULL DEFAULT 0,   -- goods + making
  total_amount    REAL NOT NULL DEFAULT 0,   -- bill + gst, credited to the customer
  refund_amount   REAL NOT NULL DEFAULT 0,   -- cash handed back now
  created_at      TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  UNIQUE (prefix, return_no)
);

CREATE TABLE IF NOT EXISTS sale_return_item (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  return_id     INTEGER REFERENCES sale_return(id) ON DELETE CASCADE,
  line_no       INTEGER NOT NULL DEFAULT 1,
  tag           TEXT DEFAULT '',
  tag_stock_id  INTEGER REFERENCES tag_stock(id),
  item_id       INTEGER REFERENCES item(id),
  item_name     TEXT DEFAULT '',
  qty           REAL NOT NULL DEFAULT 0,
  gross_wt      REAL NOT NULL DEFAULT 0,
  stone_wt      REAL NOT NULL DEFAULT 0,
  net_wt        REAL NOT NULL DEFAULT 0,
  purity        REAL NOT NULL DEFAULT 0,
  final_wt      REAL NOT NULL DEFAULT 0,
  rate_per_gm   REAL NOT NULL DEFAULT 0,
  mkg_per_gm    REAL NOT NULL DEFAULT 0,
  mkg_amount    REAL NOT NULL DEFAULT 0,
  total_amount  REAL NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_sret_item ON sale_return_item(return_id);

CREATE TABLE IF NOT EXISTS purchase_return (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  prefix              TEXT NOT NULL DEFAULT 'PR',
  return_no           TEXT NOT NULL,
  manual_no           TEXT DEFAULT '',
  return_date         TEXT NOT NULL DEFAULT (date('now','localtime')),
  party_id            INTEGER REFERENCES party(id),
  party_name          TEXT DEFAULT '',
  metal               TEXT NOT NULL DEFAULT 'Gold',
  against_purchase_id INTEGER REFERENCES purchase(id),
  against_invoice_no  TEXT DEFAULT '',
  reason              TEXT DEFAULT '',
  goods_amount        REAL NOT NULL DEFAULT 0,
  gst_pct             REAL NOT NULL DEFAULT 0,
  gst_amount          REAL NOT NULL DEFAULT 0,
  bill_amount         REAL NOT NULL DEFAULT 0,
  total_amount        REAL NOT NULL DEFAULT 0,  -- debited back to the supplier
  received_amount     REAL NOT NULL DEFAULT 0,  -- cash taken back now
  created_at          TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  UNIQUE (prefix, return_no)
);

CREATE TABLE IF NOT EXISTS purchase_return_item (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  return_id    INTEGER REFERENCES purchase_return(id) ON DELETE CASCADE,
  line_no      INTEGER NOT NULL DEFAULT 1,
  -- Which master item went back. Only a name was kept before, which was enough
  -- for metal (the weight is metal whatever it is called) but not for a loose
  -- item, whose weight has to come off that item's own lot.
  item_id      INTEGER REFERENCES item(id),
  item_name    TEXT DEFAULT '',
  qty          REAL NOT NULL DEFAULT 0,
  gross_wt     REAL NOT NULL DEFAULT 0,
  stone_wt     REAL NOT NULL DEFAULT 0,
  net_wt       REAL NOT NULL DEFAULT 0,
  purity       REAL NOT NULL DEFAULT 0,
  final_wt     REAL NOT NULL DEFAULT 0,
  rate_per_gm  REAL NOT NULL DEFAULT 0,
  total_amount REAL NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_pret_item ON purchase_return_item(return_id);

-- Stock Cash Settlement (docs/VIDEO-SPEC-2.md §3) — the bridge between the two
-- party balances. Metal moves one way on the books and money the other, which is
-- the only way a metal balance can ever be closed out in rupees.
--   direction OUT = metal leaves us for the party, so we owe them money
--   direction IN  = metal comes to us,            so they owe us money
-- It settles the ACCOUNT, not the shelf: physical stock is unchanged, because the
-- metal itself moved earlier on its own purchase / refining / sale document.
CREATE TABLE IF NOT EXISTS stock_settlement (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  prefix        TEXT NOT NULL DEFAULT 'SO',
  settle_no     TEXT NOT NULL,
  manual_no     TEXT DEFAULT '',
  settle_date   TEXT NOT NULL DEFAULT (date('now','localtime')),
  party_id      INTEGER REFERENCES party(id),
  party_name    TEXT DEFAULT '',
  metal         TEXT NOT NULL DEFAULT 'Gold',
  direction     TEXT NOT NULL DEFAULT 'OUT' CHECK (direction IN ('IN','OUT')),
  fine_wt       REAL NOT NULL DEFAULT 0,
  rate_per_gm   REAL NOT NULL DEFAULT 0,
  making_amount REAL NOT NULL DEFAULT 0,
  amount        REAL NOT NULL DEFAULT 0,   -- fine_wt * rate_per_gm + making_amount
  gst_pct       REAL NOT NULL DEFAULT 0,
  gst_amount    REAL NOT NULL DEFAULT 0,
  bill_amount   REAL NOT NULL DEFAULT 0,   -- amount + gst_amount
  paid_amount   REAL NOT NULL DEFAULT 0,
  narration     TEXT DEFAULT '',
  created_at    TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_settle_party ON stock_settlement(party_id);

-- Weightwise ("metal basis") settlement, one row per metal on a sale.
-- Only written when sale.weightwise = 1. pending_wt is a METAL receivable —
-- the customer still owes that many fine grams; it is not a money balance.
CREATE TABLE IF NOT EXISTS sale_metal (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  sale_id     INTEGER REFERENCES sale(id) ON DELETE CASCADE,
  metal       TEXT NOT NULL DEFAULT 'Gold',
  fine_sold   REAL NOT NULL DEFAULT 0,  -- fine weight of the goods sold
  fine_urd    REAL NOT NULL DEFAULT 0,  -- fine weight of old gold taken in
  fine_wt     REAL NOT NULL DEFAULT 0,  -- fine_sold - fine_urd, the metal owed
  balance_wt  REAL NOT NULL DEFAULT 0,  -- how much of it is settled in cash now
  rate_per_gm REAL NOT NULL DEFAULT 0,
  amount      REAL NOT NULL DEFAULT 0,  -- balance_wt * rate_per_gm
  pending_wt  REAL NOT NULL DEFAULT 0   -- fine_wt - balance_wt, still owed as metal
);
CREATE INDEX IF NOT EXISTS idx_sale_metal ON sale_metal(sale_id);

-- Standalone URD purchase bill (customer sells old gold, no sale attached)
CREATE TABLE IF NOT EXISTS urd_bill (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  prefix          TEXT NOT NULL DEFAULT 'O',
  bill_no         TEXT NOT NULL,
  manual_no       TEXT DEFAULT '',
  bill_date       TEXT NOT NULL,
  party_id        INTEGER REFERENCES party(id),
  party_name      TEXT DEFAULT '',
  by_hand         TEXT DEFAULT '',
  address         TEXT DEFAULT '',
  mobile          TEXT DEFAULT '',
  state           TEXT DEFAULT 'Maharashtra',
  is_credit       INTEGER NOT NULL DEFAULT 0,
  purchase_amount REAL NOT NULL DEFAULT 0,
  sub_tax         REAL NOT NULL DEFAULT 0,
  discount        REAL NOT NULL DEFAULT 0,
  other_amount    REAL NOT NULL DEFAULT 0,
  gst_amount      REAL NOT NULL DEFAULT 0,
  amount_given    REAL NOT NULL DEFAULT 0,
  net_balance     REAL NOT NULL DEFAULT 0,
  created_at      TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  UNIQUE (prefix, bill_no)
);

-- ─────────────────────────── Purchase ───────────────────────────
CREATE TABLE IF NOT EXISTS purchase (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  prefix           TEXT NOT NULL DEFAULT 'MI',
  invoice_no       TEXT NOT NULL,
  manual_no        TEXT DEFAULT '',
  invoice_date     TEXT NOT NULL,
  metal            TEXT NOT NULL DEFAULT 'Gold',
  party_id         INTEGER REFERENCES party(id),
  party_name       TEXT DEFAULT '',
  remark           TEXT DEFAULT '',
  state            TEXT DEFAULT 'Maharashtra',
  is_credit        INTEGER NOT NULL DEFAULT 1,
  gst_not_required INTEGER NOT NULL DEFAULT 0,
  purchase_amount  REAL NOT NULL DEFAULT 0,
  discount         REAL NOT NULL DEFAULT 0,
  return_amount    REAL NOT NULL DEFAULT 0,
  gst_pct          REAL NOT NULL DEFAULT 3,
  gst_amount       REAL NOT NULL DEFAULT 0,
  sub_tax          REAL NOT NULL DEFAULT 0,
  tcs_pct          REAL NOT NULL DEFAULT 0,
  tcs_amount       REAL NOT NULL DEFAULT 0,
  bill_amount      REAL NOT NULL DEFAULT 0,
  paid_amount      REAL NOT NULL DEFAULT 0,
  -- Settled in fine metal instead of money: grams handed to the supplier at an
  -- agreed rate. The value comes off the balance like cash; the grams go OUT of
  -- the loose pool and onto the supplier's gold khata.
  paid_fine_wt     REAL NOT NULL DEFAULT 0,
  paid_fine_rate   REAL NOT NULL DEFAULT 0,   -- per gram
  paid_fine_amount REAL NOT NULL DEFAULT 0,
  net_balance      REAL NOT NULL DEFAULT 0,
  created_at       TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  UNIQUE (prefix, invoice_no)
);

CREATE TABLE IF NOT EXISTS purchase_item (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  purchase_id      INTEGER NOT NULL REFERENCES purchase(id) ON DELETE CASCADE,
  line_no          INTEGER NOT NULL DEFAULT 1,
  direction        TEXT NOT NULL DEFAULT 'IN' CHECK (direction IN ('IN','OUT')),
  item_id          INTEGER REFERENCES item(id),
  item_name        TEXT NOT NULL,
  qty              REAL NOT NULL DEFAULT 0,
  gross_wt         REAL NOT NULL DEFAULT 0,
  black_beads      REAL NOT NULL DEFAULT 0,
  stone_wt         REAL NOT NULL DEFAULT 0,
  net_wt           REAL NOT NULL DEFAULT 0,
  purity           REAL NOT NULL DEFAULT 0,
  rate             REAL NOT NULL DEFAULT 0,
  amount           REAL NOT NULL DEFAULT 0,
  wastage_pct      REAL NOT NULL DEFAULT 0,
  fine_plus_wastage REAL NOT NULL DEFAULT 0,
  hallmark_charges REAL NOT NULL DEFAULT 0,
  hallmark_amount  REAL NOT NULL DEFAULT 0,
  huid             TEXT DEFAULT ''
);

-- ─────────────────────────── Refining ───────────────────────────
CREATE TABLE IF NOT EXISTS refinery (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  prefix       TEXT NOT NULL DEFAULT 'MO',
  invoice_no   TEXT NOT NULL,
  manual_no    TEXT DEFAULT '',
  invoice_date TEXT NOT NULL,
  metal            TEXT NOT NULL DEFAULT 'Gold',
  direction    TEXT NOT NULL DEFAULT 'OUT' CHECK (direction IN ('IN','OUT')),
  party_id     INTEGER REFERENCES party(id),
  party_name   TEXT DEFAULT '',
  remark       TEXT DEFAULT '',
  state        TEXT DEFAULT 'Maharashtra',
  is_credit    INTEGER NOT NULL DEFAULT 1,
  bill_amount  REAL NOT NULL DEFAULT 0,
  discount     REAL NOT NULL DEFAULT 0,
  sub_tax      REAL NOT NULL DEFAULT 0,
  gst_amount   REAL NOT NULL DEFAULT 0,
  paid_amount  REAL NOT NULL DEFAULT 0,
  net_balance  REAL NOT NULL DEFAULT 0,
  created_at   TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  UNIQUE (prefix, invoice_no)
);

CREATE TABLE IF NOT EXISTS refinery_item (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  refinery_id  INTEGER NOT NULL REFERENCES refinery(id) ON DELETE CASCADE,
  line_no      INTEGER NOT NULL DEFAULT 1,
  tag          TEXT DEFAULT '',
  item_id      INTEGER REFERENCES item(id),
  item_name    TEXT NOT NULL,
  qty          REAL NOT NULL DEFAULT 0,
  gross_wt     REAL NOT NULL DEFAULT 0,
  black_beads  REAL NOT NULL DEFAULT 0,
  stone_wt     REAL NOT NULL DEFAULT 0,
  net_wt       REAL NOT NULL DEFAULT 0,
  purity       REAL NOT NULL DEFAULT 0,
  fine_wt      REAL NOT NULL DEFAULT 0,
  rate_per_gm  REAL NOT NULL DEFAULT 0,
  amount       REAL NOT NULL DEFAULT 0,
  gross_wastage REAL NOT NULL DEFAULT 0
);

-- ─────────────────────────── Receipts / payments ───────────────────────────
CREATE TABLE IF NOT EXISTS voucher (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  kind         TEXT NOT NULL CHECK (kind IN ('RECEIPT','PAYMENT')),
  prefix       TEXT NOT NULL DEFAULT 'VR',
  voucher_no   TEXT NOT NULL,
  manual_no    TEXT DEFAULT '',
  voucher_date TEXT NOT NULL,
  party_id     INTEGER REFERENCES party(id),
  party_name   TEXT DEFAULT '',
  account_id   INTEGER REFERENCES account(id),
  amount       REAL NOT NULL DEFAULT 0,
  narration    TEXT DEFAULT '',
  payment_type TEXT DEFAULT 'Cash',
  bank_name    TEXT DEFAULT '',
  ref_no       TEXT DEFAULT '',
  ref_date     TEXT DEFAULT '',
  created_at   TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  UNIQUE (prefix, voucher_no)
);

-- ─────────────────────────── Ledgers ───────────────────────────
-- Money ledger: every posting that moves a party or account balance.
CREATE TABLE IF NOT EXISTS ledger_entry (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  entry_date  TEXT NOT NULL,
  party_id    INTEGER REFERENCES party(id),
  account_id  INTEGER REFERENCES account(id),
  doc_type    TEXT NOT NULL,      -- SALE / PURCHASE / RECEIPT / PAYMENT / URD / OPENING / REFINERY
  doc_id      INTEGER,
  doc_no      TEXT DEFAULT '',
  manual_no   TEXT DEFAULT '',
  particulars TEXT NOT NULL,
  debit       REAL NOT NULL DEFAULT 0,
  credit      REAL NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_ledger_party ON ledger_entry(party_id, entry_date);
CREATE INDEX IF NOT EXISTS idx_ledger_acct  ON ledger_entry(account_id, entry_date);
CREATE INDEX IF NOT EXISTS idx_ledger_date  ON ledger_entry(entry_date);

-- Metal ledger: fine-weight movement per party (gold khata).
CREATE TABLE IF NOT EXISTS metal_entry (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  entry_date  TEXT NOT NULL,
  party_id    INTEGER REFERENCES party(id),
  metal       TEXT NOT NULL DEFAULT 'Gold',
  doc_type    TEXT NOT NULL,
  doc_id      INTEGER,
  doc_no      TEXT DEFAULT '',
  particulars TEXT DEFAULT '',
  fine_in     REAL NOT NULL DEFAULT 0,
  fine_out    REAL NOT NULL DEFAULT 0
);

-- ─────────────────────────── Orders (Karagir) ───────────────────────────
CREATE TABLE IF NOT EXISTS order_booking (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  prefix        TEXT NOT NULL DEFAULT 'NO',
  order_no      TEXT NOT NULL,
  order_date    TEXT NOT NULL,
  delivery_date TEXT DEFAULT '',    -- what the customer was promised
  karagir_date  TEXT DEFAULT '',    -- when the karagir must hand it back to the shop
  party_id      INTEGER REFERENCES party(id),
  party_name    TEXT DEFAULT '',
  karagir_id    INTEGER REFERENCES party(id),
  remark        TEXT DEFAULT '',
  status        TEXT NOT NULL DEFAULT 'BOOKED'
                CHECK (status IN ('BOOKED','ISSUED','RECEIVED','DELIVERED','CANCELLED')),
  -- The bill this order became, once it was delivered. It is the ONLY link back:
  -- the advance lives on the order and the bill counts on it, so if that bill is
  -- ever cancelled the order has to be found and re-opened.
  sale_id       INTEGER REFERENCES sale(id),
  total_amount  REAL NOT NULL DEFAULT 0,
  advance_amount REAL NOT NULL DEFAULT 0,
  balance_amount REAL NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  UNIQUE (prefix, order_no)
);

CREATE TABLE IF NOT EXISTS order_item (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id         INTEGER NOT NULL REFERENCES order_booking(id) ON DELETE CASCADE,
  line_no          INTEGER NOT NULL DEFAULT 1,
  tag              TEXT DEFAULT '',
  item_id          INTEGER REFERENCES item(id),
  item_name        TEXT NOT NULL,
  qty              REAL NOT NULL DEFAULT 0,
  gross_wt         REAL NOT NULL DEFAULT 0,
  black_beads      REAL NOT NULL DEFAULT 0,
  stone_wt         REAL NOT NULL DEFAULT 0,
  net_wt           REAL NOT NULL DEFAULT 0,
  purity           REAL NOT NULL DEFAULT 0,
  fine_wt          REAL NOT NULL DEFAULT 0,
  mkg_per_gm       REAL NOT NULL DEFAULT 0,
  mkg_amount       REAL NOT NULL DEFAULT 0,
  hallmark_charges REAL NOT NULL DEFAULT 0,
  rate_per_gm      REAL NOT NULL DEFAULT 0,
  amount           REAL NOT NULL DEFAULT 0,
  picture          TEXT DEFAULT ''
);

-- Old gold the customer hands over at booking time. Mirrors sale_urd; on
-- delivery these rows carry into the invoice as its URD lines. Held here (not
-- on the money ledger) because an order is not a sale — only the metal deposit
-- posts to the customer's gold khata while the order is open.
CREATE TABLE IF NOT EXISTS order_urd (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id   INTEGER NOT NULL REFERENCES order_booking(id) ON DELETE CASCADE,
  line_no    INTEGER NOT NULL DEFAULT 1,
  item_name  TEXT NOT NULL DEFAULT 'Old Gold',
  gross_wt   REAL NOT NULL DEFAULT 0,
  less_wt    REAL NOT NULL DEFAULT 0,
  net_wt     REAL NOT NULL DEFAULT 0,
  purity     REAL NOT NULL DEFAULT 0,
  final_wt   REAL NOT NULL DEFAULT 0,   -- fine weight = net x purity
  rate       REAL NOT NULL DEFAULT 0,
  amount     REAL NOT NULL DEFAULT 0
);

-- ─────────────────────────── Gold Saving Scheme ───────────────────────────
-- Four scheme types, and the difference between them is what the member is
-- really accumulating:
--   On Amount   fixed rupees per period; the balance is rupees.
--   On Making   fixed rupees per period; the balance is rupees, and the shop's
--               benefit is a making-charge waiver instead of a rupee bonus.
--   On Weight   fixed rupees per period, converted to grams at the rate on the
--               day it is paid; the balance is grams, so the member is hedged
--               against the metal rate rising.
--   Weight Wise fixed grams per period; the member pays whatever those grams
--               cost that day, so the rupees vary and the grams do not.
CREATE TABLE IF NOT EXISTS gss_scheme (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  code           TEXT NOT NULL UNIQUE,
  name           TEXT NOT NULL,
  scheme_type    TEXT NOT NULL DEFAULT 'On Amount',
  period_unit    TEXT NOT NULL DEFAULT 'Months',
  total_periods  INTEGER NOT NULL DEFAULT 12,
  paying_periods INTEGER NOT NULL DEFAULT 11,
  bonus_periods  INTEGER NOT NULL DEFAULT 1,
  monthly_amount REAL NOT NULL DEFAULT 0,
  maturity_bonus REAL NOT NULL DEFAULT 0,
  metal          TEXT NOT NULL DEFAULT 'Gold',
  monthly_weight REAL NOT NULL DEFAULT 0,  -- grams per period (Weight Wise)
  bonus_weight   REAL NOT NULL DEFAULT 0,  -- benefit in grams (weight schemes)
  making_disc_pct REAL NOT NULL DEFAULT 0  -- making waiver % (On Making)
);

CREATE TABLE IF NOT EXISTS gss_account (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  gs_no          TEXT NOT NULL UNIQUE,
  manual_no      TEXT DEFAULT '',
  scheme_id      INTEGER NOT NULL REFERENCES gss_scheme(id),
  party_id       INTEGER NOT NULL REFERENCES party(id),
  start_date     TEXT NOT NULL,
  maturity_date  TEXT NOT NULL,
  duration       INTEGER NOT NULL DEFAULT 12,
  paying_periods INTEGER NOT NULL DEFAULT 11,
  interest       REAL NOT NULL DEFAULT 0,
  monthly_amount REAL NOT NULL DEFAULT 0,
  maturity_bonus REAL NOT NULL DEFAULT 0,
  remarks        TEXT DEFAULT '',
  closed         INTEGER NOT NULL DEFAULT 0,
  -- The scheme's terms are copied onto the account at enrolment so that later
  -- edits to the template never rewrite what an existing member signed up for.
  scheme_type    TEXT NOT NULL DEFAULT 'On Amount',
  period_unit    TEXT NOT NULL DEFAULT 'Months',
  metal          TEXT NOT NULL DEFAULT 'Gold',
  monthly_weight REAL NOT NULL DEFAULT 0,
  bonus_weight   REAL NOT NULL DEFAULT 0,
  making_disc_pct REAL NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS gss_receipt (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  gss_id        INTEGER NOT NULL REFERENCES gss_account(id) ON DELETE CASCADE,
  receipt_no    TEXT NOT NULL,
  manual_no     TEXT DEFAULT '',
  due_date      TEXT NOT NULL,
  received_date TEXT DEFAULT '',
  amount        REAL NOT NULL DEFAULT 0,
  payment_type  TEXT DEFAULT 'Cash',
  bank_name     TEXT DEFAULT '',
  ref_no        TEXT DEFAULT '',
  status        TEXT NOT NULL DEFAULT 'PENDING'
                CHECK (status IN ('PENDING','RECEIVED','INTEREST')),
  -- Weight schemes store both sides of the conversion, so the grams a member
  -- accrued stay auditable even after the metal rate has moved on.
  weight        REAL NOT NULL DEFAULT 0,
  rate          REAL NOT NULL DEFAULT 0
);

-- ─────────────────────────── Expenses ───────────────────────────
-- The `expense` table was removed in v1.1.0. Shop expenses are an Expense
-- account in the chart of accounts, spent against with a Payment voucher — a
-- separate table could never reach the cash book, the day book or the P&L.

-- ─────────────────────────── Metal rates ───────────────────────────
CREATE TABLE IF NOT EXISTS metal_rate (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  item_group_id INTEGER REFERENCES item_group(id),
  rate_date     TEXT NOT NULL,
  rate_per_gm   REAL NOT NULL DEFAULT 0,
  UNIQUE (item_group_id, rate_date)
);

-- ─────────────────────────── Users & access control ───────────────────────────
-- Ported from the reference app: three roles, salted password hashes, and a
-- default owner created on first run.
CREATE TABLE IF NOT EXISTS app_user (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name          TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'staff' CHECK (role IN ('owner','manager','staff')),
  password_hash TEXT NOT NULL,
  salt          TEXT NOT NULL,
  active        INTEGER NOT NULL DEFAULT 1,
  last_login    TEXT DEFAULT '',
  created_at    TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
