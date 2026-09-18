/**
 * Records the full feature tour, silent, with captions and chapter cards.
 *
 * The REAL built app, driven the way a shopkeeper drives it, one timestamped
 * frame at a time (see record.cjs for why frames carry their own time). No
 * narration: every scene draws a caption on the screen instead and holds long
 * enough for it to be read.
 *
 * The tour is long, so it is recorded in PARTS — each part its own process
 * with its own seeded shop — and stitched afterwards:
 *
 *   npm run build
 *   DEMO_PART=1 npx electron scripts/demo/tour.cjs      # → demo/tour/part-1.mp4
 *   DEMO_PART=2 npx electron scripts/demo/tour.cjs
 *   ...
 *   node scripts/demo/merge.mjs demo/parivar-full-tour.mp4
 *
 * Scenes that ask for a screenshot (`shot`) also drop a PNG under docs/shots,
 * which is where the owner's manual gets its pictures — so the pictures in
 * the book are the same screens as in the film, made the same day.
 */
const { app, BrowserWindow, ipcMain, screen } = require('electron')
const path = require('node:path')
const fs = require('node:fs')
const os = require('node:os')
const { execFileSync } = require('node:child_process')
const { seed } = require('../../test/demo-data.cjs')
const { tradingHistory } = require('./history.cjs')

const ROOT = path.join(__dirname, '..', '..')
const PART = process.env.DEMO_PART || '1'
const OUT_DIR = path.join(ROOT, 'demo', 'tour')
const SHOTS = path.join(ROOT, 'docs', 'shots')
const WORK = fs.mkdtempSync(path.join(os.tmpdir(), `parivar-tour-${PART}-`))
const FRAMES = path.join(WORK, 'frames')
fs.mkdirSync(FRAMES, { recursive: true })
fs.mkdirSync(OUT_DIR, { recursive: true })
fs.mkdirSync(SHOTS, { recursive: true })

// Filled in once the display is known: the largest 16:9 window that fits.
let W = 1600, H = 900
const MAX_FPS = 10
const HELPERS = require('./helpers.cjs')

/* Caption strip, chapter card, and a few extra helpers the tour needs. */
const EXTRAS = `
window.__t.clickExact = (text, root) => {
  const b = [...(root || document).querySelectorAll('button')].find(x => x.textContent.trim() === text)
  if (!b) throw new Error('button not found: ' + text)
  window.__t.cursorAt(b); b.click()
}
/* The input (or select) that sits under a form label. */
window.__t.byLabel = (label, root) => {
  const lab = [...(root || document).querySelectorAll('label.label')]
    .find(l => l.textContent.trim().startsWith(label))
  if (!lab) return null
  const f = lab.closest('.field') || lab.parentElement
  return f.querySelector('input, select, textarea')
}
window.__t.typeLabel = async (label, text, root) => {
  const el = window.__t.byLabel(label, root)
  if (el) await window.__t.typeInto(el, text)
}
window.__t.selectLabel = (label, value, root) => {
  const el = window.__t.byLabel(label, root)
  if (el) { window.__t.cursorAt(el); window.__t.setSelect(el, value) }
}
/* Click a Segmented / tab button by its text. */
window.__t.tab = (text) => {
  const b = [...document.querySelectorAll('.radio-row button, .tabs .tab, .toolbar button')]
    .find(x => x.textContent.trim() === text)
  if (b) { window.__t.cursorAt(b); b.click() }
}
window.__t.clickRow = (text) => {
  const tr = [...document.querySelectorAll('table.data tbody tr')]
    .find(t => t.textContent.includes(text))
  if (tr) { window.__t.cursorAt(tr.querySelector('td')); tr.click() }
}
window.__t.glowRow = (text) => {
  const tr = [...document.querySelectorAll('table.data tr')].find(t => t.textContent.includes(text))
  if (tr) { tr.classList.add('__glow'); window.__t.glow('.__glow') }
}
window.__cap = (title, text) => {
  let d = document.getElementById('__cap')
  if (!d) {
    d = document.createElement('div')
    d.id = '__cap'
    d.style.cssText = 'position:fixed;left:24px;right:24px;bottom:22px;z-index:99998;' +
      'background:rgba(20,20,24,.92);color:#fff;border-radius:12px;padding:14px 20px;' +
      'font:15px/1.45 "Segoe UI",Arial,sans-serif;box-shadow:0 8px 30px rgba(0,0,0,.35);' +
      'pointer-events:none'
    document.body.appendChild(d)
  }
  d.style.display = ''
  d.innerHTML = '<div style="font-size:12px;letter-spacing:.08em;text-transform:uppercase;' +
    'color:#f2c14e;font-weight:700;margin-bottom:3px">' + title + '</div>' +
    '<div style="font-size:17px;font-weight:600">' + text + '</div>'
}
window.__capHide = () => { const d = document.getElementById('__cap'); if (d) d.style.display = 'none' }
/* Full-screen chapter card, shown for a moment between features. */
window.__card = (num, title, sub) => {
  let d = document.getElementById('__card')
  if (!d) {
    d = document.createElement('div')
    d.id = '__card'
    d.style.cssText = 'position:fixed;inset:0;z-index:99999;background:#17151a;color:#fff;' +
      'display:flex;flex-direction:column;align-items:center;justify-content:center;' +
      'font-family:"Segoe UI",Arial,sans-serif;text-align:center;padding:40px'
    document.body.appendChild(d)
  }
  d.innerHTML = '<div style="font-size:15px;letter-spacing:.3em;text-transform:uppercase;color:#f2c14e;margin-bottom:18px">' +
    num + '</div><div style="font-size:52px;font-weight:700;letter-spacing:-.01em">' + title + '</div>' +
    (sub ? '<div style="font-size:22px;color:#c9c4bd;margin-top:16px;max-width:900px">' + sub + '</div>' : '')
  d.style.display = 'flex'
  const cur = document.getElementById('__cursor'); if (cur) cur.style.display = 'none'
}
window.__cardHide = () => {
  const d = document.getElementById('__card'); if (d) d.style.display = 'none'
  const cur = document.getElementById('__cursor'); if (cur) cur.style.display = ''
}
true
`

