/** Headless UI check: mounts the built app, visits every screen, reports console errors. */
const { app, BrowserWindow, ipcMain } = require('electron')
const path = require('node:path')
const fs = require('node:fs')
const os = require('node:os')

process.on('unhandledRejection', (e) => {
  console.error('UNHANDLED', e && (e.stack || e.message || e))
  process.exit(1)
})
// Watchdog: never let a stuck page hold the run open.
setTimeout(() => { console.error('TIMEOUT after 90s'); process.exit(1) }, 90_000).unref()

// Give each run its own Chromium profile — otherwise two test processes
// fight over the same cache directory and the slower one flakes.
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'parivar-run-')))

app.whenReady().then(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'parivar-ui-'))
  const db = require('../electron/db.cjs')
  db.open(tmp)
  const api = require('../electron/api.cjs')
  const { auth, bootstrap } = require('../electron/auth.cjs')
  bootstrap()
  auth.login({ username: 'admin', password: 'admin' })  // harness signs in as owner

  for (const [g, ms] of Object.entries({ ...api, auth }))
    for (const [n, fn] of Object.entries(ms))
      ipcMain.handle(`${g}:${n}`, (_e, p) => {
        try { return { ok: true, data: fn(p ?? {}) } }
        catch (e) { return { ok: false, error: e.message } }
      })
  ipcMain.handle('app:info', () => ({ version: '1.0.0', dataDir: tmp }))
  ipcMain.handle('print:html', () => ({ ok: true }))
  ipcMain.handle('send:whatsapp', () => ({ ok: true }))
  ipcMain.handle('send:sms', () => ({ ok: true }))
  ipcMain.handle('send:email', () => ({ ok: true }))

  // Minimal data so the screens have something to render.
  const groups = api.itemGroup.list()
  const g22 = groups.find((g) => g.name === '22K Gold')
  const itemId = api.item.save({
    name: 'Ring', item_type_id: g22.item_type_id, item_group_id: g22.id,
    design_id: null, weight_mode: 'WEIGHT', uom: 'GRAM', hsn: '7113', image: '',
  })
  api.tagStock.saveBatch({ itemId, rows: [{ gross_wt: 12, purity: 91.6 }] })
  api.party.save({ party_type: 'CUSTOMER', name: 'Sandip Jain', opening_balance: 9500, opening_dr_cr: 'Dr', metals: [] })
  api.party.save({ party_type: 'SUPPLIER', name: 'Mahavir Gold', metals: [] })

  const w = new BrowserWindow({
    show: false, width: 1440, height: 900,
    webPreferences: {
      preload: path.join(__dirname, '..', 'electron', 'preload.cjs'),
      contextIsolation: true, sandbox: false,
    },
  })

  const errors = []
  w.webContents.on('console-message', (_e, level, msg) => {
    if (level >= 2 && !/Content-Security-Policy/.test(msg)) errors.push(msg.slice(0, 200))
  })
  w.webContents.on('render-process-gone', (_e, d) => errors.push('CRASH ' + JSON.stringify(d)))

  await w.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))
  await new Promise((r) => setTimeout(r, 1500))


  const assert = require('node:assert/strict')
  const result = await w.webContents.executeJavaScript(`(async () => {
    const pause = () => new Promise(r => setTimeout(r, 250))
    const click = text => { const b = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === text); if (!b) throw new Error('Missing ' + text); b.click() }
    const settings = [...document.querySelectorAll('.nav-item')].find(b => b.textContent.includes('Settings')); settings.click(); await pause()
    const toggle = [...document.querySelectorAll('label')].find(l => l.textContent.includes('Navigate list rows')); toggle.querySelector('input').click(); await pause()
    click('Invoice Design'); await pause(); click('Enable custom layout'); await pause()
    click('+ Add field'); await pause()
    const input = [...document.querySelectorAll('.field')].find(f => f.querySelector('label')?.textContent.trim() === 'Field label').querySelector('input')
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, 'Customer reference')
    input.dispatchEvent(new Event('input', { bubbles: true })); await pause()
    const drag = new DataTransfer(); drag.setData('application/invoice-field', 'header')
    document.querySelectorAll('.invoice-cell')[2].dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer: drag })); await pause()
    click('Save Design'); await pause()
    const saved = JSON.parse((await window.api.settings.all()).invoice_config)
    const count = document.querySelectorAll('.invoice-block').length
    const nav = localStorage.getItem('tab-list-navigation')
    document.querySelectorAll('.nav-item')[0].click(); await pause(); settings.click(); await pause(); click('Invoice Design'); await pause()
    return { count, nav, saved, reloaded: document.querySelectorAll('.invoice-block').length }
  })()`)
  assert.equal(result.count, 9); assert.equal(result.reloaded, 9); assert.equal(result.nav, 'true')
  assert.equal(result.saved.layout.fields.find(f => f.id === 'header').row, 2)
  assert.ok(result.saved.layout.fields.some(f => f.label === 'Customer reference'))
  assert.equal(errors.length, 0, errors.join('\n'))
  console.log('PASS: editor drag/drop, custom field editing, save/reload, navigation option')
  process.exit(0)
}).catch(e => { console.error(e); process.exit(1) })

