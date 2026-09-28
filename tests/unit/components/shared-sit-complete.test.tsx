import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import SharedSit from '@/components/SharedSit'

const mocks = vi.hoisted(() => ({ fetch: vi.fn(), playBowl: vi.fn(), unlockBowlAudio: vi.fn() }))
const fetchMock = mocks.fetch
const playBowl = mocks.playBowl
const unlockBowlAudio = mocks.unlockBowlAudio
vi.mock('@/lib/bowl', () => ({ playBowl: mocks.playBowl, unlockBowlAudio: mocks.unlockBowlAudio }))
vi.mock('@/components/Avatar', () => ({ default: ({ name }: { name: string }) => <span data-testid={`avatar-${name}`}>{name}</span> }))
vi.mock('@/components/TimerDial', () => ({ default: ({ phaseLabel, remainingSeconds, onDurationChange, disabled }: any) => <div><span data-testid="dial">{phaseLabel}:{remainingSeconds}</span>{onDurationChange && <input aria-label="Duration" disabled={disabled} onChange={e => onDurationChange(Number(e.target.value))} />}</div> }))
vi.mock('@/components/PrivateReflection', () => ({ default: ({ onSaved, onSkip }: any) => <div><button onClick={onSaved}>Save reflection</button><button onClick={onSkip}>Skip for now</button></div> }))

const host = { id: 'host', name: 'Host' }
const guest = { id: 'guest', name: 'Guest' }
const response = (body: unknown, ok = true) => ({ ok, json: vi.fn().mockResolvedValue(body) })
const room = (overrides: Record<string, unknown> = {}) => ({ id: 'r', inviteToken: 'abc', status: 'waiting', plannedSeconds: 10, hostUserId: 'host', isMember: true, participantCount: 1, ownSessionId: null, members: [{ userId: 'host', name: 'Host', avatarKey: null }], ...overrides })

