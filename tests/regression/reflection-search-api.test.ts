import { beforeEach, expect, it, vi } from 'vitest'
const h = vi.hoisted(() => ({ db: vi.fn(), user: vi.fn(), origin: vi.fn() }))
vi.mock('@/lib/db', () => ({ sql: () => h.db }))
vi.mock('@/lib/http', async importOriginal => ({ ...await importOriginal<typeof import('@/lib/http')>(), requireUser: h.user, originGuard: h.origin }))
import { POST } from '@/app/api/journal/search/route'
const request = (body: unknown) => new Request('https://still.test/api/journal/search', { method: 'POST', body: JSON.stringify(body) })
beforeEach(() => { vi.resetAllMocks(); h.user.mockResolvedValue({ id: 'owner', timezone: 'America/New_York' }); h.db.mockResolvedValue([]) })
it('searches all completed history with owner scoping, literal matching, parameters, and no caching', async () => {
  const needle = "100%_ ' OR 1=1 --"
  h.db.mockResolvedValue([{ id: 'private', afterNote: 'note' }])
  const response = await POST(request({ query: ` ${needle} `, userId: 'someone-else' }))
  expect(response.status).toBe(200)
  expect(response.headers.get('cache-control')).toBe('no-store')
  expect(await response.json()).toEqual({ results: [{ id: 'private', afterNote: 'note' }], hasMore: false })
  const [query, parameters] = h.db.mock.calls[0]
  expect(parameters).toEqual(['owner', needle, 'America/New_York'])
  expect(query).toContain('m.user_id=$1 AND m.completed_at IS NOT NULL')
  expect(query).toContain('strpos(lower(')
  expect(query).toContain('lower($2)')
  expect(query).not.toContain(needle)
  expect(query).toContain('r.before_note, r.during_note, r.after_note')
})
it('caps results while signaling more matches and handles no matches', async () => {
  h.db.mockResolvedValueOnce(Array.from({ length: 51 }, (_, id) => ({ id })))
  const body = await (await POST(request({ query: 'calm' }))).json()
  expect(body.results).toHaveLength(50); expect(body.hasMore).toBe(true)
  expect(await (await POST(request({ query: 'nothing' }))).json()).toEqual({ results: [], hasMore: false })
})
it.each([{}, { query: '' }, { query: '  ' }, { query: 'a'.repeat(201) }, { query: 1 }])('rejects invalid input %j', async body => {
  expect((await POST(request(body))).status).toBe(400); expect(h.db).not.toHaveBeenCalled()
})
it('rejects malformed JSON', async () => {
  expect((await POST(new Request('https://still.test', { method: 'POST', body: '{' }))).status).toBe(400)
})
it('blocks unauthenticated and cross-origin requests without searching', async () => {
  h.user.mockRejectedValueOnce(new Response('Unauthorized', { status: 401 }))
  expect((await POST(request({ query: 'secret' }))).status).toBe(401)
  h.origin.mockRejectedValueOnce(new Response('Bad origin', { status: 403 }))
  expect((await POST(request({ query: 'secret' }))).status).toBe(403)
  expect(h.db).not.toHaveBeenCalled()
})
it('does not expose database errors or search text', async () => {
  h.db.mockRejectedValue(new Error('secret database information'))
  const response = await POST(request({ query: 'private' }))
  expect(response.status).toBe(500)
  expect(await response.json()).toEqual({ error: 'Unable to search your reflections. Please try again.' })
})
