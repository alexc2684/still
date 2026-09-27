'use client'

import { useEffect, useRef, useState } from 'react'
import type { Mood } from './PracticeTimer'
import { combineJournalNotes } from './journalNotes'
import './private-reflection.css'

export type PrivateReflectionProps = { sessionId: string; userId: string; onSaved: () => void; onSkip: () => void }
type Draft = { beforeMood: Mood | null; duringMood: Mood | null; afterMood: Mood | null; notes: string }
type StoredDraft = Partial<Draft> & { beforeNote?: string | null; duringNote?: string | null; afterNote?: string | null }
const EMPTY: Draft = { beforeMood: null, duringMood: null, afterMood: null, notes: '' }
const moods = ['restless', 'scattered', 'steady', 'open', 'clear']

export default function PrivateReflection({ sessionId, userId, onSaved, onSkip }: PrivateReflectionProps) {
  const key = `still:reflection:${userId}:${sessionId}`
  const [draft, setDraft] = useState<Draft>(EMPTY)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [hydrating, setHydrating] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [retry, setRetry] = useState(0)
  const hydrated = useRef<string | null>(null)

  useEffect(() => {
    let cancelled = false
    hydrated.current = null; setHydrating(true); setDraft(EMPTY); setError(''); setLoadError('')
    async function load() {
      let raw: string | null = null
      try { raw = localStorage.getItem(key) } catch { /* storage is optional */ }
      let localLoaded = false
      let loadSucceeded = false
      if (raw) {
        try { const saved = JSON.parse(raw) as StoredDraft; localLoaded = true; loadSucceeded = true; if (!cancelled) setDraft({ beforeMood: saved.beforeMood ?? null, duringMood: saved.duringMood ?? null, afterMood: saved.afterMood ?? null, notes: typeof saved.notes === 'string' ? saved.notes : combineJournalNotes(saved) }) } catch { /* malformed draft falls through to server */ }
      }
      if (!localLoaded) {
        try {
          const response = await fetch('/api/sessions')
          if (!response.ok) throw new Error('Unable to load this private reflection.')
          const body = await response.json().catch(() => ({})) as { sessions?: Array<{ id: string; beforeMood?: Mood | null; duringMood?: Mood | null; afterMood?: Mood | null; beforeNote?: string | null; duringNote?: string | null; afterNote?: string | null }> }
          const session = body.sessions?.find(item => item.id === sessionId)
          if (session && !cancelled) setDraft({ beforeMood: session.beforeMood ?? null, duringMood: session.duringMood ?? null, afterMood: session.afterMood ?? null, notes: combineJournalNotes(session) })
          if (session) loadSucceeded = true
          if (!session) throw new Error('This private reflection is unavailable.')
        } catch (cause) { if (!cancelled) setLoadError(cause instanceof Error ? cause.message : 'Unable to load this private reflection.') }
      }
      if (!cancelled && loadSucceeded) { hydrated.current = key; setHydrating(false) }
    }
    void load()
    return () => { cancelled = true }
  }, [key, retry])
  useEffect(() => { if (hydrated.current !== key || hydrating || loadError) return; try { localStorage.setItem(key, JSON.stringify(draft)) } catch { /* storage is optional */ } }, [draft, hydrating, key, loadError])

  async function save() {
    setBusy(true); setError('')
    try {
      const response = await fetch(`/api/sessions/${sessionId}/reflection`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ beforeMood: draft.beforeMood ?? undefined, duringMood: draft.duringMood ?? undefined, afterMood: draft.afterMood ?? undefined, afterNote: draft.notes }) })
      const body = await response.json().catch(() => ({})) as { error?: string }
      if (!response.ok) throw new Error(body.error || 'Could not save reflection.')
      try { localStorage.removeItem(key) } catch { /* storage is optional */ }
      hydrated.current = null
      onSaved()
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not save reflection.') } finally { setBusy(false) }
  }
  const chooser = (field: 'beforeMood' | 'duringMood' | 'afterMood', label: string) => <fieldset className="private-mood" key={field}><legend>{label}</legend><div>{([1, 2, 3, 4, 5] as Mood[]).map(value => <button disabled={hydrating || Boolean(loadError)} type="button" key={value} className={draft[field] === value ? 'selected' : ''} onClick={() => setDraft(current => ({ ...current, [field]: value }))} aria-label={`${label} ${value} of 5`}>{value}</button>)}</div><small>{draft[field] ? moods[draft[field]! - 1] : 'choose one'}</small></fieldset>
  return <div className="private-reflection"><div className="eyebrow">A moment to notice</div><h2>How did it feel?</h2><p>Your reflections are private.</p>{chooser('beforeMood', 'Before')}{chooser('duringMood', 'During')}{chooser('afterMood', 'After')}<label className="private-notes">Notes<textarea disabled={hydrating || Boolean(loadError)} maxLength={6500} rows={4} value={draft.notes} onChange={event => setDraft(current => ({ ...current, notes: event.target.value }))} placeholder="What did you notice?" /></label>{error && <p className="form-error" role="alert">{error}</p>}{hydrating && !loadError && <p className="form-error" role="status">Loading your private reflection…</p>}{loadError && <><p className="form-error" role="alert">{loadError}</p><button className="text-button" type="button" onClick={() => setRetry(value => value + 1)}>Retry loading reflection</button></>}<button className="primary-button" type="button" onClick={() => void save()} disabled={busy || hydrating || Boolean(loadError)}>{busy ? 'Saving…' : hydrating ? 'Loading…' : 'Save reflection'} <span>→</span></button><button className="text-button" type="button" onClick={onSkip}>Skip for now</button></div>
}
