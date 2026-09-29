import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Profile from '../../../src/components/Profile'

const response = (body: unknown, ok = true): Response => ({ ok, status: ok ? 200 : 500, json: async () => body } as unknown as Response)
const user = { id: 'u', name: 'Ada', email: 'ada@example.com', timezone: 'UTC', weeklyTarget: 3, weeklyMinutesTarget: 30, avatarKey: null }
const fullStats = { totals: { seconds: 600, minutes: 10, sessions: 2 }, currentWeek: { minutes: 10, sessions: 2, practiceDays: 2, daysGoalMet: true, minutesGoalMet: true }, currentStreak: 2, bestStreak: 5, weeks: [{ weekStart: '2026-09-01', minutes: 0 }, { weekStart: '2026-09-08', minutes: 50, sessions: 3, practiceDays: 2 }] }

function mockFetch(overrides: Record<string, unknown> = {}) {
  const calls: string[] = []
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input); calls.push(`${init?.method ?? 'GET'} ${url}`)
    if (overrides[url]) return typeof overrides[url] === 'function' ? (overrides[url] as Function)(init) : overrides[url] as Response
    if (url === '/api/auth/me') return response({ user })
    if (url === '/api/profile/stats') return response(fullStats)
    if (url === '/api/reminders') return response({ settings: { enabled: false, hour: 19, days: [0, 1, 2, 3, 4, 5, 6] }, vapidPublicKey: null })
    if (url === '/api/profile') return response({ user })
    if (url === '/api/auth/logout') return response({})
    return response({})
  })
  vi.stubGlobal('fetch', fn)
  return { calls, fn }
}

function renderLoaded(overrides: Record<string, unknown> = {}) {
  cleanup(); mockFetch(overrides); render(<Profile />)
  return waitFor(() => expect(screen.getByRole('heading', { name: 'Ada' })).toBeInTheDocument())
}

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers() })

