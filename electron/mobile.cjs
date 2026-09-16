/**
 * Mobile view — a small READ-ONLY web server so the owner can open the shop's
 * figures on a phone that is on the same Wi-Fi as the billing computer.
 *
 * Design decisions, in order of importance:
 *
 *  1. Read-only by construction. The only POST is /api/login. Every other route
 *     is a GET that calls a whitelisted api function; there is no route that
 *     reaches a save/remove method, so nothing on a phone can change the books.
 *  2. Same logins as the desktop. A phone signs in with an app_user username and
 *     password, checked with the same scrypt hash. Disabled logins are refused.
 *     The phone session is its own token in memory here — it never touches the
 *     desktop session in auth.cjs, so someone signing in on a phone cannot become
 *     the user at the counter.
 *  3. Local network only. The server listens on the LAN so a phone can reach it,
 *     but nothing is exposed to the internet unless someone deliberately forwards
 *     a router port. Off by default; the owner switches it on in Settings.
 *  4. Failed logins are throttled per address, so the password cannot be guessed
 *     from across the shop's Wi-Fi.
 */
const http = require('node:http')
const os = require('node:os')
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const { get } = require('./db.cjs')
const api = require('./api.cjs')
const { hashPassword, sameHash, normalizeRole } = require('./auth.cjs')

const DEFAULT_PORT = 8765
const TOKEN_TTL_MS = 12 * 60 * 60 * 1000       // a phone stays signed in for a shift
const MAX_FAILS = 5                            // per address …
const FAIL_WINDOW_MS = 60 * 1000               // … per minute

let server = null
let port = DEFAULT_PORT
let lastError = null
const tokens = new Map()                       // token → { user, expires }
const fails = new Map()                        // ip → [timestamps]

/* ───────────────────────────── settings ───────────────────────────── */

const setting = (key, fallback) => {
  const v = api.settings.all()[key]
  return v === undefined || v === null || v === '' ? fallback : v
}
const isEnabled = () => setting('mobile_enabled', '0') === '1'
const savedPort = () => {
  const p = Number(setting('mobile_port', DEFAULT_PORT))
  return Number.isInteger(p) && p >= 1024 && p <= 65535 ? p : DEFAULT_PORT
}

/* ───────────────────────────── addresses ───────────────────────────── */

/** Every IPv4 address a phone on the LAN could reach this machine on. */
function lanAddresses() {
  const out = []
  for (const [name, list] of Object.entries(os.networkInterfaces())) {
    for (const a of list || []) {
      if (a.family !== 'IPv4' && a.family !== 4) continue
      if (a.internal) continue
      // Virtual adapters (VirtualBox, Hyper-V, WSL) advertise addresses no phone
      // can reach; they are listed last so the real Wi-Fi/Ethernet comes first.
      const virtual = /virtual|vethernet|vmware|wsl|docker|hyper-v|loopback/i.test(name)
      out.push({ name, address: a.address, virtual })
    }
  }
  return out.sort((a, b) => Number(a.virtual) - Number(b.virtual))
}

/* ───────────────────────────── auth ───────────────────────────── */

function tooManyFails(ip) {
  const now = Date.now()
  const list = (fails.get(ip) || []).filter((t) => now - t < FAIL_WINDOW_MS)
  fails.set(ip, list)
  return list.length >= MAX_FAILS
}
const noteFail = (ip) => fails.set(ip, [...(fails.get(ip) || []), Date.now()])

function login(ip, { username, password }) {
  if (tooManyFails(ip)) throw httpError(429, 'Too many attempts. Wait a minute and try again')
  const u = get()
    .prepare(`SELECT * FROM app_user WHERE username = ? COLLATE NOCASE`)
    .get(String(username || '').trim())
  // Same message either way — never reveal which usernames exist.
  if (!u || !sameHash(u.password_hash, hashPassword(String(password || ''), u.salt))) {
    noteFail(ip)
    throw httpError(401, 'Invalid username or password')
  }
  if (!u.active) throw httpError(403, 'This account is disabled')
  const token = crypto.randomBytes(32).toString('hex')
  const user = { id: u.id, username: u.username, name: u.name, role: normalizeRole(u.role) }
  tokens.set(token, { user, expires: Date.now() + TOKEN_TTL_MS })
  return { token, user }
}

