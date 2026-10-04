'use client'
import { storageGet, storageRemove, storageSet } from './practice-storage'

export type OfflineUser = { id: string; name: string; email: string; timezone: string; weeklyTarget?: number; avatarKey?: string | null }
export type OfflinePractice = { id: string; startedAt: string; plannedSeconds: number; completedAt: string; elapsedSeconds?: number; endedEarly?: boolean }
export type OfflineJob = { id: string; practice?: OfflinePractice; reflection?: Record<string, unknown> }
const accountKey = 'still:offline-account'
const queueKey = (userId: string) => `still:outbox:${userId}`

export function readOfflineAccount(): { user: OfflineUser; dates: string[] } | null {
  try {
    const value = JSON.parse(storageGet(accountKey) || 'null')
    return value && typeof value.user?.id === 'string' && typeof value.user.timezone === 'string' && Array.isArray(value.dates) ? value : null
  } catch { return null }
}
export function rememberOfflineAccount(user: OfflineUser, dates: string[]) { storageSet(accountKey, JSON.stringify({ user, dates })) }
export function forgetOfflineAccount() { storageRemove(accountKey) }
export function readOutbox(userId: string): OfflineJob[] {
  const raw = localStorage.getItem(queueKey(userId))
  const jobs = JSON.parse(raw || '[]')
  if (!Array.isArray(jobs)) throw new Error('Your offline practice data could not be read. Please keep this browser data and retry.')
  return jobs
}
export function queueOfflineJob(userId: string, job: OfflineJob) {
  const jobs = readOutbox(userId)
  const existing = jobs.find(item => item.id === job.id)
  const next = existing ? jobs.map(item => item.id === job.id ? { ...item, ...job } : item) : [...jobs, job]
  // Unlike optional timer preferences, the outbox must be durable before showing success.
  localStorage.setItem(queueKey(userId), JSON.stringify(next))
  window.dispatchEvent(new Event('still:outbox'))
}

const syncing = new Map<string, Promise<boolean>>()
export function syncOfflineJobs(userId: string): Promise<boolean> {
  const current = syncing.get(userId)
  if (current) return current
  const run = (async () => {
    if (!navigator.onLine) return false
    const jobs = readOutbox(userId)
    for (const job of jobs) {
      // Never send another account's outbox using the current session cookie.
      const auth = await fetch('/api/auth/me')
      if (!auth.ok || (await auth.json()).user?.id !== userId) throw new Error('Sign in to the original account to sync your offline practice.')
      const response = await fetch(job.practice ? '/api/sessions/offline' : `/api/sessions/${job.id}/reflection`, {
        method: job.practice ? 'POST' : 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(job.practice ? { userId, ...job.practice, reflection: job.reflection } : job.reflection),
      })
      if (!response.ok) throw new Error('Your practice is saved on this device. Sync will retry when you reconnect.')
      // An edit made during the request must stay queued.
      const latest = readOutbox(userId).filter(item => JSON.stringify(item) !== JSON.stringify(job))
      localStorage.setItem(queueKey(userId), JSON.stringify(latest))
      window.dispatchEvent(new Event('still:outbox'))
    }
    return jobs.length > 0
  })().finally(() => syncing.delete(userId))
  syncing.set(userId, run)
  return run
}
