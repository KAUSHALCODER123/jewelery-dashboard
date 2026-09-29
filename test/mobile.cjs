/**
 * Mobile view — the read-only phone server.
 *
 * What matters here is what a phone CANNOT do: nothing without a login, nothing
 * with a wrong password, nothing after too many guesses, nothing with a disabled
 * login, and no route that writes. Then that the figures it serves are the same
 * ones the desktop reports produce.
 */
const { app } = require('electron')
const path = require('node:path')
const fs = require('node:fs')
const os = require('node:os')
const http = require('node:http')

let pass = 0, fail = 0
const bugs = []
const check = (label, actual, expected) => {
  const good = String(actual) === String(expected)
  if (good) { pass++; console.log(`   ok   ${label}  =  ${actual}`) }
  else { fail++; bugs.push(`${label}: got ${actual}, expected ${expected}`)
         console.log(`   FAIL ${label}: got ${actual}, expected ${expected}`) }
}
const head = (t) => console.log(`\n── ${t} ${'─'.repeat(Math.max(0, 54 - t.length))}`)

app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'parivar-run-')))

/** Tiny client: returns { status, json, cookie }. */
function req(port, method, urlPath, { body, cookie } = {}) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null
    const r = http.request(
      { host: '127.0.0.1', port, method, path: urlPath,
        headers: {
          ...(data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {}),
          ...(cookie ? { Cookie: cookie } : {}),
        } },
      (res) => {
        let buf = ''
        res.on('data', (c) => (buf += c))
        res.on('end', () => {
          let json = null
          try { json = JSON.parse(buf) } catch {}
          const sc = res.headers['set-cookie']?.[0]
          resolve({ status: res.statusCode, json, text: buf, headers: res.headers,
                    cookie: sc ? sc.split(';')[0] : null })
        })
      }
    )
    r.on('error', reject)
    if (data) r.write(data)
    r.end()
  })
}

