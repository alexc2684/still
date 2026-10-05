'use client'

import { useEffect, useState } from 'react'
import Avatar, { AVATAR_KEYS, type AvatarKey } from './Avatar'
import './profile.css'

type User = { id: string; name: string; email: string; timezone: string; weeklyTarget: number; weeklyMinutesTarget?: number | null; avatarKey?: AvatarKey | null }
type Week = { weekStart: string; minutes: number; sessions?: number; practiceDays?: number; goalDays?: number; goalMinutes?: number | null }
type Stats = { totals?: { seconds?: number; minutes?: number; sessions?: number }; currentWeek?: { minutes?: number; sessions?: number; practiceDays?: number; dayTarget?: number; minuteTarget?: number | null; daysGoalMet?: boolean; minutesGoalMet?: boolean | null; goalMet?: boolean }; currentStreak?: number; bestStreak?: number; weeks?: Week[] }
export default function Profile({ signedIn = true, onSignIn, onSignOut, onProfileUpdated }: { signedIn?: boolean; onSignIn?: () => void; onSignOut?: () => void; onProfileUpdated?: (user: User) => void }) {
  const [user, setUser] = useState<User | null>(null)
  const [goal, setGoal] = useState(7)
  const [minutesGoal, setMinutesGoal] = useState<number | null>(null)
  const [stats, setStats] = useState<Stats | null>(null)
  const [loading, setLoading] = useState(signedIn)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [avatarKey, setAvatarKey] = useState<AvatarKey | null>(null)
  const [avatarSaving, setAvatarSaving] = useState(false)

  useEffect(() => {
    if (!signedIn) return
    Promise.all([fetch('/api/auth/me'), fetch('/api/profile/stats')]).then(async ([response, statsResponse]) => { if (!response.ok) throw new Error('Please sign in again.'); const body = await response.json(); setUser(body.user); setGoal(body.user.weeklyTarget); setMinutesGoal(body.user.weeklyMinutesTarget ?? null); setAvatarKey(body.user.avatarKey ?? null); if (statsResponse.ok) setStats(await statsResponse.json()) }).catch(err => setError(err instanceof Error ? err.message : 'Unable to load profile.')).finally(() => setLoading(false))
  }, [signedIn])

  async function saveGoal(value: number) {
    setGoal(value); setSaving(true); setMessage(''); setError('')
    try {
      const response = await fetch('/api/profile', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ weeklyTarget: value, weeklyMinutesTarget: minutesGoal }) })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(body.error ?? 'Unable to save weekly goal.')
      setUser(body.user); onProfileUpdated?.(body.user); const statsResponse = await fetch('/api/profile/stats'); if (statsResponse.ok) setStats(await statsResponse.json()); setMessage('Days goal saved.')
    } catch (err) { setGoal(user?.weeklyTarget ?? 7); setError(err instanceof Error ? err.message : 'Unable to save weekly goal.') }
    finally { setSaving(false) }
  }

  async function saveMinutesGoal(value: number | null) {
    const next = value && value > 0 ? Math.min(10080, Math.round(value)) : null
    setMinutesGoal(next); setSaving(true); setMessage(''); setError('')
    try {
      const response = await fetch('/api/profile', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ weeklyMinutesTarget: next }) })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(body.error ?? 'Unable to save minutes goal.')
      setUser(body.user); onProfileUpdated?.(body.user); const statsResponse = await fetch('/api/profile/stats'); if (statsResponse.ok) setStats(await statsResponse.json()); setMessage('Minutes goal saved.')
    } catch (err) { setMinutesGoal(user?.weeklyMinutesTarget ?? null); setError(err instanceof Error ? err.message : 'Unable to save minutes goal.') }
    finally { setSaving(false) }
  }

  async function saveAvatar(value: AvatarKey | null) {
    const previous = avatarKey; setAvatarKey(value); setAvatarSaving(true); setError('')
    try { const response = await fetch('/api/profile', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ avatarKey: value }) }); const body = await response.json().catch(() => ({})); if (!response.ok) throw new Error(body.error ?? 'Unable to save avatar.'); setUser(body.user); onProfileUpdated?.(body.user); setMessage('Avatar saved.') } catch (err) { setAvatarKey(previous); setError(err instanceof Error ? err.message : 'Unable to save avatar.') } finally { setAvatarSaving(false) }
  }

  async function logout() {
    const response = await fetch('/api/auth/logout', { method: 'POST' })
    if (!response.ok) { setError('Unable to sign out.'); return }
    onSignOut?.()
  }

  if (!signedIn) return <section className="empty-view"><div className="empty-mark">○</div><h1>Your practice, held close.</h1><p>Sign in to update your profile, set a weekly rhythm, and keep your practice private.</p>{onSignIn && <button className="primary-button" onClick={onSignIn}>Sign in to your profile <span>→</span></button>}</section>
  if (loading) return <section className="content-view"><div className="loading-state">Loading your profile…</div></section>
  if (!user) return <section className="content-view"><p className="form-error" role="alert">{error || 'Unable to load your profile.'}</p></section>

  const week = stats?.currentWeek ?? {}
  const totals = stats?.totals ?? {}
  const dayProgress = Math.min(1, (week.practiceDays ?? 0) / Math.max(1, goal))
  const minutesProgress = minutesGoal ? Math.min(1, (week.minutes ?? 0) / minutesGoal) : 0
  const maxChartMinutes = Math.max(1, ...(stats?.weeks ?? []).map(item => item.minutes))
  return <section className="content-view" aria-labelledby="profile-heading">
    <div className="profile-hero"><Avatar name={user.name} avatarKey={avatarKey} size="large" /><div><div className="eyebrow">Your profile</div><h1 id="profile-heading">{user.name}</h1><p>{user.email}</p></div></div>
    {error && <p className="form-error" role="alert">{error}</p>}{message && <p className="form-success" role="status">{message}</p>}
    {stats ? <ProfileStats stats={stats} week={week} totals={totals} goal={goal} minutesGoal={minutesGoal} dayProgress={dayProgress} minutesProgress={minutesProgress} maxChartMinutes={maxChartMinutes} /> : <div className="profile-card"><div><span className="eyebrow">Weekly rhythm</span><strong>{goal} {goal === 1 ? 'day' : 'days'}</strong></div><span className="streak-spark">✦</span></div>}
    <div className="settings-list"><div className="avatar-picker"><strong>Choose your mark</strong><div className="avatar-options"><button className={!avatarKey ? 'selected' : ''} onClick={() => void saveAvatar(null)} aria-label="Use initials" aria-pressed={!avatarKey} disabled={avatarSaving}><Avatar name={user.name} size="small" /></button>{AVATAR_KEYS.map(key => <button key={key} className={avatarKey === key ? 'selected' : ''} onClick={() => void saveAvatar(key)} aria-label={'Use ' + key + ' avatar'} aria-pressed={avatarKey === key} disabled={avatarSaving}><Avatar name={user.name} avatarKey={key} size="small" /></button>)}</div></div><label className="profile-setting"><span>◌</span><div><strong>Weekly goal</strong></div><select aria-label="Weekly practice goal" value={goal} disabled={saving} onChange={event => void saveGoal(Number(event.target.value))}>{[1, 2, 3, 4, 5, 6, 7].map(value => <option key={value} value={value}>{value} {value === 1 ? 'day' : 'days'}</option>)}</select></label><label className="profile-setting"><span>◷</span><div><strong>Minutes goal</strong></div><input className="goal-number" aria-label="Weekly minutes goal" type="number" min="0" max="10080" step="5" value={minutesGoal ?? ''} placeholder="Off" disabled={saving} onChange={event => setMinutesGoal(event.target.value ? Number(event.target.value) : null)} onBlur={() => void saveMinutesGoal(minutesGoal)} /></label><details className="install-help"><summary>Install Still on iPhone</summary><p>In Safari, tap Share, then <strong>Add to Home Screen</strong>.</p></details><button className="profile-action" onClick={() => void logout()}><span>↗</span><strong>Sign out</strong></button></div>
  </section>
}

