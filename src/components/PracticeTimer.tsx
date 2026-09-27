'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import './practice-timer.css'
import { combineJournalNotes } from './journalNotes'
import { playBowl, unlockBowlAudio } from '@/lib/bowl'

export type PracticeTimerUser = { id: string; name?: string; email?: string }
export type Mood = 1 | 2 | 3 | 4 | 5

export type PracticeTimerProps = {
  user: PracticeTimerUser | null
  onSessionSaved?: () => void
  onSignIn?: () => void
  onActiveChange?: (active: boolean) => void
  disabled?: boolean
}

type ActivePractice = {
  sessionId: string
  startedAt: string
  deadlineMs: number
  plannedSeconds: number
}
type Draft = { beforeMood: Mood | null; duringMood: Mood | null; afterMood: Mood | null; notes: string; beforeNote?: string; duringNote?: string; afterNote?: string }
type Stored = ActivePractice & { completionPending?: boolean }
const EMPTY_DRAFT: Draft = { beforeMood: null, duringMood: null, afterMood: null, notes: '' }
const moodWords = ['restless', 'scattered', 'steady', 'open', 'clear']

function formatTime(seconds: number) { return `${Math.floor(seconds / 60).toString().padStart(2, '0')}:${(seconds % 60).toString().padStart(2, '0')}` }
function jsonBody(response: Response) { return response.json().catch(() => ({})) as Promise<{ error?: string; session?: { id: string; started_at?: string; startedAt?: string; planned_seconds?: number; plannedSeconds?: number } }>; }

