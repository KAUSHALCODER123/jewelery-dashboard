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
  let item = { name: 'Ring', tag_prefix: 'RING-22', item_type_id: group.item_type_id, item_group_id: group.id, design_id: null, weight_mode: 'WEIGHT', uom: 'GRAM', hsn: '7113', image: '' }
  item.id = api.item.save(item)
  api.tagStock.saveBatch({ itemId: item.id, rows: [{ gross_wt: 10, purity: 91.6 }] })
  assert.equal(api.tagStock.nextTag({ itemId: item.id }), 'RING-2200002')
  api.item.save({ ...item, tag_prefix: 'NEW' })
  assert.equal(api.tagStock.nextTag({ itemId: item.id }), 'NEW00001')
  assert.equal(api.tagStock.list({ itemId: item.id })[0].tag, 'RING-2200001')
  api.item.save(item)
  assert.equal(api.tagStock.nextTag({ itemId: item.id }), 'RING-2200002')
  assert.throws(() => api.item.save({ ...item, tag_prefix: '12 BAD' }))
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
  const w = new BrowserWindow({ show: false, webPreferences: { sandbox: true } })
  await w.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html))
  assert.equal(await w.webContents.executeJavaScript('document.querySelectorAll("table.items tbody tr").length'), 46)
  const pdf = await w.webContents.printToPDF({ printBackground: true })
  assert.ok(pdf.length > 1000)
  w.destroy(); db.close(); console.log('PASS: prefixes, saved layouts, custom fields, column order, all 45 items and PDF rendering'); app.exit(0)
}).catch(e => { console.error(e); app.exit(1) })