function ProfileStats({ stats, week, totals, goal, minutesGoal, dayProgress, minutesProgress, maxChartMinutes }: { stats: Stats; week: NonNullable<Stats['currentWeek']>; totals: NonNullable<Stats['totals']>; goal: number; minutesGoal: number | null; dayProgress: number; minutesProgress: number; maxChartMinutes: number }) {
  const [selectedWeek, setSelectedWeek] = useState<Week | null>(null)
  const weeks = stats.weeks ?? []
  return <div className="profile-stats"><div className="progress-card"><div className="progress-card-head"><div><span className="eyebrow">This week · Mon–Sun</span><strong>{week.minutes ?? 0} <small>minutes</small></strong></div><span className="progress-percent">{week.practiceDays ?? 0} / {goal} practice days</span></div><div className="progress-track"><i style={{ width: `${dayProgress * 100}%` }} /></div><p>{week.daysGoalMet ? 'Days goal met.' : `${Math.max(0, goal - (week.practiceDays ?? 0))} days to your goal.`}</p>{minutesGoal && <><div className="progress-subline"><span>{week.minutes ?? 0} / {minutesGoal} minutes</span><span>{week.minutesGoalMet ? 'Minutes goal met.' : `${Math.max(0, minutesGoal - (week.minutes ?? 0))} minutes to goal.`}</span></div><div className="progress-track progress-track-secondary"><i style={{ width: `${minutesProgress * 100}%` }} /></div></>}</div><div className="profile-stat-grid"><div><strong>{week.sessions ?? 0}</strong><span>sessions this week</span></div><div><strong>{totals.minutes ?? 0}</strong><span>total minutes</span></div><div><strong>{stats.bestStreak ?? 0}</strong><span>best streak</span></div></div>{weeks.length > 0 && <div className="weekly-chart"><div className="chart-heading"><span className="eyebrow">Last 12 weeks</span><span>minutes practiced</span></div><div className="chart-bars">{weeks.map(item => <button type="button" key={item.weekStart} className={`chart-bar-wrap ${selectedWeek?.weekStart === item.weekStart ? 'selected' : ''}`} onClick={() => setSelectedWeek(item)}><i className={`chart-bar ${item.minutes === 0 ? 'is-zero' : ''}`} style={{ height: `${item.minutes === 0 ? 4 : Math.max(8, Math.min(100, item.minutes / maxChartMinutes * 100))}%` }} /><small>{new Date(`${item.weekStart}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</small></button>)}</div>{selectedWeek && <div className="chart-detail"><strong>Week of {selectedWeek.weekStart}</strong><span>{selectedWeek.minutes} minutes · {selectedWeek.sessions ?? 0} sessions · {selectedWeek.practiceDays ?? 0} practice days</span></div>}</div>}</div>
}
