import { beforeEach, describe, expect, it, vi } from 'vitest'

const sql = vi.hoisted(() => vi.fn())
const db = vi.hoisted(() => vi.fn())
const auth = vi.hoisted(() => vi.fn())
const origin = vi.hoisted(() => vi.fn())
const cookies = vi.hoisted(() => vi.fn())
const reminders = vi.hoisted(() => vi.fn())
const vapid = vi.hoisted(() => vi.fn(() => 'key'))
const dispatch = vi.hoisted(() => vi.fn(async () => ({ due: 0, sent: 0, failed: 0, removed: 0, skipped: 0 })))

vi.mock('@/lib/db', () => ({ sql }))
vi.mock('@/lib/http', () => ({ requireUser: auth, originGuard: origin, json: (data: unknown, status = 200) => Response.json(data, { status }) }))
vi.mock('next/headers', () => ({ cookies }))
vi.mock('@/lib/reminders', () => ({ reminderSettings: reminders, publicVapidKey: vapid, validatePushSubscription: () => ({ endpoint: 'https://fcm.googleapis.com/x', p256dh: 'p', auth: 'a' }), DEFAULT_REMINDER_HOUR: 19 }))
vi.mock('@/lib/reminder-dispatch', () => ({ dispatchReminders: dispatch }))
vi.mock('@/lib/security', () => ({ tokenHash: () => 'hash' }))

const user = { id: 'u1', email: 'a@example.com', name: 'A', timezone: 'UTC', weekly_target: 3, weekly_minutes_target: null, avatarKey: null }
const request = (body?: unknown) => new Request('https://still.test/api', { method: 'POST', headers: body === undefined ? {} : { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
const params = (p: Record<string, string>) => ({ params: Promise.resolve(p) as any })
const status = async (p: Promise<Response>) => (await p).status

beforeEach(() => {
  vi.clearAllMocks(); auth.mockResolvedValue(user); origin.mockResolvedValue(undefined); sql.mockReturnValue(db); db.mockResolvedValue([])
  cookies.mockResolvedValue({ get: vi.fn(() => ({ value: 'session' })), set: vi.fn(), delete: vi.fn() }); reminders.mockResolvedValue({ enabled: false, hour: 19, days: [0], timezone: 'UTC', vapidPublicKey: 'key' })
  delete process.env.CRON_SECRET
})

describe('API regression boundaries', () => {
  it('rejects malformed origins before mutating methods query SQL', async () => {
    origin.mockRejectedValue(new Response('Bad origin', { status: 403 }))
    const { POST } = await import('@/app/api/shared-sits/route')
    expect(await status(POST(request({ plannedSeconds: 60 })))).toBe(403)
    expect(db).not.toHaveBeenCalled()
  })

  it('returns unauthorized without leaking private room members', async () => {
    auth.mockRejectedValue(new Response('Unauthorized', { status: 401 }))
    const room = await import('@/app/api/shared-sits/[token]/route')
    expect(await status(room.GET(new Request('https://still.test'), params({ token: 'x' })))).toBe(401)
    expect(db).not.toHaveBeenCalled()
  })

  it('preserves null and omitted goal fields in profile updates', async () => {
    db.mockResolvedValue([{ id: 'u1', weeklyMinutesTarget: null, avatarKey: null }])
    const { PATCH } = await import('@/app/api/profile/route')
    expect(await status(PATCH(request({ name: 'A', weeklyMinutesTarget: null, avatarKey: null })))).toBe(200)
    const args = db.mock.calls[0][1] as unknown[]
    expect(args[3]).toBe(true); expect(args[4]).toBeNull(); expect(args[5]).toBe(true); expect(args[6]).toBeNull()
  })

  it('does not mutate when a host attempts to leave a shared sit', async () => {
    db.mockResolvedValue([])
    const { POST } = await import('@/app/api/shared-sits/[token]/leave/route')
    expect(await status(POST(request(), params({ token: 'x' })))).toBe(403)
  })

  it('handles reminder bearer auth, dry runs, and dispatch failures', async () => {
    process.env.CRON_SECRET = 'secret'
    const route = await import('@/app/api/reminders/dispatch/route')
    expect(await status(route.POST(request()))).toBe(401)
    const good = new Request('https://still.test/api?dryRun=1', { method: 'POST', headers: { authorization: 'Bearer secret' } })
    expect(await status(route.POST(good))).toBe(200)
    dispatch.mockRejectedValueOnce(new Error('db down'))
    const body = await route.POST(new Request('https://still.test/api', { method: 'POST', headers: { authorization: 'Bearer secret' } }))
    expect(body.status).toBe(500)
  })

  it('returns database failures as stable API errors', async () => {
    db.mockRejectedValue(new Error('database unavailable'))
    const { GET } = await import('@/app/api/sessions/route')
    expect(await status(GET())).toBe(500)
    const feed = await import('@/app/api/feed/route')
    expect(await status(feed.GET())).toBe(500)
  })
})
