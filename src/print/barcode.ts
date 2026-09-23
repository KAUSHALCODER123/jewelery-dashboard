// Pure black-and-white crop of the mark: a thermal head has no greys, and the
// full artwork's own lettering is a smudge at tag size, so the name is set as text.
import shopLogo from '../assets/parivar-mark-tag.png?inline'

/**
 * Code 128 barcode rendering, as inline SVG.
 *
 * Written by hand rather than pulled from npm: it is about sixty lines, it has to
 * work offline inside a print window, and a scanner either reads the bars or it
 * does not — there is nothing to keep up to date.
 *
 * Code Set B is used throughout, which covers all printable ASCII. Tag numbers
 * are plain letters and digits, so that is more than enough.
 */

/** The 107 Code 128 bar/space width patterns, indexed by symbol value. */
const PATTERNS = [
  '212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312',
  '132212', '221213', '221312', '231212', '112232', '122132', '122231', '113222',
  '123122', '123221', '223211', '221132', '221231', '213212', '223112', '312131',
  '311222', '321122', '321221', '312212', '322112', '322211', '212123', '212321',
  '232121', '111323', '131123', '131321', '112313', '132113', '132311', '211313',
  '231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121',
  '313121', '211331', '231131', '213113', '213311', '213131', '311123', '311321',
  '331121', '312113', '312311', '332111', '314111', '221411', '431111', '111224',
  '111422', '121124', '121421', '141122', '141221', '112214', '112412', '122114',
  '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111',
  '111242', '121142', '121241', '114212', '124112', '124211', '411212', '421112',
  '421211', '212141', '214121', '412121', '111143', '111341', '131141', '114113',
  '114311', '411113', '411311', '113141', '114131', '311141', '411131', '211412',
  '211214', '211232', '2331112',
]

const START_B = 104
const STOP = 106

/**
 * Bar widths for a Code 128 Set B barcode, including the start symbol,
 * modulo-103 checksum and stop pattern.
 */
function encode(value: string): string {
  const text = String(value).replace(/[^\x20-\x7E]/g, '')
  const codes: number[] = [START_B]
  for (const ch of text) codes.push(ch.charCodeAt(0) - 32)

  // Checksum: start value plus each symbol weighted by its position.
  let sum = START_B
  for (let i = 1; i < codes.length; i++) sum += codes[i] * i
  codes.push(sum % 103, STOP)

  return codes.map((c) => PATTERNS[c]).join('')
}

export type BarcodeOptions = {
  /** Width of one narrow bar, in the SVG's own units. */
  moduleWidth?: number
  height?: number
  showText?: boolean
  fontSize?: number
}