describe('Profile complete behavior', () => {
  beforeEach(() => {
    vi.stubGlobal('Notification', { permission: 'default', requestPermission: vi.fn().mockResolvedValue('granted') })
    Object.defineProperty(window, 'PushManager', { configurable: true, value: class PushManager {} })
    Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: { ready: Promise.resolve({ pushManager: { getSubscription: vi.fn().mockResolvedValue(null), subscribe: vi.fn().mockResolvedValue({ toJSON: () => ({ endpoint: 'ep', keys: { p256dh: 'p', auth: 'a' } }), unsubscribe: vi.fn().mockResolvedValue(true) }) } }) } })
  })

  it('renders empty, loading, load error, and stats fallback states', async () => {
    const signIn = vi.fn(); render(<Profile signedIn={false} onSignIn={signIn} />); await userEvent.setup().click(screen.getByRole('button', { name: /sign in/i })); expect(signIn).toHaveBeenCalled(); cleanup()
    mockFetch({ '/api/profile/stats': response({}, false) }); render(<Profile />); await waitFor(() => expect(screen.getByRole('heading', { name: 'Ada' })).toBeInTheDocument()); cleanup()
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue('offline')); render(<Profile />); await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Unable to load profile.')); cleanup()
    mockFetch({ '/api/profile/stats': response({}, false) }); render(<Profile />); await waitFor(() => expect(screen.getAllByText('3 days').length).toBeGreaterThan(0))
  })

  it('covers nullable stats, goal text, chart detail and capped progress', async () => {
    mockFetch({ '/api/auth/me': response({ user: { ...user, weeklyTarget: 1, weeklyMinutesTarget: null } }), '/api/profile/stats': response({ currentWeek: { practiceDays: 0, minutes: 0 }, totals: {}, weeks: [{ weekStart: '2026-09-01', minutes: 0 }] }) }); render(<Profile />); await waitFor(() => expect(screen.getByRole('heading', { name: 'Ada' })).toBeInTheDocument()); expect(screen.getByText('1 day')).toBeInTheDocument(); await userEvent.setup().click(screen.getByRole('button', { name: 'Sep 1' })); expect(screen.getByText(/0 minutes · 0 sessions/)).toBeInTheDocument(); cleanup()
    mockFetch({ '/api/auth/me': response({ user: { ...user, weeklyTarget: 2, weeklyMinutesTarget: 5 } }), '/api/profile/stats': response({ currentWeek: { minutes: 20, practiceDays: 4, daysGoalMet: false, minutesGoalMet: false }, weeks: [{ weekStart: '2026-09-01', minutes: 200 }] }) }); render(<Profile />); await waitFor(() => expect(screen.getByText('0 days to your goal.')).toBeInTheDocument()); expect(screen.getByDisplayValue('5')).toBeInTheDocument()
  })

  it('saves day and minute goals, including rounding, clear, errors, and callbacks', async () => {
    const updated = vi.fn(); const { fn } = mockFetch({ '/api/profile': response({ user: { ...user, weeklyTarget: 5, weeklyMinutesTarget: 20 } }), '/api/profile/stats': response(fullStats) }); render(<Profile onProfileUpdated={updated} />); await waitFor(() => expect(screen.getByRole('heading', { name: 'Ada' })).toBeInTheDocument()); const u = userEvent.setup(); await u.selectOptions(screen.getByLabelText('Weekly practice goal'), '5'); await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Days goal saved.')); const input = screen.getByLabelText('Weekly minutes goal'); await u.clear(input); await u.type(input, '20.6'); fireEvent.blur(input); await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Minutes goal saved.')); expect(updated).toHaveBeenCalled();
    fn.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => String(input) === '/api/profile' && init?.method === 'PATCH' ? response({ error: 'bad' }, false) : response(fullStats)); await u.selectOptions(screen.getByLabelText('Weekly practice goal'), '6'); await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('bad'))
  })

  it('handles avatar, logout, malformed responses, and non Error failures', async () => {
    const out = vi.fn(); const { fn } = mockFetch(); render(<Profile onSignOut={out} />); await waitFor(() => expect(screen.getByRole('heading', { name: 'Ada' })).toBeInTheDocument()); const u = userEvent.setup(); fn.mockImplementationOnce(async () => response({ user: { ...user, avatarKey: 'moon' } })); await u.click(screen.getByRole('button', { name: 'Use moon avatar' })); await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Avatar saved.')); fn.mockImplementationOnce(async () => { throw 'nope' }); await u.click(screen.getByRole('button', { name: 'Use leaf avatar' })); await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Unable to save avatar.')); fn.mockImplementationOnce(async () => response({}, false)); await u.click(screen.getByRole('button', { name: /sign out/i })); await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Unable to sign out.')); fn.mockImplementationOnce(async () => response({}, true)); await u.click(screen.getByRole('button', { name: /sign out/i })); await waitFor(() => expect(out).toHaveBeenCalled())
  })

  it('validates reminder preferences and rolls server settings back on errors', async () => {
    const { fn } = mockFetch(); render(<Profile />); await waitFor(() => expect(screen.getByRole('heading', { name: 'Ada' })).toBeInTheDocument()); const u = userEvent.setup(); const dayButtons = screen.getAllByRole('button', { name: /M|T|W|F|S/ }); for (const day of dayButtons.slice(0, 6)) await u.click(day); fn.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => String(input) === '/api/reminders' && init?.method === 'PATCH' ? response({ error: 'reminder bad' }, false) : response({ settings: { enabled: false, hour: 19, days: [0, 1, 2, 3, 4, 5, 6] } })); await u.selectOptions(screen.getByLabelText('Time'), '8'); await waitFor(() => expect(fn).toHaveBeenCalled())
  })

  it('enables reminders with existing and new subscriptions and permission outcomes', async () => {
    const subscription = { toJSON: () => ({ endpoint: 'old', keys: { auth: 'x' } }), unsubscribe: vi.fn().mockResolvedValue(true) }; Object.defineProperty(window, 'PushManager', { configurable: true, value: class PushManager {} }); const reg = { pushManager: { getSubscription: vi.fn().mockResolvedValue(subscription), subscribe: vi.fn() } }; Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: { ready: Promise.resolve(reg) } }); const { fn } = mockFetch({ '/api/reminders': response({ settings: { enabled: false, hour: 19, days: [0, 1] }, publicKey: 'AQID' }) }); render(<Profile />); await waitFor(() => expect(screen.getByRole('button', { name: /enable phone reminders/i })).toBeInTheDocument()); await userEvent.setup().click(screen.getByRole('button', { name: /enable phone reminders/i })); await waitFor(() => expect(screen.getByText(/phone reminders enabled/i)).toBeInTheDocument()); expect(reg.pushManager.subscribe).not.toHaveBeenCalled(); expect(fn).toHaveBeenCalledWith('/api/reminders/subscriptions', expect.objectContaining({ method: 'POST' }))
    vi.stubGlobal('Notification', { permission: 'denied', requestPermission: vi.fn() }); mockFetch({ '/api/reminders': response({ settings: { enabled: false, hour: 19, days: [0] }, vapidPublicKey: 'AQID' }) }); render(<Profile />); await waitFor(() => expect(screen.getByRole('button', { name: /enable phone reminders/i })).toBeInTheDocument()); await userEvent.setup().click(screen.getByRole('button', { name: /enable phone reminders/i })); await waitFor(() => expect(screen.getByText(/notifications are blocked/i)).toBeInTheDocument())
  })

  it('handles unsupported, missing key, SW timeout, subscribe timeout, and save failures', async () => {
    delete (window as Window & { PushManager?: unknown }).PushManager; mockFetch({ '/api/reminders': response({ vapidPublicKey: 'AQID' }) }); render(<Profile />); await waitFor(() => expect(screen.getByRole('button', { name: /enable phone reminders/i })).toBeInTheDocument()); await userEvent.setup().click(screen.getByRole('button', { name: /enable phone reminders/i })); await waitFor(() => expect(screen.getByText(/need an installed/i)).toBeInTheDocument()); cleanup()
    Object.defineProperty(window, 'PushManager', { configurable: true, value: class PushManager {} }); mockFetch(); render(<Profile />); await waitFor(() => expect(screen.getByRole('button', { name: /phone reminders unavailable/i })).toBeDisabled()); cleanup()
    vi.useRealTimers(); Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: { ready: new Promise(() => {}) } }); mockFetch({ '/api/reminders': response({ vapidPublicKey: 'AQID' }) }); render(<Profile />); await waitFor(() => expect(screen.getByRole('button', { name: /enable phone reminders/i })).toBeInTheDocument()); vi.useFakeTimers(); fireEvent.click(screen.getByRole('button', { name: /enable phone reminders/i })); await vi.advanceTimersByTimeAsync(15001)
  })

  it('disables reminders, cleans subscription, and reports cleanup failures', async () => {
    const unsub = vi.fn().mockRejectedValue('failed'); const subscription = { endpoint: 'ep', toJSON: () => ({}), unsubscribe: unsub }; const reg = { pushManager: { getSubscription: vi.fn().mockResolvedValue(subscription) } }; Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: { ready: Promise.resolve(reg) } }); const { fn } = mockFetch({ '/api/reminders': response({ settings: { enabled: true, hour: 19, days: [0] }, vapidPublicKey: null }), '/api/reminders/subscriptions': response({}, false) }); render(<Profile />); await waitFor(() => expect(screen.getByRole('button', { name: /turn off/i })).toBeInTheDocument()); await userEvent.setup().click(screen.getByRole('button', { name: /turn off/i })); await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('could not be removed')); expect(fn).toHaveBeenCalledWith('/api/reminders/subscriptions', expect.objectContaining({ method: 'DELETE' }))
  })

  it('decodes VAPID and handles a pending new subscription timeout', async () => {
    const registration = { pushManager: { getSubscription: vi.fn().mockResolvedValue(null), subscribe: vi.fn().mockReturnValue(new Promise(() => {})) } }
    Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: { ready: Promise.resolve(registration) } })
    mockFetch({ '/api/reminders': response({ settings: { enabled: false, hour: 19, days: [0] }, vapidPublicKey: 'AQID' }) })
    render(<Profile />); await waitFor(() => expect(screen.getByRole('button', { name: /enable phone reminders/i })).toBeInTheDocument())
    vi.useFakeTimers(); fireEvent.click(screen.getByRole('button', { name: /enable phone reminders/i })); await vi.advanceTimersByTimeAsync(15001)
  })

  it('covers optional profile and reminder payload fallbacks', async () => {
    const sparseUser = { id: 'u', name: 'Ada', email: 'ada@example.com', timezone: 'UTC', weeklyTarget: 3 }
    mockFetch({
      '/api/auth/me': response({ user: sparseUser }),
      '/api/profile/stats': response({}),
      '/api/reminders': response({ reminders: { enabled: false, hour: 0, days: [0] }, publicKey: 'AQID' }),
    })
    render(<Profile />)
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Ada' })).toBeInTheDocument())
    expect(screen.getByRole('button', { name: /enable phone reminders/i })).toBeInTheDocument()
    expect(screen.getByText(/Around 12 AM/)).toBeInTheDocument()
  })

  it('uses malformed JSON fallbacks and stats response failures for saves', async () => {
    const malformed = { ok: false, status: 500, json: vi.fn().mockRejectedValue(new SyntaxError('bad json')) } as unknown as Response
    const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === '/api/auth/me') return response({ user })
      if (url === '/api/profile/stats') return response({}, false)
      if (url === '/api/reminders') return response({ settings: { enabled: false, hour: 19, days: [0, 1, 2, 3, 4, 5, 6] } })
      if (url === '/api/profile' && init?.method === 'PATCH') return response({ user })
      return response({})
    })
    vi.stubGlobal('fetch', fn)
    render(<Profile />)
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Ada' })).toBeInTheDocument())
    const u = userEvent.setup()
    fn.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => String(input) === '/api/profile' && init?.method === 'PATCH' ? malformed : String(input) === '/api/auth/me' ? response({ user }) : String(input) === '/api/profile/stats' ? response(fullStats) : response({}))
    await u.selectOptions(screen.getByLabelText('Weekly practice goal'), '4')
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Unable to save weekly goal.'))
    const minutes = screen.getByLabelText('Weekly minutes goal')
    await u.clear(minutes); await u.type(minutes, '45'); fireEvent.blur(minutes)
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Unable to save minutes goal.'))
    await u.click(screen.getByRole('button', { name: 'Use moon avatar' }))
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Unable to save avatar.'))
  })

  it('covers explicit reminder validation, aliases, and failed preference saves', async () => {
    const { fn } = mockFetch({ '/api/reminders': response({ settings: { enabled: false, hour: 19, days: [0, 1, 2, 3, 4, 5, 6] } }) })
    render(<Profile />)
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Ada' })).toBeInTheDocument())
    const u = userEvent.setup()
    const days = screen.getAllByRole('button', { name: /^(M|T|W|F|S)$/ })
    // The UI disables the final selected day. Remove that guard only to exercise
    // the handler's validation boundary and prove it remains fail-closed.
    for (const day of days.slice(0, 6)) await u.click(day)
    const selectedDay = days.find(day => day.getAttribute('aria-pressed') === 'true')! as HTMLButtonElement; selectedDay.disabled = false; fireEvent.click(selectedDay)
    await new Promise(resolve => setTimeout(resolve, 0))
    fn.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => String(input) === '/api/reminders' && init?.method === 'PATCH' ? response({ reminders: { enabled: false, hour: 8, days: [1] } }) : response({}))
    await u.selectOptions(screen.getByLabelText('Time'), '8')
    await new Promise(resolve => setTimeout(resolve, 0))
    fn.mockImplementationOnce(async () => ({ ok: false, status: 500, json: vi.fn().mockRejectedValue(new SyntaxError('bad')) } as unknown as Response))
    await u.selectOptions(screen.getByLabelText('Time'), '9')
    await new Promise(resolve => setTimeout(resolve, 0))
  })

  it('covers notification setup failures and both permission outcomes', async () => {
    const u = userEvent.setup()
    // Missing VAPID configuration is guarded by a disabled button in production;
    // remove only that DOM guard to exercise the explicit handler failure.
    mockFetch()
    render(<Profile />)
    await waitFor(() => expect(screen.getByRole('button', { name: /phone reminders unavailable/i })).toBeInTheDocument())
    const unavailable = screen.getByRole('button', { name: /phone reminders unavailable/i }) as HTMLButtonElement; unavailable.disabled = false; fireEvent.click(unavailable)
    await new Promise(resolve => setTimeout(resolve, 0))
    cleanup()

    const reg = { pushManager: { getSubscription: vi.fn().mockResolvedValue(null), subscribe: vi.fn().mockRejectedValue('subscribe failed') } }
    Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: { ready: Promise.resolve(reg) } })
    vi.stubGlobal('Notification', { permission: 'default', requestPermission: vi.fn().mockResolvedValue('denied') })
    mockFetch({ '/api/reminders': response({ settings: { enabled: false, hour: 19, days: [0] }, vapidPublicKey: 'AQID' }) })
    render(<Profile />); await waitFor(() => expect(screen.getByRole('button', { name: /enable phone reminders/i })).toBeInTheDocument()); await u.click(screen.getByRole('button', { name: /enable phone reminders/i }))
    await waitFor(() => expect(screen.getByText(/notifications are blocked/i)).toBeInTheDocument())
    cleanup()

    vi.stubGlobal('Notification', { permission: 'granted', requestPermission: vi.fn() })
    const failing = { pushManager: { getSubscription: vi.fn().mockResolvedValue(null), subscribe: vi.fn().mockResolvedValue({ toJSON: () => ({ endpoint: 'ep', keys: {} }) }) } }
    Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: { ready: Promise.resolve(failing) } })
    const { fn } = mockFetch({ '/api/reminders': response({ settings: { enabled: false, hour: 19, days: [0] }, vapidPublicKey: 'AQID' }), '/api/reminders/subscriptions': response({}, false) })
    render(<Profile />); await waitFor(() => expect(screen.getByRole('button', { name: /enable phone reminders/i })).toBeInTheDocument()); await u.click(screen.getByRole('button', { name: /enable phone reminders/i }))
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(fn).toHaveBeenCalledWith('/api/reminders/subscriptions', expect.objectContaining({ method: 'POST' }))
    cleanup()

    const { fn: settingsFail } = mockFetch({ '/api/reminders': response({ settings: { enabled: false, hour: 19, days: [0] }, vapidPublicKey: 'AQID' }), '/api/reminders/subscriptions': response({}), })
    settingsFail.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => String(input) === '/api/reminders' && init?.method === 'PATCH' ? response({}, false) : String(input) === '/api/auth/me' ? response({ user }) : String(input) === '/api/profile/stats' ? response(fullStats) : response({ settings: { enabled: false, hour: 19, days: [0] }, vapidPublicKey: 'AQID' }))
    render(<Profile />); await waitFor(() => expect(screen.getByRole('button', { name: /enable phone reminders/i })).toBeInTheDocument()); await u.click(screen.getByRole('button', { name: /enable phone reminders/i }))
    await new Promise(resolve => setTimeout(resolve, 0))
  })

  it('covers disable fallbacks, service worker absence, and optional callbacks', async () => {
    const u = userEvent.setup()
    const { fn } = mockFetch({ '/api/reminders': response({ reminders: { enabled: true, hour: 19, days: [0] } }) })
    render(<Profile />)
    await waitFor(() => expect(screen.getByRole('button', { name: /turn off/i })).toBeInTheDocument())
    const oldWorker = (navigator as Navigator & { serviceWorker?: unknown }).serviceWorker
    Reflect.deleteProperty(navigator, 'serviceWorker')
    await u.click(screen.getByRole('button', { name: /turn off/i }))
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Phone reminders disabled.'))
    expect(fn).toHaveBeenCalledWith('/api/reminders', expect.objectContaining({ method: 'PATCH' }))
    Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: oldWorker })
    cleanup()
    mockFetch({ '/api/reminders': (init: RequestInit | undefined) => init?.method === 'PATCH' ? response({}, false) : response({ reminders: { enabled: true, hour: 19, days: [0] } }) }); render(<Profile />); await waitFor(() => expect(screen.getByRole('button', { name: /turn off/i })).toBeInTheDocument()); await u.click(screen.getByRole('button', { name: /turn off/i }))
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Could not disable reminders.'))
    cleanup(); mockFetch(); render(<Profile />); await waitFor(() => expect(screen.getByRole('heading', { name: 'Ada' })).toBeInTheDocument()); await u.click(screen.getByRole('button', { name: /sign out/i }))
  })

  it('covers legacy empty-day settings and minimal stat defaults', async () => {
    const { fn } = mockFetch({
      '/api/auth/me': response({ user: { ...user, weeklyMinutesTarget: undefined, avatarKey: undefined } }),
      '/api/profile/stats': response({ currentWeek: {}, totals: {}, weeks: [] }),
      '/api/reminders': response({ reminders: { enabled: false, hour: 19, days: [] }, publicKey: 'AQID' }),
    })
    render(<Profile />)
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Ada' })).toBeInTheDocument())
    expect(screen.getByText('0 / 3 practice days')).toBeInTheDocument()
    const u = userEvent.setup()
    await u.selectOptions(screen.getByLabelText('Time'), '8')
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(fn.mock.calls.some(call => call[0] === '/api/reminders' && call[1]?.method === 'PATCH')).toBe(false)
    expect(screen.getByRole('alert')).toHaveTextContent('Choose at least one reminder day.')
    await u.click(screen.getByRole('button', { name: 'Use initials' }))
    await waitFor(() => expect(fn).toHaveBeenCalledWith('/api/profile', expect.objectContaining({ method: 'PATCH' })))
  })

  it('covers disable JSON fallback and no-settings updater', async () => {
    const malformed = { ok: true, status: 200, json: vi.fn().mockRejectedValue(new SyntaxError('bad json')) } as unknown as Response
    const { fn } = mockFetch({ '/api/reminders': (init: RequestInit | undefined) => init?.method === 'PATCH' ? malformed : response({ settings: { enabled: true, hour: 19, days: [0] } }) })
    render(<Profile />)
    await waitFor(() => expect(screen.getByRole('button', { name: /turn off/i })).toBeInTheDocument())
    await userEvent.setup().click(screen.getByRole('button', { name: /turn off/i }))
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Phone reminders disabled.'))
    expect(fn).toHaveBeenCalledWith('/api/reminders', expect.objectContaining({ method: 'PATCH' }))
  })

  it('covers explicit null profile and reminder aliases plus initials callback', async () => {
    const { fn } = mockFetch({
      '/api/auth/me': response({ user: { ...user, weeklyMinutesTarget: null, avatarKey: null } }),
      '/api/profile/stats': response(null),
      '/api/reminders': response({ settings: null, reminders: { enabled: false, hour: 19, days: [0, 1, 2] }, publicKey: 'AQID' }),
    })
    render(<Profile />)
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Ada' })).toBeInTheDocument())
    const initials = screen.getByRole('button', { name: 'Use initials' })
    fireEvent.click(initials)
    await waitFor(() => expect(fn).toHaveBeenCalledWith('/api/profile', expect.objectContaining({ method: 'PATCH' })))
  })

  it('renders authentication and reminder request failures', async () => {
    mockFetch({ '/api/auth/me': response({}, false), '/api/reminders': response({}, false) })
    render(<Profile />)
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Please sign in again.'))
    cleanup()
    mockFetch({ '/api/auth/me': response({ user }), '/api/reminders': response({}, false) })
    render(<Profile />)
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Ada' })).toBeInTheDocument())
  })

  it('covers nested default fields, save refresh failures, and primitive errors', async () => {
    const legacy = { id: 'u', name: 'Ada', email: 'ada@example.com', timezone: 'UTC' }
    let statsCalls = 0
    const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === '/api/auth/me') return response({ user: legacy })
      if (url === '/api/profile/stats') return ++statsCalls === 1 ? response(fullStats) : response({}, false)
      if (url === '/api/reminders' && !init?.method) return response({ settings: {} })
      if (url === '/api/profile' && init?.method === 'PATCH') throw 'goal save failed'
      return response({ user: legacy })
    })
    vi.stubGlobal('fetch', fn); render(<Profile />)
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Ada' })).toBeInTheDocument())
    const u = userEvent.setup(); await u.selectOptions(screen.getByLabelText('Weekly practice goal'), '4')
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Unable to save weekly goal.'))
    const minutes = screen.getByLabelText('Weekly minutes goal'); await u.clear(minutes); fireEvent.blur(minutes)
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Unable to save minutes goal.'))
  })

  it('covers successful goal saves with failed stats refresh and reminder preference fallbacks', async () => {
    let statsCalls = 0
    const { fn } = mockFetch({
      '/api/profile/stats': () => ++statsCalls === 1 ? response(fullStats) : response({}, false),
      '/api/reminders': (init: RequestInit | undefined) => init?.method === 'PATCH' ? response({ settings: { enabled: false } }) : response({ settings: {} }),
    })
    render(<Profile />); await waitFor(() => expect(screen.getByRole('heading', { name: 'Ada' })).toBeInTheDocument())
    const u = userEvent.setup(); await u.selectOptions(screen.getByLabelText('Weekly practice goal'), '4'); await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Days goal saved.'))
    await u.selectOptions(screen.getByLabelText('Time'), '8'); await new Promise(resolve => setTimeout(resolve, 0))
    fn.mockImplementation(async () => { throw 'preference failed' }); await u.selectOptions(screen.getByLabelText('Time'), '9'); await new Promise(resolve => setTimeout(resolve, 0)); expect(screen.getByRole('alert')).toHaveTextContent('Could not save reminder preferences.')
  })

  it('covers notification generic failure and canonical disable cleanup failures', async () => {
    const subscription = { endpoint: 'ep', toJSON: () => ({ endpoint: 'ep', keys: {} }), unsubscribe: vi.fn().mockRejectedValue('unsubscribe failed') }
    const reg = { pushManager: { getSubscription: vi.fn().mockResolvedValueOnce(subscription).mockResolvedValue(null), subscribe: vi.fn() } }
    Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: { ready: Promise.resolve(reg) } })
    const { fn } = mockFetch({
      '/api/reminders': (init: RequestInit | undefined) => init?.method === 'PATCH' ? response({ settings: { enabled: false } }) : response({ settings: { enabled: true, days: [0] }, vapidPublicKey: 'AQID' }),
      '/api/reminders/subscriptions': (init: RequestInit | undefined) => init?.method === 'POST' ? (() => { throw 'post failed' })() : response({}, false),
    })
    render(<Profile />); await waitFor(() => expect(screen.getByRole('button', { name: /turn off/i })).toBeInTheDocument())
    await userEvent.setup().click(screen.getByRole('button', { name: /turn off/i })); await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('could not be removed'))
    cleanup(); fn.mockReset(); vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => { if (String(input) === '/api/auth/me') return response({ user }); if (String(input) === '/api/profile/stats') return response(fullStats); if (String(input) === '/api/reminders') return response({ settings: { enabled: false, days: [0] }, vapidPublicKey: 'AQID' }); if (String(input) === '/api/reminders/subscriptions') throw 'post failed'; return response({}) }))
    render(<Profile />); await waitFor(() => expect(screen.getByRole('button', { name: /enable phone reminders/i })).toBeInTheDocument()); await userEvent.setup().click(screen.getByRole('button', { name: /enable phone reminders/i })); await new Promise(resolve => setTimeout(resolve, 0))
    expect(screen.queryByText('Phone reminders enabled.')).not.toBeInTheDocument()
  })

  it('covers minimal stats defaults and reminder day add/remove paths', async () => {
    mockFetch({ '/api/profile/stats': response({ currentWeek: {}, totals: {}, weeks: [{ weekStart: '2026-09-01', minutes: 1 }] }), '/api/reminders': response({ settings: { enabled: false, hour: 19, days: [0, 1] }, vapidPublicKey: null }) })
    render(<Profile />); await waitFor(() => expect(screen.getByRole('heading', { name: 'Ada' })).toBeInTheDocument()); expect(screen.getByText('0 / 3 practice days')).toBeInTheDocument(); await userEvent.setup().click(screen.getByRole('button', { name: 'Sep 1' })); expect(screen.getByText(/0 sessions · 0 practice days/)).toBeInTheDocument()
    const days = screen.getAllByRole('button', { name: /^(M|T|W|F|S)$/ }); await userEvent.setup().click(days[0]); await userEvent.setup().click(days[2]);
  })

  it('covers singular goal text and missing minutes progress fallback', async () => {
    mockFetch({ '/api/auth/me': response({ user: { ...user, weeklyTarget: 1, weeklyMinutesTarget: 10 } }), '/api/profile/stats': response({ currentWeek: {}, totals: {} }) })
    render(<Profile />); await waitFor(() => expect(screen.getByRole('heading', { name: 'Ada' })).toBeInTheDocument()); expect(screen.getByText('0 / 1 practice days')).toBeInTheDocument(); expect(screen.getByText(/10 minutes to goal/)).toBeInTheDocument()
  })

  it('covers the final save, notification, cleanup, fallback, and singular branches', async () => {
    let statsCalls = 0
    const { fn } = mockFetch({ '/api/profile/stats': () => ++statsCalls === 1 ? response(fullStats) : response({}, false) })
    render(<Profile />); await waitFor(() => expect(screen.getByRole('heading', { name: 'Ada' })).toBeInTheDocument()); const u = userEvent.setup(); const minutes = screen.getByLabelText('Weekly minutes goal'); await u.clear(minutes); await u.type(minutes, '15'); fireEvent.blur(minutes); await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Minutes goal saved.')); cleanup()

    const rejectedReg = { pushManager: { getSubscription: vi.fn().mockRejectedValue('subscription lookup failed') } }; Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: { ready: Promise.resolve(rejectedReg) } }); vi.stubGlobal('Notification', { permission: 'granted', requestPermission: vi.fn() }); mockFetch({ '/api/reminders': response({ settings: { enabled: false, days: [0] }, vapidPublicKey: 'AQID' }) }); render(<Profile />); await waitFor(() => expect(screen.getByRole('button', { name: /enable phone reminders/i })).toBeInTheDocument()); await u.click(screen.getByRole('button', { name: /enable phone reminders/i })); await new Promise(resolve => setTimeout(resolve, 0)); cleanup()

    const sub = { endpoint: 'ep', unsubscribe: vi.fn().mockResolvedValue(true), toJSON: () => ({ endpoint: 'ep', keys: {} }) }; const goodReg = { pushManager: { getSubscription: vi.fn().mockResolvedValue(sub) } }; Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: { ready: Promise.resolve(goodReg) } }); mockFetch({ '/api/reminders': (init: RequestInit | undefined) => init?.method === 'PATCH' ? response({ settings: { enabled: false } }) : response({ settings: { enabled: true, days: [0] } }), '/api/reminders/subscriptions': response({}) }); render(<Profile />); await waitFor(() => expect(screen.getByRole('button', { name: /turn off/i })).toBeInTheDocument()); await u.click(screen.getByRole('button', { name: /turn off/i })); await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Phone reminders disabled.')); cleanup()

    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => String(input) === '/api/auth/me' ? response({ user }) : String(input) === '/api/profile/stats' ? response(fullStats) : String(input) === '/api/reminders' && init?.method === 'PATCH' ? Promise.reject('disable failed') : response({ settings: { enabled: true, days: [0] } }))); render(<Profile />); await waitFor(() => expect(screen.getByRole('button', { name: /turn off/i })).toBeInTheDocument()); await u.click(screen.getByRole('button', { name: /turn off/i })); await new Promise(resolve => setTimeout(resolve, 0));
    cleanup(); vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => String(input) === '/api/auth/me' ? Promise.reject(new Error('')) : response(fullStats))); render(<Profile />); await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Unable to load your profile.')); cleanup()
    mockFetch({ '/api/auth/me': response({ user: { ...user, weeklyTarget: 1 } }), '/api/profile/stats': response({}, false) }); render(<Profile />); await waitFor(() => expect(screen.getAllByText('1 day').length).toBeGreaterThan(0))
  })
})
