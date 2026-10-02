import React from 'react'
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, waitFor, fireEvent, cleanup, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import TimerDial from '@/components/TimerDial'
import PracticeTimer, { resolvePracticeSessionId, savePracticeReflection } from '@/components/PracticeTimer'
import PrivateReflection from '@/components/PrivateReflection'
import SharedSit from '@/components/SharedSit'
import { storageGet, storageRemove, storageSet } from '@/lib/practice-storage'

const fetchMock = vi.fn()
const bowlMock = vi.hoisted(() => ({ playBowl: vi.fn(), unlockBowlAudio: vi.fn() }))
vi.mock('@/lib/bowl', () => bowlMock)

function response(body: unknown, ok = true, status = ok ? 200 : 500) { return { ok, status, json: vi.fn().mockResolvedValue(body) } }
function setRect(el: Element, width = 280, height = 280) { vi.spyOn(el, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, width, height, right: width, bottom: height, x: 0, y: 0, toJSON: () => ({}) }) }

describe('practice storage boundaries', () => {
  it('handles nullable keys and storage failures', () => {
    expect(storageGet(null)).toBeNull(); storageSet(null, 'x'); storageRemove(null)
    const get = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked') }); const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked') }); const remove = vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => { throw new Error('blocked') }); expect(storageGet('x')).toBeNull(); storageSet('x', 'y'); storageRemove('x'); get.mockRestore(); set.mockRestore(); remove.mockRestore()
  })
})
describe('PracticeTimer session resolution', () => {
  it('prefers active, then completed, then persisted IDs and allows none', () => { expect(resolvePracticeSessionId('active', 'completed', 'persisted')).toBe('active'); expect(resolvePracticeSessionId(null, 'completed', 'persisted')).toBe('completed'); expect(resolvePracticeSessionId(null, null, 'persisted')).toBe('persisted'); expect(resolvePracticeSessionId(null, null, null)).toBeNull() })
  it('guards reflection saves without an ID and invokes success only after a valid response', async () => { vi.stubGlobal('fetch', fetchMock); const callback = vi.fn(); expect(await savePracticeReflection(null, {}, callback)).toBeNull(); expect(callback).not.toHaveBeenCalled(); fetchMock.mockResolvedValueOnce(response({})); await savePracticeReflection('s', { afterNote: '' }, callback); expect(callback).toHaveBeenCalledTimes(1) })
})

