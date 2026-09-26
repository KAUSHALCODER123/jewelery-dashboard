/**
 * User-flow test. Drives the real built UI with demo data and verifies the
 * result in the database — clicks and keystrokes, not direct API calls.
 *
 *   npm run test:flows
 */
const { app, BrowserWindow, ipcMain } = require('electron')
const path = require('node:path')
const fs = require('node:fs')
const os = require('node:os')
const { seed } = require('./demo-data.cjs')

let pass = 0, fail = 0
const failures = []
const consoleErrors = []

const check = (label, actual, expected, tol = 0.005) => {
  const ok = typeof expected === 'number'
    ? Math.abs(Number(actual) - expected) <= tol
    : String(actual) === String(expected)
  if (ok) { pass++; console.log(`   ok   ${label}  =  ${actual}`) }
  else { fail++; failures.push(`${label}: got ${actual}, expected ${expected}`)
         console.log(`   FAIL ${label}: got ${actual}, expected ${expected}`) }
}
const ok = (label, cond) => check(label, cond ? 'yes' : 'no', 'yes')
const head = (t) => console.log(`\n── ${t} ${'─'.repeat(Math.max(0, 56 - t.length))}`)

process.on('unhandledRejection', (e) => { console.error('UNHANDLED', e); process.exit(1) })
// Whole-run watchdog — a backstop for a genuine HANG, not a runtime budget. The
// suite drives every screen with real clicks across ~18 sections; it completes
// in ~4-5 min standalone, but run last in `test:all` on a heat-throttled machine
// it is slower still. 10 minutes leaves generous headroom while a true hang
// (an unresolved await) is always eventually caught. Confirmed passing standalone
// at 121 assertions, 0 console errors.
setTimeout(() => { console.error('TIMEOUT'); process.exit(1) }, 900_000).unref()

/** Injected into the page: React-safe input setter + helpers. */
const HELPERS = `
window.__t = {
  set(el, v) {
    const proto = el.tagName === 'TEXTAREA'
      ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, v)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  },
  setSelect(el, v) {
    Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set.call(el, v)
    el.dispatchEvent(new Event('change', { bubbles: true }))
  },
  gridInput(label, row = 0) {
    const table = document.querySelector('.grid-edit')
    const column = [...table.querySelectorAll('thead th')]
      .findIndex(th => th.textContent.trim() === label)
    const input = table.querySelectorAll('tbody tr')[row]?.cells[column]?.querySelector('input')
    if (!input || input.readOnly) throw new Error('Editable grid column not found: ' + label)
    return input
  },
  nav(label) {
    const b = [...document.querySelectorAll('.nav-item')]
      .find(x => x.textContent.trim().startsWith(label))
    if (!b) throw new Error('nav not found: ' + label)
    b.click()
  },
  btn(text, root) {
    return [...(root || document).querySelectorAll('button')]
      .find(b => b.textContent.trim().toLowerCase().includes(text.toLowerCase()))
  },
  click(text, root) {
    const b = this.btn(text, root)
    if (!b) throw new Error('button not found: ' + text)
    b.click()
  },
  wait(ms) { return new Promise(r => setTimeout(r, ms)) },
  totals() {
    return Object.fromEntries([...document.querySelectorAll('.total-row')]
      .map(r => [r.querySelector('.k').textContent.trim(), r.querySelector('.v').textContent.trim()]))
  },
  toasts() { return [...document.querySelectorAll('.toast')].map(t => t.textContent.trim()) },
}
true
`

// Give each run its own Chromium profile — otherwise two test processes
// fight over the same cache directory and the slower one flakes.
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'parivar-run-')))

