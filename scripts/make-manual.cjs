/**
 * Renders docs/manual.html to a paginated PDF using the same print engine the
 * app uses for invoices, so the manual matches what the software actually prints.
 *
 *   npm run manual
 */
const { app, BrowserWindow } = require('electron')
const path = require('node:path')
const fs = require('node:fs')

process.on('unhandledRejection', (e) => { console.error('FAILED', e); process.exit(1) })
setTimeout(() => { console.error('TIMEOUT'); process.exit(1) }, 90_000).unref()

app.whenReady().then(async () => {
  // Default: the reference manual. Pass another HTML + PDF pair to render a
  // different book, e.g. the shop owner's manual:
  //   electron scripts/make-manual.cjs docs/shop-owner-manual.html docs/Parivar-Shop-Owner-Manual.pdf
  const args = process.argv.slice(2).filter((a) => !a.startsWith('-'))
  const src = args[0] ? path.resolve(args[0]) : path.join(__dirname, '..', 'docs', 'manual.html')
  const out = args[1] ? path.resolve(args[1]) : path.join(__dirname, '..', 'docs', 'Parivar-Jewellery-ERP-Manual.pdf')
  const label = /owner/i.test(src) ? "Parivar Jewellery ERP — Shop Owner's Manual" : 'Parivar Jewellery ERP — User Manual'

  const w = new BrowserWindow({ show: false, webPreferences: { sandbox: true } })
  await w.loadFile(src)
  // Give web fonts and layout a moment to settle before paginating.
  await new Promise((r) => setTimeout(r, 900))

  const pdf = await w.webContents.printToPDF({
    pageSize: 'A4',
    printBackground: true,
    displayHeaderFooter: true,
    headerTemplate: '<div></div>',
    footerTemplate: `
      <div style="width:100%;font-family:Segoe UI,Arial,sans-serif;font-size:8px;
                  color:#96918A;padding:0 16mm;display:flex;justify-content:space-between;">
        <span>${label}</span>
        <span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span>
      </div>`,
    margins: { top: 0.5, bottom: 0.6, left: 0.55, right: 0.55 },
  })

  fs.writeFileSync(out, pdf)
  const kb = (fs.statSync(out).size / 1024).toFixed(0)
  console.log(`Manual written: ${out}  (${kb} KB)`)
  process.exit(0)
})
