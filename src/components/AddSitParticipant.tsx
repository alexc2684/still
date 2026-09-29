'use client'

import { useState } from 'react'
import CircleMembers, { type CircleMember } from './CircleMembers'

type Props = { sitKey: string; memberIds: string[]; onAdded: () => Promise<unknown> }
export default function AddSitParticipant({ sitKey, memberIds, onAdded }: Props) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [added, setAdded] = useState<string[]>([])
  const [message, setMessage] = useState('')
  async function add(member: CircleMember) {
    setBusy(true); setError(''); setMessage('')
    try {
      const response = await fetch(`/api/shared-sits/${encodeURIComponent(sitKey)}/participants`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId: member.userId }) })
      if (!response.ok) { const body = await response.json(); throw new Error(body.error || 'Unable to add participant.') }
      setAdded(current => [...current, member.userId])
      setMessage(`${member.name} was added to the sit.`)
      await onAdded()
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to add participant.') }
    finally { setBusy(false) }
  }
  return <div className="add-sit-participant"><button className="secondary-button" aria-expanded={open} onClick={() => setOpen(value => !value)}>{open ? 'Close participant list' : 'Add participant'}</button>{open && <><p>Add someone who sat with you. This adds the sit to their practice history.</p>{error && <p className="form-error" role="alert">{error}</p>}{message && <p role="status">{message}</p>}<CircleMembers excludeIds={[...memberIds, ...added]} disabled={busy} onSelect={member => void add(member)} /></>}</div>
}
