'use client'

import { useEffect, useRef, useState, type FormEvent } from 'react'
import AuthModal from '@/components/AuthModal'

export default function ResetPasswordPage() {
  const [token, setToken] = useState<string | null>(null)
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)
  const [auth, setAuth] = useState(false)

  const readToken = useRef(false)
  useEffect(() => {
    if (readToken.current) return
    readToken.current = true
    setToken(new URLSearchParams(window.location.hash.slice(1)).get('token') || '')
    window.history.replaceState(null, '', window.location.pathname)
  }, [])

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (password !== confirmation) { setError('Your passwords do not match.'); return }
    setPending(true); setError('')
    try {
      const response = await fetch('/api/auth/reset-password', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token, password }) })
      const body = await response.json()
      if (!response.ok) throw new Error(body.error || 'Unable to reset your password.')
      setDone(true); setToken(''); setPassword(''); setConfirmation('')
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to reach Still. Please try again.') }
    finally { setPending(false) }
  }

  return <main className="reset-page"><section className="auth-modal" aria-labelledby="reset-title">
    <a className="brand" href="/"><span className="brand-mark" />Still</a>
    <h1 id="reset-title">{done ? 'Your password is reset.' : 'A fresh start.'}</h1>
    {done ? <><p role="status">Sign in with your new password to return to your practice.</p><button className="primary-button" onClick={() => setAuth(true)}>Sign in <span>→</span></button></> : token === null ? <p role="status">Loading…</p> : !token ? <><p>This reset link is missing or invalid.</p><button className="text-button" onClick={() => setAuth(true)}>Return to sign in or request a new link</button></> : <>
      <p>Choose a new password with at least 8 characters.</p>
      <form onSubmit={submit}>
        <label>New password<input type="password" autoComplete="new-password" required minLength={8} maxLength={128} value={password} onChange={event => setPassword(event.target.value)} /></label>
        <label>Confirm new password<input type="password" autoComplete="new-password" required minLength={8} maxLength={128} value={confirmation} onChange={event => setConfirmation(event.target.value)} /></label>
        {error && <p className="form-error" role="alert">{error}</p>}
        <button className="primary-button" disabled={pending}>{pending ? 'Saving…' : 'Reset password'} <span>→</span></button>
      </form>
      <button className="auth-switch" disabled={pending} onClick={() => setAuth(true)}>Need a new link? Return to sign in</button>
    </>}
  </section>{auth && <AuthModal onClose={() => setAuth(false)} onSuccess={() => { window.location.href = '/' }} />}</main>
}
