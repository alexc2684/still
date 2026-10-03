import { beforeEach, afterEach, expect, it, vi } from 'vitest'
const h = vi.hoisted(() => ({ db: vi.fn(), getToken: vi.fn(), verify: vi.fn() }))
vi.mock('google-auth-library', () => ({ OAuth2Client: class { getToken = h.getToken; verifyIdToken = h.verify } }))
vi.mock('./db', () => ({ sql: () => h.db }))
vi.mock('./security', () => ({ token: () => 'random-password', hashPassword: vi.fn(async () => 'hashed-random') }))
import { googleAccount, googleConfig, googleIdentity, googleReturnTo } from './google-auth'
afterEach(()=>vi.unstubAllEnvs())
const valid = { sub: 'google-user', email: 'ada@gmail.com', email_verified: true as const, nonce: 'nonce', name: 'Ada' }
beforeEach(() => {
 vi.resetAllMocks(); vi.stubEnv('GOOGLE_CLIENT_ID','client'); vi.stubEnv('GOOGLE_CLIENT_SECRET','secret'); vi.stubEnv('APP_URL','https://still.test/path')
 h.getToken.mockResolvedValue({tokens:{id_token:'signed-token'}}); h.verify.mockResolvedValue({getPayload:()=>valid})
})
it('requires complete and secure configuration', () => {
 expect(googleConfig().redirectUri).toBe('https://still.test/api/auth/google/callback')
 vi.stubEnv('GOOGLE_CLIENT_ID',''); expect(()=>googleConfig()).toThrow(); vi.stubEnv('GOOGLE_CLIENT_ID','client')
 vi.stubEnv('GOOGLE_CLIENT_SECRET',''); expect(()=>googleConfig()).toThrow(); vi.stubEnv('GOOGLE_CLIENT_SECRET','secret')
 vi.stubEnv('APP_URL',''); expect(()=>googleConfig()).toThrow()
 vi.stubEnv('APP_URL','http://external.test'); expect(()=>googleConfig()).toThrow()
 vi.stubEnv('APP_URL','http://localhost:3217'); expect(googleConfig().origin).toBe('http://localhost:3217')
})
it.each([null,'https://evil.test','//evil.test','/\\evil.test','/elsewhere','/?sit=bad!','/'])('rejects unsafe return paths %s', value => expect(googleReturnTo(value)).toBe('/'))
it('retains only a valid shared invitation', () => expect(googleReturnTo('/?sit=abc_123&other=secret')).toBe('/?sit=abc_123'))
it('verifies Google token, audience, nonce, and PKCE', async () => {
 expect(await googleIdentity('code','nonce','verifier')).toEqual(valid)
 expect(h.getToken).toHaveBeenCalledWith({code:'code',codeVerifier:'verifier'})
 expect(h.verify).toHaveBeenCalledWith({idToken:'signed-token',audience:'client'})
})
it('rejects missing, unverified, invalid and replayed identities', async () => {
 h.getToken.mockResolvedValueOnce({tokens:{}}); await expect(googleIdentity('code','nonce','v')).rejects.toThrow()
 h.verify.mockResolvedValueOnce({getPayload:()=>({...valid,email_verified:false})}); await expect(googleIdentity('code','nonce','v')).rejects.toThrow()
 h.verify.mockResolvedValueOnce({getPayload:()=>({...valid,nonce:'different'})}); await expect(googleIdentity('code','nonce','v')).rejects.toThrow()
 h.verify.mockRejectedValueOnce(new Error('bad signature')); await expect(googleIdentity('code','nonce','v')).rejects.toThrow()
})
it('uses immutable Google subject for an existing account', async () => {
 h.db.mockResolvedValueOnce([{id:'existing'}]); expect(await googleAccount(valid,'UTC')).toBe('existing'); expect(h.db).toHaveBeenCalledTimes(1)
})
it('creates or links Gmail accounts without overwriting existing practice/profile data', async () => {
 h.db.mockResolvedValueOnce([]).mockResolvedValueOnce([{id:'new'}]); expect(await googleAccount(valid,'Europe/London')).toBe('new')
 expect(h.db.mock.calls[1][1]).toEqual(['ada@gmail.com','hashed-random','Ada','Europe/London','google-user',true])
 expect(h.db.mock.calls[1][0]).toContain('users.google_sub IS NULL AND $6')
})
it('recognizes Workspace authority and falls back to an email name', async () => {
 h.db.mockResolvedValueOnce([]).mockResolvedValueOnce([{id:'workspace'}]); expect(await googleAccount({...valid,email:'ada@company.test',hd:'company.test',name:' '},'UTC')).toBe('workspace')
 expect(h.db.mock.calls[1][1][2]).toBe('ada'); expect(h.db.mock.calls[1][1][5]).toBe(true)
})
it('does not auto-link non-authoritative email to a password account', async () => {
 h.db.mockResolvedValueOnce([]).mockResolvedValueOnce([])
 await expect(googleAccount({...valid,email:'ada@external.test',name:undefined},'UTC')).rejects.toThrow('existing email')
 expect(h.db.mock.calls[1][1][5]).toBe(false)
})
