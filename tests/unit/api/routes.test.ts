import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  sql: vi.fn(), db: vi.fn(), user: vi.fn(), origin: vi.fn(), cookies: vi.fn(), headers: vi.fn(),
  rate: vi.fn(), hash: vi.fn(), verify: vi.fn(), token: vi.fn(), tokenHash: vi.fn(),
  reminderSettings: vi.fn(), publicVapidKey: vi.fn(), validatePushSubscription: vi.fn(),
  dispatch: vi.fn(), roomSnapshot: vi.fn(), inviteToken: vi.fn(), achievements: vi.fn(),
  stats: { addDays: vi.fn(), bestStreak: vi.fn(), mondayStart: vi.fn(), streak: vi.fn() },
  validAvatarKey: vi.fn(),
}))

vi.mock('@/lib/db', () => ({ sql: h.sql }))
vi.mock('@/lib/http', () => ({
  requireUser: h.user, originGuard: h.origin, json: (data: unknown, status = 200) => Response.json(data, { status }),
}))
vi.mock('next/headers', () => ({ cookies: h.cookies, headers: h.headers }))
vi.mock('@/lib/rate-limit', () => ({ authRateLimit: h.rate }))
vi.mock('@/lib/security', () => ({ hashPassword: h.hash, verifyPassword: h.verify, token: h.token, tokenHash: h.tokenHash }))
vi.mock('@/lib/reminders', () => ({ reminderSettings: h.reminderSettings, publicVapidKey: h.publicVapidKey, validatePushSubscription: h.validatePushSubscription, DEFAULT_REMINDER_HOUR: 19 }))
vi.mock('@/lib/reminder-dispatch', () => ({ dispatchReminders: h.dispatch }))
vi.mock('@/lib/shared-room', () => ({ roomSnapshot: h.roomSnapshot }))
vi.mock('@/lib/shared-sits', () => ({ inviteToken: h.inviteToken }))
vi.mock('@/lib/achievements', () => ({ achievementsFor: h.achievements }))
vi.mock('@/lib/practice-stats', () => h.stats)
vi.mock('@/lib/avatar', () => ({ validAvatarKey: h.validAvatarKey }))

const user = { id: 'u1', email: 'a@example.com', name: 'Alex', timezone: 'UTC', weekly_target: 3, weekly_minutes_target: null, avatarKey: null }
const req = (method = 'POST', body?: unknown, url = 'https://still.test/api') => new Request(url, {
  method, headers: body === undefined ? {} : { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body),
})
const ctx = (p: Record<string, string>) => ({ params: Promise.resolve(p) as any })
const response = async (p: Promise<Response>) => ({ status: (await p).status, body: await (await p).json().catch(() => null) })
const queue = (...rows: any[][]) => { let i = 0; h.db.mockImplementation(async (query: string) => query.includes('COUNT(*)::int AS "memberCount" FROM users') ? [{ memberCount: 42 }] : rows[i++] ?? []); h.sql.mockReturnValue(h.db) }