describe('SharedSit complete behavior', () => {
  beforeEach(() => {
    fetchMock.mockReset(); vi.stubGlobal('fetch', fetchMock); localStorage.clear()
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: vi.fn().mockResolvedValue(undefined) } })
    Object.defineProperty(navigator, 'share', { configurable: true, value: undefined })
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' })
    Object.defineProperty(navigator, 'wakeLock', { configurable: true, value: { request: vi.fn().mockResolvedValue({ release: vi.fn().mockResolvedValue(undefined) }) } })
    vi.spyOn(window.history, 'replaceState'); playBowl.mockReset(); unlockBowlAudio.mockReset()
  })
  it('keeps planned seconds in seconds for waiting and scheduled-running dials', async () => {
    fetchMock.mockResolvedValueOnce(response({ room: room({ plannedSeconds: 600 }) })); render(<SharedSit user={host} onSignIn={vi.fn()} initialToken="abc" />); await waitFor(() => expect(screen.getByTestId('dial')).toHaveTextContent('minutes:600')); cleanup()
    const now = Date.now(); fetchMock.mockResolvedValueOnce(response({ room: room({ plannedSeconds: 600, status: 'running', startedAt: new Date(now + 3000).toISOString(), endsAt: new Date(now + 603000).toISOString() }) })); render(<SharedSit user={host} onSignIn={vi.fn()} initialToken="abc" />); await waitFor(() => expect(screen.getByTestId('dial')).toHaveTextContent(/Starting in/)); expect(screen.getByTestId('dial')).not.toHaveTextContent('36000')
  })
  afterEach(() => { cleanup(); vi.restoreAllMocks() })

  it('covers signed-out, disabled, URL token and sign-in paths', async () => {
    const signIn = vi.fn(); const { rerender } = render(<SharedSit user={null} onSignIn={signIn} />)
    expect(screen.getByText('Start a private shared sit with people you trust.')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /sign in/i })); expect(signIn).toHaveBeenCalled()
    rerender(<SharedSit user={null} onSignIn={signIn} initialToken="abc" />); expect(screen.getByText('You’ve been invited to sit together.')).toBeInTheDocument()
    rerender(<SharedSit user={host} onSignIn={signIn} disabled />); expect(screen.getByRole('button', { name: /create/i })).toBeDisabled()
    await userEvent.click(screen.getByRole('button', { name: /create/i })); expect(fetchMock).not.toHaveBeenCalled()
  })

  it('creates a sit, adjusts duration, loads query token and handles malformed load errors', async () => {
    const active = vi.fn(); fetchMock.mockResolvedValueOnce(response({ room: room() })).mockResolvedValueOnce(response({ room: room() }))
    render(<SharedSit user={host} onSignIn={vi.fn()} onActiveChange={active} />)
    fireEvent.change(screen.getByLabelText('Duration'), { target: { value: '2' } }); await userEvent.click(screen.getByRole('button', { name: /create/i }))
    await waitFor(() => expect(screen.getByText(/Waiting for your people/)).toBeInTheDocument()); expect(window.history.replaceState).toHaveBeenCalled(); expect(active).toHaveBeenCalledWith(true)
    cleanup(); fetchMock.mockReset(); fetchMock.mockResolvedValueOnce({ ok: false, json: vi.fn().mockRejectedValue(new Error('bad json')) })
    render(<SharedSit user={guest} onSignIn={vi.fn()} initialToken="bad" />); await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('This invitation is unavailable.'))
    cleanup(); window.history.replaceState({}, '', '/?sit=from-url'); fetchMock.mockResolvedValueOnce(response({ room: room({ isHost: false, isMember: false, hostUserId: 'other' }) }))
    render(<SharedSit user={guest} onSignIn={vi.fn()} />); await waitFor(() => expect(screen.getByRole('button', { name: /join/i })).toBeInTheDocument())
  })

  it('handles creation errors and non-Error rejection', async () => {
    window.history.replaceState({}, '', '/')
    fetchMock.mockResolvedValueOnce(response({ error: 'create nope' }, false)); const { rerender } = render(<SharedSit user={host} onSignIn={vi.fn()} />)
    await userEvent.click(screen.getByRole('button', { name: /create/i })); await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('create nope'))
    fetchMock.mockRejectedValueOnce('offline'); await userEvent.click(screen.getByRole('button', { name: /create/i })); await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Unable to create shared sit.'))
    rerender(<SharedSit user={null} onSignIn={vi.fn()} />)
  })

  it('joins, starts, leaves and cancels with all action guards and failures', async () => {
    fetchMock.mockResolvedValueOnce(response({ room: room({ isMember: false, hostUserId: 'other' }) })); render(<SharedSit user={guest} onSignIn={vi.fn()} initialToken="abc" />)
    await waitFor(() => expect(screen.getByRole('button', { name: /join/i })).toBeInTheDocument()); fetchMock.mockResolvedValueOnce(response({})).mockResolvedValueOnce(response({ room: room({ isMember: true, hostUserId: 'other' }) })); await userEvent.click(screen.getByRole('button', { name: /join/i })); await waitFor(() => expect(screen.getByRole('button', { name: /leave/i })).toBeInTheDocument())
    fetchMock.mockResolvedValueOnce(response({ error: 'leave nope' }, false)); await userEvent.click(screen.getByRole('button', { name: /leave/i })); await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('leave nope'))
    cleanup(); fetchMock.mockResolvedValueOnce(response({ room: room() })); render(<SharedSit user={host} onSignIn={vi.fn()} initialToken="abc" />); await waitFor(() => expect(screen.getByRole('button', { name: /start/i })).toBeInTheDocument()); fetchMock.mockResolvedValueOnce(response({ error: 'start nope' }, false)); await userEvent.click(screen.getByRole('button', { name: /start/i })); await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('start nope'))
    vi.spyOn(window, 'confirm').mockReturnValue(false); await userEvent.click(screen.getByRole('button', { name: /cancel/i })); vi.spyOn(window, 'confirm').mockReturnValue(true); fetchMock.mockRejectedValueOnce(new Error('cancel nope')); await userEvent.click(screen.getByRole('button', { name: /cancel/i })); await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('cancel nope'))
  })

  it('shares through clipboard and native share, including failures and disabled actions', async () => {
    fetchMock.mockResolvedValueOnce(response({ room: room() })); render(<SharedSit user={host} onSignIn={vi.fn()} initialToken="abc" />); await waitFor(() => expect(screen.getByRole('button', { name: 'Share invitation' })).toBeInTheDocument())
    const shareButton = () => screen.getByRole('button', { name: 'Share invitation' }); await userEvent.click(shareButton()); expect(navigator.clipboard.writeText).toHaveBeenCalledWith('http://localhost:3000/?sit=abc'); await waitFor(() => expect(screen.getByDisplayValue('http://localhost:3000/?sit=abc')).toBeInTheDocument())
    ;(navigator.clipboard.writeText as any).mockRejectedValueOnce(new Error('no clipboard')); await userEvent.click(screen.getByRole('button', { name: /link copied/i })); await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Copy the invitation URL'))
    const share = vi.fn().mockResolvedValue(undefined); Object.defineProperty(navigator, 'share', { configurable: true, value: share }); await userEvent.click(screen.getByRole('button', { name: /link copied/i })); expect(share).toHaveBeenCalled()
    share.mockRejectedValueOnce(new Error('cancelled')); await userEvent.click(screen.getByRole('button', { name: /link copied/i })); await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Copy the invitation URL'))
  })

  it('runs host countdown, wake lock lifecycle, completion retry and reflection acknowledgement', async () => {
    const now = Date.now(); const running = room({ status: 'running', startedAt: new Date(now - 5000).toISOString(), endsAt: new Date(now - 1000).toISOString(), ownSessionId: 's1' }); fetchMock.mockResolvedValueOnce(response({ room: running })).mockResolvedValueOnce(response({ error: 'complete nope' }, false)).mockResolvedValueOnce(response({})).mockResolvedValueOnce(response({ room: { ...running, status: 'completed' } })); render(<SharedSit user={host} onSignIn={vi.fn()} initialToken="abc" />)
    await waitFor(() => expect(screen.getByRole('button', { name: /retry completion/i })).toBeInTheDocument()); expect(playBowl).toHaveBeenCalled(); const request = (navigator.wakeLock.request as any); expect(request).toHaveBeenCalledWith('screen'); fireEvent(document, new Event('visibilitychange')); expect(request).toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: /retry completion/i })); await userEvent.click(screen.getByRole('button', { name: /skip/i })); await waitFor(() => expect(screen.getByText(/sit is complete/i)).toBeInTheDocument()); await userEvent.click(screen.getByRole('button', { name: /edit reflection/i })); await userEvent.click(screen.getByRole('button', { name: /skip/i })); expect(localStorage.getItem('still:shared-reflection-ack:host:s1')).toBe('1')
  })

  it('handles completed and cancelled rooms, storage failures, another sit, user changes and stale polls', async () => {
    const onActive = vi.fn(); const completed = room({ status: 'completed', ownSessionId: 's2' }); fetchMock.mockResolvedValueOnce(response({ room: completed })); const { rerender } = render(<SharedSit user={guest} onSignIn={vi.fn()} initialToken="abc" onActiveChange={onActive} />); await waitFor(() => expect(screen.getByRole('button', { name: /skip/i })).toBeInTheDocument())
    await userEvent.click(screen.getByRole('button', { name: /skip/i }));
    fetchMock.mockResolvedValueOnce(response({ room: room({ status: 'cancelled', isMember: false }) })); rerender(<SharedSit user={host} onSignIn={vi.fn()} initialToken="abc" />); await waitFor(() => expect(screen.getByText(/cancelled/i)).toBeInTheDocument()); await userEvent.click(screen.getByRole('button', { name: /another/i })); expect(screen.getByText(/sit together/i)).toBeInTheDocument()
    rerender(<SharedSit user={null} onSignIn={vi.fn()} />); rerender(<SharedSit user={guest} onSignIn={vi.fn()} />); expect(screen.getByRole('button', { name: /create private/i })).toBeInTheDocument()
  })

  it('selects the invitation field, resets copied state, and releases hidden wake locks', async () => {
    const now = Date.now(); const running = room({ status: 'running', startedAt: new Date(now - 1000).toISOString(), endsAt: new Date(now + 60000).toISOString() }); fetchMock.mockResolvedValueOnce(response({ room: running })); const { unmount } = render(<SharedSit user={host} onSignIn={vi.fn()} initialToken="abc" />)
    await waitFor(() => expect(screen.getByRole('button', { name: /share invitation/i })).toBeInTheDocument()); await userEvent.click(screen.getByRole('button', { name: /share invitation/i })); const input = screen.getByRole('textbox'); const select = vi.spyOn(input as HTMLInputElement, 'select'); fireEvent.focus(input); expect(select).toHaveBeenCalled();
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' }); fireEvent(document, new Event('visibilitychange')); await Promise.resolve(); expect((navigator.wakeLock.request as any)).toHaveBeenCalled(); unmount()
  })

  it('saves completed reflection and exercises non-Error action recovery', async () => {
    const saved = vi.fn(); const completed = room({ status: 'completed', ownSessionId: 'saved' }); fetchMock.mockResolvedValueOnce(response({ room: completed })); render(<SharedSit user={guest} onSignIn={vi.fn()} initialToken="abc" onSessionSaved={saved} />); await waitFor(() => expect(screen.getByRole('button', { name: /save reflection/i })).toBeInTheDocument()); await userEvent.click(screen.getByRole('button', { name: /save reflection/i })); expect(saved).toHaveBeenCalled()
    cleanup(); fetchMock.mockResolvedValueOnce(response({ room: room() })); render(<SharedSit user={host} onSignIn={vi.fn()} initialToken="abc" />); await waitFor(() => expect(screen.getByRole('button', { name: /start shared sit/i })).toBeInTheDocument()); fetchMock.mockRejectedValueOnce('offline'); await userEvent.click(screen.getByRole('button', { name: /start shared sit/i })); await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Unable to update shared sit.'))
  })

  it('records server clock offset, completes successfully, and leaves cleanly', async () => {
    const saved = vi.fn(); const now = Date.now(); const running = room({ status: 'running', startedAt: new Date(now - 1000).toISOString(), endsAt: new Date(now - 1000).toISOString(), ownSessionId: 'done', serverNow: new Date(now).toISOString() }); fetchMock.mockResolvedValueOnce(response({ room: running })).mockResolvedValueOnce(response({})).mockResolvedValueOnce(response({ room: { ...running, status: 'completed' } })); render(<SharedSit user={host} onSignIn={vi.fn()} initialToken="abc" onSessionSaved={saved} />); await waitFor(() => expect(screen.getByRole('button', { name: /skip/i })).toBeInTheDocument()); await userEvent.click(screen.getByRole('button', { name: /skip/i })); await waitFor(() => expect(screen.getByText(/sit is complete/i)).toBeInTheDocument()); expect(saved).toHaveBeenCalled()
    cleanup(); fetchMock.mockResolvedValueOnce(response({ room: room({ isMember: true, isHost: false, hostUserId: 'other' }) })); render(<SharedSit user={guest} onSignIn={vi.fn()} initialToken="abc" />); await waitFor(() => expect(screen.getByRole('button', { name: /leave waiting/i })).toBeInTheDocument()); fetchMock.mockResolvedValueOnce(response({})); await userEvent.click(screen.getByRole('button', { name: /leave waiting/i })); await waitFor(() => expect(screen.getByText(/sit together/i)).toBeInTheDocument())
  })

  it('handles a future start countdown and stale in-flight room response', async () => {
    const now = Date.now(); fetchMock.mockResolvedValueOnce(response({ room: room({ status: 'running', startedAt: new Date(now + 5000).toISOString(), endsAt: new Date(now + 60000).toISOString() }) })); render(<SharedSit user={host} onSignIn={vi.fn()} initialToken="abc" />); await waitFor(() => expect(screen.getByText(/Starting in/)).toBeInTheDocument()); cleanup()
    let resolve!: (value: unknown) => void; fetchMock.mockReset(); fetchMock.mockReturnValueOnce(new Promise(r => { resolve = r })); const { rerender } = render(<SharedSit user={guest} onSignIn={vi.fn()} initialToken="abc" />); rerender(<SharedSit user={null} onSignIn={vi.fn()} />); resolve(response({ room: room() })); await Promise.resolve(); expect(screen.getByText(/Make space together/)).toBeInTheDocument()
  })

  it('reports polling failures and refreshes after a successful start', async () => {
    fetchMock.mockRejectedValueOnce(new Error('poll down')); render(<SharedSit user={guest} onSignIn={vi.fn()} initialToken="abc" />); await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('poll down')); cleanup()
    fetchMock.mockResolvedValueOnce(response({ room: room() })); render(<SharedSit user={host} onSignIn={vi.fn()} initialToken="abc" />); await waitFor(() => expect(screen.getByRole('button', { name: /start shared sit/i })).toBeInTheDocument()); fetchMock.mockResolvedValueOnce(response({})).mockResolvedValueOnce(response({ room: room({ status: 'running', startedAt: new Date().toISOString(), endsAt: new Date(Date.now() + 60000).toISOString() }) })); await userEvent.click(screen.getByRole('button', { name: /start shared sit/i })); await waitFor(() => expect(screen.getByText(/Be here, together/)).toBeInTheDocument())
  })

  it('polls on schedule, skips overlapping refreshes, and cleans up polling', async () => {
    vi.useFakeTimers(); const pending = Promise.resolve(response({ room: room() })); fetchMock.mockReturnValue(pending); render(<SharedSit user={host} onSignIn={vi.fn()} initialToken="abc" />); await act(async () => { await pending }); await act(async () => { vi.advanceTimersByTime(2500); await Promise.resolve() }); expect(fetchMock.mock.calls.length).toBeGreaterThan(1); cleanup(); vi.useRealTimers()
  })

  it('handles completion response JSON failure and empty member data', async () => {
    const running = room({ status: 'running', startedAt: new Date(Date.now() - 5000).toISOString(), endsAt: new Date(Date.now() - 1000).toISOString(), ownSessionId: 'bad' }); fetchMock.mockResolvedValueOnce(response({ room: running })).mockResolvedValueOnce({ ok: false, json: vi.fn().mockRejectedValue('bad-json') }); render(<SharedSit user={host} onSignIn={vi.fn()} initialToken="abc" />); await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Unable to complete shared sit.')); cleanup()
    fetchMock.mockResolvedValueOnce(response({ room: room({ members: undefined, isMember: false, hostUserId: 'other' }) })); render(<SharedSit user={guest} onSignIn={vi.fn()} initialToken="abc" />); await waitFor(() => expect(screen.getByText(/You’ve been invited/)).toBeInTheDocument())
  })

  it('covers clock ticks, wake-lock rejection, copied timeout, and running guest leave', async () => {
    const now = Date.now(); const running = room({ status: 'running', startedAt: new Date(now - 1000).toISOString(), endsAt: new Date(now + 30000).toISOString() }); const release = vi.fn().mockRejectedValue(new Error('release')); (navigator.wakeLock.request as any).mockResolvedValueOnce({ release }); fetchMock.mockResolvedValueOnce(response({ room: running })); vi.useFakeTimers(); render(<SharedSit user={host} onSignIn={vi.fn()} initialToken="abc" />); await act(async () => { await Promise.resolve() }); await act(async () => { vi.advanceTimersByTime(1000); await Promise.resolve() }); expect(screen.getByTestId('dial')).toHaveTextContent('remaining'); cleanup(); vi.useRealTimers()
    const clip = navigator.clipboard.writeText as any; fetchMock.mockResolvedValueOnce(response({ room: room() })); render(<SharedSit user={host} onSignIn={vi.fn()} initialToken="abc" />); await waitFor(() => expect(screen.getByRole('button', { name: /share invitation/i })).toBeInTheDocument()); await userEvent.click(screen.getByRole('button', { name: /share invitation/i })); vi.useFakeTimers(); await act(async () => { vi.advanceTimersByTime(1800); await Promise.resolve() }); expect(clip).toHaveBeenCalled(); vi.useRealTimers(); cleanup()
    fetchMock.mockResolvedValueOnce(response({ room: { ...running, isHost: false, hostUserId: 'other', isMember: true } })); render(<SharedSit user={guest} onSignIn={vi.fn()} initialToken="abc" />); await waitFor(() => expect(screen.getByRole('button', { name: /leave sit/i })).toBeInTheDocument()); fetchMock.mockResolvedValueOnce(response({})); await userEvent.click(screen.getByRole('button', { name: /leave sit/i })); await waitFor(() => expect(screen.getByText(/sit together/i)).toBeInTheDocument())
  })

  it('exercises malformed JSON fallback for create and action responses', async () => {
    window.history.replaceState({}, '', '/'); fetchMock.mockResolvedValueOnce({ ok: false, json: vi.fn().mockRejectedValue(new Error('bad')) }); render(<SharedSit user={host} onSignIn={vi.fn()} />); await userEvent.click(screen.getByRole('button', { name: /create private/i })); await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Unable to create shared sit.')); cleanup()
    fetchMock.mockResolvedValueOnce(response({ room: room() })); render(<SharedSit user={host} onSignIn={vi.fn()} initialToken="abc" />); await waitFor(() => expect(screen.getByRole('button', { name: /cancel sit/i })).toBeInTheDocument()); vi.spyOn(window, 'confirm').mockReturnValue(true); fetchMock.mockResolvedValueOnce({ ok: false, json: vi.fn().mockRejectedValue(new Error('bad')) }); await userEvent.click(screen.getByRole('button', { name: /cancel sit/i })); await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Unable to update shared sit.'))
  })

  it('handles wake-lock request rejection and the clipboard reset callback', async () => {
    const request = navigator.wakeLock.request as any; request.mockRejectedValueOnce(new Error('denied')); const now = Date.now(); fetchMock.mockResolvedValueOnce(response({ room: room({ status: 'running', startedAt: new Date(now - 1000).toISOString(), endsAt: new Date(now + 30000).toISOString() }) })); render(<SharedSit user={host} onSignIn={vi.fn()} initialToken="abc" />); await waitFor(() => expect(screen.getByText(/Be here/)).toBeInTheDocument()); fireEvent(document, new Event('visibilitychange')); cleanup()
    fetchMock.mockResolvedValueOnce(response({ room: room() })); render(<SharedSit user={host} onSignIn={vi.fn()} initialToken="abc" />); await waitFor(() => expect(screen.getByRole('button', { name: /share invitation/i })).toBeInTheDocument()); vi.useFakeTimers(); fireEvent.click(screen.getByRole('button', { name: /share invitation/i })); await act(async () => { await Promise.resolve(); vi.advanceTimersByTime(1800); await Promise.resolve() }); expect(screen.getByRole('button', { name: /share invitation/i })).toBeInTheDocument(); vi.useRealTimers()
  })

  it('does not resurrect a room from an overlapping or cancelled poll', async () => {
    vi.useFakeTimers(); let resolve!: (value: unknown) => void; fetchMock.mockReturnValue(new Promise(r => { resolve = r })); const { unmount } = render(<SharedSit user={guest} onSignIn={vi.fn()} initialToken="abc" />); await act(async () => { vi.advanceTimersByTime(2500); await Promise.resolve() }); expect(fetchMock).toHaveBeenCalledTimes(1); unmount(); resolve(response({ room: room() })); await act(async () => { await Promise.resolve() }); vi.useRealTimers(); expect(screen.queryByText(/Waiting for your people/)).not.toBeInTheDocument()
  })

  it('uses generic completion errors and participant fallback disabling', async () => {
    const running = room({ status: 'running', startedAt: new Date(Date.now() - 5000).toISOString(), endsAt: new Date(Date.now() - 1000).toISOString(), ownSessionId: 'generic' }); fetchMock.mockResolvedValueOnce(response({ room: running })).mockResolvedValueOnce({ ok: false, json: vi.fn().mockResolvedValue({}) }); render(<SharedSit user={host} onSignIn={vi.fn()} initialToken="abc" />); await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Unable to complete shared sit.')); cleanup()
    fetchMock.mockResolvedValueOnce(response({ room: room({ participantCount: undefined, members: undefined }) })); render(<SharedSit user={host} onSignIn={vi.fn()} initialToken="abc" />); await waitFor(() => expect(screen.getByRole('button', { name: /start shared sit/i })).toBeDisabled())
  })

  it('ignores a queued poll callback after unmount', async () => {
    let queued: (() => void) | undefined; const real = window.setInterval; vi.spyOn(window, 'setInterval').mockImplementation(((cb: TimerHandler, ms?: number) => { if (ms === 2500) queued = cb as () => void; return real(cb, ms) }) as typeof window.setInterval); fetchMock.mockResolvedValueOnce(response({ room: room() })); const { unmount } = render(<SharedSit user={guest} onSignIn={vi.fn()} initialToken="abc" />); await waitFor(() => expect(screen.getByText(/Waiting for your people/)).toBeInTheDocument()); const count = fetchMock.mock.calls.length; unmount(); queued?.(); await Promise.resolve(); expect(fetchMock).toHaveBeenCalledTimes(count)
  })

  it('rings when host observes server-completed state before local expiry', async () => {
    let queued: (() => void) | undefined; const real = window.setInterval; vi.spyOn(window, 'setInterval').mockImplementation(((cb: TimerHandler, ms?: number) => { if (ms === 2500) queued = cb as () => void; return real(cb, ms) }) as typeof window.setInterval); const now = Date.now(); const running = room({ status: 'running', startedAt: new Date(now - 1000).toISOString(), endsAt: new Date(now + 60000).toISOString() }); fetchMock.mockResolvedValueOnce(response({ room: running })); render(<SharedSit user={host} onSignIn={vi.fn()} initialToken="abc" />); await waitFor(() => expect(screen.getByText(/Be here/)).toBeInTheDocument()); fetchMock.mockResolvedValueOnce(response({ room: { ...running, status: 'completed' } })); queued?.(); await waitFor(() => expect(screen.getByText(/sit is complete/)).toBeInTheDocument()); expect(playBowl).toHaveBeenCalled()
  })

  it('covers successful completion and non-leave action refreshes by route', async () => {
    const now = Date.now(); const running = room({ status: 'running', startedAt: new Date(now - 5000).toISOString(), endsAt: new Date(now - 1000).toISOString(), ownSessionId: 'ok' }); fetchMock.mockImplementation((url: string) => url.endsWith('/complete') ? Promise.resolve(response({})) : Promise.resolve(response({ room: url.includes('/api/shared-sits/abc') ? { ...running, status: 'completed' } : running }))); render(<SharedSit user={host} onSignIn={vi.fn()} initialToken="abc" />); await waitFor(() => expect(screen.getByText(/sit is complete/)).toBeInTheDocument()); cleanup()
    let first = true; fetchMock.mockImplementation((url: string) => Promise.resolve(url.endsWith('/start') ? response({}) : response({ room: first ? (first = false, room()) : { ...running, status: 'running', endsAt: new Date(now + 60000).toISOString() } }))); render(<SharedSit user={host} onSignIn={vi.fn()} initialToken="abc" />); await waitFor(() => expect(screen.getByRole('button', { name: /start shared sit/i })).toBeInTheDocument()); await userEvent.click(screen.getByRole('button', { name: /start shared sit/i })); await waitFor(() => expect(screen.getByText(/Be here/)).toBeInTheDocument())
  })

  it('uses generic polling error text for non-Error failures', async () => {
    fetchMock.mockRejectedValueOnce('offline'); render(<SharedSit user={guest} onSignIn={vi.fn()} initialToken="abc" />); await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Unable to load shared sit.'))
  })

  it('completes an expired host session and opens its reflection', async () => {
    const expired = room({ status: 'running', ownSessionId: 'complete-me', startedAt: new Date(Date.now() - 10000).toISOString(), endsAt: new Date(Date.now() - 1000).toISOString() }); let getCount = 0; fetchMock.mockImplementation((url: string, init?: RequestInit) => { if (url.endsWith('/complete')) return Promise.resolve(response({ ok: true })); if (init?.method === 'POST') return Promise.resolve(response({})); getCount += 1; return Promise.resolve(response({ room: getCount === 1 ? expired : { ...expired, status: 'completed' } })) }); render(<SharedSit user={host} onSignIn={vi.fn()} initialToken="abc" />); await waitFor(() => expect(screen.getByRole('button', { name: /save reflection/i })).toBeInTheDocument()); expect(fetchMock).toHaveBeenCalledWith('/api/shared-sits/abc/complete', expect.objectContaining({ method: 'POST' })); expect(screen.getByRole('button', { name: /save reflection/i })).toBeInTheDocument()
  })

  it('starts a waiting host session and loads the running snapshot', async () => {
    const running = room({ status: 'running', startedAt: new Date().toISOString(), endsAt: new Date(Date.now() + 60000).toISOString() }); let getCount = 0; fetchMock.mockImplementation((url: string, init?: RequestInit) => { if (init?.method === 'POST') return Promise.resolve(response({})); getCount += 1; return Promise.resolve(response({ room: getCount === 1 ? room() : running })) }); render(<SharedSit user={host} onSignIn={vi.fn()} initialToken="abc" />); await waitFor(() => expect(screen.getByRole('button', { name: /start shared sit/i })).toBeInTheDocument()); await userEvent.click(screen.getByRole('button', { name: /start shared sit/i })); await waitFor(() => expect(screen.getByText(/Be here/)).toBeInTheDocument()); expect(unlockBowlAudio).toHaveBeenCalledOnce()
  })

  it('suppresses errors from a GET that rejects after unmount', async () => {
    let reject!: (reason: unknown) => void; fetchMock.mockReturnValueOnce(new Promise((_, r) => { reject = r })); const { unmount } = render(<SharedSit user={guest} onSignIn={vi.fn()} initialToken="abc" />); unmount(); reject('late failure'); await Promise.resolve(); expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('prevents overlapping completion retries while the first retry is pending', async () => {
    const expired = room({ status: 'running', startedAt: new Date(Date.now() - 5000).toISOString(), endsAt: new Date(Date.now() - 1000).toISOString(), ownSessionId: 'retry' }); let retryResolve!: (value: unknown) => void; fetchMock.mockResolvedValueOnce(response({ room: expired })).mockResolvedValueOnce(response({ error: 'first failed' }, false)); render(<SharedSit user={host} onSignIn={vi.fn()} initialToken="abc" />); await waitFor(() => expect(screen.getByRole('button', { name: /retry completion/i })).toBeInTheDocument()); fetchMock.mockReturnValueOnce(new Promise(r => { retryResolve = r })); await userEvent.click(screen.getByRole('button', { name: /retry completion/i })); await userEvent.click(screen.getByRole('button', { name: /retry completion/i })); expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/complete')).length).toBe(2); retryResolve(response({}));
  })

  it('shows the generic completion error for a plain-string rejection', async () => {
    const expired = room({ status: 'running', startedAt: new Date(Date.now() - 5000).toISOString(), endsAt: new Date(Date.now() - 1000).toISOString(), ownSessionId: 'string-error' }); fetchMock.mockResolvedValueOnce(response({ room: expired })).mockRejectedValueOnce('offline'); render(<SharedSit user={host} onSignIn={vi.fn()} initialToken="abc" />); await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Unable to complete shared sit.'))
  })

  it('keeps cancel guarded while the shared sit is disabled', async () => {
    fetchMock.mockResolvedValueOnce(response({ room: room() })); render(<SharedSit user={host} onSignIn={vi.fn()} initialToken="abc" disabled />); await waitFor(() => expect(screen.getByRole('button', { name: /cancel sit/i })).toBeInTheDocument()); await userEvent.click(screen.getByRole('button', { name: /cancel sit/i })); expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('opens reflection when acknowledgement storage is unavailable', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('storage unavailable') }); fetchMock.mockResolvedValueOnce(response({ room: room({ status: 'completed', ownSessionId: 'storage-fallback' }) })); render(<SharedSit user={guest} onSignIn={vi.fn()} initialToken="abc" />); await waitFor(() => expect(screen.getByRole('button', { name: /save reflection/i })).toBeInTheDocument())
  })
})
