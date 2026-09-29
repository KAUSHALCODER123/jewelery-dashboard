/**
 * The full tour, feature by feature.
 *
 * Every scene is a chapter: a title card, then BEATS — actions timed in
 * seconds from the start of the scene, each with the caption the viewer reads
 * while it happens. A beat with `shot` also saves a PNG for the manual.
 *
 * `js` runs inside the page with the __t helpers (helpers.cjs + tour.cjs).
 * Tokens like %PENDANT% are filled in by the recorder when the beat fires.
 */
const b = (at, cap, js, extra = {}) => ({ at, cap, js, ...extra })

/** Records the tour needs beyond the shared seed and trading history. */
function seedMore(api, S, ids) {
  const out = {}
  // A saving scheme, so Enrol Member has something to enrol into.
  out.schemeId = api.gss.saveScheme({
    name: '11 + 1 Gold Plan', scheme_type: 'On Amount', period_unit: 'Months',
    total_periods: 12, paying_periods: 11, monthly_amount: 2000, maturity_bonus: 2000,
  })
  // An order already on the book, so the list is not empty.
  api.order.save({
    head: {
      prefix: 'NO', order_date: ids.today, delivery_date: ids.today.slice(0, 8) + '28',
      karagir_date: ids.today.slice(0, 8) + '25', party_id: S.customers.priya,
      party_name: 'Priya Deshmukh', karagir_id: S.karagir, advance_amount: 10000, remark: 'Antique finish',
    },
    items: [{ item_id: ids.ringId, item_name: 'Ring', qty: 1, gross_wt: 6, stone_wt: 0,
              net_wt: 6, purity: 91.6, rate_per_gm: 6200, mkg_per_gm: 350 }],
  })
  // A second branch, so transfers have somewhere to go.
  api.branch.save({ name: 'Locker' })
  // Old gold bought outright, so the Old Gold report shows both sources.
  api.urd.save({
    head: { bill_date: ids.today, party_id: S.customers.rekha, party_name: 'Rekha Shah', payment_mode: 'Cash' },
    urds: [{ name: 'Old Gold', description: 'purani bali', gross_wt: 4.2, net_wt: 4.2, purity: 80, rate: 5800 }],
  })
  // A purchase with metal still to label, for the "From Purchase" column.
  out.purchaseId = api.purchase.save({
    head: { prefix: 'MI', invoice_date: ids.today, party_id: S.suppliers.mahavir,
            party_name: 'Mahavir Gold', metal: 'Gold', state: 'Maharashtra',
            gst_pct: 3, is_credit: 1, paid_amount: 0 },
    items: [{ item_id: ids.ringId, item_name: 'Ring', direction: 'IN', qty: 5, gross_wt: 50,
              net_wt: 50, purity: 91.6, rate: 6200, wastage_pct: 0 }],
  }).id
  return out
}