app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'parivar-tour-profile-')))
app.disableHardwareAcceleration()

app.whenReady().then(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'parivar-tour-db-'))
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
  ipcMain.handle('mobile:status', () => ({ ok: true, data: { enabled: false, url: '', ip: '' } }))
  ipcMain.handle('mobile:qr', () => ({ ok: true, data: '' }))
  ipcMain.handle('mobile:setEnabled', () => ({ ok: true, data: true }))

  /* ── the seeded shop: masters, stock, and a fortnight of trading ─────── */
  const S = seed(api)
  api.party.save({ name: 'Bullion House', party_type: 'SUPPLIER', state: 'Maharashtra' })
  try { tradingHistory(api, S) } catch (e) { console.log('history:', e.message) }
  const today = new Date().toISOString().slice(0, 10)
  const ringId = api.item.list({ search: 'Ring' })[0]?.id
  const { scenes, parts, seedMore } = require('./tour-scenes.cjs')
  const types = api.itemType.list(); const groups = api.itemGroup.list()
  const ids = { today, ringId, pendantId: null,
    goldTypeId: types.find((t) => t.name === 'Gold')?.id, g22Id: groups.find((g) => g.name === '22K Gold')?.id }
  try { Object.assign(ids, seedMore(api, S, ids) || {}) } catch (e) { console.log('seedMore:', e.message) }

  const wa = screen.getPrimaryDisplay().workAreaSize
  W = Math.min(1600, wa.width - 40); H = Math.round(W * 9 / 16)
  if (H > wa.height - 90) { H = wa.height - 90; W = Math.round(H * 16 / 9) }
  console.log('window', W, 'x', H)
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
  await w.webContents.executeJavaScript(EXTRAS)

  const js = (code) => w.webContents.executeJavaScript(`(async () => { ${code} })()`)
    .catch((e) => console.log('   beat failed:', String(e.message || e).slice(0, 160)))

  /* ── frame capture ─────────────────────────────────────────────────── */
  const frames = []
  let capturing = true
  let n = 0
  const t0 = Date.now()
  let pendingShot = null
  const capture = (async () => {
    const minGap = 1000 / MAX_FPS
    while (capturing) {
      const started = Date.now()
      try {
        const img = await w.webContents.capturePage()
        // Before the first paint capturePage hands back an empty image, and an
        // empty JPEG is a file ffmpeg refuses — one of those at frame 0 used to
        // sink the whole part at encode time.
        if (img.isEmpty()) throw new Error('empty frame')
        const file = `f${String(n).padStart(6, '0')}.jpg`
        fs.writeFileSync(path.join(FRAMES, file), img.toJPEG(82))
        frames.push({ file, t: started - t0 })
        n++
        if (pendingShot) {
          fs.writeFileSync(path.join(SHOTS, `${pendingShot}.png`), img.toPNG())
          console.log(`   📷 ${pendingShot}.png`)
          pendingShot = null
        }
      } catch { /* skip */ }
      const spent = Date.now() - started
      if (spent < minGap) await new Promise((r) => setTimeout(r, minGap - spent))
    }
  })()

  const wanted = parts[PART] || []
  const chapters = []
  let chapterNo = 0
  for (const scene of scenes) {
    if (!wanted.includes(scene.id)) continue
    chapterNo = scenes.indexOf(scene) + 1
    const at = Date.now() - t0
    chapters.push({ id: scene.id, title: scene.title, at })
    console.log(`\n▶ ${chapterNo}. ${scene.id}`)

    // Late-bound ids (a record an earlier scene created).
    if (!ids.pendantId) ids.pendantId = api.item.list({ search: 'Pendant' })[0]?.id ?? null
    const fill = (code) => code
      .replace(/%PENDANT%/g, ids.pendantId ?? '')
      .replace(/%RING%/g, ids.ringId ?? '')
      .replace(/%GOLD%/g, ids.goldTypeId ?? '')
      .replace(/%G22%/g, ids.g22Id ?? '')
      .replace(/%PURCHASE%/g, ids.purchaseId ?? '')
      .replace(/%SCHEME%/g, ids.schemeId ?? '')
      .replace(/%TODAY%/g, ids.today)

    // Chapter card, then the scene.
    if (scene.title) {
      await js(`__capHide(); __card(${JSON.stringify(`Part ${chapterNo}`)}, ${JSON.stringify(scene.title)}, ${JSON.stringify(scene.sub || '')})`)
      await new Promise((r) => setTimeout(r, 2600))
      await js(`__cardHide()`)
    }
    const sceneT0 = Date.now()
    const fired = new Set()
    const beats = scene.beats || []
    const last = beats.length ? Math.max(...beats.map((b) => b.at)) : 0
    const endAt = sceneT0 + (last + (scene.hold ?? 5)) * 1000
    while (Date.now() < endAt) {
      const el = (Date.now() - sceneT0) / 1000
      for (let i = 0; i < beats.length; i++) {
        if (!fired.has(i) && el >= beats[i].at) {
          fired.add(i)
          const b = beats[i]
          if (b.cap) await js(`__cap(${JSON.stringify(b.cap[0])}, ${JSON.stringify(b.cap[1])})`)
          if (b.js) await js(fill(b.js))
          if (b.shot) { await new Promise((r) => setTimeout(r, 700)); pendingShot = b.shot }
        }
      }
      await new Promise((r) => setTimeout(r, 120))
    }
  }

  capturing = false
  await capture
  const total = Date.now() - t0
  w.hide()
  // Only frames that really landed on disk go to the encoder.
  const missing = frames.filter((f) => !fs.existsSync(path.join(FRAMES, f.file))).length
  console.log(`frames captured: ${frames.length}, missing on disk: ${missing}, dir: ${FRAMES}`)
  if (missing) frames.splice(0, frames.length, ...frames.filter((f) => fs.existsSync(path.join(FRAMES, f.file))))
  if (!frames.length) { console.error('no frames captured — nothing to encode'); app.exit(1); return }

  /* ── encode this part ──────────────────────────────────────────────── */
  const lines = []
  for (let i = 0; i < frames.length; i++) {
    const end = i + 1 < frames.length ? frames[i + 1].t : total
    lines.push(`file '${path.join(FRAMES, frames[i].file).replace(/\\/g, '/')}'`)
    lines.push(`duration ${Math.max(0.02, (end - frames[i].t) / 1000).toFixed(4)}`)
  }
  lines.push(`file '${path.join(FRAMES, frames[frames.length - 1].file).replace(/\\/g, '/')}'`)
  const vlist = path.join(WORK, 'video.txt')
  fs.writeFileSync(vlist, lines.join('\n'))
  const out = path.join(OUT_DIR, `part-${PART}.mp4`)
  execFileSync('ffmpeg', ['-y', '-v', 'error', '-f', 'concat', '-safe', '0', '-i', vlist,
    '-vf', 'scale=1600:900',
    '-pix_fmt', 'yuv420p', '-r', '24', '-c:v', 'libx264', '-preset', 'medium', '-crf', '23',
    '-movflags', '+faststart', out], { stdio: 'inherit' })
  fs.writeFileSync(path.join(OUT_DIR, `part-${PART}.json`),
    JSON.stringify({ part: Number(PART), total, chapters }, null, 1))
  console.log(`\npart ${PART}: ${frames.length} frames · ${(total / 1000).toFixed(0)}s → ${out}`)
  app.exit(0)
})
