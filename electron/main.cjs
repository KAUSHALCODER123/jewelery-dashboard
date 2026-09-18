const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron')
const path = require('node:path')
const fs = require('node:fs')

const db = require('./db.cjs')
const api = require('./api.cjs')
const backups = require('./backup.cjs')
const { auth, session, bootstrap } = require('./auth.cjs')
const { gdrive, init: initDrive } = require('./gdrive.cjs')
const { mobile, init: initMobile, stop: stopMobile } = require('./mobile.cjs')

const isDev = process.env.NODE_ENV === 'development'
let win = null

function createWindow() {
  win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    show: false,
    backgroundColor: '#FBFBFB',
    title: 'Parivar Jewellery ERP',
    icon: path.join(__dirname, '..', 'build', 'icon.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })

  win.once('ready-to-show', () => win.show())
  win.setMenuBarVisibility(false)

  if (isDev) {
    win.loadURL('http://localhost:5173')
  } else {
    win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))
  }

  // External links open in the real browser, never inside the app shell.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url)
    return { action: 'deny' }
  })
}

app.whenReady().then(() => {
  db.open(app.getPath('userData'))
  bootstrap()          // creates the default owner on a fresh database
  initDrive(app.getPath('userData'))
  initMobile()         // read-only phone view, only if the owner switched it on
  registerIpc()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('before-quit', () => { stopMobile() })

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

/**
 * Which permission each channel needs. Anything not listed needs only a signed-in
 * user ("daily"). These checks live here, in the main process, because anything
 * enforced only in the renderer can be bypassed from developer tools.
 */
const CHANNEL_PERMISSION = {
  // Owner only — destroying a document cannot be undone.
  'sale:remove': 'permanent_delete',
  'urd:remove': 'permanent_delete',
  'purchase:remove': 'permanent_delete',
  'refinery:remove': 'permanent_delete',
  'order:remove': 'permanent_delete',
  'voucher:remove': 'permanent_delete',
  'party:remove': 'permanent_delete',
  'item:remove': 'permanent_delete',
  'itemGroup:remove': 'permanent_delete',
  'itemType:remove': 'permanent_delete',
  'design:remove': 'permanent_delete',
  'gss:removeAccount': 'permanent_delete',
  'gss:removeScheme': 'permanent_delete',

  // Manager and above — these move metal irreversibly.
  'tagStock:remove': 'irreversible_stock',
  'refinery:save': 'irreversible_stock',

  // Owner only — shop-wide configuration and taking the whole database out.
  'company:save': 'manage_settings',
  'series:save': 'manage_settings',
  'account:save': 'manage_settings',
  'backup:create': 'restore_backup',
  'backup:inspect': 'restore_backup',
  'backup:restore': 'restore_backup',

  // Google Drive moves the entire database off this machine — owner only.
  'gdrive:status': 'restore_backup',
  'gdrive:saveCredentials': 'restore_backup',
  'gdrive:connect': 'restore_backup',
  'gdrive:disconnect': 'restore_backup',
  'gdrive:setAutoDaily': 'restore_backup',
  'gdrive:backupNow': 'restore_backup',
  'gdrive:listBackups': 'restore_backup',
  'gdrive:openFolder': 'restore_backup',

  // Mobile view opens the books to the shop's Wi-Fi — owner only.
  'mobile:status': 'manage_settings',
  'mobile:qr': 'manage_settings',
  'mobile:setEnabled': 'manage_settings',
  'mobile:setPort': 'manage_settings',
}

/** Channels usable before signing in. */
const PUBLIC_CHANNELS = new Set(['auth:login', 'auth:status', 'auth:logout', 'auth:permissions'])

function guard(channel) {
  if (PUBLIC_CHANNELS.has(channel)) return
  session.require(CHANNEL_PERMISSION[channel] ?? 'daily')
}

/**
 * Expose every api.<group>.<method> as an IPC channel named "group:method".
 * Errors are returned as { ok:false, error } rather than thrown across the bridge.
 */
function registerIpc() {
  for (const [group, methods] of Object.entries({ ...api, auth, gdrive, mobile })) {
    for (const [name, fn] of Object.entries(methods)) {
      ipcMain.handle(`${group}:${name}`, async (_evt, payload) => {
        try {
          guard(`${group}:${name}`)
          // Some groups (Google Drive) are async; await covers both cases.
          return { ok: true, data: await fn(payload ?? {}) }
        } catch (err) {
          console.error(`[ipc] ${group}:${name}`, err.message)
          return { ok: false, error: err.message || String(err) }
        }
      })
    }
  }

  // ── Printing ──────────────────────────────────────────────────────────
  ipcMain.handle('print:html', async (_evt, { html, silent = false }) => {
    session.require('daily')
    const w = new BrowserWindow({
      show: false,
      webPreferences: { sandbox: true, contextIsolation: true },
    })
    try {
      await w.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html))
      await new Promise((r) => setTimeout(r, 250))
      const ok = await new Promise((resolve) => {
        w.webContents.print(
          { silent, printBackground: true, margins: { marginType: 'none' } },
          (success) => resolve(success)
        )
      })
      return { ok }
    } finally {
      w.destroy()
    }
  })

  ipcMain.handle('print:pdf', async (_evt, { html, suggestedName = 'document.pdf' }) => {
    session.require('daily')
    const { canceled, filePath } = await dialog.showSaveDialog(win, {
      defaultPath: suggestedName,
      filters: [{ name: 'PDF', extensions: ['pdf'] }],
    })
    if (canceled || !filePath) return { ok: false, cancelled: true }

    const w = new BrowserWindow({ show: false, webPreferences: { sandbox: true } })
    try {
      await w.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html))
      await new Promise((r) => setTimeout(r, 250))
      const pdf = await w.webContents.printToPDF({ printBackground: true, pageSize: 'A4' })
      fs.writeFileSync(filePath, pdf)
      shell.showItemInFolder(filePath)
      return { ok: true, filePath }
    } finally {
      w.destroy()
    }
  })

  // ── Export / backup ───────────────────────────────────────────────────
  ipcMain.handle('file:saveText', async (_evt, { content, suggestedName, filters }) => {
    session.require('daily')
    const { canceled, filePath } = await dialog.showSaveDialog(win, {
      defaultPath: suggestedName,
      filters: filters || [{ name: 'CSV', extensions: ['csv'] }],
    })
    if (canceled || !filePath) return { ok: false, cancelled: true }
    fs.writeFileSync(filePath, content, 'utf8')
    shell.showItemInFolder(filePath)
    return { ok: true, filePath }
  })

  ipcMain.handle('backup:create', async () => {
    session.require('restore_backup')
    const src = path.join(app.getPath('userData'), 'data', 'parivar.db')
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
    const { canceled, filePath } = await dialog.showSaveDialog(win, {
      defaultPath: `parivar-backup-${stamp}.db`,
      filters: [{ name: 'SQLite database', extensions: ['db'] }],
    })
    if (canceled || !filePath) return { ok: false, cancelled: true }
    db.get().pragma('wal_checkpoint(TRUNCATE)')
    fs.copyFileSync(src, filePath)
    shell.showItemInFolder(filePath)
    return { ok: true, filePath }
  })

  /** What is in the file the owner picked, and what is in the live shop today. */
  ipcMain.handle('backup:inspect', async () => {
    session.require('restore_backup')
    const { canceled, filePaths } = await dialog.showOpenDialog(win, {
      title: 'Choose a backup to restore',
      properties: ['openFile'],
      filters: [{ name: 'SQLite database', extensions: ['db'] }],
    })
    if (canceled || !filePaths?.length) return { ok: false, cancelled: true }
    return {
      ok: true,
      backup: backups.inspect(filePaths[0]),
      current: backups.summarise(db.get()),
    }
  })

  /**
   * Replace the live database with a backup, then restart — the only way to be
   * sure nothing is still holding rows from the database that was swapped out.
   */
  ipcMain.handle('backup:restore', async (_e, { filePath } = {}) => {
    session.require('restore_backup')
    if (!filePath) throw new Error('No backup file was chosen.')
    const { safety } = backups.restore({
      filePath, dataDir: path.join(app.getPath('userData'), 'data'), db,
    })
    // Let the reply reach the screen before the window disappears.
    setTimeout(() => { app.relaunch(); app.exit(0) }, 600)
    return { ok: true, safety }
  })

  // ── Messaging ─────────────────────────────────────────────────────────
  // These only hand a URL to the OS default handler. The app never contacts
  // WhatsApp/SMS/mail itself, holds no credentials, and sends nothing on its
  // own — the user still presses send in whichever app opens.
  const digits = (s) => String(s || '').replace(/\D/g, '')

  function phoneE164(mobile, cc = '91') {
    const d = digits(mobile)
    if (!d) return null
    if (d.length > 10 && d.startsWith(cc)) return d
    if (d.length === 10) return cc + d
    return d
  }

  ipcMain.handle('send:whatsapp', async (_evt, { mobile, text }) => {
    const p = phoneE164(mobile)
    if (!p) return { ok: false, error: 'No mobile number on this record' }
    await shell.openExternal(`https://wa.me/${p}?text=${encodeURIComponent(text || '')}`)
    return { ok: true }
  })

  ipcMain.handle('send:sms', async (_evt, { mobile, text }) => {
    const d = digits(mobile)
    if (!d) return { ok: false, error: 'No mobile number on this record' }
    await shell.openExternal(`sms:${d}?body=${encodeURIComponent(text || '')}`)
    return { ok: true }
  })

  ipcMain.handle('send:email', async (_evt, { email, subject, text }) => {
    if (!email) return { ok: false, error: 'No email address on this record' }
    await shell.openExternal(
      `mailto:${email}?subject=${encodeURIComponent(subject || '')}&body=${encodeURIComponent(text || '')}`
    )
    return { ok: true }
  })

  ipcMain.handle('app:info', () => ({
    version: app.getVersion(),
    dataDir: path.join(app.getPath('userData'), 'data'),
  }))
}
