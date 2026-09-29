/**
 * Records a short, silent walkthrough of a release's new features.
 *
 * Same idea as record.cjs — the REAL built app, driven the way a shopkeeper
 * drives it, one timestamped frame at a time — but with no narration: each
 * scene carries a caption drawn on the screen instead, and holds long enough
 * to be read. That makes it something that can be made the moment a feature
 * lands, without a voice session, and sent on WhatsApp the same day.
 *
 *   npm run build
 *   npx electron scripts/demo/features.cjs [out.mp4]
 */
const { app, BrowserWindow, ipcMain } = require('electron')
const path = require('node:path')
const fs = require('node:fs')
const os = require('node:os')
const { execFileSync } = require('node:child_process')
const { seed } = require('../../test/demo-data.cjs')

const ROOT = path.join(__dirname, '..', '..')
const OUT = path.resolve(process.argv[2] || path.join(ROOT, 'demo', 'parivar-new-features-1.26.mp4'))
const WORK = fs.mkdtempSync(path.join(os.tmpdir(), 'parivar-features-'))
const FRAMES = path.join(WORK, 'frames')
fs.mkdirSync(FRAMES, { recursive: true })

const W = 1600, H = 900
const MAX_FPS = 10
const HELPERS = require('./helpers.cjs')

/* A caption strip along the bottom, and a way to change what it says. */
const CAPTION = `
window.__t.clickExact = (text, root) => {
  const b = [...(root || document).querySelectorAll('button')].find(x => x.textContent.trim() === text)
  if (!b) throw new Error('button not found: ' + text)
  window.__t.cursorAt(b); b.click()
}
window.__cap = (title, text) => {
  let d = document.getElementById('__cap')
  if (!d) {
    d = document.createElement('div')
    d.id = '__cap'
    d.style.cssText = 'position:fixed;left:24px;right:24px;bottom:22px;z-index:99998;' +
      'background:rgba(20,20,24,.92);color:#fff;border-radius:12px;padding:14px 20px;' +
      'font:15px/1.45 "Segoe UI",Arial,sans-serif;box-shadow:0 8px 30px rgba(0,0,0,.35);' +
      'pointer-events:none;transition:opacity .3s'
    document.body.appendChild(d)
  }
  d.innerHTML = '<div style="font-size:12px;letter-spacing:.08em;text-transform:uppercase;' +
    'color:#f2c14e;font-weight:700;margin-bottom:3px">' + title + '</div>' +
    '<div style="font-size:16px;font-weight:600">' + text + '</div>'
}
true
`

const beat = (at, js) => ({ at, js })

app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'parivar-features-profile-')))
app.disableHardwareAcceleration()