beforeEach(() => {
  vi.clearAllMocks(); h.user.mockResolvedValue(user); h.origin.mockResolvedValue(undefined); h.rate.mockResolvedValue(true)
  h.hash.mockResolvedValue('hashed'); h.verify.mockResolvedValue(true); h.token.mockReturnValue('token'); h.tokenHash.mockReturnValue('hash')
  h.cookies.mockResolvedValue({ set: vi.fn(), get: vi.fn(() => ({ value: 'cookie' })), delete: vi.fn() }); h.headers.mockResolvedValue(new Headers())
  h.publicVapidKey.mockReturnValue('vapid'); h.reminderSettings.mockResolvedValue({ enabled: false, hour: 19, days: [0, 1], timezone: 'UTC', vapidPublicKey: 'vapid' })
  h.validatePushSubscription.mockReturnValue({ endpoint: 'https://fcm.googleapis.com/x', p256dh: 'p', auth: 'a' }); h.dispatch.mockResolvedValue({ due: 0, sent: 0, failed: 0, removed: 0, skipped: 0 })
  h.roomSnapshot.mockResolvedValue({ id: 'r1' }); h.inviteToken.mockReturnValue('invite'); h.achievements.mockReturnValue([])
  h.validAvatarKey.mockReturnValue(true); h.stats.addDays.mockImplementation((d: string, n: number) => { const x = new Date(`${d}T00:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10) }); h.stats.mondayStart.mockReturnValue('2026-09-21'); h.stats.streak.mockReturnValue(1); h.stats.bestStreak.mockReturnValue(2)
  queue([])
})

describe('auth routes', () => {
  it('signs up, rejects malformed and duplicate accounts', async () => {
    const { POST } = await import('@/app/api/auth/signup/route')
    queue([{ id: 'new' }], [])
    expect((await response(POST(req('POST', { email: 'A@EXAMPLE.COM', password: 'password', name: 'A' })))).status).toBe(201)
    expect((await response(POST(req('POST', { email: 'bad', password: 'x', name: '' })))).status).toBe(400)
    const err: any = Object.assign(new Error('duplicate'), { code: '23505' }); h.db.mockRejectedValueOnce(err)
    expect((await response(POST(req('POST', { email: 'a@example.com', password: 'password', name: 'A' })))).status).toBe(409)
  })
  it('rate limits and validates timezone', async () => {
    const { POST } = await import('@/app/api/auth/signup/route'); h.rate.mockResolvedValueOnce(false)
    expect((await response(POST(req('POST', { email: 'a@example.com', password: 'password', name: 'A' })))).status).toBe(429)
    h.rate.mockResolvedValue(true); expect((await response(POST(req('POST', { email: 'a@example.com', password: 'password', name: 'A', timezone: 'bad/zone' })))).status).toBe(400)
    h.origin.mockRejectedValueOnce(new Response('bad origin', { status: 403 })); expect((await response(POST(req('POST', { email: 'a@example.com', password: 'password', name: 'A' })))).status).toBe(403)
  })
  it('logs in, handles invalid credentials, and logs out', async () => {
    const login = await import('@/app/api/auth/login/route'); queue([{ id: 'u', email: 'a@example.com', name: 'A', timezone: 'UTC', weekly_target: 3, avatarKey: null, password_hash: 'x' }], [])
    expect((await response(login.POST(new Request('https://still.test', { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': '1.2.3.4, 5.6.7.8' }, body: JSON.stringify({ email: 'a@example.com', password: 'pw' }) })))).status).toBe(200)
    h.verify.mockResolvedValue(false); queue([{ password_hash: 'x' }]); expect((await response(login.POST(req('POST', { email: 'a@example.com', password: 'pw' })))).status).toBe(401)
    queue([]); expect((await response(login.POST(req('POST', { email: 'a@example.com', password: 'pw' })))).status).toBe(401)
    h.verify.mockRejectedValueOnce(new Error('crypto')); queue([{ password_hash: 'x' }]); expect((await response(login.POST(req('POST', { email: 'a@example.com', password: 'pw' })))).status).toBe(400)
    expect((await response(login.POST(new Request('https://still.test', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{' })))).status).toBe(400)
    const logout = await import('@/app/api/auth/logout/route'); queue([]); expect((await response(logout.POST())).status).toBe(200); h.cookies.mockResolvedValueOnce({ get: vi.fn(() => undefined), delete: vi.fn() }); queue([]); expect((await response(logout.POST())).status).toBe(200)
    h.origin.mockRejectedValueOnce(new Response('bad origin', { status: 403 })); expect((await response(login.POST(req('POST', { email: 'a@example.com', password: 'pw' })))).status).toBe(403)
  })
  it('returns current user and unauthorized errors', async () => {
    const { GET } = await import('@/app/api/auth/me/route'); expect((await response(GET())).status).toBe(200); h.user.mockResolvedValueOnce({ ...user, weekly_minutes_target: 10 }); expect((await response(GET())).status).toBe(200); h.user.mockRejectedValueOnce(new Response('no', { status: 401 })); expect((await response(GET())).status).toBe(401)
  })
})

describe('session routes', () => {
  it('starts and lists sessions', async () => {
    const start = await import('@/app/api/sessions/start/route'); queue([{ id: 's1', started_at: 'now', planned_seconds: 60, name: null }]); expect((await response(start.POST(req('POST', { plannedSeconds: 60 })))).status).toBe(201)
    const list = await import('@/app/api/sessions/route'); queue([{ id: 's1' }], [{ date: '2026-09-27' }]); expect((await response(list.GET(req('GET')))).status).toBe(200); queue([]); expect((await response(list.GET(req('GET')))).status).toBe(200)
  })
  it('validates start input and deletes only owned non-shared sessions', async () => {
    const start = await import('@/app/api/sessions/start/route'); expect((await response(start.POST(req('POST', { plannedSeconds: 0 })))).status).toBe(400)
    const del = await import('@/app/api/sessions/[id]/route'); queue([{ shared_sit_id: null }], [{ id: 's1' }]); expect((await response(del.DELETE(req(), ctx({ id: 's1' })))).status).toBe(200)
    queue([]); expect((await response(del.DELETE(req(), ctx({ id: 'missing' })))).status).toBe(404)
    queue([{ shared_sit_id: 'r1' }]); expect((await response(del.DELETE(req(), ctx({ id: 'shared' })))).status).toBe(409)
  })
  it('completes, idempotently retries, and rejects premature sessions', async () => {
    const { POST } = await import('@/app/api/sessions/[id]/complete/route'); const old = Date.now; Date.now = () => new Date('2026-09-27T00:10:00Z').getTime()
    queue([{ id: 's1', planned_seconds: 60, started_at: '2026-09-27T00:00:00Z', completed_at: null, shared_sit_id: null }], [{ id: 's1', completed_date_text: '2026-09-27' }]); expect((await response(POST(req('POST', { elapsedSeconds: 60 }), ctx({ id: 's1' })))).status).toBe(200)
    queue([{ id: 's1', planned_seconds: 60, started_at: '2026-09-27T00:00:00Z', completed_at: 'done', shared_sit_id: null }]); expect((await response(POST(req('POST', { elapsedSeconds: 60 }), ctx({ id: 's1' })))).status).toBe(200)
    queue([{ id: 's1', planned_seconds: 60, started_at: '2026-09-27T00:00:00Z', completed_at: null, shared_sit_id: null }]); Date.now = () => new Date('2026-09-27T00:00:20Z').getTime(); expect((await response(POST(req('POST', { elapsedSeconds: 20 }), ctx({ id: 's1' })))).status).toBe(422); Date.now = old
    queue([]); expect((await response(POST(req('POST', { elapsedSeconds: 60 }), ctx({ id: 'missing' })))).status).toBe(404)
    queue([{ id: 's1', planned_seconds: 60, started_at: '2026-09-27T00:00:00Z', completed_at: null, shared_sit_id: 'r1' }]); expect((await response(POST(req('POST', { elapsedSeconds: 60 }), ctx({ id: 'shared' })))).status).toBe(409)
    queue([{ id: 's1', planned_seconds: 60, started_at: '2026-09-27T00:00:00Z', completed_at: null, shared_sit_id: null }], []); expect((await response(POST(req('POST', { elapsedSeconds: 60 }), ctx({ id: 'race' })))).status).toBe(200)
  })
  it('handles comments, reflection, and kudos', async () => {
    const comments = await import('@/app/api/sessions/[id]/comments/route'); queue([{ id: 'c1', body: 'ok' }]); expect((await response(comments.GET(req('GET'), ctx({ id: 's1' })))).status).toBe(200); queue([{ id: 'c1', body: 'ok' }]); expect((await response(comments.POST(req('POST', { body: 'hello' }), ctx({ id: 's1' })))).status).toBe(201); queue([]); expect((await response(comments.POST(req('POST', { body: '' }), ctx({ id: 's1' })))).status).toBe(400)
    const reflection = await import('@/app/api/sessions/[id]/reflection/route'); queue([{ id: 'r1' }]); expect((await response(reflection.PATCH(req('PATCH', { beforeMood: null }), ctx({ id: 's1' })))).status).toBe(200); queue([]); expect((await response(reflection.PATCH(req('PATCH', {}), ctx({ id: 'missing' })))).status).toBe(404)
    const kudos = await import('@/app/api/sessions/[id]/kudos/route'); queue([{ id: 's1' }], []); expect((await response(kudos.POST(req(), ctx({ id: 's1' })))).status).toBe(200); queue([{ id: 's1' }], [{ 1: 1 }]); expect((await response(kudos.POST(req(), ctx({ id: 's1' })))).status).toBe(200); queue([]); expect((await response(kudos.POST(req(), ctx({ id: 'missing' })))).status).toBe(404)
    const remove = await import('@/app/api/comments/[id]/route'); queue([{ id: 'c1' }]); expect((await response(remove.DELETE(req('DELETE'), ctx({ id: 'c1' })))).status).toBe(200); queue([]); expect((await response(remove.DELETE(req('DELETE'), ctx({ id: 'missing' })))).status).toBe(404)
  })
})

describe('profile, feed, and stats routes', () => {
  it('updates profile with null preservation and validates fields', async () => {
    const { PATCH } = await import('@/app/api/profile/route'); queue([{ id: 'u1' }]); expect((await response(PATCH(req('PATCH', { name: ' New ', weeklyMinutesTarget: null, avatarKey: null })))).status).toBe(200); h.validAvatarKey.mockReturnValue(false); expect((await response(PATCH(req('PATCH', { avatarKey: 'bad' })))).status).toBe(400); expect((await response(PATCH(req('PATCH', { timezone: 'bad/zone' })))).status).toBe(400)
  })
  it('loads stats and feed, including empty history', async () => {
    const stats = await import('@/app/api/profile/stats/route'); queue([{ date: '2026-09-21', seconds: 120 }]); expect((await response(stats.GET())).status).toBe(200); h.user.mockResolvedValueOnce({ ...user, weekly_minutes_target: 5 }); queue([]); expect((await response(stats.GET())).status).toBe(200)
    const feed = await import('@/app/api/feed/route'); queue([{ id: 's1', userId: 'u1', participants: [], sharedSitId: null }], [{ userId: 'u1', id: 's1' }]); expect((await response(feed.GET())).status).toBe(200); queue([{ id: 's2', userId: 'u2', participants: [{ userId: 'u3', sessionId: 's3', name: 'B', avatarKey: null }], sharedSitId: 'r1' }], [{ userId: 'u2', id: 's2' }]); expect((await response(feed.GET())).status).toBe(200); queue([]); expect((await response(feed.GET())).status).toBe(200)
  })
})

describe('shared sits', () => {
  it('creates, lists, reads, joins, starts, completes, leaves, and cancels rooms', async () => {
    const collection = await import('@/app/api/shared-sits/route'); queue([{ id: 'r1', inviteToken: 'invite' }]); expect((await response(collection.POST(req('POST', { plannedSeconds: 60 })))).status).toBe(201); expect((await response(collection.GET(req('GET', undefined, 'https://still.test/api/shared-sits?active=0')))).status).toBe(200); queue([{ id: 'r1' }]); expect((await response(collection.GET(req('GET', undefined, 'https://still.test/api/shared-sits?active=1')))).status).toBe(200)
    const room = await import('@/app/api/shared-sits/[token]/route'); queue([{ id: 'r1', inviteToken: 'invite', hostUserId: 'u1', hostName: 'A', status: 'waiting', plannedSeconds: 60, startedAt: null, endsAt: null, memberUserId: 'u1', memberSessionId: null, leftAt: null, memberName: 'A', avatarKey: null }]); expect((await response(room.GET(req('GET'), ctx({ token: 'invite' })))).status).toBe(200); queue([{ id: 'r1', inviteToken: 'invite', hostUserId: 'u1', hostName: 'A', status: 'waiting', plannedSeconds: 60, startedAt: null, endsAt: null, memberUserId: 'other', memberSessionId: null, leftAt: null, memberName: 'B', avatarKey: null }]); expect((await response(room.GET(req('GET'), ctx({ token: 'invite' })))).status).toBe(200); queue([]); expect((await response(room.GET(req('GET'), ctx({ token: 'bad' })))).status).toBe(404)
    const join = await import('@/app/api/shared-sits/[token]/join/route'); queue([{ sharedSitId: 'r1', userId: 'u1' }]); expect((await response(join.POST(req(), ctx({ token: 'invite' })))).status).toBe(200); queue([]); expect((await response(join.POST(req(), ctx({ token: 'bad' })))).status).toBe(409)
    const start = await import('@/app/api/shared-sits/[token]/start/route'); queue([{ id: 'r1', status: 'waiting', hostUserId: 'u1', plannedSeconds: 60, memberCount: 1 }], [{ id: 'r1' }]); expect((await response(start.POST(req(), ctx({ token: 'invite' })))).status).toBe(200); queue([{ id: 'r1', status: 'waiting', hostUserId: 'other', plannedSeconds: 60, memberCount: 1 }]); expect((await response(start.POST(req(), ctx({ token: 'invite' })))).status).toBe(403)
    queue([]); expect((await response(start.POST(req(), ctx({ token: 'missing' })))).status).toBe(404)
    queue([{ id: 'r1', status: 'running', hostUserId: 'u1', plannedSeconds: 60, memberCount: 1 }]); expect((await response(start.POST(req(), ctx({ token: 'invite' })))).status).toBe(409)
    queue([{ id: 'r1', status: 'waiting', hostUserId: 'u1', plannedSeconds: 60, memberCount: 21 }]); expect((await response(start.POST(req(), ctx({ token: 'invite' })))).status).toBe(409)
    queue([{ id: 'r1', status: 'waiting', hostUserId: 'u1', plannedSeconds: 60, memberCount: 1 }], []); expect((await response(start.POST(req(), ctx({ token: 'invite' })))).status).toBe(409)
    const complete = await import('@/app/api/shared-sits/[token]/complete/route'); queue([{ status: 'completed', sessionId: 's1' }]); expect((await response(complete.POST(req(), ctx({ token: 'invite' })))).status).toBe(200); queue([]); expect((await response(complete.POST(req(), ctx({ token: 'bad' })))).status).toBe(403)
    queue([{ status: 'cancelled', sessionId: 's1' }]); expect((await response(complete.POST(req(), ctx({ token: 'invite' })))).status).toBe(409)
    queue([{ status: 'waiting', sessionId: 's1' }]); expect((await response(complete.POST(req(), ctx({ token: 'invite' })))).status).toBe(409)
    queue([{ status: 'running', sessionId: 's1', endsAt: new Date(Date.now() - 1000).toISOString() }], [{ sessionId: 's1' }]); expect((await response(complete.POST(req(), ctx({ token: 'invite' })))).status).toBe(200)
    queue([{ status: 'running', sessionId: 's1', endsAt: new Date(Date.now() - 1000).toISOString() }], [], [{ status: 'completed', sessionId: 's1' }]); expect((await response(complete.POST(req(), ctx({ token: 'invite' })))).status).toBe(200)
    queue([{ status: 'running', sessionId: 's1', endsAt: new Date(Date.now() - 1000).toISOString() }], [], []); expect((await response(complete.POST(req(), ctx({ token: 'invite' })))).status).toBe(409)
    queue([{ status: 'running', sessionId: 's1', endsAt: new Date(Date.now() + 60_000).toISOString() }]); expect((await response(complete.POST(req(), ctx({ token: 'invite' })))).status).toBe(422)
    const leave = await import('@/app/api/shared-sits/[token]/leave/route'); queue([{ shared_sit_id: 'r1' }]); expect((await response(leave.POST(req(), ctx({ token: 'invite' })))).status).toBe(200); queue([]); expect((await response(leave.POST(req(), ctx({ token: 'invite' })))).status).toBe(403)
    const cancel = await import('@/app/api/shared-sits/[token]/cancel/route'); queue([{ id: 'r1' }]); expect((await response(cancel.POST(req(), ctx({ token: 'invite' })))).status).toBe(200); queue([]); expect((await response(cancel.POST(req(), ctx({ token: 'bad' })))).status).toBe(409)
  })
})

describe('reminder routes', () => {
  it('serves configuration and VAPID status', async () => {
    const config = await import('@/app/api/reminders/config/route'); expect((await response(config.GET())).status).toBe(200); const key = await import('@/app/api/reminders/vapid-public-key/route'); expect((await response(key.GET())).status).toBe(200); h.publicVapidKey.mockReturnValue(null); expect((await response(key.GET())).status).toBe(503)
  })
  it('updates settings, subscriptions, and dispatch auth/dry-run', async () => {
    const settings = await import('@/app/api/reminders/route'); queue([{ timezone: 'UTC', enabled: false, hour: 19, days: [0] }], []); expect((await response(settings.PATCH(req('PATCH', { enabled: true, days: [2, 0] })))).status).toBe(200); h.reminderSettings.mockResolvedValueOnce({ enabled: true, hour: undefined, days: [1], timezone: 'UTC', vapidPublicKey: 'vapid' }); queue([]); expect((await response(settings.PATCH(req('PATCH', { enabled: false })))).status).toBe(200); expect((await response(settings.GET())).status).toBe(200); expect((await response(settings.HEAD())).status).toBe(200); expect((await response(settings.PATCH(req('PATCH', { days: [1, 1] })))).status).toBe(400); h.user.mockRejectedValueOnce(new Response('no', { status: 401 })); expect((await response(settings.GET())).status).toBe(401)
    const subs = await import('@/app/api/reminders/subscriptions/route'); queue([]); expect((await response(subs.POST(req('POST', { endpoint: 'x' })))).status).toBe(201); h.origin.mockRejectedValueOnce(new Response('bad', { status: 403 })); expect((await response(subs.POST(req('POST', { endpoint: 'x' })))).status).toBe(403); queue([]); expect((await response(subs.DELETE(req('DELETE', { endpoint: 'https://fcm.googleapis.com/x' })))).status).toBe(200); expect((await response(subs.DELETE(req('DELETE', { endpoint: 'bad' })))).status).toBe(400); h.db.mockRejectedValueOnce(new Error('db')); expect((await response(subs.DELETE(req('DELETE', { endpoint: 'https://fcm.googleapis.com/x' })))).status).toBe(500); h.origin.mockRejectedValueOnce(new Error('origin')); expect((await response(subs.DELETE(req('DELETE', { endpoint: 'https://fcm.googleapis.com/x' })))).status).toBe(500)
    process.env.CRON_SECRET = 'secret'; const dispatch = await import('@/app/api/reminders/dispatch/route'); expect((await response(dispatch.POST(req('POST', undefined, 'https://still.test/api?dryRun=1')))).status).toBe(401); expect((await response(dispatch.POST(new Request('https://still.test/api?dryRun=1', { method: 'POST', headers: { authorization: 'Bearer secret' } })))).status).toBe(200); expect((await response(dispatch.POST(new Request('https://still.test/api', { method: 'POST', headers: { authorization: 'Bearer secret', 'content-type': 'application/json' }, body: JSON.stringify({ dryRun: true }) })))).status).toBe(200); expect((await response(dispatch.POST(new Request('https://still.test/api', { method: 'POST', headers: { authorization: 'Bearer secret', 'content-type': 'application/json' }, body: '{' })))).status).toBe(200); expect((await response(dispatch.GET(new Request('https://still.test/api', { method: 'GET', headers: { authorization: 'Bearer secret' } })))).status).toBe(200); delete process.env.CRON_SECRET
  })
})

describe('route error translation', () => {
  it('keeps unexpected SQL errors behind stable responses', async () => {
    const calls: Array<Promise<Response>> = []
    h.db.mockRejectedValue(new Error('db unavailable'))
    const invoke = async (module: any, method: string, request: Request, context?: any) => {
      try { calls.push(Promise.resolve(module[method](request, context))) } catch { /* synchronous guard failures are also covered below */ }
    }
    await invoke(await import('@/app/api/auth/login/route'), 'POST', req('POST', { email: 'a@example.com', password: 'pw' }))
    await invoke(await import('@/app/api/auth/signup/route'), 'POST', req('POST', { email: 'a@example.com', password: 'password', name: 'A' }))
    await invoke(await import('@/app/api/comments/[id]/route'), 'DELETE', req(), ctx({ id: 'x' }))
    await invoke(await import('@/app/api/feed/route'), 'GET', req('GET'))
    await invoke(await import('@/app/api/profile/route'), 'PATCH', req('PATCH', { name: 'A' }))
    await invoke(await import('@/app/api/profile/stats/route'), 'GET', req('GET'))
    await invoke(await import('@/app/api/reminders/route'), 'GET', req('GET'))
    await invoke(await import('@/app/api/reminders/route'), 'PATCH', req('PATCH', { enabled: true }))
    await invoke(await import('@/app/api/reminders/subscriptions/route'), 'POST', req('POST', { endpoint: 'x' }))
    await invoke(await import('@/app/api/reminders/subscriptions/route'), 'DELETE', req('DELETE', { endpoint: 'https://fcm.googleapis.com/x' }))
    await invoke(await import('@/app/api/sessions/route'), 'GET', req('GET'))
    await invoke(await import('@/app/api/sessions/start/route'), 'POST', req('POST', { plannedSeconds: 60 }))
    await invoke(await import('@/app/api/sessions/[id]/route'), 'DELETE', req(), ctx({ id: 'x' }))
    await invoke(await import('@/app/api/sessions/[id]/comments/route'), 'GET', req('GET'), ctx({ id: 'x' }))
    await invoke(await import('@/app/api/sessions/[id]/comments/route'), 'POST', req('POST', { body: 'x' }), ctx({ id: 'x' }))
    await invoke(await import('@/app/api/sessions/[id]/complete/route'), 'POST', req('POST', { elapsedSeconds: 60 }), ctx({ id: 'x' }))
    await invoke(await import('@/app/api/sessions/[id]/kudos/route'), 'POST', req(), ctx({ id: 'x' }))
    await invoke(await import('@/app/api/sessions/[id]/reflection/route'), 'PATCH', req('PATCH', {}), ctx({ id: 'x' }))
    await invoke(await import('@/app/api/shared-sits/route'), 'POST', req('POST', { plannedSeconds: 60 }))
    await invoke(await import('@/app/api/shared-sits/route'), 'GET', req('GET', undefined, 'https://still.test/api?active=1'))
    for (const name of ['cancel', 'complete', 'join', 'leave', 'start']) {
      await invoke(await import(`@/app/api/shared-sits/[token]/${name}/route`), 'POST', req(), ctx({ token: 'x' }))
    }
    const results = await Promise.all(calls)
    expect(results.length).toBeGreaterThan(15)
    expect(results.some((r) => r.status === 500)).toBe(true)
  })
})

describe('API branch boundaries', () => {
  it('covers fallback values and response-shaped failures', async () => {
    // Login's rate-limit response and production cookie options, including the
    // configured cookie-name fallback, are both observable at the boundary.
    const login = await import('@/app/api/auth/login/route')
    vi.stubEnv('NODE_ENV', 'production')
    process.env.SESSION_COOKIE_NAME = 'custom_session'
    h.rate.mockResolvedValueOnce(false)
    expect((await response(login.POST(req('POST', { email: 'a@example.com', password: 'pw' })))).status).toBe(429)
    delete process.env.SESSION_COOKIE_NAME
    queue([{ id: 'u', email: 'a@example.com', name: 'A', timezone: 'UTC', weekly_target: 3, avatarKey: null, password_hash: 'x' }], [])
    expect((await response(login.POST(req('POST', { email: 'a@example.com', password: 'pw' })))).status).toBe(200)
    vi.stubEnv('NODE_ENV', 'test')

    const me = await import('@/app/api/auth/me/route')
    h.user.mockRejectedValueOnce(new Error('auth'))
    expect((await response(me.GET())).status).toBe(401)
    const comments = await import('@/app/api/comments/[id]/route')
    h.origin.mockRejectedValueOnce(new Response('bad', { status: 403 }))
    expect((await response(comments.DELETE(req('DELETE'), ctx({ id: 'x' })))).status).toBe(403)

    const feed = await import('@/app/api/feed/route')
    queue([{ id: 's1', userId: 'u1', sharedSitId: null }], [])
    expect((await response(feed.GET())).status).toBe(200)
    h.user.mockRejectedValueOnce(new Response('no', { status: 401 }))
    expect((await response(feed.GET())).status).toBe(401)

    const profile = await import('@/app/api/profile/route')
    queue([{ id: 'u1' }])
    expect((await response(profile.PATCH(req('PATCH', { timezone: 'UTC' })))).status).toBe(200)
    h.origin.mockRejectedValueOnce(new Response('bad', { status: 403 }))
    expect((await response(profile.PATCH(req('PATCH', { name: 'A' })))).status).toBe(403)

    const stats = await import('@/app/api/profile/stats/route')
    h.user.mockResolvedValueOnce({ ...user, weekly_minutes_target: 5 })
    queue([{ date: '2026-09-21', seconds: 0 }, { date: '2026-09-22', seconds: 0 }, { date: '2026-09-23', seconds: 0 }])
    expect((await response(stats.GET())).status).toBe(200)
    h.user.mockRejectedValueOnce(new Response('no', { status: 401 }))
    expect((await response(stats.GET())).status).toBe(401)

    const reminders = await import('@/app/api/reminders/route')
    h.reminderSettings.mockRejectedValueOnce(new Error('settings'))
    expect((await response(reminders.GET())).status).toBe(500)
    h.origin.mockRejectedValueOnce(new Response('bad', { status: 403 }))
    expect((await response(reminders.PATCH(req('PATCH', { enabled: true })))).status).toBe(403)
    h.origin.mockResolvedValue(undefined)
    h.reminderSettings.mockResolvedValueOnce({ enabled: false, hour: 19, days: [1], timezone: 'UTC', vapidPublicKey: 'vapid' })
    queue([])
    expect((await response(reminders.PATCH(req('PATCH', {})))).status).toBe(200)
    h.reminderSettings.mockResolvedValueOnce({ enabled: true, hour: null, days: [1], timezone: 'UTC', vapidPublicKey: 'vapid' })
    queue([])
    expect((await response(reminders.PATCH(req('PATCH', { enabled: false })))).status).toBe(200)
    h.publicVapidKey.mockReturnValueOnce(null)
    expect((await response(reminders.HEAD())).status).toBe(503)

    const subscriptions = await import('@/app/api/reminders/subscriptions/route')
    h.origin.mockRejectedValueOnce(new Response('bad', { status: 403 }))
    expect((await response(subscriptions.DELETE(req('DELETE', { endpoint: 'https://fcm.googleapis.com/x' })))).status).toBe(403)
    h.origin.mockResolvedValue(undefined)
    h.db.mockRejectedValueOnce(new Error('db'))
    expect((await response(subscriptions.DELETE(req('DELETE', { endpoint: 'https://fcm.googleapis.com/x' })))).status).toBe(500)

    const sessions = await import('@/app/api/sessions/route')
    h.user.mockRejectedValueOnce(new Response('no', { status: 401 }))
    expect((await response(sessions.GET(req('GET')))).status).toBe(401)
    const session = await import('@/app/api/sessions/[id]/route')
    h.origin.mockRejectedValueOnce(new Response('bad', { status: 403 }))
    expect((await response(session.DELETE(req('DELETE'), ctx({ id: 'x' })))).status).toBe(403)
    h.origin.mockResolvedValue(undefined)
    queue([{ id: 'x', shared_sit_id: null }], [])
    expect((await response(session.DELETE(req('DELETE'), ctx({ id: 'x' })))).status).toBe(404)

    const sessionComments = await import('@/app/api/sessions/[id]/comments/route')
    h.user.mockRejectedValueOnce(new Response('no', { status: 401 }))
    expect((await response(sessionComments.GET(req('GET'), ctx({ id: 'x' })))).status).toBe(401)
    h.origin.mockRejectedValueOnce(new Response('bad', { status: 403 }))
    expect((await response(sessionComments.POST(req('POST', { body: 'x' }), ctx({ id: 'x' })))).status).toBe(403)
    h.origin.mockResolvedValue(undefined)
    queue([])
    expect((await response(sessionComments.POST(req('POST', { body: 'x' }), ctx({ id: 'x' })))).status).toBe(404)

    const start = await import('@/app/api/sessions/start/route')
    h.origin.mockRejectedValueOnce(new Response('bad', { status: 403 }))
    expect((await response(start.POST(req('POST', { plannedSeconds: 60 })))).status).toBe(403)
    const complete = await import('@/app/api/sessions/[id]/complete/route')
    h.origin.mockRejectedValueOnce(new Response('bad', { status: 403 }))
    expect((await response(complete.POST(req('POST', { elapsedSeconds: 60 }), ctx({ id: 'x' })))).status).toBe(403)
    const kudos = await import('@/app/api/sessions/[id]/kudos/route')
    h.origin.mockRejectedValueOnce(new Response('bad', { status: 403 }))
    expect((await response(kudos.POST(req(), ctx({ id: 'x' })))).status).toBe(403)
    const reflection = await import('@/app/api/sessions/[id]/reflection/route')
    h.origin.mockRejectedValueOnce(new Response('bad', { status: 403 }))
    expect((await response(reflection.PATCH(req('PATCH', {}), ctx({ id: 'x' })))).status).toBe(403)

    const shared = await import('@/app/api/shared-sits/route')
    h.origin.mockRejectedValueOnce(new Response('bad', { status: 403 }))
    expect((await response(shared.POST(req('POST', { plannedSeconds: 60 })))).status).toBe(403)
    h.origin.mockResolvedValue(undefined)
    h.db.mockRejectedValueOnce(new Response('db', { status: 503 }))
    expect((await response(shared.POST(req('POST', { plannedSeconds: 60 })))).status).toBe(503)
    h.db.mockRejectedValueOnce(new Response('db', { status: 503 }))
    expect((await response(shared.GET(req('GET', undefined, 'https://still.test/api?active=1')))).status).toBe(503)
    const room = await import('@/app/api/shared-sits/[token]/route')
    h.user.mockRejectedValueOnce(new Response('no', { status: 401 }))
    expect((await response(room.GET(req('GET'), ctx({ token: 'x' })))).status).toBe(401)
    h.user.mockResolvedValueOnce(user)
    h.db.mockRejectedValueOnce(new Response('db', { status: 503 }))
    expect((await response(room.GET(req('GET'), ctx({ token: 'x' })))).status).toBe(503)
    h.db.mockRejectedValueOnce(new Error('db'))
    expect((await response(room.GET(req('GET'), ctx({ token: 'x' })))).status).toBe(500)
    for (const name of ['cancel', 'complete', 'join', 'leave', 'start']) {
      const route = await import(`@/app/api/shared-sits/[token]/${name}/route`)
      h.origin.mockRejectedValueOnce(new Response('bad', { status: 403 }))
      expect((await response(route.POST(req(), ctx({ token: 'x' })))).status).toBe(403)
    }
  })
})

it('completes early solo sits with bounded actual elapsed time and a private reason, preserving idempotency and ownership',async()=>{
  const {POST}=await import('@/app/api/sessions/[id]/complete/route')
  const startedAt=new Date(Date.now()-10000).toISOString()
  queue([{id:'early',user_id:user.id,planned_seconds:600,started_at:startedAt}], [{id:'early',elapsed_seconds:5,completed_date_text:'2026-10-04'}])
  const result=await POST(req('POST',{endedEarly:true,elapsedSeconds:5,afterNote:'Ended early: Doorbell'}),ctx({id:'early'}));expect(result.status).toBe(200);expect(h.db.mock.calls.at(-1)![1][0]).toBe(5);expect(h.db.mock.calls.at(-1)![1][8]).toBe('Ended early: Doorbell')
  queue([{id:'early',planned_seconds:600,started_at:startedAt}], [{id:'early',completed_date_text:'2026-10-04'}]);expect((await POST(req('POST',{endedEarly:true,elapsedSeconds:0}),ctx({id:'early'}))).status).toBe(200)
  queue([{id:'early',planned_seconds:600,started_at:startedAt}]);expect((await POST(req('POST',{elapsedSeconds:5}),ctx({id:'early'}))).status).toBe(422)
  queue([]);expect((await POST(req('POST',{endedEarly:true,elapsedSeconds:5}),ctx({id:'other-owner'}))).status).toBe(404)
  queue([{shared_sit_id:'group'}]);expect((await POST(req('POST',{endedEarly:true,elapsedSeconds:5}),ctx({id:'group'}))).status).toBe(409)
  h.db.mockClear();queue([{id:'early',completed_at:startedAt,elapsed_seconds:5}]);expect((await POST(req('POST',{endedEarly:true,elapsedSeconds:600}),ctx({id:'early'}))).status).toBe(200);expect(h.db).toHaveBeenCalledTimes(1)
  expect((await POST(req('POST',{endedEarly:true,elapsedSeconds:1,afterNote:'x'.repeat(6501)}),ctx({id:'early'}))).status).toBe(400)
})