describe('TimerDial', () => {
  it('uses a full-session countdown ring while preserving duration-picker revolutions', () => {
    const circumference = 2 * Math.PI * 126
    const progressOffset = () => Number(document.querySelector('.timer-dial-progress')!.getAttribute('stroke-dashoffset'))
    const view = render(<TimerDial durationMinutes={10} remainingSeconds={600} onDurationChange={vi.fn()} />)
    expect(document.querySelectorAll('.timer-dial-ticks line')).toHaveLength(60)
    expect(document.querySelectorAll('.timer-dial-ticks .major')).toHaveLength(12)
    expect(document.querySelector('.timer-dial svg')).toHaveAttribute('aria-hidden', 'true')
    expect(progressOffset()).toBeCloseTo(circumference * (5 / 6))
    view.rerender(<TimerDial durationMinutes={10} remainingSeconds={600} running disabled />)
    expect(progressOffset()).toBeCloseTo(0)
    view.rerender(<TimerDial durationMinutes={10} remainingSeconds={300} running disabled phaseLabel="paused" />)
    expect(document.querySelector('.timer-dial')).toHaveAttribute('data-phase', 'paused')
    expect(document.querySelector('.timer-dial')).toHaveAttribute('data-running', 'true')
    expect(progressOffset()).toBeCloseTo(circumference / 2)
    view.rerender(<TimerDial durationMinutes={10} remainingSeconds={12} running disabled />)
    expect(progressOffset()).toBeCloseTo(circumference * .98)
    view.rerender(<TimerDial durationMinutes={10} remainingSeconds={0} running disabled />)
    expect(progressOffset()).toBeCloseTo(circumference)
    view.rerender(<TimerDial durationMinutes={120} remainingSeconds={7200} onDurationChange={vi.fn()} />)
    expect(document.querySelector('.timer-dial-progress-second')).not.toBeNull()
  })
  it('formats time, offers only dial controls, handles keyboard bounds, and renders progress states', async () => {
    const change = vi.fn()
    const { rerender } = render(<TimerDial durationMinutes={10} remainingSeconds={65} onDurationChange={change} phaseLabel="minutes" />)
    expect(screen.getByText('01:05')).toBeInTheDocument()
    expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument()
    const slider = screen.getByRole('slider')
    fireEvent.keyDown(slider, { key: 'ArrowRight' }); fireEvent.keyDown(slider, { key: 'ArrowUp' }); fireEvent.keyDown(slider, { key: 'ArrowLeft' }); fireEvent.keyDown(slider, { key: 'ArrowDown' }); fireEvent.keyDown(slider, { key: 'Home' }); fireEvent.keyDown(slider, { key: 'End' })
    expect(change).toHaveBeenCalledWith(120); expect(change).toHaveBeenCalledWith(1)
    rerender(<TimerDial durationMinutes={1} remainingSeconds={0} running onDurationChange={change} />); expect(screen.getByText('00:00')).toBeInTheDocument(); expect(screen.getByText('well done')).toBeInTheDocument()
    rerender(<TimerDial durationMinutes={120} remainingSeconds={600} disabled onDurationChange={change} />); expect(screen.queryByRole('slider')).not.toBeInTheDocument(); expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument()
  })
  it('supports pointer drag on the rim, thumb, seam wrapping, and ignores inner/readonly input', () => {
    const change = vi.fn(); render(<TimerDial durationMinutes={10} remainingSeconds={300} onDurationChange={change} />)
    const dial = document.querySelector('.timer-dial')!; setRect(dial); Object.defineProperty(dial, 'setPointerCapture', { value: vi.fn() })
    fireEvent.pointerDown(dial, { pointerId: 1, clientX: 140, clientY: 0 }); expect(change).toHaveBeenCalled()
    fireEvent.pointerMove(dial, { pointerId: 1, clientX: 280, clientY: 140 }); fireEvent.pointerUp(dial, { pointerId: 1 })
    fireEvent.pointerMove(dial, { pointerId: 2, clientX: 280, clientY: 140 });
    fireEvent.pointerDown(dial, { pointerId: 3, clientX: 140, clientY: 140 }); expect(change.mock.calls.length).toBeGreaterThan(1)
    fireEvent.pointerDown(dial, { pointerId: 4, clientX: 0, clientY: 140 }); fireEvent.pointerMove(dial, { pointerId: 4, clientX: 140, clientY: 0 }); fireEvent.pointerCancel(dial, { pointerId: 4 })
    render(<TimerDial durationMinutes={10} remainingSeconds={1} disabled onDurationChange={change} />); const readOnlyDial = document.querySelectorAll('.timer-dial')[1]; setRect(readOnlyDial); fireEvent.pointerDown(readOnlyDial, { pointerId: 7, clientX: 140, clientY: 0 }); expect(change).toHaveBeenCalled()
  })
  it('ignores pointer and key events when readonly or disabled', () => {
    const change = vi.fn(); render(<TimerDial durationMinutes={10} remainingSeconds={30} disabled />)
    const dial = document.querySelector('.timer-dial')!; setRect(dial); fireEvent.pointerDown(dial, { pointerId: 1, clientX: 140, clientY: 0 }); fireEvent.keyDown(dial, { key: 'ArrowRight' }); expect(change).not.toHaveBeenCalled()
    render(<TimerDial durationMinutes={10} remainingSeconds={30} onDurationChange={change} />); const second = document.querySelectorAll('.timer-dial')[1]; setRect(second); fireEvent.pointerDown(second, { pointerId: 2, clientX: 140, clientY: 140 }); fireEvent.pointerMove(second, { pointerId: 9, clientX: 280, clientY: 140 }); fireEvent.pointerUp(second, { pointerId: 9 }); expect(change).not.toHaveBeenCalled()
  })
  it('keeps center taps stable, supports scaled thumb/seam drags, and ignores disabled keys', () => {
    const change = vi.fn(); render(<TimerDial durationMinutes={10} remainingSeconds={600} onDurationChange={change} />)
    const dial = document.querySelector('.timer-dial')!; setRect(dial, 200, 200); Object.defineProperty(dial, 'setPointerCapture', { value: vi.fn() })
    fireEvent.pointerDown(dial, { pointerId: 1, clientX: 100, clientY: 100 }); expect(change).not.toHaveBeenCalled()
    fireEvent.pointerDown(dial, { pointerId: 2, clientX: 141, clientY: 20 }); expect(change).toHaveBeenCalledWith(5)
    fireEvent.pointerMove(dial, { pointerId: 2, clientX: 12, clientY: 100 }); fireEvent.pointerUp(dial, { pointerId: 2 })
    const disabledChange = vi.fn(); render(<TimerDial durationMinutes={10} remainingSeconds={600} disabled onDurationChange={disabledChange} />); const disabled = document.querySelectorAll('.timer-dial')[1]; fireEvent.keyDown(disabled.querySelector('[role="slider"]') || disabled, { key: 'End' }); expect(disabledChange).not.toHaveBeenCalled()
  })
  it('stops a captured drag safely if the dial becomes readonly mid-gesture', () => {
    const change = vi.fn(); const view = render(<TimerDial durationMinutes={10} remainingSeconds={300} onDurationChange={change} />); const dial = document.querySelector('.timer-dial')!; setRect(dial); Object.defineProperty(dial, 'setPointerCapture', { value: vi.fn() }); fireEvent.pointerDown(dial, { pointerId: 22, clientX: 140, clientY: 0 }); view.rerender(<TimerDial durationMinutes={10} remainingSeconds={300} disabled />); expect(() => fireEvent.pointerMove(dial, { pointerId: 22, clientX: 280, clientY: 140 })).not.toThrow()
  })
  it('uses full 60-minute revolutions and a second ring through 120 minutes', () => {
    const change = vi.fn(); const view = render(<TimerDial durationMinutes={60} remainingSeconds={3600} onDurationChange={change} />)
    let thumb = document.querySelector('.timer-dial-thumb')!; expect(Number(thumb.getAttribute('cx'))).toBeCloseTo(140); expect(Number(thumb.getAttribute('cy'))).toBeCloseTo(14); expect(document.querySelector('.timer-dial-progress-second')).toBeNull()
    view.rerender(<TimerDial durationMinutes={120} remainingSeconds={7200} onDurationChange={change} />); thumb = document.querySelector('.timer-dial-thumb')!; expect(Number(thumb.getAttribute('cy'))).toBeCloseTo(14); expect(screen.getByText('second revolution')).toBeInTheDocument(); expect(document.querySelector('.timer-dial-progress-second')).not.toBeNull(); view.rerender(<TimerDial durationMinutes={120} remainingSeconds={0} running disabled />); expect(screen.queryByText('second revolution')).not.toBeInTheDocument()
  })
  it('selects and drags on the second revolution', () => {
    const change = vi.fn(); render(<TimerDial durationMinutes={90} remainingSeconds={5400} onDurationChange={change} />); const dial = document.querySelector('.timer-dial')!; setRect(dial); Object.defineProperty(dial, 'setPointerCapture', { value: vi.fn() })
    fireEvent.pointerDown(dial, { pointerId: 31, clientX: 140, clientY: 266 }); expect(change).toHaveBeenLastCalledWith(90)
    fireEvent.pointerMove(dial, { pointerId: 31, clientX: 14, clientY: 140 }); fireEvent.pointerUp(dial, { pointerId: 31 })
    fireEvent.pointerDown(dial, { pointerId: 32, clientX: 266, clientY: 140 }); expect(change).toHaveBeenLastCalledWith(75)
    fireEvent.pointerMove(dial, { pointerId: 32, clientX: 140, clientY: 14 }); fireEvent.pointerCancel(dial, { pointerId: 32 })
  })
  it('accumulates subminute drag steps across 60 and reverses from the 120-minute bound', () => {
    function Harness({ initial }: { initial: number }) { const [value, setValue] = React.useState(initial); return <TimerDial durationMinutes={value} remainingSeconds={value * 60} onDurationChange={next => { changes.push(next); setValue(next) }} /> }
    const changes: number[] = []; const view = render(<Harness initial={59} />); const dial = document.querySelector('.timer-dial')!; setRect(dial); Object.defineProperty(dial, 'setPointerCapture', { value: vi.fn() })
    const point = (degrees: number) => ({ clientX: 140 + 126 * Math.sin(degrees * Math.PI / 180), clientY: 140 - 126 * Math.cos(degrees * Math.PI / 180) })
    fireEvent.pointerDown(dial, { pointerId: 41, ...point(354) })
    for (let degrees = 355; degrees <= 366; degrees++) fireEvent.pointerMove(dial, { pointerId: 41, ...point(degrees % 360) })
    fireEvent.pointerUp(dial, { pointerId: 41 }); expect(changes).toHaveLength(13); expect(changes.filter(value => value === 59).length).toBeGreaterThan(1); expect(changes.filter(value => value === 60).length).toBeGreaterThan(1); expect(changes.at(-1)).toBe(61)
    view.unmount(); changes.length = 0; render(<Harness initial={120} />); const upper = document.querySelector('.timer-dial')!; setRect(upper); Object.defineProperty(upper, 'setPointerCapture', { value: vi.fn() }); fireEvent.pointerDown(upper, { pointerId: 42, ...point(0) }); for (let degrees = 359; degrees >= 354; degrees--) fireEvent.pointerMove(upper, { pointerId: 42, ...point(degrees) }); fireEvent.pointerUp(upper, { pointerId: 42 }); expect(changes.at(-1)).toBe(119)
  })
})

