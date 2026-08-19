/**
 * Google Drive backup — OAuth 2.0 for installed apps (loopback + PKCE) and
 * upload through the Drive REST API.
 *
 * Design notes
 * ────────────
 * • **Scope is `drive.file` only.** That grants access solely to files this app
 *   itself creates. The app cannot read, list or touch anything else in the
 *   user's Drive — and because it is a non-sensitive scope, Google does not
 *   require a verification review.
 *
 * • **PKCE + loopback redirect**, which is what Google mandates for desktop
 *   apps. The consent page opens in the user's real browser (never in an
 *   embedded window, which Google blocks and which could capture passwords),
 *   and a short-lived local HTTP server catches the redirect.
 *
 * • **The refresh token is encrypted with the OS keystore** (DPAPI on Windows)
 *   via Electron's safeStorage before it goes anywhere near the database. If
 *   encryption is unavailable we refuse to connect rather than write a
 *   long-lived credential to disk in the clear.
 *
 * • No new npm dependency — plain `node:https`.
 */
const http = require('node:http')
const https = require('node:https')
const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
const { shell, safeStorage } = require('electron')
const { get } = require('./db.cjs')

const SCOPES = [
  'https://www.googleapis.com/auth/drive.file',
  'openid',
  'email',
].join(' ')

const FOLDER_NAME = 'Parivar Jewellery ERP Backups'
const KEEP_BACKUPS = 10

/* ───────────────────────────── settings helpers ───────────────────────────── */

const setting = (key) =>
  get().prepare(`SELECT value FROM settings WHERE key = ?`).get(key)?.value ?? ''

