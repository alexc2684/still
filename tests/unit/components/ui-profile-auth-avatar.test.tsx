import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import Avatar from '../../../src/components/Avatar'
import AuthModal from '../../../src/components/AuthModal'
import Profile from '../../../src/components/Profile'

const json = (value: unknown, ok = true, status = ok ? 200 : 400): Response => ({ ok, status, json: async () => value } as unknown as Response)

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('Avatar', () => {
  it('renders initials and named avatar icons with their accessible names', () => {
    const { rerender } = render(<Avatar name="Ada Lovelace" size="small" />)
    expect(screen.getByLabelText('Ada Lovelace')).toHaveTextContent('AL')
    rerender(<Avatar name="Ada Lovelace" avatarKey="moon" size="large" />)
    expect(screen.getByLabelText("Ada Lovelace's avatar")).toBeInTheDocument()
    expect(screen.getByLabelText("Ada Lovelace's avatar").querySelector('svg')).toHaveAttribute('width', '28')
    rerender(<Avatar name="Ada Lovelace" avatarKey="leaf" size="small" />)
    expect(screen.getByLabelText("Ada Lovelace's avatar").querySelector('svg')).toHaveAttribute('width', '14')
    rerender(<Avatar name="Ada Lovelace" avatarKey="sun" />)
    expect(screen.getByLabelText("Ada Lovelace's avatar").querySelector('svg')).toHaveAttribute('width', '18')
    rerender(<Avatar name="Single" avatarKey="unknown" />)
    expect(screen.getByLabelText('Single')).toHaveTextContent('S')
  })
})

describe('AuthModal', () => {
  it('focuses the first field, traps tab, closes on escape, and submits login', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn(); const onSuccess = vi.fn()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ user: { id: 'u', name: 'A', email: 'a@test', timezone: 'UTC' } })))
    render(<AuthModal onClose={onClose} onSuccess={onSuccess} />)
    expect(screen.getByPlaceholderText('you@example.com')).toHaveFocus()
    await user.type(screen.getByPlaceholderText('you@example.com'), 'a@test')
    await user.type(screen.getByPlaceholderText('Your password'), 'secret')
    await user.click(screen.getByRole('button', { name: 'Sign in →' }))
    await waitFor(() => expect(onSuccess).toHaveBeenCalledWith(expect.objectContaining({ id: 'u' })))
    const close = screen.getByRole('button', { name: 'Close sign in' })
    close.focus(); fireEvent.keyDown(document, { key: 'Tab', shiftKey: true }); expect(screen.getByRole('button', { name: /new to still/i })).toHaveFocus()
    fireEvent.keyDown(document, { key: 'Escape' }); expect(onClose).toHaveBeenCalled()
  })

  it('switches to signup and shows server errors while pending', async () => {
    const user = userEvent.setup(); const onSuccess = vi.fn()
    let reject!: (error: Error) => void
    vi.stubGlobal('fetch', vi.fn().mockReturnValue(new Promise((_resolve, r) => { reject = r })))
    render(<AuthModal onClose={vi.fn()} onSuccess={onSuccess} />)
    await user.click(screen.getByRole('button', { name: /new to still/i }))
    expect(screen.getByRole('heading', { name: 'Begin a practice.' })).toBeInTheDocument()
    await user.type(screen.getByPlaceholderText('Your name'), 'Ada')
    await user.type(screen.getAllByPlaceholderText('you@example.com')[0], 'a@test')
    await user.type(screen.getByPlaceholderText('8 characters minimum'), 'password')
    await user.click(screen.getByRole('button', { name: /create account/i }))
    expect(screen.getByRole('button', { name: /please wait/i })).toBeDisabled()
    reject(new Error('Bad credentials'))
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Bad credentials'))
    expect(onSuccess).not.toHaveBeenCalled()
  })

  it('handles keyboard mode switching and non-Error network failures', async () => {
    const user = userEvent.setup(); vi.stubGlobal('fetch', vi.fn().mockRejectedValue('offline'))
    render(<AuthModal onClose={vi.fn()} onSuccess={vi.fn()} />)
    const switcher = screen.getByRole('button', { name: /new to still/i })
    fireEvent.keyDown(switcher, { key: 'Enter' }); fireEvent.keyDown(switcher, { key: ' ' }); expect(switcher).toBeInTheDocument()
    await user.click(switcher)
    await user.click(screen.getByRole('button', { name: /already have an account/i }))
    await user.click(screen.getByRole('button', { name: /new to still/i }))
    await user.type(screen.getByPlaceholderText('Your name'), 'A')
    await user.type(screen.getAllByPlaceholderText('you@example.com')[0], 'a@test')
    await user.type(screen.getByPlaceholderText('8 characters minimum'), 'password')
    await user.click(screen.getByRole('button', { name: /create account/i }))
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Unable to reach Still'))
  })

  it('wraps forward tab from the final control and reports non-ok responses without messages', async () => {
    const user = userEvent.setup(); vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, json: async () => ({}) }))
    render(<AuthModal onClose={vi.fn()} onSuccess={vi.fn()} />)
    await user.type(screen.getByPlaceholderText('you@example.com'), 'a@test'); await user.type(screen.getByPlaceholderText('Your password'), 'pw')
    await user.click(screen.getByRole('button', { name: /sign in →/i }))
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Could not continue'))
    const switcher = screen.getByRole('button', { name: /new to still/i }); switcher.focus(); fireEvent.keyDown(document, { key: 'Tab' })
    expect(screen.getByRole('button', { name: 'Close sign in' })).toHaveFocus()
    screen.getByPlaceholderText('you@example.com').focus(); fireEvent.keyDown(document, { key: 'Tab' })
  })

  it('treats malformed response JSON as the generic auth error', async () => {
    const user = userEvent.setup(); vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, json: async () => { throw new Error('malformed') } }))
    render(<AuthModal onClose={vi.fn()} onSuccess={vi.fn()} />)
    await user.type(screen.getByPlaceholderText('you@example.com'), 'a@test'); await user.type(screen.getByPlaceholderText('Your password'), 'pw'); await user.click(screen.getByRole('button', { name: /sign in →/i }))
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Could not continue'))
  })

  it('ignores tab events when the dialog has no focusable controls', () => {
    const query = vi.spyOn(HTMLElement.prototype, 'querySelectorAll').mockReturnValue([] as unknown as NodeListOf<HTMLElement>)
    render(<AuthModal onClose={vi.fn()} onSuccess={vi.fn()} />)
    fireEvent.keyDown(document, { key: 'Tab' })
    query.mockRestore()
  })
})

