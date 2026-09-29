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

  // Discovered from the sidebar rather than hard-coded: a screen added to the
  // app without being added to a list here would otherwise never be rendered by
  // any test, and the suite would stay green while shipping it untouched.
  const screens = await w.webContents.executeJavaScript(`
    [...document.querySelectorAll('.nav-item')].map(b => b.textContent.trim())
      .filter(Boolean)
  `)
  if (!screens.length) throw new Error('No nav items found — did the app render?')

  const results = []
  for (const name of screens) {
    const before = errors.length
    const r = await w.webContents.executeJavaScript(`(async () => {
      const btn = [...document.querySelectorAll('.nav-item')]
        .find(b => b.textContent.trim().startsWith(${JSON.stringify(name)}))
      if (!btn) return { found: false }
      btn.click()
      await new Promise(r => setTimeout(r, 550))
      return {
        found: true,
        title: document.querySelector('.page-title')?.textContent,
        nodes: document.querySelector('.content')?.querySelectorAll('*').length ?? 0,
      }
    })()`)
    results.push({ screen: name, ...r, newErrors: errors.length - before })
  }

  console.log('SCREENS ' + JSON.stringify(results, null, 1))
  console.log('ERRORS ' + JSON.stringify(errors.slice(0, 10), null, 1))
  process.exit(errors.length ? 1 : 0)
})
