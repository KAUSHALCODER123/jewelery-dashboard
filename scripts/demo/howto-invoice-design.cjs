/**
 * How-to film: changing the invoice design in Settings.
 *
 * Same recorder as the tour (tour.cjs), its own scenes. It opens with a bill
 * printed in the standard design, walks through every option on the Invoice
 * Design tab, saves, and prints the same bill again — so the viewer sees the
 * before and the after on a real bill, not only on the sample preview.
 *
 *   npm run build
 *   set TOUR_SCENES=scripts/demo/howto-invoice-design.cjs
 *   set TOUR_DIR=demo/howto-invoice-design
 *   npx electron scripts/demo/tour.cjs                      → part-1.mp4
 *   node scripts/demo/merge.mjs  demo/howto-invoice-design.mp4
 *   node scripts/demo/polish.mjs demo/howto-invoice-design.mp4 demo/howto-invoice-design-final.mp4
 *
 * Recorded as ONE part on purpose: every part is a fresh shop, and the steps
 * build on each other's unsaved changes.
 */
const b = (at, cap, js, extra = {}) => ({ at, cap, js, ...extra })

/* Helpers this film needs on top of helpers.cjs and tour.cjs. */
const SETUP = `
Object.assign(window.__t, {
  glowEl(el) {
    this.glow('.__none')
    if (el) el.classList.add('__glow')
  },
  card(title) {
    return [...document.querySelectorAll('.card')].find(c => c.querySelector('.card-title')?.textContent.trim() === title)
  },
  glowCard(title) { this.glowEl(this.card(title)) },
  /* By the label, not the input: Paper is a pair of buttons, not an input. */
  glowField(label) {
    const lab = [...document.querySelectorAll('label.label')].find(l => l.textContent.trim().startsWith(label))
    const f = lab && lab.closest('.field')
    this.glowEl(f); this.cursorAt(f && (f.querySelector('input, select, textarea, button') || f))
  },
  tick(text, on) {
    const l = [...document.querySelectorAll('label.check')].find(x => x.textContent.trim().startsWith(text))
    if (!l) throw new Error('checkbox not found: ' + text)
    this.cursorAt(l); this.glowEl(l)
    const i = l.querySelector('input')
    if (i.checked !== on) i.click()
  },
  tickAria(label, on) {
    const i = document.querySelector('input[aria-label="' + label + '"]')
    if (!i) throw new Error('checkbox not found: ' + label)
    this.cursorAt(i); this.glowEl(i.closest('tr'))
    if (i.checked !== on) i.click()
  },
  async typeAria(label, text) {
    const i = document.querySelector('input[aria-label="' + label + '"]')
    if (!i) throw new Error('input not found: ' + label)
    this.glowEl(i.closest('tr'))
    await this.typeInto(i, text, 80)
  },
  clickAria(label) {
    const e = document.querySelector('[aria-label="' + label + '"]')
    if (!e) throw new Error('control not found: ' + label)
    this.cursorAt(e); this.glowEl(e.closest('tr')); e.click()
  },
  block(text) {
    const e = [...document.querySelectorAll('.invoice-block')].find(x => x.textContent.includes(text))
    if (!e) throw new Error('layout block not found: ' + text)
    this.cursorAt(e); e.click()
  },
  top() { const p = document.querySelector('.content'); if (p) p.scrollTo({ top: 0, behavior: 'smooth' }) },
  /* The Live Preview iframe is re-drawn on every change, which puts it back at
     the top, so scroll it only after the change has landed. */
  async pv(frac) {
    await this.wait(450)
    const f = document.querySelector('iframe[title="Invoice preview"]')
    const el = f && f.contentDocument && f.contentDocument.scrollingElement
    if (el) el.scrollTo({ top: (el.scrollHeight - el.clientHeight) * frac, behavior: 'smooth' })
  },
  preview() { this.glowEl(document.querySelector('iframe[title="Invoice preview"]')?.closest('.card')) },
  printFirst() {
    const e = document.querySelector('table.data button[title="Print"]')
    if (!e) throw new Error('no bill to print')
    this.cursorAt(e); e.click()
  },
})
true
`

