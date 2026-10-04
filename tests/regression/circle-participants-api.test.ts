import { beforeEach, expect, it, vi } from 'vitest'
import { GET } from '@/app/api/circle/members/route'
import { POST } from '@/app/api/shared-sits/[token]/participants/route'
const h = vi.hoisted(() => ({ db: vi.fn(), user: vi.fn(), origin: vi.fn() }))
vi.mock('@/lib/db', () => ({ sql: () => h.db }))
vi.mock('@/lib/http', () => ({ requireUser: h.user, originGuard: h.origin, json: (body: unknown, status = 200) => Response.json(body, { status }) }))
const userId = '11111111-1111-4111-8111-111111111111'
const context = { params: Promise.resolve({ token: 'sit-key' }) }
const request = (body: unknown = { userId }) => new Request('https://still.test/api/shared-sits/sit-key/participants', { method: 'POST', body: JSON.stringify(body) })
beforeEach(() => { vi.resetAllMocks(); h.user.mockResolvedValue({ id: 'host' }); h.origin.mockResolvedValue(undefined) })
it('lists only public member fields after authentication', async () => {
  h.db.mockResolvedValue([{ userId, name: 'Friend', avatarKey: null }])
  expect(await (await GET()).json()).toEqual({ members: [{ userId, name: 'Friend', avatarKey: null }] })
  const query = h.db.mock.calls[0][0]; expect(query).toContain('id AS "userId",name,avatar_key'); expect(query).not.toMatch(/email|password|reflections/)
})
it('rejects signed-out membership browsing and handles database failure', async () => {
  h.user.mockRejectedValueOnce(new Response('Unauthorized', { status: 401 }))
  expect((await GET()).status).toBe(401); expect(h.db).not.toHaveBeenCalled()
  h.db.mockRejectedValue(new Error('secret'))
  const result = await GET(); expect(result.status).toBe(500); expect(await result.text()).not.toContain('secret')
})
it('allows the host to add a member and records the original sit time in the member timezone', async () => {
  h.db.mockResolvedValueOnce([{ id: 'room', hostUserId: 'host', status: 'completed' }]).mockResolvedValueOnce([{ userId }])
  const result = await POST(request(), context)
  expect(result.status).toBe(201); expect(await result.json()).toEqual({ member: { userId } })
  const [query, params] = h.db.mock.calls[1]
  expect(params).toEqual(['room', 'host', userId])
  expect(query).toContain("host_user_id=$2 AND status='completed'")
  expect(query).toContain('(s.ends_at AT TIME ZONE u.timezone)::date')
  expect(query).toContain('ON CONFLICT DO NOTHING')
  expect(query).not.toContain('INSERT INTO reflections')
})
it.each([
  [[], 404], [[{ id: 'r', hostUserId: 'another', status: 'completed' }], 403],
  [[{ id: 'r', hostUserId: 'host', status: 'running' }], 409],
  [[{ id: 'r', hostUserId: 'host', status: 'cancelled' }], 409],
])('denies unavailable or unauthorized sit mutations', async (rows, status) => {
  h.db.mockResolvedValueOnce(rows)
  expect((await POST(request(), context)).status).toBe(status)
  expect(h.db).toHaveBeenCalledTimes(1)
})
it('rejects duplicates, capacity limits, unknown members, and concurrent state changes', async () => {
  h.db.mockResolvedValueOnce([{ id: 'r', hostUserId: 'host', status: 'completed' }]).mockResolvedValueOnce([])
  expect((await POST(request(), context)).status).toBe(409)
})
it('guards the origin, authentication, body, and errors before modifying history', async () => {
  h.origin.mockRejectedValueOnce(new Response('Forbidden', { status: 403 }))
  expect((await POST(request(), context)).status).toBe(403)
  h.user.mockRejectedValueOnce(new Response('Unauthorized', { status: 401 }))
  expect((await POST(request(), context)).status).toBe(401)
  expect((await POST(request({ userId: 'invalid' }), context)).status).toBe(400)
  expect((await POST(new Request('https://still.test', { method: 'POST', body: '{' }), context)).status).toBe(400)
  expect(h.db).not.toHaveBeenCalled()
  h.db.mockRejectedValueOnce(new Error('private database error'))
  const result = await POST(request(), context); expect(result.status).toBe(400); expect(await result.text()).not.toContain('private database error')
})