const scenes = [
  /* ───────────────────────── 1. Welcome ───────────────────────── */
  {
    id: 'intro', title: 'Parivar Jewellery ERP', sub: 'The complete tour — every screen, every flow, on the real software', hold: 4,
    beats: [
      b(0, ['Dashboard', 'The shop at a glance: today’s sales, stock in hand, money due, and quick actions.'], `__t.nav('Dashboard')`, { shot: 'dashboard' }),
      b(5, ['Dashboard', 'Quick actions take you straight to a new bill, new stock, a new customer or a receipt.'], `__t.highlight('.toolbar button, .card-head button')`),
      b(10, ['Dashboard', 'Everything below is live — it updates the moment a bill is saved.'], `__t.scrollTo(0.5)`),
      b(15, ['Navigation', 'Transactions, Masters and Reports on the left. F2 = bill, F3 = purchase, F4 = receipt, Ctrl+K = search anything.'], `__t.scrollTo(0); __t.highlight('.nav')`),
    ],
  },

  /* ───────────────────────── 2. Items ───────────────────────── */
  {
    id: 'items', title: 'Item Creation', sub: 'Set up what you sell — once', hold: 4,
    beats: [
      b(0, ['Item Creation', 'Every kind of piece you sell is an item: Ring, Chain, Bangle, Payal… made once, used everywhere.'], `__t.nav('Item Creation')`, { shot: 'items' }),
      b(5, ['Item Creation', 'New Item: name it, say what metal and which purity group it belongs to.'], `__t.click('New Item')`),
      b(8, ['Item Creation', 'Pendant — Gold — 22K.'], `await __t.type('.modal input.input', 'Pendant')`),
      b(12, null, `__t.pickSelect('.modal select.select', 0, '%GOLD%')`),
      b(14, null, `__t.pickSelect('.modal select.select', 1, '%G22%')`, { shot: 'item-new' }),
      b(18, ['Item Creation', 'Save. The tag prefix PEN is made for you — every Pendant barcode will start with it.'], `__t.clickExact('Save', document.querySelector('.modal'))`),
      b(22, null, `await __t.search('Pendant')`),
      b(26, ['Item Creation', 'Loose items like mani or fuli are stocked by weight instead of by piece — choose that under Stocked As.'], `await __t.search('')`),
    ],
  },

  /* ───────────────────────── 3. Tags ───────────────────────── */
  {
    id: 'tags', title: 'Tag & Barcode', sub: 'Every piece gets a tag; the tag does the typing at the counter', hold: 4,
    beats: [
      b(0, ['Tag & Barcode', 'Choose the item, type gross weight and purity — net and fine weight are worked out for you.'], `__t.nav('Tag & Barcode')`, { shot: 'tags' }),
      b(4, null, `__t.pickSelect('select.select', 0, '%PENDANT%')`),
      b(7, null, `await __t.typeCell(0, 0, '8.500')`),
      b(11, null, `await __t.typeCell(0, 7, '91.6')`),
      b(15, ['Tag & Barcode', 'Fine weight = net × purity. Making charge and cost per gram can be set per batch.'], `__t.highlight('.grid-edit tbody tr:first-child input[readonly]')`, { shot: 'tag-entry' }),
      b(20, ['Tag & Barcode', 'Save — the tag number PEN00001 is made. Print its barcode sticker from the list below.'], `__t.click('Save 1 tag')`),
      b(25, null, `__t.scrollTo(0.6)`),
      b(28, ['Tag & Barcode', 'Tick pieces and Print labels. TSC 100×15 tags, a tag roll or A4 sheets — all supported.'], `__t.highlight('table.data thead')`),
      b(33, ['Tag & Barcode', '“From loose metal” makes tags out of bullion or old gold already in the safe — the weight comes out of the pool.'], `__t.scrollTo(0); __t.tab('From loose metal')`, { shot: 'tags-loose' }),
      b(39, null, `__t.tab('New stock')`),
    ],
  },

  /* ───────────────────────── 4. Customers ───────────────────────── */
  {
    id: 'customers', title: 'Customers', sub: 'Name, phone, khata — and the gold they owe or are owed', hold: 4,
    beats: [
      b(0, ['Customers', 'Every customer with their money balance and metal balance in one list.'], `__t.nav('Customers')`, { shot: 'customers' }),
      b(5, ['Customers', 'New Customer: a name and a mobile is enough to start billing.'], `__t.click('New Customer')`),
      b(8, null, `await __t.typeInputs('.modal', [['Sunita Deshmukh'], ['9822011223']])`),
      b(14, ['Customers', 'Opening balance: what they already owe you (Dr) or you owe them (Cr) when you start. Birthdays and anniversaries for greetings.'], `__t.scrollTo(0.5)`, { shot: 'customer-new' }),
      b(19, null, `__t.clickExact('Save', document.querySelector('.modal'))`),
      b(23, null, `await __t.search('Sunita')`),
      b(27, ['Customers', 'Click any customer to open their full khata.'], `await __t.search('')`),
    ],
  },

  /* ───────────────────────── 5. Suppliers ───────────────────────── */
  {
    id: 'suppliers', title: 'Suppliers, Karagirs & Refineries', sub: 'The people you buy from and send gold to', hold: 4,
    beats: [
      b(0, ['Suppliers', 'Wholesalers, bullion dealers, karagirs and refineries — each with a money khata and a gold khata in fine grams.'], `__t.nav('Suppliers')`, { shot: 'suppliers' }),
      b(6, ['Suppliers', 'A supplier you owe shows in red; metal they hold of yours shows in grams.'], `__t.scrollTo(0.4)`),
      b(11, null, `__t.scrollTo(0)`),
    ],
  },

  /* ───────────────────────── 6. Purchase ───────────────────────── */
  {
    id: 'purchase', title: 'Purchase', sub: 'Metal in from a supplier — stock and khata update by themselves', hold: 4,
    beats: [
      b(0, ['Purchase', 'The purchase register: gross, net and fine bought, and whether each invoice has been labelled.'], `__t.nav('Purchase')`, { shot: 'purchase-list' }),
      b(5, ['Purchase', 'New Purchase: pick the supplier, cash or credit, then the metal lines.'], `__t.click('New Purchase')`),
      b(8, null, `await __t.pickAuto('supplier', 'Mahavir')`),
      b(13, ['Purchase', 'Item, gross weight, purity, rate per 10 g. Wastage % the supplier charges goes in Fine + Wastage.'], `await __t.typePurchaseLine('Chain', '50', '91.6', '62000')`),
      b(26, ['Purchase', 'GST, TCS, discount and what you paid. A purchase can also be paid in fine gold instead of rupees.'], `__t.highlight('.total-row'); __t.scrollTo(0.5)`, { shot: 'purchase-new' }),
      b(32, ['Purchase', 'Save & Make Labels saves the invoice and opens Tag & Barcode with it preselected.'], `__t.scrollTo(1); __t.highlight('.sticky-actions button')`),
      b(36, null, `__t.click('Save & Make Labels')`),
      b(41, ['Tag & Barcode ← Purchase', 'The strip shows what the invoice bought, what is labelled, and what is still loose — so every gram is accounted for.'], `__t.scrollTo(0)`, { shot: 'purchase-tally' }),
    ],
  },

  /* ───────────────────────── 7. Sales — cash bill ───────────────────────── */
  {
    id: 'sales', title: 'Sales Invoice', sub: 'Scan the tag, type the rate, done', hold: 4,
    beats: [
      b(0, ['Sales Invoice', 'Pick the customer — their khata balance appears at once. Leave blank for a walk-in.'], `__t.nav('Sales Invoice')`, { shot: 'sales' }),
      b(4, null, `await __t.pickAuto('customer', 'Sandip')`),
      b(9, ['Sales Invoice', 'Scan the barcode or type the item name and pick the piece. Weight, purity, making and hallmark fill in from the tag.'], `await __t.pickTag(0)`),
      b(16, ['Sales Invoice', 'Type today’s rate per 10 g. Goods, making, GST and the total update live.'], `await __t.typeRate('62000')`),
      b(21, null, `__t.highlight('.total-row.grand')`, { shot: 'sales-filled' }),
      b(25, ['Sales Invoice', 'Cash, UPI, card, NEFT — or split one bill across modes. Card fees are worked out for you.'], `__t.scrollTo(0.7)`),
      b(31, ['Sales Invoice', 'Save, then Print, PDF or send on WhatsApp. The piece is marked sold and the customer’s khata is updated.'], `__t.scrollTo(1); __t.highlight('.sticky-actions button')`),
      b(35, null, `__t.clickExact('Save')`),
      b(39, null, `__t.scrollTo(0)`, { shot: 'sales-saved' }),
    ],
  },

  /* ───────────────────────── 8. Sales — old gold exchange ───────────────────────── */
  {
    id: 'sales-exchange', title: 'Old Gold on a Bill', sub: 'Trading up: an old chain towards a new piece', hold: 4,
    beats: [
      b(0, ['Old Gold Exchange', 'A new bill for Priya, with a piece scanned in.'], `__t.nav('Sales Invoice')`),
      b(3, null, `await __t.pickAuto('customer', 'Priya')`),
      b(8, null, `await __t.pickTag(0, 'Ring')`),
      b(14, null, `await __t.typeRate('62000')`),
      b(18, ['Old Gold Exchange', '“Add old gold”: weight and tunch of the old piece, and the rate you allow. Its value comes off the bill.'], `__t.openUrd()`),
      b(21, null, `await __t.typeUrd('12', '88')`),
      b(31, ['Old Gold Exchange', 'The customer pays only the difference. The old gold lands in your URD stock — it really comes in.'], `__t.highlight('.total-row.credit')`, { shot: 'sales-oldgold' }),
      b(36, ['Estimate', 'Series: switch to Estimate for a quotation — GST not required ticks itself.'], `__t.scrollTo(0); __t.selectLabel('Series', 'ESM')`),
      b(40, null, `__t.scrollTo(0.6); __t.highlight('.check')`, { shot: 'sales-estimate' }),
      b(45, ['Credit bill', 'Or tick Credit and enter only what was paid — the rest goes on the khata and shows under Outstanding.'], `__t.scrollTo(0); __t.selectLabel('Series', 'COM'); __t.tab('Credit')`),
      b(50, null, `__t.scrollTo(0.7)`),
    ],
  },

  /* ───────────────────────── 9. Sales register & returns ───────────────────────── */
  {
    id: 'register', title: 'Sales Register & Returns', sub: 'Every bill, and what came back', hold: 4,
    beats: [
      b(0, ['Sales Register', 'All bills for a period with GST, old gold and balance. Print or WhatsApp any bill from here.'], `__t.nav('Sales Register')`, { shot: 'sales-register' }),
      b(6, ['Returns', 'A return is its own dated document — the original bill is never altered.'], `__t.nav('Returns')`, { shot: 'returns' }),
      b(10, null, `__t.click('New Sales Return')`),
      b(13, ['Returns', 'Pick the bill and its lines are pulled in. Stock comes back, money and metal reverse on the day it happened.'], `await __t.pickAuto('bill', 'COM')`),
      b(20, null, `__t.highlight('.grid-edit')`, { shot: 'return-new' }),
      b(24, null, `__t.clickExact('Save Return')`),
      b(28, ['Returns', 'Purchase returns work the same way, back to the supplier.'], `__t.tab('Purchase Returns')`),
    ],
  },

  /* ───────────────────────── 10. Old gold purchase ───────────────────────── */
  {
    id: 'oldgold', title: 'Old Gold Purchase', sub: 'Buying old gold with nothing sold against it', hold: 4,
    beats: [
      b(0, ['Old Gold Purchase', 'A customer sells you old jewellery. This bill pays them and books the metal into URD stock.'], `__t.nav('Old Gold Purchase')`, { shot: 'oldgold-list' }),
      b(5, null, `__t.click('New Old Gold Bill')`),
      b(7, ['Old Gold Purchase', 'Customer, then the lines: gross, net, purity, rate — priced on fine weight.'], `await __t.pickAuto('customer', 'Sandip')`),
      b(12, null, `await __t.typeCellIn(0, 0, 1, 'Broken chain'); await __t.typeCellIn(0, 0, 2, '10.5'); await __t.typeCellIn(0, 0, 4, '80'); await __t.typeCellIn(0, 0, 6, '5800')`),
      b(23, ['Old Gold Purchase', 'Paid now — blank means paid in full. Anything left stays on the customer’s khata as a credit.'], `const ins=[...document.querySelectorAll('.modal input.input')]; const paid=ins.find(i=>/^[\\d,]+\\.\\d\\d$/.test(i.placeholder||'')); if (paid) await __t.typeInto(paid, '30000')`),
      b(28, null, `__t.highlight('.total-row.grand')`, { shot: 'oldgold-new' }),
      b(32, null, `__t.clickExact('Save', document.querySelector('.modal-foot'))`),
      b(36, ['Old Gold Purchase', 'Print, PDF, edit or delete from the list. The Day Book shows old gold bills on their own row.'], `__t.highlight('table.data tbody tr:first-child')`),
    ],
  },

  /* ───────────────────────── 11. Old gold report ───────────────────────── */
  {
    id: 'oldgold-report', title: 'Old Gold Report', sub: 'Every gram taken in, from both kinds of bill', hold: 4,
    beats: [
      b(0, ['Old Gold Report', 'Fine grams in, rupees paid, average rate per fine gram — and the URD gold in the safe right now.'], `__t.nav('Old Gold Report')`, { shot: 'oldgold-report' }),
      b(6, ['Old Gold Report', 'One row per line with the bill it came from. Click a row to open that bill. Print or export.'], `__t.highlight('table.data')`),
      b(11, null, `__t.tab('Old gold bills')`),
      b(15, null, `__t.tab('All')`),
    ],
  },

  /* ───────────────────────── 12. Receipts & payments ───────────────────────── */
  {
    id: 'receipts', title: 'Receipts & Payments', sub: 'Money in, money out — one entry, two books', hold: 4,
    beats: [
      b(0, ['Receipts', 'Money collected against a khata. The customer’s balance and the cash book move together.'], `__t.nav('Receipts')`, { shot: 'receipts' }),
      b(5, null, `__t.click('New Receipt')`),
      b(8, ['Receipts', 'Pick the party — the amount still due shows at once. Enter what they paid, and how.'], `await __t.pickAuto('party', 'Sandip')`),
      b(13, null, `await __t.typeInto(document.querySelectorAll('.modal input.input')[1], '5000')`),
      b(17, null, `__t.highlight('.modal .hint')`, { shot: 'receipt-new' }),
      b(21, null, `__t.clickExact('Save', document.querySelector('.modal-foot'))`),
      b(25, ['Payments', 'Payments: pay a supplier, or an expense head like electricity or rent — that is how expenses reach the P&L.'], `__t.tab('Payments')`),
      b(30, ['Settlements', 'Settlements: a wholesale customer clears metal owed in cash at today’s rate.'], `__t.tab('Metal Settlement')`),
    ],
  },

  /* ───────────────────────── 13. Orders ───────────────────────── */
  {
    id: 'orders', title: 'Order Booking', sub: 'What to make, by when, and the advance taken', hold: 4,
    beats: [
      b(0, ['Orders', 'Every order with its delivery date, karagir date, advance and balance.'], `__t.nav('Orders')`, { shot: 'orders' }),
      b(5, null, `__t.click('New Order')`),
      b(8, ['Orders', 'Customer, the piece to make, weight, purity, rate — and a separate, earlier date for the karagir.'], `await __t.pickAuto('customer', 'Rekha')`),
      b(13, null, `await __t.typeCellIn(0, 0, 0, 'Kada'); await __t.typeCellIn(0, 0, 2, '20'); await __t.typeCellIn(0, 0, 5, '91.6'); await __t.typeCellIn(0, 0, 7, '6200')`),
      b(25, ['Orders', 'Advance received now. Old gold handed over at booking can be taken here too.'], `__t.scrollTo(0.6); await __t.typeLabel('Advance Received', '20000')`),
      b(30, null, `__t.highlight('.total-row')`, { shot: 'order-new' }),
      b(34, null, `__t.clickExact('Save Order')`),
      b(38, ['Orders', 'When the piece is ready: Convert to Sales Bill. The advance is adjusted on the bill automatically.'], `__t.highlight('table.data tbody tr:first-child')`),
    ],
  },

  /* ───────────────────────── 14. Karagir ───────────────────────── */
  {
    id: 'karagir', title: 'Karagir Job Work', sub: 'Gold out to the goldsmith, pieces back — wastage accounted', hold: 4,
    beats: [
      b(0, ['Karagir', 'Pick the karagir. Issue Material records the grams you hand over — they sit on his gold khata.'], `__t.nav('Orders'); await __t.wait(400); __t.tab('Karagir Job Work')`),
      b(4, null, `await __t.pickAuto('karagir', 'Chetan')`),
      b(9, null, `__t.click('Issue Material')`, { shot: 'karagir' }),
      b(12, null, `await __t.typeLabel('Item', 'Chain', document.querySelector('.modal')); await __t.typeLabel('Gross Wt', '100', document.querySelector('.modal')); await __t.typeLabel('Purity', '99.5', document.querySelector('.modal'))`),
      b(22, null, `__t.clickExact('Save', document.querySelector('.modal-foot'))`),
      b(26, ['Karagir', 'Receive Order books what came back, the wastage you allow and his labour. The ledger shows if he still holds your metal.'], `__t.highlight('table.data')`, { shot: 'karagir-ledger' }),
    ],
  },

  /* ───────────────────────── 15. Refining ───────────────────────── */
  {
    id: 'refining', title: 'Refining', sub: 'Scrap out, pure gold back, loss visible', hold: 4,
    beats: [
      b(0, ['Refining', 'Metal sent to the refinery and what came back — per invoice, with the fine weight and charges.'], `__t.nav('Refining')`, { shot: 'refining' }),
      b(5, null, `__t.click('New Refining Entry')`),
      b(8, ['Refining', 'Material Out: what you sent, its purity. Tagged pieces you melt are marked melted.'], `await __t.pickAuto('refinery', 'Shree')`),
      b(13, null, `await __t.typeCellIn(0, 0, 1, 'Scrap'); await __t.typeCellIn(0, 0, 3, '30'); await __t.typeCellIn(0, 0, 7, '85')`),
      b(22, null, `__t.highlight('.total-row')`, { shot: 'refining-new' }),
      b(26, null, `__t.clickExact('Save Entry')`),
      b(30, ['Refining', 'Material In when the pure gold returns. Stock drops when it leaves and rises when it is back — the difference is your loss.'], `__t.highlight('table.data')`),
    ],
  },

  /* ───────────────────────── 16. Gold scheme ───────────────────────── */
  {
    id: 'scheme', title: 'Gold Saving Scheme', sub: 'Monthly savings plans, tracked to the rupee and the gram', hold: 4,
    beats: [
      b(0, ['Gold Scheme', 'Members and their cards: paid so far, due, matured. Schemes on the other tab.'], `__t.nav('Gold Scheme')`, { shot: 'scheme' }),
      b(5, ['Gold Scheme', 'Enrol Member: pick the customer and the plan; the month-by-month schedule is created.'], `__t.click('Enrol Member')`),
      b(8, null, `await __t.pickAuto('customer', 'Amit')`),
      b(13, null, `__t.selectLabel('Scheme', '%SCHEME%', document.querySelector('.modal'))`, { shot: 'scheme-enrol' }),
      b(17, null, `__t.clickExact('Enrol', document.querySelector('.modal-foot'))`),
      b(21, ['Gold Scheme', 'Open the member: every instalment with its due date. Receive marks one paid — cash or bank.'], `__t.clickRow('Amit')`),
      b(25, null, `__t.click('Receive')`),
      b(28, null, `__t.clickExact('Receive', document.querySelector('.modal-foot'))`, { shot: 'scheme-member' }),
      b(33, ['Gold Scheme', 'At maturity the balance settles a sale bill — the Saving Scheme box appears on the bill for that customer.'], `__t.scrollTo(0.5)`),
      b(38, ['Gold Scheme', 'Scheme types: on amount, on weight, weight-wise. Bonus at maturity in rupees or grams, and making waivers.'], `__t.click('Back'); await __t.wait(400); __t.tab('Schemes')`),
    ],
  },

  /* ───────────────────────── 17. Stock report ───────────────────────── */
  {
    id: 'stock', title: 'Stock Report', sub: 'What is on the shelf, what it weighs, what it is worth', hold: 4,
    beats: [
      b(0, ['Stock Report', 'Tag-wise detail: every piece with gross, net, fine, cost and age.'], `__t.nav('Stock Report')`, { shot: 'stock' }),
      b(6, ['Stock Report', 'Or summarised by item, group, location, category, salesman or tray.'], `__t.pickSelect('select.select', 0, 'group')`),
      b(11, null, `__t.pickSelect('select.select', 0, 'item')`),
      b(15, ['Stock Report', 'Grid Settings on any table: hide columns, rename, reorder. Print or export to Excel and Word.'], `__t.highlight('.toolbar button')`),
    ],
  },

  /* ───────────────────────── 18. Stock verification ───────────────────────── */
  {
    id: 'stockcheck', title: 'Stock Verification', sub: 'Scan every piece — red is missing', hold: 4,
    beats: [
      b(0, ['Stock Verification', 'Physical count: scan tags one by one. Found pieces turn green; anything not scanned stays red.'], `__t.nav('Stock Verification')`, { shot: 'stockcheck' }),
      b(5, null, `const el=document.querySelector('input[placeholder="RIN00001"]'); await __t.typeInto(el, 'RIN00001'); el.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}))`),
      b(10, null, `const el=document.querySelector('input[placeholder="RIN00001"]'); await __t.typeInto(el, 'BAN00001'); el.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}))`),
      b(15, ['Stock Verification', 'The missing list is what to go looking for before closing.'], `__t.scrollTo(0.5)`),
    ],
  },

  /* ───────────────────────── 19. Day book ───────────────────────── */
  {
    id: 'daybook', title: 'Day Book', sub: 'The page to read before pulling the shutter', hold: 4,
    beats: [
      b(0, ['Day Book', 'Sales, purchases, old gold, receipts and payments for the day, cash and credit.'], `__t.nav('Day Book')`, { shot: 'daybook' }),
      b(6, ['Day Book', 'Gold position opening and closing in gross, net and fine — per metal, and for old gold separately.'], `__t.scrollTo(0.45)`),
      b(12, ['Day Book', 'Every cash and bank account, and what came in by cash, UPI, card. Count the drawer against the Cash figure.'], `__t.scrollTo(0.9)`),
      b(18, null, `__t.scrollTo(0)`),
    ],
  },

  /* ───────────────────────── 20. Ledger ───────────────────────── */
  {
    id: 'ledger', title: 'Ledger / Khata', sub: 'Any customer or supplier, from day one to today', hold: 4,
    beats: [
      b(0, ['Ledger', 'Pick a party. Money khata: every bill, receipt and return, Dr and Cr, with the running balance.'], `__t.nav('Ledger / Khata')`),
      b(3, null, `await __t.pickAuto('customer', 'Sandip')`, { shot: 'ledger' }),
      b(9, ['Ledger', 'Metal khata: the same in fine grams — what they took and what they gave.'], `__t.tab('Metal')`),
      b(14, ['Ledger', 'Money + Metal side by side: one statement, both balances.'], `__t.tab('Money + Metal')`, { shot: 'ledger-both' }),
      b(19, null, `__t.tab('Money')`),
    ],
  },

  /* ───────────────────────── 21. Outstanding ───────────────────────── */
  {
    id: 'outstanding', title: 'Outstanding', sub: 'Who owes you, whom you owe — in rupees and in grams', hold: 4,
    beats: [
      b(0, ['Outstanding', 'Debtors and creditors, money basis. Print it and start calling.'], `__t.nav('Outstanding')`, { shot: 'outstanding' }),
      b(6, ['Outstanding', 'Metal basis: the same list in fine grams for weight-wise customers and karagirs.'], `__t.tab('Metal (g)')`),
      b(11, null, `__t.tab('Money (₹)')`),
    ],
  },

  /* ───────────────────────── 22. Books ───────────────────────── */
  {
    id: 'books', title: 'Accounting Books', sub: 'Trial Balance, P&L, Balance Sheet — built from your documents', hold: 4,
    beats: [
      b(0, ['Accounting Books', 'Trial Balance for any period, footing to the paisa.'], `__t.nav('Accounting Books')`, { shot: 'books' }),
      b(6, ['Accounting Books', 'Trading and Profit & Loss: sales, purchases, old gold, expenses, closing stock at cost.'], `__t.tab('Profit & Loss')`, { shot: 'books-pl' }),
      b(12, ['Accounting Books', 'Balance Sheet: cash, bank, debtors, stock against creditors and scheme deposits.'], `__t.tab('Balance Sheet')`),
      b(17, null, `__t.tab('Trial Balance')`),
    ],
  },

  /* ───────────────────────── 23. Registers ───────────────────────── */
  {
    id: 'registers', title: 'Cash Book & Registers', sub: 'For you and for your accountant', hold: 4,
    beats: [
      b(0, ['Cash Book', 'The cash and bank books with running balances.'], `__t.nav('Cash Book & Registers')`, { shot: 'registers' }),
      b(6, ['Journal', 'Every posting in the period, on its natural side.'], `__t.tab('Journal')`),
      b(11, ['Registers', 'Sales, sales return, purchase and purchase return books.'], `__t.tab('Sales & Purchase Books')`),
    ],
  },

  /* ───────────────────────── 24. GST ───────────────────────── */
  {
    id: 'gst', title: 'GST Reports', sub: 'GSTR-1, GSTR-2, GSTR-3B, HSN, TCS/TDS — ready for the CA', hold: 4,
    beats: [
      b(0, ['GST Reports', 'Outward supplies for GSTR-1 with taxable value, CGST and SGST per bill.'], `__t.nav('GST Reports')`, { shot: 'gst' }),
      b(6, ['GST Reports', 'HSN summary and TCS/TDS on the other tabs. Export any of them.'], `__t.tab('HSN Summary')`),
      b(11, null, `__t.tab('TCS / TDS')`),
    ],
  },

  /* ───────────────────────── 25. MIS ───────────────────────── */
  {
    id: 'mis', title: 'MIS & Scheme Reports', sub: 'The questions an owner asks', hold: 4,
    beats: [
      b(0, ['MIS', 'Non-moving stock, quiet customers, top sellers, purity-wise profit.'], `__t.nav('MIS & Scheme Reports')`, { shot: 'mis' }),
      b(6, null, `__t.scrollTo(0.5)`),
      b(11, ['Scheme Reports', 'Scheme master, allocated, pending, received, and sales settled by scheme.'], `__t.scrollTo(0); __t.tab('Gold Scheme Reports')`),
      b(16, null, `__t.tab('Pending')`),
    ],
  },

  /* ───────────────────────── 26. Branches ───────────────────────── */
  {
    id: 'branches', title: 'Branches & Transfer', sub: 'Where each piece is, and moving it', hold: 4,
    beats: [
      b(0, ['Branches', 'Shop, locker, a second branch: every tagged piece has a location. Transfers move it with a document behind.'], `__t.nav('Branches & Transfer')`, { shot: 'branches' }),
      b(6, null, `__t.scrollTo(0.5)`),
      b(10, null, `__t.scrollTo(0)`),
    ],
  },

  /* ───────────────────────── 27. Changeover ───────────────────────── */
  {
    id: 'changeover', title: 'Changeover Check', sub: 'Your old book against this one — before you switch', hold: 4,
    beats: [
      b(0, ['Changeover Check', 'Type what your old book says — cash, bank, debtors, gold on hand. The software shows its figure and the difference.'], `__t.nav('Changeover Check')`, { shot: 'changeover' }),
      b(6, null, `const ins=[...document.querySelectorAll('table input')]; if (ins[0]) await __t.typeInto(ins[0], '50000')`),
      b(11, ['Changeover Check', 'Anything marked Differs is a question to settle before you trust the book.'], `__t.highlight('table.data')`),
    ],
  },

  /* ───────────────────────── 28. Settings ───────────────────────── */
  {
    id: 'settings', title: 'Settings', sub: 'Company, invoice design, accounts, making & wastage, users, mobile', hold: 4,
    beats: [
      b(0, ['Settings', 'Company: name, address, GSTIN, bank — printed on every bill.'], `__t.nav('Settings')`, { shot: 'settings' }),
      b(5, ['Invoice Design', 'Choose the paper, columns, logo, declaration and footer. The preview is the real bill.'], `__t.tab('Invoice Design')`, { shot: 'settings-invoice' }),
      b(11, ['Accounts', 'Cash, bank, expense heads, card charges. Opening balances go here.'], `__t.tab('Accounts')`),
      b(16, ['Making & Wastage', 'Default making charge and wastage per item or group, so nothing is retyped.'], `__t.tab('Making & Wastage')`),
      b(21, ['Users', 'Owner, manager and staff logins. Deleting documents and settings are owner-only.'], `__t.tab('Users')`),
      b(26, ['Mobile View', 'Read-only access from a phone on the shop Wi-Fi — scan the QR.'], `__t.tab('Mobile View')`, { shot: 'settings-mobile' }),
      b(31, ['Backup', 'Data tab: backup every evening, restore, and Google Drive backup.'], `__t.tab('Data & Backup')`),
    ],
  },

  /* ───────────────────────── 29. Closing ───────────────────────── */
  {
    id: 'closing', title: 'That’s the whole shop', sub: 'Offline, on your own computer, backed up every day', hold: 6,
    beats: [
      b(0, ['Parivar Jewellery ERP', 'Item to barcode, purchase to bill, khata to karagir, old gold to scheme — one software, your data on your machine.'], `__t.nav('Dashboard')`),
      b(6, null, `__t.scrollTo(0.4)`),
      b(11, null, `__t.scrollTo(0)`),
    ],
  },
]

const parts = {
  1: ['intro', 'items', 'tags', 'customers', 'suppliers'],
  2: ['purchase', 'sales', 'sales-exchange', 'register'],
  3: ['oldgold', 'oldgold-report', 'receipts', 'orders', 'karagir', 'refining'],
  4: ['scheme', 'stock', 'stockcheck', 'daybook', 'ledger', 'outstanding'],
  5: ['books', 'registers', 'gst', 'mis', 'branches', 'changeover', 'settings', 'closing'],
}

module.exports = { scenes, parts, seedMore }
