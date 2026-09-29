/**
 * Layout audit — hunts for the kind of bug you only see by looking:
 * controls hidden behind the sticky action bar, content running off the right
 * edge, text clipped inside its box, and elements spilling out of the window.
 *
 * Everything here is measured from real bounding boxes in the running app, at two
 * window sizes, on every screen and with the long forms scrolled to the bottom.
 */
const { app, BrowserWindow, ipcMain } = require('electron')
const path = require('node:path')
const fs = require('node:fs')
const os = require('node:os')
const { seed } = require('./demo-data.cjs')

let pass = 0, fail = 0
const problems = []
const ok = (label) => { pass++; console.log(`   ok   ${label}`) }
const bad = (label, detail) => {
  fail++; problems.push(`${label} — ${detail}`)
  console.log(`   BUG  ${label}\n        ${detail}`)
}
const head = (t) => console.log(`\n── ${t} ${'─'.repeat(Math.max(0, 54 - t.length))}`)

process.on('unhandledRejection', (e) => { console.error('UNHANDLED', e); process.exit(1) })
// Hang backstop. This sweep now renders 40+ screens at two window sizes; run late
// in `test:all` on a heat-throttled machine it is far slower than standalone
// (~42 checks clean in well under a minute cold). Generous so a genuine render
// hang is still caught without the throttled full-suite run tripping it.
setTimeout(() => { console.error('TIMEOUT'); process.exit(1) }, 400_000).unref()

app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'parivar-layout-')))

// This audit closes one window before opening the next size. Electron quits by
// default when the last window closes, which would end the run half-way.
app.on('window-all-closed', () => {})

/** Injected once: the measurements themselves. */
const AUDIT = `
window.__audit = {
  wait: (ms) => new Promise(r => setTimeout(r, ms)),

  /** Controls the user must be able to reach, sitting under the sticky bar. */
  hiddenUnderBar() {
    const bar = document.querySelector('.sticky-actions')
    if (!bar) return []
    const b = bar.getBoundingClientRect()
    const out = []
    for (const el of document.querySelectorAll(
      '.content input, .content select, .content textarea, .content .check, .content .card button'
    )) {
      if (bar.contains(el)) continue
      const r = el.getBoundingClientRect()
      if (r.width === 0 && r.height === 0) continue
      // Covered vertically by the bar and horizontally overlapping it.
      const coveredY = r.top < b.bottom - 2 && r.bottom > b.top + 2
      const overlapX = r.left < b.right && r.right > b.left
      if (coveredY && overlapX) {
        out.push({
          tag: el.tagName.toLowerCase(),
          label: (el.getAttribute('aria-label') || el.placeholder ||
                  el.closest('.field')?.querySelector('.label')?.textContent ||
                  el.textContent || '').trim().slice(0, 40),
          top: Math.round(r.top), barTop: Math.round(b.top),
        })
      }
    }
    return out
  },

  /** Anything wider than the window, which forces sideways scrolling. */
  overflowX() {
    const docW = document.documentElement.clientWidth
    const out = []
    if (document.documentElement.scrollWidth > docW + 1) {
      for (const el of document.querySelectorAll('.content *')) {
        const r = el.getBoundingClientRect()
        if (r.width > 0 && r.right > docW + 1 && !el.closest('.table-wrap, .ac-list, iframe')) {
          out.push({ cls: el.className?.toString().slice(0, 40), right: Math.round(r.right), docW })
          if (out.length > 4) break
        }
      }
    }
    return out
  },

  /** Labels and headings cut off by their own box. */
  clippedText() {
    const out = []
    for (const el of document.querySelectorAll(
      '.content .label, .content .card-title, .content .stat-label, .content .badge, .nav-item span'
    )) {
      if (el.scrollWidth > el.clientWidth + 2 && el.clientWidth > 0) {
        const cs = getComputedStyle(el)
        if (cs.textOverflow === 'ellipsis' || cs.overflow === 'hidden') continue
        out.push({ text: el.textContent.trim().slice(0, 40), scroll: el.scrollWidth, client: el.clientWidth })
      }
    }
    return out
  },

  /** Elements poking outside the window entirely. */
  offscreen() {
    const W = document.documentElement.clientWidth
    const out = []
    for (const el of document.querySelectorAll('.content .card, .topbar > *, .sidebar .nav-item')) {
      const r = el.getBoundingClientRect()
      if (r.width === 0) continue
      if (r.left < -2 || r.right > W + 2) {
        out.push({ cls: el.className?.toString().slice(0, 36), left: Math.round(r.left), right: Math.round(r.right), W })
      }
    }
    return out
  },

  scrollBottom() {
    const c = document.querySelector('.content')
    if (c) c.scrollTop = c.scrollHeight
  },
}
true
`

