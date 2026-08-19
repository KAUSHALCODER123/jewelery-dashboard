/** Screenshots the app against the REAL seeded database (run `npm run demo` first). */
const { app, BrowserWindow, ipcMain } = require('electron')
const path = require('node:path')
const fs = require('node:fs')

process.on('unhandledRejection', (e) => { console.error('UNHANDLED', e); process.exit(1) })
setTimeout(() => { console.error('TIMEOUT'); process.exit(1) }, 150_000).unref()

app.whenReady().then(async () => {
  const db = require('../electron/db.cjs')
  db.open(app.getPath('userData'))
  const api = require('../electron/api.cjs')
  const { auth, bootstrap } = require('../electron/auth.cjs')
  bootstrap()
  auth.login({ username: 'admin', password: 'admin' })  // harness signs in as owner

  for (const [g, ms] of Object.entries({ ...api, auth }))
    for (const [n, fn] of Object.entries(ms))
      ipcMain.handle(`${g}:${n}`, (_e, p) => {
        try { return { ok: true, data: fn(p ?? {}) } } catch (e) { return { ok: false, error: e.message } }
      })
  ipcMain.handle('app:info', () => ({ version: '1.0.0', dataDir: '' }))
  ipcMain.handle('print:html', () => ({ ok: true }))
  for (const c of ['send:whatsapp', 'send:sms', 'send:email']) ipcMain.handle(c, () => ({ ok: true }))

  const w = new BrowserWindow({ show: true, width: 1600, height: 1020,
    webPreferences: { preload: path.join(__dirname, '..', 'electron', 'preload.cjs'),
      contextIsolation: true, sandbox: false } })
  await w.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))
  await new Promise((r) => setTimeout(r, 2600))
  // The very first frame after a window is shown can be stale; discard one capture.
  await w.webContents.capturePage()
  await new Promise((r) => setTimeout(r, 1500))

  const out = path.join(__dirname, 'shots-live')
  fs.mkdirSync(out, { recursive: true })
  const shoot = async (n) => {
    const where = await w.webContents.executeJavaScript(
      "document.querySelector('.page-title')?.textContent + ' | rows=' + document.querySelectorAll('.data tbody tr').length")
    console.log('   at shoot(' + n + '):', where)
    await w.webContents.executeJavaScript('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))')
    await new Promise((r) => setTimeout(r, 500))
    fs.writeFileSync(path.join(out, n + '.png'), (await w.webContents.capturePage()).toPNG())
    console.log('shot', n)
  }
  const nav = async (label) => {
    await w.webContents.executeJavaScript(
      `[...document.querySelectorAll('.nav-item')].find(b=>b.textContent.trim().startsWith(${JSON.stringify(label)})).click()`)
    await new Promise((r) => setTimeout(r, 1200))
  }

  // Navigate away and back so the compositor definitely paints THIS window
  // (a freshly shown window can capture a stale surface from whatever was there before).
  await nav('Sales Register'); await nav('Dashboard')
  await shoot('01-dashboard')
  await nav('Sales Register'); await shoot('02-sales-register')
  await nav('Stock Report'); await shoot('03-stock')
  await nav('Day Book'); await shoot('04-daybook')
  await nav('Ledger')
  await w.webContents.executeJavaScript(`(async()=>{
    const set=(el,v)=>{Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set.call(el,v);el.dispatchEvent(new Event('input',{bubbles:true}))}
    const i=document.querySelector('.ac input.input'); i.focus(); set(i,'Sandip')
    await new Promise(r=>setTimeout(r,1300))
    document.querySelector('.ac-list .ac-item').click()
    await new Promise(r=>setTimeout(r,1300))
  })()`)
  await shoot('05-ledger')
  await nav('Gold Scheme'); await shoot('06-scheme')
  await nav('Orders'); await shoot('07-orders')
  await nav('Refining'); await shoot('08-refining')
  process.exit(0)
})
