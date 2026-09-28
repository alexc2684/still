'use client'

import { useEffect, useState } from 'react'
import Avatar, { AVATAR_KEYS, type AvatarKey } from './Avatar'
import './profile.css'

type User = { id: string; name: string; email: string; timezone: string; weeklyTarget: number; weeklyMinutesTarget?: number | null; avatarKey?: AvatarKey | null }
type Week = { weekStart: string; minutes: number; sessions?: number; practiceDays?: number; goalDays?: number; goalMinutes?: number | null }
type Stats = { totals?: { seconds?: number; minutes?: number; sessions?: number }; currentWeek?: { minutes?: number; sessions?: number; practiceDays?: number; dayTarget?: number; minuteTarget?: number | null; daysGoalMet?: boolean; minutesGoalMet?: boolean | null; goalMet?: boolean }; currentStreak?: number; bestStreak?: number; weeks?: Week[] }
type ReminderSettings = { enabled: boolean; hour: number; days: number[] }

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
  const [reminders, setReminders] = useState<ReminderSettings>({ enabled: false, hour: 19, days: [0, 1, 2, 3, 4, 5, 6] })
  const [vapidKey, setVapidKey] = useState<string | null>(null)
  const [reminderState, setReminderState] = useState<'idle' | 'working' | 'denied' | 'unsupported'>('idle')

  useEffect(() => {
    if (!signedIn) return
    Promise.all([fetch('/api/auth/me'), fetch('/api/profile/stats')]).then(async ([response, statsResponse]) => { if (!response.ok) throw new Error('Please sign in again.'); const body = await response.json(); setUser(body.user); setGoal(body.user.weeklyTarget); setMinutesGoal(body.user.weeklyMinutesTarget ?? null); setAvatarKey(body.user.avatarKey ?? null); if (statsResponse.ok) setStats(await statsResponse.json()) }).catch(err => setError(err instanceof Error ? err.message : 'Unable to load profile.')).finally(() => setLoading(false))
  }, [signedIn])

  useEffect(() => { if (!signedIn) return; fetch('/api/reminders').then(async response => { if (!response.ok) return; const body = await response.json(); const settings = body.settings ?? body.reminders; if (settings) setReminders({ enabled: Boolean(settings.enabled), hour: Number(settings.hour ?? 19), days: settings.days ?? [0, 1, 2, 3, 4, 5, 6] }); setVapidKey(body.vapidPublicKey ?? body.publicKey ?? null); if (typeof Notification !== 'undefined' && Notification.permission === 'denied') setReminderState('denied') }).catch(() => {}) }, [signedIn])

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

  async function saveReminderPreferences(next: ReminderSettings) {
    if (next.days.length === 0) { setError('Choose at least one reminder day.'); return }
    const previous = reminders; setReminders(next); setReminderState('working'); setError('')
    try { const response = await fetch('/api/reminders', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(next) }); const body = await response.json().catch(() => ({})); if (!response.ok) throw new Error(body.error ?? 'Could not save reminder preferences.'); const settings = body.settings ?? body.reminders; if (settings) setReminders({ enabled: Boolean(settings.enabled), hour: Number(settings.hour ?? next.hour), days: settings.days ?? next.days }); setReminderState('idle') } catch (err) { setReminders(previous); setReminderState('idle'); setError(err instanceof Error ? err.message : 'Could not save reminder preferences.') }
  }

  function decodeVapid(value: string) { const padding = '='.repeat((4 - value.length % 4) % 4); const binary = atob((value + padding).replace(/-/g, '+').replace(/_/g, '/')); return Uint8Array.from(binary, character => character.charCodeAt(0)) }
  async function enableReminders() {
    if (!('Notification' in window) || !('serviceWorker' in navigator) || !('PushManager' in window)) { setReminderState('unsupported'); return }
    setReminderState('working'); setError('')
    try {
      const permission = Notification.permission === 'default' ? await Notification.requestPermission() : Notification.permission
      if (permission !== 'granted') { setReminderState('denied'); return }
      const registration = await Promise.race([navigator.serviceWorker.ready, new Promise<never>((_, reject) => window.setTimeout(() => reject(new Error('Service worker did not become ready.')), 15000))])
      const subscription = await Promise.race([registration.pushManager.getSubscription().then(existing => existing ?? registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: decodeVapid(vapidKey!) })), new Promise<never>((_, reject) => window.setTimeout(() => reject(new Error('Push setup timed out.')), 15000))])
      const json = subscription.toJSON()
      const saveResponse = await fetch('/api/reminders/subscriptions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ endpoint: json.endpoint, keys: json.keys }) })
      if (!saveResponse.ok) throw new Error('Could not save this device for reminders.')
      const settingsResponse = await fetch('/api/reminders', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...reminders, enabled: true }) })
      if (!settingsResponse.ok) throw new Error('Could not enable reminder delivery.')
      setReminders(current => ({ ...current, enabled: true })); setReminderState('idle'); setMessage('Phone reminders enabled.')
    } catch (err) { setReminderState('idle'); setError(err instanceof Error ? err.message : 'Could not enable phone reminders.') }
  }
  async function disableReminders() {
    setReminderState('working'); setError('')
    try { const response = await fetch('/api/reminders', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...reminders, enabled: false }) }); const body = await response.json().catch(() => ({})); if (!response.ok) throw new Error(body.error ?? 'Could not disable reminders.'); const settings = body.settings ?? body.reminders; setReminders(settings ? { enabled: Boolean(settings.enabled), hour: Number(settings.hour ?? reminders.hour), days: settings.days ?? reminders.days } : current => ({ ...current, enabled: false })); let cleanupError = ''; if ('serviceWorker' in navigator) { const registration = await navigator.serviceWorker.ready; const subscription = await registration.pushManager.getSubscription(); if (subscription) { const deleteResponse = await fetch('/api/reminders/subscriptions', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ endpoint: subscription.endpoint }) }); if (!deleteResponse.ok) cleanupError = ' Server delivery is off, but this device subscription could not be removed.'; try { await subscription.unsubscribe() } catch { cleanupError = ' Server delivery is off, but this device subscription could not be removed.' } } } setReminderState('idle'); setMessage(`Phone reminders disabled.${cleanupError}`) } catch (err) { setReminderState('idle'); setError(err instanceof Error ? err.message : 'Could not disable reminders.') }
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
    <div className="settings-list"><div className="avatar-picker"><strong>Choose your mark</strong><small>A small symbol for your practice.</small><div className="avatar-options"><button className={!avatarKey ? 'selected' : ''} onClick={() => void saveAvatar(null)} aria-label="Use initials" aria-pressed={!avatarKey} disabled={avatarSaving}><Avatar name={user.name} size="small" /></button>{AVATAR_KEYS.map(key => <button key={key} className={avatarKey === key ? 'selected' : ''} onClick={() => void saveAvatar(key)} aria-label={'Use ' + key + ' avatar'} aria-pressed={avatarKey === key} disabled={avatarSaving}><Avatar name={user.name} avatarKey={key} size="small" /></button>)}</div></div><label className="profile-setting"><span>◌</span><div><strong>Weekly goal</strong><small>Choose how often you want to practice.</small></div><select aria-label="Weekly practice goal" value={goal} disabled={saving} onChange={event => void saveGoal(Number(event.target.value))}>{[1, 2, 3, 4, 5, 6, 7].map(value => <option key={value} value={value}>{value} {value === 1 ? 'day' : 'days'}</option>)}</select></label><label className="profile-setting"><span>◷</span><div><strong>Minutes goal</strong><small>{minutesGoal ? 'Weekly minutes target.' : 'Optional weekly time target.'}</small></div><input className="goal-number" aria-label="Weekly minutes goal" type="number" min="0" max="10080" step="5" value={minutesGoal ?? ''} placeholder="Off" disabled={saving} onChange={event => setMinutesGoal(event.target.value ? Number(event.target.value) : null)} onBlur={() => void saveMinutesGoal(minutesGoal)} /></label><div className="profile-setting"><span>⌁</span><div><strong>Timezone</strong><small>{user.timezone}</small></div></div><details className="install-help"><summary>Install Still on iPhone</summary><p>In Safari, tap the Share button, choose <strong>Add to Home Screen</strong>, then tap Add. Still will open like an app and keep your practice close.</p></details><button className="profile-action" onClick={() => void logout()}><span>↗</span><strong>Sign out</strong></button></div>
    <ReminderCard settings={reminders} state={reminderState} configured={Boolean(vapidKey)} onEnable={() => void enableReminders()} onDisable={() => void disableReminders()} onPreferences={next => void saveReminderPreferences(next)} />
  </section>
}