/** Render a Code 128 barcode as a self-contained `<svg>` string. */
export function barcodeSvg(value: string, opts: BarcodeOptions = {}): string {
  const { moduleWidth = 1.6, height = 34, showText = true, fontSize = 7 } = opts
  const widths = encode(value)

  let x = 0
  let bars = ''
  // Digits alternate bar, space, bar, space… starting with a bar.
  for (let i = 0; i < widths.length; i++) {
    const w = Number(widths[i]) * moduleWidth
    if (i % 2 === 0) {
      bars += `<rect x="${x.toFixed(2)}" y="0" width="${w.toFixed(2)}" height="${height}" />`
    }
    x += w
  }

  const textH = showText ? fontSize + 3 : 0
  const total = height + textH
  const label = showText
    ? `<text x="${(x / 2).toFixed(2)}" y="${total - 1}" text-anchor="middle"
         font-family="Consolas, monospace" font-size="${fontSize}"
         letter-spacing="0.5">${escapeXml(value)}</text>`
    : ''

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${x.toFixed(2)} ${total}"
    width="${x.toFixed(2)}" height="${total}" shape-rendering="crispEdges" fill="#000">
    ${bars}${label}
  </svg>`
}

const escapeXml = (s: string) =>
  String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]!))

/* ───────────────────────────── label sheets ───────────────────────────── */

export type LabelSize = 'tsc-100x15' | 'roll' | 'a4-65' | 'a4-24'

export const LABEL_SIZES: { value: LabelSize; label: string; hint: string }[] = [
  {
    value: 'tsc-100x15', label: 'TSC TL240 — 100 × 15 mm tag',
    hint: 'Rat-tail jewellery tag, one per label. Everything prints in the head; the thin tail that wraps the piece is left blank.',
  },
  { value: 'roll', label: 'Jewellery tag roll', hint: '50 × 12 mm, one per row — dumbbell tags' },
  { value: 'a4-65', label: 'A4 sheet — 65 labels', hint: '38 × 21 mm, 5 across × 13 down' },
  { value: 'a4-24', label: 'A4 sheet — 24 labels', hint: '64 × 34 mm, 3 across × 8 down' },
]

const SHEET = {
  // One label per page, so the printer's own gap sensor does the feeding. No
  // margin: the TL240 is told the label is exactly 100 × 15 and positions
  // itself; any page margin would shift every label by that much.
  'tsc-100x15': { cols: 1, w: 100, h: 15, gapX: 0, gapY: 0, padX: 0, padY: 0, page: '@page { size: 100mm 15mm; margin: 0; }' },
  roll:    { cols: 1, w: 50, h: 12, gapX: 0, gapY: 2, padX: 1, padY: 1, page: '@page { size: 50mm 14mm; margin: 1mm; }' },
  'a4-65': { cols: 5, w: 38, h: 21, gapX: 2, gapY: 0, padX: 1, padY: 1, page: '@page { size: A4; margin: 11mm 5mm; }' },
  'a4-24': { cols: 3, w: 64, h: 34, gapX: 2, gapY: 1, padX: 2, padY: 2, page: '@page { size: A4; margin: 13mm 6mm; }' },
}

export type LabelTag = {
  tag: string
  item_name?: string
  group_name?: string
  gross_wt?: number
  net_wt?: number
  purity?: number
}

export type LabelOptions = {
  size?: LabelSize
  showItem?: boolean
  showGross?: boolean
  showNet?: boolean
  showPurity?: boolean
  shopName?: string
  /** Print the company mark just past the TSC tag's head, where it folds to the back. */
  showLogo?: boolean
  /** Skip this many label positions — lets you reuse a part-used sheet. */
  skip?: number
  copies?: number
  /** TSC tag only: length of the printable head in mm (the rest is the tail). */
  headMm?: number
  /**
   * TSC tag only: width in mm of the fold-over panel just past the head that
   * carries the company mark. The thin tail starts after it, so anything wider
   * runs off the label — the shop's tags give it 30 mm.
   */
  backMm?: number
}

const wt3 = (n: any) => (Number(n) || 0).toFixed(3)

/**
 * The 100 × 15 mm jewellery tag the shop runs on its TSC TL240.
 *
 * A rat-tail tag, not a dumbbell: only the HEAD (about 50 mm) and a short
 * stretch after it (about 30 mm) are printable. The rest is a 3 mm wide tail
 * that wraps around the ring or chain and sticks to itself, so anything printed
 * there is lost. The whole label — barcode, tag number, item and weights — is
 * stacked inside the head. The stretch after it carries only the company mark:
 * the tag is folded at the head's edge, so the mark ends up on the back of the
 * printed face. The mark's panel is kept to that stretch — a wider panel put
 * the end of the shop's name past the fold into the tail, where it was cut.
 *
 *   ┌────────────────────────────────┬────────────────────┬───────────
 *   │ ▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌  │                    │
 *   │ RIN00012 · Ladies Ring · 91.6% │    company mark    │ ═══ tail
 *   │ G 5.120  N 4.980               │                    │
 *   └────────────────────────────────┴────────────────────┴───────────
 *                head (front)          folds to the back
 *
 * The barcode runs the full width of the head so each bar is at least three
 * printer dots wide at 203 dpi — a narrower code on this small a tag is what
 * makes a scanner miss.
 */
function tscTagHtml(
  tags: (LabelTag | null)[],
  o: Required<Omit<LabelOptions, 'size' | 'skip' | 'copies' | 'headMm' | 'backMm'>>
    & { headMm: number; backMm: number },
): string {
  const head = Math.min(96, Math.max(30, Number(o.headMm) || 50))
  // The panel behind the head once the tag is folded at the head's edge — never
  // past the label, and never wider than the head it folds on to.
  const back = Math.min(head, 100 - head, Math.max(12, Number(o.backMm) || 30))
  const cells = tags.map((t) => {
    if (!t) return `<div class="tag blank"></div>`
    const l1 = [
      t.tag,
      o.showItem && (t.item_name || ''),
      o.showPurity && t.purity ? `${Number(t.purity).toFixed(1)}%` : '',
    ].filter(Boolean).join('  ')
    const l2 = [
      o.showGross ? `G ${wt3(t.gross_wt)}` : '',
      o.showNet ? `N ${wt3(t.net_wt)}` : '',
      o.shopName || '',
    ].filter(Boolean).join('  ')
    return `<div class="tag">
      <div class="head">
        <div class="bc">${barcodeSvg(t.tag, { moduleWidth: 1, height: 22, showText: false })
          // Stretch to the full head width: bars get wider in proportion, so
          // the code stays valid and every bar is several printer dots wide.
          .replace('<svg ', '<svg preserveAspectRatio="none" ')}</div>
        <div class="l1"><span>${escapeXml(l1)}</span></div>
        ${l2 ? `<div class="l2"><span>${escapeXml(l2)}</span></div>` : ''}
      </div>
      ${o.showLogo && back >= 12 ? `<div class="back"><img class="shop-logo" src="${shopLogo}" alt="Parivar Jewellers">${back >= 26 ? '<b>PARIVAR JEWELLERS</b>' : ''}</div>` : ''}
    </div>`
  }).join('')

  return `<!doctype html>
<meta charset="utf-8"><title>Barcode labels</title>
<style>
  @page { size: 100mm 15mm; margin: 0; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body { font-family: "Segoe UI", Arial, sans-serif; -webkit-print-color-adjust: exact; }
  /*
   * The box is deliberately SHORTER than the 15 mm page. A box exactly the page
   * height rounds, at the printer's 203 dpi, to a hair more than one page, and
   * Chromium then emits an empty second page for it — which the TL240 feeds as
   * a blank tag. In the shop that showed up as every other tag coming out
   * white. The page break goes BEFORE each tag rather than after, so the last
   * one never trails an empty page either.
   */
  .tag {
    position: relative; width: 100mm; height: 14.4mm; overflow: hidden;
    /* faint guide for the on-screen preview only: where the head ends */
    background: linear-gradient(to right, transparent ${head}mm, #eee ${head}mm, #eee 100%);
  }
  .tag + .tag { break-before: page; page-break-before: always; }
  .tag.blank { visibility: hidden; }
  /*
   * Every row has an EXPLICIT height and the rows are stacked from the top,
   * so where each one lands is arithmetic, not the browser's guess:
   *
   *     0.9  top margin
   *     5.0  barcode
   *     0.2
   *     3.5  tag · item · purity        9 pt
   *     0.2
   *     3.7  weights                    9.5 pt bold
   *     0.9  bottom margin
   *    ────
   *    14.4  = the box
   *
   * The earlier layout padded 2 mm top and bottom and let the two text lines
   * find their own height inside what was left; on the printer's font metrics
   * the weight line ended up straddling the clipped bottom padding and lost
   * its lower half, even though the tag had room. Nothing below clips a text
   * line any more — only the head box as a whole, and only past its edge.
   */
  .head {
    width: ${head}mm; height: 14.4mm; padding: 0.9mm 1.5mm 0;
    display: flex; flex-direction: column; overflow: hidden;
  }
  .bc { line-height: 0; height: 5mm; flex: none; }
  .bc svg { width: 100%; height: 5mm; display: block; }
  /*
   * The company mark goes on the blank stretch straight after the head, centred
   * in a panel only as wide as that stretch. The tag is folded at the head's
   * edge, so that panel becomes the BACK of the printed face and the mark lands
   * in the middle of it. The barcode and text keep the whole front to themselves.
   *
   *     8.6 mark · 0.3 · 2.6 name = 11.5, centred in the 14.4 box
   *
   * The name is 28 mm wide at 6 pt, so on the usual 30 mm panel it is set a
   * touch smaller — it must never reach the panel's edge, because past that
   * edge is the tail.
   */
  .back {
    position: absolute; left: ${head}mm; top: 0; width: ${back}mm; height: 14.4mm;
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    overflow: hidden; background: #fff;
  }
  .shop-logo { display: block; height: ${back >= 26 ? 8.6 : 11}mm; width: auto; flex: none; }
  .back b { display: block; margin-top: .3mm; height: 2.6mm; line-height: 2.6mm;
            font-size: ${back >= 34 ? 6 : 5.5}pt; letter-spacing: ${back >= 34 ? 0.15 : 0.08}mm;
            font-weight: 700; white-space: nowrap;
            font-family: Georgia, "Times New Roman", serif; }
  /* The lines themselves never clip: a long name runs on to the right and is
     cut by the head box at its edge, but a descender is never cut. */
  .l1, .l2 { flex: none; white-space: nowrap; display: flex; align-items: center; }
  .l1 { height: 3.5mm; margin-top: 0.2mm; font-size: 9pt; font-weight: 700; line-height: 1.15;
        font-family: "Segoe UI", Arial, sans-serif; }
  .l2 { height: 3.7mm; margin-top: 0.2mm; font-size: 9.5pt; font-weight: 700; line-height: 1.15;
        font-family: Consolas, "Segoe UI", monospace; }
  /* a short head cannot hold the full-size lines */
  .l1 { font-size: ${head < 45 ? 7 : 9}pt; } .l2 { font-size: ${head < 45 ? 7.5 : 9.5}pt; }
  @media print { .tag { background: none; } }
</style>
${cells}`
}

/** Build a printable page of barcode labels. */
export function labelSheetHtml(tags: LabelTag[], opts: LabelOptions = {}): string {
  const {
    size = 'tsc-100x15', showItem = true, showGross = true, showNet = false,
    showPurity = true, shopName = '', showLogo = true, skip = 0, copies = 1, headMm = 50,
    backMm = 30,
  } = opts
  const S = SHEET[size] ?? SHEET['tsc-100x15']

  const expanded: (LabelTag | null)[] = []
  for (let i = 0; i < skip; i++) expanded.push(null)
  for (const t of tags) for (let c = 0; c < copies; c++) expanded.push(t)

  if (size === 'tsc-100x15') {
    return tscTagHtml(expanded, {
      showItem, showGross, showNet, showPurity, shopName, showLogo, headMm, backMm,
    })
  }

  // Smaller labels cannot carry as much text.
  const compact = size === 'roll' || size === 'a4-65'
  const barH = compact ? 22 : 30
  const mod = compact ? 1.1 : 1.5

  const cells = expanded.map((t) => {
    if (!t) return `<div class="lb blank"></div>`
    const line1 = [
      showItem && (t.item_name || ''),
      showPurity && t.purity ? `${Number(t.purity).toFixed(1)}%` : '',
    ].filter(Boolean).join(' · ')
    const line2 = [
      showGross ? `G ${wt3(t.gross_wt)}` : '',
      showNet ? `N ${wt3(t.net_wt)}` : '',
    ].filter(Boolean).join('  ')

    return `<div class="lb">
      ${shopName && !compact ? `<div class="shop">${escapeXml(shopName)}</div>` : ''}
      ${line1 ? `<div class="l1">${escapeXml(line1)}</div>` : ''}
      <div class="bc">${barcodeSvg(t.tag, { moduleWidth: mod, height: barH, fontSize: compact ? 6 : 7 })}</div>
      ${line2 ? `<div class="l2">${escapeXml(line2)}</div>` : ''}
    </div>`
  }).join('')

  return `<!doctype html>
<meta charset="utf-8"><title>Barcode labels</title>
<style>
  ${S.page}
  * { box-sizing: border-box; }
  body { margin: 0; font-family: "Segoe UI", Arial, sans-serif; -webkit-print-color-adjust: exact; }
  .sheet {
    display: grid;
    grid-template-columns: repeat(${S.cols}, ${S.w}mm);
    column-gap: ${S.gapX}mm; row-gap: ${S.gapY}mm;
  }
  .lb {
    width: ${S.w}mm; height: ${S.h}mm;
    padding: ${S.padY}mm ${S.padX}mm;
    display: flex; flex-direction: column;
    align-items: center; justify-content: center;
    overflow: hidden; break-inside: avoid;
  }
  .lb.blank { visibility: hidden; }
  .shop { font-size: 5.5pt; font-weight: 700; line-height: 1; margin-bottom: .4mm; }
  .l1 { font-size: ${compact ? 5 : 6.5}pt; font-weight: 600; line-height: 1;
        white-space: nowrap; overflow: hidden; }
  .l2 { font-size: ${compact ? 5 : 6.5}pt; line-height: 1; margin-top: .3mm;
        font-family: Consolas, monospace; }
  .bc { line-height: 0; margin: .3mm 0; }
  .bc svg { max-width: ${S.w - S.padX * 2}mm; height: auto; display: block; }
</style>
<div class="sheet">${cells}</div>`
}