app.whenReady().then(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'parivar-lay-'))
  require('../electron/db.cjs').open(tmp)
  const api = require('../electron/api.cjs')
  const { auth, bootstrap } = require('../electron/auth.cjs')
  const { gdrive } = require('../electron/gdrive.cjs')
  bootstrap()
  auth.login({ username: 'admin', password: 'admin' })
  seed(api)

  for (const [g, ms] of Object.entries({ ...api, auth, gdrive }))
    for (const [n, fn] of Object.entries(ms))
      ipcMain.handle(`${g}:${n}`, async (_e, p) => {
        try { return { ok: true, data: await fn(p ?? {}) } }
        catch (e) { return { ok: false, error: e.message } }
      })
  ipcMain.handle('app:info', () => ({ version: '1.0.0', dataDir: tmp }))
  ipcMain.handle('print:html', () => ({ ok: true }))
  ipcMain.handle('file:saveText', () => ({ ok: true }))

  let SCREENS = []

  // Both a normal laptop and the app's minimum supported size.
  const SIZES = [
    { w: 1440, h: 900, name: '1440×900' },
    { w: 1100, h: 700, name: '1100×700 (minimum)' },
  ]

  for (const size of SIZES) {
    head(`Window ${size.name}`)
    const w = new BrowserWindow({
      show: true, width: size.w, height: size.h,
      webPreferences: {
        preload: path.join(__dirname, '..', 'electron', 'preload.cjs'),
        contextIsolation: true, sandbox: false,
      },
    })
    await w.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))
    await new Promise((r) => setTimeout(r, 2200))
    await w.webContents.executeJavaScript(AUDIT)

    // Discovered from the sidebar rather than hard-coded: a screen added to the
    // app without being added to a list here would otherwise never be checked by
    // any test, and the suite would stay green while shipping it unvisited.
    SCREENS = await w.webContents.executeJavaScript(`
      [...document.querySelectorAll('.nav-item')].map(b => b.textContent.trim())
        .filter(Boolean)
    `)
    if (!SCREENS.length) throw new Error('No nav items found — did the app render?')

    for (const screen of SCREENS) {
      const res = await w.webContents.executeJavaScript(`(async () => {
        const b = [...document.querySelectorAll('.nav-item')]
          .find(x => x.textContent.trim().startsWith(${JSON.stringify(screen)}))
        if (!b) return { missing: true }
        b.click()
        await __audit.wait(750)
        __audit.scrollBottom()          // the bug only shows at the foot of the page
        await __audit.wait(450)
        return {
          hidden: __audit.hiddenUnderBar(),
          overflow: __audit.overflowX(),
          clipped: __audit.clippedText(),
          off: __audit.offscreen(),
        }
      })()`)

      if (res.missing) { bad(`${screen}`, 'screen not found in the sidebar'); continue }

      const issues = []
      if (res.hidden.length) {
        issues.push(`${res.hidden.length} control(s) trapped under the action bar: ` +
          res.hidden.map((h) => `"${h.label || h.tag}"`).slice(0, 3).join(', '))
      }
      if (res.overflow.length) issues.push(`content runs past the right edge (${res.overflow[0].right}px > ${res.overflow[0].docW}px)`)
      if (res.clipped.length) issues.push(`text clipped: ${res.clipped.map((c) => `"${c.text}"`).slice(0, 2).join(', ')}`)
      if (res.off.length) issues.push(`element outside the window: ${res.off[0].cls}`)

      if (issues.length) bad(`${screen}`, issues.join(' · '))
      else ok(screen)
    }
    w.destroy()
    await new Promise((r) => setTimeout(r, 400))
  }

  // Console output from a windowed Electron run gets truncated when piped, so the
  // result is written to a file as well.
  fs.writeFileSync(
    path.join(__dirname, 'layout-report.json'),
    JSON.stringify({ clean: pass, failed: fail, problems }, null, 2)
  )

  console.log('\n' + '='.repeat(62))
  console.log(`  ${pass} clean, ${fail} with layout problems`)
  if (problems.length) { console.log('\n  Problems:'); problems.forEach((p) => console.log('   - ' + p)) }
  console.log('='.repeat(62))
  process.exit(fail ? 1 : 0)
})
