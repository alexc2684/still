'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import './practice-timer.css'
import { combineJournalNotes } from './journalNotes'
import { playBowl, unlockBowlAudio } from '@/lib/bowl'
import { storageGet, storageRemove, storageSet } from '@/lib/practice-storage'
import { queueOfflineJob, readOutbox } from '@/lib/offline-practice'
import TimerDial from './TimerDial'

export type PracticeTimerUser = { id: string; name?: string; email?: string }
export type Mood = 1 | 2 | 3 | 4 | 5

export type PracticeTimerProps = {
  user: PracticeTimerUser | null
  onSessionSaved?: () => void
  onSignIn?: () => void
  onActiveChange?: (active: boolean) => void
  disabled?: boolean
  offline?: boolean
}

type ActivePractice = {
  sessionId: string
  local?: boolean
  startedAt: string
  deadlineMs: number
  plannedSeconds: number
  paused?: boolean
  pausedRemainingSeconds?: number
}
type Draft = { beforeMood: Mood | null; duringMood: Mood | null; afterMood: Mood | null; notes: string; beforeNote?: string; duringNote?: string; afterNote?: string }
type Stored = ActivePractice & { completionPending?: boolean }
export function resolvePracticeSessionId(activeId: string | null | undefined, completedId: string | null, persistedId: string | null) { return activeId || completedId || persistedId }
export async function savePracticeReflection(sessionId: string | null, payload: Record<string, unknown>, onSaved?: () => void) { if (!sessionId) return null; const response = await fetch(`/api/sessions/${sessionId}/reflection`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }); if (!response.ok) { const body = await response.json().catch(() => ({})) as { error?: string }; throw new Error(body.error || 'Could not save reflection.') } onSaved?.(); return response }
const EMPTY_DRAFT: Draft = { beforeMood: null, duringMood: null, afterMood: null, notes: '' }
const moodWords = ['restless', 'scattered', 'steady', 'open', 'clear']

function jsonBody(response: Response) { return response.json().catch(() => ({})) as Promise<{ error?: string; session?: { id: string; started_at?: string; startedAt?: string; planned_seconds?: number; plannedSeconds?: number } }>; }

