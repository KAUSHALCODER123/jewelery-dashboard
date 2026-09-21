import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { Icon, Logo } from './lib/icons'
import { useAsync } from './lib/ui'
import { dmy, todayISO } from './lib/format'

import Dashboard from './pages/Dashboard'
import Items from './pages/Items'
import TagStock from './pages/TagStock'
import Parties from './pages/Parties'
import SalesList from './pages/SalesList'
import Returns from './pages/Returns'
import OldGold from './pages/OldGold'
import OldGoldReport from './pages/OldGoldReport'
import SalesInvoice from './pages/SalesInvoice'
import Purchase from './pages/Purchase'
import Receipts from './pages/Receipts'
import Orders from './pages/Orders'
import Refining from './pages/Refining'
import StockReport from './pages/StockReport'
import DayBook from './pages/DayBook'
import Ledger from './pages/Ledger'
import Outstanding from './pages/Outstanding'
import AccountBooks from './pages/AccountBooks'
import Registers from './pages/Registers'
import GstReports from './pages/GstReports'
import MisReports from './pages/MisReports'
import Branches from './pages/Branches'
import Changeover from './pages/Changeover'
import Settings from './pages/Settings'
import Login from './pages/Login'
import Schemes from './pages/Schemes'
import StockCheck from './pages/StockCheck'

export type Route = { name: string; params?: any }

const NAV: { group: string; items: { key: string; label: string; icon: any; kbd?: string }[] }[] = [
  {
    group: 'Overview',
    items: [{ key: 'dashboard', label: 'Dashboard', icon: Icon.dashboard }],
  },
  {
    group: 'Transactions',
    items: [
      { key: 'sales.new', label: 'Sales Invoice', icon: Icon.invoice, kbd: 'F2' },
      { key: 'sales', label: 'Sales Register', icon: Icon.book },
      { key: 'returns', label: 'Returns', icon: Icon.back },
      { key: 'oldgold', label: 'Old Gold Purchase', icon: Icon.refine },
      { key: 'purchase', label: 'Purchase', icon: Icon.cart, kbd: 'F3' },
      { key: 'receipts', label: 'Receipts', icon: Icon.receipt, kbd: 'F4' },
      { key: 'orders', label: 'Orders', icon: Icon.order, kbd: 'F5' },
      { key: 'refining', label: 'Refining', icon: Icon.refine, kbd: 'F9' },
      { key: 'schemes', label: 'Gold Scheme', icon: Icon.gem },
    ],
  },
  {
    group: 'Masters',
    items: [
      { key: 'items', label: 'Item Creation', icon: Icon.item, kbd: 'F6' },
      { key: 'tags', label: 'Tag & Barcode', icon: Icon.tag, kbd: 'F7' },
      { key: 'customers', label: 'Customers', icon: Icon.users, kbd: 'F8' },
      { key: 'suppliers', label: 'Suppliers', icon: Icon.users },
    ],
  },
  {
    group: 'Reports',
    items: [
      { key: 'stock', label: 'Stock Report', icon: Icon.stock },
      { key: 'stockcheck', label: 'Stock Verification', icon: Icon.check },
      { key: 'daybook', label: 'Day Book', icon: Icon.chart },
      { key: 'oldgold.report', label: 'Old Gold Report', icon: Icon.refine },
      { key: 'ledger', label: 'Ledger / Khata', icon: Icon.ledger },
      { key: 'outstanding', label: 'Outstanding', icon: Icon.users },
      { key: 'books', label: 'Accounting Books', icon: Icon.balance },
      { key: 'registers', label: 'Cash Book & Registers', icon: Icon.book },
      { key: 'gst', label: 'GST Reports', icon: Icon.receipt },
      { key: 'mis', label: 'MIS & Scheme Reports', icon: Icon.report },
      { key: 'branches', label: 'Branches & Transfer', icon: Icon.stock },
      { key: 'changeover', label: 'Changeover Check', icon: Icon.check },
    ],
  },
  {
    group: 'System',
    items: [{ key: 'settings', label: 'Settings', icon: Icon.gear }],
  },
]

