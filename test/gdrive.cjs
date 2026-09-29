/**
 * Google Drive backup — everything that can be checked without contacting Google.
 * The OAuth round-trip and the upload itself need a real Google account, so those
 * are exercised by hand; this covers the logic around them.
 */
const { app, safeStorage } = require('electron')
const path = require('node:path')
const fs = require('node:fs')
const os = require('node:os')

let pass = 0, fail = 0
const bugs = []
const check = (label, actual, expected) => {
  const good = String(actual) === String(expected)
  if (good) { pass++; console.log(`   ok   ${label}  =  ${actual}`) }
  else { fail++; bugs.push(`${label}: got ${actual}, expected ${expected}`)
         console.log(`   FAIL ${label}: got ${actual}, expected ${expected}`) }
}
const rejects = (label, fn) => {
  const done = (ok) => {
    if (ok) { pass++; console.log(`   ok   ${label}  =  blocked`) }
    else { fail++; bugs.push(`${label}: allowed`); console.log(`   FAIL ${label}: allowed`) }
  }
  try {
    const r = fn()
    if (r && typeof r.then === 'function') return r.then(() => done(false), () => done(true))
    done(false)
  } catch { done(true) }
}
const head = (t) => console.log(`\n── ${t} ${'─'.repeat(Math.max(0, 54 - t.length))}`)

app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'parivar-run-')))

app.whenReady().then(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'parivar-gd-'))
  require('../electron/db.cjs').open(tmp)
  const { auth, bootstrap, session } = require('../electron/auth.cjs')
  const { gdrive, init, FOLDER_NAME, KEEP_BACKUPS } = require('../electron/gdrive.cjs')
  bootstrap()
  init(tmp)

  try {
    head('1. Before anything is configured')
    const s0 = gdrive.status()
    check('not configured', s0.configured, false)
    check('not connected', s0.connected, false)
    check('backup folder name', s0.folderName, FOLDER_NAME)
    check('retention count', s0.keepBackups, KEEP_BACKUPS)
    check('encryption available on this machine', s0.encryptionAvailable, true)

    head('2. Saving Google credentials')
    rejects('empty client id refused', () => gdrive.saveCredentials({ clientId: '', clientSecret: 'x' }))
    rejects('malformed client id refused',
      () => gdrive.saveCredentials({ clientId: 'not-a-google-id', clientSecret: 'x' }))
    gdrive.saveCredentials({
      clientId: '1234567890-abcdef.apps.googleusercontent.com',
      clientSecret: 'GOCSPX-testsecret',
    })
    const s1 = gdrive.status()
    check('now configured', s1.configured, true)
    check('client id shown back', s1.clientId, '1234567890-abcdef.apps.googleusercontent.com')
    check('still not connected', s1.connected, false)

    head('3. The client secret is never stored in the clear')
    const db = require('../electron/db.cjs').get()
    const stored = db.prepare(`SELECT value FROM settings WHERE key='gdrive_client_secret'`).get().value
    check('secret is not readable in the database', stored.includes('GOCSPX-testsecret'), false)
    check('it decrypts back correctly',
      safeStorage.decryptString(Buffer.from(stored, 'base64')), 'GOCSPX-testsecret')

    head('4. Nothing works until connected')
    await rejects('cannot back up before connecting', () => gdrive.backupNow())
    await rejects('cannot list backups before connecting', () => gdrive.listBackups())
    rejects('connect refuses without credentials saved', () => {
      gdrive.disconnect()
      db.prepare(`DELETE FROM settings WHERE key='gdrive_client_id'`).run()
      return gdrive.connect()
    })

    head('5. Daily automatic backup switch')
    gdrive.saveCredentials({
      clientId: '1234567890-abcdef.apps.googleusercontent.com',
      clientSecret: 'GOCSPX-testsecret',
    })
    check('off by default', gdrive.status().autoDaily, false)
    gdrive.setAutoDaily({ enabled: true })
    check('switched on', gdrive.status().autoDaily, true)
    check('auto backup skips when not connected',
      (await gdrive.maybeAutoBackup()).skipped, 'not connected')
    gdrive.setAutoDaily({ enabled: false })
    check('auto backup skips when switched off',
      (await gdrive.maybeAutoBackup()).skipped, 'off')

    head('6. Changing credentials drops any existing grant')
    db.prepare(`INSERT OR REPLACE INTO settings (key,value) VALUES ('gdrive_refresh_token','x')`).run()
    db.prepare(`INSERT OR REPLACE INTO settings (key,value) VALUES ('gdrive_email','a@b.com')`).run()
    gdrive.saveCredentials({
      clientId: '9999-zzz.apps.googleusercontent.com', clientSecret: 'GOCSPX-other',
    })
    check('old grant cleared', gdrive.status().connected, false)
    check('old account cleared', gdrive.status().email, '')

    head('7. Disconnecting clears everything')
    db.prepare(`INSERT OR REPLACE INTO settings (key,value) VALUES ('gdrive_refresh_token','y')`).run()
    db.prepare(`INSERT OR REPLACE INTO settings (key,value) VALUES ('gdrive_folder_id','f1')`).run()
    gdrive.disconnect()
    const s2 = gdrive.status()
    check('token gone', s2.connected, false)
    check('folder id gone',
      db.prepare(`SELECT COUNT(*) c FROM settings WHERE key='gdrive_folder_id'`).get().c, 0)
    check('credentials survive a disconnect', s2.configured, true)

    head('8. Only the owner may touch Drive')
    auth.login({ username: 'admin', password: 'admin' })
    const staff = auth.addUser({ username: 'ramesh', name: 'R', role: 'staff', password: 'abcd' })
    auth.logout()
    auth.login({ username: 'ramesh', password: 'abcd' })
    // The IPC layer maps every gdrive channel to 'restore_backup', which is owner-only.
    rejects('staff blocked from Drive actions', () => session.require('restore_backup'))
    auth.logout()
    auth.login({ username: 'admin', password: 'admin' })
    check('owner allowed', session.require('restore_backup').role, 'owner')

  } catch (e) {
    fail++
    bugs.push('UNCAUGHT: ' + e.message)
    console.error('\nUNCAUGHT\n', e.stack || e.message)
  }

  console.log('\n' + '='.repeat(62))
  console.log(`  ${pass} passed, ${fail} failed`)
  if (bugs.length) { console.log('\n  Failures:'); bugs.forEach((b) => console.log('   - ' + b)) }
  console.log('='.repeat(62))
  process.exit(fail ? 1 : 0)
})
