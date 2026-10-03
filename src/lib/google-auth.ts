import { OAuth2Client } from 'google-auth-library'
import { z } from 'zod'
import { hashPassword, token } from './security'
import { sql } from './db'

export const GOOGLE_STATE_COOKIE = 'still_google_state'
export const GOOGLE_UNAVAILABLE = 'Google sign-in is temporarily unavailable. Please use email for now.'

export function googleConfig() {
  const clientId = process.env.GOOGLE_CLIENT_ID
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET
  const appUrl = process.env.APP_URL
  if (!clientId || !clientSecret || !appUrl) throw new Error(GOOGLE_UNAVAILABLE)
  const origin = new URL(appUrl).origin
  if (!origin.startsWith('https://') && origin !== 'http://localhost:3217') throw new Error(GOOGLE_UNAVAILABLE)
  const redirectUri = `${origin}/api/auth/google/callback`
  return { clientId, clientSecret, origin, redirectUri }
}

export function googleClient() {
  const { clientId, clientSecret, redirectUri } = googleConfig()
  return new OAuth2Client(clientId, clientSecret, redirectUri)
}

export function googleReturnTo(value: unknown) {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//')) return '/'
  const url = new URL(value, 'https://still.invalid')
  if (url.origin !== 'https://still.invalid' || url.pathname !== '/') return '/'
  const sit = url.searchParams.get('sit')
  return sit && /^[A-Za-z0-9_-]{1,128}$/.test(sit) ? `/?sit=${sit}` : '/'
}

const claims = z.object({
  sub: z.string().min(1).max(255), email: z.email().max(254), email_verified: z.literal(true),
  nonce: z.string(), name: z.string().optional(), hd: z.string().optional(),
})

export async function googleIdentity(code: string, nonce: string, verifier: string) {
  const client = googleClient()
  const { tokens } = await client.getToken({ code, codeVerifier: verifier })
  if (!tokens.id_token) throw new Error('Missing Google identity')
  const ticket = await client.verifyIdToken({ idToken: tokens.id_token, audience: googleConfig().clientId })
  const identity = claims.parse(ticket.getPayload())
  if (identity.nonce !== nonce) throw new Error('Invalid Google nonce')
  return identity
}

export async function googleAccount(identity: Awaited<ReturnType<typeof googleIdentity>>, timezone: string) {
  const db = sql()
  // Google's immutable subject remains the account identifier even if the email changes.
  const existing = (await db('SELECT id FROM users WHERE google_sub=$1', [identity.sub]))[0]
  if (existing) return existing.id as string
  // Google is authoritative for Gmail and verified Workspace domains, not external email addresses.
  const authoritative = identity.email.toLowerCase().endsWith('@gmail.com') || Boolean(identity.hd)
  const name = (identity.name?.trim() || identity.email.split('@')[0]).slice(0, 80)
  const rows = await db(`INSERT INTO users(email,password_hash,name,timezone,google_sub)
    VALUES($1,$2,$3,$4,$5)
    ON CONFLICT(email) DO UPDATE SET google_sub=EXCLUDED.google_sub
    WHERE users.google_sub=EXCLUDED.google_sub OR (users.google_sub IS NULL AND $6)
    RETURNING id`, [identity.email.toLowerCase(), await hashPassword(token()), name, timezone, identity.sub, authoritative])
  if (!rows[0]) throw new Error('Sign in with your existing email and password')
  return rows[0].id as string
}
