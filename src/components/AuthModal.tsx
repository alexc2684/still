'use client'

import { useEffect, useRef, useState } from 'react'
import type { FormEvent, KeyboardEvent as ReactKeyboardEvent } from 'react'

export type AuthUser = { id: string; name: string; email: string; timezone: string; weeklyTarget?: number }
export type AuthModalProps = { onClose: () => void; onSuccess: (user: AuthUser) => void; initialError?: string }

export default function AuthModal({ onClose, onSuccess, initialError = '' }: AuthModalProps) {
  const [mode, setMode] = useState<'login' | 'signup' | 'forgot'>('login')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState(initialError)
  const [message, setMessage] = useState('')
  const dialogRef = useRef<HTMLDivElement>(null)
  const firstFieldRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    firstFieldRef.current?.focus()
    function onKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key === 'Escape') { event.preventDefault(); onClose(); return }
      if (event.key !== 'Tab' || !dialogRef.current) return
      const focusable = Array.from(dialogRef.current.querySelectorAll<HTMLElement>('button, input, [href], select, textarea, [tabindex]:not([tabindex="-1"])')).filter(element => !element.hasAttribute('disabled'))
      if (!focusable.length) return
      const first = focusable[0], last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setPending(true); setError(''); setMessage('')
    try {
      const endpoint = mode === 'forgot' ? '/api/auth/forgot-password' : mode === 'signup' ? '/api/auth/signup' : '/api/auth/login'
      const payload = mode === 'forgot' ? { email: email.trim() } : mode === 'signup'
        ? { name: name.trim(), email: email.trim(), password, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone }
        : { email: email.trim(), password }
      const response = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
      const body = await response.json().catch(() => ({})) as { user?: AuthUser; error?: string; message?: string }
      if (mode === 'forgot' && response.ok) { setMessage(body.message || 'Check your email for a reset link.'); return }
      if (!response.ok || !body.user) throw new Error(body.error || 'Could not continue. Check your details and try again.')
      onSuccess(body.user)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to reach Still. Check your connection and try again.')
    } finally { setPending(false) }
  }

  async function googleSignIn() {
    setPending(true); setError(''); setMessage('')
    try {
      const response = await fetch('/api/auth/google/start', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ timezone: Intl.DateTimeFormat().resolvedOptions().timeZone, returnTo: window.location.pathname + window.location.search }) })
      const body = await response.json() as { url?: string; error?: string }
      if (!response.ok || !body.url) throw new Error(body.error || 'Unable to start Google sign-in.')
      window.location.assign(body.url)
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to reach Google sign-in. Try again.') }
    finally { setPending(false) }
  }

  function switchMode(event: ReactKeyboardEvent<HTMLButtonElement>) {
    if (event.key === ' ') event.preventDefault()
  }

  return <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
    <div className="auth-modal" ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="still-auth-title" onMouseDown={event => event.stopPropagation()}>
      <button className="modal-close" type="button" onClick={onClose} aria-label="Close sign in">×</button>
      <div className="brand"><span className="brand-mark" />Still</div>
      <h2 id="still-auth-title">{mode === 'forgot' ? 'Reset your password.' : mode === 'signup' ? 'Begin a practice.' : 'Come sit with us.'}</h2>
      <p>{mode === 'forgot' ? 'Enter your email and we’ll send you a reset link.' : mode === 'signup' ? 'Make a little room for showing up.' : 'Sign in to keep your practice and find your circle.'}</p>
      {mode !== 'forgot' && <><button type="button" className="google-sign-in" disabled={pending} onClick={() => void googleSignIn()}>Continue with Google</button><div className="auth-divider"><span>or use email</span></div></>}
      <form onSubmit={submit} noValidate>
        {mode === 'signup' && <label>Name<input ref={firstFieldRef} name="name" autoComplete="name" required minLength={1} maxLength={80} value={name} onChange={event => setName(event.target.value)} placeholder="Your name" /></label>}
        {mode !== 'signup' && <label>Email<input ref={firstFieldRef} name="email" type="email" autoComplete="email" required maxLength={254} value={email} onChange={event => setEmail(event.target.value)} placeholder="you@example.com" /></label>}
        {mode === 'signup' && <label>Email<input name="email" type="email" autoComplete="email" required maxLength={254} value={email} onChange={event => setEmail(event.target.value)} placeholder="you@example.com" /></label>}
        {mode !== 'forgot' && <label>Password<input name="password" type="password" autoComplete={mode === 'signup' ? 'new-password' : 'current-password'} required minLength={mode === 'signup' ? 8 : 1} maxLength={128} value={password} onChange={event => setPassword(event.target.value)} placeholder={mode === 'signup' ? '8 characters minimum' : 'Your password'} /></label>}
        {message && <p role="status">{message}</p>}
        {error && <p className="form-error" role="alert">{error}</p>}
        <button className="primary-button" type="submit" disabled={pending}>{pending ? 'Please wait…' : mode === 'forgot' ? 'Send reset link' : mode === 'signup' ? 'Create account' : 'Sign in'} <span>→</span></button>
      </form>
      {mode === 'login' && <button className="auth-switch" type="button" disabled={pending} onClick={() => { setMode('forgot'); setError(''); setMessage(''); setPassword('') }}>Forgot password?</button>}
      <button disabled={pending} className="auth-switch" type="button" onKeyDown={switchMode} onClick={() => { setMode(mode === 'login' ? 'signup' : 'login'); setError(''); setMessage(''); setPassword('') }}>{mode === 'login' ? 'New to Still? Create an account' : 'Already have an account? Sign in'}</button>
      <small>By continuing, you agree to practice with care.</small>
    </div>
  </div>
}