app.whenReady().then(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'parivar-flows-'))
  const db = require('../electron/db.cjs')
  db.open(tmp)
  const api = require('../electron/api.cjs')
  const { auth, bootstrap } = require('../electron/auth.cjs')
  bootstrap()
  auth.login({ username: 'admin', password: 'admin' })  // harness signs in as owner

  for (const [g, ms] of Object.entries({ ...api, auth }))
    for (const [n, fn] of Object.entries(ms))
      ipcMain.handle(`${g}:${n}`, (_e, p) => {
        try { return { ok: true, data: fn(p ?? {}) } } catch (e) { return { ok: false, error: e.message } }
      })
  ipcMain.handle('app:info', () => ({ version: '1.0.0', dataDir: tmp }))
  ipcMain.handle('print:html', () => ({ ok: true }))
  ipcMain.handle('print:pdf', () => ({ ok: true }))
  ipcMain.handle('file:saveText', () => ({ ok: true }))
  // The real handlers open native dialogs and restart the app, neither of which a
  // test can drive — stub them so the confirmation UI itself can be exercised.
  let restoreCalledWith = null
  ipcMain.handle('backup:inspect', () => ({
    ok: true,
    backup: {
      filePath: 'C:/backups/parivar-backup-2026-07-01.db', size: 123456,
      company: 'Demo', fy_start: '2026-04-01', fy_end: '2027-03-31',
      counts: { parties: 2, tags: 3, sales: 1, purchases: 0 }, last_entry: '2026-07-01',
    },
    current: {
      company: 'Demo',
      counts: { parties: 9, tags: 7, sales: 4, purchases: 2 }, last_entry: '2026-07-21',
    },
  }))
  ipcMain.handle('backup:restore', (_e, p) => { restoreCalledWith = p; return { ok: true, safety: 'x.db' } })
  ipcMain.handle('gdrive:status', () => ({ ok: true, data: { configured: false, connected: false } }))
  for (const c of ['gdrive:listBackups']) ipcMain.handle(c, () => ({ ok: true, data: [] }))
  for (const c of ['send:whatsapp', 'send:sms', 'send:email']) ipcMain.handle(c, () => ({ ok: true }))

  const S = seed(api)

  const w = new BrowserWindow({ show: true, width: 1560, height: 1000,
    webPreferences: { preload: path.join(__dirname, '..', 'electron', 'preload.cjs'),
      contextIsolation: true, sandbox: false } })
  w.webContents.on('console-message', (_e, level, msg) => {
    if (level >= 2 && !/Content-Security-Policy/.test(msg)) consoleErrors.push(msg.slice(0, 200))
  })
  await w.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))
  await new Promise((r) => setTimeout(r, 2000))

  const js = (code) => w.webContents.executeJavaScript(`(async () => { ${code} })()`)
  const nav = async (label) => { await js(`__t.nav(${JSON.stringify(label)}); await __t.wait(750)`) }

  await w.webContents.executeJavaScript(HELPERS)

  try {
    // ── 1. Dashboard reflects seeded data ─────────────────────────────
    head('1. Dashboard')
    const dash = await js(`return {
      tiles: [...document.querySelectorAll('.stat')].map(s => s.textContent.trim()),
      rows: document.querySelectorAll('.data tbody tr').length }`)
    check('four stat tiles', dash.tiles.length, 4)
    ok('stock tile shows fine weight', /g fine/.test(dash.tiles[2]))

    // ── 2. Create a customer through the UI ───────────────────────────
    head('2. Customers — create through the form')
    await nav('Customers')
    await js(`
      __t.click('New Customer'); await __t.wait(500)
      const modal = document.querySelector('.modal')
      const inputs = modal.querySelectorAll('input.input')
      __t.set(inputs[0], 'Test Kumar')
      __t.set(inputs[1], '9000011111')
      await __t.wait(200)
      __t.click('Save', modal.parentElement); await __t.wait(700)
    `)
    const created = api.party.list({ type: 'CUSTOMER', search: 'Test Kumar' })
    check('customer saved from UI', created.length, 1)
    check('mobile captured', created[0]?.mobile, '9000011111')

    // ── 3. Item creation ──────────────────────────────────────────────
    head('3. Item master — create through the form')
    await nav('Item Creation')
    const groups = api.itemGroup.list()
    const types = api.itemType.list()
    await js(`
      __t.click('New Item'); await __t.wait(500)
      const modal = document.querySelector('.modal')
      __t.set(modal.querySelector('input.input'), 'Pendant')
      const sels = modal.querySelectorAll('select.select')
      __t.setSelect(sels[0], '${types.find(t => t.name === 'Gold').id}')
      __t.setSelect(sels[1], '${groups.find(g => g.name === '22K Gold').id}')
      await __t.wait(250)
      __t.click('Save', modal.parentElement); await __t.wait(700)
    `)
    const pendant = api.item.list({ search: 'Pendant' })
    check('item saved from UI', pendant.length, 1)
    check('tag prefix derived', pendant[0]?.tag_prefix, 'PEN')

    // ── 4. Tag stock entry grid ───────────────────────────────────────
    head('4. Tag & Barcode — grid entry')
    await nav('Tag & Barcode')
    await js(`
      __t.setSelect(document.querySelector('select.select'), '${pendant[0].id}')
      await __t.wait(600)
      const row = document.querySelectorAll('.grid-edit tbody tr')[0]
      const cells = row.querySelectorAll('input')
      // Tag grid inputs: 0 gross, 1 black, 2 bag wt, 3 stone wt, 4 stone rate,
      // 5 dia wt, 6 dia rate, 7 purity, 8 mkg, 9 hallmark, 10 cost/gm, 11 qty.
      __t.set(cells[0], '8.500')   // gross
      __t.set(cells[7], '91.6')    // purity
      await __t.wait(400)
    `)
    const live = await js(`
      const row = document.querySelectorAll('.grid-edit tbody tr')[0]
      // Net is the only read-only cell (Fine is no longer shown on this grid), so
      // this survives new columns being added.
      const calc = row.querySelectorAll('input[readonly]')
      return { net: calc[0].value }`)
    check('net weight computed live', live.net, '8.500')
    await js(`__t.click('Save 1 tag'); await __t.wait(900)`)
    const penTags = api.tagStock.list({ status: 'IN_STOCK', search: 'PEN' })
    check('tag saved from UI', penTags.length, 1)
    check('tag number generated', penTags[0]?.tag, 'PEN00001')
    check('fine stored', penTags[0]?.final_wt, 7.786)

    // ── 5. Sales invoice — full billing flow ──────────────────────────
    head('5. Sales Invoice — bill a customer end to end')
    await nav('Sales Invoice')
    await js(`
      // customer autocomplete
      const cust = document.querySelector('.ac input.input')
      cust.focus()
      __t.set(cust, 'Sandip'); await __t.wait(1200)
      const opt = document.querySelector('.ac-list .ac-item')
      if (!opt) throw new Error('customer autocomplete empty')
      opt.click(); await __t.wait(1300)
    `)
    const bal = await js(`return document.querySelector('.balance-flag')?.textContent.trim() || ''`)
    ok('previous balance shown on bill', /9,500/.test(bal))

    await js(`
      // item row: type name, pick the tagged piece from the dropdown
      const row = document.querySelectorAll('.grid-edit tbody tr')[0]
      const cells = row.querySelectorAll('input')
      cells[1].focus()
      __t.set(cells[1], 'Ring'); await __t.wait(1500)
      const pick = document.querySelector('.ac-list .ac-item')
      if (!pick) throw new Error('item autocomplete empty')
      pick.click(); await __t.wait(800)
      // Use column names: the From Purchase cell adds a read-only input on
      // tagged rows, so positional input indices no longer identify the fields.
      // The rate is typed per TEN grams at the counter — 45,900 is 4,590 a gram.
      __t.set(__t.gridInput('Rate/10Gm'), '45900')
      __t.set(__t.gridInput('Mkg %'), '10')
      await __t.wait(700)
    `)
    const tot = await js(`return __t.totals()`)
    // First ring in the list is RIN00001 at 10.000 g
    check('goods amount (10 x 4590)', tot['Goods Amount'], '45,900.00')
    check('making amount (10% of 45,900)', tot['Making Amount'], '4,590.00')
    check('bill amount incl. hallmark', tot['Bill Amount'], '50,535.00')
    // 3% is shown as the two halves the printed bill carries, never as one line.
    check('CGST @ 1.5%', tot['CGST @ 1.5%'], '758.03')
    check('SGST @ 1.5%', tot['SGST @ 1.5%'], '758.03')
    check('total', tot['Total'], '₹52,051.05')

    // ── Reverse calculation: name a figure, let the making land on it ──
    // Metal, stone and hallmark are fixed; only the making can move, so asking
    // for ₹60,000 must come back with a making percentage that gets there
    // exactly — GST and all.
    await js(`
      const box = [...document.querySelectorAll('input')]
        .find(i => i.placeholder === 'e.g. 150000')
      __t.set(box, '60000')
      await __t.wait(200)
      __t.click('Fit Making')
      await __t.wait(700)
    `)
    const fitted = await js(`return __t.totals()`)
    check('reverse calc lands on the asked figure', fitted['Total'], '₹60,000.00')
    // 60,000 / 1.03 = 58,252.43 basic, less 45,900 metal and 45 hallmark.
    check('and it got there on the making', fitted['Making Amount'], '12,307.43')
    check('leaving the metal untouched', fitted['Goods Amount'], '45,900.00')
    const fitNote = await js(`
      return document.querySelector('.small.ok')?.textContent.trim() || ''
    `)
    check('the fit says what it did', /^Making set to \d+\.\d\d% — the bill comes to ₹60,000\.00$/.test(fitNote), true)

    // Asking for less than the metal is worth is refused, not silently clamped.
    await js(`
      const box = [...document.querySelectorAll('input')]
        .find(i => i.placeholder === 'e.g. 150000')
      __t.set(box, '1000')
      await __t.wait(200)
      __t.click('Fit Making')
      await __t.wait(600)
    `)
    const refusal = await js(`return __t.toasts().join(' | ')`)
    check('an impossible figure is refused', /cannot be reached by making charges/.test(refusal), true)

    // Put the bill back the way the rest of this flow expects it.
    await js(`
      __t.set(__t.gridInput('Mkg %'), '10')
      await __t.wait(600)
    `)
    check('restored for the save', (await js(`return __t.totals()`))['Total'], '₹52,051.05')

    await js(`__t.click('Save'); await __t.wait(1400)`)
    const bills = api.sale.list({})
    check('bill created from UI', bills.length, 1)
    check('bill numbered', bills[0]?.bill_no, 'COM1')
    check('bill linked to customer', bills[0]?.party_name, 'Sandip Jain')
    check('saved goods match the on-screen total', bills[0]?.goods_amount, 45900)
    check('saved total matches', bills[0]?.total_amount, 52051.05)
    check('customer khata updated by the bill',
      api.party.balance({ id: S.customers.sandip }).balance, 9500 + 52051.05)
    ok('stock consumed by the UI bill',
      api.tagStock.list({ status: 'SOLD' }).length === 1)

    // ── 5b. Shortcuts that save the counter steps ──
    head('5b. Shortcuts — scan, start from a customer, return from a bill')
    const inStock = api.tagStock.list({ status: 'IN_STOCK' })
    const inStockTag = inStock[0].tag
    // A second piece of the same purity, to see the rate carried down to it.
    const twinTag = inStock.find((t) => t.id !== inStock[0].id && t.purity === inStock[0].purity)?.tag
    const soldTag = api.tagStock.list({ status: 'SOLD' })[0].tag
    await nav('Sales Invoice')
    const scan = await js(`
      __t.click('New Bill'); await __t.wait(700)
      const enter = async (row, v) => {
        const box = document.querySelector('input[data-tag-row="' + row + '"]')
        box.focus(); __t.set(box, v)
        box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
        await __t.wait(700)
      }
      await enter(0, 'NOSUCH99')
      const notFound = __t.toasts().join(' | ')
      await enter(0, '${soldTag}')
      const sold = __t.toasts().join(' | ')
      await enter(0, '${inStockTag}')
      const focusRow = document.activeElement?.dataset?.tagRow ?? ''
      __t.set(__t.gridInput('Rate/10Gm'), '45900'); await __t.wait(300)
      let carried = ''
      if ('${twinTag || ''}') {
        await enter(1, '${twinTag || ''}')
        const rows = document.querySelectorAll('.grid-edit tbody tr')
        const idx = [...document.querySelectorAll('.grid-edit thead th')].findIndex(th => th.textContent.trim() === 'Rate/10Gm')
        carried = rows[1]?.children[idx]?.querySelector('input')?.value || ''
      }
      return { notFound, sold, focusRow, carried }
    `)
    ok('an unknown tag says so', /NOSUCH99 not found/.test(scan.notFound))
    ok('a sold tag says so', /is sold, not in stock/.test(scan.sold))
    check('after a scan the cursor waits on the next line', scan.focusRow, '1')
    if (twinTag) ok('the rate carries down to a piece of the same purity', /45,?900/.test(scan.carried))

    await nav('Customers')
    const fromCust = await js(`
      document.querySelector('button[title="New bill for this customer"]').click()
      await __t.wait(1500)
      return document.querySelector('.ac input.input')?.value || ''
    `)
    ok('a bill started from a customer row has the customer', fromCust.length > 0)

    await nav('Customers')
    const rcptFromCust = await js(`
      document.querySelector('button[title="Receive payment"]').click()
      await __t.wait(1500)
      const m = document.querySelector('.modal')
      return m ? (m.querySelector('.ac input.input')?.value || '') : ''
    `)
    ok('a receipt started from a customer row has the customer', rcptFromCust.length > 0)
    await js(`__t.click('Cancel', document.querySelector('.modal').parentElement); await __t.wait(300)`)

    await nav('Sales Register')
    const retFromBill = await js(`
      document.querySelector('button[title="Return goods from this bill"]').click()
      await __t.wait(1500)
      const m = document.querySelector('.modal')
      return m ? [...m.querySelectorAll('input')].map(i => i.value).join(' ') : ''
    `)
    ok('a return started from a bill has that bill', /COM1/.test(retFromBill))
    await js(`__t.click('Cancel', document.querySelector('.modal').parentElement); await __t.wait(300)`)

    // ── 6. Receipts ───────────────────────────────────────────────────
    head('6. Receipts — collect against the khata')
    await nav('Receipts')
    await js(`
      __t.click('New Receipt'); await __t.wait(600)
      const modal = document.querySelector('.modal')
      const pIn = modal.querySelector('.ac input.input'); pIn.focus()
      __t.set(pIn, 'Sandip'); await __t.wait(1300)
      document.querySelector('.ac-list .ac-item').click(); await __t.wait(800)
      const amt = [...modal.querySelectorAll('input.input')].find(i => i.classList.contains('right'))
      __t.set(amt, '15000'); await __t.wait(300)
      __t.click('Save', modal.parentElement); await __t.wait(900)
    `)
    const rcpts = api.voucher.list({ kind: 'RECEIPT' })
    check('receipt created from UI', rcpts.length, 1)
    check('receipt amount', rcpts[0]?.amount, 15000)

    // ── 7. Stock verification scan ────────────────────────────────────
    head('7. Stock Verification — scan flow')
    await nav('Stock Verification')
    const scanResult = await js(`
      const box = document.querySelector('input.mono')
      __t.set(box, 'CHA00001')
      box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
      await __t.wait(500)
      __t.set(box, 'BOGUS999')
      box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
      await __t.wait(500)
      return {
        found: document.querySelectorAll('tr.row-ok').length,
        missing: document.querySelectorAll('tr.row-bad').length,
        tiles: [...document.querySelectorAll('.stat-value')].map(v => v.textContent.trim()),
        extras: [...document.querySelectorAll('.badge-warn')].map(b => b.textContent.trim()),
      }`)
    check('scanned row turns green', scanResult.found, 1)
    ok('unscanned rows stay red', scanResult.missing > 0)
    check('found counter', scanResult.tiles[1], '1')
    ok('unknown tag flagged separately', scanResult.extras.includes('BOGUS999'))
    const itemWise = await js(`
      const card = [...document.querySelectorAll('.card')].find(c => c.querySelector('.card-title')?.textContent === 'Item-wise')
      return card ? card.querySelectorAll('tbody tr').length : 0`)
    ok('item-wise totals shown on verification', itemWise > 0)

    // ── 8. Gold scheme enrolment ──────────────────────────────────────
    head('8. Gold Scheme — create and enrol')
    await nav('Gold Scheme')
    await js(`
      [...document.querySelectorAll('.tab')].find(t => t.textContent.includes('Scheme Types')).click()
      await __t.wait(500)
      __t.click('New Scheme'); await __t.wait(500)
      const modal = document.querySelector('.modal')
      __t.set(modal.querySelector('input.input'), 'Test Plan'); await __t.wait(200)
      __t.click('Save', modal.parentElement); await __t.wait(800)
    `)
    check('scheme created from UI', api.gss.schemes().length, 1)

    await js(`
      [...document.querySelectorAll('.tab')].find(t => t.textContent.includes('Members')).click()
      await __t.wait(500)
      __t.click('Enrol Member'); await __t.wait(500)
      const modal = document.querySelector('.modal')
      const gIn = modal.querySelector('.ac input.input'); gIn.focus()
      __t.set(gIn, 'Priya'); await __t.wait(1300)
      document.querySelector('.ac-list .ac-item').click(); await __t.wait(600)
    `)
    // pick the scheme by its real id, then save
    const schemeId = api.gss.schemes()[0].id
    await js(`
      const modal = document.querySelector('.modal')
      __t.setSelect(modal.querySelector('select.select'), '${schemeId}')
      await __t.wait(500)
      __t.click('Enrol', modal.parentElement); await __t.wait(900)
    `)
    const accounts = api.gss.accounts({})
    check('member enrolled from UI', accounts.length, 1)
    check('schedule generated', api.gss.readAccount({ id: accounts[0].id }).receipts.length, 12)

    // ── 9. Reports render with data ───────────────────────────────────
    head('9. Reports')
    await nav('Stock Report')
    const stockRows = await js(`return {
      rows: document.querySelectorAll('.data tbody tr').length,
      tiles: [...document.querySelectorAll('.stat-value')].map(v => v.textContent.trim()) }`)
    ok('stock report lists tags', stockRows.rows > 0)
    ok('fine weight tile populated', stockRows.tiles[3] !== '0.000')

    await nav('Day Book')
    const dayRows = await js(`return document.querySelectorAll('.data tbody tr').length`)
    ok('day book renders rows', dayRows > 0)
    // The right-hand panel must show all three weight pairs per metal and every
    // money account, not one fine figure and one cash line.
    const pos = await js(`
      const card = [...document.querySelectorAll('.card')]
        .find(c => /Cash And Bank Accounts/.test(c.querySelector('.card-title')?.textContent || ''))
      if (!card) throw new Error('position panel missing')
      const cells = [...card.querySelectorAll('tbody tr')].map(r => r.textContent.trim())
      return {
        text: cells.join(' | '),
        metals: cells.filter(t => /:-$/.test(t)),
      }`)
    ok('gross weight pair shown', /Gross Wt/.test(pos.text))
    ok('net weight pair shown', /Net Wt/.test(pos.text))
    ok('final weight pair shown', /Final Wt/.test(pos.text))
    ok('a metal heading is present', pos.metals.length > 0)
    ok('the URD stock block is there', /URD Stock Details/.test(pos.text))
    ok('cash and bank both listed',
      /Cash Account/.test(pos.text) && /Bank Account/.test(pos.text))
    ok('today received details shown', /Today Received Details/.test(pos.text))

    // ── Accounting Books — the two statements must agree on screen ──────
    await nav('Accounting Books')
    // Trial Balance is the default tab. Read the two totals from the footer row.
    const tb = await js(`
      await __t.wait(400)
      const foot = [...document.querySelectorAll('.data tbody tr')].pop()
      const nums = [...foot.querySelectorAll('.num')].map(c => c.textContent.trim())
      return { dr: nums[0], cr: nums[1], rows: document.querySelectorAll('.data tbody tr').length }`)
    ok('trial balance lists heads', tb.rows > 1)
    check('trial balance foots on screen (Dr = Cr)', tb.dr, tb.cr)

    // Switch to the Balance Sheet tab and confirm it balances.
    const bs = await js(`
      const btn = [...document.querySelectorAll('.radio-row button')].find(b => /Balance Sheet/.test(b.textContent))
      btn.click(); await __t.wait(600)
      const foot = [...document.querySelectorAll('.data tbody tr')].pop()
      const nums = [...foot.querySelectorAll('.num')].map(c => c.textContent.trim())
      return { liab: nums[0], assets: nums[1] }`)
    check('balance sheet balances on screen (Assets = Liabilities)', bs.assets, bs.liab)

    // And the P&L tab surfaces a net-profit figure.
    const pl = await js(`
      const btn = [...document.querySelectorAll('.radio-row button')].find(b => /Profit/.test(b.textContent))
      btn.click(); await __t.wait(600)
      const tiles = [...document.querySelectorAll('.stat-value')].map(v => v.textContent.trim())
      return { tiles }`)
    ok('P&L shows gross and net figures', pl.tiles.length >= 2 && /₹/.test(pl.tiles[0]))

    await nav('Ledger')
    await js(`
      const lIn = document.querySelector('.ac input.input'); lIn.focus()
      __t.set(lIn, 'Sandip'); await __t.wait(1300)
      document.querySelector('.ac-list .ac-item').click(); await __t.wait(1100)
    `)
    const ledger = await js(`return {
      dr: document.querySelectorAll('.ledger table')[0]?.querySelectorAll('tbody tr').length || 0,
      cr: document.querySelectorAll('.ledger table')[1]?.querySelectorAll('tbody tr').length || 0,
      badge: document.querySelector('.balance-flag')?.textContent.trim() || '' }`)
    ok('ledger Dr column populated', ledger.dr > 0)
    ok('ledger Cr column populated', ledger.cr > 0)
    ok('ledger shows a balance', /Balance/.test(ledger.badge))

    // ── 10. Command palette & theme ───────────────────────────────────
    head('10. Shell — palette, shortcuts, theme')
    const palette = await js(`
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true }))
      await __t.wait(500)
      const input = document.querySelector('.palette input')
      input.focus()
      __t.set(input, 'Sandip'); await __t.wait(1200)
      const items = [...document.querySelectorAll('.palette-item')].map(i => i.textContent.trim())
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
      return items`)
    ok('palette finds a customer', palette.some(i => /Sandip/.test(i)))

    const themed = await js(`
      document.querySelector('[aria-label="Toggle theme"]').click(); await __t.wait(600)
      return document.documentElement.dataset.theme`)
    check('theme toggles to dark', themed, 'dark')
    check('theme persisted', api.settings.all().theme, 'dark')

    const shortcut = await js(`
      document.querySelector('[aria-label="Toggle theme"]').click(); await __t.wait(300)
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'F2', bubbles: true }))
      await __t.wait(800)
      return document.querySelector('.page-title').textContent.trim()`)
    check('F2 opens Sales Invoice', shortcut, 'Sales Invoice')

    // ── 8b. Cost price on the tag grid ────────────────────────────────
    head('8b. Cost/Gm — stock valuation')
    await nav('Tag & Barcode')
    await js(`
      __t.setSelect(document.querySelector('select.select'), '${pendant[0].id}')
      await __t.wait(700)
      const row = document.querySelectorAll('.grid-edit tbody tr')[0]
      const cells = row.querySelectorAll('input')
      // Tag grid: 0 gross, 7 purity, 10 cost/gm (bag/stone/diamond sit between).
      __t.set(cells[0], '10'); await __t.wait(150)      // gross
      __t.set(cells[7], '100'); await __t.wait(150)     // purity
      __t.set(cells[10], '5800'); await __t.wait(400)   // cost per fine gram
    `)
    await js(`__t.click('Save 1 tag'); await __t.wait(1300)`)
    const costed = api.tagStock.list({ status: 'IN_STOCK', search: 'PEN' })
      .find((t) => Number(t.purchase_rate) > 0)
    ok('cost per gram saved from the grid', !!costed)
    check('cost stored', costed?.purchase_rate, 5800)

    await nav('Stock Report')
    const valTile = await js(`
      await __t.wait(700)
      const t = [...document.querySelectorAll('.stat')]
        .find(s => s.querySelector('.stat-label')?.textContent.trim() === 'Value at Cost')
      return t ? t.textContent.trim() : ''`)
    ok('stock report shows a value at cost', /Value at Cost/.test(valTile))
    // 10 g @ 100% = 10.000 fine x 5800 = 58,000
    ok('and it includes the costed piece', /58,000/.test(valTile))
    ok('uncosted pieces are declared, not hidden', /no cost/.test(valTile))

    // ── 8c. Weightwise billing — the Balance Weight card ──────────────
    head('8c. Balance Weight — settling in metal')
    await nav('Sales Invoice')
    await js(`
      const cust = document.querySelector('.ac input.input')
      cust.focus(); __t.set(cust, 'Sandip'); await __t.wait(1300)
      const opt = document.querySelector('.ac-list .ac-item')
      if (!opt) throw new Error('customer autocomplete empty')
      opt.click(); await __t.wait(1200)
    `)
    // Tick "Weight-wise bill" — the Balance Weight card should appear.
    await js(`
      const lbl = [...document.querySelectorAll('label')]
        .find(l => /Weight-wise/i.test(l.textContent))
      if (!lbl) throw new Error('weightwise checkbox not found')
      const box = lbl.querySelector('input[type=checkbox]') || lbl.previousElementSibling
      box.click(); await __t.wait(900)
    `)
    const wwCard = await js(`
      return [...document.querySelectorAll('.card-title')].map(t => t.textContent.trim())`)
    ok('Balance Weight card appears when weightwise is on', wwCard.includes('Balance Weight'))

    await js(`
      const row = document.querySelectorAll('.grid-edit tbody tr')[0]
      const cells = row.querySelectorAll('input')
      cells[1].focus(); __t.set(cells[1], 'Ring'); await __t.wait(1500)
      const pick = document.querySelector('.ac-list .ac-item')
      if (!pick) throw new Error('item autocomplete empty')
      pick.click(); await __t.wait(1000)
    `)
    // Which tag the autocomplete offers depends on what earlier sections sold, so
    // the figures are checked against each other rather than pinned to one piece.
    const wwRow = await js(`
      const tables = [...document.querySelectorAll('.grid-edit')]
      const last = tables[tables.length - 1]
      const cells = last.querySelectorAll('tbody tr input')
      // fine sold, old gold, metal owed, settle now, rate, amount, pending
      __t.set(cells[4], '5'); await __t.wait(250)
      __t.set(cells[5], '5000'); await __t.wait(600)
      const after = [...document.querySelectorAll('.grid-edit')].pop()
        .querySelectorAll('tbody tr input')
      return {
        owed: after[3].value, settle: after[4].value,
        amount: after[6].value, pending: after[7].value,
      }`)
    const owed = Number(wwRow.owed)
    ok('metal owed is the fine weight of the piece', owed > 0)
    check('amount = settle x rate', wwRow.amount, '25,000.00')
    check('pending weight = owed - settled',
      Number(wwRow.pending), Number((owed - 5).toFixed(3)))
    const wwTot = await js(`return __t.totals()`)
    check('the bill is the settlement, not the line rate', wwTot['Goods Amount'], '25,000.00')
    const wwBadge = await js(`
      return [...document.querySelectorAll('.badge')].map(b => b.textContent.trim())`)
    ok('the unsettled metal is flagged on the card',
      wwBadge.some((t) => t.includes(`${wwRow.pending} g still owed`)))

    // ── 9. Returns — reverse a bill without touching it ───────────────
    head('9. Returns — goods back from a customer')
    const soldBefore = api.tagStock.list({ status: 'SOLD' }).length
    await nav('Returns')
    await js(`__t.click('New Sales Return'); await __t.wait(700)`)
    await js(`
      const m = document.querySelector('.modal')
      // Pull the original bill in — its lines should populate the grid.
      const bill = m.querySelectorAll('.ac input.input')[0]
      bill.focus(); __t.set(bill, 'COM'); await __t.wait(1400)
      const opt = document.querySelector('.ac-list .ac-item')
      if (!opt) throw new Error('bill autocomplete empty')
      opt.click(); await __t.wait(1200)
    `)
    const retPrefill = await js(`
      const m = document.querySelector('.modal')
      const party = m.querySelectorAll('.ac input.input')[1]
      const rows = m.querySelectorAll('.grid-edit tbody tr')
      return { party: party.value, lines: rows.length }`)
    ok('picking a bill fills the party in', !!retPrefill.party)
    ok('and pulls its lines into the grid', retPrefill.lines > 1)

    await js(`__t.click('Save Return'); await __t.wait(1400)`)
    const rets = api.saleReturn.list({})
    check('return saved from the UI', rets.length, 1)
    ok('it points back at the original bill', !!rets[0]?.against_bill_no)
    check('a sold piece came back to stock',
      api.tagStock.list({ status: 'SOLD' }).length, soldBefore - 1)

    // ── 9c. Order booking — karagir date + old gold at booking ────────
    head('9c. Order booking — karagir date and old gold')
    await nav('Orders')
    await js(`__t.click('New Order'); await __t.wait(700)`)
    await js(`
      const cust = document.querySelector('.ac input.input'); cust.focus()
      __t.set(cust, 'Sandip'); await __t.wait(1100)
      const opt = document.querySelector('.ac-list .ac-item')
      if (!opt) throw new Error('customer autocomplete empty')
      opt.click(); await __t.wait(300)
      // Three date inputs: order, delivery, karagir — set the karagir deadline.
      const dates = document.querySelectorAll('input[type=date]')
      __t.set(dates[2], '2026-08-05'); await __t.wait(100)
      // First item row: name / gross / purity / rate (fine, amount are read-only).
      // A short wait after each set lets React flush before the next controlled input.
      const item = document.querySelectorAll('.grid-edit')[0].querySelector('tbody tr').querySelectorAll('input')
      __t.set(item[0], 'Test Bangle'); await __t.wait(90)
      __t.set(item[2], '20'); await __t.wait(90)
      __t.set(item[5], '100'); await __t.wait(90)
      __t.set(item[7], '5000'); await __t.wait(120)
      // Old gold row: gross / purity / rate.
      const og = document.querySelectorAll('.grid-edit')[1].querySelector('tbody tr').querySelectorAll('input')
      __t.set(og[1], '10'); await __t.wait(90)
      __t.set(og[3], '100'); await __t.wait(90)
      __t.set(og[5], '5000'); await __t.wait(250)
    `)
    // The exact money maths are covered by test/orderbooking.cjs; here we only
    // prove the FORM wires the two new fields — karagir date and the old-gold
    // grid — through to a saved order.
    const obHasOldGold = await js(`
      return [...document.querySelectorAll('.total-row')].some(r => /Old Gold/.test(r.textContent))`)
    ok('old gold shows in the order summary', obHasOldGold)
    await js(`__t.click('Save Order'); await __t.wait(1400)`)
    const ob = api.order.list({}).find((o) => o.karagir_date === '2026-08-05')
    ok('order saved from UI with a karagir date', !!ob)
    const obRead = ob && api.order.read({ id: ob.id })
    check('old gold captured on the order', obRead?.urds?.length || 0, 1)
    ok('and posted to the customer gold khata',
      ob && api.party.metalBalance({ id: ob.party_id }).balance < 0)

    // ── 9d. Stock report — correcting a piece in place ────────────────
    head('9d. Stock Report — edit in place')
    await nav('Stock Report')
    const before = api.tagStock.list({ status: 'IN_STOCK' })
      .find((t) => t.tag === 'PEN00001')
    ok('the pendant tagged in section 3 is on the shelf', !!before)
    await js(`__t.click('Edit Stock'); await __t.wait(700)`)
    // Find the pendant's row by its tag and retype the gross weight and purity,
    // as a stock-take would after re-weighing the piece.
    const edited = await js(`
      const row = [...document.querySelectorAll('table.data tbody tr')]
        .find(r => r.textContent.includes('PEN00001'))
      if (!row) throw new Error('PEN00001 not on the stock report')
      const cells = row.querySelectorAll('input.cell')
      if (!cells.length) throw new Error('grid did not become editable')
      __t.set(cells[0], '9.000'); await __t.wait(120)   // gross
      __t.set(cells[2], '75'); await __t.wait(250)      // purity
      const after = [...document.querySelectorAll('table.data tbody tr')]
        .find(r => r.textContent.includes('PEN00001'))
      return {
        editable: cells.length,
        // Net is read-only and must have followed the typing live. Fine is no
        // longer a column here; the engine's recompute is checked after Save.
        text: after.textContent,
        marked: after.className.includes('row-ok'),
      }`)
    check('the row became editable', edited.editable, 6)
    ok('net recomputes as you type', /9\.000/.test(edited.text))
    ok('the changed row is marked', edited.marked)
    await js(`__t.click('Save'); await __t.wait(1200)`)
    const after = api.tagStock.list({ status: 'IN_STOCK' }).find((t) => t.tag === 'PEN00001')
    check('gross weight saved', after?.gross_wt, 9)
    check('purity saved', after?.purity, 75)
    check('fine weight recomputed by the engine', after?.final_wt, 6.75)
    const relabel = await js(`
      await __t.wait(400)
      const bar = [...document.querySelectorAll('.note')].find(n => /labels? on (it|them) (is|are) out of date/.test(n.textContent))
      if (!bar) return { bar: false, modal: '' }
      __t.click('Print labels', bar); await __t.wait(1200)
      const title = document.querySelector('.modal')?.textContent || ''
      __t.click('Cancel', document.querySelector('.modal').parentElement); await __t.wait(300)
      return { bar: true, modal: title }
    `)
    ok('after a weight change the stock report offers to reprint the label', relabel.bar)
    ok('and Print labels opens the label sheet for that piece', /Print Barcode Labels — 1 tag/.test(relabel.modal))

    // ── 10. Karagir job work — the metal reconciliation ───────────────
    head('10. Karagir job work')
    const kar = api.party.save({ party_type: 'KARAGIR', name: 'Test Karagir', metals: [] })
    await nav('Orders')
    await js(`__t.click('Karagir Job Work'); await __t.wait(800)`)
    await js(`
      const box = document.querySelector('.ac input.input')
      box.focus(); __t.set(box, 'Test Kar'); await __t.wait(1300)
      const opt = document.querySelector('.ac-list .ac-item')
      if (!opt) throw new Error('karagir autocomplete empty')
      opt.click(); await __t.wait(900)
    `)
    await js(`__t.click('Issue Material'); await __t.wait(700)`)
    await js(`
      const m = document.querySelector('.modal')
      const ins = m.querySelectorAll('input')
      // date, item, sub-order, gross, less, purity, remark
      __t.set(ins[3], '10'); await __t.wait(200)
      __t.set(ins[5], '100'); await __t.wait(300)
      __t.click('Save', m); await __t.wait(1300)
    `)
    check('issue posted to the karagir', api.party.metalBalance({ id: kar }).balance, 10)

    const tiles = await js(`
      await __t.wait(600)
      return [...document.querySelectorAll('.stat')].map(s => ({
        label: s.querySelector('.stat-label')?.textContent.trim(),
        value: s.querySelector('.stat-value')?.textContent.trim(),
      }))`)
    const outstanding = tiles.find((x) => x.label === 'Still With Karagir')
    ok('the outstanding tile is on screen', !!outstanding)
    ok('and shows the issued metal', /10/.test(outstanding?.value || ''))

    await js(`__t.click('Receive Order'); await __t.wait(700)`)
    await js(`
      const m = document.querySelector('.modal')
      const ins = m.querySelectorAll('input')
      __t.set(ins[3], '9.9'); await __t.wait(200)   // gross back
      __t.set(ins[5], '100'); await __t.wait(200)   // purity
      __t.set(ins[8], '1'); await __t.wait(300)     // wastage %
      __t.click('Save', m); await __t.wait(1400)
    `)
    const led = api.karagir.ledger({ karagirId: kar })
    check('received back', led.totals.received, 9.9)
    check('wastage allowed', led.totals.wastage, 0.099)
    check('still unaccounted', led.totals.outstanding, 0.001)

    // ── 11. Metal settlement — closing a gold balance in cash ─────────
    head('11. Settle metal for cash')
    await nav('Receipts')
    await js(`__t.click('Metal Settlement'); await __t.wait(700)`)
    await js(`__t.click('New Settlement'); await __t.wait(700)`)
    await js(`
      const m = document.querySelector('.modal')
      const box = m.querySelector('.ac input.input')
      box.focus(); __t.set(box, 'Test Kar'); await __t.wait(1300)
      const opt = document.querySelector('.ac-list .ac-item')
      if (!opt) throw new Error('party autocomplete empty')
      opt.click(); await __t.wait(900)
    `)
    const prefill = await js(`
      const m = document.querySelector('.modal')
      const ins = [...m.querySelectorAll('input')]
      return ins.map(i => i.value)`)
    ok('the outstanding weight is pre-filled', prefill.some((v) => /0\.001/.test(v)))

    // ── 12. Money + Gold statement ────────────────────────────────────
    head('12. Money + Gold — one statement')
    await js(`__t.click('Cancel'); await __t.wait(500)`)
    await nav('Ledger / Khata')
    await js(`
      const box = document.querySelector('.ac input.input')
      box.focus(); __t.set(box, 'Test Kar'); await __t.wait(1300)
      const opt = document.querySelector('.ac-list .ac-item')
      if (opt) opt.click()
      await __t.wait(900)
      __t.click('Money + Metal'); await __t.wait(1100)
    `)
    const combined = await js(`
      const hs = [...document.querySelectorAll('table.data thead th')].map(h => h.textContent.trim())
      const flags = [...document.querySelectorAll('.balance-flag')].map(f => f.textContent.trim())
      return { hs, flags }`)
    ok('the statement carries a rupee balance column', combined.hs.includes('Balance ₹'))
    ok('and a gram balance column', combined.hs.includes('Balance g'))
    ok('both closing balances are shown together', combined.flags.length >= 2)

    // ── 12a2. Purchase — quick supplier, and the rate typed per ten grams ──
    head('12a2. Purchase — a new supplier and a per-10g rate')
    await nav('Purchase')
    await js(`__t.click('New Purchase'); await __t.wait(900)`)
    // The supplier nobody has entered yet: created from the invoice itself,
    // rather than abandoning a half-typed bill for the Masters screen.
    await js(`
      const box = document.querySelector('.ac input.input')
      box.focus(); __t.set(box, 'Sangam Bullion'); await __t.wait(500)
      const plus = [...document.querySelectorAll('button')]
        .find(b => b.title === 'New supplier')
      if (!plus) throw new Error('supplier + button missing')
      plus.click(); await __t.wait(700)
      const m = document.querySelector('.modal')
      const boxes = m.querySelectorAll('input.input')
      __t.set(boxes[1], '9822011111')   // mobile
      __t.set(boxes[2], 'Pune')         // city
      await __t.wait(200)
      __t.click('Save', m.parentElement); await __t.wait(1100)
    `)
    const supp = api.party.list({ type: 'SUPPLIER' }).find((p) => p.name === 'Sangam Bullion')
    ok('supplier created from the purchase screen', !!supp)
    check('with what was typed', supp?.city, 'Pune')
    check('and the invoice picked it up',
      await js(`return document.querySelector('.ac input.input').value`), 'Sangam Bullion')

    // The shop quotes 1,47,400 per ten grams. Everything stored stays per gram,
    // so the line must price on 14,740 — the figure from the counter photo.
    const purch = await js(`
      const c = document.querySelectorAll('.grid-edit tbody tr')[0].querySelectorAll('input')
      // 0 item, 1 qty, 2 gross, 3 black beads, 4 stone, 5 net, 6 purity,
      // 7 wastage%, 8 fine+wst (read-only), 9 rate/10gm, 10 amount (read-only).
      __t.set(c[0], 'Gold Bar')
      __t.set(c[2], '15.68')
      __t.set(c[5], '15.68')
      __t.set(c[6], '76')
      __t.set(c[7], '3')
      __t.set(c[9], '147400')
      await __t.wait(800)
      const row = document.querySelectorAll('.grid-edit tbody tr')[0].querySelectorAll('input')
      return { fine: row[8].value, rate: row[9].value, amount: row[10].value }
    `)
    check('fine+wastage on the added touch', purch.fine, '12.387')
    check('the rate box still reads per ten grams', purch.rate, '147400')
    // 14,740 / 99.5 x 15.68 x (76 + 3) — the 995 basis, unchanged.
    check('amount priced on the per-gram rate', purch.amount, '1,83,504.85')
    await js(`__t.click('Cancel'); await __t.wait(700)`)

    // ── 12b. Making Master seeds the tag grid ─────────────────────────
    head('12b. Making Master — set a rule, see it seed a tag')
    await nav('Settings')
    await js(`
      const t = [...document.querySelectorAll('.tab')].find(x => /Making/.test(x.textContent))
      if (!t) throw new Error('Making & Wastage tab missing')
      t.click(); await __t.wait(800)
      __t.click('New Rule'); await __t.wait(600)
      const m = document.querySelector('.modal')
      const sels = m.querySelectorAll('select.select')
      // Scope defaults to GROUP; pick the 22K Gold group and set 425/gm.
      __t.setSelect(sels[1], '${groups.find((g) => g.name === '22K Gold').id}')
      await __t.wait(250)
      const boxes = m.querySelectorAll('input.input')
      __t.set(boxes[0], '425'); await __t.wait(200)
      __t.click('Save', m.parentElement); await __t.wait(900)
    `)
    const rules = api.rateMaster.list({ kind: 'MAKING' })
    check('rule saved from the UI', rules.length, 1)
    check('at the rate typed', rules[0]?.per_gram, 425)
    // The pendant made in section 3 is in 22K Gold, so the rule reaches it.
    check('and it resolves to the item',
      api.rateMaster.resolve({ itemId: pendant[0].id }).making_per_gram, 425)

    await nav('Tag & Barcode')
    const seeded = await js(`
      __t.setSelect(document.querySelector('select.select'), '${pendant[0].id}')
      await __t.wait(900)
      // "Same for every piece" bar: purity, making/gm, hallmark, cost/gm…
      const bar = [...document.querySelectorAll('.field')]
        .find(f => /Making \\/gm/.test(f.textContent))
      return { value: bar?.querySelector('input')?.value, hint: bar?.textContent }`)
    check('the tag grid starts at the master rate', seeded.value, '425')
    ok('and says where it came from', /From the master/.test(seeded.hint || ''))

    // ── 12c. Every report screen can print and export ─────────────────
    head('12c. Print and Export reach every report')
    // A report a shop cannot print is a report it will not use. Each screen is
    // opened for real and its toolbar inspected — no screen may quietly offer
    // fewer options than the others.
    const REPORTS = [
      'Stock Report', 'Day Book', 'Outstanding', 'Accounting Books',
      'Cash Book & Registers', 'GST Reports', 'MIS & Scheme Reports', 'Branches & Transfer',
    ]
    for (const screen of REPORTS) {
      await nav(screen)
      const btns = await js(`
        return [...document.querySelectorAll('button')].map(b => b.textContent.trim())`)
      const hasPrint = btns.some((b) => /Print/i.test(b))
      const hasExport = btns.some((b) => /Export/i.test(b))
      ok(`${screen}: can print`, hasPrint)
      ok(`${screen}: can export`, hasExport)
    }
    // And the export menu really offers all three formats, not just CSV.
    await nav('Stock Report')
    const allBtns = await js(`
      const b = [...document.querySelectorAll('button')].find(x => /Export/i.test(x.textContent))
      b.click(); await __t.wait(400)
      return [...document.querySelectorAll('button')].map(x => x.textContent.trim())`)
    const formats = allBtns.filter((t) => /\.(csv|xls|doc)\)/.test(t))
    check('three export formats offered', formats.length, 3)
    ok('Excel among them', formats.some((f) => /xls/.test(f)))
    ok('Word among them', formats.some((f) => /doc/.test(f)))

    // ── 13. Restore from backup — the confirmation dialog ─────────────
    head('13. Restore from backup')
    await nav('Settings')
    await js(`
      const t = [...document.querySelectorAll('.tab')].find(x => /Data/.test(x.textContent))
      t.click(); await __t.wait(900)
      __t.click('Choose Backup File'); await __t.wait(1100)
    `)
    const dlg = await js(`
      const m = document.querySelector('.modal')
      if (!m) return null
      return {
        title: m.querySelector('.modal-title')?.textContent.trim(),
        body: m.textContent,
        rows: [...m.querySelectorAll('table.data tbody tr')].map(r =>
          [...r.querySelectorAll('td')].map(td => td.textContent.trim())),
      }`)
    ok('the confirmation dialog opens', !!dlg)
    check('titled as a restore', dlg?.title, 'Restore from backup')
    ok('it compares the backup against the live books',
      (dlg?.rows || []).some(r => r[0] === 'Customers & suppliers' && r[1] === '2' && r[2] === '9'))
    ok('it warns what will be replaced', /will be replaced/i.test(dlg?.body || ''))
    ok('and says the current books are saved first', /pre-restore/.test(dlg?.body || ''))

    await js(`__t.click('Replace my data'); await __t.wait(1200)`)
    ok('confirming calls restore with the chosen file',
      !!restoreCalledWith && /parivar-backup/.test(restoreCalledWith.filePath || ''))

  } catch (e) {
    fail++
    failures.push('UNCAUGHT: ' + e.message)
    console.error('\nUNCAUGHT\n', e.stack || e.message)
  }

  console.log('\n' + '='.repeat(64))
  console.log(`  ${pass} passed, ${fail} failed`)
  console.log(`  console errors: ${consoleErrors.length}`)
  consoleErrors.slice(0, 5).forEach((e) => console.log('   ! ' + e))
  if (failures.length) {
    console.log('\n  Failures:')
    failures.forEach((f) => console.log('   - ' + f))
  }
  console.log('='.repeat(64))
  process.exit(fail || consoleErrors.length ? 1 : 0)
})