describe('Profile', () => {
  const profile = { id: 'u1', name: 'Ada Lovelace', email: 'ada@test', timezone: 'UTC', weeklyTarget: 3, weeklyMinutesTarget: 30, avatarKey: null }
  const stats = { totals: { minutes: 42 }, currentWeek: { minutes: 12, sessions: 2, practiceDays: 1, daysGoalMet: false, minutesGoalMet: false }, bestStreak: 4, weeks: [{ weekStart: '2026-09-01', minutes: 0, sessions: 0, practiceDays: 0 }, { weekStart: '2026-09-08', minutes: 20, sessions: 1, practiceDays: 1 }] }
  function setupFetch(overrides: Record<string, unknown> = {}) {
    const calls: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input); calls.push(`${init?.method ?? 'GET'} ${url}`)
      if (url === '/api/auth/me') return json({ user: profile })
      if (url === '/api/profile/stats') return json(stats)
      if (url === '/api/reminders') return json({ settings: { enabled: false, hour: 19, days: [0, 1, 2, 3, 4, 5, 6] }, vapidPublicKey: null })
      if (url === '/api/profile') return json({ user: { ...profile, ...overrides } })
      if (url === '/api/auth/logout') return json({}, true)
      return json({})
    }))
    return calls
  }

  it('loads profile stats, updates goals and rolls avatar back on failure', async () => {
    const calls = setupFetch(); const updated = vi.fn()
    render(<Profile onProfileUpdated={updated} />)
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Ada Lovelace' })).toBeInTheDocument())
    expect(screen.getByText('12')).toBeInTheDocument(); expect(screen.getByText('1 / 3 practice days')).toBeInTheDocument()
    await userEvent.setup().selectOptions(screen.getByLabelText('Weekly practice goal'), '5')
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Days goal saved.'))
    expect(calls).toContain('PATCH /api/profile')
    vi.mocked(fetch).mockImplementationOnce(async () => json({ user: { ...profile, avatarKey: 'leaf' } }))
    await userEvent.setup().click(screen.getByRole('button', { name: 'Use leaf avatar' }))
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Avatar saved.'))
    vi.mocked(fetch).mockImplementationOnce(async () => json({ error: 'Avatar rejected' }, false, 500))
    await userEvent.setup().click(screen.getByRole('button', { name: 'Use moon avatar' }))
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Avatar rejected'))
    expect(updated).toHaveBeenCalled()
  })

  it('renders signed-out and loading states and signs out successfully', async () => {
    const onSignIn = vi.fn(); const user = userEvent.setup()
    render(<Profile signedIn={false} onSignIn={onSignIn} />)
    await user.click(screen.getByRole('button', { name: /sign in to your profile/i })); expect(onSignIn).toHaveBeenCalled()
    setupFetch(); const onSignOut = vi.fn(); render(<Profile onSignOut={onSignOut} />)
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Ada Lovelace' })).toBeInTheDocument())
    await user.click(screen.getByRole('button', { name: /sign out/i })); await waitFor(() => expect(onSignOut).toHaveBeenCalled())
  })

})
