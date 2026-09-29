'use client'

import { useEffect, useState } from 'react'
import Avatar from './Avatar'
import './circle-members.css'

export type CircleMember = { userId: string; name: string; avatarKey?: string | null }
type Props = { excludeIds?: string[]; onSelect?: (member: CircleMember) => void; disabled?: boolean }

export default function CircleMembers({ excludeIds = [], onSelect, disabled = false }: Props) {
  const [members, setMembers] = useState<CircleMember[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    let active = true
    setLoading(true); setError('')
    async function load() {
      try {
        const response = await fetch('/api/circle/members', { cache: 'no-store' })
        if (!response.ok) throw new Error('Unable to load your circle.')
        const body = await response.json()
        if (active) setMembers(body.members)
      } catch { if (active) setError('Unable to load your circle.') }
      finally { if (active) setLoading(false) }
    }
    void load()
    return () => { active = false }
  }, [attempt])
  if (loading) return <p role="status">Loading your circle…</p>
  if (error) return <div role="alert">{error} <button className="text-button" onClick={() => setAttempt(value => value + 1)}>Try again</button></div>
  const visible = members.filter(member => !excludeIds.includes(member.userId))
  return <div className="circle-members">{visible.length === 0 ? <p>No more people to show.</p> : <ul aria-label="People in your circle">{visible.map(member => <li key={member.userId}>{onSelect ? <button disabled={disabled} onClick={() => onSelect(member)}><Avatar name={member.name} avatarKey={member.avatarKey} size="small" /><span>{member.name}</span><span className="member-add-label">Add</span></button> : <div><Avatar name={member.name} avatarKey={member.avatarKey} size="small" /><span>{member.name}</span></div>}</li>)}</ul>}</div>
}