const scenes = [
  /* ───────────────────────── Before ───────────────────────── */
  {
    id: 'before', num: 'How-to', title: 'Change the Invoice Design',
    sub: 'Settings → Invoice Design — every option, step by step, on the real software', hold: 2,
    beats: [
      b(0, ['Before we start', 'First, how a sale bill prints today. Sales Register → the Print icon on any bill.'], `${SETUP}; __t.nav('Sales Register')`),
      b(5, null, `__t.printFirst()`),
      b(7, ['The standard design', 'A4 tax invoice: gold accent, every column, bank details, declaration and signatures.']),
      b(12, null, `__printScroll(1)`),
      b(16, ['What we will do', 'Change the title, colour, footer, sections, columns and layout — then print this same bill again.'], `__printScroll(0)`),
      b(22, null, `__printClose()`),
    ],
  },

  /* ───────────────────────── 1. Open it ───────────────────────── */
  {
    id: 'open', num: 'Step 1', title: 'Open Invoice Design', sub: 'Settings → Invoice Design tab', hold: 3,
    beats: [
      b(0, ['Step 1', 'Click Settings in the left menu.'], `__t.nav('Settings')`),
      b(4, ['Step 1', 'Open the Invoice Design tab — the second tab, after Company.'], `__t.tab('Invoice Design')`),
      b(9, ['The screen', 'Left: the options. Right: Live Preview — a sample bill drawn by the real print renderer. Every change shows there at once.'], `__t.preview()`),
      b(17, ['Nothing is saved yet', 'Changes stay on screen until you press Save Design at the bottom, so you can try things freely.'], `__t.glowEl(document.querySelector('.sticky-actions'))`),
    ],
  },

  /* ───────────────────────── 2. Paper & title ───────────────────────── */
  {
    id: 'paper', num: 'Step 2', title: 'Paper & Title', sub: 'A4 sheet or 3-inch thermal roll, and the heading on the bill', hold: 4,
    beats: [
      b(0, ['Paper', 'A4 Sheet for a normal printer, Thermal 3in for a receipt printer.'], `__t.glowField('Paper')`),
      b(5, ['Paper', 'Thermal 3in turns the bill into a narrow roll receipt — watch the preview.'], `__t.tab('Thermal 3in')`),
      b(11, ['Paper', 'Back to A4 Sheet for this shop.'], `__t.tab('A4 Sheet')`),
      b(15, ['Document Title', 'The heading at the top of the bill. Type your own — here, RETAIL INVOICE.'], `__t.glowField('Document Title'); await __t.typeLabel('Document Title', 'RETAIL INVOICE')`),
      b(21, ['Document Title', 'The new heading is already in the preview.'], `__t.preview()`),
    ],
  },

  /* ───────────────────────── 3. Colour ───────────────────────── */
  {
    id: 'colour', num: 'Step 3', title: 'Accent Colour', sub: 'The colour of the shop name and the highlight bands', hold: 4,
    beats: [
      b(0, ['Accent Colour', 'Click the colour box to pick any colour from the palette…'], `__t.glowField('Accent Colour')`),
      b(5, ['Accent Colour', '…or type a colour code in the box beside it. #7A1F3D is a deep maroon.'],
        `const f = __t.byLabel('Accent Colour').closest('.field'); await __t.typeInto(f.querySelectorAll('input')[1], '#7A1F3D', 120)`),
      b(11, ['Accent Colour', 'The shop name and the bands on the bill change colour straight away.'], `__t.preview()`),
    ],
  },

  /* ───────────────────────── 4. Footer ───────────────────────── */
  {
    id: 'footer', num: 'Step 4', title: 'Footer Note', sub: 'A line printed under the totals', hold: 4,
    beats: [
      b(0, ['Footer Note', 'Terms, jurisdiction, a thank-you — whatever should be printed under the totals.'],
        `__t.glowField('Footer Note'); await __t.typeLabel('Footer Note', 'Goods once sold will not be taken back. Subject to Pune jurisdiction.')`),
      b(8, ['Footer Note', 'Scroll the preview down to see it under the totals.'], `__t.preview(); await __t.pv(1)`),
    ],
  },

  /* ───────────────────────── 5. Sections ───────────────────────── */
  {
    id: 'sections', num: 'Step 5', title: 'Show or Hide Sections', sub: 'Tick or untick whole parts of the bill', hold: 4,
    beats: [
      b(0, ['Sections', 'Each tick box shows or hides one part of the bill.'], `__t.glowCard('Sections')`),
      b(5, ['Print company logo', 'Prints the logo uploaded under Settings → Company.'], `__t.tick('Print company logo', true)`),
      b(10, ['Old gold (URD) table', 'The old gold taken in exchange, with its weight, purity and value.'], `__t.tick('Old gold (URD) table', true)`),
      b(15, ['Bank details', 'Untick to keep your bank account off the bill.'], `__t.tick('Bank details', false); await __t.pv(1)`),
      b(21, ['Declaration text & Signature row', 'The declaration (set under Company) and the signature row hide the same way.'], `__t.tick('Declaration text', true)`),
      b(27, ['Pending balance', 'The customer’s older dues printed on the bill. Untick if you would rather not show them.'], `__t.tick('Pending balance', false); await __t.pv(0.75)`),
      b(34, ['Sections', 'Tick a box again to bring that part back — Bank details returns.'], `__t.tick('Bank details', true); await __t.pv(1)`),
    ],
  },

  /* ───────────────────────── 6. Columns ───────────────────────── */
  {
    id: 'columns', num: 'Step 6', title: 'Item Columns', sub: 'Show, hide, rename, resize and reorder the columns of the item table', hold: 4,
    beats: [
      b(0, ['Item columns', 'Scroll below the preview. Each row of this table is one column of the item table on the bill.'],
        `__t.into(document.querySelector('input[aria-label="rate heading"]').closest('table'))`),
      b(7, ['Show', 'Untick to hide a column — here, HUID.'], `__t.tickAria('Show huid', false)`),
      b(12, ['Show', 'Tick to add one — Stone Wt now prints.'], `__t.tickAria('Show stone', true)`),
      b(17, ['Heading', 'Type a new heading for any column. Leave it blank to keep the standard name.'], `await __t.typeAria('rate heading', 'Rate / 10 gm')`),
      b(24, ['Width', 'Width in pixels, or 0 to size it automatically. Item Name gets 180.'], `await __t.typeAria('name width', '180')`),
      b(30, ['Order', 'Use ↑ and ↓ — or drag the row — to move a column. Purity moves up, next to Item Name.'], `__t.clickAria('Move purity up')`),
      b(37, ['Minimum item rows', 'Blank rows added to short bills so the page looks full. 0 prints only the real items.'],
        `const i = __t.byLabel('Minimum item rows'); __t.into(i); __t.glowEl(i.closest('.field')); await __t.typeInto(i, '4', 200)`),
      b(44, ['Result', 'Up in the preview: no HUID, Stone Wt added, the new Rate heading, Purity moved, fewer blank rows.'], `__t.top(); __t.preview()`),
    ],
  },

  /* ───────────────────────── 7. Layout ───────────────────────── */
  {
    id: 'layout', num: 'Step 7', title: 'Drag-and-Drop Layout', sub: 'Optional — rearrange the whole bill and add your own lines', hold: 5,
    beats: [
      b(0, ['Custom layout', 'For full control, open Drag-and-drop layout and click Enable custom layout.'],
        `const e = __t.btn('Enable custom layout'); __t.into(e.closest('.card')); __t.cursorAt(e); __t.glowEl(e)`),
      b(6, null, `__t.click('Enable custom layout')`),
      b(8, ['Custom layout', 'The bill becomes a grid. Every block — shop header, customer, items, totals — sits in a cell. Drag a block to another cell to move it.'],
        `__t.glowEl(document.querySelector('.invoice-canvas'))`),
      b(16, ['Layout rows & columns', 'Set how many rows and columns the grid has; blocks can span several columns.'], `__t.glowField('Layout rows')`),
      b(22, ['Edit a block', 'Click a block to select it, then set its row, column, width, font size and alignment.'], `__t.block('Footer note'); await __t.wait(300); __t.into('.invoice-canvas')`),
      b(28, ['Edit a block', 'Here the footer note is centred.'], `const s = __t.byLabel('Alignment'); __t.into(s); __t.glowEl(s.closest('.field')); __t.selectLabel('Alignment', 'center')`),
      b(34, ['Add your own line', '+ Add field puts a new line at the bottom — your own text, or a value from the bill such as the bill no. or customer mobile.'], `__t.click('+ Add field')`),
      b(40, null, `const i = __t.byLabel('Field label'); __t.into(i); await __t.typeInto(i, 'Hallmark')`),
      b(43, ['Add your own line', 'Content: Custom text. Type the line to print.'],
        `const t = __t.byLabel('Text'); __t.glowEl(t.closest('.field')); await __t.typeInto(t, 'All our gold jewellery is BIS hallmarked with HUID.', 45)`),
      b(50, ['Result', 'In the preview: the Hallmark line at the bottom of the bill, and the footer note centred.'], `__t.top(); __t.preview(); await __t.pv(1)`),
      b(57, ['Going back', 'Use classic layout returns to the standard arrangement at any time.'],
        `const e = __t.btn('Use classic layout'); __t.into(e); __t.cursorAt(e); __t.glowEl(e)`),
    ],
  },

  /* ───────────────────────── 8. Save ───────────────────────── */
  {
    id: 'save', num: 'Step 8', title: 'Test Print & Save', sub: 'Check it on paper, then save', hold: 4,
    beats: [
      b(0, ['Reset to default', 'Throws away every change and brings back the standard design.'],
        `const a = document.querySelector('.sticky-actions'); __t.into(a); const r = __t.btn('Reset to default', a); __t.cursorAt(r); __t.glowEl(r)`),
      b(6, ['Test Print', 'Prints the sample bill on your printer, so you can check the paper before saving.'], `__t.click('Test Print')`),
      b(9, null, `__printScroll(1)`),
      b(14, ['Save Design', 'Press Save Design. Every bill printed from now on uses the new design.'], `__printClose(); __t.click('Save Design')`),
      b(19, ['Saved', '“Invoice design saved” — that is it.'], `__t.glowEl(document.querySelector('.toast'))`),
    ],
  },

  /* ───────────────────────── 9. After ───────────────────────── */
  {
    id: 'after', num: 'Step 9', title: 'Print a Real Bill', sub: 'The same bill as at the start, in the new design', hold: 2,
    beats: [
      b(0, ['Check it', 'Back to Sales Register, and print the same bill as before.'], `__t.nav('Sales Register')`),
      b(4, null, `__t.printFirst()`),
      b(6, ['After', 'Maroon accent, RETAIL INVOICE, the new columns and headings — on a real bill.']),
      b(12, ['After', 'At the bottom: the footer note and the hallmark line. Old gold purchase bills use the same design.'], `__printScroll(1)`),
      b(19, null, `__printScroll(0)`),
      b(22, null, `__printClose()`),
    ],
  },

  /* ───────────────────────── Recap ───────────────────────── */
  {
    id: 'recap', num: 'Recap', title: 'Invoice Design in one line', sub: 'Settings → Invoice Design → change → watch the preview → Test Print → Save Design', hold: 5,
    beats: [
      b(0, ['Recap', 'Settings → Invoice Design → change the options → watch the Live Preview → Test Print → Save Design.'],
        `__t.nav('Settings'); await __t.wait(400); __t.tab('Invoice Design')`),
      b(7, ['Any time', 'Change it again whenever you like — Reset to default brings back the standard bill.'], `__t.preview()`),
    ],
  },
]

const parts = { 1: scenes.map((s) => s.id) }

module.exports = { scenes, parts, seedMore: () => ({}), printPreview: true }
