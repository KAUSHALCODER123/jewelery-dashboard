import React from 'react'

const S = (p: any) => ({
  width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none',
  stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const, ...p,
})

export const Icon = {
  dashboard: (p: any) => (<svg {...S(p)}><rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/></svg>),
  item: (p: any) => (<svg {...S(p)}><path d="M6 3h12l3 6-9 12L3 9z"/><path d="M3 9h18M9 3l3 6 3-6M12 9v12"/></svg>),
  tag: (p: any) => (<svg {...S(p)}><path d="M20.6 13.4 12 22l-9-9V4a1 1 0 0 1 1-1h9z"/><circle cx="7.5" cy="7.5" r="1.5"/></svg>),
  invoice: (p: any) => (<svg {...S(p)}><path d="M5 3h14v18l-3-2-2 2-2-2-2 2-2-2-3 2z"/><path d="M9 8h6M9 12h6"/></svg>),
  cart: (p: any) => (<svg {...S(p)}><circle cx="9" cy="20" r="1.4"/><circle cx="18" cy="20" r="1.4"/><path d="M2 3h3l2.6 12.1a2 2 0 0 0 2 1.6h7.8a2 2 0 0 0 2-1.6L21 7H6"/></svg>),
  users: (p: any) => (<svg {...S(p)}><path d="M16 20v-1.5a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4V20"/><circle cx="9" cy="7" r="3.4"/><path d="M22 20v-1.5a4 4 0 0 0-3-3.85M16.5 3.6a4 4 0 0 1 0 6.8"/></svg>),
  receipt: (p: any) => (<svg {...S(p)}><path d="M4 3h16v18l-2.7-1.8L14.6 21l-2.6-1.8L9.4 21l-2.7-1.8L4 21z"/><path d="M8.5 8.5h7M8.5 13h4"/></svg>),
  stock: (p: any) => (<svg {...S(p)}><path d="M21 8v9.2a1 1 0 0 1-.6.9l-7.8 3.4a1.5 1.5 0 0 1-1.2 0l-7.8-3.4a1 1 0 0 1-.6-.9V8"/><path d="m2.6 7.3 8.8-3.9a1.5 1.5 0 0 1 1.2 0l8.8 3.9-9.4 4.2z"/><path d="M12 11.5V21"/></svg>),
  book: (p: any) => (<svg {...S(p)}><path d="M4 4.5A2.5 2.5 0 0 1 6.5 2H20v18H6.5A2.5 2.5 0 0 0 4 22z"/><path d="M4 17.5A2.5 2.5 0 0 1 6.5 15H20"/></svg>),
  ledger: (p: any) => (<svg {...S(p)}><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M12 3v18M3 9h18"/></svg>),
  refine: (p: any) => (<svg {...S(p)}><path d="M10 2v6.5L4.5 18A2 2 0 0 0 6.2 21h11.6a2 2 0 0 0 1.7-3L14 8.5V2"/><path d="M8.5 2h7M7 14h10"/></svg>),
  order: (p: any) => (<svg {...S(p)}><path d="M9 3h6a1 1 0 0 1 1 1v2H8V4a1 1 0 0 1 1-1z"/><rect x="4" y="6" width="16" height="15" rx="2"/><path d="M9 12h6M9 16h4"/></svg>),
  chart: (p: any) => (<svg {...S(p)}><path d="M3 3v16.5a1.5 1.5 0 0 0 1.5 1.5H21"/><path d="m7 15 3.5-4 3 2.5L20 7"/></svg>),
  balance: (p: any) => (<svg {...S(p)}><path d="M12 3v18"/><path d="M6 21h12"/><path d="M3 7h18"/><path d="M7 7 4 13a3 3 0 0 0 6 0z"/><path d="M17 7l-3 6a3 3 0 0 0 6 0z"/></svg>),
  gear: (p: any) => (<svg {...S(p)}><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-2.9 1.2v.2a2 2 0 1 1-4 0v-.1A1.7 1.7 0 0 0 7 19.4a1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0-1.2-2.9H1a2 2 0 1 1 0-4h.1A1.7 1.7 0 0 0 2.6 7a1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H7a1.7 1.7 0 0 0 1-1.5V1a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9V7a1.7 1.7 0 0 0 1.5 1H23a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" transform="translate(0.5,0.5) scale(0.92)"/></svg>),
  plus: (p: any) => (<svg {...S(p)}><path d="M12 5v14M5 12h14"/></svg>),
  search: (p: any) => (<svg {...S(p)}><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>),
  save: (p: any) => (<svg {...S(p)}><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><path d="M17 21v-8H7v8M7 3v5h8"/></svg>),
  print: (p: any) => (<svg {...S(p)}><path d="M6 9V3h12v6"/><rect x="3" y="9" width="18" height="8" rx="2"/><path d="M6 15h12v6H6z"/></svg>),
  trash: (p: any) => (<svg {...S(p)}><path d="M3 6h18M8 6V4h8v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>),
  close: (p: any) => (<svg {...S(p)}><path d="M18 6 6 18M6 6l12 12"/></svg>),
  check: (p: any) => (<svg {...S(p)}><path d="M20 6 9 17l-5-5"/></svg>),
  alert: (p: any) => (<svg {...S(p)}><circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16.5v.01"/></svg>),
  info: (p: any) => (<svg {...S(p)}><circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 7.5v.01"/></svg>),
  download: (p: any) => (<svg {...S(p)}><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5M12 15V3"/></svg>),
  upload: (p: any) => (<svg {...S(p)}><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 8 5-5 5 5M12 3v12"/></svg>),
  back: (p: any) => (<svg {...S(p)}><path d="M19 12H5M12 19l-7-7 7-7"/></svg>),
  edit: (p: any) => (<svg {...S(p)}><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.1 2.1 0 0 1 3 3L12 15l-4 1 1-4z"/></svg>),
  moon: (p: any) => (<svg {...S(p)}><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>),
  sun: (p: any) => (<svg {...S(p)}><circle cx="12" cy="12" r="4.2"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>),
  menu: (p: any) => (<svg {...S(p)}><path d="M3 6h18M3 12h18M3 18h18"/></svg>),
  columns: (p: any) => (<svg {...S(p)}><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16M15 4v16"/></svg>),
  report: (p: any) => (<svg {...S(p)}><path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/></svg>),
  up: (p: any) => (<svg {...S(p)}><path d="m6 15 6-6 6 6"/></svg>),
  down: (p: any) => (<svg {...S(p)}><path d="m6 9 6 6 6-6"/></svg>),
  whatsapp: (p: any) => (<svg {...S(p)}><path d="M21 11.5a8.4 8.4 0 0 1-12.6 7.3L3 20.5l1.8-5.2A8.4 8.4 0 1 1 21 11.5z"/><path d="M8.8 8.4c.3-.6.6-.5.9-.5h.6c.2 0 .5 0 .7.5l.7 1.7c.1.3 0 .5-.1.7l-.4.4c-.1.2-.3.3-.1.6a6 6 0 0 0 2.8 2.4c.3.1.5.1.7-.1l.5-.6c.2-.2.4-.2.6-.1l1.6.8c.3.1.4.3.4.5a1.9 1.9 0 0 1-1.3 1.6c-.5.2-1.1.2-3.2-.7a9.3 9.3 0 0 1-4.2-4.2c-.5-1-.5-1.7-.4-2.2a2 2 0 0 1 .5-1z"/></svg>),
  gem: (p: any) => (<svg {...S(p)}><path d="M6 3h12l3 6-9 12L3 9z"/><path d="M3 9h18M9 3l3 6 3-6M12 9v12"/></svg>),
}

export type IconName = keyof typeof Icon

/**
 * The app mark — same brilliant-cut gem as build/icon.ico, drawn as SVG so it
 * stays crisp at any size in the UI.
 */
export function Logo({ size = 28, rounded = true }: { size?: number; rounded?: boolean }) {
  const id = React.useId()
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <defs>
        <linearGradient id={`g${id}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#F2D882" />
          <stop offset="48%" stopColor="#D4AF37" />
          <stop offset="100%" stopColor="#9E791C" />
        </linearGradient>
      </defs>
      {rounded && <rect width="24" height="24" rx="5.4" fill={`url(#g${id})`} />}
      <g transform="translate(12 12) scale(0.63) translate(-12 -12)">
        <path d="M6 3h12l3 6-9 12L3 9z" fill="#fff" stroke="#967316"
          strokeWidth="1.6" strokeLinejoin="round" />
        <path d="M3 9h18M9 3l3 6 3-6M12 9v12" fill="none" stroke="#967316"
          strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      </g>
    </svg>
  )
}
