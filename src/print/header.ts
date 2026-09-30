/* ───────────────────────── Invoice header designs ─────────────────────────
   The shop header at the top of the A4 bill. "Standard" is the original
   centred logo + name + address, printed byte-for-byte as before. The two
   other styles copy a printed Indian bill-book: a full-width band that is
   either one pre-designed banner image, or a colour / image background with
   the shop's own lines drawn on top. Everything lives inside invoice_config,
   so the preview, Test Print and every real bill run the same renderer. */

export type HeaderAlign = 'left' | 'center' | 'right'
export type HeaderLine = { show: boolean; color: string; size: number; align: HeaderAlign }
export type HeaderDesign = {
  style: 'standard' | 'image' | 'banner'
  /** Band height in millimetres; the standard header sizes itself. */
  height: number
  background: string
  /** An uploaded picture as a data URL, kept in the setting like the rest of the design. */
  image: string
  fit: 'cover' | 'contain' | 'stretch'
  logo: HeaderAlign | 'hidden'
  tagline: string
  name: HeaderLine
  taglineLine: HeaderLine
  address: HeaderLine
  contact: HeaderLine
}

export const HEADER_LIMITS = { height: [15, 90], size: [6, 60] } as const

export const DEFAULT_HEADER: HeaderDesign = {
  style: 'standard',
  height: 38,
  background: '#7A1F2B',
  image: '',
  fit: 'cover',
  logo: 'left',
  tagline: '',
  name: { show: true, color: '#F6D98B', size: 30, align: 'center' },
  taglineLine: { show: true, color: '#FFFFFF', size: 12, align: 'center' },
  address: { show: true, color: '#FFFFFF', size: 10, align: 'center' },
  contact: { show: true, color: '#FFFFFF', size: 10, align: 'center' },
}

const COLOR = /^#[0-9a-f]{6}$/i
// Only a real base64 picture may reach the src attribute; anything else is dropped.
const IMAGE = /^data:image\/(png|jpe?g|webp|gif);base64,[A-Za-z0-9+/=]+$/
const ALIGNS = ['left', 'center', 'right']
const clamp = (v: any, [min, max]: readonly [number, number], fallback: number) =>
  Number.isFinite(Number(v)) && v !== '' && v != null ? Math.max(min, Math.min(max, Number(v))) : fallback

function line(raw: any, base: HeaderLine): HeaderLine {
  const l = raw && typeof raw === 'object' ? raw : {}
  return {
    show: l.show == null ? base.show : !!l.show,
    color: COLOR.test(l.color) ? l.color : base.color,
    size: clamp(l.size, HEADER_LIMITS.size, base.size),
    align: ALIGNS.includes(l.align) ? l.align : base.align,
  }
}

/** A saved header, repaired field by field so a bad value never breaks a bill. */
export function normalizeHeader(raw: any): HeaderDesign {
  const h = raw && typeof raw === 'object' ? raw : {}
  const d = DEFAULT_HEADER
  return {
    style: ['standard', 'image', 'banner'].includes(h.style) ? h.style : d.style,
    height: clamp(h.height, HEADER_LIMITS.height, d.height),
    background: h.background === '' || COLOR.test(h.background) ? h.background : d.background,
    image: typeof h.image === 'string' && IMAGE.test(h.image) ? h.image : '',
    fit: ['cover', 'contain', 'stretch'].includes(h.fit) ? h.fit : d.fit,
    logo: [...ALIGNS, 'hidden'].includes(h.logo) ? h.logo : d.logo,
    tagline: String(h.tagline ?? ''),
    name: line(h.name, d.name),
    taglineLine: line(h.taglineLine, d.taglineLine),
    address: line(h.address, d.address),
    contact: line(h.contact, d.contact),
  }
}

const esc = (s: any) =>
  String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!))

/**
 * The band for the image and banner styles, or '' when the standard header
 * should print. The "TAX INVOICE" line always follows under the band.
 */
export function headerBandHtml(raw: HeaderDesign | undefined, c: any, title: string, logoSrc: string) {
  const h = normalizeHeader(raw)
  // An image-only header with nothing uploaded yet keeps the shop's name on the bill.
  if (h.style === 'standard' || (h.style === 'image' && !h.image)) return ''
  const fit = h.fit === 'stretch' ? 'fill' : h.fit
  const picture = h.image
    ? `<img class="hd-bg" src="${h.image}" alt="" style="object-fit:${fit}">`
    : ''
  const titleLine = `<div class="ti" style="text-align:center;padding:2px 8px 3px">${esc(title)}</div>`
  if (h.style === 'image') {
    return `<div class="hd-band" style="height:${h.height}mm">${picture}</div>\n    ${titleLine}`
  }
  const text = (l: HeaderLine, cls: string, value: string) => l.show && value
    ? `<div class="${cls}" style="color:${l.color};font-size:${l.size}px;text-align:${l.align}">${esc(value)}</div>`
    : ''
  const contact = [c?.phone ? `Contact No.: ${c.phone}` : '', c?.gstin ? `GST No: ${c.gstin}` : ''].filter(Boolean).join('  |  ')
  // The logo can never be taller than the band, less its padding.
  // A centred logo shares the height with the text stacked under it.
  const logoMax = Math.max(8, (h.height - 6) * (h.logo === 'center' ? 0.45 : 1))
  const logo = h.logo === 'hidden' ? ''
    : `<img class="hd-logo" src="${logoSrc}" alt="Parivar Jewellers" style="max-height:${logoMax}mm">`
  const lines = `${h.logo === 'center' ? logo : ''}
      ${text(h.name, 'hd-name', c?.name || 'Demo')}
      ${text(h.taglineLine, 'hd-tag', h.tagline)}
      ${text(h.address, 'hd-line', c?.address || '')}
      ${text(h.contact, 'hd-line', contact)}`
  return `<div class="hd-band" style="height:${h.height}mm;background:${h.background || 'transparent'}">
    ${picture}
    <div class="hd-over">
      ${h.logo === 'left' ? logo : ''}
      <div class="hd-text">${lines}</div>
      ${h.logo === 'right' ? logo : ''}
    </div>
  </div>
    ${titleLine}`
}

/** Styles for the band, added to the sheet only when a band is printed. */
export const HEADER_CSS = `
  .hd-band { position: relative; overflow: hidden; break-inside: avoid; border-bottom: 1px solid #000; }
  .hd-bg { position: absolute; inset: 0; width: 100%; height: 100%; }
  .hd-over { position: relative; display: flex; align-items: center; gap: 4mm; height: 100%; padding: 3mm 5mm; }
  .hd-text { flex: 1; min-width: 0; display: flex; flex-direction: column; justify-content: center; gap: 1px; }
  .hd-text .hd-logo { align-self: center; margin-bottom: 1mm; }
  .hd-logo { display: block; width: auto; max-width: 40mm; object-fit: contain; }
  .hd-name { font-weight: 700; letter-spacing: .5px; line-height: 1.1; }
  .hd-tag { font-style: italic; line-height: 1.2; }
  .hd-line { line-height: 1.3; }
  .hd-name, .hd-tag, .hd-line { overflow-wrap: anywhere; }`