function ProfileStats({ stats, week, totals, goal, minutesGoal, dayProgress, minutesProgress, maxChartMinutes }: { stats: Stats; week: NonNullable<Stats['currentWeek']>; totals: NonNullable<Stats['totals']>; goal: number; minutesGoal: number | null; dayProgress: number; minutesProgress: number; maxChartMinutes: number }) {
  const [selectedWeek, setSelectedWeek] = useState<Week | null>(null)
  const weeks = stats.weeks ?? []
  return <div className="profile-stats"><div className="progress-card"><div className="progress-card-head"><div><span className="eyebrow">This week</span><strong>{week.minutes ?? 0} <small>minutes</small></strong></div><span className="progress-percent">{week.practiceDays ?? 0} / {goal} days</span></div><div className="progress-track"><i style={{ width: `${dayProgress * 100}%` }} /></div><p>{week.daysGoalMet ? 'Days goal met.' : `${Math.max(0, goal - (week.practiceDays ?? 0))} days to your goal.`}</p>{minutesGoal && <><div className="progress-subline"><span>{week.minutes ?? 0} / {minutesGoal} minutes</span><span>{week.minutesGoalMet ? 'Minutes goal met.' : `${Math.max(0, minutesGoal - (week.minutes ?? 0))} minutes to goal.`}</span></div><div className="progress-track progress-track-secondary"><i style={{ width: `${minutesProgress * 100}%` }} /></div></>}</div><div className="profile-stat-grid"><div><strong>{week.sessions ?? 0}</strong><span>sessions this week</span></div><div><strong>{totals.minutes ?? 0}</strong><span>total minutes</span></div><div><strong>{stats.bestStreak ?? 0}</strong><span>best streak</span></div></div>{weeks.length > 0 && <div className="weekly-chart"><div className="chart-heading"><span className="eyebrow">Last 12 weeks</span><span>minutes practiced</span></div><div className="chart-bars">{weeks.map(item => <button type="button" key={item.weekStart} className={`chart-bar-wrap ${selectedWeek?.weekStart === item.weekStart ? 'selected' : ''}`} onClick={() => setSelectedWeek(item)}><i className={`chart-bar ${item.minutes === 0 ? 'is-zero' : ''}`} style={{ height: `${item.minutes === 0 ? 4 : Math.max(8, Math.min(100, item.minutes / maxChartMinutes * 100))}%` }} /><small>{new Date(`${item.weekStart}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</small></button>)}</div>{selectedWeek && <div className="chart-detail"><strong>Week of {selectedWeek.weekStart}</strong><span>{selectedWeek.minutes} minutes · {selectedWeek.sessions ?? 0} sessions · {selectedWeek.practiceDays ?? 0} practice days</span></div>}</div>}</div>
}

function ReminderCard({ settings, state, configured, onEnable, onDisable, onPreferences }: { settings: ReminderSettings; state: 'idle' | 'working' | 'denied' | 'unsupported'; configured: boolean; onEnable: () => void; onDisable: () => void; onPreferences: (settings: ReminderSettings) => void }) {
  const days = [{ value: 1, label: 'M', name: 'Monday' }, { value: 2, label: 'T', name: 'Tuesday' }, { value: 3, label: 'W', name: 'Wednesday' }, { value: 4, label: 'T', name: 'Thursday' }, { value: 5, label: 'F', name: 'Friday' }, { value: 6, label: 'S', name: 'Saturday' }, { value: 0, label: 'S', name: 'Sunday' }]
  return <div className="reminder-card"><div><span className="eyebrow">Gentle reminders</span><strong>{settings.enabled ? 'Phone reminders are on' : 'A little room to return'}</strong><p>{!configured ? 'Phone reminders unavailable' : state === 'denied' ? 'Notifications are blocked in this browser. You can allow them in Safari settings.' : state === 'unsupported' ? 'Phone reminders need an installed PWA and a browser that supports notifications.' : 'Around ' + new Date(2000, 0, 1, settings.hour).toLocaleTimeString(undefined, { hour: 'numeric' })}</p></div>{settings.enabled ? <button className="text-button" disabled={state === 'working'} onClick={onDisable}>Turn off</button> : <button className="primary-button" disabled={state === 'working' || !configured} onClick={onEnable}>{state === 'working' ? 'Setting up…' : configured ? 'Enable phone reminders' : 'Phone reminders unavailable'} <span>→</span></button>}<div className="reminder-options"><label>Time<select value={settings.hour} disabled={state === 'working'} onChange={event => onPreferences({ ...settings, hour: Number(event.target.value) })}>{Array.from({ length: 24 }, (_, hour) => <option key={hour} value={hour}>{new Date(2000, 0, 1, hour).toLocaleTimeString(undefined, { hour: 'numeric' })}</option>)}</select></label><div><span>Days</span><div className="reminder-days">{days.map((day, index) => <button type="button" key={day.name} className={settings.days.includes(day.value) ? 'selected' : ''} aria-pressed={settings.days.includes(day.value)} disabled={state === 'working' || (settings.days.length === 1 && settings.days.includes(day.value))} onClick={() => onPreferences({ ...settings, days: settings.days.includes(day.value) ? settings.days.filter(item => item !== day.value) : [...settings.days, day.value].sort() })}>{day.label}</button>)}</div></div></div><small className="reminder-install">On iPhone, install Still with Safari’s <strong>Add to Home Screen</strong> so reminders can arrive when the app is closed.</small></div>
}