function userFor(req) {
  const m = /(?:^|;\s*)pj_session=([a-f0-9]{64})/.exec(req.headers.cookie || '')
  if (!m) return null
  const t = tokens.get(m[1])
  if (!t) return null
  if (t.expires < Date.now()) { tokens.delete(m[1]); return null }
  // A login the owner has since disabled loses the phone too.
  const row = get().prepare(`SELECT active FROM app_user WHERE id = ?`).get(t.user.id)
  if (!row || !row.active) { tokens.delete(m[1]); return null }
  return t.user
}

/* ───────────────────────────── routes ───────────────────────────── */

function httpError(status, message) {
  const e = new Error(message)
  e.status = status
  return e
}

const str = (v) => (v === undefined || v === null ? undefined : String(v))
const int = (v) => (v === undefined || v === null || v === '' ? undefined : Number(v))

/**
 * Every phone-readable route, each a thin call into an existing read function.
 * Adding a route here is the ONLY way data reaches the phone, so keep this list
 * to things that read. `pick` trims large rows to what the phone shows.
 */
const ROUTES = {
  me: (_q, user) => ({ user, company: pickCompany(api.company.read()) }),
  dashboard: () => api.reports.dashboard(),
  stock: (q) => {
    const r = api.reports.stock({ groupBy: str(q.groupBy) || 'item', search: str(q.search) })
    return {
      groups: r.groups, totals: r.totals, looseTotals: r.looseTotals,
      rows: (r.rows || []).slice(0, 500).map((x) => ({
        id: x.id, tag: x.tag, item_name: x.item_name, group_name: x.group_name,
        gross_wt: x.gross_wt, net_wt: x.net_wt, final_wt: x.final_wt, purity: x.purity,
        location: x.location, shelf_tray: x.shelf_tray,
      })),
    }
  },
  sales: (q) => api.sale.list({ from: str(q.from), to: str(q.to), search: str(q.search) })
    .slice(0, 300)
    .map((s) => ({
      id: s.id, bill_no: s.bill_no, bill_date: s.bill_date, party_name: s.party_name,
      total_amount: s.total_amount, amount_received: s.amount_received,
      net_balance: s.net_balance, is_credit: s.is_credit, urd_amount: s.urd_amount,
    })),
  sale: (q) => {
    const s = api.sale.read({ id: int(q.id) })
    if (!s) throw httpError(404, 'Bill not found')
    return s
  },
  parties: (q) => api.party.list({ type: str(q.type) || 'ALL', search: str(q.search) })
    .slice(0, 500)
    .map((p) => ({
      id: p.id, name: p.name, party_type: p.party_type, mobile: p.mobile,
      city: p.city, balance: p.balance,
    })),
  ledger: (q) => {
    const r = api.reports.ledger({ partyId: int(q.partyId), from: str(q.from), to: str(q.to) })
    if (!r) throw httpError(404, 'Party not found')
    return r
  },
  metalLedger: (q) => {
    const r = api.reports.metalLedger({
      partyId: int(q.partyId), metal: str(q.metal) || 'Gold', from: str(q.from), to: str(q.to),
    })
    if (!r) throw httpError(404, 'Party not found')
    return r
  },
  daybook: (q) => api.reports.dayBook({ from: str(q.from), to: str(q.to) }),
  outstanding: (q) => api.reports.outstandingList({
    basis: str(q.basis) || 'money', metal: str(q.metal) || 'Gold',
  }),
}

const pickCompany = (c) => (c ? { name: c.name, address: c.address, phone: c.phone } : null)

const cookieFor = (token) =>
  `pj_session=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${Math.floor(TOKEN_TTL_MS / 1000)}`

function send(res, status, body, headers = {}) {
  const buf = typeof body === 'string' ? Buffer.from(body) : body
  res.writeHead(status, {
    'Content-Length': buf.length,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    ...headers,
  })
  res.end(buf)
}
const json = (res, status, obj, headers) =>
  send(res, status, JSON.stringify(obj), { 'Content-Type': 'application/json; charset=utf-8', ...headers })

function readBody(req, limit = 4096) {
  return new Promise((resolve, reject) => {
    let data = ''
    req.on('data', (c) => {
      data += c
      if (data.length > limit) { reject(httpError(413, 'Request too large')); req.destroy() }
    })
    req.on('end', () => resolve(data))
    req.on('error', reject)
  })
}

