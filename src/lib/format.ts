/** Indian-format money, e.g. 1,23,456.78 */
export const money = (n: any, dp = 2) =>
  (Number(n) || 0).toLocaleString('en-IN', {
    minimumFractionDigits: dp,
    maximumFractionDigits: dp,
  })

/** Weights always show 3 decimals — grams matter. */
export const wt = (n: any, dp = 3) =>
  (Number(n) || 0).toLocaleString('en-IN', {
    minimumFractionDigits: dp,
    maximumFractionDigits: dp,
  })

export const num = (v: any) => (Number.isFinite(Number(v)) ? Number(v) : 0)

/** yyyy-mm-dd → dd/Mon/yyyy */
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
export function dmy(iso?: string) {
  if (!iso) return ''
  const [y, m, d] = iso.slice(0, 10).split('-')
  if (!y || !m || !d) return iso
  return `${d}/${MONTHS[Number(m) - 1] ?? m}/${y}`
}

export const todayISO = () => {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

export function monthStartISO() {
  return todayISO().slice(0, 8) + '01'
}

/** Balance with a Dr/Cr suffix, the way a jeweller reads a khata. */
export function drcr(balance: number) {
  const v = Number(balance) || 0
  if (Math.abs(v) < 0.005) return { text: '0.00', side: '', cls: '' }
  return {
    text: money(Math.abs(v)),
    side: v > 0 ? 'Dr' : 'Cr',
    cls: v > 0 ? 'dr' : 'cr',
  }
}

/** Escape a value for CSV export. */
const csvCell = (v: any) => {
  const s = v == null ? '' : String(v)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export function toCsv(headers: string[], rows: any[][]) {
  return [headers.map(csvCell).join(','), ...rows.map((r) => r.map(csvCell).join(','))].join('\n')
}