const TITLES: Record<string, { title: string; sub?: string }> = {
  dashboard: { title: 'Dashboard' },
  'sales.new': { title: 'Sales Invoice', sub: 'Create a new bill' },
  sales: { title: 'Sales Register' },
  oldgold: { title: 'Old Gold Purchase', sub: 'Buying old gold from a customer, with no sale against it' },
  'oldgold.report': { title: 'Old Gold Report', sub: 'Every gram of old gold taken in — on sale bills and old gold bills' },
  purchase: { title: 'Purchase Invoice' },
  receipts: { title: 'Receipts & Payments' },
  orders: { title: 'Order Booking', sub: 'Karagir orders' },
  refining: { title: 'Refining', sub: 'Metal sent out and received back' },
  schemes: { title: 'Gold Saving Scheme', sub: 'Monthly savings plans' },
  stockcheck: { title: 'Stock Verification', sub: 'Scan every piece — red is missing' },
  items: { title: 'Item Creation', sub: 'Item master' },
  tags: { title: 'Tag & Barcode', sub: 'Tagged stock entry' },
  customers: { title: 'Customers', sub: 'CRM' },
  suppliers: { title: 'Suppliers' },
  stock: { title: 'Stock Report' },
  daybook: { title: 'Day Book' },
  ledger: { title: 'Ledger / Khata' },
  outstanding: { title: 'Outstanding', sub: 'Debtors & creditors — money and by weight' },
  books: { title: 'Accounting Books', sub: 'Trial Balance · P&L · Balance Sheet' },
  registers: { title: 'Cash Book & Registers', sub: 'Cash/Bank Book · Journal · Sales & Purchase books' },
  gst: { title: 'GST Reports', sub: 'GSTR-1 · GSTR-2 · GSTR-3B · HSN · TCS/TDS' },
  changeover: { title: 'Changeover Check', sub: 'Your old books against this one — run both before you switch' },
  branches: { title: 'Branches & Transfer', sub: 'Where the stock is, and moving it between shops' },
  mis: { title: 'MIS & Scheme Reports', sub: 'Non-moving · quiet customers · top sellers · purity profit · gold scheme' },
  settings: { title: 'Settings' },
}