let pageHtml = null
const page = () => {
  if (!pageHtml) pageHtml = fs.readFileSync(path.join(__dirname, 'mobile.html'))
  return pageHtml
}

async function handle(req, res) {
  const ip = req.socket.remoteAddress || '?'
  const url = new URL(req.url, 'http://x')
  const q = Object.fromEntries(url.searchParams)

  try {
    if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
      return send(res, 200, page(), {
        'Content-Type': 'text/html; charset=utf-8',
        // The page is self-contained; nothing may load from anywhere else.
        'Content-Security-Policy': "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; img-src data:; manifest-src 'self'",
      })
    }
    if (req.method === 'POST' && url.pathname === '/api/login') {
      let body
      try { body = JSON.parse((await readBody(req)) || '{}') } catch { throw httpError(400, 'Bad request') }
      const { token, user } = login(ip, body)
      return json(res, 200, { ok: true, data: user }, { 'Set-Cookie': cookieFor(token) })
    }
    if (req.method === 'POST' && url.pathname === '/api/logout') {
      const m = /pj_session=([a-f0-9]{64})/.exec(req.headers.cookie || '')
      if (m) tokens.delete(m[1])
      return json(res, 200, { ok: true }, { 'Set-Cookie': 'pj_session=; Path=/; Max-Age=0' })
    }
    if (url.pathname.startsWith('/api/')) {
      if (req.method !== 'GET') throw httpError(405, 'Read only')
      const user = userFor(req)
      if (!user) throw httpError(401, 'Please sign in')
      const name = url.pathname.slice(5)
      const fn = Object.prototype.hasOwnProperty.call(ROUTES, name) ? ROUTES[name] : null
      if (!fn) throw httpError(404, 'Not found')
      return json(res, 200, { ok: true, data: fn(q, user) })
    }
    throw httpError(404, 'Not found')
  } catch (err) {
    const status = err.status || 500
    if (status === 500) console.error('[mobile]', err)
    return json(res, status, { ok: false, error: status === 500 ? 'Something went wrong' : err.message })
  }
}

/* ───────────────────────────── lifecycle ───────────────────────────── */

function start(p = savedPort()) {
  return new Promise((resolve, reject) => {
    if (server) return resolve(status())
    port = p
    lastError = null
    const s = http.createServer(handle)
    s.on('error', (e) => {
      lastError = e.code === 'EADDRINUSE'
        ? `Port ${port} is already in use on this computer. Choose another port.`
        : e.message
      server = null
      reject(new Error(lastError))
    })
    s.listen(port, '0.0.0.0', () => { server = s; resolve(status()) })
  })
}

function stop() {
  return new Promise((resolve) => {
    if (!server) return resolve(status())
    const s = server
    server = null
    tokens.clear()
    s.close(() => resolve(status()))
  })
}

/** Called once at app start: bring the server up if the owner left it on. */
async function init() {
  if (!isEnabled()) return
  try { await start(savedPort()) } catch (e) { console.error('[mobile]', e.message) }
}

function status() {
  const addrs = lanAddresses()
  const running = !!server
  const urls = running ? addrs.map((a) => ({ ...a, url: `http://${a.address}:${port}` })) : []
  return {
    enabled: isEnabled(), running, port: running ? port : savedPort(),
    urls, primaryUrl: urls[0]?.url || null, error: lastError,
    sessions: tokens.size,
  }
}

/** QR for the primary address so the phone need not type the URL. */
async function qr() {
  const s = status()
  if (!s.primaryUrl) return null
  const QRCode = require('qrcode')
  return QRCode.toString(s.primaryUrl, { type: 'svg', margin: 1, width: 220 })
}

const mobile = {
  status: () => status(),
  qr: () => qr(),
  setEnabled: async ({ enabled }) => {
    api.settings.set({ key: 'mobile_enabled', value: enabled ? '1' : '0' })
    if (enabled) await start(savedPort())
    else await stop()
    return status()
  },
  setPort: async ({ port: p }) => {
    const n = Number(p)
    if (!Number.isInteger(n) || n < 1024 || n > 65535) {
      throw new Error('Port must be a whole number between 1024 and 65535')
    }
    api.settings.set({ key: 'mobile_port', value: String(n) })
    if (server) { await stop(); await start(n) }
    return status()
  },
}

module.exports = { mobile, init, start, stop, status, DEFAULT_PORT, _tokens: tokens }
