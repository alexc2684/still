import { StrictMode } from 'react'
import { act, fireEvent, render, screen, waitFor, cleanup } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import Journal from '@/components/Journal'
import Circle from '@/components/Circle'
import AuthModal from '@/components/AuthModal'
import ResetPage from '@/app/reset-password/page'
const response = (body: unknown, status = 200) => Response.json(body, { status })
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); window.history.replaceState(null, '', '/') })

it('selects dates, replaces reflections, handles an empty day and keeps lifetime totals', async () => {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'UTC' }).format(new Date())
  const day = `${today.slice(0, 7)}-01`, empty = `${today.slice(0, 7)}-02`
  const fetcher = vi.fn(async (url: string) => {
    if (url === '/api/auth/me') return response({ user: { timezone: 'UTC' } })
    const date = url.endsWith('today') ? today : url.split('=')[1]
    const sessions = date === empty ? [] : [1, 2].map(id => ({ id: `${date}-${id}`, completedAt: `${date}T12:00:00Z`, completedLocalDate: date, startedAt: `${date}T11:50:00Z`, plannedSeconds: 600, afterNote: `${date} reflection ${id}` }))
    return response({ date, sessions, practiceDates: [today, day], summary: { totalSessions: 205, totalMinutes: 2050 } })
  }); vi.stubGlobal('fetch', fetcher)
  render(<Journal />)
  await screen.findByText(`${today} reflection 1`)
  fireEvent.click(screen.getByRole('button', { name: day }))
  await screen.findByText(`${day} reflection 2`)
  expect(screen.getByRole('button', { name: day })).toHaveAttribute('aria-pressed', 'true')
  if (day !== today) expect(screen.queryByText(`${today} reflection 1`)).not.toBeInTheDocument()
  expect(screen.getByText('205', { selector: '.journal-summary strong' })).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: empty }))
  await screen.findByText('No practice recorded for this day.')
  expect(screen.queryByText(`${day} reflection 1`)).not.toBeInTheDocument()
})
it('retries failed journal loads and ignores stale responses after selection or unmount', async () => {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'UTC' }).format(new Date())
  const date = `${today.slice(0, 7)}-01`
  const body = { date: today, sessions: [], practiceDates: [], summary: { totalSessions: 0, totalMinutes: 0 } }
  let delayed: (r: Response) => void = () => {}
  let count = 0
  vi.stubGlobal('fetch', vi.fn((url: string) => {
    if (url === '/api/auth/me') return Promise.resolve(response({ user: {} }))
    count++
    if (count === 1) return Promise.resolve(response({}, 500))
    if (count === 3) return new Promise<Response>(resolve => { delayed = resolve })
    return Promise.resolve(response({ ...body, date: count === 2 ? today : date }))
  }))
  const view = render(<Journal />)
  await screen.findByRole('alert'); fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
  await screen.findByText('No practice recorded for this day.')
  // Refresh the initial selection, then move to a day while its request is in flight.
  view.rerender(<Journal refreshKey={1} />)
  fireEvent.click(screen.getByRole('button', { name: date }))
  await screen.findByText('No practice recorded for this day.')
  await act(async () => delayed(response(body)))
  expect(screen.getByRole('button', { name: date })).toHaveAttribute('aria-pressed', 'true')
  view.unmount()
})
it.each([0, 1, 24])('shows %s registered users independently of feed activity', async count => {
  vi.stubGlobal('fetch', vi.fn(async () => response({ feed: [], memberCount: count })))
  render(<Circle signedIn onSignIn={vi.fn()} />)
  await screen.findByText(`${count} ${count === 1 ? 'person' : 'people'} in your circle`)
})
it('offers forgot password, displays generic confirmation, and returns to sign in', async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(response({ message: 'Check your email.' })).mockResolvedValueOnce(response({})).mockResolvedValueOnce(response({ error: 'Temporarily unavailable' }, 503))
  vi.stubGlobal('fetch', fetcher)
  render(<AuthModal onClose={vi.fn()} onSuccess={vi.fn()} />)
  fireEvent.click(screen.getByRole('button', { name: 'Forgot password?' }))
  expect(screen.queryByLabelText('Password')).not.toBeInTheDocument()
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'person@example.com' } })
  fireEvent.click(screen.getByRole('button', { name: /Send reset link/ }))
  await screen.findByText('Check your email.')
  expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({ email: 'person@example.com' })
  fireEvent.click(screen.getByRole('button', { name: /Send reset link/ }))
  await screen.findByText('Check your email for a reset link.')
  fireEvent.click(screen.getByRole('button', { name: /Send reset link/ }))
  await screen.findByText('Temporarily unavailable')
  fireEvent.click(screen.getByRole('button', { name: /Already have an account/ }))
  expect(screen.getByLabelText('Password')).toBeInTheDocument()
})
function resetForm() {
  window.history.replaceState(null, '', `/reset-password#token=${'a'.repeat(43)}`)
  return render(<StrictMode><ResetPage /></StrictMode>)
}
function fillReset(confirmation = 'new password') {
  fireEvent.change(screen.getByLabelText('New password', { exact: true }), { target: { value: 'new password' } })
  fireEvent.change(screen.getByLabelText('Confirm new password'), { target: { value: confirmation } })
  fireEvent.submit(screen.getByRole('button', { name: /Reset password/ }).closest('form')!)
}
it('keeps the fragment token through StrictMode, validates confirmation, and displays success', async () => {
  const fetcher = vi.fn(async (_url: string, _init: { body: string }) => response({ message: 'Reset', user: { id: 'u1', name: 'User', email: 'person@example.com', timezone: 'UTC' } })); vi.stubGlobal('fetch', fetcher)
  resetForm(); expect(window.location.hash).toBe('')
  fillReset('mismatch'); expect(screen.getByRole('alert')).toHaveTextContent('do not match'); expect(fetcher).not.toHaveBeenCalled()
  fillReset(); await screen.findByRole('heading', { name: 'Your password is reset.' })
  expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({ token: 'a'.repeat(43), password: 'new password' })
  fireEvent.click(screen.getByRole('button', { name: /Sign in/ })); expect(screen.getByRole('dialog')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Close sign in' })); expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: /Sign in/ }))
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'person@example.com' } })
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'new password' } })
  await act(async () => fireEvent.submit(screen.getByLabelText('Password').closest('form')!))
  expect(fetcher).toHaveBeenCalledWith('/api/auth/login', expect.anything())
})
it('handles missing tokens and provides a way to request a fresh link', () => {
  render(<ResetPage />); expect(screen.getByText('This reset link is missing or invalid.')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: /request a new link/ })); expect(screen.getByRole('dialog')).toBeInTheDocument()
})
it('handles expired links, generic failures, and network errors without reporting success', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(response({ error: 'Expired link' }, 400)).mockResolvedValueOnce(response({}, 500)).mockRejectedValueOnce('offline'))
  resetForm(); fillReset(); await screen.findByText('Expired link')
  fillReset(); await screen.findByText('Unable to reset your password.')
  fillReset(); await screen.findByText('Unable to reach Still. Please try again.')
  expect(screen.queryByText('Your password is reset.')).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: /Need a new link/ })); expect(screen.getByRole('dialog')).toBeInTheDocument()
})

it.each(['json', 'failure'])('ignores stale %s completion after the journal unmounts', async stage => {
  let finish: (value?: any) => void = () => {}
  const pending = new Promise<any>((resolve, reject) => { finish = stage === 'failure' ? reject : resolve })
  vi.stubGlobal('fetch', vi.fn((url: string) => {
    if (url === '/api/auth/me') return Promise.resolve(response({ user: { timezone: 'UTC' } }))
    return stage === 'failure' ? pending : Promise.resolve({ ok: true, status: 200, json: () => pending })
  }))
  const view = render(<Journal />)
  await act(async () => {})
  view.unmount()
  await act(async () => finish(stage === 'failure' ? new Error('late failure') : { sessions: [] }))
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
})
