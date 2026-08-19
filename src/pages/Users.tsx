import React, { useState } from 'react'
import { Icon } from '../lib/icons'
import {
  Confirm, Empty, Field, Input, Loading, Modal, Select,
  useAction, useAsync,
} from '../lib/ui'
import { dmy } from '../lib/format'

const ROLES = [
  { value: 'staff', label: 'Staff', hint: 'Billing, receipts and day-to-day work' },
  { value: 'manager', label: 'Manager', hint: 'Everything Staff can do, plus refining and removing tags' },
  { value: 'owner', label: 'Owner', hint: 'Full access — users, settings, deleting documents, backup' },
]

const roleBadge = (r: string) =>
  r === 'owner' ? 'badge-gold' : r === 'manager' ? 'badge-info' : 'badge-mute'

export default function Users() {
  const run = useAction()
  const me = useAsync(() => window.api.auth.status(), [])
  const perms = useAsync(() => window.api.auth.permissions(), [])
  const list = useAsync(() => window.api.auth.list(), [])
  const [adding, setAdding] = useState(false)
  const [resetting, setResetting] = useState<any>(null)
  const [removing, setRemoving] = useState<any>(null)
  const [pw, setPw] = useState({ currentPassword: '', newPassword: '', confirm: '' })

  const canManage = !!perms.data?.manage_users
  const currentUser = me.data?.user

  const changeMyPassword = async () => {
    if (pw.newPassword !== pw.confirm) {
      return run(async () => { throw new Error('The two new passwords do not match') })
    }
    const ok = await run(
      () => window.api.auth.changePassword({
        currentPassword: pw.currentPassword, newPassword: pw.newPassword,
      }),
      'Password changed'
    )
    if (ok !== undefined) {
      setPw({ currentPassword: '', newPassword: '', confirm: '' })
      me.reload()
    }
  }

  return (
    <div className="content-narrow">
      {me.data?.defaultPassword && (
        <div className="card" style={{ marginBottom: 14, borderColor: 'var(--warn)' }}>
          <div className="card-body row" style={{ gap: 10 }}>
            <Icon.alert style={{ color: 'var(--warn)', flexShrink: 0 }} />
            <div>
              <div className="strong">The admin account still uses the default password</div>
              <div className="small muted">
                Anyone who knows it can open your books. Change it below before you start
                billing.
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── My account ─────────────────────────────────────── */}
      <div className="card" style={{ marginBottom: 14 }}>
        <div className="card-head">
          <span className="card-title">My Account</span>
          {currentUser && (
            <span className={`badge ${roleBadge(currentUser.role)}`} style={{ marginLeft: 'auto' }}>
              {currentUser.role}
            </span>
          )}
        </div>
        <div className="card-body">
          {currentUser && (
            <p className="small muted" style={{ marginBottom: 14 }}>
              Signed in as <strong>{currentUser.name}</strong> (@{currentUser.username})
            </p>
          )}
          <div className="section-title">Change my password</div>
          <div className="form-grid cols-3">
            <Field label="Current password">
              <input className="input" type="password" value={pw.currentPassword}
                onChange={(e) => setPw({ ...pw, currentPassword: e.target.value })} />
            </Field>
            <Field label="New password" hint="At least 4 characters">
              <input className="input" type="password" value={pw.newPassword}
                onChange={(e) => setPw({ ...pw, newPassword: e.target.value })} />
            </Field>
            <Field label="Confirm new password">
              <input className="input" type="password" value={pw.confirm}
                onChange={(e) => setPw({ ...pw, confirm: e.target.value })} />
            </Field>
          </div>
          <button className="btn btn-primary" style={{ marginTop: 12 }}
            disabled={!pw.currentPassword || !pw.newPassword}
            onClick={changeMyPassword}>
            <Icon.save /> Change Password
          </button>
        </div>
      </div>

      {/* ── Staff list ─────────────────────────────────────── */}
      <div className="card">
        <div className="card-head">
          <span className="card-title">Staff Logins</span>
          {canManage && (
            <button className="btn btn-primary btn-sm" style={{ marginLeft: 'auto' }}
              onClick={() => setAdding(true)}>
              <Icon.plus /> Add Staff
            </button>
          )}
        </div>
        <div className="card-body flush">
          {list.loading ? <Loading rows={3} /> : !list.data?.length ? (
            <Empty icon={Icon.users} title="No logins yet" />
          ) : (
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th>Username</th><th>Name</th><th>Role</th>
                    <th>Status</th><th>Last Signed In</th><th></th>
                  </tr>
                </thead>
                <tbody>
                  {list.data.map((u: any) => {
                    const isMe = currentUser?.id === u.id
                    const isAdmin = u.username.toLowerCase() === 'admin'
                    return (
                      <tr key={u.id}>
                        <td className="mono strong">
                          {u.username}
                          {isMe && <span className="badge badge-ok" style={{ marginLeft: 6 }}>you</span>}
                        </td>
                        <td>{u.name}</td>
                        <td>
                          {canManage && !isMe ? (
                            <select className="select" style={{ height: 27, width: 116 }}
                              value={u.role}
                              onChange={async (e) => {
                                await run(() => window.api.auth.setRole({ id: u.id, role: e.target.value }),
                                  'Role updated')
                                list.reload()
                              }}>
                              {ROLES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
                            </select>
                          ) : (
                            <span className={`badge ${roleBadge(u.role)}`}>{u.role}</span>
                          )}
                        </td>
                        <td>
                          <span className={`badge ${u.active ? 'badge-ok' : 'badge-mute'}`}>
                            {u.active ? 'Active' : 'Disabled'}
                          </span>
                        </td>
                        <td className="small muted">
                          {u.last_login ? dmy(u.last_login.slice(0, 10)) : 'Never'}
                        </td>
                        <td className="r">
                          {canManage && (
                            <>
                              <button className="btn btn-ghost btn-sm" onClick={() => setResetting(u)}>
                                Reset password
                              </button>
                              {!isMe && !isAdmin && (
                                <>
                                  <button className="btn btn-ghost btn-sm" onClick={async () => {
                                    await run(
                                      () => window.api.auth.setActive({ id: u.id, active: !u.active }),
                                      u.active ? 'Login disabled' : 'Login enabled'
                                    )
                                    list.reload()
                                  }}>
                                    {u.active ? 'Disable' : 'Enable'}
                                  </button>
                                  <button className="btn btn-ghost btn-icon btn-sm" aria-label="Delete"
                                    onClick={() => setRemoving(u)}><Icon.trash /></button>
                                </>
                              )}
                            </>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* ── What each role may do ──────────────────────────── */}
      <div className="card" style={{ marginTop: 14 }}>
        <div className="card-head"><span className="card-title">What Each Role Can Do</span></div>
        <div className="card-body flush">
          <table className="data">
            <thead>
              <tr><th>Task</th><th>Staff</th><th>Manager</th><th>Owner</th></tr>
            </thead>
            <tbody>
              {[
                ['Billing, receipts, orders, stock entry', 1, 1, 1],
                ['Reports, khata and exports', 1, 1, 1],
                ['Refining — melting metal', 0, 1, 1],
                ['Deleting a tag from stock', 0, 1, 1],
                ['Deleting a bill, purchase or receipt', 0, 0, 1],
                ['Shop settings and bill numbering', 0, 0, 1],
                ['Creating and managing staff logins', 0, 0, 1],
                ['Taking a database backup', 0, 0, 1],
              ].map(([task, s, m, o]: any) => (
                <tr key={task}>
                  <td>{task}</td>
                  {[s, m, o].map((v, i) => (
                    <td key={i} style={{ width: 90 }}>
                      {v ? <span className="ok strong">Yes</span> : <span className="muted">No</span>}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {adding && (
        <AddStaff onClose={() => setAdding(false)}
          onSaved={() => { setAdding(false); list.reload() }} />
      )}

      {resetting && (
        <ResetPassword user={resetting} onClose={() => setResetting(null)}
          onSaved={() => { setResetting(null); list.reload() }} />
      )}

      {removing && (
        <Confirm title="Delete this login?"
          message={`"${removing.username}" will no longer be able to sign in. Documents they created are not affected.`}
          onConfirm={async () => {
            const u = removing
            setRemoving(null)
            await run(() => window.api.auth.removeUser({ id: u.id }), 'Login deleted')
            list.reload()
          }}
          onCancel={() => setRemoving(null)} />
      )}
    </div>
  )
}

/* ───────────────────────────── Create a staff login ───────────────────────────── */

function AddStaff({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const run = useAction()
  const [f, setF] = useState({ username: '', name: '', role: 'staff', password: '', confirm: '' })

  const save = async () => {
    if (f.password !== f.confirm) {
      return run(async () => { throw new Error('The two passwords do not match') })
    }
    const ok = await run(
      () => window.api.auth.addUser({
        username: f.username, name: f.name, role: f.role, password: f.password,
      }),
      `Login created for ${f.username}`
    )
    if (ok !== undefined) onSaved()
  }

  const role = ROLES.find((r) => r.value === f.role)

  return (
    <Modal title="Add Staff Login" onClose={onClose}
      footer={<>
        <span className="spacer" />
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" onClick={save}><Icon.save /> Create Login</button>
      </>}>
      <div className="form-grid cols-2">
        <Field label="Full Name" required className="span-2">
          <Input autoFocus value={f.name} placeholder="e.g. Ramesh Patil"
            onChange={(e) => setF({ ...f, name: e.target.value })} />
        </Field>
        <Field label="Username" required hint="What they type to sign in">
          <Input value={f.username} placeholder="e.g. ramesh"
            onChange={(e) => setF({ ...f, username: e.target.value.replace(/\s/g, '') })} />
        </Field>
        <Field label="Role" required>
          <Select value={f.role} onChange={(v) => setF({ ...f, role: v })}
            options={ROLES.map((r) => ({ value: r.value, label: r.label }))} />
        </Field>
        <Field label="Password" required hint="At least 4 characters">
          <input className="input" type="password" value={f.password}
            onChange={(e) => setF({ ...f, password: e.target.value })} />
        </Field>
        <Field label="Confirm Password" required>
          <input className="input" type="password" value={f.confirm}
            onChange={(e) => setF({ ...f, confirm: e.target.value })} />
        </Field>

        {role && (
          <div className="span-2" style={{
            background: 'var(--gold-soft)', border: '1px solid var(--gold-line)',
            borderRadius: 'var(--radius)', padding: '10px 13px',
          }}>
            <div className="strong small" style={{ color: 'var(--gold-ink)' }}>{role.label}</div>
            <div className="small muted">{role.hint}</div>
          </div>
        )}
      </div>
    </Modal>
  )
}

/* ───────────────────────────── Owner resetting a password ───────────────────────────── */

function ResetPassword({ user, onClose, onSaved }: {
  user: any; onClose: () => void; onSaved: () => void
}) {
  const run = useAction()
  const [pw, setPw] = useState('')
  const [confirm, setConfirm] = useState('')

  const save = async () => {
    if (pw !== confirm) {
      return run(async () => { throw new Error('The two passwords do not match') })
    }
    const ok = await run(
      () => window.api.auth.resetPassword({ id: user.id, newPassword: pw }),
      `Password reset for ${user.username}`
    )
    if (ok !== undefined) onSaved()
  }

  return (
    <Modal title={`Reset Password — ${user.username}`} onClose={onClose}
      footer={<>
        <span className="spacer" />
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" onClick={save}><Icon.save /> Reset</button>
      </>}>
      <p className="small muted" style={{ marginBottom: 14 }}>
        Set a new password for <strong>{user.name}</strong>. Tell them what it is and ask
        them to change it from their own My Account section.
      </p>
      <div className="form-grid cols-2">
        <Field label="New password" required>
          <input className="input" type="password" autoFocus value={pw}
            onChange={(e) => setPw(e.target.value)} />
        </Field>
        <Field label="Confirm" required>
          <input className="input" type="password" value={confirm}
            onChange={(e) => setConfirm(e.target.value)} />
        </Field>
      </div>
    </Modal>
  )
}