app.whenReady().then(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'parivar-mob-'))
  require('../electron/db.cjs').open(tmp)
  const { auth, bootstrap, session } = require('../electron/auth.cjs')
  const api = require('../electron/api.cjs')
  const mob = require('../electron/mobile.cjs')
  bootstrap()

  // Seed a little shop so the figures are not all zero.
  session.set({ id: 1, username: 'admin', name: 'Owner', role: 'owner' })
  const group = api.itemGroup.list().find((g) => /22K/.test(g.name)) || api.itemGroup.list()[0]
  const itemId = api.item.save({
    name: 'Ring', item_type_id: group.item_type_id, item_group_id: group.id,
    design_id: null, weight_mode: 'WEIGHT', uom: 'GRAM', hsn: '7113', image: '',
  })
  const custId = api.party.save({ party_type: 'CUSTOMER', name: 'Meera Shah', mobile: '9000000001',
    state: 'Maharashtra', opening_balance: 500, opening_dr_cr: 'Dr', metals: [] })
  const today = new Date().toISOString().slice(0, 10)
  api.tagStock.saveBatch({ itemId, rows: [
    { gross_wt: 10, stone_wt: 0, net_wt: 10, purity: 91.6, mkg_per_gm: 300, purchase_rate: 5000, entry_date: today },
    { gross_wt: 5, stone_wt: 0, net_wt: 5, purity: 91.6, mkg_per_gm: 300, purchase_rate: 5000, entry_date: today },
  ] })
  const tag = api.tagStock.list({ status: 'IN_STOCK' })[0]
  api.sale.save({
    head: { prefix: 'COM', bill_date: today, party_id: custId, party_name: 'Meera Shah',
            state: 'Maharashtra', is_credit: 1, payment_mode: 'Cash', gst_pct: 3,
            bill_discount: 0, making_discount: 0, other_amount: 0, manual_urd_amount: 0,
            tcs_pct: 0, amount_received: 1000 },
    items: [{ tag: tag.tag, tag_stock_id: tag.id, item_id: itemId, item_name: 'Ring', hsn: '7113',
              qty: 1, gross_wt: 10, purity: 91.6, stone_wt: 0, net_wt: 10,
              rate_per_gm: 6000, mkg_per_gm: 300, hallmark_charges: 0 }],
  })
  auth.addUser({ username: 'ramesh', name: 'Ramesh', role: 'staff', password: 'ramesh1' })
  const ramesh = auth.list().find((u) => u.username === 'ramesh')

  const PORT = 18765
  try {
    head('1. Off by default')
    check('not enabled on a fresh database', mob.status().enabled, false)
    check('not running', mob.status().running, false)
    let refused = false
    try { await req(PORT, 'GET', '/') } catch { refused = true }
    check('nothing listens until switched on', refused, true)

    head('2. Switching on')
    await mob.mobile.setPort({ port: PORT })
    const st = await mob.mobile.setEnabled({ enabled: true })
    check('enabled', st.enabled, true)
    check('running', st.running, true)
    check('port remembered', api.settings.all().mobile_port, PORT)
    check('enabled remembered', api.settings.all().mobile_enabled, '1')
    let bad = null
    try { await mob.mobile.setPort({ port: 80 }) } catch (e) { bad = e.message }
    check('low port refused', !!bad, true)

    head('3. The page and the door')
    const pg = await req(PORT, 'GET', '/')
    check('page served', pg.status, 200)
    check('page is self-contained html', pg.text.includes('<title>Parivar Mobile</title>'), true)
    check('CSP forbids outside resources', /default-src 'none'/.test(pg.headers['content-security-policy'] || ''), true)
    const anon = await req(PORT, 'GET', '/api/dashboard')
    check('dashboard needs a login', anon.status, 401)
    const wrong = await req(PORT, 'POST', '/api/login', { body: { username: 'admin', password: 'nope' } })
    check('wrong password refused', wrong.status, 401)
    check('same message as unknown user',
      (await req(PORT, 'POST', '/api/login', { body: { username: 'ghost', password: 'x' } })).json.error,
      wrong.json.error)
    check('no cookie on failure', wrong.cookie, null)

    head('4. Signing in')
    const ok = await req(PORT, 'POST', '/api/login', { body: { username: 'admin', password: 'admin' } })
    check('login ok', ok.status, 200)
    check('user returned', ok.json.data.username, 'admin')
    check('cookie is HttpOnly', /HttpOnly/.test(ok.headers['set-cookie'][0]), true)
    check('cookie is SameSite=Strict', /SameSite=Strict/.test(ok.headers['set-cookie'][0]), true)
    check('desktop session untouched by a phone login', session.get().username, 'admin')
    session.clear()
    const me = await req(PORT, 'GET', '/api/me', { cookie: ok.cookie })
    check('phone works while nobody is signed in at the counter', me.status, 200)
    check('company name on the phone', me.json.data.company.name, api.company.read().name)
    session.set({ id: 1, username: 'admin', name: 'Owner', role: 'owner' })

    head('5. The figures match the desktop')
    const c = ok.cookie
    const dash = (await req(PORT, 'GET', '/api/dashboard', { cookie: c })).json.data
    const desk = api.reports.dashboard()
    check('today sales', dash.todaySales.v, desk.todaySales.v)
    check('stock fine', dash.stock.fine, desk.stock.fine)
    check('receivable', dash.receivable, desk.receivable)
    const stock = (await req(PORT, 'GET', '/api/stock?groupBy=item', { cookie: c })).json.data
    check('one piece left in stock', stock.totals.count, 1)
    check('grouped by item', stock.groups[0].key, 'Ring')
    const sales = (await req(PORT, 'GET', `/api/sales?from=${today}&to=${today}`, { cookie: c })).json.data
    check('one bill today', sales.length, 1)
    check('bill total', sales[0].total_amount, api.sale.list({})[0].total_amount)
    const bill = (await req(PORT, 'GET', `/api/sale?id=${sales[0].id}`, { cookie: c })).json.data
    check('bill lines', bill.items.length, 1)
    const parties = (await req(PORT, 'GET', '/api/parties?type=CUSTOMER', { cookie: c })).json.data
    check('customer listed', parties[0].name, 'Meera Shah')
    check('customer balance = desktop', parties[0].balance, api.party.list({ type: 'CUSTOMER' })[0].balance)
    const led = (await req(PORT, 'GET', `/api/ledger?partyId=${custId}`, { cookie: c })).json.data
    const dled = api.reports.ledger({ partyId: custId })
    check('khata closing', led.closing, dled.closing)
    check('khata side', led.closingSide, dled.closingSide)
    const dues = (await req(PORT, 'GET', '/api/outstanding', { cookie: c })).json.data
    check('debtor total', dues.debtorTotal, api.reports.outstandingList({}).debtorTotal)
    const db = (await req(PORT, 'GET', `/api/daybook?from=${today}`, { cookie: c })).json.data
    check('day book bills', db.sales.n, 1)
    check('metal khata reachable', (await req(PORT, 'GET', `/api/metalLedger?partyId=${custId}`, { cookie: c })).status, 200)
    check('missing bill is 404', (await req(PORT, 'GET', '/api/sale?id=999', { cookie: c })).status, 404)

    head('6. Read only, whatever is tried')
    check('POST to a read route refused', (await req(PORT, 'POST', '/api/dashboard', { cookie: c, body: {} })).status, 405)
    check('DELETE refused', (await req(PORT, 'DELETE', '/api/sales', { cookie: c })).status, 405)
    for (const r of ['sale/remove', 'saveBatch', 'settings', 'set', 'company', 'backup', 'users', 'login'])
      check(`no such route: ${r}`, (await req(PORT, 'GET', '/api/' + r, { cookie: c })).status, 404)
    check('prototype names are not routes', (await req(PORT, 'GET', '/api/constructor', { cookie: c })).status, 404)
    check('bill count unchanged', api.sale.list({}).length, 1)
    check('stock unchanged', api.tagStock.list({ status: 'IN_STOCK' }).length, 1)

    head('7. Staff, disabled logins and guessing')
    const staff = await req(PORT, 'POST', '/api/login', { body: { username: 'ramesh', password: 'ramesh1' } })
    check('staff can sign in', staff.status, 200)
    check('staff sees the dashboard', (await req(PORT, 'GET', '/api/dashboard', { cookie: staff.cookie })).status, 200)
    auth.setActive({ id: ramesh.id, active: false })
    check('disabled mid-session loses access', (await req(PORT, 'GET', '/api/dashboard', { cookie: staff.cookie })).status, 401)
    check('disabled cannot sign in again',
      (await req(PORT, 'POST', '/api/login', { body: { username: 'ramesh', password: 'ramesh1' } })).status, 403)
    for (let i = 0; i < 5; i++)
      await req(PORT, 'POST', '/api/login', { body: { username: 'admin', password: 'guess' + i } })
    check('sixth guess throttled',
      (await req(PORT, 'POST', '/api/login', { body: { username: 'admin', password: 'admin' } })).status, 429)
    check('forged cookie rejected', (await req(PORT, 'GET', '/api/dashboard', { cookie: 'pj_session=' + 'a'.repeat(64) })).status, 401)
    const out = await req(PORT, 'POST', '/api/logout', { cookie: c })
    check('sign out', out.status, 200)
    check('token gone after sign out', (await req(PORT, 'GET', '/api/dashboard', { cookie: c })).status, 401)

    head('8. Switching off')
    const off = await mob.mobile.setEnabled({ enabled: false })
    check('stopped', off.running, false)
    check('remembered as off', api.settings.all().mobile_enabled, '0')
    let closed = false
    try { await req(PORT, 'GET', '/') } catch { closed = true }
    check('port closed', closed, true)
    check('QR is null when off', await mob.mobile.qr(), null)
    await mob.mobile.setEnabled({ enabled: true })
    const svg = await mob.mobile.qr()
    check('QR is an svg when on', typeof svg === 'string' && svg.startsWith('<svg'), true)
    await mob.stop()
  } catch (e) {
    fail++
    bugs.push(`crashed: ${e.stack}`)
    console.error(e)
  }

  console.log(`\n${pass} passed, ${fail} failed`)
  if (bugs.length) { console.log('\nBUGS:'); bugs.forEach((b) => console.log(' - ' + b)) }
  process.exit(fail ? 1 : 0)
})
