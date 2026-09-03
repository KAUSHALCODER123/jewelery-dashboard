/**
 * Records the demo film.
 *
 * Runs the REAL built app against a seeded demo shop, drives it the way a
 * shopkeeper would, and writes a numbered JPEG for every frame together with the
 * wall-clock millisecond it was taken at. Nothing is faked: what you see in the
 * film is the software actually working.
 *
 * Frames are captured best-effort rather than at a fixed rate — capturePage
 * takes as long as it takes — so each frame carries its own timestamp and the
 * encoder later gives it exactly the duration it really occupied. That is what
 * keeps the picture locked to the voice no matter how the machine was feeling.
 *
 *   node scripts/demo/make.mjs      (drives this)
 */
const { app, BrowserWindow, ipcMain } = require('electron')
const path = require('node:path')
const fs = require('node:fs')
const os = require('node:os')
const { seed } = require('../../test/demo-data.cjs')

const WORK = process.env.DEMO_WORK
if (!WORK) { console.error('DEMO_WORK not set'); process.exit(1) }
const FRAMES = path.join(WORK, 'frames')
fs.mkdirSync(FRAMES, { recursive: true })

// The film is recorded in PARTS. capturePage only paints in a real desktop
// session, so the recorder has to run in the foreground — and a ten minute
// foreground run is longer than most shells will sit still for. Each part is a
// few minutes, records the scenes it is given, and the builder stitches the
// parts back into one timeline afterwards.
const PART = process.env.DEMO_PART || '1'
const ONLY = (process.env.DEMO_SCENES || '').split(',').map((s) => s.trim()).filter(Boolean)

const W = 1600, H = 900
const MAX_FPS = 10
// A scene holds for its narration plus this, so the last word never lands on a
// cut. A demo that changes screen the instant the sentence ends feels rushed.
const TAIL_MS = 1400

const audio = JSON.parse(fs.readFileSync(path.join(WORK, 'audio.json'), 'utf8'))

