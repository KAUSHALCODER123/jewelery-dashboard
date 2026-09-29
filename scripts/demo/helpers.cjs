/**
 * The in-page helpers every demo recorder injects: typing, clicking, cursor
 * dot, grid cells, autocomplete. Shared by record.cjs (the narrated film) and
 * features.cjs (the silent feature clips).
 */
module.exports = `
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
  /* Invoice rate cell is per ten grams — that is how it is quoted at the counter.
     Found by its column header, because the columns before it are not all
     inputs (a tagged line shows a read-only note under From Purchase, an
     untagged one a select), so counting inputs lands in the wrong cell. */
  async typeRate(v, rowIdx = 0) {
    const g = document.querySelectorAll('.grid-edit')[0]
    const row = this.gridRow(0, rowIdx)
    if (!g || !row) return
    const ci = [...g.querySelectorAll('thead th')].findIndex(th => /^Rate/i.test(th.textContent.trim()))
    const td = ci >= 0 ? row.children[ci] : null
    const inp = td && td.querySelector('input')
    if (inp) await this.typeInto(inp, v, 70)
  },
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