export default function App() {
  const [user, setUser] = useState<any>(null)
  const [checking, setChecking] = useState(true)
  const [perms, setPerms] = useState<any>({})
  const [route, setRoute] = useState<Route>({ name: 'dashboard' })
  const [collapsed, setCollapsed] = useState(false)
  const [paletteOpen, setPaletteOpen] = useState(false)
  // Read the theme from localStorage, not the database — the login screen renders
  // before anyone is signed in, and every database channel requires a session.
  const [theme, setTheme] = useState<'light' | 'dark'>(
    () => (localStorage.getItem('theme') === 'dark' ? 'dark' : 'light')
  )

  // The main process is the source of truth for who is signed in — ask it, don't
  // trust anything cached in the renderer.
  useEffect(() => {
    window.api.auth.status()
      .then((s: any) => setUser(s.user ?? null))
      .catch(() => setUser(null))
      .finally(() => setChecking(false))
  }, [])

  useEffect(() => {
    if (!user) { setPerms({}); return }
    window.api.auth.permissions().then(setPerms).catch(() => setPerms({}))
  }, [user])

  const { data: company } = useAsync(
    async () => (user ? window.api.company.read() : null), [user]
  )

  const go = useCallback((name: string, params?: any) => {
    setRoute({ name, params })
    setPaletteOpen(false)
  }, [])

  useEffect(() => {
    document.documentElement.dataset.theme = theme
  }, [theme])

  // Once signed in, reconcile with the stored preference on this machine.
  useEffect(() => {
    if (!user) return
    window.api.settings.all()
      .then((s: any) => {
        if (s.theme === 'dark' || s.theme === 'light') {
          setTheme(s.theme)
          localStorage.setItem('theme', s.theme)
        }
      })
      .catch(() => {})
  }, [user])

  const toggleTheme = () => {
    const next = theme === 'light' ? 'dark' : 'light'
    setTheme(next)
    localStorage.setItem('theme', next)
    window.api.settings.set({ key: 'theme', value: next }).catch(() => {})
  }

  // Global shortcuts — the demo software was keyboard-first; keep that.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault(); setPaletteOpen((v) => !v); return
      }
      if (e.target instanceof HTMLElement &&
          ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName) && e.key !== 'Escape') return
      const map: Record<string, string> = {
        F2: 'sales.new', F3: 'purchase', F4: 'receipts', F5: 'orders',
        F6: 'items', F7: 'tags', F8: 'customers', F9: 'refining',
      }
      if (map[e.key]) { e.preventDefault(); go(map[e.key]) }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [go])

  const meta = TITLES[route.name] ?? { title: route.name }

  if (checking) {
    return (
      <div style={{ height: '100vh', display: 'grid', placeItems: 'center' }}>
        <span className="spinner" style={{ width: 26, height: 26 }} />
      </div>
    )
  }

  if (!user) {
    return <Login onSignedIn={(u) => { setUser(u); setRoute({ name: 'dashboard' }) }} />
  }

  return (
    <div className="shell" data-collapsed={collapsed}>
      <aside className="sidebar">
        <div className="brand">
          <Logo size={collapsed ? 32 : 44} />
          <div className="brand-text">
            Parivar
            <small>JEWELLERS</small>
          </div>
        </div>
        <nav className="nav">
          {NAV.map((g) => (
            <div key={g.group}>
              <div className="nav-group-label">{g.group}</div>
              {g.items.map((it) => {
                const I = it.icon
                const active =
                  route.name === it.key ||
                  (it.key === 'customers' && route.name === 'customers') ||
                  (it.key === 'sales' && route.name === 'sales.view')
                return (
                  <button
                    key={it.key}
                    className="nav-item"
                    aria-current={active ? 'page' : undefined}
                    onClick={() => go(it.key)}
                    title={it.label}
                  >
                    <I />
                    <span>{it.label}</span>
                    {it.kbd && <span className="nav-kbd">{it.kbd}</span>}
                  </button>
                )
              })}
            </div>
          ))}
        </nav>
      </aside>

      <div className="main">
        <header className="topbar">
          <button
            className="btn btn-ghost btn-icon btn-sm"
            onClick={() => setCollapsed((c) => !c)}
            aria-label="Toggle sidebar"
          >
            <Icon.menu />
          </button>
          <div>
            <div className="page-title">{meta.title}</div>
            {meta.sub && <div className="page-sub">{meta.sub}</div>}
          </div>

          <button className="search-trigger" onClick={() => setPaletteOpen(true)}>
            <Icon.search width={15} height={15} />
            Search or jump to…
            <kbd>Ctrl K</kbd>
          </button>

          <div className="row" style={{ gap: 6 }}>
            <div style={{ textAlign: 'right', marginRight: 2 }}>
              <div className="small strong">{company?.name || 'Demo'}</div>
              <div className="small muted">{dmy(todayISO())}</div>
            </div>
            <button
              className="btn btn-ghost btn-icon btn-sm"
              onClick={toggleTheme}
              aria-label="Toggle theme"
              title={theme === 'light' ? 'Dark mode' : 'Light mode'}
            >
              {theme === 'light' ? <Icon.moon /> : <Icon.sun />}
            </button>
            <UserMenu user={user} onSignOut={async () => {
              await window.api.auth.logout()
              setUser(null)
            }} go={go} />
          </div>
        </header>

        <main className="content">
          <div className="page-enter" key={route.name + JSON.stringify(route.params ?? {})}>
            <Page route={route} go={go} />
          </div>
        </main>
      </div>

      {paletteOpen && <Palette go={go} onClose={() => setPaletteOpen(false)} />}
    </div>
  )
}

function Page({ route, go }: { route: Route; go: (n: string, p?: any) => void }) {
  switch (route.name) {
    case 'dashboard': return <Dashboard go={go} />
    case 'items': return <Items />
    case 'tags': return <TagStock purchaseId={route.params?.purchaseId} />
    case 'customers': return <Parties type="CUSTOMER" key="cust" />
    case 'suppliers': return <Parties type="SUPPLIER" key="supp" />
    case 'sales': return <SalesList go={go} />
    case 'returns': return <Returns />
    case 'oldgold': return <OldGold billId={route.params?.id} />
    case 'oldgold.report': return <OldGoldReport go={go} />
    case 'sales.new': return <SalesInvoice go={go} saleId={route.params?.id} />
    case 'purchase': return <Purchase go={go} />
    case 'receipts': return <Receipts />
    case 'orders': return <Orders go={go} />
    case 'refining': return <Refining />
    case 'schemes': return <Schemes />
    case 'stockcheck': return <StockCheck />
    case 'stock': return <StockReport />
    case 'daybook': return <DayBook />
    case 'ledger': return <Ledger partyId={route.params?.partyId} />
    case 'outstanding': return <Outstanding />
    case 'books': return <AccountBooks />
    case 'registers': return <Registers />
    case 'gst': return <GstReports />
    case 'mis': return <MisReports />
    case 'branches': return <Branches />
    case 'changeover': return <Changeover />
    case 'settings': return <Settings tab={route.params?.tab} />
    default: return <div>Not found</div>
  }
}

