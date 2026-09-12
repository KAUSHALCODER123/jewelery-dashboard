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
  /** Skip this many label positions — lets you reuse a part-used sheet. */
  skip?: number
  copies?: number
  /** TSC tag only: length of the printable head in mm (the rest is the tail). */
  headMm?: number
}

const wt3 = (n: any) => (Number(n) || 0).toFixed(3)

/**
 * The 100 × 15 mm jewellery tag the shop runs on its TSC TL240.
 *
 * A rat-tail tag, not a dumbbell: only the HEAD (about 50 mm) is printable.
 * The rest is a 3 mm wide tail that wraps around the ring or chain and sticks
 * to itself, so anything printed there is lost. The whole label — barcode,
 * tag number, item and weights — is stacked inside the head, and the tail is
 * left blank on purpose.
 *
 *   ┌────────────────────────────────┬────────────────────────────────┐
 *   │ ▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌  │                                │
 *   │ RIN00012 · Ladies Ring · 91.6% │           (tail, blank)        │
 *   │ G 5.120  N 4.980               │                                │
 *   └────────────────────────────────┴────────────────────────────────┘
 *                head ≈ 50 mm                     ≈ 50 mm
 *
 * The barcode runs the full width of the head so each bar is at least three
 * printer dots wide at 203 dpi — a narrower code on this small a tag is what
 * makes a scanner miss.
 */
function tscTagHtml(
  tags: (LabelTag | null)[],
  o: Required<Omit<LabelOptions, 'size' | 'skip' | 'copies' | 'headMm'>> & { headMm: number },
): string {
  const head = Math.min(96, Math.max(30, Number(o.headMm) || 50))
  const cells = tags.map((t) => {
    if (!t) return `<div class="tag blank"></div>`
    const l1 = [
      t.tag,
      o.showItem && (t.item_name || ''),
      o.showPurity && t.purity ? `${Number(t.purity).toFixed(1)}%` : '',
    ].filter(Boolean).join(' · ')
    const l2 = [
      o.showGross ? `G ${wt3(t.gross_wt)}` : '',
      o.showNet ? `N ${wt3(t.net_wt)}` : '',
      o.shopName || '',
    ].filter(Boolean).join('   ')
    return `<div class="tag">
      <div class="head">
        <div class="bc">${barcodeSvg(t.tag, { moduleWidth: 1, height: 22, showText: false })
          // Stretch to the full head width: bars get wider in proportion, so
          // the code stays valid and every bar is several printer dots wide.
          .replace('<svg ', '<svg preserveAspectRatio="none" ')}</div>
        <div class="l1">${escapeXml(l1)}</div>
        ${l2 ? `<div class="l2">${escapeXml(l2)}</div>` : ''}
      </div>
    </div>`
  }).join('')

  return `<!doctype html>
<meta charset="utf-8"><title>Barcode labels</title>
<style>
  @page { size: 100mm 15mm; margin: 0; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body { font-family: "Segoe UI", Arial, sans-serif; -webkit-print-color-adjust: exact; }
  .tag {
    width: 100mm; height: 15mm; overflow: hidden;
    break-after: page; page-break-after: always;
    /* faint guide for the on-screen preview only: where the head ends */
    background: linear-gradient(to right, transparent ${head}mm, #eee ${head}mm, #eee 100%);
  }
  .tag:last-child { break-after: auto; page-break-after: auto; }
  .tag.blank { visibility: hidden; }
  .head {
    width: ${head}mm; height: 15mm; padding: 0.8mm 1.5mm 0.6mm;
    display: flex; flex-direction: column; justify-content: space-between; overflow: hidden;
  }
  .bc { line-height: 0; }
  .bc svg { width: 100%; height: 6mm; display: block; }
  .l1 { font-size: 6pt; font-weight: 600; line-height: 1.1; white-space: nowrap; overflow: hidden;
        font-family: Consolas, "Segoe UI", monospace; }
  .l2 { font-size: 6.5pt; font-weight: 700; line-height: 1.1; white-space: nowrap; overflow: hidden;
        font-family: Consolas, monospace; }
  @media print { .tag { background: none; } }
</style>
${cells}`
}

/** Build a printable page of barcode labels. */
export function labelSheetHtml(tags: LabelTag[], opts: LabelOptions = {}): string {
  const {
    size = 'tsc-100x15', showItem = true, showGross = true, showNet = false,
    showPurity = true, shopName = '', skip = 0, copies = 1, headMm = 50,
  } = opts
  const S = SHEET[size] ?? SHEET['tsc-100x15']

  const expanded: (LabelTag | null)[] = []
  for (let i = 0; i < skip; i++) expanded.push(null)
  for (const t of tags) for (let c = 0; c < copies; c++) expanded.push(t)

  if (size === 'tsc-100x15') {
    return tscTagHtml(expanded, { showItem, showGross, showNet, showPurity, shopName, headMm })
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