/* ── Injected into the page. Every helper the scene list can call. ────────── */
const HELPERS = `
window.__t = {
  wait(ms) { return new Promise(r => setTimeout(r, ms)) },

  set(el, v) {
    const proto = el.tagName === 'TEXTAREA'
      ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, v)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  },
  setSelect(el, v) {
    Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set.call(el, v)
    el.dispatchEvent(new Event('change', { bubbles: true }))
  },

  /* Typing is animated character by character. A field that fills instantly
     reads as a screenshot; watching it typed reads as software being used. */
  async typeInto(el, text, perChar = 55) {
    if (!el) return
    el.focus()
    this.cursorAt(el)
    for (let i = 1; i <= text.length; i++) {
      this.set(el, text.slice(0, i))
      await this.wait(perChar)
    }
  },

  /* A soft pointer dot, so the viewer's eye follows what is being touched. */
  cursorAt(el) {
    if (!el) return
    const r = el.getBoundingClientRect()
    let d = document.getElementById('__cursor')
    if (!d) {
      d = document.createElement('div')
      d.id = '__cursor'
      d.style.cssText = 'position:fixed;z-index:99999;width:22px;height:22px;' +
        'border-radius:50%;background:rgba(255,170,0,.35);' +
        'box-shadow:0 0 0 3px rgba(255,170,0,.55);pointer-events:none;' +
        'transition:left .35s ease,top .35s ease;'
      document.body.appendChild(d)
    }
    d.style.left = (r.left + Math.min(30, r.width / 2) - 11) + 'px'
    d.style.top = (r.top + r.height / 2 - 11) + 'px'
  },

  glow(sel) {
    document.querySelectorAll('.__glow').forEach(e => e.classList.remove('__glow'))
    if (!document.getElementById('__glowcss')) {
      const s = document.createElement('style')
      s.id = '__glowcss'
      s.textContent = '.__glow{outline:3px solid rgba(255,170,0,.9)!important;' +
        'outline-offset:2px;border-radius:6px;transition:outline .3s}'
      document.head.appendChild(s)
    }
    document.querySelectorAll(sel).forEach(e => e.classList.add('__glow'))
  },
  highlight(sel) { this.glow(sel) },

  nav(label) {
    const b = [...document.querySelectorAll('.nav-item')]
      .find(x => x.textContent.trim().startsWith(label))
    if (!b) throw new Error('nav not found: ' + label)
    this.cursorAt(b)
    b.click()
  },

  btn(text, root) {
    return [...(root || document).querySelectorAll('button')]
      .find(b => b.textContent.trim().toLowerCase().includes(text.toLowerCase()))
  },
  click(text, root) {
    const b = this.btn(text, root)
    if (!b) throw new Error('button not found: ' + text)
    this.cursorAt(b)
    b.click()
  },
  clickIn(rootSel, text) {
    const root = document.querySelector(rootSel) || document
    this.click(text, root)
  },

  /* Scroll the main pane to a fraction of its height, smoothly. */
  scrollTo(frac) {
    const pane = document.querySelector('.content') || document.scrollingElement
    if (!pane) return
    const max = pane.scrollHeight - pane.clientHeight
    pane.scrollTo({ top: Math.max(0, max * frac), behavior: 'smooth' })
  },

  async type(sel, text) { await this.typeInto(document.querySelector(sel), text) },
  async typeNth(sel, n, text) { await this.typeInto(document.querySelectorAll(sel)[n], text) },

  /* Fill a modal's plain inputs in order: [['Name'], ['9822...']] */
  async typeInputs(rootSel, values) {
    const root = document.querySelector(rootSel)
    if (!root) return
    const ins = root.querySelectorAll('input.input')
    for (let i = 0; i < values.length; i++) await this.typeInto(ins[i], values[i][0])
  },

  pickSelect(sel, index, value) {
    const el = document.querySelectorAll(sel)[index]
    if (!el) return
    this.cursorAt(el)
    this.setSelect(el, String(value))
  },

  /* The page's own search box. */
  async search(q) {
    const box = [...document.querySelectorAll('input')]
      .find(i => /search/i.test(i.placeholder || ''))
    if (!box) return
    await this.typeInto(box, q, 70)
  },

  /* Autocomplete: type, let the list settle, take the first hit. */
  async pickAuto(kind, query) {
    const hint = { supplier: 'supplier', customer: 'customer', party: 'customer', bill: 'bill' }[kind] || ''
    let box = [...document.querySelectorAll('.ac input.input, .ac input')]
      .find(i => new RegExp(hint, 'i').test(i.placeholder || ''))
    if (!box) box = document.querySelector('.ac input.input') || document.querySelector('.ac input')
    if (!box) return
    await this.typeInto(box, query, 90)
    await this.wait(1300)
    const opt = document.querySelector('.ac-list .ac-item')
    if (opt) { this.cursorAt(opt); opt.click() }
    await this.wait(600)
  },

  /* One cell of the Nth grid on the page (0 = the item grid). */
  gridRow(gridIdx, rowIdx) {
    const g = document.querySelectorAll('.grid-edit')[gridIdx]
    if (!g) return null
    return g.querySelectorAll('tbody tr')[rowIdx] || null
  },
  async typeCellIn(gridIdx, rowIdx, cellIdx, value) {
    const row = this.gridRow(gridIdx, rowIdx)
    if (!row) return
    await this.typeInto(row.querySelectorAll('input')[cellIdx], value, 70)
  },
  async typeCell(rowIdx, cellIdx, value) { await this.typeCellIn(0, rowIdx, cellIdx, value) },

  /* Sales invoice: type into the item cell and take the tagged piece offered. */
  async pickTag(rowIdx, query) {
    const row = this.gridRow(0, rowIdx || 0)
    if (!row) return
    await this.typeInto(row.querySelectorAll('input')[1], query || 'Ring', 110)
    await this.wait(1500)
    const pick = document.querySelector('.ac-list .ac-item')
    if (pick) { this.cursorAt(pick); pick.click() }
    await this.wait(800)
  },
  /* Invoice rate cell is per ten grams — that is how it is quoted at the counter. */
  async typeRate(v) { await this.typeCellIn(0, 0, 8, v) },

  openUrd() { this.click('Add old gold') },
  async typeUrd(gross, purity) {
    // URD grid is the second grid on the page: 0 name, 1 desc, 2 gross, 3 net,
    // 4 purity, 5 rate.
    await this.typeInto(this.gridRow(1, 0)?.querySelectorAll('input')[0], 'Purani chain', 70)
    await this.typeCellIn(1, 0, 2, gross)
    await this.typeCellIn(1, 0, 4, purity)
    await this.typeCellIn(1, 0, 5, '5800')
  },

  /* Purchase line: item name (datalist), gross, purity, rate. */
  async typePurchaseLine(item, gross, purity, rate) {
    const row = this.gridRow(0, 0) ||
      document.querySelectorAll('table.data tbody tr, table tbody tr')[0]
    if (!row) return
    const ins = row.querySelectorAll('input')
    await this.typeInto(ins[0], item, 90)
    await this.wait(500)
    // Purchase grid, in DOM order including the read-only cells:
    // 0 item, 1 qty, 2 gross, 3 black beads, 4 stone, 5 net, 6 purity,
    // 7 wastage%, 8 fine+wastage (ro), 9 rate/10gm, 10 amount (ro).
    await this.typeInto(ins[2], gross, 80)
    await this.typeInto(ins[6], purity, 80)
    await this.typeInto(ins[9], rate, 80)
  },
}
true
`

