/** Render real invoice HTML to PDF and verify logo bounds at printer widths. */
const { app, BrowserWindow } = require('electron')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const assert = require('node:assert/strict')
const { buildSync } = require('esbuild')
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'parivar-print-logo-'))
app.setPath('userData', path.join(dir, 'profile'))
app.on('window-all-closed', () => {})
setTimeout(() => { console.error('TIMEOUT'); app.exit(1) }, 60000).unref()

app.whenReady().then(async () => {
  const bundle = path.join(dir, 'invoice.cjs')
  buildSync({ entryPoints: [path.join(__dirname, '../src/print/invoice.ts')],
    bundle: true, platform: 'node', format: 'cjs', outfile: bundle,
    loader: { '.jpeg': 'dataurl', '.png': 'dataurl' }, logLevel: 'silent' })
  const { invoiceHtml } = require(bundle)
  const urdBundle = path.join(dir, 'urd.cjs')
  buildSync({ entryPoints: [path.join(__dirname, '../src/print/urd.ts')],
    bundle: true, platform: 'node', format: 'cjs', outfile: urdBundle,
    loader: { '.jpeg': 'dataurl', '.png': 'dataurl' }, logLevel: 'silent' })
  const { urdBillHtml } = require(urdBundle)
  const data = { company: { name: 'Parivar Jewellers', address: 'Test shop address', phone: '0000000000' },
    sale: { bill_no: 'TEST-1', bill_date: '2026-09-21', party_name: 'Print test customer',
      items: [{ item_name: 'Gold ring', net_wt: 10, gross_wt: 10, purity: 91.6,
        rate_per_gm: 4590, total_amount: 45900, qty: 1, mkg_amount: 4590 }],
      goods_amount: 45900, bill_amount: 50535, total_amount: 52051.05, gst_pct: 3,
      gst_amount: 1516.05, making_amount: 4590, net_balance: 52051.05, urds: [] },
    amount_in_words: 'Fifty two thousand fifty one rupees and five paise only', pending_balance: 52051.05 }
  const oldGold = { ...data, bill: { bill_no: 'OG-1', bill_date: '2026-09-21',
    party_name: 'Print test customer', purchase_amount: 45000, total_amount: 45000,
    amount_given: 40000, net_balance: 5000,
    urds: [{ name: 'Old gold ring', gross_wt: 10, net_wt: 9.5, purity: 90, rate: 5263.158, amount: 45000 }] } }
  for (const [name, paper, width] of [['a4', 'A4', 190], ['thermal80', 'THERMAL', 74], ['thermal58', 'THERMAL', 52], ['old-gold', 'A4', 190]]) {
    const render = name === 'old-gold' ? urdBillHtml : invoiceHtml
    const payload = name === 'old-gold' ? oldGold : data
    const html = render(payload, { paper })
    const w = new BrowserWindow({ show: false, width: Math.ceil(width * 96 / 25.4), height: 900,
      webPreferences: { sandbox: true, offscreen: true, backgroundThrottling: false } })
    await w.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html))
    const info = await w.webContents.executeJavaScript(`(async () => {
      const image = document.querySelector('.shop-logo')
      await image.decode()
      const r = image.getBoundingClientRect(), parent = image.parentElement.getBoundingClientRect()
      return { loaded: image.naturalWidth > 0, embedded: image.src.startsWith('data:image/'),
        left: r.left, right: r.right, top: r.top, bottom: r.bottom,
        parentLeft: parent.left, parentRight: parent.right, parentBottom: parent.bottom,
        width: r.width, height: r.height, viewport: innerWidth,
        fit: getComputedStyle(image).objectFit,
        keepTogether: getComputedStyle(image.parentElement).breakInside }
    })()`)
    assert.ok(info.loaded && info.embedded, 'logo must load without a network/file URL')
    assert.ok(info.left >= info.parentLeft && info.right <= info.parentRight + 0.5)
    assert.ok(info.right <= info.viewport && info.bottom <= info.parentBottom)
    assert.ok(Math.abs(info.width - info.height) < 1, 'square original must not be cropped or stretched')
    assert.equal(info.fit, 'contain')
    assert.equal(info.keepTogether, 'avoid')
    const pdf = await w.webContents.printToPDF({ printBackground: true,
      pageSize: paper === 'A4' ? 'A4' : { width: (width + 6) / 25.4, height: 297 / 25.4 },
      preferCSSPageSize: true, margins: { top: 0, bottom: 0, left: 0, right: 0 } })
    fs.writeFileSync(path.join(dir, `${name}.pdf`), pdf)
    const withoutLogo = render(payload, { paper, showLogo: false })
    assert.equal(withoutLogo.includes('<img class="shop-logo"'), false)
    assert.ok(withoutLogo.includes('<div class="co">Parivar Jewellers</div>'), 'company name remains when logo is disabled')
    console.log(`PASS: ${name} — complete embedded logo within printable width; hide-logo option works`)
    w.destroy()
  }
  const barcodeBundle = path.join(dir, 'barcode.cjs')
  buildSync({ entryPoints: [path.join(__dirname, '../src/print/barcode.ts')],
    bundle: true, platform: 'node', format: 'cjs', outfile: barcodeBundle,
    loader: { '.jpeg': 'dataurl', '.png': 'dataurl' }, logLevel: 'silent' })
  const { labelSheetHtml } = require(barcodeBundle)
  const tags = [{ tag: 'CHA00001', item_name: 'chain', purity: 75, gross_wt: 3, net_wt: 3 }]
  // a 96 mm head leaves nothing to fold over, so that tag carries no logo
  assert.equal(labelSheetHtml(tags, { headMm: 96 }).includes('<img class="shop-logo"'), false)
  // The panel past the head is only 30 mm on the shop's tags before the thin
  // tail begins: a 50 mm panel put the end of the shop's name into the tail.
  for (const [headMm, backMm] of [[30, 30], [50, 30], [50, 45], [70, 30]]) {
    const html = labelSheetHtml(tags, { headMm, backMm, showNet: true, copies: 2 })
    const w = new BrowserWindow({ show: false, width: 800, height: 300,
      webPreferences: { sandbox: true, offscreen: true, backgroundThrottling: false } })
    await w.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html))
    const bounds = await w.webContents.executeJavaScript(`(async () => {
      await Promise.all([...document.images].map(i => i.decode()))
      const mm = 96 / 25.4
      return [...document.querySelectorAll('.tag')].map(tag => {
        const t = tag.getBoundingClientRect(), h = tag.querySelector('.head').getBoundingClientRect(),
          back = tag.querySelector('.back').getBoundingClientRect(),
          barcode = tag.querySelector('svg').getBoundingClientRect(),
          parts = [...tag.querySelectorAll('.back > *')].map(e => e.getBoundingClientRect())
        const mid = (Math.min(...parts.map(r => r.left)) + Math.max(...parts.map(r => r.right))) / 2
        return { barcodeWidth: barcode.width,
          // fold at the head's edge: the back panel mirrors the front one
          foldsToBack: Math.abs(back.left - h.right) < 0.5 && Math.abs(back.width - Math.min(h.width, t.right - h.right, ${backMm} * mm)) < 0.5,
          centred: Math.abs(mid - (back.left + back.right) / 2) < 0.5,
          inside: parts.every(r => r.left >= back.left + mm && r.right <= back.right - mm && r.top >= t.top + 0.9 * mm - 0.5 && r.bottom <= t.bottom - 0.9 * mm + 0.5),
          textFits: [...tag.querySelectorAll('.l1 span, .l2 span')].every(e => e.getBoundingClientRect().right <= h.right) }
      })
    })()`)
    assert.equal(bounds.length, 2)
    for (const b of bounds) {
      assert.ok(b.foldsToBack && b.centred, 'logo panel must start at the fold, stop before the tail and centre the logo on the back')
      assert.ok(b.inside, 'logo and name must sit inside the back panel with safe margins')
      assert.ok(Math.abs(b.barcodeWidth - (headMm - 3) * 96 / 25.4) < 1, 'barcode retains full width')
      assert.ok(b.textFits, 'label text must fit on the front')
    }
    assert.equal(labelSheetHtml(tags, { showLogo: false }).includes('<img class="shop-logo"'), false)
    fs.writeFileSync(path.join(dir, `labels-${headMm}-${backMm}.pdf`), await w.webContents.printToPDF({
      printBackground: true, preferCSSPageSize: true, margins: { top: 0, bottom: 0, left: 0, right: 0 } }))
    console.log(`PASS: TSC ${headMm} mm head, ${backMm} mm logo panel — logo centred on the fold-over back, front untouched, two copies`)
    w.destroy()
  }
  // The shop's TL240 starts the page 7 mm into the tag (a 30 + 30 mm tag folded
  // at its centre). The fold, the back panel and the logo must move left by the
  // shift so they land where they really are; the front starts at the page edge.
  for (const shiftMm of [7, -4]) {
    const html = labelSheetHtml([{ tag: 'BANGLE00123', item_name: 'Kada', purity: 91.6, gross_wt: 999.999, net_wt: 987.654 }], { headMm: 30, backMm: 30, shiftMm, showNet: true })
    const w = new BrowserWindow({ show: false, width: 800, height: 300,
      webPreferences: { sandbox: true, offscreen: true, backgroundThrottling: false } })
    await w.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html))
    const b = await w.webContents.executeJavaScript(`(async () => {
      await Promise.all([...document.images].map(i => i.decode()))
      const mm = 96 / 25.4, t = document.querySelector('.tag').getBoundingClientRect()
      const h = document.querySelector('.head').getBoundingClientRect(),
        back = document.querySelector('.back').getBoundingClientRect(),
        bc = document.querySelector('svg').getBoundingClientRect(),
        parts = [...document.querySelectorAll('.back > *')].map(e => e.getBoundingClientRect())
      const mid = (Math.min(...parts.map(r => r.left)) + Math.max(...parts.map(r => r.right))) / 2
      return { fold: (h.right - t.left) / mm, backLeft: (back.left - t.left) / mm,
        backWidth: back.width / mm, barcodeLeft: (bc.left - t.left) / mm, barcodeRight: (bc.right - t.left) / mm,
        logoMid: (mid - t.left) / mm,
        textFits: [...document.querySelectorAll('.l1 span, .l2 span')].filter(e => !e.classList.contains('nm')).every(e => e.getBoundingClientRect().right <= h.right - 1.4 * mm) }
    })()`)
    const fold = 30 - shiftMm
    assert.ok(Math.abs(b.fold - fold) < 0.1 && Math.abs(b.backLeft - fold) < 0.1, `fold at ${fold} mm on the page`)
    assert.ok(Math.abs(b.backWidth - 30) < 0.1 && Math.abs(b.logoMid - (fold + 15)) < 0.3, 'logo centred on the real back')
    assert.ok(b.barcodeLeft >= Math.max(0, -shiftMm) - 0.01 && b.barcodeRight <= fold - 1.4, 'barcode stays on the front, on the page')
    assert.ok(b.textFits, 'tag number, purity and both weights end before the fold, even at 999 g')
    console.log(`PASS: TSC printer shift ${shiftMm} mm — fold and logo land on the real tag`)
    w.destroy()
  }
  // Awkward pieces: an 11-character tag with a long name and 999 g weights,
  // no item and no purity, 100% purity, a Hindi name with markup characters.
  // Tag number and purity must always print whole; only the name may give way.
  {
    const awkward = [
      { tag: 'BANGLE00123', item_name: 'Antique Kada Pair with Stones', gross_wt: 999.999, net_wt: 987.654, purity: 91.6 },
      { tag: 'RIN00012', item_name: '', gross_wt: 5.12, net_wt: 4.98, purity: 0 },
      { tag: 'COIN00001', item_name: 'Gold coin', gross_wt: 10, net_wt: 10, purity: 100 },
      { tag: 'PAY00021', item_name: 'चांदी पायल & <Set>', gross_wt: 28.4, net_wt: 28.4, purity: 92.5 },
    ]
    const html = labelSheetHtml(awkward, { headMm: 50, backMm: 30, showNet: true })
    const w = new BrowserWindow({ show: false, width: 800, height: 400,
      webPreferences: { sandbox: true, offscreen: true, backgroundThrottling: false } })
    await w.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html))
    const got = await w.webContents.executeJavaScript(`[...document.querySelectorAll('.tag')].map(t => {
      const h = t.querySelector('.head').getBoundingClientRect(), tr = t.getBoundingClientRect()
      const spans = [...t.querySelectorAll('.l1 span, .l2 span')].map(s => s.getBoundingClientRect())
      return { inside: spans.every(r => r.right <= h.right + 0.5 && r.top >= tr.top - 0.5 && r.bottom <= tr.bottom + 0.5),
        tag: t.querySelector('.tg').textContent, purity: t.querySelector('.pu')?.textContent || '',
        name: t.querySelector('.nm')?.textContent || '', weights: t.querySelector('.l2').textContent }
    })`)
    assert.equal(got.length, 4)
    assert.ok(got.every(g => g.inside), 'every line stays inside the head')
    assert.deepEqual(got.map(g => g.tag), awkward.map(t => t.tag), 'tag numbers print whole')
    assert.deepEqual(got.map(g => g.purity), ['91.6%', '', '100.0%', '92.5%'], 'purity prints whole')
    assert.equal(got[0].name, 'Antique Kada Pair with Stones', 'the name is in the markup and only clipped visually')
    assert.equal(got[0].weights, 'G 999.999  N 987.654')
    const pdf = await w.webContents.printToPDF({ printBackground: true, preferCSSPageSize: true,
      margins: { top: 0, bottom: 0, left: 0, right: 0 } })
    fs.writeFileSync(path.join(dir, 'labels-awkward.pdf'), pdf)
    console.log('PASS: TSC awkward pieces — tag and purity whole, long name trimmed, four tags')
    w.destroy()
  }
  console.log('Print samples: ' + dir)
  app.exit(0)
}).catch(e => { console.error(e); app.exit(1) })
