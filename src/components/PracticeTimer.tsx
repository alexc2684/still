'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import './practice-timer.css'
import { combineJournalNotes } from './journalNotes'

export type PracticeTimerUser = { id: string; name?: string; email?: string }
export type Mood = 1 | 2 | 3 | 4 | 5

export type PracticeTimerProps = {
  user: PracticeTimerUser | null
  onSessionSaved?: () => void
  onSignIn?: () => void
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

let audio: AudioContext | null = null
let bowlUntil = 0
function audioContext() {
  if (typeof window === 'undefined') return null
  if (!audio) {
    const Ctx = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (Ctx) audio = new Ctx()
  }
  return audio
}
function unlockAudio() {
  const ctx = audioContext()
  if (!ctx) return
  // Calling resume in the click handler preserves the user gesture on iOS.
  void ctx.resume()
  try {
    const osc = ctx.createOscillator(), gain = ctx.createGain()
    gain.gain.value = 0.00001
    osc.connect(gain).connect(ctx.destination); osc.start(); osc.stop(ctx.currentTime + 0.02)
  } catch { /* audio remains optional */ }
}
function ringBell() {
  const ctx = audioContext()
  if (!ctx) return
  const wallNow = typeof performance === 'undefined' ? Date.now() : performance.now()
  if (wallNow < bowlUntil) return
  bowlUntil = wallNow + 9000
  try {
    const now = ctx.currentTime, master = ctx.createGain()
    master.gain.value = 0.24; master.connect(ctx.destination)
    // Modal sine resonances of a bowl: the close pairs create a slow, tactile shimmer.
    const modes = [[180, 0.42, 9], [487.8, 0.18, 7], [486.1, 0.13, 7], [972, 0.09, 5.8], [970.9, 0.065, 5.8], [1602, 0.035, 4.2]] as const
    modes.forEach(([frequency, amplitude, decay]) => {
      const osc = ctx.createOscillator(), gain = ctx.createGain()
      osc.type = 'sine'; osc.frequency.setValueAtTime(frequency, now)
      gain.gain.setValueAtTime(0.0001, now); gain.gain.exponentialRampToValueAtTime(amplitude, now + 0.045); gain.gain.exponentialRampToValueAtTime(0.0001, now + decay)
      osc.connect(gain).connect(master); osc.start(now); osc.stop(now + decay + 0.1)
    })
    const buffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.09), ctx.sampleRate), samples = buffer.getChannelData(0)
    for (let index = 0; index < samples.length; index += 1) samples[index] = (Math.random() * 2 - 1) * (1 - index / samples.length)
    const strike = ctx.createBufferSource(), filter = ctx.createBiquadFilter(), strikeGain = ctx.createGain()
    strike.buffer = buffer; filter.type = 'lowpass'; filter.frequency.setValueAtTime(1800, now); strikeGain.gain.setValueAtTime(0.035, now); strikeGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.16)
    strike.connect(filter).connect(strikeGain).connect(master); strike.start(now)
  } catch { /* restrictive browsers can refuse audio */ }
}
function formatTime(seconds: number) { return `${Math.floor(seconds / 60).toString().padStart(2, '0')}:${(seconds % 60).toString().padStart(2, '0')}` }
function jsonBody(response: Response) { return response.json().catch(() => ({})) as Promise<{ error?: string; session?: { id: string; started_at?: string; startedAt?: string; planned_seconds?: number; plannedSeconds?: number } }>; }