const putSetting = (key, value) =>
  get().prepare(
    `INSERT INTO settings (key, value) VALUES (?,?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  ).run(key, String(value ?? ''))

const delSetting = (key) => get().prepare(`DELETE FROM settings WHERE key = ?`).run(key)

/** Encrypt with the OS keystore; refuse rather than store a token in the clear. */
function seal(text) {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error(
      'This computer cannot encrypt saved credentials, so Google Drive cannot be connected safely.'
    )
  }
  return safeStorage.encryptString(String(text)).toString('base64')
}

function unseal(b64) {
  if (!b64) return ''
  try {
    return safeStorage.decryptString(Buffer.from(b64, 'base64'))
  } catch {
    return ''
  }
}

/* ───────────────────────────── tiny HTTPS helpers ───────────────────────────── */

function request(options, body) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      const chunks = []
      res.on('data', (c) => chunks.push(c))
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8')
        let json = null
        try { json = text ? JSON.parse(text) : null } catch { /* not json */ }
        if (res.statusCode >= 200 && res.statusCode < 300) return resolve(json ?? text)
        const msg = json?.error?.message || json?.error_description || json?.error || text
        reject(new Error(`Google returned ${res.statusCode}: ${String(msg).slice(0, 300)}`))
      })
    })
    req.on('error', (e) =>
      reject(new Error(`Could not reach Google — check the internet connection. (${e.message})`))
    )
    if (body) req.write(body)
    req.end()
  })
}

const postForm = (host, pathname, params) => {
  const body = new URLSearchParams(params).toString()
  return request({
    host, path: pathname, method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Content-Length': Buffer.byteLength(body),
    },
  }, body)
}

const apiGet = (pathname, token) =>
  request({
    host: 'www.googleapis.com', path: pathname, method: 'GET',
    headers: { Authorization: `Bearer ${token}` },
  })

/* ───────────────────────────── tokens ───────────────────────────── */

const b64url = (buf) =>
  buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

const credentials = () => ({
  clientId: setting('gdrive_client_id'),
  clientSecret: unseal(setting('gdrive_client_secret')),
})

let accessToken = null
let accessExpiry = 0

/** Return a valid access token, refreshing it if needed. */
async function getAccessToken() {
  if (accessToken && Date.now() < accessExpiry - 60_000) return accessToken

  const { clientId, clientSecret } = credentials()
  const refresh = unseal(setting('gdrive_refresh_token'))
  if (!clientId || !refresh) throw new Error('Google Drive is not connected')

  const res = await postForm('oauth2.googleapis.com', '/token', {
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refresh,
    grant_type: 'refresh_token',
  })
  accessToken = res.access_token
  accessExpiry = Date.now() + (res.expires_in ?? 3600) * 1000
  return accessToken
}

/* ───────────────────────────── OAuth consent flow ───────────────────────────── */

const DONE_PAGE = (ok, message) => `<!doctype html>
<meta charset="utf-8"><title>Parivar Jewellery ERP</title>
<style>
  body{font-family:"Segoe UI",Arial,sans-serif;background:#FBFBFB;color:#333;
       display:flex;align-items:center;justify-content:center;height:100vh;margin:0}
  .c{max-width:420px;text-align:center;background:#fff;border:1px solid #E7E3DA;
     border-radius:14px;padding:34px 30px;box-shadow:0 8px 24px rgba(0,0,0,.07)}
  .m{width:54px;height:54px;border-radius:14px;margin:0 auto 16px;
     background:linear-gradient(135deg,#F2D882,#D4AF37 48%,#9E791C)}
  h1{font-size:18px;margin:0 0 8px}
  p{color:#6B6862;font-size:14px;margin:0}
</style>
<div class="c">
  <div class="m"></div>
  <h1>${ok ? 'Google Drive connected' : 'Could not connect'}</h1>
  <p>${message}</p>
</div>`

/**
 * Open Google's consent page in the default browser and wait for the redirect.
 * Resolves once a refresh token has been stored.
 */
function connect() {
  const { clientId, clientSecret } = credentials()
  if (!clientId) {
    throw new Error(
      'Enter your Google Client ID and Secret first — see Settings → Data & Backup.'
    )
  }

  const verifier = b64url(crypto.randomBytes(32))
  const challenge = b64url(crypto.createHash('sha256').update(verifier).digest())
  const state = b64url(crypto.randomBytes(16))

  return new Promise((resolve, reject) => {
    let settled = false
    const finish = (fn, arg) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      server.close()
      fn(arg)
    }

    const server = http.createServer(async (req, res) => {
      const url = new URL(req.url, 'http://127.0.0.1')
      if (url.pathname !== '/callback') { res.writeHead(404).end(); return }

      const send = (ok, msg) => {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
        res.end(DONE_PAGE(ok, msg))
      }

      if (url.searchParams.get('error')) {
        send(false, 'You cancelled the request. Nothing was changed.')
        return finish(reject, new Error('Google sign-in was cancelled'))
      }
      if (url.searchParams.get('state') !== state) {
        send(false, 'Security check failed. Please try again from the app.')
        return finish(reject, new Error('OAuth state mismatch — the request was not genuine'))
      }

      try {
        const tokens = await postForm('oauth2.googleapis.com', '/token', {
          code: url.searchParams.get('code'),
          client_id: clientId,
          client_secret: clientSecret,
          redirect_uri: redirectUri,
          grant_type: 'authorization_code',
          code_verifier: verifier,
        })
        if (!tokens.refresh_token) {
          throw new Error(
            'Google did not return a long-lived token. Remove this app at ' +
            'myaccount.google.com/permissions and connect again.'
          )
        }

        putSetting('gdrive_refresh_token', seal(tokens.refresh_token))
        accessToken = tokens.access_token
        accessExpiry = Date.now() + (tokens.expires_in ?? 3600) * 1000

        // Which account did they authorise? Handy to show in Settings.
        let email = ''
        try {
          const info = await apiGet('/oauth2/v3/userinfo', tokens.access_token)
          email = info?.email || ''
        } catch { /* not fatal */ }
        putSetting('gdrive_email', email)
        putSetting('gdrive_connected_at', new Date().toISOString())

        send(true, 'You can close this tab and return to Parivar Jewellery ERP.')
        finish(resolve, { email })
      } catch (err) {
        send(false, 'Something went wrong. Please try again from the app.')
        finish(reject, err)
      }
    })

    let redirectUri = ''
    server.listen(0, '127.0.0.1', () => {
      redirectUri = `http://127.0.0.1:${server.address().port}/callback`
      const auth = new URL('https://accounts.google.com/o/oauth2/v2/auth')
      auth.searchParams.set('client_id', clientId)
      auth.searchParams.set('redirect_uri', redirectUri)
      auth.searchParams.set('response_type', 'code')
      auth.searchParams.set('scope', SCOPES)
      auth.searchParams.set('code_challenge', challenge)
      auth.searchParams.set('code_challenge_method', 'S256')
      auth.searchParams.set('access_type', 'offline')  // ask for a refresh token
      auth.searchParams.set('prompt', 'consent')       // …every time, so we always get one
      auth.searchParams.set('state', state)
      shell.openExternal(auth.toString())
    })

    server.on('error', (e) => finish(reject, e))
    const timer = setTimeout(
      () => finish(reject, new Error('Timed out waiting for Google sign-in')),
      5 * 60_000
    )
  })
}