export default function PracticeTimer({ user, onSessionSaved, onSignIn, onActiveChange, disabled = false }: PracticeTimerProps) {
  const storageKey = user ? `still:practice:${user.id}` : null
  const draftKey = user ? `still:reflection:${user.id}` : null
  const reflectionSessionKey = user ? `still:reflection-session:${user.id}` : null
  const [minutes, setMinutes] = useState(10)
  const [active, setActive] = useState<ActivePractice | null>(null)
  const [remaining, setRemaining] = useState(10 * 60)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [reflection, setReflection] = useState(false)
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT)
  const [reflectionBusy, setReflectionBusy] = useState(false)
  const [reflectionError, setReflectionError] = useState('')
  const [saved, setSaved] = useState(false)
  const [timeOfDay, setTimeOfDay] = useState('Time to sit')
  const activeRef = useRef<ActivePractice | null>(null)
  const completedIdRef = useRef<string | null>(null)
  const completingRef = useRef(false)
  const completionFailedRef = useRef(false)
  const bellPlayedRef = useRef(false)
  const cancelingRef = useRef(false)
  const hydratedDraftKeyRef = useRef<string | null>(null)
  const wakeLockRef = useRef<WakeLockSentinel | null>(null)

  const persist = useCallback((value: Stored | null) => { if (!storageKey) return; try { value ? localStorage.setItem(storageKey, JSON.stringify(value)) : localStorage.removeItem(storageKey) } catch { /* storage is optional */ } }, [storageKey])
  const setCurrent = useCallback((value: ActivePractice | null) => { activeRef.current = value; setActive(value) }, [])
  const acquireWakeLock = useCallback(async () => { if (!('wakeLock' in navigator) || document.visibilityState !== 'visible') return; try { wakeLockRef.current = await navigator.wakeLock.request('screen') } catch { /* unsupported or denied */ } }, [])
  const releaseWakeLock = useCallback(() => { void wakeLockRef.current?.release().catch(() => undefined); wakeLockRef.current = null }, [])

  const completeNaturally = useCallback(async (session: ActivePractice) => {
    if (completingRef.current) return
    completingRef.current = true; setBusy(true); setError('')
    const payload = { elapsedSeconds: session.plannedSeconds }
    try {
      let response = await fetch(`/api/sessions/${session.sessionId}/complete`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
      // A server clock can be just ahead of this device by one second.
      if (response.status === 422) { await new Promise(resolve => window.setTimeout(resolve, 1200)); response = await fetch(`/api/sessions/${session.sessionId}/complete`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }) }
      if (!response.ok) { const body = await jsonBody(response); throw new Error(body.error || 'Still could not save the completed session.') }
      completedIdRef.current = session.sessionId; try { if (reflectionSessionKey) localStorage.setItem(reflectionSessionKey, session.sessionId) } catch { /* storage is optional */ }; persist(null); setCurrent(null); setRemaining(0); setSaved(true); setReflection(true); onSessionSaved?.(); releaseWakeLock()
    } catch (err) {
      completionFailedRef.current = true; persist({ ...session, completionPending: true }); setError(err instanceof Error ? err.message : 'Could not save your session.');
    } finally { completingRef.current = false; setBusy(false) }
  }, [onSessionSaved, persist, reflectionSessionKey, releaseWakeLock])

  useEffect(() => {
    if (!storageKey) { setCurrent(null); setSaved(false); setReflection(false); completedIdRef.current = null; return }
    try {
      const raw = localStorage.getItem(storageKey)
      if (!raw) return
      const item = JSON.parse(raw) as Stored
      if (!item.sessionId || !item.deadlineMs) return
      const restored = { sessionId: item.sessionId, startedAt: item.startedAt, deadlineMs: item.deadlineMs, plannedSeconds: item.plannedSeconds }
      setMinutes(Math.max(1, Math.min(120, Math.round(restored.plannedSeconds / 60)))); setCurrent(restored)
      if (item.completionPending || item.deadlineMs <= Date.now()) void completeNaturally(restored)
    } catch { /* malformed local state is ignored */ }
  }, [storageKey, completeNaturally, setCurrent])

  useEffect(() => { hydratedDraftKeyRef.current = null; setDraft(EMPTY_DRAFT); if (!draftKey) return; try { const raw = localStorage.getItem(draftKey); const completedId = reflectionSessionKey ? localStorage.getItem(reflectionSessionKey) : null; if (raw) { const legacy = JSON.parse(raw) as Partial<Draft>; const notes = typeof legacy.notes === 'string' ? legacy.notes : combineJournalNotes(legacy); setDraft({ beforeMood: legacy.beforeMood ?? null, duringMood: legacy.duringMood ?? null, afterMood: legacy.afterMood ?? null, notes }) } if (completedId) { completedIdRef.current = completedId; setSaved(true); setRemaining(0); setReflection(true) } } catch { /* optional */ } hydratedDraftKeyRef.current = draftKey }, [draftKey, reflectionSessionKey])
  useEffect(() => { if (!draftKey || hydratedDraftKeyRef.current !== draftKey) return; try { localStorage.setItem(draftKey, JSON.stringify(draft)) } catch { /* optional */ } }, [draft, draftKey])
  useEffect(() => {
    if (!active) { releaseWakeLock(); return }
    void acquireWakeLock()
    const tick = () => { const next = Math.max(0, Math.ceil((active.deadlineMs - Date.now()) / 1000)); setRemaining(next); if (next <= 0 && !cancelingRef.current) { if (!bellPlayedRef.current) { bellPlayedRef.current = true; playBowl() } if (!completionFailedRef.current) void completeNaturally(active) } }
    tick(); const id = window.setInterval(tick, 250)
    const visibility = () => { if (document.visibilityState === 'visible') void acquireWakeLock() }
    document.addEventListener('visibilitychange', visibility)
    return () => { window.clearInterval(id); document.removeEventListener('visibilitychange', visibility) }
  }, [active, acquireWakeLock, completeNaturally, releaseWakeLock])
  useEffect(() => () => releaseWakeLock(), [releaseWakeLock])
  useEffect(() => { onActiveChange?.(Boolean(active)) }, [active, onActiveChange])
  useEffect(() => {
    const update = () => { const hour = new Date().getHours(); setTimeOfDay(hour < 5 || hour >= 21 ? 'Late night sit' : hour < 9 ? 'Early morning sit' : hour < 12 ? 'Morning sit' : hour < 17 ? 'Afternoon sit' : 'Evening sit') }
    update(); const interval = window.setInterval(update, 60_000)
    return () => window.clearInterval(interval)
  }, [])

  async function begin() {
    if (disabled) return
    if (!user) { onSignIn?.(); return }
    unlockBowlAudio(); completionFailedRef.current = false; bellPlayedRef.current = false; cancelingRef.current = false; setBusy(true); setError('')
    try {
      const response = await fetch('/api/sessions/start', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ plannedSeconds: minutes * 60 }) })
      const body = await jsonBody(response)
      if (!response.ok || !body.session) throw new Error(body.error || 'Could not begin your practice.')
      const startedAt = body.session.startedAt || body.session.started_at
      const plannedSeconds = body.session.plannedSeconds || body.session.planned_seconds || minutes * 60
      if (!startedAt) throw new Error('The server did not return a start time.')
      const next = { sessionId: body.session.id, startedAt, deadlineMs: new Date(startedAt).getTime() + Math.round(plannedSeconds) * 1000, plannedSeconds: Math.round(plannedSeconds) }
      persist(next); setSaved(false); setCurrent(next); setRemaining(plannedSeconds)
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not begin your practice.') } finally { setBusy(false) }
  }
  async function cancel() {
    if (!active || busy) return
    cancelingRef.current = true; setBusy(true); setError('')
    try { const response = await fetch(`/api/sessions/${active.sessionId}`, { method: 'DELETE' }); if (!response.ok) { const body = await jsonBody(response); throw new Error(body.error || 'Could not end this practice.') }; persist(null); setCurrent(null); setRemaining(minutes * 60); releaseWakeLock() } catch (err) { cancelingRef.current = false; setError(err instanceof Error ? err.message : 'Could not end this practice.') } finally { setBusy(false) }
  }
  async function saveReflection() {
    const sessionId = activeRef.current?.sessionId
    // completed session id is retained separately so reflection can be saved after completion.
    let persistedId: string | null = null
    try { persistedId = reflectionSessionKey ? localStorage.getItem(reflectionSessionKey) : null } catch { /* storage is optional */ }
    const id = sessionId || completedIdRef.current || persistedId
    if (!id) return
    setReflectionBusy(true); setReflectionError('')
    try { const response = await fetch(`/api/sessions/${id}/reflection`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ beforeMood: draft.beforeMood ?? undefined, duringMood: draft.duringMood ?? undefined, afterMood: draft.afterMood ?? undefined, beforeNote: null, duringNote: null, afterNote: draft.notes }) }); const body = await jsonBody(response); if (!response.ok) throw new Error(body.error || 'Could not save reflection.'); try { if (draftKey) localStorage.removeItem(draftKey); if (reflectionSessionKey) localStorage.removeItem(reflectionSessionKey) } catch { /* storage is optional */ }; hydratedDraftKeyRef.current = null; setReflection(false); setReflectionError('') } catch (err) { setReflectionError(err instanceof Error ? err.message : 'Could not save reflection.') } finally { setReflectionBusy(false) }
  }
  function beginNewSession() {
    completedIdRef.current = null; setSaved(false); setReflection(false); setReflectionError(''); setDraft(EMPTY_DRAFT); setRemaining(minutes * 60)
    hydratedDraftKeyRef.current = null
    try { if (draftKey) localStorage.removeItem(draftKey); if (reflectionSessionKey) localStorage.removeItem(reflectionSessionKey) } catch { /* storage is optional */ }
  }
  const progress = active ? Math.min(1, Math.max(0, 1 - remaining / active.plannedSeconds)) : saved ? 1 : 0
  const displayRemaining = active ? remaining : saved ? 0 : minutes * 60
  const circumference = 2 * Math.PI * 126
  const setMood = (key: 'beforeMood' | 'duringMood' | 'afterMood', value: Mood) => setDraft(current => ({ ...current, [key]: value }))

  return <section className="practice-view" aria-labelledby="practice-heading">
    <h1 id="practice-heading" className="timer-page-heading">{timeOfDay}</h1>
    <div className={`timer-card practice-timer-card ${active ? 'is-running' : ''} ${saved ? 'is-complete' : ''}`}>
      <div className="timer-label">Timer</div>
      <div className="timer-ring"><svg viewBox="0 0 280 280" aria-hidden="true"><circle className="ring-track" cx="140" cy="140" r="126" /><circle className="ring-progress" cx="140" cy="140" r="126" strokeDasharray={circumference} strokeDashoffset={circumference * (1 - progress)} /></svg><div className="timer-readout"><strong>{formatTime(displayRemaining)}</strong><span>{saved ? 'well done' : active ? 'remaining' : 'minutes'}</span></div></div>
      {!active && !saved && <div className="duration-control"><button aria-label="Decrease duration" onClick={() => setMinutes(value => Math.max(1, value - 1))}>−</button><label><input aria-label="Duration in minutes" inputMode="numeric" type="number" min="1" max="120" step="1" value={minutes} onChange={event => setMinutes(Math.min(120, Math.max(1, Math.round(Number(event.target.value) || 1))))} /><span>min</span></label><button aria-label="Increase duration" onClick={() => setMinutes(value => Math.min(120, value + 1))}>+</button></div>}
      {!active && !saved && <button className="sound-preview" type="button" onClick={() => { unlockBowlAudio(); playBowl() }}>Preview sound</button>}
      {active && <button className="text-button" onClick={() => void cancel()} disabled={busy}>End session early</button>}
      {saved && <><button className="primary-button" onClick={() => setReflection(true)}>Edit reflection <span>→</span></button><button className="text-button" onClick={beginNewSession}>New session</button></>}
      {!active && !saved && <button className="primary-button" onClick={() => void begin()} disabled={busy || disabled}>{busy ? 'Starting…' : user ? disabled ? 'Group practice active' : 'Begin practice' : 'Sign in to practice'} <span>→</span></button>}
      {error && <p className="practice-error" role="alert">{error} {active && completionFailedRef.current && <button onClick={() => { completionFailedRef.current = false; void completeNaturally(active) }}>Retry save</button>}</p>}
    </div>
    {reflection && <div className="modal-backdrop"><div className="auth-modal reflection-modal" role="dialog" aria-modal="true"><div className="eyebrow">A moment to notice</div><h2>How did it feel?</h2><p>Your reflections are private. Only your practice duration appears in the Circle.</p>{([['beforeMood','Before'],['duringMood','During'],['afterMood','After']] as const).map(([key, label]) => <fieldset className="mood-field" key={key}><legend>{label}</legend><div className="mood-options">{([1,2,3,4,5] as Mood[]).map(value => <button type="button" key={value} className={draft[key] === value ? 'selected' : ''} onClick={() => setMood(key, value)} aria-label={`${label} ${value} of 5`}>{value}</button>)}</div><small>{draft[key] ? moodWords[draft[key]! - 1] : 'choose one'}</small></fieldset>)}<label className="reflection-note">Notes<textarea value={draft.notes} onChange={event => setDraft(current => ({ ...current, notes: event.target.value }))} maxLength={6500} rows={4} placeholder="What did you notice before, during, or after?" /></label>{reflectionError && <p className="form-error" role="alert">{reflectionError}</p>}<button className="primary-button" onClick={() => void saveReflection()} disabled={reflectionBusy}>{reflectionBusy ? 'Saving…' : 'Save reflection'} <span>→</span></button><button className="text-button" onClick={() => setReflection(false)}>Skip for now</button></div></div>}
  </section>
}