app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'parivar-demo-profile-')))
app.disableHardwareAcceleration()

app.whenReady().then(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'parivar-demo-'))
  const dbmod = require('../../electron/db.cjs')
  dbmod.open(tmp)
  const api = require('../../electron/api.cjs')
  const { auth, bootstrap } = require('../../electron/auth.cjs')
  bootstrap()
  auth.login({ username: 'admin', password: 'admin' })

  for (const [g, ms] of Object.entries({ ...api, auth }))
    for (const [n, fn] of Object.entries(ms))
      ipcMain.handle(`${g}:${n}`, (_e, p) => {
        try { return { ok: true, data: fn(p ?? {}) } } catch (e) { return { ok: false, error: e.message } }
      })
  ipcMain.handle('app:info', () => ({ version: '1.24.0', dataDir: tmp }))
  for (const c of ['print:html', 'print:pdf', 'file:saveText'])
    ipcMain.handle(c, () => ({ ok: true }))
  ipcMain.handle('gdrive:status', () => ({ ok: true, data: { configured: false, connected: false } }))
  ipcMain.handle('gdrive:listBackups', () => ({ ok: true, data: [] }))
  for (const c of ['send:whatsapp', 'send:sms', 'send:email']) ipcMain.handle(c, () => ({ ok: true }))

  const S = seed(api)
  // A bullion supplier for the purchase scene, so the autocomplete has something
  // recognisable to land on.
  api.party.save({ name: 'Bullion House', party_type: 'SUPPLIER', state: 'Maharashtra' })

  /**
   * A fortnight of trading.
   *
   * The shared seed lays out masters and stock but books no documents, so every
   * report in it reads empty — a Day Book with nothing in it and a GST return of
   * ₹0.00 sell nothing to anybody. This gives the shop a past: bills, a purchase,
   * money collected, metal at the goldsmith and at the refiner. It lives here
   * rather than in test/demo-data.cjs because the tests depend on that file's
   * counts being exactly what they are.
   */
  function tradingHistory() {
    const day = (back) => {
      const t = new Date(); t.setDate(t.getDate() - back)
      return t.toISOString().slice(0, 10)
    }
    const tagsFor = (name) => api.tagStock.list({ status: 'IN_STOCK', search: name })
    const bill = (back, party_id, party_name, tag, rate, mkg, opts = {}) => {
      if (!tag) return
      api.sale.save({
        head: {
          prefix: 'COM', bill_date: day(back), party_id, party_name,
          state: 'Maharashtra', gst_pct: 3, payment_mode: 'Cash', ...opts,
        },
        items: [{
          tag: tag.tag, tag_stock_id: tag.id, item_id: tag.item_id, item_name: tag.item_name,
          qty: tag.qty, gross_wt: tag.gross_wt, purity: tag.purity,
          stone_wt: tag.stone_wt, stone_rate: tag.stone_rate, net_wt: tag.net_wt,
          rate_per_gm: rate, mkg_per_gm: mkg, hallmark_charges: 45,
        }],
      })
    }

    // What each piece cost the shop, per fine gram. Without it the Stock Report
    // values the whole tray at zero and says so on screen — which is not what a
    // shopkeeper is being told he will see.
    api.tagStock.updateRows({
      rows: api.tagStock.list({ status: 'IN_STOCK' })
        .map((t) => ({ id: t.id, purchase_rate: 6050 })),
    })

    // Metal in from the bullion dealer, on credit.
    api.purchase.save({
      head: {
        prefix: 'MI', invoice_date: day(12), party_id: S.suppliers.mahavir,
        party_name: 'Mahavir Gold', metal: 'Gold', state: 'Maharashtra',
        gst_pct: 3, is_credit: 1, paid_amount: 0,
      },
      items: [{ item_name: 'Bullion', direction: 'IN', gross_wt: 250, net_wt: 250,
                purity: 99.5, rate: 61500, wastage_pct: 0 }],
    })

    // Three bills across the fortnight, one of them today so the Day Book and the
    // dashboard have something to show.
    bill(9, S.customers.priya, 'Priya Deshmukh', tagsFor('Chain')[0], 6180, 220)
    bill(4, S.customers.rekha, 'Rekha Shah', tagsFor('Bangle')[0], 4720, 420,
      { is_credit: 1, amount_received: 20000 })
    bill(0, S.customers.amit, 'Amit Patel', tagsFor('Payal')[0], 92, 18)

    // Money collected against an old balance.
    // Inside the last day or two, because the Receipts screen opens on the
    // current month — a receipt dated before that would leave the list empty
    // while the voice is talking about collecting money.
    api.voucher.save({
      kind: 'RECEIPT', voucher_date: day(1), party_id: S.customers.sandip,
      party_name: 'Sandip Jain', amount: 5000, payment_type: 'Cash',
      narration: 'Against old balance',
    })
    api.voucher.save({
      kind: 'RECEIPT', voucher_date: day(0), party_id: S.customers.rekha,
      party_name: 'Rekha Shah', amount: 12000, payment_type: 'UPI',
      narration: 'Part payment',
    })

    // Metal with the goldsmith, and scrap at the refiner.
    api.karagir.issue({
      issue_date: day(8), karagir_id: S.karagir, karagir_name: 'Chetan Kapila',
      item_name: 'Chain', gross_wt: 120, less_wt: 0, net_wt: 120, purity: 100,
      wastage_pct: 0, metal: 'Gold',
    })
    api.karagir.receive({
      receive_date: day(2), karagir_id: S.karagir, karagir_name: 'Chetan Kapila',
      item_name: 'Chain', gross_wt: 117, less_wt: 0, stone_wt: 0, diamond_wt: 0,
      net_wt: 117, purity: 100, wastage_pct: 2, rate_per_gm: 260,
      tds_pct: 0, paid_amount: 0, metal: 'Gold',
    })
    api.refinery.save({
      // Both legs inside the current month: the Refining screen opens on
      // month-to-date, and a scrap-out dated before it would show "Fine Sent Out
      // 0.000 g" while the voice explains sending scrap away.
      head: { prefix: 'MO', invoice_date: day(2), direction: 'OUT',
              party_id: S.refinery, party_name: 'Shree Refinery', gst_pct: 0,
              paid_amount: 0, metal: 'Gold' },
      items: [{ item_name: 'Scrap', gross_wt: 42, stone_wt: 0, net_wt: 42,
                purity: 86, rate_per_gm: 0, gross_wastage: 0 }],
    })
    api.refinery.save({
      head: { prefix: 'MI', invoice_date: day(1), direction: 'IN',
              party_id: S.refinery, party_name: 'Shree Refinery', gst_pct: 0,
              paid_amount: 0, metal: 'Gold' },
      items: [{ item_name: 'Pure Gold', gross_wt: 35.8, stone_wt: 0, net_wt: 35.8,
                purity: 99.5, rate_per_gm: 0, gross_wastage: 0 }],
    })
  }
  try { tradingHistory() } catch (e) { console.log('history:', e.message) }

  const types = api.itemType.list()
  const groups = api.itemGroup.list()
  const ids = {
    goldTypeId: types.find((t) => t.name === 'Gold')?.id,
    g22Id: groups.find((g) => g.name === '22K Gold')?.id,
    pendantId: null,   // filled after the item scene creates it
  }

  const w = new BrowserWindow({
    show: true, width: W, height: H, useContentSize: true, backgroundColor: '#ffffff',
    webPreferences: {
      preload: path.join(__dirname, '..', '..', 'electron', 'preload.cjs'),
      contextIsolation: true, sandbox: false,
    },
  })
  await w.loadFile(path.join(__dirname, '..', '..', 'dist', 'index.html'))
  await new Promise((r) => setTimeout(r, 2500))
  await w.webContents.executeJavaScript(HELPERS)

  const js = (code) => w.webContents.executeJavaScript(`(async () => { ${code} })()`)
    .catch((e) => { console.log('   beat failed:', String(e.message || e).slice(0, 120)) })

  /* ── frame capture ─────────────────────────────────────────────────────── */
  const frames = []
  let capturing = true
  let n = 0
  const t0 = Date.now()
  const capture = (async () => {
    const minGap = 1000 / MAX_FPS
    while (capturing) {
      const started = Date.now()
      try {
        const img = await w.webContents.capturePage()
        const file = `p${PART}-f${String(n).padStart(6, '0')}.jpg`
        fs.writeFileSync(path.join(FRAMES, file), img.toJPEG(82))
        frames.push({ file, t: started - t0 })
        n++
      } catch { /* a frame lost to a repaint is not worth stopping for */ }
      const spent = Date.now() - started
      if (spent < minGap) await new Promise((r) => setTimeout(r, minGap - spent))
    }
  })()

  /* ── play the scenes ───────────────────────────────────────────────────── */
  const scenes = require('./scenes.cjs')({ ids })
  const timeline = []

  for (const scene of scenes) {
    if (ONLY.length && !ONLY.includes(scene.id)) continue
    const a = audio[scene.id]
    if (!a) { console.log(`   (no audio for ${scene.id}, skipped)`); continue }
    const start = Date.now() - t0
    console.log(`\n▶ ${scene.id}  ${(a.duration).toFixed(1)}s`)
    timeline.push({ id: scene.id, start, duration: a.duration })

    // Late-bound id: the Pendant only exists once the items scene has made it.
    if (scene.id === 'barcode' && !ids.pendantId) {
      ids.pendantId = api.item.list({ search: 'Pendant' })[0]?.id ?? ''
    }

    const sceneT0 = Date.now()
    const fired = new Set()
    const beats = scene.beats || []
    // Hold for the narration, and never cut a beat off: a beat timed past the
    // last word still has to happen, or the film silently stops showing a
    // feature the voice is describing. The extra time becomes silence, which the
    // builder already knows how to lay down.
    const lastBeat = beats.length ? Math.max(...beats.map((b) => b.at)) : 0
    const endAt = sceneT0 +
      Math.max(a.duration * 1000 + TAIL_MS, lastBeat * 1000 + 3500)

    while (Date.now() < endAt) {
      const el = (Date.now() - sceneT0) / 1000
      for (let i = 0; i < beats.length; i++) {
        if (!fired.has(i) && el >= beats[i].at) {
          fired.add(i)
          // Ids that only exist once an earlier scene has created the record are
          // carried as tokens and filled in here, at the moment the beat fires.
          const code = beats[i].js.replace('%PENDANT%', ids.pendantId ?? '')
          await js(code)
        }
      }
      await new Promise((r) => setTimeout(r, 120))
    }
  }

  capturing = false
  await capture

  fs.writeFileSync(path.join(WORK, `frames-${PART}.json`),
    JSON.stringify({ part: Number(PART), frames, timeline, total: Date.now() - t0 }, null, 1))
  console.log(`\n${frames.length} frames, ${((Date.now() - t0) / 1000 / 60).toFixed(1)} min`)
  app.exit(0)
})
