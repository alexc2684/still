import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import Profile from '../../../src/components/Profile'

const response = (body: unknown, ok = true): Response => ({ ok, json: async () => body } as Response)
const user = { id: 'u', name: 'Ada', email: 'ada@example.com', timezone: 'UTC', weeklyTarget: 3, weeklyMinutesTarget: 30, avatarKey: null }
const stats = { totals: { minutes: 10 }, currentWeek: { minutes: 10, sessions: 2, practiceDays: 2, daysGoalMet: true, minutesGoalMet: true }, bestStreak: 5, weeks: [{ weekStart: '2026-09-01', minutes: 0 }, { weekStart: '2026-09-08', minutes: 50, sessions: 3, practiceDays: 2 }] }

function mockFetch(overrides: Record<string, unknown> = {}) {
  const calls: string[] = []
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input); calls.push(`${init?.method ?? 'GET'} ${url}`)
    if (overrides[url]) return typeof overrides[url] === 'function' ? (overrides[url] as Function)(init) : overrides[url] as Response
    if (url === '/api/auth/me') return response({ user })
    if (url === '/api/profile/stats') return response(stats)
    if (url === '/api/profile') return response({ user })
    return response({}, url === '/api/auth/logout')
  })
  vi.stubGlobal('fetch', fn); return { calls, fn }
}

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('Profile complete behavior', () => {
  it('renders signed-out, loading, load error, and stats fallback states', async () => {
    const signIn = vi.fn(); render(<Profile signedIn={false} onSignIn={signIn} />); await userEvent.setup().click(screen.getByRole('button', { name: /sign in/i })); expect(signIn).toHaveBeenCalled(); cleanup()
    mockFetch({ '/api/profile/stats': response({}, false) }); render(<Profile />); expect(screen.getByText('Loading your profile…')).toBeInTheDocument(); await waitFor(() => expect(screen.getAllByText('3 days').length).toBeGreaterThan(0)); cleanup()
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue('offline')); render(<Profile />); await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Unable to load profile.'))
  })

  it('does not show timezone or reminders, fetch reminder state, or lose install help', async () => {
    const { calls } = mockFetch(); render(<Profile />); await waitFor(() => expect(screen.getByRole('heading', { name: 'Ada' })).toBeInTheDocument())
    expect(screen.queryByText('Timezone')).not.toBeInTheDocument(); expect(screen.queryByText(/reminder/i)).not.toBeInTheDocument(); expect(screen.getByText('Install Still on iPhone')).toBeInTheDocument(); expect(screen.getByText(/In Safari, tap Share/)).toBeInTheDocument(); expect(calls).not.toContain('GET /api/reminders')
  })

  it('covers nullable stats, chart details, and progress bounds', async () => {
    mockFetch({ '/api/auth/me': response({ user: { ...user, weeklyTarget: 1, weeklyMinutesTarget: null } }), '/api/profile/stats': response({ currentWeek: { practiceDays: 0, minutes: 0 }, totals: {}, weeks: [{ weekStart: '2026-09-01', minutes: 0 }] }) }); render(<Profile />); await waitFor(() => expect(screen.getByText('1 day')).toBeInTheDocument()); await userEvent.setup().click(screen.getByRole('button', { name: 'Sep 1' })); expect(screen.getByText(/0 minutes · 0 sessions/)).toBeInTheDocument(); cleanup()
    mockFetch({ '/api/auth/me': response({ user: { ...user, weeklyTarget: 2, weeklyMinutesTarget: 5 } }), '/api/profile/stats': response({ currentWeek: { minutes: 20, practiceDays: 4, daysGoalMet: false, minutesGoalMet: false }, weeks: [{ weekStart: '2026-09-01', minutes: 200 }] }) }); render(<Profile />); await waitFor(() => expect(screen.getByText('0 days to your goal.')).toBeInTheDocument())
    cleanup(); mockFetch({ '/api/auth/me': response({ user: { ...user, weeklyMinutesTarget: 10 } }), '/api/profile/stats': response({ currentWeek: {}, totals: {} }) }); render(<Profile />); await waitFor(() => expect(screen.getByText('0 / 10 minutes')).toBeInTheDocument()); expect(screen.getByText('10 minutes to goal.')).toBeInTheDocument()
  })

  it('saves goals and reports server errors', async () => {
    const updated = vi.fn(); const { fn } = mockFetch({ '/api/profile': response({ user: { ...user, weeklyTarget: 5, weeklyMinutesTarget: 20 } }) }); render(<Profile onProfileUpdated={updated} />); await waitFor(() => expect(screen.getByRole('heading', { name: 'Ada' })).toBeInTheDocument()); const u = userEvent.setup(); await u.selectOptions(screen.getByLabelText('Weekly practice goal'), '5'); await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Days goal saved.')); const input = screen.getByLabelText('Weekly minutes goal'); await u.clear(input); await u.type(input, '20.6'); fireEvent.blur(input); await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Minutes goal saved.')); expect(updated).toHaveBeenCalled()
    fn.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => String(input) === '/api/profile' && init?.method === 'PATCH' ? response({ error: 'bad' }, false) : response(stats)); await u.selectOptions(screen.getByLabelText('Weekly practice goal'), '6'); await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('bad'))
  })

  it('handles avatar and logout success and failures', async () => {
    const out = vi.fn(); const { fn } = mockFetch(); render(<Profile onSignOut={out} />); await waitFor(() => expect(screen.getByRole('heading', { name: 'Ada' })).toBeInTheDocument()); const u = userEvent.setup(); fn.mockImplementationOnce(async () => response({ user: { ...user, avatarKey: 'moon' } })); await u.click(screen.getByRole('button', { name: 'Use moon avatar' })); await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Avatar saved.')); fn.mockImplementationOnce(async () => { throw 'nope' }); await u.click(screen.getByRole('button', { name: 'Use leaf avatar' })); await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Unable to save avatar.')); fn.mockImplementationOnce(async () => response({}, false)); await u.click(screen.getByRole('button', { name: /sign out/i })); await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Unable to sign out.')); fn.mockImplementationOnce(async () => response({})); await u.click(screen.getByRole('button', { name: /sign out/i })); await waitFor(() => expect(out).toHaveBeenCalled())
  })

  it('handles malformed save responses', async () => {
    const malformed = { ok: false, json: vi.fn().mockRejectedValue(new SyntaxError('bad')) } as unknown as Response; const { fn } = mockFetch(); render(<Profile />); await waitFor(() => expect(screen.getByRole('heading', { name: 'Ada' })).toBeInTheDocument()); const u = userEvent.setup(); fn.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => String(input) === '/api/profile' && init?.method === 'PATCH' ? malformed : String(input) === '/api/profile/stats' ? response(stats) : response({ user })); await u.selectOptions(screen.getByLabelText('Weekly practice goal'), '4'); await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Unable to save weekly goal.')); const minutes = screen.getByLabelText('Weekly minutes goal'); await u.clear(minutes); fireEvent.blur(minutes); await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Unable to save minutes goal.')); cleanup()
  })

  it('covers remaining request, fallback, and optional callback branches', async () => {
    mockFetch({ '/api/auth/me': response({}, false) }); render(<Profile />); await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Please sign in again.')); cleanup()
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error(''))); render(<Profile />); await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Unable to load your profile.')); cleanup()

    let statsCalls = 0
    const legacy = { ...user, weeklyTarget: undefined, weeklyMinutesTarget: undefined }
    const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === '/api/auth/me') return response({ user: legacy })
      if (url === '/api/profile/stats') return ++statsCalls === 1 ? response({ currentWeek: {}, totals: {} }) : response({}, false)
      if (url === '/api/profile' && init?.method === 'PATCH') throw 'save failed'
      return response({})
    })
    vi.stubGlobal('fetch', fn); render(<Profile />); await waitFor(() => expect(screen.getByRole('heading', { name: 'Ada' })).toBeInTheDocument()); const u = userEvent.setup(); await u.selectOptions(screen.getByLabelText('Weekly practice goal'), '4'); await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Unable to save weekly goal.')); const minutes = screen.getByLabelText('Weekly minutes goal'); await u.clear(minutes); fireEvent.blur(minutes); await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Unable to save minutes goal.')); cleanup()

    statsCalls = 0; mockFetch({ '/api/auth/me': response({ user: { ...user, weeklyTarget: 1, weeklyMinutesTarget: null } }), '/api/profile/stats': response({}, false), '/api/profile': response({ user }) }); render(<Profile />); await waitFor(() => expect(screen.getAllByText('1 day').length).toBeGreaterThan(0)); await u.selectOptions(screen.getByLabelText('Weekly practice goal'), '2'); const emptyMinutes = screen.getByLabelText('Weekly minutes goal'); await u.type(emptyMinutes, '15'); fireEvent.blur(emptyMinutes); await u.click(screen.getByRole('button', { name: 'Use initials' })); cleanup()

    const malformed = { ok: false, json: vi.fn().mockRejectedValue(new Error('bad')) } as unknown as Response
    const { fn: avatarFetch } = mockFetch(); render(<Profile />); await waitFor(() => expect(screen.getByRole('heading', { name: 'Ada' })).toBeInTheDocument()); avatarFetch.mockImplementationOnce(async () => malformed); await userEvent.setup().click(screen.getByRole('button', { name: 'Use moon avatar' })); await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Unable to save avatar.'))
  })
})