/* ───────────────────────────── Drive operations ───────────────────────────── */

/** Find the backup folder, creating it the first time. */
async function ensureFolder(token) {
  const cached = setting('gdrive_folder_id')
  if (cached) {
    try {
      await apiGet(`/drive/v3/files/${cached}?fields=id,trashed`, token)
      return cached
    } catch { /* deleted by the user — make a new one */ }
  }

  const q = encodeURIComponent(
    `name='${FOLDER_NAME}' and mimeType='application/vnd.google-apps.folder' and trashed=false`
  )
  const found = await apiGet(`/drive/v3/files?q=${q}&spaces=drive&fields=files(id)`, token)
  let id = found?.files?.[0]?.id

  if (!id) {
    const body = JSON.stringify({
      name: FOLDER_NAME, mimeType: 'application/vnd.google-apps.folder',
    })
    const created = await request({
      host: 'www.googleapis.com', path: '/drive/v3/files?fields=id', method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    }, body)
    id = created.id
  }

  putSetting('gdrive_folder_id', id)
  return id
}

/** Multipart upload of one file into the backup folder. */
async function uploadFile(token, folderId, filename, buffer) {
  const boundary = '----parivar' + crypto.randomBytes(12).toString('hex')
  const meta = JSON.stringify({ name: filename, parents: [folderId] })
  const body = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n` +
      `--${boundary}\r\nContent-Type: application/x-sqlite3\r\n\r\n`
    ),
    buffer,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ])

  return request({
    host: 'www.googleapis.com',
    path: '/upload/drive/v3/files?uploadType=multipart&fields=id,name,size,createdTime',
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': `multipart/related; boundary=${boundary}`,
      'Content-Length': body.length,
    },
  }, body)
}

/** Keep only the newest KEEP_BACKUPS files, so Drive does not fill up. */
async function prune(token, folderId) {
  const q = encodeURIComponent(`'${folderId}' in parents and trashed=false`)
  const list = await apiGet(
    `/drive/v3/files?q=${q}&orderBy=createdTime desc&pageSize=100&fields=files(id,name,createdTime)`,
    token
  )
  const files = list?.files ?? []
  const old = files.slice(KEEP_BACKUPS)
  for (const f of old) {
    try {
      await request({
        host: 'www.googleapis.com', path: `/drive/v3/files/${f.id}`, method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      })
    } catch { /* leave it; not worth failing the backup over */ }
  }
  return { kept: Math.min(files.length, KEEP_BACKUPS), removed: old.length }
}

/* ───────────────────────────── public API ───────────────────────────── */

let userDataDir = ''
const init = (dir) => { userDataDir = dir }

const gdrive = {
  /** Everything Settings needs to render the Google Drive panel. */
  status: () => ({
    configured: !!setting('gdrive_client_id'),
    connected: !!setting('gdrive_refresh_token'),
    email: setting('gdrive_email'),
    connectedAt: setting('gdrive_connected_at'),
    lastBackupAt: setting('gdrive_last_backup_at'),
    lastBackupName: setting('gdrive_last_backup_name'),
    autoDaily: setting('gdrive_auto_daily') === '1',
    encryptionAvailable: safeStorage.isEncryptionAvailable(),
    keepBackups: KEEP_BACKUPS,
    folderName: FOLDER_NAME,
    // The Client ID is not a secret; showing it helps them confirm the right project.
    clientId: setting('gdrive_client_id'),
  }),

  /** Save the OAuth client from the user's own Google Cloud project. */
  saveCredentials: ({ clientId, clientSecret }) => {
    const id = String(clientId || '').trim()
    if (!id) throw new Error('Client ID is required')
    if (!id.endsWith('.apps.googleusercontent.com')) {
      throw new Error('That does not look like a Google Client ID — it should end in .apps.googleusercontent.com')
    }
    putSetting('gdrive_client_id', id)
    putSetting('gdrive_client_secret', seal(String(clientSecret || '').trim()))
    // Changing the client invalidates any existing grant.
    delSetting('gdrive_refresh_token')
    delSetting('gdrive_email')
    accessToken = null
    return true
  },

  connect: () => connect(),

  disconnect: () => {
    for (const k of ['gdrive_refresh_token', 'gdrive_email', 'gdrive_connected_at', 'gdrive_folder_id']) {
      delSetting(k)
    }
    accessToken = null
    accessExpiry = 0
    return true
  },

  setAutoDaily: ({ enabled }) => {
    putSetting('gdrive_auto_daily', enabled ? '1' : '0')
    return true
  },

  /** Checkpoint the database and upload a copy. */
  backupNow: async () => {
    const token = await getAccessToken()
    const src = path.join(userDataDir, 'data', 'parivar.db')

    // Fold the write-ahead log into the main file so the copy is complete.
    get().pragma('wal_checkpoint(TRUNCATE)')
    const buffer = fs.readFileSync(src)

    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
    const name = `parivar-backup-${stamp}.db`

    const folderId = await ensureFolder(token)
    const file = await uploadFile(token, folderId, name, buffer)
    const pruned = await prune(token, folderId)

    putSetting('gdrive_last_backup_at', new Date().toISOString())
    putSetting('gdrive_last_backup_name', name)

    return {
      name, id: file.id, bytes: buffer.length,
      kept: pruned.kept, removed: pruned.removed,
    }
  },

  /** The backups currently sitting in Drive. */
  listBackups: async () => {
    const token = await getAccessToken()
    const folderId = await ensureFolder(token)
    const q = encodeURIComponent(`'${folderId}' in parents and trashed=false`)
    const list = await apiGet(
      `/drive/v3/files?q=${q}&orderBy=createdTime desc&pageSize=50&fields=files(id,name,size,createdTime)`,
      token
    )
    return (list?.files ?? []).map((f) => ({
      id: f.id, name: f.name,
      size: Number(f.size || 0),
      createdTime: f.createdTime,
    }))
  },

  /** Open the Drive folder in the browser. */
  openFolder: async () => {
    const token = await getAccessToken()
    const folderId = await ensureFolder(token)
    await shell.openExternal(`https://drive.google.com/drive/folders/${folderId}`)
    return true
  },

  /** Run by the app on startup when daily backup is switched on. */
  maybeAutoBackup: async () => {
    if (setting('gdrive_auto_daily') !== '1') return { skipped: 'off' }
    if (!setting('gdrive_refresh_token')) return { skipped: 'not connected' }
    const last = setting('gdrive_last_backup_at')
    if (last && Date.now() - new Date(last).getTime() < 20 * 3600 * 1000) {
      return { skipped: 'already backed up today' }
    }
    return gdrive.backupNow()
  },
}

module.exports = { gdrive, init, FOLDER_NAME, KEEP_BACKUPS }