/* ───────────────────────────── Command palette ───────────────────────────── */

function Palette({ go, onClose }: { go: (n: string, p?: any) => void; onClose: () => void }) {
  const [q, setQ] = useState('')
  const [active, setActive] = useState(0)
  const [parties, setParties] = useState<any[]>([])

  const pages = useMemo(
    () => NAV.flatMap((g) => g.items.map((i) => ({ ...i, group: g.group }))),
    []
  )

  useEffect(() => {
    if (q.length < 2) { setParties([]); return }
    let alive = true
    window.api.party
      .list({ type: 'ALL', search: q })
      .then((r: any[]) => { if (alive) setParties(r.slice(0, 6)) })
      .catch(() => {})
    return () => { alive = false }
  }, [q])

  const results = useMemo(() => {
    const needle = q.toLowerCase()
    const p = pages
      .filter((i) => !needle || i.label.toLowerCase().includes(needle))
      .map((i) => ({ kind: 'page' as const, key: i.key, label: i.label, group: i.group, icon: i.icon }))
    const c = parties.map((x) => ({
      kind: 'party' as const, key: String(x.id), label: x.name,
      group: x.party_type === 'CUSTOMER' ? 'Customer' : 'Supplier', icon: Icon.users,
    }))
    return [...p, ...c]
  }, [q, pages, parties])

  useEffect(() => setActive(0), [q])

  return (
    <div className="palette-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="palette" role="dialog" aria-modal="true" aria-label="Command palette">
        <input
          autoFocus
          value={q}
          placeholder="Search pages, customers, suppliers…"
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') onClose()
            if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(a + 1, results.length - 1)) }
            if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)) }
            if (e.key === 'Enter' && results[active]) {
              const r = results[active]
              if (r.kind === 'page') go(r.key)
              else go('ledger', { partyId: Number(r.key) })
            }
          }}
        />
        <div className="palette-list">
          {results.length === 0 ? (
            <div className="ac-empty">No results</div>
          ) : (
            results.map((r, i) => {
              const I = r.icon
              return (
                <button
                  key={r.kind + r.key}
                  className="palette-item"
                  data-active={i === active}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => (r.kind === 'page' ? go(r.key) : go('ledger', { partyId: Number(r.key) }))}
                >
                  <I />
                  {r.label}
                  <span className="grp">{r.group}</span>
                </button>
              )
            })
          )}
        </div>
      </div>
    </div>
  )
}


/* ───────────────────────────── Signed-in user menu ───────────────────────────── */

function UserMenu({ user, onSignOut, go }: {
  user: any; onSignOut: () => void; go: (n: string, p?: any) => void
}) {
  const [open, setOpen] = useState(false)
  const box = React.useRef<HTMLDivElement>(null)

  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [])

  const initials = String(user?.name || user?.username || '?')
    .split(/\s+/).slice(0, 2).map((w: string) => w[0]).join('').toUpperCase()

  return (
    <div ref={box} style={{ position: 'relative' }}>
      <button className="user-chip" onClick={() => setOpen((v) => !v)} aria-label="Account">
        <span className="user-avatar">{initials}</span>
        <span className="user-meta">
          <span className="n" style={{ display: 'block' }}>{user.name}</span>
          <span className="r">{user.role}</span>
        </span>
      </button>
      {open && (
        <div className="menu-pop">
          <div style={{ padding: '7px 10px 9px' }}>
            <div className="small strong">{user.name}</div>
            <div className="small muted">@{user.username} · <span style={{ textTransform: 'capitalize' }}>{user.role}</span></div>
          </div>
          <div className="sep" />
          <button onClick={() => { setOpen(false); go('settings', { tab: 'users' }) }}>
            <Icon.users width={15} height={15} /> Users &amp; Password
          </button>
          <div className="sep" />
          <button className="danger" onClick={() => { setOpen(false); onSignOut() }}>
            <Icon.back width={15} height={15} /> Sign out
          </button>
        </div>
      )}
    </div>
  )
}