app.whenReady().then(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'parivar-features-db-'))
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
  const pkg = require('../../package.json')
  ipcMain.handle('app:info', () => ({ version: pkg.version, dataDir: tmp }))
  for (const c of ['print:html', 'print:pdf', 'file:saveText']) ipcMain.handle(c, () => ({ ok: true }))
  ipcMain.handle('gdrive:status', () => ({ ok: true, data: { configured: false, connected: false } }))
  ipcMain.handle('gdrive:listBackups', () => ({ ok: true, data: [] }))
  for (const c of ['send:whatsapp', 'send:sms', 'send:email']) ipcMain.handle(c, () => ({ ok: true }))

  const S = seed(api)
  const today = new Date().toISOString().slice(0, 10)
  const ringId = api.item.list({ search: 'Ring' })[0]?.id
  api.tagStock.updateRows({
    rows: api.tagStock.list({ status: 'IN_STOCK' }).map((t) => ({ id: t.id, purchase_rate: 6050 })),
  })
  // A purchase with metal still to label, so the bill's "From Purchase" list
  // and the tag screen's purchase strip have something real to show.
  const pu = api.purchase.save({
    head: { prefix: 'MI', invoice_date: today, party_id: S.suppliers.mahavir,
            party_name: 'Mahavir Gold', metal: 'Gold', state: 'Maharashtra',
            gst_pct: 3, is_credit: 1, paid_amount: 0 },
    items: [{ item_id: ringId, item_name: 'Ring', direction: 'IN', qty: 5, gross_wt: 50,
              net_wt: 50, purity: 91.6, rate: 6200, wastage_pct: 0 }],
  })
  // Old gold already taken on a sale bill, so the report shows both sources.
  const chain = api.tagStock.list({ status: 'IN_STOCK', search: 'Chain' })[0]
  if (chain) {
    api.sale.save({
      head: { prefix: 'COM', bill_date: today, party_id: S.customers.priya, party_name: 'Priya Deshmukh',
              state: 'Maharashtra', gst_pct: 3, payment_mode: 'Cash' },
      items: [{ tag: chain.tag, tag_stock_id: chain.id, item_id: chain.item_id, item_name: chain.item_name,
                qty: chain.qty, gross_wt: chain.gross_wt, purity: chain.purity, stone_wt: chain.stone_wt,
                net_wt: chain.net_wt, rate_per_gm: 6180, mkg_per_gm: 220, hallmark_charges: 45 }],
      urds: [{ name: 'Old Gold', description: 'purani bali', gross_wt: 4.2, net_wt: 4.2, purity: 80, rate: 5800 }],
    })
  }

  const w = new BrowserWindow({
    show: true, width: W, height: H, useContentSize: true, backgroundColor: '#ffffff',
    webPreferences: {
      preload: path.join(ROOT, 'electron', 'preload.cjs'),
      contextIsolation: true, sandbox: false,
    },
  })
  await w.loadFile(path.join(ROOT, 'dist', 'index.html'))
  await new Promise((r) => setTimeout(r, 2500))
  await w.webContents.executeJavaScript(HELPERS)
  await w.webContents.executeJavaScript(CAPTION)

  const js = (code) => w.webContents.executeJavaScript(`(async () => { ${code} })()`)
    .catch((e) => console.log('   beat failed:', String(e.message || e).slice(0, 140)))
  const cap = (title, text) => `window.__cap(${JSON.stringify(title)}, ${JSON.stringify(text)})`

  /* ── the scenes ─────────────────────────────────────────────────────── */
  const scenes = [
    {
      id: 'oldgold-bill', hold: 5,
      beats: [
        beat(0, `${cap('New in 1.26 · Old Gold Purchase', 'Buy old gold from a customer with nothing sold against it — Transactions → Old Gold Purchase.')}; __t.nav('Old Gold Purchase')`),
        beat(4, `__t.click('New Old Gold Bill')`),
        beat(6, `${cap('Old Gold Purchase', 'Pick the customer, or leave it blank for a walk-in paid in full.')}; await __t.pickAuto('customer', 'Sandip')`),
        beat(11, `${cap('Old Gold Purchase', 'Same old-gold lines as the sale bill: gross, net, purity, rate — priced on fine weight.')}; await __t.typeCellIn(0, 0, 1, 'Broken chain'); await __t.typeCellIn(0, 0, 2, '10.5'); await __t.typeCellIn(0, 0, 4, '80'); await __t.typeCellIn(0, 0, 6, '5800')`),
        beat(22, `${cap('Old Gold Purchase', 'Payable to the customer, paid now, and any balance left on their khata. Blank "Paid now" means paid in full.')}; __t.highlight('.total-row.grand')`),
        beat(27, `const ins=[...document.querySelectorAll('.modal input.input')]; const paid=ins.find(i=>/^[\\d,]+\\.\\d\\d$/.test(i.placeholder||'')); if (paid) await __t.typeInto(paid, '30000')`),
        beat(32, `${cap('Old Gold Purchase', 'Cash or bank drops by what was paid; the rest sits on the khata as a credit until it is settled.')}; __t.highlight('.total-row.debit')`),
        beat(37, `__t.clickExact('Save', document.querySelector('.modal-foot'))`),
        beat(41, `${cap('Old Gold Purchase', 'Every bill listed with fine weight, value, paid and balance. Print, PDF, edit or delete from here.')}; __t.highlight('table.data tbody tr:first-child')`),
      ],
    },
    {
      id: 'oldgold-report', hold: 6,
      beats: [
        beat(0, `${cap('New in 1.26 · Old Gold Report', 'Reports → Old Gold Report: every gram of old gold taken in, on sale bills and on old gold bills.')}; __t.nav('Old Gold Report')`),
        beat(5, `${cap('Old Gold Report', 'Old Gold Total — fine grams in, rupees paid, average rate per fine gram, and the URD gold in the safe right now.')}; __t.highlight('.stat-grid')`),
        beat(12, `${cap('Old Gold Report', 'One row per line, with the bill it came from. Click a row to open that bill.')}; __t.highlight('table.data')`),
        beat(18, `${cap('Old Gold Report', 'Filter by source, search by bill or customer, print or export.')}; __t.click('Old gold bills')`),
        beat(23, `__t.click('All')`),
      ],
    },
    {
      id: 'daybook', hold: 5,
      beats: [
        beat(0, `${cap('Day Book', 'Old gold bills get their own row in the Day Book: paid today, and still owed.')}; __t.nav('Day Book')`),
        beat(4, `const tr=[...document.querySelectorAll('table.data tr')].find(t=>/Old Gold Bills/.test(t.textContent)); if (tr) { tr.classList.add('__glow'); __t.glow('.__glow') }`),
      ],
    },
    {
      id: 'purchase-labels', hold: 6,
      beats: [
        beat(0, `${cap('Purchase → Labels', 'A saved purchase now stays open with its Labels Tally, and "Save & Make Labels" goes straight to the tag screen.')}; __t.nav('Purchase')`),
        beat(4, `__t.click('New Purchase')`),
        beat(7, `await __t.pickAuto('supplier', 'Mahavir')`),
        beat(12, `await __t.typePurchaseLine('Ring', '40', '91.6', '62000')`),
        beat(24, `${cap('Purchase → Labels', 'Save & Make Labels: the invoice is saved and Tag & Barcode opens with it preselected.')}; __t.highlight('.sticky-actions button')`),
        beat(28, `__t.click('Save & Make Labels')`),
        beat(33, `${cap('Tag & Barcode', 'The purchase strip: bought, already labelled, sold untagged, and what these pieces will leave.')}; __t.scrollTo(0)`),
        beat(38, `${cap('Tag & Barcode', 'Or choose "All loose metal" to tag from the whole pool without tying the labels to any invoice.')}; const s=[...document.querySelectorAll('select')].find(x=>[...x.options].some(o=>/All loose metal/.test(o.text))); if (s) { __t.cursorAt(s); s.classList.add('__glow'); __t.glow('.__glow'); await __t.wait(1500); __t.setSelect(s, '') }`),
      ],
    },
    {
      id: 'sale-untagged', hold: 6,
      beats: [
        beat(0, `${cap('Sales bill · From Purchase', 'An untagged line can now name the purchase it was sold out of. Its weight comes off that invoice’s tally.')}; __t.nav('Sales Invoice')`),
        beat(4, `await __t.pickAuto('customer', 'Amit')`),
        beat(9, `const row=__t.gridRow(0,0); await __t.typeInto(row.querySelectorAll('input')[1], 'Ring', 90); await __t.wait(600); document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))`),
        beat(13, `${cap('Sales bill · From Purchase', 'The From Purchase column lists every invoice with metal still to label.')}; const s=__t.gridRow(0,0).querySelector('select'); if (s) { __t.cursorAt(s); s.classList.add('__glow'); __t.glow('.__glow'); await __t.wait(1200); __t.setSelect(s, '${pu.id}') }`),
        beat(19, `await __t.typeCellIn(0, 0, 3, '8'); await __t.typeCellIn(0, 0, 4, '91.6'); await __t.typeRate('62000')`),
        beat(30, `${cap('Sales bill · From Purchase', 'On save the line is refused if it takes more than the invoice has unlabelled, or if the metals differ.')}; __t.highlight('.total-row.grand')`),
        beat(35, `__t.clickExact('Save')`),
        beat(40, `${cap('Purchase → Labels Tally', 'Back on the purchase: the untagged sale is listed under its labels and the pending weight has come down.')}; __t.nav('Purchase')`),
        beat(44, `let tr=null; for (let k=0;k<20 && !tr;k++){ tr=[...document.querySelectorAll('table.data tbody tr')].find(t=>(t.querySelector('td')?.textContent||'').trim()==='MI1'); if(!tr) await __t.wait(250) } if (tr) { __t.cursorAt(tr.querySelector('td')); tr.click() }`),
        beat(48, `__t.scrollTo(1)`),
        beat(51, `__t.highlight('.card:last-of-type table.data')`),
      ],
    },
    {
      id: 'labels', hold: 6,
      beats: [
        beat(0, `${cap('TSC 100 × 15 tag', 'Barcode tag print fixed: bigger tag name and weights, nothing clipped at the bottom.')}; __t.nav('Tag & Barcode')`),
        beat(4, `__t.click('From loose metal')`),
      ],
    },
  ]

  /* ── frame capture ───────────────────────────────────────────────────── */
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
        const file = `f${String(n).padStart(6, '0')}.jpg`
        fs.writeFileSync(path.join(FRAMES, file), img.toJPEG(82))
        frames.push({ file, t: started - t0 })
        n++
      } catch { /* skip */ }
      const spent = Date.now() - started
      if (spent < minGap) await new Promise((r) => setTimeout(r, minGap - spent))
    }
  })()

  for (const scene of scenes) {
    console.log(`\n▶ ${scene.id}`)
    const sceneT0 = Date.now()
    const fired = new Set()
    const last = Math.max(...scene.beats.map((b) => b.at))
    const endAt = sceneT0 + (last + scene.hold) * 1000
    while (Date.now() < endAt) {
      const el = (Date.now() - sceneT0) / 1000
      for (let i = 0; i < scene.beats.length; i++) {
        if (!fired.has(i) && el >= scene.beats[i].at) { fired.add(i); await js(scene.beats[i].js) }
      }
      await new Promise((r) => setTimeout(r, 120))
    }
  }

  capturing = false
  await capture
  const total = Date.now() - t0
  w.hide()

  /* ── encode, each frame at the duration it really occupied ───────────── */
  const lines = []
  for (let i = 0; i < frames.length; i++) {
    const end = i + 1 < frames.length ? frames[i + 1].t : total
    lines.push(`file '${path.join(FRAMES, frames[i].file).replace(/\\/g, '/')}'`)
    lines.push(`duration ${Math.max(0.02, (end - frames[i].t) / 1000).toFixed(4)}`)
  }
  lines.push(`file '${path.join(FRAMES, frames[frames.length - 1].file).replace(/\\/g, '/')}'`)
  const vlist = path.join(WORK, 'video.txt')
  fs.writeFileSync(vlist, lines.join('\n'))
  fs.mkdirSync(path.dirname(OUT), { recursive: true })
  execFileSync('ffmpeg', ['-y', '-v', 'error', '-f', 'concat', '-safe', '0', '-i', vlist,
    '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2', '-pix_fmt', 'yuv420p',
    '-r', '24', '-c:v', 'libx264', '-preset', 'medium', '-crf', '23',
    '-movflags', '+faststart', OUT], { stdio: 'inherit' })
  const mb = (fs.statSync(OUT).size / 1024 / 1024).toFixed(1)
  console.log(`\n${frames.length} frames · ${(total / 1000).toFixed(0)}s · ${mb} MB\n${OUT}`)
  app.exit(0)
})