export default function PracticeTimer({ user, onSessionSaved, onSignIn }: PracticeTimerProps) {
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
    const tick = () => { const next = Math.max(0, Math.ceil((active.deadlineMs - Date.now()) / 1000)); setRemaining(next); if (next <= 0 && !cancelingRef.current) { if (!bellPlayedRef.current) { bellPlayedRef.current = true; ringBell() } if (!completionFailedRef.current) void completeNaturally(active) } }
    tick(); const id = window.setInterval(tick, 250)
    const visibility = () => { if (document.visibilityState === 'visible') void acquireWakeLock() }
    document.addEventListener('visibilitychange', visibility)
    return () => { window.clearInterval(id); document.removeEventListener('visibilitychange', visibility) }
  }, [active, acquireWakeLock, completeNaturally, releaseWakeLock])
  useEffect(() => () => releaseWakeLock(), [releaseWakeLock])

  async function begin() {
    if (!user) { onSignIn?.(); return }
    unlockAudio(); completionFailedRef.current = false; bellPlayedRef.current = false; cancelingRef.current = false; setBusy(true); setError('')
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
    <div className="eyebrow">Your practice</div><div className="practice-heading-row"><div><h1 id="practice-heading">Make some room.</h1><p className="lede">A few quiet minutes, shared with people who understand.</p></div></div>
    <div className={`timer-card practice-timer-card ${active ? 'is-running' : ''} ${saved ? 'is-complete' : ''}`}>
      <div className="timer-label">{saved ? 'Session complete' : active ? 'Be here' : 'Settle in'}</div>
      <div className="timer-ring"><svg viewBox="0 0 280 280" aria-hidden="true"><circle className="ring-track" cx="140" cy="140" r="126" /><circle className="ring-progress" cx="140" cy="140" r="126" strokeDasharray={circumference} strokeDashoffset={circumference * (1 - progress)} /></svg><div className="timer-readout"><strong>{formatTime(displayRemaining)}</strong><span>{saved ? 'well done' : active ? 'remaining' : 'minutes'}</span></div></div>
      {!active && !saved && <div className="duration-control"><button aria-label="Decrease duration" onClick={() => setMinutes(value => Math.max(1, value - 1))}>−</button><label><input aria-label="Duration in minutes" inputMode="numeric" type="number" min="1" max="120" step="1" value={minutes} onChange={event => setMinutes(Math.min(120, Math.max(1, Math.round(Number(event.target.value) || 1))))} /><span>min</span></label><button aria-label="Increase duration" onClick={() => setMinutes(value => Math.min(120, value + 1))}>+</button></div>}
      {active && <button className="text-button" onClick={() => void cancel()} disabled={busy}>End session early</button>}
      {saved && <><button className="primary-button" onClick={() => setReflection(true)}>Edit reflection <span>→</span></button><button className="text-button" onClick={beginNewSession}>New session</button></>}
      {!active && !saved && <button className="primary-button" onClick={() => void begin()} disabled={busy}>{busy ? 'Starting…' : user ? 'Begin practice' : 'Sign in to practice'} <span>→</span></button>}
      {error && <p className="practice-error" role="alert">{error} {active && completionFailedRef.current && <button onClick={() => { completionFailedRef.current = false; void completeNaturally(active) }}>Retry save</button>}</p>}
    </div><div className="practice-foot"><span><span className="sound-icon">◉</span> A soft bowl will mark the end</span><span className="quiet-tip">Keep Still open while you practice</span><button className="sound-preview" type="button" onClick={() => { unlockAudio(); ringBell() }} disabled={Boolean(active)}>Preview sound</button></div>
    {reflection && <div className="modal-backdrop"><div className="auth-modal reflection-modal" role="dialog" aria-modal="true"><div className="eyebrow">A moment to notice</div><h2>How did it feel?</h2><p>Your reflections are private. Only your practice duration appears in the Circle.</p>{([['beforeMood','Before'],['duringMood','During'],['afterMood','After']] as const).map(([key, label]) => <fieldset className="mood-field" key={key}><legend>{label}</legend><div className="mood-options">{([1,2,3,4,5] as Mood[]).map(value => <button type="button" key={value} className={draft[key] === value ? 'selected' : ''} onClick={() => setMood(key, value)} aria-label={`${label} ${value} of 5`}>{value}</button>)}</div><small>{draft[key] ? moodWords[draft[key]! - 1] : 'choose one'}</small></fieldset>)}<label className="reflection-note">Notes<textarea value={draft.notes} onChange={event => setDraft(current => ({ ...current, notes: event.target.value }))} maxLength={6500} rows={4} placeholder="What did you notice before, during, or after?" /></label>{reflectionError && <p className="form-error" role="alert">{reflectionError}</p>}<button className="primary-button" onClick={() => void saveReflection()} disabled={reflectionBusy}>{reflectionBusy ? 'Saving…' : 'Save reflection'} <span>→</span></button><button className="text-button" onClick={() => setReflection(false)}>Skip for now</button></div></div>}
  </section>
}