export default function PracticeTimer({ user, onSessionSaved, onSignIn, onActiveChange, disabled = false, offline = false }: PracticeTimerProps) {
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
  const [savedLocally, setSavedLocally] = useState(false)
  const [timeOfDay, setTimeOfDay] = useState('Time to sit')
  const ownerKeyRef = useRef<string | null>(null)
  const activeRef = useRef<ActivePractice | null>(null)
  const completedIdRef = useRef<string | null>(null)
  const completingRef = useRef(false)
  const completionFailedRef = useRef(false)
  const bellPlayedRef = useRef(false)
  const cancelingRef = useRef(false)
  const hydratedDraftKeyRef = useRef<string | null>(null)
  const wakeLockRef = useRef<WakeLockSentinel | null>(null)

  const persist = useCallback((value: Stored | null) => { value ? storageSet(storageKey, JSON.stringify(value)) : storageRemove(storageKey) }, [storageKey])
  const setCurrent = useCallback((value: ActivePractice | null) => { activeRef.current = value; setActive(value) }, [])
  const acquireWakeLock = useCallback(async () => { if (!('wakeLock' in navigator) || document.visibilityState !== 'visible') return; try { wakeLockRef.current = await navigator.wakeLock.request('screen') } catch { /* unsupported or denied */ } }, [])
  const releaseWakeLock = useCallback(() => { void wakeLockRef.current?.release().catch(() => undefined); wakeLockRef.current = null }, [])

  const completeNaturally = useCallback(async (session: ActivePractice, prompt = true) => {
    if (completingRef.current) return
    completingRef.current = true; setBusy(true); setError('')
    const payload = { elapsedSeconds: session.plannedSeconds }
    try {
      if (session.local || offline || navigator.onLine === false) {
        queueOfflineJob(user!.id, { id: session.sessionId, practice: { id: session.sessionId, startedAt: session.startedAt, plannedSeconds: session.plannedSeconds, completedAt: new Date(session.deadlineMs).toISOString() } })
        setSavedLocally(true)
      } else {
        let response = await fetch(`/api/sessions/${session.sessionId}/complete`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
        // A server clock can be just ahead of this device by one second.
        if (response.status === 422) { await new Promise(resolve => window.setTimeout(resolve, 1200)); response = await fetch(`/api/sessions/${session.sessionId}/complete`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }) }
        if (!response.ok) { const body = await jsonBody(response); throw new Error(body.error || 'Still could not save the completed session.') }
      }
      completedIdRef.current = session.sessionId; storageSet(reflectionSessionKey, session.sessionId); persist(null); setCurrent(null); setRemaining(0); setSaved(true); setReflection(prompt); onSessionSaved?.(); releaseWakeLock()
    } catch (err) {
      completionFailedRef.current = true; persist({ ...session, completionPending: true }); setError(err instanceof Error ? err.message : 'Could not save your session.');
    } finally { completingRef.current = false; setBusy(false) }
  }, [onSessionSaved, persist, reflectionSessionKey, releaseWakeLock, user, offline])

  useEffect(() => {
    if (ownerKeyRef.current !== storageKey) {
      ownerKeyRef.current = storageKey; setCurrent(null); setSaved(false); setSavedLocally(false); setReflection(false); completedIdRef.current = null; completionFailedRef.current = false; bellPlayedRef.current = false
    }
    if (!storageKey) { setCurrent(null); setSaved(false); setReflection(false); completedIdRef.current = null; return }
    try {
      const raw = storageGet(storageKey)
      if (!raw) return
      const item = JSON.parse(raw) as Stored
      if (!item.sessionId || !item.deadlineMs) return
      const validPaused = item.paused === true && Number.isFinite(item.pausedRemainingSeconds) && item.pausedRemainingSeconds! > 0 && item.pausedRemainingSeconds! <= item.plannedSeconds
      const restored = { local: item.local, sessionId: item.sessionId, startedAt: item.startedAt, deadlineMs: item.deadlineMs, plannedSeconds: item.plannedSeconds, paused: validPaused, pausedRemainingSeconds: validPaused ? item.pausedRemainingSeconds : undefined }
      setMinutes(Math.max(1, Math.min(120, Math.round(restored.plannedSeconds / 60)))); setCurrent(restored)
      if (validPaused) setRemaining(item.pausedRemainingSeconds!)
      else if (item.completionPending || item.deadlineMs <= Date.now()) void completeNaturally(restored, false)
    } catch { /* malformed local state is ignored */ }
  }, [storageKey, completeNaturally, setCurrent])

  useEffect(() => { hydratedDraftKeyRef.current = null; completedIdRef.current = null; setSaved(false); setReflection(false); setDraft(EMPTY_DRAFT); if (!draftKey) return; try { const raw = storageGet(draftKey); const completedId = storageGet(reflectionSessionKey); if (raw) { const legacy = JSON.parse(raw) as Partial<Draft>; const notes = typeof legacy.notes === 'string' ? legacy.notes : combineJournalNotes(legacy); setDraft({ beforeMood: legacy.beforeMood ?? null, duringMood: legacy.duringMood ?? null, afterMood: legacy.afterMood ?? null, notes }) } if (completedId) { completedIdRef.current = completedId; setSaved(true); setRemaining(0) } } catch { /* optional */ } hydratedDraftKeyRef.current = draftKey }, [draftKey, reflectionSessionKey])
  useEffect(() => { if (hydratedDraftKeyRef.current !== draftKey) return; storageSet(draftKey, JSON.stringify(draft)) }, [draft, draftKey])
  useEffect(() => {
    if (!active || active.paused) { releaseWakeLock(); return }
    void acquireWakeLock()
    const tick = () => { const next = Math.max(0, Math.ceil((active.deadlineMs - Date.now()) / 1000)); setRemaining(next); if (next <= 0 && !cancelingRef.current && activeRef.current?.sessionId === active.sessionId) { if (!bellPlayedRef.current) { bellPlayedRef.current = true; playBowl() } if (!completionFailedRef.current) void completeNaturally(active) } }
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
    if (!user) { onSignIn?.(); return }
    unlockBowlAudio(); completionFailedRef.current = false; bellPlayedRef.current = false; cancelingRef.current = false; setBusy(true); setError('')
    try {
      if (offline || navigator.onLine === false) {
        const startedAt = new Date().toISOString()
        const next = { local: true, sessionId: crypto.randomUUID(), startedAt, deadlineMs: Date.now() + minutes * 60000, plannedSeconds: minutes * 60 }
        // An offline session cannot start unless its recovery state is saved.
        localStorage.setItem(storageKey!, JSON.stringify(next))
        hydratedDraftKeyRef.current = draftKey; setSavedLocally(false); setSaved(false); setCurrent(next); setRemaining(next.plannedSeconds)
        return
      }
      const response = await fetch('/api/sessions/start', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ plannedSeconds: minutes * 60 }) })
      const body = await jsonBody(response)
      if (!response.ok || !body.session) throw new Error(body.error || 'Could not begin your practice.')
      const startedAt = body.session.startedAt || body.session.started_at
      const plannedSeconds = body.session.plannedSeconds || body.session.planned_seconds || minutes * 60
      if (!startedAt) throw new Error('The server did not return a start time.')
      const next = { sessionId: body.session.id, startedAt, deadlineMs: new Date(startedAt).getTime() + Math.round(plannedSeconds) * 1000, plannedSeconds: Math.round(plannedSeconds) }
      persist(next); hydratedDraftKeyRef.current = draftKey; setSaved(false); setCurrent(next); setRemaining(plannedSeconds)
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not begin your practice.') } finally { setBusy(false) }
  }
  function pause() {
    const running = active!
    const pausedRemainingSeconds = Math.max(0, Math.ceil((running.deadlineMs - Date.now()) / 1000))
    if (pausedRemainingSeconds <= 0) return
    const next = { ...running, paused: true, pausedRemainingSeconds }
    persist(next); setCurrent(next); setRemaining(pausedRemainingSeconds); releaseWakeLock()
  }
  function resume() {
    const paused = active!
    unlockBowlAudio()
    const seconds = paused.pausedRemainingSeconds!
    const next = { ...paused, paused: false, pausedRemainingSeconds: undefined, deadlineMs: Date.now() + seconds * 1000 }
    persist(next); setCurrent(next); setRemaining(seconds)
  }
  async function cancel() {
    cancelingRef.current = true; setBusy(true); setError('')
    try { if (!active!.local) { const response = await fetch(`/api/sessions/${active!.sessionId}`, { method: 'DELETE' }); if (!response.ok) { const body = await jsonBody(response); throw new Error(body.error || 'Could not end this practice.') } }; persist(null); setCurrent(null); setRemaining(minutes * 60); releaseWakeLock() } catch (err) { cancelingRef.current = false; setError(err instanceof Error ? err.message : 'Could not end this practice.') } finally { setBusy(false) }
  }
  async function saveReflection() {
    const sessionId = activeRef.current?.sessionId
    // completed session id is retained separately so reflection can be saved after completion.
    let persistedId: string | null = null
    persistedId = storageGet(reflectionSessionKey)
    const id = resolvePracticeSessionId(sessionId, completedIdRef.current, persistedId)
    setReflectionBusy(true); setReflectionError('')
    try {
      const payload = { beforeMood: draft.beforeMood ?? undefined, duringMood: draft.duringMood ?? undefined, afterMood: draft.afterMood ?? undefined, beforeNote: null, duringNote: null, afterNote: draft.notes }
      const finish = () => { beginNewSession(); onSessionSaved?.() }
      if (id && user && (offline || navigator.onLine === false || readOutbox(user.id).some(job => job.id === id))) {
        queueOfflineJob(user.id, { id, reflection: payload }); finish()
      } else await savePracticeReflection(id, payload, finish)
    } catch (err) { setReflectionError(err instanceof Error ? err.message : 'Could not save reflection.') } finally { setReflectionBusy(false) }
  }
  function beginNewSession() {
    completedIdRef.current = null; setSavedLocally(false); setSaved(false); setReflection(false); setReflectionError(''); setDraft(EMPTY_DRAFT); setRemaining(minutes * 60)
    hydratedDraftKeyRef.current = null
    storageRemove(draftKey); storageRemove(reflectionSessionKey)
  }
  const displayRemaining = active ? remaining : saved ? 0 : minutes * 60
  const setMood = (key: 'beforeMood' | 'duringMood' | 'afterMood', value: Mood) => setDraft(current => ({ ...current, [key]: value }))

  return <section className="practice-view" aria-labelledby="practice-heading">
    <div className="sit-heading">
      <div className="eyebrow">Sitting meditation</div>
      <h1 id="practice-heading" className="timer-page-heading">{timeOfDay}</h1>
    </div>
    <div className={`timer-card practice-timer-card ${active ? 'is-running' : ''} ${saved ? 'is-complete' : ''}`}>
      {saved && <div className="timer-label">Practice complete</div>}
      <TimerDial durationMinutes={active ? Math.round(active.plannedSeconds / 60) : minutes} remainingSeconds={displayRemaining} running={Boolean(active)} disabled={Boolean(active || saved)} onDurationChange={active || saved ? undefined : setMinutes} phaseLabel={saved ? 'well done' : active?.paused ? 'paused' : active ? 'remaining' : 'minutes'} />
      {!active && !saved && <button className="sound-preview" type="button" onClick={() => { unlockBowlAudio(); playBowl() }}>Preview sound</button>}
      {active && <div className="timer-session-actions"><button className="secondary-button" onClick={active.paused ? resume : pause} disabled={busy}>{active.paused ? 'Resume' : 'Pause'}</button>{active.paused && <button className="text-button" onClick={() => void cancel()} disabled={busy}>End session early</button>}</div>}
      {saved && <><button className="primary-button" onClick={() => setReflection(true)}>Record reflection <span>→</span></button><button className="text-button" onClick={beginNewSession}>New session</button></>}
      {!active && !saved && <button className="primary-button" onClick={() => void begin()} disabled={busy || disabled}>{busy ? 'Starting…' : user ? disabled ? 'Group practice active' : 'Begin practice' : 'Sign in to practice'} <span>→</span></button>}
      {savedLocally && <p role="status">Saved on this device. Your practice and reflection will sync when you reconnect.</p>}
      {error && <p className="practice-error" role="alert">{error} {active && completionFailedRef.current && <button onClick={() => { completionFailedRef.current = false; void completeNaturally(active) }}>Retry save</button>}</p>}
    </div>
    {reflection && <div className="modal-backdrop"><div className="auth-modal reflection-modal" role="dialog" aria-modal="true"><div className="eyebrow">A moment to notice</div><h2>How did it feel?</h2><p>Your reflections are private. Only your practice duration appears in the Circle.</p>{([['beforeMood','Before'],['duringMood','During'],['afterMood','After']] as const).map(([key, label]) => <fieldset className="mood-field" key={key}><legend>{label}</legend><div className="mood-options">{([1,2,3,4,5] as Mood[]).map(value => <button type="button" key={value} className={draft[key] === value ? 'selected' : ''} onClick={() => setMood(key, value)} aria-label={`${label} ${value} of 5`}>{value}</button>)}</div><small>{draft[key] ? moodWords[draft[key]! - 1] : 'choose one'}</small></fieldset>)}<label className="reflection-note">Notes<textarea value={draft.notes} onChange={event => setDraft(current => ({ ...current, notes: event.target.value }))} maxLength={6500} rows={4} placeholder="What did you notice before, during, or after?" /></label>{reflectionError && <p className="form-error" role="alert">{reflectionError}</p>}<button className="primary-button" onClick={() => void saveReflection()} disabled={reflectionBusy}>{reflectionBusy ? 'Saving…' : 'Save reflection'} <span>→</span></button><button className="text-button" onClick={() => setReflection(false)}>Skip for now</button></div></div>}
  </section>
}
