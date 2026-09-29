import React, { useState } from 'react'
import { Icon } from '../lib/icons'
import { Check, Empty, Field, Input, Modal, useAction, useAsync } from '../lib/ui'
import { dmy } from '../lib/format'

const REDIRECT_NOTE = 'http://127.0.0.1 (any port)'

const fmtWhen = (iso?: string) => {
  if (!iso) return 'Never'
  const d = new Date(iso)
  return `${dmy(iso.slice(0, 10))} at ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

const fmtSize = (b: number) =>
  b > 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.round(b / 1024)} KB`

export default function GoogleDrive() {
  const run = useAction()
  const st = useAsync(() => window.api.gdrive.status(), [])
  const [setup, setSetup] = useState(false)
  const [guide, setGuide] = useState(false)
  const [busy, setBusy] = useState('')
  const [backups, setBackups] = useState<any[] | null>(null)

  const s = st.data
  if (!s) return null

  const connect = async () => {
    setBusy('connect')
    await run(async () => {
      const r = await window.api.gdrive.connect()
      return r
    }, 'Google Drive connected')
    setBusy('')
    st.reload()
  }

  const backupNow = async () => {
    setBusy('backup')
    const r = await run(() => window.api.gdrive.backupNow(), 'Backup uploaded to Google Drive')
    setBusy('')
    if (r) { st.reload(); if (backups) loadBackups() }
  }

  const loadBackups = async () => {
    const r = await run(() => window.api.gdrive.listBackups())
    if (r) setBackups(r)
  }

  return (
    <div className="card" style={{ marginTop: 14 }}>
      <div className="card-head">
        <span className="card-title">Google Drive Backup</span>
        {s.connected ? (
          <span className="badge badge-ok" style={{ marginLeft: 'auto' }}>Connected</span>
        ) : (
          <span className="badge badge-mute" style={{ marginLeft: 'auto' }}>Not connected</span>
        )}
      </div>

      <div className="card-body">
        {!s.encryptionAvailable && (
          <div className="login-error" style={{ marginBottom: 14 }}>
            <Icon.alert width={15} height={15} />
            This computer cannot encrypt saved credentials, so Google Drive cannot be
            connected safely here.
          </div>
        )}

        {/* ── Step 1: your own Google credentials ── */}
        {!s.configured ? (
          <>
            <p className="small muted" style={{ marginBottom: 12, maxWidth: 620 }}>
              Backing up to Google Drive uses <strong>your own</strong> Google account and
              your own free Google Cloud project, so nobody else — including us — can
              reach your data. It takes about five minutes to set up once.
            </p>
            <div className="row" style={{ gap: 9 }}>
              <button className="btn btn-primary" onClick={() => setGuide(true)}>
                <Icon.info /> Show me how
              </button>
              <button className="btn" onClick={() => setSetup(true)}>
                I already have a Client ID
              </button>
            </div>
          </>
        ) : !s.connected ? (
          <>
            <p className="small muted" style={{ marginBottom: 12 }}>
              Credentials saved. Now sign in with the Google account that should hold the
              backups — your browser will open.
            </p>
            <div className="row" style={{ gap: 9 }}>
              <button className="btn btn-primary" disabled={busy === 'connect' || !s.encryptionAvailable}
                onClick={connect}>
                {busy === 'connect' ? <span className="spinner" /> : <Icon.check />}
                {busy === 'connect' ? 'Waiting for Google…' : 'Connect Google Drive'}
              </button>
              <button className="btn" onClick={() => setSetup(true)}>Change credentials</button>
              <button className="btn btn-ghost btn-sm" onClick={() => setGuide(true)}>Setup help</button>
            </div>
            {busy === 'connect' && (
              <p className="small muted" style={{ marginTop: 10 }}>
                A Google sign-in page has opened in your browser. Choose your account and
                press Allow, then come back here.
              </p>
            )}
          </>
        ) : (
          <>
            {/* ── Connected ── */}
            <div className="form-grid cols-3" style={{ marginBottom: 16 }}>
              <div>
                <div className="small muted">Google account</div>
                <div className="strong">{s.email || 'Connected'}</div>
              </div>
              <div>
                <div className="small muted">Last backup</div>
                <div className="strong">{fmtWhen(s.lastBackupAt)}</div>
              </div>
              <div>
                <div className="small muted">Folder in Drive</div>
                <div className="strong small">{s.folderName}</div>
              </div>
            </div>

            <div className="row wrap" style={{ gap: 9, marginBottom: 14 }}>
              <button className="btn btn-primary" onClick={backupNow} disabled={busy === 'backup'}>
                {busy === 'backup' ? <span className="spinner" /> : <Icon.download />}
                {busy === 'backup' ? 'Uploading…' : 'Back Up Now'}
              </button>
              <button className="btn" onClick={() => window.api.gdrive.openFolder()}>
                Open Drive folder
              </button>
              <button className="btn" onClick={loadBackups}>
                {backups ? 'Refresh list' : 'Show backups in Drive'}
              </button>
              <span className="spacer" style={{ marginLeft: 'auto' }} />
              <button className="btn btn-danger btn-sm" onClick={async () => {
                await run(() => window.api.gdrive.disconnect(), 'Disconnected from Google Drive')
                setBackups(null)
                st.reload()
              }}>Disconnect</button>
            </div>

            <Check
              label="Back up automatically once a day when the app opens"
              checked={s.autoDaily}
              onChange={async (v) => {
                await run(() => window.api.gdrive.setAutoDaily({ enabled: v }),
                  v ? 'Daily backup switched on' : 'Daily backup switched off')
                st.reload()
              }} />

            <p className="small muted" style={{ marginTop: 8 }}>
              The newest {s.keepBackups} backups are kept in Drive; older ones are removed
              automatically so your Drive does not fill up.
            </p>

            {backups && (
              <div className="table-wrap" style={{ border: '1px solid var(--line)', marginTop: 14 }}>
                {backups.length === 0 ? (
                  <Empty icon={Icon.download} title="No backups in Drive yet">
                    Press Back Up Now to upload the first one.
                  </Empty>
                ) : (
                  <table className="data">
                    <thead><tr><th>File</th><th>Uploaded</th><th className="r">Size</th></tr></thead>
                    <tbody>
                      {backups.map((b) => (
                        <tr key={b.id}>
                          <td className="mono small">{b.name}</td>
                          <td>{fmtWhen(b.createdTime)}</td>
                          <td className="r num">{fmtSize(b.size)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            )}
          </>
        )}
      </div>

      {setup && <Credentials current={s.clientId} onClose={() => setSetup(false)}
        onSaved={() => { setSetup(false); st.reload() }} />}
      {guide && <SetupGuide onClose={() => setGuide(false)}
        onReady={() => { setGuide(false); setSetup(true) }} />}
    </div>
  )
}

/* ───────────────────────────── credentials form ───────────────────────────── */

function Credentials({ current, onClose, onSaved }: {
  current?: string; onClose: () => void; onSaved: () => void
}) {
  const run = useAction()
  const [clientId, setClientId] = useState(current || '')
  const [clientSecret, setClientSecret] = useState('')

  const save = async () => {
    const ok = await run(
      () => window.api.gdrive.saveCredentials({ clientId, clientSecret }),
      'Credentials saved'
    )
    if (ok !== undefined) onSaved()
  }

  return (
    <Modal title="Google Credentials" onClose={onClose}
      footer={<>
        <span className="spacer" />
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" onClick={save}><Icon.save /> Save</button>
      </>}>
      <p className="small muted" style={{ marginBottom: 14 }}>
        Paste the Client ID and Client Secret from the OAuth client you created in your
        Google Cloud project.
      </p>
      <div className="form-grid" style={{ gap: 13 }}>
        <Field label="Client ID" required hint="Ends in .apps.googleusercontent.com">
          <Input value={clientId} autoFocus placeholder="1234567890-abcdef.apps.googleusercontent.com"
            onChange={(e) => setClientId(e.target.value.trim())} />
        </Field>
        <Field label="Client Secret" required hint="Stored encrypted using Windows' own keystore">
          <input className="input" type="password" value={clientSecret}
            placeholder="GOCSPX-…"
            onChange={(e) => setClientSecret(e.target.value.trim())} />
        </Field>
      </div>
    </Modal>
  )
}

/* ───────────────────────────── setup guide ───────────────────────────── */

function SetupGuide({ onClose, onReady }: { onClose: () => void; onReady: () => void }) {
  return (
    <Modal wide title="Connecting Google Drive — one-time setup" onClose={onClose}
      footer={<>
        <span className="spacer" />
        <button className="btn" onClick={onClose}>Close</button>
        <button className="btn btn-primary" onClick={onReady}>I have my Client ID</button>
      </>}>
      <p className="small muted" style={{ marginBottom: 16 }}>
        Google requires every application that touches Drive to be registered. Doing this
        yourself means the backups sit in <strong>your</strong> Drive under
        <strong> your</strong> control. It is free and only needs doing once.
      </p>

      <ol className="steps" style={{ fontSize: 13.5 }}>
        <li>
          Open <span className="mono">console.cloud.google.com</span> and sign in with the
          Google account that should hold the backups.
        </li>
        <li>
          Create a new project — call it anything, for example
          <span className="mono"> Parivar Backup</span>.
        </li>
        <li>
          Go to <strong>APIs &amp; Services → Library</strong>, search for
          <strong> Google Drive API</strong> and press <strong>Enable</strong>.
        </li>
        <li>
          Go to <strong>APIs &amp; Services → OAuth consent screen</strong>. Choose
          <strong> External</strong>, fill in an app name and your email, and save.
        </li>
        <li>
          Still on the consent screen, set the publishing status to
          <strong> In production</strong>.
          <div className="hint" style={{ marginTop: 3 }}>
            Important: while it is left in "Testing", Google expires the connection every
            7 days and you would have to reconnect constantly.
          </div>
        </li>
        <li>
          Go to <strong>Credentials → Create Credentials → OAuth client ID</strong>.
          Choose application type <strong>Desktop app</strong> and press Create.
        </li>
        <li>
          Copy the <strong>Client ID</strong> and <strong>Client Secret</strong> it shows
          you, then press the button below and paste them in.
        </li>
      </ol>

      <div style={{
        background: 'var(--gold-soft)', border: '1px solid var(--gold-line)',
        borderRadius: 'var(--radius)', padding: '11px 14px', marginTop: 6,
      }}>
        <div className="strong small" style={{ color: 'var(--gold-ink)', marginBottom: 4 }}>
          What this app can and cannot see
        </div>
        <ul className="small muted" style={{ margin: 0, paddingLeft: 16 }}>
          <li>It can only create and manage <strong>its own backup files</strong>
              (Google calls this the <span className="mono">drive.file</span> scope).</li>
          <li>It <strong>cannot</strong> read, list or change anything else in your Drive.</li>
          <li>Redirect address used during sign-in: <span className="mono">{REDIRECT_NOTE}</span>.</li>
          <li>You can revoke access any time at
              <span className="mono"> myaccount.google.com/permissions</span>.</li>
        </ul>
      </div>

      <div className="tip" style={{ marginTop: 14, fontSize: 12.5 }}>
        <b>Simpler alternative, no setup at all</b>
        Install <strong>Google Drive for Desktop</strong>, then use the ordinary
        <strong> Create Backup</strong> button above and save into your Google Drive
        folder. It syncs to the cloud by itself. You lose the one-click and daily-automatic
        upload, but there is nothing to configure.
      </div>
    </Modal>
  )
}