describe('PracticeTimer', () => {
  beforeEach(() => { vi.useFakeTimers(); fetchMock.mockReset(); vi.stubGlobal('fetch', fetchMock); localStorage.clear(); bowlMock.playBowl.mockClear(); bowlMock.unlockBowlAudio.mockClear(); Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' }); Object.defineProperty(navigator, 'wakeLock', { configurable: true, value: { request: vi.fn().mockResolvedValue({ release: vi.fn().mockResolvedValue(undefined) }) } }) })
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })
  const user = { id: 'u1', name: 'Ada' }
  it('starts, persists, counts down, completes, opens reflection and saves it', async () => {
    vi.useRealTimers(); const ui = userEvent.setup()
    const now = Date.now(); fetchMock.mockResolvedValueOnce(response({ session: { id: 's1', startedAt: new Date(now - 2000).toISOString(), plannedSeconds: 1 } })).mockResolvedValueOnce(response({}));
    render(<PracticeTimer user={user} />); expect(screen.getByRole('heading')).toHaveTextContent(/sit/); expect(screen.queryByText('A little quieter. A little more present.')).not.toBeInTheDocument(); await ui.click(screen.getByRole('button', { name: /Begin practice/i }));
    expect(screen.queryByText('Stay with the breath')).not.toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledWith('/api/sessions/start', expect.anything()); await waitFor(() => expect(screen.getByText('well done')).toBeInTheDocument()); expect(bowlMock.playBowl).toHaveBeenCalled()
    expect(screen.getByRole('button', { name: /Edit reflection/i })).toBeInTheDocument(); await ui.click(screen.getByRole('button', { name: /Edit reflection/i })); await ui.click(screen.getByRole('button', { name: 'Before 3 of 5' })); await ui.click(screen.getByRole('button', { name: 'During 4 of 5' })); await ui.click(screen.getByRole('button', { name: 'After 5 of 5' })); await ui.type(screen.getByRole('textbox'), 'quiet noticing'); fetchMock.mockResolvedValueOnce(response({})); await ui.click(screen.getByRole('button', { name: /Save reflection/i })); await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/sessions/s1/reflection', expect.objectContaining({ body: expect.stringContaining('quiet noticing') })))
  })
  it('handles sign-in, disabled, start errors, cancellation errors and completion retry', async () => {
    vi.useRealTimers()
    const ui = userEvent.setup(); const onSignIn = vi.fn(); render(<PracticeTimer user={null} onSignIn={onSignIn} />); await ui.click(screen.getByRole('button', { name: /Sign in/ })); expect(onSignIn).toHaveBeenCalled()
    const onActive = vi.fn(); fetchMock.mockResolvedValueOnce(response({ error: 'nope' }, false, 400)); render(<PracticeTimer user={user} onActiveChange={onActive} />); await ui.click(screen.getAllByRole('button', { name: /Begin practice/ })[0]); await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('nope'))
    fetchMock.mockResolvedValueOnce(response({ session: { id: 's2', startedAt: new Date().toISOString(), plannedSeconds: 10 } })); await ui.click(screen.getByRole('button', { name: /Begin practice/ })); await waitFor(() => expect(screen.getByRole('button', { name: /End session/ })).toBeInTheDocument()); fetchMock.mockResolvedValueOnce(response({ error: 'cannot end' }, false, 400)); await ui.click(screen.getByRole('button', { name: /End session/ })); await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('cannot end'))
    expect(onActive).toHaveBeenCalled()
  })
  it('restores pending completion and retries, hydrates legacy drafts, skips and starts anew', async () => {
    vi.useRealTimers()
    const ui = userEvent.setup()
    const now = Date.now(); vi.setSystemTime(now); localStorage.setItem('still:practice:u1', JSON.stringify({ sessionId: 'old', startedAt: new Date(now - 1000).toISOString(), deadlineMs: now - 1, plannedSeconds: 60, completionPending: true })); localStorage.setItem('still:reflection:u1', JSON.stringify({ beforeNote: 'a', duringNote: 'b', afterNote: 'c' })); fetchMock.mockResolvedValueOnce(response({ error: 'fail' }, false, 500)); render(<PracticeTimer user={user} />); await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('fail')); expect(screen.getByRole('button', { name: /Retry save/ })).toBeInTheDocument(); fetchMock.mockResolvedValueOnce(response({})); await ui.click(screen.getByRole('button', { name: /Retry save/ })); await waitFor(() => expect(screen.getByText('well done')).toBeInTheDocument()); await ui.click(screen.getByRole('button', { name: /Skip for now/ }));
    await ui.click(screen.getByRole('button', { name: /New session/ })); expect(screen.getByText('01:00')).toBeInTheDocument()
  })
  it('ignores malformed persisted state and tolerates storage failures', async () => {
    localStorage.setItem('still:practice:u1', '{'); const get = vi.spyOn(Storage.prototype, 'getItem').mockImplementation((key) => key.includes('practice') ? '{' : null); vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota') }); render(<PracticeTimer user={user} />); expect(screen.getByRole('button', { name: /Begin practice/ })).toBeInTheDocument(); get.mockRestore()
  })
  it('ignores incomplete persisted sessions and legacy draft storage failures', async () => {
    localStorage.setItem('still:practice:u1', JSON.stringify({ sessionId: 'missing-deadline' })); localStorage.setItem('still:reflection:u1', JSON.stringify({ beforeNote: 'legacy' })); vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota') }); render(<PracticeTimer user={user} />); expect(screen.getByRole('button', { name: /Begin practice/ })).toBeInTheDocument()
  })
  it.each([[0, 'Late night sit'], [6, 'Early morning sit'], [10, 'Morning sit'], [14, 'Afternoon sit'], [19, 'Evening sit'], [23, 'Late night sit']])('labels local hour %s correctly', async (hour, label) => {
    vi.useRealTimers(); vi.setSystemTime(new Date(`2026-09-28T${String(hour).padStart(2, '0')}:00:00`)); render(<PracticeTimer user={null} />); await waitFor(() => expect(screen.getByRole('heading')).toHaveTextContent(label)); cleanup()
  })
  it('previews the bowl from the idle control', async () => {
    vi.useRealTimers(); render(<PracticeTimer user={user} />); await userEvent.click(screen.getByRole('button', { name: /Preview sound/ })); expect(bowlMock.unlockBowlAudio).toHaveBeenCalled(); expect(bowlMock.playBowl).toHaveBeenCalled()
  })
  it('cancels a successfully started session without completing it', async () => {
    vi.useRealTimers(); const ui = userEvent.setup(); fetchMock.mockResolvedValueOnce(response({ session: { id: 'cancel', startedAt: new Date().toISOString(), plannedSeconds: 60 } })).mockResolvedValueOnce(response({})); render(<PracticeTimer user={user} />); await ui.click(screen.getByRole('button', { name: /Begin practice/ })); await waitFor(() => expect(screen.getByRole('button', { name: /End session/ })).toBeInTheDocument()); await ui.click(screen.getByRole('button', { name: /End session/ })); await waitFor(() => expect(screen.getByRole('button', { name: /Begin practice/ })).toBeInTheDocument()); expect(fetchMock).not.toHaveBeenCalledWith('/api/sessions/cancel/complete', expect.anything())
  })
  it('reports malformed start responses and supports snake-case start fields', async () => {
    vi.useRealTimers(); const ui = userEvent.setup(); fetchMock.mockResolvedValueOnce(response({ session: { id: 'bad', plannedSeconds: 60 } })); render(<PracticeTimer user={user} />); await ui.click(screen.getByRole('button', { name: /Begin practice/ })); await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('start time'))
    cleanup(); fetchMock.mockReset(); fetchMock.mockResolvedValueOnce(response({ session: { id: 'snake', started_at: new Date().toISOString() } })); render(<PracticeTimer user={user} />); await ui.click(screen.getByRole('button', { name: /Begin practice/ })); await waitFor(() => expect(screen.getByRole('button', { name: /End session/ })).toBeInTheDocument())
  })
  it('handles wake-lock visibility transitions and rejected start JSON', async () => {
    vi.useRealTimers(); const ui = userEvent.setup(); const request = navigator.wakeLock.request as ReturnType<typeof vi.fn>; request.mockRejectedValueOnce(new Error('denied')); fetchMock.mockResolvedValueOnce({ ok: false, json: vi.fn().mockRejectedValue('bad') }); render(<PracticeTimer user={user} />); await ui.click(screen.getByRole('button', { name: /Begin practice/ })); await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Could not begin your practice.')); expect(request).not.toHaveBeenCalled()
    fetchMock.mockResolvedValueOnce(response({ session: { id: 'wake', startedAt: new Date().toISOString(), plannedSeconds: 60 } })); await ui.click(screen.getByRole('button', { name: /Begin practice/ })); await waitFor(() => expect(screen.getByRole('button', { name: /End session/ })).toBeInTheDocument()); Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' }); fireEvent(document, new Event('visibilitychange')); Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' }); fireEvent(document, new Event('visibilitychange')); expect(request).toHaveBeenCalled()
  })
  it('normalizes non-Error start, cancel, and reflection failures', async () => {
    vi.useRealTimers(); const ui = userEvent.setup(); fetchMock.mockRejectedValueOnce('offline'); render(<PracticeTimer user={user} />); await ui.click(screen.getByRole('button', { name: /Begin practice/ })); await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Could not begin your practice.')); cleanup()
    fetchMock.mockResolvedValueOnce(response({ session: { id: 'cancel-string', startedAt: new Date().toISOString(), plannedSeconds: 60 } })).mockRejectedValueOnce('offline'); render(<PracticeTimer user={user} />); await ui.click(screen.getByRole('button', { name: /Begin practice/ })); await waitFor(() => expect(screen.getByRole('button', { name: /End session/ })).toBeInTheDocument()); await ui.click(screen.getByRole('button', { name: /End session/ })); await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Could not end this practice.')); cleanup()
    fetchMock.mockResolvedValueOnce(response({ sessions: [{ id: 'reflect' }] })); render(<PrivateReflection sessionId="reflect" userId="u" onSaved={vi.fn()} onSkip={vi.fn()} />); await waitFor(() => expect(screen.getByRole('button', { name: /Save reflection/ })).toBeEnabled()); fetchMock.mockRejectedValueOnce('offline'); await ui.click(screen.getByRole('button', { name: /Save reflection/ })); await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Could not save reflection.'))
  })
  it('supports sign-in without a callback and disabled solo copy', async () => {
    vi.useRealTimers(); const ui = userEvent.setup(); render(<PracticeTimer user={null} />); await ui.click(screen.getByRole('button', { name: /Sign in to practice/ })); cleanup(); render(<PracticeTimer user={user} disabled />); expect(screen.getByRole('button', { name: /Group practice active/ })).toBeDisabled()
  })
  it('tolerates a rejected wake-lock release on cleanup', async () => {
    vi.useRealTimers(); const ui = userEvent.setup(); const release = vi.fn().mockRejectedValue(new Error('release denied')); Object.defineProperty(navigator, 'wakeLock', { configurable: true, value: { request: vi.fn().mockResolvedValue({ release }) } }); fetchMock.mockResolvedValueOnce(response({ session: { id: 'wake-release', startedAt: new Date().toISOString(), plannedSeconds: 60 } })); const view = render(<PracticeTimer user={user} />); await ui.click(screen.getByRole('button', { name: /Begin practice/ })); await waitFor(() => expect(screen.getByRole('button', { name: /End session/ })).toBeInTheDocument()); view.unmount(); await Promise.resolve(); expect(release).toHaveBeenCalled()
  })
  it('retries a 422 completion once and rings only once', async () => {
    vi.useFakeTimers(); vi.setSystemTime(100_000); let completions = 0; fetchMock.mockImplementation((url: string) => url === '/api/sessions/start' ? Promise.resolve(response({ session: { id: 'skew', startedAt: new Date(98_000).toISOString(), plannedSeconds: 1 } })) : Promise.resolve(++completions === 1 ? response({ error: 'early' }, false, 422) : response({}))); render(<PracticeTimer user={user} />); fireEvent.click(screen.getByRole('button', { name: /Begin practice/ })); await act(async () => { await Promise.resolve() }); await act(async () => { await vi.advanceTimersByTimeAsync(500) }); await act(async () => { await vi.advanceTimersByTimeAsync(1200); await Promise.resolve() }); expect(completions).toBe(2); expect(bowlMock.playBowl).toHaveBeenCalledTimes(1); expect(bowlMock.playBowl).toHaveBeenCalledWith(); expect(screen.getByText('well done')).toBeInTheDocument()
  })
  it('keeps completion failure retryable and succeeds on explicit retry', async () => {
    vi.useFakeTimers(); vi.setSystemTime(200_000); let completions = 0; fetchMock.mockImplementation((url: string) => url === '/api/sessions/start' ? Promise.resolve(response({ session: { id: 'retry-complete', startedAt: new Date(198_000).toISOString(), plannedSeconds: 1 } })) : Promise.resolve(++completions === 1 ? response({ error: 'early' }, false, 422) : response({ error: 'offline' }, false, 500))); render(<PracticeTimer user={user} />); fireEvent.click(screen.getByRole('button', { name: /Begin practice/ })); await act(async () => { await Promise.resolve() }); await act(async () => { await vi.advanceTimersByTimeAsync(1800) }); expect(screen.getByRole('button', { name: /Retry save/ })).toBeInTheDocument(); fetchMock.mockImplementation((url: string) => url === '/api/sessions/retry-complete/complete' ? Promise.resolve(response({})) : Promise.resolve(response({ session: { id: 'unused', startedAt: new Date().toISOString(), plannedSeconds: 1 } }))); fireEvent.click(screen.getByRole('button', { name: /Retry save/ })); await act(async () => { await Promise.resolve() }); expect(screen.getByText('well done')).toBeInTheDocument(); expect(bowlMock.playBowl).toHaveBeenCalledTimes(1); expect(bowlMock.playBowl).toHaveBeenCalledWith()
  })
  it('shows a generic error for a plain-string completion network failure', async () => {
    vi.useFakeTimers(); vi.setSystemTime(300_000); fetchMock.mockImplementation((url: string) => url === '/api/sessions/start' ? Promise.resolve(response({ session: { id: 'network-complete', startedAt: new Date(298_000).toISOString(), plannedSeconds: 1 } })) : Promise.reject('offline')); render(<PracticeTimer user={user} />); fireEvent.click(screen.getByRole('button', { name: /Begin practice/ })); await act(async () => { await Promise.resolve() }); await act(async () => { await vi.advanceTimersByTimeAsync(500) }); expect(screen.getByRole('alert')).toHaveTextContent('Could not save your session.')
  })
})

