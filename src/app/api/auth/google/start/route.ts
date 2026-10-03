import { cookies } from 'next/headers'
import { z } from 'zod'
import { googleClient, googleReturnTo, GOOGLE_STATE_COOKIE, GOOGLE_UNAVAILABLE } from '@/lib/google-auth'
import { sql } from '@/lib/db'
import { token, tokenHash } from '@/lib/security'
import { json, originGuard } from '@/lib/http'
import { authRateLimit } from '@/lib/rate-limit'

export async function POST(request: Request) {
  try {
    await originGuard()
    const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'
    if (!(await authRateLimit(`google:${ip}`))) return json({ error: 'Too many attempts. Try again later.' }, 429)
    const input = z.object({ timezone: z.string().max(80), returnTo: z.string().max(512) }).parse(await request.json())
    try { new Intl.DateTimeFormat('en-US', { timeZone: input.timezone }).format() } catch { return json({ error: 'Invalid timezone' }, 400) }
    const client = googleClient()
    const { codeVerifier, codeChallenge } = await client.generateCodeVerifierAsync()
    const state = token(), nonce = token()
    const db = sql()
    await db('DELETE FROM google_login_requests WHERE expires_at < now()')
    await db(`INSERT INTO google_login_requests(state_hash,nonce,verifier,return_to,timezone,expires_at)
      VALUES($1,$2,$3,$4,$5,now()+interval '10 minutes')`, [tokenHash(state), nonce, codeVerifier, googleReturnTo(input.returnTo), input.timezone])
    ;(await cookies()).set(GOOGLE_STATE_COOKIE, state, { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/api/auth/google', maxAge: 600 })
    const url = client.generateAuthUrl({ scope: ['openid', 'email', 'profile'], state, nonce, code_challenge: codeChallenge, code_challenge_method: 'S256' as any, prompt: 'select_account' })
    return json({ url })
  } catch (error) {
    if (error instanceof Response) return error
    if (error instanceof z.ZodError) return json({ error: 'Invalid sign-in request' }, 400)
    return json({ error: GOOGLE_UNAVAILABLE }, 503)
  }
}
