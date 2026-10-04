import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { requestPasswordReset, resetEmailConfig, resetPassword } from './password-reset'
import { tokenHash, verifyPassword } from './security'

const db = vi.hoisted(() => vi.fn())
vi.mock('./db', () => ({ sql: () => db }))

beforeEach(() => {
  db.mockReset()
  vi.stubEnv('APP_URL', 'https://still.example')
  vi.stubEnv('RESEND_API_KEY', 'test-key')
  vi.stubEnv('AUTH_EMAIL_FROM', 'Still <hello@still.example>')
})
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

describe('password reset email', () => {
  it('stores only a token digest and emails a link on the configured origin', async () => {
    db.mockResolvedValueOnce([{ id: 'user', password_hash: 'old-hash' }]).mockResolvedValue([])
    const send = vi.fn().mockResolvedValue(new Response('{}'))
    vi.stubGlobal('fetch', send)
    await requestPasswordReset('person@example.com')
    const email = JSON.parse(send.mock.calls[0][1].body)
    const link = new URL(email.text.match(/https:\/\/\S+/)[0])
    expect(link.origin).toBe('https://still.example')
    expect(link.pathname).toBe('/reset-password')
    expect(link.search).toBe('')
    const raw = new URLSearchParams(link.hash.slice(1)).get('token')!
    expect(raw).toHaveLength(43)
    expect(db.mock.calls[1][1]).toEqual(['user', tokenHash(raw), 'old-hash'])
    expect(JSON.stringify(db.mock.calls)).not.toContain(raw)
    expect(email.to).toEqual(['person@example.com'])
  })
  it('does not send email for an unknown address', async () => {
    db.mockResolvedValue([])
    const send = vi.fn()
    vi.stubGlobal('fetch', send)
    await expect(requestPasswordReset('unknown@example.com')).resolves.toBeUndefined()
    expect(send).not.toHaveBeenCalled()
  })
  it('revokes an undelivered token without exposing account existence', async () => {
    db.mockResolvedValueOnce([{ id: 'user', password_hash: 'old-hash' }]).mockResolvedValue([])
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 503 })))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    await expect(requestPasswordReset('person@example.com')).resolves.toBeUndefined()
    expect(db.mock.calls[2][0]).toContain('DELETE FROM password_reset_tokens')
    expect(db.mock.calls[2][1][0]).toBe(db.mock.calls[1][1][1])
  })
  it('requires email configuration even for an unknown account', async () => {
    vi.stubEnv('RESEND_API_KEY', '')
    await expect(requestPasswordReset('unknown@example.com')).rejects.toThrow('not configured')
    expect(db).not.toHaveBeenCalled()
  })
  it('rejects an insecure production origin', () => {
    vi.stubEnv('APP_URL', 'http://still.example')
    expect(resetEmailConfig).toThrow('HTTPS')
  })
})

describe('password replacement', () => {
  it('hashes both credentials before submitting the atomic reset', async () => {
    db.mockResolvedValue([{ id: 'user' }])
    await expect(resetPassword('opaque-token', 'a new password')).resolves.toBe(true)
    const [, params] = db.mock.calls[0]
    expect(params[0]).toBe(tokenHash('opaque-token'))
    expect(params[1]).not.toContain('a new password')
    await expect(verifyPassword('a new password', params[1])).resolves.toBe(true)
  })
  it('reports a rejected token without claiming success', async () => {
    db.mockResolvedValue([])
    await expect(resetPassword('expired-or-used', 'a new password')).resolves.toBe(false)
  })
})