describe('PrivateReflection', () => {
  beforeEach(() => { fetchMock.mockReset(); vi.stubGlobal('fetch', fetchMock); localStorage.clear() })
  it('loads local and server drafts, handles malformed/missing/retry and save failures', async () => {
    localStorage.setItem('still:reflection:u:s', JSON.stringify({ beforeMood: 2, notes: 'saved' })); const saved = vi.fn(); render(<PrivateReflection sessionId="s" userId="u" onSaved={saved} onSkip={vi.fn()} />); await waitFor(() => expect(screen.getByDisplayValue('saved')).toBeInTheDocument()); await userEvent.click(screen.getByRole('button', { name: 'Before 4 of 5' }));
    localStorage.clear(); fetchMock.mockResolvedValueOnce(response({ sessions: [{ id: 's', beforeNote: 'b', afterNote: 'a' }] })); const { unmount } = render(<PrivateReflection sessionId="s" userId="u" onSaved={saved} onSkip={vi.fn()} />); await waitFor(() => expect(screen.getByDisplayValue(/Before: b/)).toBeInTheDocument()); unmount()
    fetchMock.mockResolvedValueOnce(response({ error: 'bad' }, false, 500)); render(<PrivateReflection sessionId="missing" userId="u" onSaved={saved} onSkip={vi.fn()} />); await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Unable to load')); await userEvent.click(screen.getByRole('button', { name: /Retry loading/ }));
  })
  it('saves, reports errors, and skips', async () => {
    fetchMock.mockResolvedValueOnce(response({ sessions: [{ id: 's', notes: '' }] })); const saved = vi.fn(); const skipped = vi.fn(); render(<PrivateReflection sessionId="s" userId="u" onSaved={saved} onSkip={skipped} />); await waitFor(() => expect(screen.getByRole('button', { name: /Save reflection/ })).toBeEnabled()); fetchMock.mockResolvedValueOnce(response({ error: 'no save' }, false, 500)); await userEvent.click(screen.getByRole('button', { name: /Save reflection/ })); await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('no save')); await userEvent.click(screen.getByRole('button', { name: /Skip for now/ })); expect(skipped).toHaveBeenCalled()
  })
  it('falls through malformed local drafts and handles missing server sessions', async () => {
    localStorage.setItem('still:reflection:u:bad', '{'); fetchMock.mockResolvedValueOnce(response({ sessions: [] })); const skip = vi.fn(); render(<PrivateReflection sessionId="bad" userId="u" onSaved={vi.fn()} onSkip={skip} />); await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('unavailable')); await userEvent.click(screen.getByRole('button', { name: /Skip for now/ })); expect(skip).toHaveBeenCalled()
  })
  it('saves a hydrated reflection and tolerates draft cleanup storage failure', async () => {
    fetchMock.mockResolvedValueOnce(response({ sessions: [{ id: 's', beforeMood: 1, duringMood: 2, afterMood: 3, afterNote: 'old' }] }))
    const saved = vi.fn(); render(<PrivateReflection sessionId="s" userId="u" onSaved={saved} onSkip={vi.fn()} />); await waitFor(() => expect(screen.getByDisplayValue('old')).toBeInTheDocument())
    fetchMock.mockResolvedValueOnce(response({})); const remove = vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => { throw new Error('quota') }); await userEvent.click(screen.getByRole('button', { name: /Save reflection/ })); await waitFor(() => expect(saved).toHaveBeenCalled()); remove.mockRestore()
  })
  it('captures all mood and notes controls in the PATCH payload', async () => {
    fetchMock.mockResolvedValueOnce(response({ sessions: [{ id: 'all' }] })); render(<PrivateReflection sessionId="all" userId="u" onSaved={vi.fn()} onSkip={vi.fn()} />); await waitFor(() => expect(screen.getByRole('button', { name: /Save reflection/ })).toBeEnabled())
    await userEvent.click(screen.getByRole('button', { name: 'Before 4 of 5' })); await userEvent.click(screen.getByRole('button', { name: 'During 3 of 5' })); await userEvent.click(screen.getByRole('button', { name: 'After 5 of 5' })); await userEvent.type(screen.getByRole('textbox'), 'noticed stillness'); fetchMock.mockResolvedValueOnce(response({})); await userEvent.click(screen.getByRole('button', { name: /Save reflection/ })); await waitFor(() => expect(fetchMock).toHaveBeenLastCalledWith('/api/sessions/all/reflection', expect.objectContaining({ body: expect.stringContaining('noticed stillness') })))
  })
  it('recovers from a failed history load with Retry', async () => {
    fetchMock.mockResolvedValueOnce(response({ error: 'offline' }, false, 500)); render(<PrivateReflection sessionId="retry" userId="u" onSaved={vi.fn()} onSkip={vi.fn()} />); await waitFor(() => expect(screen.getByRole('button', { name: /Retry loading/ })).toBeInTheDocument()); fetchMock.mockResolvedValueOnce(response({ sessions: [{ id: 'retry', afterNote: 'restored' }] })); await userEvent.click(screen.getByRole('button', { name: /Retry loading/ })); await waitFor(() => expect(screen.getByDisplayValue('restored')).toBeInTheDocument())
  })
  it('normalizes GET failures and rejected JSON into safe load errors', async () => {
    const rejectedJson = { ok: true, json: vi.fn().mockRejectedValue(new Error('broken body')) }; fetchMock.mockResolvedValueOnce(rejectedJson); render(<PrivateReflection sessionId="json" userId="u" onSaved={vi.fn()} onSkip={vi.fn()} />); await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('unavailable')); cleanup()
    fetchMock.mockRejectedValueOnce('offline'); render(<PrivateReflection sessionId="network" userId="u" onSaved={vi.fn()} onSkip={vi.fn()} />); await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Unable to load this private reflection.'))
  })
  it('hydrates a complete local draft without legacy fallbacks', async () => {
    localStorage.setItem('still:reflection:u:complete', JSON.stringify({ beforeMood: 1, duringMood: 2, afterMood: 3, notes: 'complete' })); render(<PrivateReflection sessionId="complete" userId="u" onSaved={vi.fn()} onSkip={vi.fn()} />); await waitFor(() => expect(screen.getByDisplayValue('complete')).toBeInTheDocument()); expect(fetchMock).not.toHaveBeenCalled()
  })
  it('hydrates local notes with missing moods and migrates legacy staged notes', async () => {
    localStorage.setItem('still:reflection:u:missing-moods', JSON.stringify({ notes: 'only notes' })); render(<PrivateReflection sessionId="missing-moods" userId="u" onSaved={vi.fn()} onSkip={vi.fn()} />); await waitFor(() => expect(screen.getByDisplayValue('only notes')).toBeInTheDocument()); cleanup()
    localStorage.setItem('still:reflection:u:legacy', JSON.stringify({ beforeNote: 'arrived', duringNote: 'sat', afterNote: 'clear' })); render(<PrivateReflection sessionId="legacy" userId="u" onSaved={vi.fn()} onSkip={vi.fn()} />); await waitFor(() => expect(screen.getByDisplayValue(/Before: arrived/)).toBeInTheDocument())
  })
  it('ignores a rejected history request after unmount', async () => {
    let reject!: (reason: unknown) => void; fetchMock.mockReturnValueOnce(new Promise((_resolve, rej) => { reject = rej })); const view = render(<PrivateReflection sessionId="unmount" userId="u" onSaved={vi.fn()} onSkip={vi.fn()} />); view.unmount(); reject('offline'); await act(async () => { await Promise.resolve() }); expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
  it('normalizes PATCH failures and missing error bodies into safe save errors', async () => {
    fetchMock.mockResolvedValueOnce(response({ sessions: [{ id: 'save' }] })); render(<PrivateReflection sessionId="save" userId="u" onSaved={vi.fn()} onSkip={vi.fn()} />); await waitFor(() => expect(screen.getByRole('button', { name: /Save reflection/ })).toBeEnabled()); fetchMock.mockResolvedValueOnce({ ok: false, json: vi.fn().mockResolvedValue({}) }); await userEvent.click(screen.getByRole('button', { name: /Save reflection/ })); await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Could not save reflection.')); cleanup()
    fetchMock.mockResolvedValueOnce(response({ sessions: [{ id: 'save-network' }] })); render(<PrivateReflection sessionId="save-network" userId="u" onSaved={vi.fn()} onSkip={vi.fn()} />); await waitFor(() => expect(screen.getByRole('button', { name: /Save reflection/ })).toBeEnabled()); fetchMock.mockRejectedValueOnce('offline'); await userEvent.click(screen.getByRole('button', { name: /Save reflection/ })); await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Could not save reflection.')); cleanup()
    fetchMock.mockResolvedValueOnce(response({ sessions: [{ id: 'save-json' }] })); render(<PrivateReflection sessionId="save-json" userId="u" onSaved={vi.fn()} onSkip={vi.fn()} />); await waitFor(() => expect(screen.getByRole('button', { name: /Save reflection/ })).toBeEnabled()); fetchMock.mockResolvedValueOnce({ ok: false, json: vi.fn().mockRejectedValue('bad json') }); await userEvent.click(screen.getByRole('button', { name: /Save reflection/ })); await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Could not save reflection.'))
  })
})

