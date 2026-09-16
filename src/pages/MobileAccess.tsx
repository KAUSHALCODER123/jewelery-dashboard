import React, { useEffect, useState } from 'react'
import { Icon } from '../lib/icons'
import { Check, Field, Input, useAction, useAsync } from '../lib/ui'

/**
 * Settings → Mobile View. Switches the read-only phone server on or off and
 * shows the address / QR a phone on the shop Wi-Fi opens. Owner only — the
 * main process refuses these channels for anyone else.
 */
export default function MobileAccess() {
  const run = useAction()
  const st = useAsync(() => window.api.mobile.status(), [])
  const [qr, setQr] = useState<string | null>(null)
  const [port, setPort] = useState('')
  const [busy, setBusy] = useState(false)

  const s = st.data
  useEffect(() => { if (s) setPort(String(s.port)) }, [s?.port])
  useEffect(() => {
    let live = true
    if (s?.running) window.api.mobile.qr().then((svg) => { if (live) setQr(svg) })
    else setQr(null)
    return () => { live = false }
  }, [s?.running, s?.primaryUrl])

  if (!s) return null

  const toggle = async (enabled: boolean) => {
    setBusy(true)
    await run(() => window.api.mobile.setEnabled({ enabled }),
      enabled ? 'Mobile view is on' : 'Mobile view is off')
    setBusy(false)
    st.reload()
  }

  const savePort = async () => {
    setBusy(true)
    const r = await run(() => window.api.mobile.setPort({ port: Number(port) }), 'Port changed')
    setBusy(false)
    if (r) st.reload()
  }

  return (
    <div className="card">
      <div className="card-head">
        <span className="card-title">Mobile View</span>
        {s.running ? (
          <span className="badge badge-ok" style={{ marginLeft: 'auto' }}>On · {s.sessions} phone{s.sessions === 1 ? '' : 's'} signed in</span>
        ) : (
          <span className="badge badge-mute" style={{ marginLeft: 'auto' }}>Off</span>
        )}
      </div>
      <div className="card-body">
        <p className="small muted" style={{ maxWidth: 560, marginBottom: 12 }}>
          See today's sales, stock, khata, day book and dues on a phone that is on the
          <strong> same Wi-Fi as this computer</strong>. It is read-only: nothing can be
          entered, changed or deleted from a phone. Staff sign in with the same login
          they use here, and a disabled login cannot see anything.
        </p>

        <Check checked={s.enabled} onChange={toggle} label="Turn on mobile view" />
        {busy && <span className="spinner" style={{ marginLeft: 8 }} />}

        {s.error && (
          <div className="small" style={{ marginTop: 12, color: 'var(--danger)' }}>{s.error}</div>
        )}

        {s.running && (
          <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', marginTop: 18, alignItems: 'flex-start' }}>
            {qr && (
              <div
                style={{ background: '#fff', padding: 8, borderRadius: 8, border: '1px solid var(--line)', width: 236 }}
                dangerouslySetInnerHTML={{ __html: qr }}
              />
            )}
            <div style={{ flex: 1, minWidth: 260 }}>
              <div className="label">Open this on the phone</div>
              <div className="mono" style={{ fontSize: 20, fontWeight: 600, margin: '4px 0 10px' }}>
                {s.primaryUrl}
              </div>
              <p className="small muted" style={{ marginBottom: 8 }}>
                Scan the code with the phone camera, or type the address into the phone's
                browser. Then sign in. Add it to the home screen for one-tap access.
              </p>
              {s.urls.length > 1 && (
                <>
                  <div className="label">Other addresses on this computer</div>
                  <ul className="small muted" style={{ margin: '4px 0 10px', paddingLeft: 18 }}>
                    {s.urls.slice(1).map((u: any) => (
                      <li key={u.address} className="mono">{u.url} <span style={{ opacity: .7 }}>({u.name})</span></li>
                    ))}
                  </ul>
                </>
              )}
              <div className="small muted" style={{ marginTop: 8, padding: '10px 12px', background: 'var(--surface-3)', borderRadius: 8 }}>
                <strong>First time:</strong> Windows will ask whether to allow
                "Parivar Jewellery ERP" on private networks. Choose <strong>Allow</strong>,
                otherwise phones cannot connect. If the phone still cannot open the page,
                check both are on the same Wi-Fi and that the router does not isolate
                clients ("AP isolation").
              </div>
            </div>
          </div>
        )}

        <div className="divider" style={{ margin: '18px 0 12px' }} />
        <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <Field label="Port" hint="Change only if another program already uses this one">
            <Input value={port} onChange={(e) => setPort(e.target.value)} style={{ width: 120 }} inputMode="numeric" />
          </Field>
          <button className="btn" onClick={savePort} disabled={busy || String(s.port) === port}>
            <Icon.check /> Apply
          </button>
        </div>
      </div>
    </div>
  )
}
