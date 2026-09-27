'use client'

import { useEffect, useState } from 'react'

type User = { id: string; name: string; email: string; timezone: string; weeklyTarget: number }

export default function Profile({ signedIn = true, onSignIn, onSignOut, onProfileUpdated }: { signedIn?: boolean; onSignIn?: () => void; onSignOut?: () => void; onProfileUpdated?: (user: User) => void }) {
  const [user, setUser] = useState<User | null>(null)
  const [goal, setGoal] = useState(7)
  const [loading, setLoading] = useState(signedIn)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    if (!signedIn) return
    fetch('/api/auth/me').then(async response => { if (!response.ok) throw new Error('Please sign in again.'); const body = await response.json(); setUser(body.user); setGoal(body.user.weeklyTarget) }).catch(err => setError(err instanceof Error ? err.message : 'Unable to load profile.')).finally(() => setLoading(false))
  }, [signedIn])

  async function saveGoal(value: number) {
    setGoal(value); setSaving(true); setMessage(''); setError('')
    try {
      const response = await fetch('/api/profile', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ weeklyTarget: value }) })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(body.error ?? 'Unable to save weekly goal.')
      setUser(body.user); onProfileUpdated?.(body.user); setMessage('Weekly goal saved.')
    } catch (err) { setError(err instanceof Error ? err.message : 'Unable to save weekly goal.') }
    finally { setSaving(false) }
  }

  async function logout() {
    const response = await fetch('/api/auth/logout', { method: 'POST' })
    if (!response.ok) { setError('Unable to sign out.'); return }
    onSignOut?.()
  }

  if (!signedIn) return <section className="empty-view"><div className="empty-mark">○</div><h1>Your practice, held close.</h1><p>Sign in to update your profile, set a weekly rhythm, and keep your practice private.</p>{onSignIn && <button className="primary-button" onClick={onSignIn}>Sign in to your profile <span>→</span></button>}</section>
  if (loading) return <section className="content-view"><div className="loading-state">Loading your profile…</div></section>
  if (!user) return <section className="content-view"><p className="form-error" role="alert">{error || 'Unable to load your profile.'}</p></section>

  return <section className="content-view" aria-labelledby="profile-heading"><div className="profile-hero"><span className="profile-avatar-large">{user.name.slice(0, 1).toUpperCase()}</span><div><div className="eyebrow">Your profile</div><h1 id="profile-heading">{user.name}</h1><p>{user.email}</p></div></div>{error && <p className="form-error" role="alert">{error}</p>}{message && <p className="form-success" role="status">{message}</p>}<div className="profile-card"><div><span className="eyebrow">Weekly rhythm</span><strong>{goal} {goal === 1 ? 'day' : 'days'}</strong></div><span className="streak-spark">✦</span></div><div className="settings-list"><label className="profile-setting"><span>◌</span><div><strong>Weekly goal</strong><small>Choose how often you want to practice.</small></div><select aria-label="Weekly practice goal" value={goal} disabled={saving} onChange={event => void saveGoal(Number(event.target.value))}>{[1, 2, 3, 4, 5, 6, 7].map(value => <option key={value} value={value}>{value} {value === 1 ? 'day' : 'days'}</option>)}</select></label><div className="profile-setting"><span>⌁</span><div><strong>Timezone</strong><small>{user.timezone}</small></div></div><details className="install-help"><summary>Install Still on iPhone</summary><p>In Safari, tap the Share button, choose <strong>Add to Home Screen</strong>, then tap Add. Still will open like an app and keep your practice close.</p></details><button className="profile-action" onClick={() => void logout()}><span>↗</span><strong>Sign out</strong></button></div></section>
}