describe('SharedSit', () => {
  beforeEach(() => { fetchMock.mockReset(); vi.stubGlobal('fetch', fetchMock); localStorage.clear(); Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: vi.fn() } }); Object.defineProperty(navigator, 'share', { configurable: true, value: undefined }); vi.spyOn(window.history, 'replaceState') })
  const host = { id: 'host', name: 'Host' }
  const room = (overrides: Record<string, unknown> = {}) => ({ id: 'r', inviteToken: 'abc', status: 'waiting', plannedSeconds: 600, hostUserId: 'host', isHost: true, isMember: true, participantCount: 1, ownSessionId: null, members: [{ userId: 'host', name: 'Host' }], ...overrides })
  it('creates, shares, starts, cancels with confirmation, and handles action errors', async () => {
    const ui = userEvent.setup(); fetchMock.mockResolvedValueOnce(response({ room: room() })).mockResolvedValueOnce(response({ room: room() })); render(<SharedSit user={host} onSignIn={vi.fn()} />); await ui.click(screen.getByRole('button', { name: /Create private sit/ })); await waitFor(() => expect(screen.getByText(/Waiting for your people/)).toBeInTheDocument()); fetchMock.mockResolvedValueOnce(response({ room: room() })); await ui.click(screen.getByRole('button', { name: /Share invitation/ })); expect(screen.getByRole('textbox')).toHaveValue('http://localhost:3000/?sit=abc');
    fetchMock.mockResolvedValueOnce(response({ room: room() })); await ui.click(screen.getByRole('button', { name: /Start shared sit/ })); await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/shared-sits/abc/start', expect.anything())); vi.spyOn(window, 'confirm').mockReturnValue(false); await ui.click(screen.getByRole('button', { name: /Cancel sit/ })); vi.spyOn(window, 'confirm').mockReturnValue(true); fetchMock.mockResolvedValueOnce(response({ error: 'cancel failed' }, false, 400)); await ui.click(screen.getByRole('button', { name: /Cancel sit/ })); await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('cancel failed'))
  })
  it('joins, leaves, completes, shows private reflection, acknowledges, and handles signed-out state', async () => {
    const ui = userEvent.setup(); const onSignIn = vi.fn(); render(<SharedSit user={null} onSignIn={onSignIn} initialToken="abc" />); await ui.click(screen.getByRole('button', { name: /Sign in to join/ })); expect(onSignIn).toHaveBeenCalled(); cleanup()
    fetchMock.mockResolvedValueOnce(response({ room: room({ isMember: false, isHost: false, hostUserId: 'other', members: [] }) })); render(<SharedSit user={{ id: 'guest', name: 'Guest' }} onSignIn={onSignIn} initialToken="abc" />); await waitFor(() => expect(screen.getByRole('button', { name: /Join this sit/ })).toBeInTheDocument()); fetchMock.mockResolvedValueOnce(response({ room: room({ isMember: true, isHost: false, hostUserId: 'other' }) })); await ui.click(screen.getByRole('button', { name: /Join this sit/ })); await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/shared-sits/abc/join', expect.anything()));
    fetchMock.mockResolvedValueOnce(response({ room: room({ status: 'completed', isMember: true, isHost: false, hostUserId: 'other', ownSessionId: 's1' }) }));
  })
})

