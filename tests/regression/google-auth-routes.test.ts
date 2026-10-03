import { beforeEach, afterEach, expect, it, vi } from 'vitest'
const h = vi.hoisted(()=>({db:vi.fn(),cookies:vi.fn(),origin:vi.fn(),rate:vi.fn(),client:vi.fn(),config:vi.fn(),identity:vi.fn(),account:vi.fn()}))
vi.mock('@/lib/db',()=>({sql:()=>h.db}))
vi.mock('next/headers',()=>({cookies:h.cookies}))
vi.mock('@/lib/http',()=>({originGuard:h.origin,json:(body:unknown,status=200)=>Response.json(body,{status})}))
vi.mock('@/lib/rate-limit',()=>({authRateLimit:h.rate}))
vi.mock('@/lib/security',()=>({token:()=> 'state',tokenHash:(value:string)=>`hash:${value}`}))
vi.mock('@/lib/google-auth',()=>({googleClient:h.client,googleConfig:h.config,googleIdentity:h.identity,googleAccount:h.account,googleReturnTo:()=> '/?sit=invite',GOOGLE_STATE_COOKIE:'still_google_state',GOOGLE_UNAVAILABLE:'Google unavailable'}))
import { POST } from '@/app/api/auth/google/start/route'
import { GET } from '@/app/api/auth/google/callback/route'
const set=vi.fn(), get=vi.fn(); const url=vi.fn(), verifier=vi.fn()
const start=(body:unknown={timezone:'UTC',returnTo:'/?sit=invite'},headers:Record<string,string>={})=>new Request('https://still.test/api/auth/google/start',{method:'POST',body:JSON.stringify(body),headers})
const callback=(params='state=state&code=code')=>new Request(`https://still.test/api/auth/google/callback?${params}`)
beforeEach(()=>{
 vi.resetAllMocks(); h.origin.mockResolvedValue(undefined); h.rate.mockResolvedValue(true); h.cookies.mockResolvedValue({get,set}); get.mockReturnValue({value:'state'})
 h.config.mockReturnValue({origin:'https://still.test'}); h.client.mockReturnValue({generateCodeVerifierAsync:verifier,generateAuthUrl:url})
 verifier.mockResolvedValue({codeVerifier:'verifier',codeChallenge:'challenge'}); url.mockReturnValue('https://accounts.google.com/auth')
 h.db.mockResolvedValue([{nonce:'nonce',verifier:'verifier',return_to:'/?sit=invite',timezone:'UTC'}]); h.identity.mockResolvedValue({sub:'sub'}); h.account.mockResolvedValue('owner')
 vi.stubEnv('NODE_ENV','production'); vi.stubEnv('SESSION_COOKIE_NAME','custom_session')
})
afterEach(()=>vi.unstubAllEnvs())
it('starts a state/nonce/PKCE-protected login with secure expiring cookie', async()=>{
 expect((await POST(start({},{}))).status).toBe(400)
 const response=await POST(start(undefined,{'x-forwarded-for':'1.2.3.4, 5.6.7.8'})); expect(response.status).toBe(200)
 expect(h.rate).toHaveBeenCalledWith('google:1.2.3.4')
 expect(set).toHaveBeenCalledWith('still_google_state','state',expect.objectContaining({httpOnly:true,secure:true,path:'/api/auth/google',maxAge:600}))
 expect(h.db.mock.calls[1][1]).toEqual(['hash:state','state','verifier','/?sit=invite','UTC'])
 expect(url).toHaveBeenCalledWith(expect.objectContaining({state:'state',nonce:'state',code_challenge:'challenge',code_challenge_method:'S256'}))
})
it('blocks cross-origin, excessive, invalid timezone and unavailable starts', async()=>{
 h.origin.mockRejectedValueOnce(new Response('bad origin',{status:403})); expect((await POST(start())).status).toBe(403)
 h.rate.mockResolvedValueOnce(false); expect((await POST(start())).status).toBe(429)
 expect((await POST(start({timezone:'bad/zone',returnTo:'/'}))).status).toBe(400)
 h.client.mockImplementationOnce(()=>{throw new Error('secret')}); const response=await POST(start()); expect(response.status).toBe(503); expect(await response.json()).toEqual({error:'Google unavailable'})
})
it('consumes login state once and creates a standard session after verification', async()=>{
 const response=await GET(callback()); expect(response.status).toBe(303); expect(response.headers.get('location')).toBe('https://still.test/?sit=invite')
 expect(response.headers.get('cache-control')).toBe('no-store'); expect(h.identity).toHaveBeenCalledWith('code','nonce','verifier')
 expect(h.db.mock.calls[0][0]).toContain('DELETE FROM google_login_requests')
 expect(h.db.mock.calls[1][1]).toEqual(['owner','hash:state'])
 expect(set).toHaveBeenCalledWith('custom_session','state',expect.objectContaining({httpOnly:true,secure:true,maxAge:2592000}))
})
it.each(['code=code','state=different&code=code','state=state','state=state&code=code&error=access_denied'])('handles failed callback %s without creating a session',async params=>{
 const response=await GET(callback(params)); expect(response.headers.get('location')).toContain('google_error=1'); expect(h.account).not.toHaveBeenCalled()
})
it('rejects missing cookie, expired/reused state, and provider verification failures', async()=>{
 get.mockReturnValueOnce(undefined); expect((await GET(callback())).headers.get('location')).toContain('google_error')
 h.db.mockResolvedValueOnce([]); expect((await GET(callback())).headers.get('location')).toContain('google_error')
 h.identity.mockRejectedValueOnce(new Error('invalid nonce')); expect((await GET(callback())).headers.get('location')).toContain('google_error')
 expect(set.mock.calls.every(([key])=>key==='still_google_state')).toBe(true)
})
it('uses the safe canonical fallback on missing deployment configuration',async()=>{
 h.config.mockImplementationOnce(()=>{throw new Error('missing secret')}); expect((await GET(callback())).headers.get('location')).toBe('https://still-meditation-ashen.vercel.app/?google_error=1')
})
it('supports development cookies and default session name', async()=>{
 vi.stubEnv('NODE_ENV','development'); vi.stubEnv('SESSION_COOKIE_NAME',''); await POST(start()); await GET(callback())
 expect(set).toHaveBeenCalledWith('still_session','state',expect.objectContaining({secure:false}))
})
