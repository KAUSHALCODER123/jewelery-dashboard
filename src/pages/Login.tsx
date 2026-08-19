import React, { useEffect, useRef, useState } from 'react'
import { Icon, Logo } from '../lib/icons'
import { Field, Input } from '../lib/ui'

/**
 * Sign-in gate. The whole application sits behind this — nothing loads until a
 * user is authenticated in the main process.
 */
export default function Login({ onSignedIn }: { onSignedIn: (u: any) => void }) {
  const [username, setUsername] = useState('admin')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [firstRun, setFirstRun] = useState(false)
  const pwRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    window.api.auth.status()
      .then((s: any) => setFirstRun(!!s.defaultPassword))
      .catch(() => {})
    pwRef.current?.focus()
  }, [])

  const submit = async (e?: React.FormEvent) => {
    e?.preventDefault()
    if (busy) return
    setBusy(true)
    setError('')
    try {
      const user = await window.api.auth.login({ username, password })
      onSignedIn(user)
    } catch (err: any) {
      setError(err?.message || 'Could not sign in')
      setPassword('')
      pwRef.current?.focus()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="login-screen">
      <form className="login-card" onSubmit={submit}>
        <div className="login-brand">
          <Logo size={46} />
          <div>
            <div className="login-title">Parivar</div>
            <div className="login-sub">Jewellery ERP</div>
          </div>
        </div>

        <div className="form-grid" style={{ gap: 12 }}>
          <Field label="Username">
            <Input
              value={username}
              autoComplete="username"
              onChange={(e) => setUsername(e.target.value)}
            />
          </Field>
          <Field label="Password">
            <input
              ref={pwRef}
              className="input"
              type="password"
              value={password}
              autoComplete="current-password"
              onChange={(e) => setPassword(e.target.value)}
            />
          </Field>
        </div>

        {error && (
          <div className="login-error" role="alert">
            <Icon.alert width={15} height={15} /> {error}
          </div>
        )}

        <button className="btn btn-primary" type="submit" disabled={busy || !password}
          style={{ width: '100%', height: 38 }}>
          {busy ? <span className="spinner" /> : <Icon.check />}
          {busy ? 'Signing in…' : 'Sign In'}
        </button>

        {firstRun && (
          <div className="login-hint">
            <b>First time?</b>
            Sign in with <span className="mono">admin</span> /
            <span className="mono"> admin</span>, then change the password under
            Settings → Users.
          </div>
        )}
      </form>

      <div className="login-foot">Offline · Your data stays on this computer</div>
    </div>
  )
}
