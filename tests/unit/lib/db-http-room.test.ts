import { describe, expect, it, vi } from 'vitest'

describe('database and request helpers', () => {
  it('requires database configuration and binds Neon query()', async () => {
    vi.resetModules()
    vi.doMock('@neondatabase/serverless', () => ({ neon: vi.fn(() => ({ query: vi.fn(async () => [{ ok: true }]) })) }))
    const db = await import('../../../src/lib/db')
    const previous = process.env.DATABASE_URL
    delete process.env.DATABASE_URL
    expect(() => db.sql()).toThrow('DATABASE_URL is required')
    process.env.DATABASE_URL = 'https://db.example'
    await expect(db.sql()('SELECT 1')).resolves.toEqual([{ ok: true }])
    if (previous === undefined) delete process.env.DATABASE_URL
    else process.env.DATABASE_URL = previous
  })

  it('returns null for missing rooms and hides members from non-members', async () => {
    vi.resetModules()
    const query = vi.fn()
    vi.doMock('../../../src/lib/db', () => ({ sql: () => query }))
    const { roomSnapshot } = await import('../../../src/lib/shared-room')
    query.mockResolvedValueOnce([])
    expect(await roomSnapshot('missing', 'u1')).toBeNull()
    query.mockResolvedValueOnce([
      { id: 'r', inviteToken: 't', hostUserId: 'u1', hostName: 'Host', status: 'running', plannedSeconds: 60, startedAt: null, endsAt: null, memberUserId: 'u2', memberSessionId: 's2', leftAt: null, memberName: 'Other', avatarKey: 'leaf' },
    ])
    const outsider = await roomSnapshot('t', 'outsider')
    expect(outsider?.isMember).toBe(false)
    expect(outsider?.members).toEqual([])
    expect(outsider?.participantCount).toBe(1)
  })

  it('returns only active member identities to an active member', async () => {
    vi.resetModules()
    const query = vi.fn().mockResolvedValue([
      { id: 'r', inviteToken: 't', hostUserId: 'u1', hostName: 'Host', status: 'completed', plannedSeconds: 60, startedAt: '2026-01-01', endsAt: '2026-01-01', memberUserId: 'u1', memberSessionId: 's1', leftAt: null, memberName: 'Host', avatarKey: null },
      { id: 'r', inviteToken: 't', hostUserId: 'u1', hostName: 'Host', status: 'completed', plannedSeconds: 60, startedAt: '2026-01-01', endsAt: '2026-01-01', memberUserId: 'u2', memberSessionId: 's2', leftAt: '2026-01-01', memberName: 'Left', avatarKey: 'moon' },
    ])
    vi.doMock('../../../src/lib/db', () => ({ sql: () => query }))
    const { roomSnapshot } = await import('../../../src/lib/shared-room')
    const result = await roomSnapshot('t', 'u1')
    expect(result).toMatchObject({ isHost: true, isMember: true, ownSessionId: 's1', participantCount: 1 })
    expect(result?.members).toEqual([{ userId: 'u1', name: 'Host', avatarKey: null }])
  })
})

describe('rate limiting', () => {
  it('cleans old attempts, counts recent attempts, records this attempt, and applies the boundary', async () => {
    vi.resetModules()
    const query = vi.fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ n: 2 }])
      .mockResolvedValueOnce([])
    vi.doMock('../../../src/lib/db', () => ({ sql: () => query }))
    const { authRateLimit } = await import('../../../src/lib/rate-limit')
    expect(await authRateLimit('ip', 2)).toBe(false)
    expect(query).toHaveBeenCalledTimes(3)
    expect(query.mock.calls[0][0]).toContain('DELETE FROM auth_attempts')
    expect(query.mock.calls[2][1]).toEqual(['ip'])
  })

  it('allows a key below the default limit when no count row exists', async () => {
    vi.resetModules()
    const query = vi.fn().mockResolvedValueOnce([]).mockResolvedValueOnce([]).mockResolvedValueOnce([])
    vi.doMock('../../../src/lib/db', () => ({ sql: () => query }))
    const { authRateLimit } = await import('../../../src/lib/rate-limit')
    await expect(authRateLimit('new-key')).resolves.toBe(true)
  })
})
