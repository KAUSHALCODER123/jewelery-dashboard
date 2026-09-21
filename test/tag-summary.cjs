/** Regression for the WhatsApp report: All loose metal must show what is left
 * to label, including after conversion and when switching purchases/metals.
 * Runs against a temporary database, never the shop's data.
 * npm run build && electron test/tag-summary.cjs
 */
const { app, BrowserWindow, ipcMain } = require('electron')
const path = require('node:path')
const fs = require('node:fs')
const os = require('node:os')
const assert = require('node:assert/strict')
// Also run against release/win-unpacked/resources/app.asar to check packaging.
const appRoot = process.env.PARIVAR_TEST_APP_DIR || path.join(__dirname, '..')

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'parivar-tag-summary-'))
app.setPath('userData', path.join(temp, 'profile'))
setTimeout(() => { console.error('TIMEOUT'); app.exit(1) }, 90000).unref()

app.whenReady().then(async () => {
  require(path.join(appRoot, 'electron/db.cjs')).open(path.join(temp, 'data'))
  const api = require(path.join(appRoot, 'electron/api.cjs'))
  const { auth, bootstrap } = require(path.join(appRoot, 'electron/auth.cjs'))
  bootstrap()
  for (const [group, methods] of Object.entries({ ...api, auth })) {
    for (const [name, fn] of Object.entries(methods)) {
      ipcMain.handle(`${group}:${name}`, (_event, params) => {
        try { return { ok: true, data: fn(params ?? {}) } }
        catch (e) { return { ok: false, error: e.message } }
      })
    }
  }
  ipcMain.handle('app:info', () => ({ version: 'test', dataDir: temp }))
  const groups = api.itemGroup.list()
  const makeItem = (name, group) => api.item.save({
    name, item_type_id: group.item_type_id, item_group_id: group.id, design_id: null,
    weight_mode: 'WEIGHT', stock_mode: 'TAG', uom: 'GRAM', hsn: '7113', image: '',
  })
  const gold = makeItem('Gold ring', groups.find(g => g.name === '22K Gold'))
  const silver = makeItem('Silver ring', groups.find(g => /silver/i.test(g.name)))
  api.looseStock.opening({ metal: 'Gold', fine_wt: 100 })
  api.looseStock.opening({ metal: 'Silver', fine_wt: 92.5 })
  const supplier = api.party.save({ name: 'Test supplier', party_type: 'SUPPLIER' })
  const purchase = api.purchase.save({
    head: { prefix: 'MI', invoice_date: '2026-09-21', party_id: supplier,
      party_name: 'Test supplier', is_credit: 1, gst_pct: 0, metal: 'Gold' },
    items: [{ item_id: gold, item_name: 'Gold ring', gross_wt: 50, net_wt: 50,
      purity: 91.6, rate: 6000, wastage_pct: 0 }],
  })
  const win = new BrowserWindow({ show: false, width: 1280, height: 900,
    webPreferences: { preload: path.join(appRoot, 'electron/preload.cjs'),
      contextIsolation: true, sandbox: false, backgroundThrottling: false, offscreen: true } })
  const errors = []
  win.webContents.on('console-message', (_e, level, message) => {
    if (level >= 2 && !/Content-Security-Policy/.test(message)) errors.push(message)
  })
  const js = code => win.webContents.executeJavaScript(code)
  const screenshot = async name => {
    // DOM changes precede Chromium's paint; let the transition finish before capture.
    await new Promise(resolve => setTimeout(resolve, 500))
    fs.writeFileSync(path.join(temp, name), (await win.webContents.capturePage()).toPNG())
  }
  const waitFor = async code => {
    for (let i = 0; i < 100; i++) {
      if (await js(code)) return
      await new Promise(resolve => setTimeout(resolve, 50))
    }
    throw new Error(`Timed out: ${code}`)
  }
  await win.loadFile(path.join(appRoot, 'dist/index.html'))
  await waitFor("document.querySelector('.login-brand img')?.naturalWidth > 0")
  await screenshot('login.png')
  auth.login({ username: 'admin', password: 'admin' })
  await win.reload()
  await waitFor("document.querySelector('.nav-item')")
  await js(`window.test = {
    click(text) {
      const button = [...document.querySelectorAll('button')].find(b => b.textContent.trim().startsWith(text))
      if (!button) throw new Error('Missing button: ' + text)
      button.click()
    },
    select(kind, value) {
      const el = [...document.querySelectorAll('select')].find(s =>
        [...s.options].some(o => o.textContent.includes(kind)))
      if (!el) throw new Error('Missing select: ' + kind)
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(el, value)
      el.dispatchEvent(new Event('change', { bubbles: true }))
    },
    gross(value) {
      const el = document.querySelector('.grid-edit tbody input')
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, value)
      el.dispatchEvent(new Event('input', { bubbles: true }))
    },
    total(label) {
      const el = [...document.querySelectorAll('.small.muted')].find(e => e.textContent === label)
      return el?.nextElementSibling?.textContent
    }
  }; test.click('Tag & Barcode')`)
  await waitFor("document.body.textContent.includes('Where is this metal from?')")
  await js("test.click('From loose metal')")
  await waitFor("test.total('Still to label (fine)') === '145.800 g'")
  await js(`test.select('Choose an item', '${gold}')`)
  await waitFor("document.querySelector('.grid-edit tbody input')")
  await js(`test.select('All loose metal', '${purchase.id}')`)
  await waitFor("test.total('Still to label (net)') === '50.000 g'")
  assert.equal(await js("test.total('Available to use (fine)')"), '145.800 g')
  await js("test.select('All loose metal', '')")
  await waitFor("test.total('Still to label (fine)') === '145.800 g'")
  await js("test.gross('10')")
  await waitFor("test.total('These pieces need (fine)') === '9.160 g'")
  assert.equal(await js("test.total('Left after (fine)')"), '136.640 g')
  await js("test.click('Convert')")
  await waitFor("test.total('Still to label (fine)') === '136.640 g'")
  assert.equal(api.purchase.tally({ id: purchase.id }).pending_net, 50)
  console.log('PASS: pooled summary, purchase switch, live preview and unlinked conversion')

  await js(`test.select('All loose metal', '${purchase.id}')`)
  await waitFor("test.total('Still to label (net)') === '50.000 g'")
  await js("test.gross('50')")
  await waitFor("test.total('These pieces need (fine)') === '45.800 g'")
  await js("test.click('Convert')")
  await waitFor("test.total('Still to label (net)') === '0.000 g'")
  assert.equal(api.purchase.tally({ id: purchase.id }).status, 'TALLIED')
  assert.equal(await js("test.total('Available to use (fine)')"), '90.840 g')
  console.log('PASS: completed purchase stays selected and shows zero remaining')

  await js("test.select('All loose metal', '')")
  await waitFor("test.total('Still to label (fine)') === '90.840 g'")
  await screenshot('tags.png')
  await js(`test.select('Choose an item', '${silver}')`)
  await waitFor("test.total('Still to label (fine)') === '92.500 g'")
  await js("test.gross('10000')")
  await waitFor("document.querySelector('button[title=\"Not enough loose metal on hand\"]')?.disabled")
  await js("test.gross('0')")
  await js(`test.select('Choose an item', '${gold}')`)
  await waitFor("test.total('Still to label (fine)') === '90.840 g'")
  console.log('PASS: separate metal balances and insufficient-stock protection')
  await js("document.querySelector('.data tbody input[type=checkbox]').click()")
  await js("test.click('Print labels')")
  await waitFor("document.querySelector('iframe[title=\"Label preview\"]')?.contentDocument?.querySelector('.shop-logo')?.naturalWidth > 0")
  await screenshot('label-preview.png')
  await js("[...document.querySelectorAll('.modal label')].find(e => e.textContent.includes('Company logo')).click()")
  await waitFor("!document.querySelector('iframe[title=\"Label preview\"]').contentDocument.querySelector('.shop-logo')")
  await js("test.click('Cancel')")
  console.log('PASS: barcode-label preview shows company image and logo switch works')
  await js("document.querySelector('[aria-label=\"Toggle theme\"]').click()")
  await js("document.querySelector('[aria-label=\"Toggle sidebar\"]').click()")
  await waitFor("document.querySelector('.shell')?.dataset.collapsed === 'true'")
  assert.equal(await js("document.querySelector('.brand img').naturalWidth > 0"), true)
  await waitFor("document.documentElement.dataset.theme === 'dark'")
  await screenshot('dark-collapsed.png')
  assert.deepEqual(errors, [])
  console.log('PASS: branding loads on login and collapsed/dark sidebar; no console errors')
  console.log('Screenshots: ' + temp)
  app.exit(0)
}).catch(error => { console.error(error); app.exit(1) })