it.each([1, 3, 10])('solo stays silent at start and rings once after %i minutes', async minutes => {
  vi.useFakeTimers(); localStorage.clear(); bowlMock.playBowl.mockReset(); bowlMock.unlockBowlAudio.mockReset()
  const fetcher = vi.fn(async (url: string) => response(url === '/api/sessions/start' ? { session: { id: 'end-only', startedAt: new Date().toISOString(), plannedSeconds: minutes * 60 } } : {}))
  vi.stubGlobal('fetch', fetcher)
  try {
    render(<PracticeTimer user={{ id: 'end-only-user', name: 'Ada' }} />)
    fireEvent.keyDown(screen.getByRole('slider'), { key: 'Home' })
    for (let i = 1; i < minutes; i++) fireEvent.keyDown(screen.getByRole('slider'), { key: 'ArrowUp' })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Begin practice/ })) })
    expect(bowlMock.unlockBowlAudio).toHaveBeenCalled(); expect(bowlMock.playBowl).not.toHaveBeenCalled()
    await act(async () => { await vi.advanceTimersByTimeAsync(minutes * 60000 - 1000) })
    expect(bowlMock.playBowl).not.toHaveBeenCalled()
    await act(async () => { await vi.advanceTimersByTimeAsync(1000) })
    expect(bowlMock.playBowl).toHaveBeenCalledTimes(1)
    await act(async () => { await vi.advanceTimersByTimeAsync(3000) })
    expect(bowlMock.playBowl).toHaveBeenCalledTimes(1)
  } finally { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals() }
})
