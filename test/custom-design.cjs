const { app, BrowserWindow } = require('electron')
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), assert = require('node:assert/strict')
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'parivar-custom-'))
app.setPath('userData', path.join(tmp, 'profile'))
app.on('window-all-closed', () => {})
setTimeout(() => app.exit(1), 60000).unref()
app.whenReady().then(async () => {
  const db = require('../electron/db.cjs'); db.open(tmp)
  const api = require('../electron/api.cjs')
  const group = api.itemGroup.list().find(g => g.name === '22K Gold')
  let item = { name: 'Ring', tag_prefix: 'RING-22K', item_type_id: group.item_type_id, item_group_id: group.id, design_id: null, weight_mode: 'WEIGHT', uom: 'GRAM', hsn: '7113', image: '' }
  item.id = api.item.save(item)
  api.tagStock.saveBatch({ itemId: item.id, rows: [{ gross_wt: 10, purity: 91.6 }] })
  assert.equal(api.tagStock.nextTag({ itemId: item.id }), 'RING-22K00002')
  api.item.save({ ...item, tag_prefix: 'NEW' })
  assert.equal(api.tagStock.nextTag({ itemId: item.id }), 'NEW00001')
  assert.equal(api.tagStock.list({ itemId: item.id })[0].tag, 'RING-22K00001')
  api.item.save(item)
  assert.equal(api.tagStock.nextTag({ itemId: item.id }), 'RING-22K00002')
  assert.throws(() => api.item.save({ ...item, tag_prefix: '12 BAD' }))
  assert.throws(() => api.item.save({ ...item, tag_prefix: 'G2' }))
  const bundle = path.join(tmp, 'invoice.cjs')
  require('esbuild').buildSync({ entryPoints: [path.join(__dirname, '../src/print/invoice.ts')], bundle: true, platform: 'node', format: 'cjs', outfile: bundle, loader: { '.jpeg': 'dataurl' } })
  const { invoiceHtml, loadConfig } = require(bundle)
  const layout = { columns: 3, rows: 4, fields: [
    { id: 'items', kind: 'items', row: 2, column: 1, span: 3 },
    { id: 'header', kind: 'header', row: 1, column: 1, span: 3 },
    { id: 'custom', kind: 'custom', label: 'Reference', source: 'sale.bill_no', row: 3, column: 2, span: 2 },
    { id: 'text', kind: 'custom', label: 'Terms', source: 'text', value: '<script>bad()</script>', row: 4, column: 1, span: 3 },
  ] }
  const cfg = loadConfig(JSON.stringify({ layout, minRows: 0, columnOrder: ['amt', 'name'], columnLabels: { amt: 'Value <tax>' } }))
  api.settings.set({ key: 'invoice_config', value: JSON.stringify(cfg) })
  assert.deepEqual(loadConfig(api.settings.all().invoice_config).layout, cfg.layout)
  const data = { company: { name: 'Test' }, sale: { bill_no: 'B123', bill_date: '2026-09-28', items: Array.from({ length: 45 }, (_, i) => ({ item_name: 'Ring ' + i, total_amount: 10 })), urds: [] } }
  const html = invoiceHtml(data, cfg)
  assert.ok(html.includes('Ring 44'))
  assert.ok(html.includes('Reference</b>: B123'))
  assert.ok(html.includes('&lt;script&gt;'))
  assert.ok(!html.includes('<script>'))
  assert.ok(html.indexOf('Value &lt;tax&gt;') < html.indexOf('Item Name'))
  // Column settings made for A4 must not turn the thermal receipt into a squeezed A4 sheet.
  assert.ok(invoiceHtml(data, loadConfig(JSON.stringify({ paper: 'THERMAL', columnOrder: ['amt'] }))).includes('Thank you'))
  // Bound fields print formatted, and the optional stone-weight column can be switched on.
  const dated = invoiceHtml({ ...data, sale: { ...data.sale, total_amount: 60440.4 } }, loadConfig(JSON.stringify({ cols: { stone: true }, layout: { columns: 1, rows: 3, fields: [
    { id: 'd', kind: 'custom', label: 'Dated', source: 'sale.bill_date', row: 1, column: 1, span: 1 },
    { id: 't', kind: 'custom', label: 'Total', source: 'sale.total_amount', row: 2, column: 1, span: 1 },
    { id: 'items', kind: 'items', row: 3, column: 1, span: 1 }] } })))
  assert.ok(dated.includes('Dated</b>: 28/Sep/2026'), 'date formatted')
  assert.ok(/Total<\/b>: 60,440\.40/.test(dated), 'amount formatted')
  assert.ok(dated.includes('St.Wt'))
  const w = new BrowserWindow({ show: false, webPreferences: { sandbox: true } })
  await w.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html))
  assert.equal(await w.webContents.executeJavaScript('document.querySelectorAll("table.items tbody tr").length'), 46)
  const pdf = await w.webContents.printToPDF({ printBackground: true })
  assert.ok(pdf.length > 1000)

  // Header designs. The standard style prints exactly what a bill printed before,
  // whatever banner settings are sitting unused in the saved design.
  const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
  const shop = { ...data, company: { name: 'Parivar Jewellers', address: 'Main Road, Pune', phone: '9800000000', gstin: '27AAAAA0000A1Z5' } }
  const plain = invoiceHtml(shop, loadConfig(null))
  assert.equal(invoiceHtml(shop, loadConfig(JSON.stringify({ header: { style: 'standard', image: png, background: '#123456' } }))), plain)
  assert.ok(plain.includes('<div class="hd">') && !plain.includes('hd-band'), 'standard header unchanged')
  const banner = { style: 'banner', height: 42, background: '#7a1f2b', image: png, fit: 'contain', logo: 'right', tagline: 'Since 1985 <gold>',
    name: { show: true, color: '#f6d98b', size: 34, align: 'left' }, taglineLine: { show: true, color: '#ffffff', size: 13, align: 'left' },
    address: { show: false }, contact: { show: true, color: '#eeeeee', size: 9, align: 'right' } }
  const bcfg = loadConfig(JSON.stringify({ header: banner }))
  api.settings.set({ key: 'invoice_config', value: JSON.stringify(bcfg) })
  assert.deepEqual(loadConfig(api.settings.all().invoice_config).header, bcfg.header, 'header saved with the design')
  const bhtml = invoiceHtml(shop, bcfg)
  assert.ok(bhtml.includes('height:42mm;background:#7a1f2b'), 'banner colour and height')
  assert.ok(bhtml.includes(`src="${png}"`) && bhtml.includes('object-fit:contain'), 'background image and fit')
  assert.ok(bhtml.includes('color:#f6d98b;font-size:34px;text-align:left">Parivar Jewellers<'), 'shop name styled')
  assert.ok(bhtml.includes('Since 1985 &lt;gold&gt;'), 'tagline escaped')
  assert.ok(!bhtml.includes('Main Road, Pune'), 'address hidden')
  assert.ok(bhtml.includes('text-align:right">Contact No.: 9800000000'), 'contact line')
  assert.ok(bhtml.indexOf('hd-text') < bhtml.indexOf('class="hd-logo"'), 'logo on the right')
  assert.ok(bhtml.includes('TAX INVOICE') && !bhtml.includes('<div class="hd">'))
  // Image-only prints just the picture; with no picture it falls back to the standard header.
  const only = invoiceHtml(shop, loadConfig(JSON.stringify({ header: { style: 'image', image: png, fit: 'stretch', height: 30 } })))
  assert.ok(only.includes('height:30mm') && only.includes('object-fit:fill') && !only.includes('class="hd-name"'), 'image-only header')
  assert.equal(invoiceHtml(shop, loadConfig(JSON.stringify({ header: { style: 'image' } }))), plain)
  // Only a real picture reaches the src attribute; bad values are repaired.
  const bad = loadConfig(JSON.stringify({ header: { style: 'banner', image: 'javascript:alert(1)', background: 'red;x', height: 999 } })).header
  assert.equal(bad.image, ''); assert.equal(bad.background, '#7A1F2B'); assert.equal(bad.height, 90)
  // The band keeps its height on the printed sheet and the picture actually loads.
  await w.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(bhtml))
  const band = await w.webContents.executeJavaScript(`(() => { const b = document.querySelector('.hd-band'); return {
    h: b.getBoundingClientRect().height, img: document.querySelector('.hd-bg').naturalWidth, bg: getComputedStyle(b).backgroundColor } })()`)
  assert.ok(Math.abs(band.h - 42 * 96 / 25.4) < 2, 'band height ' + band.h)
  assert.equal(band.img, 1); assert.equal(band.bg, 'rgb(122, 31, 43)')
  assert.ok((await w.webContents.printToPDF({ printBackground: true })).length > 1000)
  w.destroy(); db.close(); console.log('PASS: prefixes, saved layouts, custom fields, column order, all 45 items, header designs and PDF rendering'); app.exit(0)
}).catch(e => { console.error(e); app.exit(1) })
