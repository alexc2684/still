import { render, screen, waitFor, fireEvent, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import PracticeTimer, { savePracticeReflection } from '@/components/PracticeTimer'

const reply = (body: unknown, ok = true, status = ok ? 200 : 500): Response => ({ ok, status, json: vi.fn().mockResolvedValue(body) } as unknown as Response)
const user = { id: 'recovery-user', name: 'Ada' }

beforeEach(() => { localStorage.clear(); vi.stubGlobal('fetch', vi.fn()); Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' }); Object.defineProperty(navigator, 'wakeLock', { configurable: true, value: { request: vi.fn().mockResolvedValue({ release: vi.fn().mockResolvedValue(undefined) }) } }) })
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('PracticeTimer recovery boundaries', () => {
  it('restores an unexpired active session without completing it', async () => {
    const now = Date.now(); localStorage.setItem('still:practice:recovery-user', JSON.stringify({ sessionId: 'active', startedAt: new Date(now - 1000).toISOString(), deadlineMs: now + 60_000, plannedSeconds: 60 }))
    render(<PracticeTimer user={user} />)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Pause' })).toBeInTheDocument())
    expect(vi.mocked(fetch)).not.toHaveBeenCalled()
  })

  it('restores, resumes, and persists a paused session without counting down while paused', async () => {
    const now = Date.now(); localStorage.setItem('still:practice:recovery-user', JSON.stringify({ sessionId: 'paused', startedAt: new Date(now - 30_000).toISOString(), deadlineMs: now - 1, plannedSeconds: 120, paused: true, pausedRemainingSeconds: 45 }))
    const ui = userEvent.setup(); render(<PracticeTimer user={user} />)
    await waitFor(() => expect(screen.getByText('paused')).toBeInTheDocument())
    expect(screen.getByText('00:45')).toBeInTheDocument(); expect(fetch).not.toHaveBeenCalled()
    await ui.click(screen.getByRole('button', { name: 'Resume' }))
    expect(screen.getByRole('button', { name: 'Pause' })).toBeInTheDocument()
    const resumed = JSON.parse(localStorage.getItem('still:practice:recovery-user')!)
    expect(resumed).toMatchObject({ sessionId: 'paused', paused: false }); expect(resumed.pausedRemainingSeconds).toBeUndefined(); expect(resumed.deadlineMs).toBeGreaterThan(now)
  })

  it('pauses an active session and ignores invalid persisted paused state', async () => {
    const now = Date.now(); localStorage.setItem('still:practice:recovery-user', JSON.stringify({ sessionId: 'active-pause', startedAt: new Date(now - 1000).toISOString(), deadlineMs: now + 60_000, plannedSeconds: 60 }))
    const ui = userEvent.setup(); render(<PracticeTimer user={user} />); await ui.click(await screen.findByRole('button', { name: 'Pause' }))
    expect(screen.getByText('paused')).toBeInTheDocument(); expect(JSON.parse(localStorage.getItem('still:practice:recovery-user')!)).toMatchObject({ paused: true, pausedRemainingSeconds: 60 })
    cleanup(); localStorage.setItem('still:practice:recovery-user', JSON.stringify({ sessionId: 'invalid-pause', startedAt: new Date(now - 1000).toISOString(), deadlineMs: now + 60_000, plannedSeconds: 60, paused: true, pausedRemainingSeconds: 61 }))
    render(<PracticeTimer user={user} />); await waitFor(() => expect(screen.getByRole('button', { name: 'Pause' })).toBeInTheDocument()); expect(screen.queryByText('paused')).not.toBeInTheDocument()
  })

  it('does not pause after the deadline has elapsed', async () => {
    const now = Date.now(); localStorage.setItem('still:practice:recovery-user', JSON.stringify({ sessionId: 'just-expired', startedAt: new Date(now - 1000).toISOString(), deadlineMs: now + 60_000, plannedSeconds: 60 }))
    render(<PracticeTimer user={user} />); const pause = await screen.findByRole('button', { name: 'Pause' }); vi.spyOn(Date, 'now').mockReturnValue(now + 60_001); fireEvent.click(pause); expect(screen.queryByText('paused')).not.toBeInTheDocument()
  })

  it('restores a completion-pending session and retries its completion', async () => {
    const now = Date.now(); localStorage.setItem('still:practice:recovery-user', JSON.stringify({ sessionId: 'pending', startedAt: new Date(now - 60_000).toISOString(), deadlineMs: now + 60_000, plannedSeconds: 60, completionPending: true }))
    vi.mocked(fetch).mockResolvedValueOnce(reply({}))
    render(<PracticeTimer user={user} />)
    await waitFor(() => expect(screen.getByText('well done')).toBeInTheDocument())
    expect(fetch).toHaveBeenCalledWith('/api/sessions/pending/complete', expect.anything())
  })

  it('hydrates legacy notes and a completed session id, preserving nullable moods in save payloads', async () => {
    localStorage.setItem('still:reflection:recovery-user', JSON.stringify({ beforeNote: 'before', duringNote: 'during', afterNote: 'after' }))
    localStorage.setItem('still:reflection-session:recovery-user', 'completed')
    vi.mocked(fetch).mockResolvedValueOnce(reply({ error: 'reflection rejected' }, false))
    const ui = userEvent.setup(); render(<PracticeTimer user={user} />)
    await ui.click(await screen.findByRole('button', { name: /Record reflection/ }))
    await waitFor(() => expect(screen.getByDisplayValue(/Before: before/)).toBeInTheDocument())
    await ui.click(screen.getByRole('button', { name: /Save reflection/ }))
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('reflection rejected'))
    expect(fetch).toHaveBeenCalledWith('/api/sessions/completed/reflection', expect.objectContaining({ method: 'PATCH' }))
  })

  it('handles generic reflection HTTP errors and unsupported or hidden wake lock paths', async () => {
    Object.defineProperty(navigator, 'wakeLock', { configurable: true, value: undefined }); Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' })
    localStorage.setItem('still:reflection-session:recovery-user', 'generic')
    vi.mocked(fetch).mockResolvedValueOnce(reply({}, false))
    const ui = userEvent.setup(); render(<PracticeTimer user={user} />)
    await ui.click(await screen.findByRole('button', { name: /Record reflection/ }))
    await waitFor(() => expect(screen.getByRole('button', { name: /Save reflection/ })).toBeInTheDocument()); await ui.click(screen.getByRole('button', { name: /Save reflection/ })); await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Could not save reflection.'))
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('handles malformed legacy draft fields and a plain-string reflection failure', async () => {
    localStorage.setItem('still:reflection:recovery-user', JSON.stringify({ notes: 42, beforeMood: null, duringMood: null, afterMood: null }))
    localStorage.setItem('still:reflection-session:recovery-user', 'plain')
    vi.mocked(fetch).mockRejectedValueOnce('offline')
    const ui = userEvent.setup(); render(<PracticeTimer user={user} />)
    await ui.click(await screen.findByRole('button', { name: /Record reflection/ }))
    await waitFor(() => expect(screen.getByRole('button', { name: /Save reflection/ })).toBeInTheDocument()); await ui.click(screen.getByRole('button', { name: /Save reflection/ })); await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Could not save reflection.'))
  })

  it('covers reflection helper null IDs, empty error bodies, and success callbacks', async () => {
    const saved = vi.fn(); expect(await savePracticeReflection(null, {})).toBeNull()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, json: vi.fn().mockRejectedValue('bad json') }))
    await expect(savePracticeReflection('helper', {})).rejects.toThrow('Could not save reflection.')
    vi.mocked(fetch).mockResolvedValueOnce(reply({})); await expect(savePracticeReflection('helper', {}, saved)).resolves.toBeTruthy(); expect(saved).toHaveBeenCalled()
  })

  it('takes the unsupported wake-lock early return', async () => {
    vi.stubGlobal('navigator', {})
    const now = Date.now(); localStorage.setItem('still:practice:recovery-user', JSON.stringify({ sessionId: 'hidden-wake', startedAt: new Date(now - 1000).toISOString(), deadlineMs: now + 60_000, plannedSeconds: 60 }))
    render(<PracticeTimer user={user} />)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Pause' })).toBeInTheDocument())
  })

  it('uses generic completion and cancellation messages when error bodies are empty', async () => {
    const now = Date.now(); localStorage.setItem('still:practice:recovery-user', JSON.stringify({ sessionId: 'generic-complete', startedAt: new Date(now - 60_000).toISOString(), deadlineMs: now + 60_000, plannedSeconds: 60, completionPending: true }))
    vi.mocked(fetch).mockResolvedValueOnce(reply({}, false))
    render(<PracticeTimer user={user} />)
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Still could not save the completed session.'))
    cleanup(); localStorage.clear(); vi.mocked(fetch).mockReset(); vi.mocked(fetch).mockResolvedValueOnce(reply({ session: { id: 'cancel-generic', startedAt: new Date().toISOString(), plannedSeconds: 60 } })).mockResolvedValueOnce(reply({}, false))
    const ui = userEvent.setup(); render(<PracticeTimer user={user} />); await ui.click(screen.getByRole('button', { name: /Begin practice/ })); await waitFor(() => expect(screen.getByRole('button', { name: 'Pause' })).toBeInTheDocument()); await ui.click(screen.getByRole('button', { name: 'Pause' })); await ui.click(screen.getByRole('button', { name: /End session/ })); await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Could not end this practice.'))
  })
})

it('keeps a stored reflection closed on launch and after skipping and reopening the app', async () => {
  localStorage.setItem('still:reflection-session:recovery-user', 'previous')
  localStorage.setItem('still:reflection:recovery-user', JSON.stringify({ notes: 'Keep this private draft' }))
  const view = render(<PracticeTimer user={user} />)
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  fireEvent.click(await screen.findByRole('button', { name: /Record reflection/ }))
  expect(screen.getByDisplayValue('Keep this private draft')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Skip for now' }))
  view.unmount(); render(<PracticeTimer user={user} />)
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  fireEvent.click(await screen.findByRole('button', { name: /Record reflection/ }))
  expect(screen.getByDisplayValue('Keep this private draft')).toBeInTheDocument()
  expect(fetch).not.toHaveBeenCalled()
})
it('recovers an overdue session on launch without interrupting with a reflection', async () => {
  localStorage.setItem('still:practice:recovery-user', JSON.stringify({ sessionId: 'overdue', startedAt: new Date(Date.now() - 120000).toISOString(), deadlineMs: Date.now() - 60000, plannedSeconds: 60 }))
  vi.mocked(fetch).mockResolvedValue(reply({}))
  render(<PracticeTimer user={user} />)
  await screen.findByRole('button', { name: /Record reflection/ })
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(fetch).toHaveBeenCalledWith('/api/sessions/overdue/complete', expect.anything())
})
it('does not expose a restored draft when switching to a different signed-in account', async () => {
  localStorage.setItem('still:reflection-session:recovery-user', 'private-session')
  localStorage.setItem('still:reflection:recovery-user', JSON.stringify({ notes: 'Private draft' }))
  const view = render(<PracticeTimer user={user} />)
  fireEvent.click(await screen.findByRole('button', { name: /Record reflection/ }))
  view.rerender(<PracticeTimer user={{ id: 'other-user', name: 'Other' }} />)
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: /Record reflection/ })).not.toBeInTheDocument()
  expect(localStorage.getItem('still:reflection:recovery-user')).toContain('Private draft')
})
