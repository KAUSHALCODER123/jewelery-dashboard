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
    loader: { '.jpeg': 'dataurl' }, logLevel: 'silent' })
  const { invoiceHtml } = require(bundle)
  const urdBundle = path.join(dir, 'urd.cjs')
  buildSync({ entryPoints: [path.join(__dirname, '../src/print/urd.ts')],
    bundle: true, platform: 'node', format: 'cjs', outfile: urdBundle,
    loader: { '.jpeg': 'dataurl' }, logLevel: 'silent' })
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
  console.log('Print samples: ' + dir)
  app.exit(0)
}).catch(e => { console.error(e); app.exit(1) })
