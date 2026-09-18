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
const HELPERS = require('./helpers.cjs')

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

  const { tradingHistory: history } = require('./history.cjs')
  const tradingHistory = () => history(api, S)
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
