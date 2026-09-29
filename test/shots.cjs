/** Renders key screens with sample data and saves PNGs to test/shots/. */
const { app, BrowserWindow, ipcMain } = require('electron')
const path = require('node:path')
const fs = require('node:fs')
const os = require('node:os')

process.on('unhandledRejection', (e) => { console.error('UNHANDLED', e); process.exit(1) })
setTimeout(() => { console.error('TIMEOUT'); process.exit(1) }, 120_000).unref()

// Give each run its own Chromium profile — otherwise two test processes
// fight over the same cache directory and the slower one flakes.
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'parivar-run-')))

app.whenReady().then(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'parivar-shot-'))
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
  for (const c of ['send:whatsapp', 'send:sms', 'send:email']) ipcMain.handle(c, () => ({ ok: true }))

  // ── Sample shop data ──
  api.company.save({ ...api.company.read(), name: 'Parivar Jewellers', address: 'MG Road, Pune',
    phone: '9767211065', gstin: '27ABCDE1234F1Z5', bank_name: 'HDFC Bank',
    account_no: '50100123456789', branch: 'Kothrud', ifsc: 'HDFC0001234' })

  const groups = api.itemGroup.list()
  const g22 = groups.find((g) => g.name === '22K Gold')
  const g18 = groups.find((g) => g.name === '18K Gold')
  const ring = api.item.save({ name: 'Ring', item_type_id: g22.item_type_id, item_group_id: g22.id,
    design_id: null, weight_mode: 'WEIGHT', uom: 'GRAM', hsn: '7113', image: '' })
  const chain = api.item.save({ name: 'Chain', item_type_id: g22.item_type_id, item_group_id: g22.id,
    design_id: null, weight_mode: 'WEIGHT', uom: 'GRAM', hsn: '7113', image: '' })
  const bangle = api.item.save({ name: 'Bangle', item_type_id: g18.item_type_id, item_group_id: g18.id,
    design_id: null, weight_mode: 'WEIGHT', uom: 'GRAM', hsn: '7113', image: '' })

  api.tagStock.saveBatch({ itemId: ring, rows: [
    { gross_wt: 10, purity: 91.6, mkg_per_gm: 300 }, { gross_wt: 12, purity: 91.6, mkg_per_gm: 300 },
    { gross_wt: 15, purity: 91.6, mkg_per_gm: 280 }] })
  api.tagStock.saveBatch({ itemId: chain, rows: [
    { gross_wt: 24.5, purity: 91.6, mkg_per_gm: 220 }, { gross_wt: 31.2, purity: 91.6, mkg_per_gm: 210 }] })
  api.tagStock.saveBatch({ itemId: bangle, rows: [
    { gross_wt: 18.4, stone_wt: 1.2, purity: 75, mkg_per_gm: 420 }] })

  const p1 = api.party.save({ party_type: 'CUSTOMER', name: 'Sandip Jain', area: 'Kothrud',
    mobile: '9767211065', whatsapp: '9767211065', opening_balance: 9500, opening_dr_cr: 'Dr', metals: [] })
  api.party.save({ party_type: 'CUSTOMER', name: 'Amit Patel', area: 'Baner', mobile: '9822011223',
    opening_balance: 0, opening_dr_cr: 'Dr', metals: [] })
  api.party.save({ party_type: 'CUSTOMER', name: 'Priya Deshmukh', area: 'Aundh', mobile: '9890455667',
    opening_balance: 2400, opening_dr_cr: 'Cr', metals: [] })
  api.party.save({ party_type: 'SUPPLIER', name: 'Mahavir Gold', city: 'Mumbai', metals: [] })

  const tags = api.tagStock.list({ status: 'IN_STOCK' })
  const t = (code) => tags.find((x) => x.tag === code)

  api.sale.save({
    head: { prefix: 'COM', bill_date: new Date().toISOString().slice(0, 10), party_id: p1,
      party_name: 'Sandip Jain', mobile: '9767211065', area: 'Kothrud', is_credit: 1,
      gst_pct: 3, amount_received: 0 },
    items: [{ tag: t('RIN00002').tag, tag_stock_id: t('RIN00002').id, item_id: ring,
      item_name: 'Ring', hsn: '7113', gross_wt: 12, purity: 91.6, stone_wt: 0, net_wt: 12,
      rate_per_gm: 4590, mkg_per_gm: 300, hallmark_charges: 0 }],
    urds: [{ name: 'Old Gold', description: 'chain', gross_wt: 3, net_wt: 3, purity: 80, rate: 4500 }],
  })
  api.sale.save({
    head: { prefix: 'COM', bill_date: new Date().toISOString().slice(0, 10), party_name: 'Amit Patel',
      is_credit: 0, gst_pct: 3, amount_received: 120000 },
    items: [{ tag: t('CHA00001').tag, tag_stock_id: t('CHA00001').id, item_id: chain,
      item_name: 'Chain', hsn: '7113', gross_wt: 24.5, purity: 91.6, stone_wt: 0, net_wt: 24.5,
      rate_per_gm: 4590, mkg_per_gm: 220, hallmark_charges: 0 }],
    urds: [],
  })
  api.voucher.save({ kind: 'RECEIPT', voucher_date: new Date().toISOString().slice(0, 10),
    party_id: p1, party_name: 'Sandip Jain', amount: 30000, payment_type: 'Cash' })

  const w = new BrowserWindow({ show: true, width: 1560, height: 1000,
    webPreferences: { preload: path.join(__dirname, '..', 'electron', 'preload.cjs'),
      contextIsolation: true, sandbox: false } })
  // Offscreen windows throttle compositing, which yields stale/blank capture frames.
  w.webContents.setBackgroundThrottling(false)
  await w.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))
  await new Promise((r) => setTimeout(r, 3200))

  const out = path.join(__dirname, 'shots')
  fs.mkdirSync(out, { recursive: true })

  const shoot = async (name) => {
    // Force a fresh frame before grabbing pixels.
    await w.webContents.executeJavaScript('new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))')
    await new Promise((r) => setTimeout(r, 700))
    const img = await w.webContents.capturePage()
    fs.writeFileSync(path.join(out, `${name}.png`), img.toPNG())
    console.log('shot', name)
  }

  const nav = async (label) => {
    await w.webContents.executeJavaScript(
      `[...document.querySelectorAll('.nav-item')].find(b => b.textContent.trim().startsWith(${JSON.stringify(label)})).click()`)
    await new Promise((r) => setTimeout(r, 1100))
  }

  await shoot('01-dashboard')
  await nav('Sales Invoice'); await shoot('02-sales-invoice')
  await nav('Stock Report'); await shoot('03-stock')
  await nav('Gold Scheme'); await shoot('04-scheme')
  await nav('Settings')
  await w.webContents.executeJavaScript(
    `[...document.querySelectorAll('.tab')].find(b => b.textContent.includes('Invoice Design')).click()`)
  await new Promise((r) => setTimeout(r, 1200))
  await shoot('05-invoice-design')

  // Dark theme check
  await w.webContents.executeJavaScript(
    `document.querySelector('[aria-label="Toggle theme"]').click()`)
  await nav('Dashboard')
  await shoot('06-dark')

  process.exit(0)
})
