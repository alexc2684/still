import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import { POST as forgot } from '@/app/api/auth/forgot-password/route'
import { POST as reset } from '@/app/api/auth/reset-password/route'
import { GET as sessions } from '@/app/api/sessions/route'
import { GET as feed } from '@/app/api/feed/route'

const h = vi.hoisted(() => ({ db: vi.fn(), user: vi.fn(), origin: vi.fn(), rate: vi.fn(), requestReset: vi.fn(), reset: vi.fn(), removeCookie: vi.fn() }))
vi.mock('@/lib/db', () => ({ sql: () => h.db }))
vi.mock('@/lib/http', () => ({ requireUser: h.user, originGuard: h.origin, json: (body: unknown, status = 200) => Response.json(body, { status }) }))
vi.mock('@/lib/rate-limit', () => ({ authRateLimit: h.rate }))
vi.mock('@/lib/password-reset', () => ({ requestPasswordReset: h.requestReset, resetPassword: h.reset }))
vi.mock('next/headers', () => ({ cookies: async () => ({ delete: h.removeCookie }) }))
const req = (body: unknown, ip?: string) => new Request('https://still.test/api', { method: 'POST', headers: ip ? { 'x-forwarded-for': ip } : {}, body: JSON.stringify(body) })
const valid = { token: 'a'.repeat(43), password: 'new password' }
beforeEach(() => { vi.resetAllMocks(); h.origin.mockResolvedValue(undefined); h.rate.mockResolvedValue(true); h.requestReset.mockResolvedValue(undefined); h.reset.mockResolvedValue(true); h.user.mockResolvedValue({ id: 'viewer', timezone: 'America/New_York' }); h.db.mockResolvedValue([]) })
afterEach(() => vi.unstubAllEnvs())

it('normalizes the email and returns a generic response without disclosing account existence', async () => {
  const response = await forgot(req({ email: ' PERSON@Example.com ' }, ' 192.0.2.1, proxy'))
  expect(response.status).toBe(200)
  expect(h.requestReset).toHaveBeenCalledWith('person@example.com')
  expect(h.rate).toHaveBeenCalledWith('forgot-password:192.0.2.1', 5)
  expect(await response.json()).toEqual({ message: expect.stringContaining('If an account exists') })
})
it('rejects invalid inputs, malformed JSON, forbidden origins, and service failures', async () => {
  for (const handler of [forgot, reset]) {
    expect((await handler(req({}))).status).toBe(400)
    expect((await handler(new Request('https://still.test', { method: 'POST', body: '{' }))).status).toBe(400)
    h.origin.mockRejectedValueOnce(new Response('Forbidden', { status: 403 }))
    expect((await handler(req({}))).status).toBe(403)
  }
  h.requestReset.mockRejectedValueOnce(new Error('private configuration'))
  const failed = await forgot(req({ email: 'person@example.com' }))
  expect(failed.status).toBe(503); expect(await failed.text()).not.toContain('private configuration')
  h.reset.mockRejectedValueOnce(new Error('database secret'))
  const failedReset = await reset(req(valid)); expect(failedReset.status).toBe(500); expect(await failedReset.text()).not.toContain('database secret')
})
it('limits both IP and email requests and prevents reset processing after throttling', async () => {
  h.rate.mockResolvedValueOnce(false)
  expect((await forgot(req({ email: 'person@example.com' }, ''))).status).toBe(429)
  h.rate.mockResolvedValueOnce(true).mockResolvedValueOnce(false)
  expect((await forgot(req({ email: 'person@example.com' }))).status).toBe(429)
  expect(h.requestReset).not.toHaveBeenCalled()
  h.rate.mockResolvedValueOnce(false)
  expect((await reset(req(valid, '192.0.2.1'))).status).toBe(429)
  expect(h.reset).not.toHaveBeenCalled()
})
it('rejects invalid, expired, or consumed tokens without clearing the current session', async () => {
  expect((await reset(req({ ...valid, token: 'short' }))).status).toBe(400)
  expect((await reset(req({ ...valid, password: 'short' }))).status).toBe(400)
  h.reset.mockResolvedValue(false)
  const response = await reset(req(valid))
  expect(response.status).toBe(400); expect(await response.text()).toContain('expired or already been used')
  expect(h.removeCookie).not.toHaveBeenCalled()
})
it('clears the default or configured session cookie after a successful password reset', async () => {
  vi.stubEnv('SESSION_COOKIE_NAME', '')
  expect((await reset(req(valid))).status).toBe(200)
  expect(h.removeCookie).toHaveBeenCalledWith('still_session')
  vi.stubEnv('SESSION_COOKIE_NAME', 'custom_session')
  expect((await reset(req(valid, ' '))).status).toBe(200)
  expect(h.removeCookie).toHaveBeenCalledWith('custom_session')
  expect(h.reset).toHaveBeenCalledWith(valid.token, valid.password)
})
it('loads all reflections for a valid selected day, scoped to the authenticated user', async () => {
  const manySessions = Array.from({ length: 205 }, (_, id) => ({ id, afterNote: 'Private reflection' }))
  h.db.mockResolvedValueOnce(manySessions).mockResolvedValueOnce([{ date: '2026-09-20' }]).mockResolvedValueOnce([{ totalSessions: 205, totalMinutes: 205 }])
  const response = await sessions(new Request('https://still.test/api/sessions?date=2026-09-20'))
  expect(response.status).toBe(200)
  const body = await response.json(); expect(body.sessions).toHaveLength(205); expect(body.date).toBe('2026-09-20')
  const [query, params] = h.db.mock.calls[0]
  expect(query).toContain('m.user_id=$1'); expect(query).not.toContain('LIMIT 200')
  expect(params).toEqual(['viewer', '2026-09-20', 'America/New_York'])
  expect(body.practiceDates).toEqual(['2026-09-20'])
})
it('uses the account timezone for today and rejects invalid calendar dates before querying', async () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-01T01:00:00Z'))
  try {
    expect((await (await sessions(new Request('https://still.test/api/sessions?date=today'))).json()).date).toBe('2026-09-30')
    h.db.mockClear()
    expect((await sessions(new Request('https://still.test/api/sessions?date=2026-02-30'))).status).toBe(400)
    expect(h.db).not.toHaveBeenCalled()
  } finally { vi.useRealTimers() }
})
it('returns the registered user count even with an empty feed, without exposing user records', async () => {
  h.db.mockResolvedValueOnce([]).mockResolvedValueOnce([{ memberCount: 72 }])
  const response = await feed()
  expect(await response.json()).toEqual({ feed: [], memberCount: 72 })
  expect(h.db.mock.calls[1][0]).toBe('SELECT COUNT(*)::int AS "memberCount" FROM users')
})
