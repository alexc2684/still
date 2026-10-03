import { cookies } from 'next/headers'
import { googleAccount, googleConfig, googleIdentity, GOOGLE_STATE_COOKIE } from '@/lib/google-auth'
import { sql } from '@/lib/db'
import { token, tokenHash } from '@/lib/security'

export async function GET(request: Request) {
  const jar = await cookies()
  const expected = jar.get(GOOGLE_STATE_COOKIE)?.value
  jar.set(GOOGLE_STATE_COOKIE, '', { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/api/auth/google', maxAge: 0 })
  let origin = 'https://still-meditation-ashen.vercel.app'
  let returnTo = '/'
  try {
    const config = googleConfig(); origin = config.origin
    const params = new URL(request.url).searchParams
    const state = params.get('state'), code = params.get('code')
    if (!state || !expected || tokenHash(state) !== tokenHash(expected)) throw new Error('Invalid state')
    const db = sql()
    const attempt = (await db(`DELETE FROM google_login_requests WHERE state_hash=$1 AND expires_at>now()
      RETURNING nonce,verifier,return_to,timezone`, [tokenHash(state)]))[0]
    if (!attempt) throw new Error('Expired or used state')
    returnTo = attempt.return_to
    if (!code || params.has('error')) throw new Error('Google sign-in cancelled')
    const identity = await googleIdentity(code, attempt.nonce, attempt.verifier)
    const id = await googleAccount(identity, attempt.timezone)
    const session = token()
    await db(`INSERT INTO sessions(user_id,token_hash,expires_at) VALUES($1,$2,now()+interval '30 days')`, [id, tokenHash(session)])
    jar.set(process.env.SESSION_COOKIE_NAME || 'still_session', session, { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/', maxAge: 60*60*24*30 })
    return new Response(null, { status: 303, headers: { Location: new URL(returnTo, origin).href, 'Cache-Control': 'no-store' } })
  } catch {
    const url = new URL(returnTo, origin); url.searchParams.set('google_error', '1')
    return new Response(null, { status: 303, headers: { Location: url.href, 'Cache-Control': 'no-store' } })
  }
}
