'use client'

import { useEffect, useMemo, useState } from 'react'
import './journal.css'
import { combineJournalNotes } from './journalNotes'

type Mood = 1 | 2 | 3 | 4 | 5

export type JournalSession = {
  id: string
  startedAt: string
  completedAt?: string | null
  completedLocalDate?: string | null
  plannedSeconds: number
  elapsedSeconds?: number | null
  name?: string | null
  beforeMood?: Mood | null
  duringMood?: Mood | null
  afterMood?: Mood | null
  beforeNote?: string | null
  duringNote?: string | null
  afterNote?: string | null
}

type JournalProps = { signedIn?: boolean; onSignIn?: () => void; onChanged?: () => void; refreshKey?: number }

const moodLabels = ['restless', 'scattered', 'steady', 'open', 'clear']
const dayLabels = ['M', 'T', 'W', 'T', 'F', 'S', 'S']

function localDate(value: Date) {
  const y = value.getFullYear()
  const m = String(value.getMonth() + 1).padStart(2, '0')
  const d = String(value.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function formatMinutes(seconds: number) { return Math.max(1, Math.round(seconds / 60)) }

function currentStreak(dates: string[], today = localDate(new Date())) {
  const set = new Set(dates)
  const cursor = new Date(`${today}T12:00:00`)
  if (!set.has(today)) cursor.setDate(cursor.getDate() - 1)
  let count = 0
  while (set.has(localDate(cursor))) { count += 1; cursor.setDate(cursor.getDate() - 1) }
  return count
}

function bestStreak(dates: string[]) {
  const ordered = [...new Set(dates)].sort()
  let best = 0
  let run = 0
  let previous: Date | null = null
  for (const value of ordered) {
    const date = new Date(`${value}T12:00:00`)
    if (previous && Math.round((date.getTime() - previous.getTime()) / 86400000) === 1) run += 1
    else run = 1
    best = Math.max(best, run)
    previous = date
  }
  return best
}

export default function Journal({ signedIn = true, onSignIn, onChanged, refreshKey }: JournalProps) {
  const [sessions, setSessions] = useState<JournalSession[]>([])
  const [practiceDates, setPracticeDates] = useState<string[]>([])
  const [month, setMonth] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1))
  const [loading, setLoading] = useState(true)
  const [unauthorized, setUnauthorized] = useState(false)
  const [timezone, setTimezone] = useState('UTC')
  const [error, setError] = useState('')
  const [editing, setEditing] = useState<string | null>(null)
  const [saving, setSaving] = useState<string | null>(null)

  async function load() {
    setLoading(true); setError('')
    try {
      const [response, profileResponse] = await Promise.all([fetch('/api/sessions'), fetch('/api/auth/me')])
      if (response.status === 401) { setUnauthorized(true); return }
      if (!response.ok) throw new Error('Unable to load your journal.')
      const body = await response.json()
      setSessions(body.sessions ?? [])
      setPracticeDates(body.practiceDates ?? [])
      if (profileResponse.ok) { const profile = await profileResponse.json(); setTimezone(profile.user?.timezone || 'UTC') }
      setUnauthorized(false)
    } catch (err) { setError(err instanceof Error ? err.message : 'Unable to load your journal.') }
    finally { setLoading(false) }
  }
  useEffect(() => { if (signedIn) void load(); else setLoading(false) }, [signedIn, refreshKey])

  const completedSessions = useMemo(() => sessions.filter(session => Boolean(session.completedAt)), [sessions])
  const totalMinutes = useMemo(() => Math.round(completedSessions.reduce((sum, session) => sum + (session.elapsedSeconds || session.plannedSeconds), 0) / 60), [completedSessions])
  const today = useMemo(() => new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format(new Date()), [timezone])
  const monthTitle = month.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
  const calendar = useMemo(() => {
    const firstDay = (new Date(month.getFullYear(), month.getMonth(), 1).getDay() + 6) % 7
    const days = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate()
    return [...Array(firstDay).fill(null), ...Array.from({ length: days }, (_, index) => new Date(month.getFullYear(), month.getMonth(), index + 1))]
  }, [month])

  async function updateNotes(session: JournalSession, notes: Pick<JournalSession, 'beforeMood' | 'duringMood' | 'afterMood'> & { notes: string }) {
    setSaving(session.id); setError('')
    try {
      const payload = { beforeMood: notes.beforeMood, duringMood: notes.duringMood, afterMood: notes.afterMood, beforeNote: null, duringNote: null, afterNote: notes.notes }
      const response = await fetch(`/api/sessions/${session.id}/reflection`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
      if (!response.ok) { const body = await response.json().catch(() => ({})); throw new Error(body.error ?? 'Unable to save reflection.') }
      const body = await response.json().catch(() => ({}))
      setSessions(current => current.map(item => item.id === session.id ? { ...item, beforeMood: notes.beforeMood, duringMood: notes.duringMood, afterMood: notes.afterMood, beforeNote: null, duringNote: null, afterNote: notes.notes } : item))
      setEditing(null)
      onChanged?.()
    } catch (err) { setError(err instanceof Error ? err.message : 'Unable to save reflection.') }
    finally { setSaving(null) }
  }

  async function remove(session: JournalSession) {
    if (!window.confirm('Delete this session and its reflection?')) return
    const response = await fetch(`/api/sessions/${session.id}`, { method: 'DELETE' })
    if (!response.ok) { setError('Unable to delete that session.'); return }
    await load()
    onChanged?.()
  }

  if (loading) return <section className="content-view"><div className="loading-state">Loading your journal…</div></section>
  if (!signedIn || unauthorized) return <section className="empty-view"><div className="empty-mark">◌</div><h1>Keep your practice close.</h1><p>Sign in to see your sessions, reflections, and practice days.</p>{onSignIn && <button className="primary-button" onClick={onSignIn}>Sign in to Still <span>→</span></button>}</section>

  return <section className="content-view" aria-labelledby="journal-heading">
    <div className="view-header"><div><div className="eyebrow">Your practice</div><h1 id="journal-heading">Journal</h1></div></div>
    {error && <p className="form-error" role="alert">{error}</p>}
    <div className="journal-summary"><div><strong>{completedSessions.length}</strong><span>Total sessions</span></div><div><strong>{totalMinutes}</strong><span>Minutes practiced</span></div><div><strong>{currentStreak(practiceDates, today)}</strong><span>Current streak</span></div></div>
    <div className="month-head"><button aria-label="Previous month" onClick={() => setMonth(value => new Date(value.getFullYear(), value.getMonth() - 1, 1))}>←</button><strong>{monthTitle}</strong><button aria-label="Next month" onClick={() => setMonth(value => new Date(value.getFullYear(), value.getMonth() + 1, 1))}>→</button></div>
    <div className="calendar" aria-label={`${monthTitle} practice calendar`}>{dayLabels.map((day, index) => <span className="calendar-label" key={`${day}-${index}`}>{day}</span>)}{calendar.map((date, index) => date ? <span key={localDate(date)} className={`${practiceDates.includes(localDate(date)) ? 'meditated ' : ''}${localDate(date) === localDate(new Date()) ? 'today' : ''}`} aria-label={localDate(date)}>{date.getDate()}</span> : <span aria-hidden="true" key={`blank-${index}`} />)}</div>
    <div className="journal-prompt"><span>✦</span><div><strong>{bestStreak(practiceDates)} days is your best rhythm.</strong><p>Return when it helps. There is no perfect streak.</p></div></div>
    {completedSessions.length === 0 ? <div className="feed-empty"><div className="empty-mark">◌</div><h2>Your journal begins here.</h2><p>Complete a practice to start noticing your pattern over time.</p></div> : <div className="journal-entries">{completedSessions.map(session => <JournalEntry key={session.id} session={session} editing={editing === session.id} saving={saving === session.id} onEdit={() => setEditing(session.id)} onCancel={() => setEditing(null)} onSave={notes => updateNotes(session, notes)} onDelete={() => remove(session)} />)}</div>}
  </section>
}

function JournalEntry({ session, editing, saving, onEdit, onCancel, onSave, onDelete }: { session: JournalSession; editing: boolean; saving: boolean; onEdit: () => void; onCancel: () => void; onSave: (notes: Pick<JournalSession, 'beforeMood' | 'duringMood' | 'afterMood'> & { notes: string }) => void; onDelete: () => void }) {
  const [notes, setNotes] = useState(combineJournalNotes(session))
  const [moods, setMoods] = useState<{ beforeMood: Mood | null; duringMood: Mood | null; afterMood: Mood | null }>({ beforeMood: session.beforeMood ?? null, duringMood: session.duringMood ?? null, afterMood: session.afterMood ?? null })
  useEffect(() => { if (editing) { setNotes(combineJournalNotes(session)); setMoods({ beforeMood: session.beforeMood ?? null, duringMood: session.duringMood ?? null, afterMood: session.afterMood ?? null }) } }, [editing, session])
  const date = session.completedAt ?? session.startedAt
  return <article className="post journal-entry"><div className="post-head"><span className="session-glyph">◌</span><div><strong>{new Date(date).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}</strong><span>{formatMinutes(session.elapsedSeconds || session.plannedSeconds)} minutes</span></div><button className="more" onClick={onDelete} aria-label="Delete session and reflection">Delete</button></div>{editing ? <div className="reflection-form"><div className="mood-row">{(['before', 'during', 'after'] as const).map(stage => <div className="reflection-stage" key={stage}><span className="eyebrow">{stage}</span><div className="mood-picker" role="group" aria-label={`${stage} mood`}>{[1, 2, 3, 4, 5].map(value => <button type="button" key={value} className={moods[`${stage}Mood`] === value ? 'selected' : ''} onClick={() => setMoods(current => ({ ...current, [`${stage}Mood`]: value as Mood }))} aria-label={`${value} of 5`}>{value}</button>)}</div></div>)}</div><label className="notes-field"><span className="eyebrow">Notes</span><textarea maxLength={6500} value={notes} onChange={event => setNotes(event.target.value)} placeholder="What did you notice?" /></label><div><button className="primary-button" disabled={saving} onClick={() => onSave({ ...moods, notes })}>{saving ? 'Saving…' : 'Save reflection'}</button><button className="text-button" onClick={onCancel}>Cancel</button></div></div> : <><div className="reflection-moods">{(['before', 'during', 'after'] as const).map(stage => { const mood = session[`${stage}Mood`]; return <span key={stage}><b>{stage}</b>{mood ? `${mood}/5 · ${moodLabels[mood - 1]}` : 'No mood recorded'}</span> })}</div><p className="reflection-notes-block">{combineJournalNotes(session) || 'No notes yet.'}</p><button className="link-button" onClick={onEdit}>{session.afterNote || session.duringNote || session.beforeNote ? 'Edit reflection' : 'Add reflection'} <span>→</span></button></>}</article>
}
